import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { schema } from "../worker/schema.js";
import app from "../worker/index.js";
import { settings, saveSettings } from "../worker/settings.js";
import { hmac } from "../worker/security.js";
import { adminPage } from "../worker/admin-page.js";
import { checkoutHtml } from "../worker/checkout-page.js";
test("scripts de interface compilam e configuração pública não injeta HTML", async () => {
  const response = await app.fetch(new Request("https://store.test"), {
    STORE_NAME: "</script><script>alert(1)</script>",
  });
  const html = await response.text();
  assert.ok(!html.includes('const BRAND={"name":"</script>'));
  for (const document of [html, adminPage, checkoutHtml])
    for (const match of document.matchAll(/<script>([\s\S]*?)<\/script>/g))
      assert.doesNotThrow(() => new Function(match[1]));
});
test("instalação, segredos, OTP, Pix e webhook idempotente", async () => {
  const db = new DatabaseSync(":memory:");
  schema.forEach((s) => db.exec(s));
  const env = {
    TURSO_DATABASE_URL: "libsql://test.turso.io",
    TURSO_AUTH_TOKEN: "test",
    APP_ENCRYPTION_KEY: "test-encryption-key-with-at-least-32-chars",
    SETUP_TOKEN: "test-setup-token-with-at-least-32-chars",
  };
  const original = globalThis.fetch;
  let code = "",
    paid = false,
    submissions = 0,
    paymentCalls = 0;
  const payments = new Map();
  let providerFails = false;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("test.turso.io")) {
      const stmt = JSON.parse(options.body).requests[0].stmt;
      const prepared = db.prepare(stmt.sql);
      const columns = prepared.columns();
      const args = stmt.args.map((v) => v.value);
      let rows = [],
        count = 0;
      if (columns.length) {
        rows = prepared.all(...args);
        count = rows.length;
      } else count = Number(prepared.run(...args).changes);
      return Response.json({
        results: [
          {
            type: "ok",
            response: {
              result: {
                cols: columns.map((c) => ({ name: c.name })),
                rows: rows.map((r) =>
                  columns.map((c) => ({
                    type: r[c.name] === null ? "null" : "text",
                    value: r[c.name] === null ? null : String(r[c.name]),
                  })),
                ),
                affected_row_count: count,
              },
            },
          },
        ],
      });
    }
    if (u.includes("api.resend.com")) {
      code = JSON.parse(options.body).text.match(/\d{6}/)[0];
      return Response.json({ id: "email-test" });
    }
    if (u.includes("smmhype.com")) {
      const p = new URLSearchParams(options.body);
      if (p.get("action") === "services")
        return Response.json([
          {
            service: 1,
            name: "Seguidores",
            category: "Instagram",
            type: "Default",
            rate: "10",
            min: "100",
            max: "10000",
          },
        ]);
      submissions++;
      if (providerFails) throw Error("Timeout");
      return Response.json({ order: 12345 });
    }
    if (u.includes("/v1/charges")) {
      if (options.method === "POST") {
        paymentCalls++;
        const body = JSON.parse(options.body);
        const result = {
          id: crypto.randomUUID(),
          externalReference: body.externalId,
          amount: body.amount,
          paymentMethod: "pix",
          pix: { qrcode: "000201-test" },
        };
        payments.set(body.externalId, result);
        return Response.json(result);
      }
      const id = u.split("/").pop();
      const p = [...payments.values()].find((p) => p.id === id);
      return Response.json({ ...p, status: paid ? "paid" : "waiting_payment" });
    }
    throw Error("Unexpected fetch " + u);
  };
  let cookie = "";
  const owner = crypto.randomUUID();
  async function req(path, method = "GET", body, extra = {}) {
    const headers = {
      Origin: "https://store.test",
      "Content-Type": "application/json",
      Cookie: cookie,
      ...extra,
    };
    const response = await app.fetch(
      new Request("https://store.test" + path, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
    return { response, data: await response.json() };
  }
  try {
    assert.equal((await req("/api/admin/settings")).response.status, 401);
    assert.equal(
      (
        await req("/api/admin/setup", "POST", {
          email: "admin@example.com",
          token: "wrong",
        })
      ).response.status,
      401,
    );
    const setup = await req("/api/admin/setup", "POST", {
      email: "admin@example.com",
      token: env.SETUP_TOKEN,
    });
    assert.equal(setup.response.status, 200);
    cookie = setup.response.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (
        await req("/api/admin/setup", "POST", {
          email: "admin@example.com",
          token: env.SETUP_TOKEN,
        })
      ).response.status,
      409,
    );
    assert.equal(
      (
        await req("/api/admin/settings", "PUT", {
          smmKey: "secret-smm",
          resendKey: "secret-resend",
          resendFrom: "Store <test@example.com>",
          revantApiKey: "secret-api-key",
          exchangeRate: 5,
          markup: 100,
          currency: "USD",
        })
      ).response.status,
      200,
    );
    const masked = await req("/api/admin/settings");
    assert.equal(masked.data.smmKey, "");
    assert.equal(masked.data.smmKeyConfigured, true);
    assert.equal(
      (
        await req("/api/admin/settings", "PUT", {
          logoData: "data:image/svg+xml;base64,PHN2Zz4=",
        })
      ).response.status,
      400,
    );
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal(
      (
        await req("/api/admin/settings", "PUT", {
          logoData: logo,
          name: "Loja Teste",
        })
      ).response.status,
      200,
    );
    assert.equal((await req("/api/admin/settings")).data.logoData, logo);
    const rendered = await app.fetch(new Request("https://store.test"), env);
    assert.ok((await rendered.text()).includes('"name":"Loja Teste"'));
    assert.ok(!JSON.stringify(masked.data).includes("secret-smm"));
    assert.ok(
      !db
        .prepare("SELECT value FROM settings WHERE key='store'")
        .get()
        .value.includes("secret-smm"),
    );
    const services = await req("/api/services");
    assert.equal(services.data.currency, "BRL");
    assert.equal(services.data.services[0].rate, "100.00");
    cookie = "";
    assert.equal(
      (await req("/api/admin/otp/send", "POST", { email: "other@example.com" }))
        .response.status,
      200,
    );
    assert.equal(code, "", "nenhum código enviado a e-mail não autorizado");
    assert.equal(
      (await req("/api/admin/otp/send", "POST", { email: "admin@example.com" }))
        .response.status,
      200,
    );
    assert.equal(
      (await req("/api/admin/otp/send", "POST", { email: "admin@example.com" }))
        .response.status,
      429,
    );
    const login = await req("/api/admin/otp/verify", "POST", {
      email: "admin@example.com",
      code,
    });
    assert.equal(login.response.status, 200);
    cookie = login.response.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (
        await req("/api/admin/otp/verify", "POST", {
          email: "admin@example.com",
          code,
        })
      ).response.status,
      401,
    );
    await saveSettings(env, {
      ...(await settings(env)),
      webhookRegistered: true,
      salesEnabled: true,
    });
    const id = crypto.randomUUID(),
      order = {
        id,
        service: 1,
        quantity: 100,
        link: "https://instagram.com/test",
        name: "Test Buyer",
        email: "buyer@example.com",
        cpf: "52998224725",
        amount: 1,
      };
    let r = await req("/api/checkout", "POST", order, {
      Authorization: "Bearer " + owner,
    });
    assert.equal(r.response.status, 200);
    assert.equal(r.data.amount, 1000);
    await req("/api/checkout", "POST", order, {
      Authorization: "Bearer " + owner,
    });
    assert.equal(paymentCalls, 1);
    assert.equal(
      (
        await req("/api/orders/" + id, "GET", null, {
          Authorization: "Bearer " + crypto.randomUUID(),
        })
      ).response.status,
      404,
    );
    const config = await settings(env),
      payment = payments.get(id);
    const raw = JSON.stringify({ id: payment.id, event: "transaction.paid" }),
      ts = String(Math.floor(Date.now() / 1000));
    const signature =
      "sha256=" + (await hmac(config.webhookSecret, ts + "." + raw));
    async function hook(sig = signature) {
      return app.fetch(
        new Request("https://store.test/api/webhooks/revantpay", {
          method: "POST",
          headers: { "X-RevantPay-Timestamp": ts, "X-RevantPay-Signature": sig },
          body: raw,
        }),
        env,
      );
    }
    assert.equal((await hook("sha256=invalid")).status, 401);
    assert.equal(submissions, 0);
    await hook();
    assert.equal(submissions, 0);
    paid = true;
    assert.equal((await hook()).status, 200);
    await hook();
    assert.equal(submissions, 1);
    assert.equal(
      (
        await req("/api/orders/" + id, "GET", null, {
          Authorization: "Bearer " + owner,
        })
      ).data.status,
      "submitted",
    );
    assert.equal(
      (
        await req("/api/admin/settings", "PUT", {
          revantApiKey: "another-secret",
        })
      ).response.status,
      409,
    );
    // Ambiguous provider failure must never create an automatic duplicate.
    const id2 = crypto.randomUUID();
    providerFails = true;
    await req(
      "/api/checkout",
      "POST",
      { ...order, id: id2 },
      { Authorization: "Bearer " + owner },
    );
    await req("/api/orders/" + id2, "GET", null, {
      Authorization: "Bearer " + owner,
    });
    assert.equal(submissions, 2);
    await req("/api/orders/" + id2, "GET", null, {
      Authorization: "Bearer " + owner,
    });
    assert.equal(submissions, 2);
    assert.equal(
      db.prepare("SELECT status FROM orders WHERE id=?").get(id2).status,
      "fulfillment_unknown",
    );
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});
