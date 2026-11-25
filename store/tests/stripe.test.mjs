import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import app from "../worker/index.js";
import { schema } from "../worker/schema.js";
import { migrateOrders } from "../worker/migrations.js";
import { saveSettings, settings } from "../worker/settings.js";
import { cookie, hmac } from "../worker/security.js";
import { safeStripeUrl } from "../worker/stripe.js";
function execute(db, statement, args = []) {
  const query = db.prepare(statement),
    cols = query.columns();
  const rows = cols.length ? query.all(...args) : (query.run(...args), []);
  return {
    cols: cols.map((c) => ({ name: c.name })),
    rows: rows.map((row) =>
      cols.map((c) => ({
        type: row[c.name] === null ? "null" : "text",
        value: row[c.name] === null ? null : String(row[c.name]),
      })),
    ),
  };
}
test("migração preserva pedidos Pix e pode ser repetida", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT);INSERT INTO orders VALUES('old-order','submitted')",
  );
  await migrateOrders((s) => execute(db, s));
  await migrateOrders((s) => execute(db, s));
  assert.equal(
    db.prepare("SELECT payment_provider FROM orders WHERE id='old-order'").get()
      .payment_provider,
    "uvvipay", // legado: pedidos antigos permanecem vinculados ao provedor anterior
  );
  assert.equal(
    db.prepare("SELECT status FROM orders").get().status,
    "submitted",
  );
  db.close();
});
test("Stripe pelo painel, checkout sem CPF, assinatura, reconciliação e isolamento", async () => {
  const db = new DatabaseSync(":memory:");
  schema.forEach((s) => db.exec(s));
  const env = {
    TURSO_DATABASE_URL: "libsql://stripe-test.turso.io",
    TURSO_AUTH_TOKEN: "test",
    APP_ENCRYPTION_KEY: "stripe-test-encryption-key-32-characters-only",
  };
  const original = globalThis.fetch;
  let submissions = 0,
    sessionCalls = 0,
    registrations = 0,
    paid = false,
    mismatch = false,
    refunded = false;
  const sessions = new Map();
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("stripe-test.turso.io")) {
      const stmt = JSON.parse(options.body).requests[0].stmt;
      return Response.json({
        results: [
          {
            type: "ok",
            response: {
              result: execute(
                db,
                stmt.sql,
                stmt.args.map((v) => v.value),
              ),
            },
          },
        ],
      });
    }
    if (u === "https://smmhype.com/api/v2") {
      const params = new URLSearchParams(options.body);
      if (params.get("action") === "services")
        return Response.json([
          {
            service: 1,
            name: "Followers",
            type: "Default",
            category: "Instagram",
            rate: "10",
            min: "100",
            max: "10000",
          },
        ]);
      submissions++;
      return Response.json({ order: 999 });
    }
    if (u.endsWith("/webhook_endpoints")) {
      registrations++;
      const params = new URLSearchParams(options.body);
      assert.equal(params.get("url"), "https://store.test/api/webhooks/stripe");
      return Response.json({
        id: "we_test",
        secret: "whsec_test_signing_secret",
      });
    }
    if (
      u === "https://api.stripe.com/v1/checkout/sessions" &&
      options.method === "POST"
    ) {
      sessionCalls++;
      const params = new URLSearchParams(options.body);
      assert.equal(params.get("payment_method_types[0]"), "card");
      assert.equal(params.get("line_items[0][price_data][currency]"), "brl");
      assert.ok(options.headers["Idempotency-Key"]);
      const id = "cs_test_" + sessionCalls;
      const result = {
        id,
        mode: "payment",
        currency: "brl",
        amount_total: Number(
          params.get("line_items[0][price_data][unit_amount]"),
        ),
        client_reference_id: params.get("client_reference_id"),
        metadata: { order_id: params.get("metadata[order_id]") },
        url: "https://checkout.stripe.com/c/pay/" + id,
      };
      sessions.set(id, result);
      return Response.json(result);
    }
    if (u.includes("/checkout/sessions/cs_")) {
      const id = new URL(u).pathname.split("/").pop(),
        data = sessions.get(id);
      return Response.json({
        ...data,
        amount_total: data.amount_total + (mismatch ? 1 : 0),
        status: paid ? "complete" : "open",
        payment_status: paid ? "paid" : "unpaid",
        payment_intent: paid
          ? {
              id: "pi_test_" + id,
              latest_charge: {
                id: "ch_test",
                disputed: false,
                amount_refunded: refunded ? data.amount_total : 0,
              },
            }
          : null,
      });
    }
    throw Error("Unexpected request " + u);
  };
  const owner = crypto.randomUUID(),
    auth = await cookie(
      env,
      "admin@example.com",
      new Request("https://store.test"),
    );
  async function req(path, method = "GET", body, headers = {}) {
    const response = await app.fetch(
      new Request("https://store.test" + path, {
        method,
        headers: {
          Origin: "https://store.test",
          "Content-Type": "application/json",
          Cookie: auth,
          Authorization: "Bearer " + owner,
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
    return { response, data: await response.json() };
  }
  try {
    await saveSettings(env, {
      initialized: true,
      adminEmail: "admin@example.com",
      name: "Store",
      accent: "#78b9df",
      currency: "USD",
      markup: 50,
      exchangeRate: 1,
      smmKey: "smm_test",
      salesEnabled: false,
      revantEnabled: false,
    });
    db.prepare(
      "INSERT INTO orders(id,owner,service_id,service_name,quantity,amount,status,customer,created_at) VALUES('old-pix','old','1','Old Pix',100,100,'submitted','placeholder',datetime('now'))",
    ).run();
    assert.equal(
      (
        await req("/api/admin/settings", "PUT", {
          stripeKey: "sk_test_fixture_only",
          stripeEnabled: true,
        })
      ).response.status,
      200,
    );
    assert.equal(
      (await req("/api/admin/settings", "PUT", { salesEnabled: true })).response
        .status,
      400,
    );
    assert.equal(
      (await req("/api/admin/stripe/webhook", "POST", {})).response.status,
      200,
    );
    await req("/api/admin/stripe/webhook", "POST", {});
    assert.equal(registrations, 1);
    const masked = await req("/api/admin/settings");
    assert.equal(masked.data.stripeKey, "");
    assert.equal(masked.data.stripeWebhookSecret, "");
    assert.equal(masked.data.stripeWebhookSecretConfigured, true);
    assert.equal(
      (await req("/api/admin/settings", "PUT", { salesEnabled: true })).response
        .status,
      200,
    );
    assert.deepEqual((await req("/api/services")).data.paymentMethods, [
      "stripe",
    ]);
    const id = crypto.randomUUID(),
      body = {
        id,
        gateway: "stripe",
        service: 1,
        quantity: 100,
        link: "https://instagram.com/test",
        name: "International Buyer",
        email: "buyer@example.com",
        locale: "en",
        amount: 1,
      };
    const checkout = await req("/api/checkout", "POST", body);
    assert.equal(checkout.response.status, 200);
    assert.equal(checkout.data.gateway, "stripe");
    assert.equal(checkout.data.amount, 150);
    assert.ok(
      checkout.data.checkoutUrl.startsWith("https://checkout.stripe.com/"),
    );
    await req("/api/checkout", "POST", { ...body, gateway: "revantpay" });
    assert.equal(sessionCalls, 1);
    assert.equal(
      db.prepare("SELECT payment_provider FROM orders WHERE id=?").get(id)
        .payment_provider,
      "stripe",
    );
    assert.equal(
      (
        await req("/api/orders/" + id, "GET", null, {
          Authorization: "Bearer " + crypto.randomUUID(),
        })
      ).response.status,
      404,
    );
    const paymentId = db
      .prepare("SELECT payment_id FROM orders WHERE id=?")
      .get(id).payment_id;
    const raw = JSON.stringify({
      id: "evt_test",
      type: "checkout.session.completed",
      data: { object: { id: paymentId, payment_status: "paid" } },
    });
    async function hook({ invalid = false, age = 0, rawBody = raw } = {}) {
      const ts = String(Math.floor(Date.now() / 1000) - age),
        sig = await hmac("whsec_test_signing_secret", ts + "." + raw);
      return app.fetch(
        new Request("https://store.test/api/webhooks/stripe", {
          method: "POST",
          headers: {
            "Stripe-Signature":
              "t=" + ts + ",v1=old-signature,v1=" + (invalid ? "bad" : sig),
          },
          body: rawBody,
        }),
        env,
      );
    }
    assert.equal((await hook({ invalid: true })).status, 401);
    assert.equal((await hook({ age: 301 })).status, 401);
    assert.equal((await hook({ rawBody: raw + " " })).status, 401);
    await hook();
    assert.equal(submissions, 0);
    paid = true;
    mismatch = true;
    assert.equal((await hook()).status, 503);
    assert.equal(submissions, 0);
    mismatch = false;
    await Promise.all([hook(), hook()]);
    assert.equal(submissions, 1);
    await hook();
    assert.equal(submissions, 1);
    assert.equal((await req("/api/orders/" + id)).data.status, "submitted");
    assert.equal(
      (
        await req("/api/admin/settings", "PUT", {
          stripeKey: "sk_live_changed",
        })
      ).response.status,
      409,
    );
    refunded = true;
    const refund = JSON.stringify({
      id: "evt_refund",
      type: "charge.refunded",
      data: {
        object: { id: "ch_test", payment_intent: "pi_test_" + paymentId },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = await hmac(
      "whsec_test_signing_secret",
      ts + "." + refund,
    );
    const response = await app.fetch(
      new Request("https://store.test/api/webhooks/stripe", {
        method: "POST",
        headers: { "Stripe-Signature": "t=" + ts + ",v1=" + signature },
        body: refund,
      }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal((await req("/api/orders/" + id)).data.status, "refunded");
    assert.equal(submissions, 1);
    assert.equal(
      safeStripeUrl("https://checkout.stripe.com.attacker.test/x"),
      null,
    );
    assert.equal(safeStripeUrl("javascript:alert(1)"), null);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});
