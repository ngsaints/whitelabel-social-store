import {
  stripeCheckout,
  reconcileStripe,
  stripeWebhook,
  registerStripeWebhook,
  safeStripeUrl,
} from "./stripe.js";
import { fulfillOrder } from "./fulfillment.js";
import { paymentMethods } from "./gateways.js";
import { sql } from "./turso.js";
import { settings, saveSettings } from "./settings.js";
import { digest, hmac, equal, session, seal, unseal } from "./security.js";
import { catalog } from "./catalog.js";
const reply = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function uvvi(config, path, method = "GET", body, key) {
  const base =
    config.uvviEnvironment === "production"
      ? "https://api.uvvipay.com.br"
      : "https://api-staging.uvvipay.com.br";
  const response = await fetch(base + path, {
    method,
    headers: {
      "client-id": config.uvviClientId,
      "client-secret": config.uvviClientSecret,
      "Content-Type": "application/json",
      ...(key ? { "x-idempotency-key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw Error("Provedor de pagamento indisponível");
  return data;
}
async function getOrder(env, id) {
  const data = await sql(env, "SELECT * FROM orders WHERE id=?", [id]);
  return data.rows.length
    ? Object.fromEntries(
        data.cols.map((c, i) => [c.name, data.rows[0][i].value]),
      )
    : null;
}
function validCpf(value) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (let n = 9; n < 11; n++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(value[i]) * (n + 1 - i);
    let check = (sum * 10) % 11;
    if (check === 10) check = 0;
    if (check !== Number(value[n])) return false;
  }
  return true;
}
export async function paymentApi(request, env) {
  const path = new URL(request.url).pathname;
  try {
    const config = await settings(env);
    if (path === "/api/webhooks/stripe")
      return await stripeWebhook(request, env, config);
    if (path === "/api/admin/stripe/webhook")
      return await registerStripeWebhook(request, env, config);
    if (path === "/api/admin/webhook") {
      const auth = await session(request, env);
      if (!auth || auth.email !== config.adminEmail)
        return reply({ error: "Faça login." }, 401);
      if (
        request.method !== "POST" ||
        request.headers.get("origin") !== new URL(request.url).origin
      )
        return reply({ error: "Origem inválida." }, 403);
      if (new URL(request.url).protocol !== "https:")
        return reply(
          { error: "O registro do webhook exige uma URL pública HTTPS." },
          400,
        );
      if (config.webhookRegistered) return reply({ ok: true });
      await uvvi(config, "/v1/webhooks", "POST", {
        webhook_url: new URL(request.url).origin + "/api/webhooks/uvvipay",
        events: [
          "transaction.paid",
          "transaction.refunded",
          "transaction.chargedback",
          "transaction.cancelled",
          "transaction.expired",
        ],
        hmac_secret: config.webhookSecret,
      });
      await saveSettings(env, { ...config, webhookRegistered: true });
      return reply({ ok: true });
    }
    if (path === "/api/webhooks/uvvipay") {
      if (request.method !== "POST")
        return reply({ error: "Método inválido" }, 405);
      const raw = await request.text();
      if (raw.length > 50000) return reply({}, 413);
      const timestamp = request.headers.get("X-UvviPay-Timestamp") || "";
      const signature = request.headers.get("X-UvviPay-Signature") || "";
      if (
        !config.webhookSecret ||
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        !equal(
          "sha256=" + (await hmac(config.webhookSecret, timestamp + "." + raw)),
          signature,
        )
      )
        return reply({ error: "Assinatura inválida" }, 401);
      const payload = JSON.parse(raw);
      if (!payload.id) return reply({ ok: true });
      const found = await sql(
        env,
        "SELECT id FROM orders WHERE payment_id=? AND payment_provider='uvvipay'",
        [payload.id],
      );
      if (!found.rows.length) return reply({ ok: true });
      const order = await getOrder(env, found.rows[0][0].value);
      await reconcile(env, config, order);
      return reply({ ok: true });
    }
    const token = (request.headers.get("authorization") || "").replace(
      /^Bearer /,
      "",
    );
    if (!/^[a-f0-9-]{36}$/.test(token))
      return reply({ error: "Sessão inválida." }, 401);
    const owner = await digest(token);
    if (path === "/api/checkout" && request.method === "POST") {
      if (request.headers.get("origin") !== new URL(request.url).origin)
        return reply({ error: "Origem inválida." }, 403);

      const b = await request.json();
      const gateway = b.gateway || "uvvipay";
      if (!["uvvipay", "stripe"].includes(gateway))
        return reply({ error: "Meio de pagamento inválido." }, 400);
      if (!/^[a-f0-9-]{36}$/.test(b.id || ""))
        return reply({ error: "Identificador inválido" }, 400);
      let order = await getOrder(env, b.id);
      if (order) {
        if (order.owner !== owner)
          return reply({ error: "Pedido não encontrado" }, 404);
        return await checkoutReply(
          env,
          config,
          order,
          new URL(request.url).origin,
        );
      }
      if (
        !config.salesEnabled ||
        !config.smmKey ||
        !paymentMethods(config).includes(gateway)
      )
        return reply(
          { error: "Este meio de pagamento não está disponível." },
          503,
        );
      const services = await catalog(config),
        service = services.find((s) => String(s.service) === String(b.service));
      const quantity = Number(b.quantity);
      let link;
      try {
        link = new URL(b.link);
      } catch {
        return reply({ error: "Link inválido." }, 400);
      }
      const cpf = String(b.cpf || "").replace(/\D/g, "");
      if (
        !service ||
        !Number.isInteger(quantity) ||
        quantity < Number(service.min) ||
        quantity > Number(service.max) ||
        !["https:", "http:"].includes(link.protocol) ||
        link.href.length > 2000 ||
        typeof b.name !== "string" ||
        b.name.trim().length < 3 ||
        b.name.length > 150 ||
        (gateway === "uvvipay" && !validCpf(cpf)) ||
        !/^\S+@\S+\.\S+$/.test(b.email || "")
      )
        return reply(
          { error: "Confira serviço, quantidade e dados do comprador." },
          400,
        );
      const amount = Math.ceil(
        (Math.round(Number(service.rate) * 100) * quantity) / 1000,
      );
      if (amount < 100 || amount > 1000000)
        return reply(
          {
            error:
              "Valor do pedido fora do limite permitido (R$ 1 a R$ 10.000).",
          },
          400,
        );
      const recent = await sql(
        env,
        "SELECT COUNT(*) FROM orders WHERE owner=? AND created_at>datetime('now','-1 hour')",
        [owner],
      );
      if (Number(recent.rows[0][0].value) >= 10)
        return reply({ error: "Limite de pedidos atingido. Aguarde." }, 429);
      const customer = await seal(env, {
        name: b.name.trim(),
        email: b.email,
        cpf: gateway === "uvvipay" ? cpf : "",
        locale: b.locale === "en" ? "en" : "pt",
        link: link.href,
      });
      await sql(
        env,
        "INSERT OR IGNORE INTO orders(id,owner,service_id,service_name,quantity,amount,status,customer,payment_provider,created_at) VALUES(?,?,?,?,?,?,'creating',?,?,datetime('now'))",
        [
          b.id,
          owner,
          service.service,
          service.name,
          quantity,
          amount,
          customer,
          gateway,
        ],
      );
      order = await getOrder(env, b.id);
      if (order.owner !== owner)
        return reply({ error: "Pedido não encontrado" }, 404);
      return await checkoutReply(
        env,
        config,
        order,
        new URL(request.url).origin,
      );
    }
    if (path.startsWith("/api/orders/") && request.method === "GET") {
      const order = await getOrder(env, path.split("/").pop());
      if (!order || order.owner !== owner)
        return reply({ error: "Pedido não encontrado" }, 404);
      if (
        order.payment_id &&
        ![
          "submitted",
          "fulfillment_unknown",
          "refunded",
          "chargedback",
        ].includes(order.status)
      )
        await (order.payment_provider === "stripe"
          ? reconcileStripe(env, config, order)
          : reconcile(env, config, order));
      const current = await getOrder(env, order.id);
      return reply({
        id: current.id,
        status: current.status,
        amount: Number(current.amount),
        gateway: current.payment_provider,
        checkoutUrl:
          current.payment_provider === "stripe"
            ? safeStripeUrl(current.checkout_url)
            : null,
        pix: current.pix || "",
        providerOrder: current.provider_order || null,
      });
    }
    return reply({ error: "Não encontrado" }, 404);
  } catch {
    if(path.startsWith('/api/admin/'))return reply({error:'Não foi possível registrar o webhook. Confira credenciais, permissões e URL pública HTTPS.'},503);
    return reply(
      {
        error:
          "Não foi possível concluir. Consulte o mesmo pedido antes de tentar novamente.",
      },
      503,
    );
  }
}
async function checkoutReply(env, config, order, origin) {
  if (order.payment_provider === "stripe")
    return stripeCheckout(env, config, order, origin);
  if (order.payment_id)
    return reply({
      id: order.id,
      status: order.status,
      amount: Number(order.amount),
      pix: order.pix || "",
    });
  const c = await unseal(env, order.customer);
  const data = await uvvi(
    config,
    "/v1/payments",
    "POST",
    {
      externalId: order.id,
      amount: Number(order.amount),
      paymentMethod: "pix",
      customer: {
        name: c.name,
        email: c.email,
        document: { number: c.cpf, type: "cpf" },
      },
      items: [
        {
          title: order.service_name,
          quantity: 1,
          unitPrice: Number(order.amount),
        },
      ],
    },
    order.id,
  );
  if (!data.id || Number(data.amount) !== Number(order.amount))
    throw Error("Resposta inválida");
  await sql(
    env,
    "UPDATE orders SET payment_id=?,pix=?,status='waiting_payment' WHERE id=? AND payment_id IS NULL",
    [data.id, data.pix?.qrcode || "", order.id],
  );
  return reply({
    id: order.id,
    status: "waiting_payment",
    amount: Number(order.amount),
    pix: data.pix?.qrcode || "",
  });
}
async function reconcile(env, config, order) {
  const payment = await uvvi(
    config,
    "/v1/payments/" + encodeURIComponent(order.payment_id),
  );
  if (
    payment.id !== order.payment_id ||
    Number(payment.amount) !== Number(order.amount) ||
    payment.externalReference !== order.id ||
    payment.paymentMethod !== "pix"
  )
    throw Error("Pagamento divergente");
  if (
    ["refunded", "chargedback", "cancelled", "expired", "refused"].includes(
      payment.status,
    )
  ) {
    await sql(env, "UPDATE orders SET status=? WHERE id=?", [
      payment.status,
      order.id,
    ]);
    return;
  }
  if (payment.status !== "paid") return;
  await fulfillOrder(env, config, order);
}
