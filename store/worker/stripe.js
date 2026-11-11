import { sql } from "./turso.js";
import { unseal, hmac, equal, session } from "./security.js";
import { saveSettings } from "./settings.js";
import { fulfillOrder } from "./fulfillment.js";
const stripeReply = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function stripeRequest(config, path, method = "GET", params, key) {
  const response = await fetch("https://api.stripe.com/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + config.stripeKey,
      "Stripe-Version": "2024-06-20",
      ...(params
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(params ? { body: new URLSearchParams(params) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw Error("Stripe indisponível");
  return data;
}
export function safeStripeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export async function stripeCheckout(env, config, order, origin) {
  if (order.payment_id)
    return stripeReply({
      id: order.id,
      gateway: "stripe",
      status: order.status,
      amount: Number(order.amount),
      checkoutUrl: safeStripeUrl(order.checkout_url),
    });
  const customer = await unseal(env, order.customer);
  const data = await stripeRequest(
    config,
    "/checkout/sessions",
    "POST",
    {
      mode: "payment",
      "payment_method_types[0]": "card",
      client_reference_id: order.id,
      "metadata[order_id]": order.id,
      "payment_intent_data[metadata][order_id]": order.id,
      customer_email: customer.email,
      locale: customer.locale === "en" ? "en" : "pt-BR",
      "line_items[0][price_data][currency]": "brl",
      "line_items[0][price_data][unit_amount]": String(order.amount),
      "line_items[0][price_data][product_data][name]": order.service_name,
      "line_items[0][quantity]": "1",
      success_url:
        origin + "/?payment=success&order=" + encodeURIComponent(order.id),
      cancel_url:
        origin + "/?payment=cancelled&order=" + encodeURIComponent(order.id),
    },
    "checkout-" + order.id,
  );
  const checkoutUrl = safeStripeUrl(data.url);
  if (
    !data.id?.startsWith("cs_") ||
    !checkoutUrl ||
    data.amount_total !== Number(order.amount) ||
    data.currency !== "brl" ||
    data.client_reference_id !== order.id
  )
    throw Error("Sessão Stripe divergente");
  await sql(
    env,
    "UPDATE orders SET payment_id=?,checkout_url=?,status='waiting_payment' WHERE id=? AND payment_id IS NULL",
    [data.id, checkoutUrl, order.id],
  );
  return stripeReply({
    id: order.id,
    gateway: "stripe",
    status: "waiting_payment",
    amount: Number(order.amount),
    checkoutUrl,
  });
}
export async function reconcileStripe(env, config, order) {
  const data = await stripeRequest(
    config,
    "/checkout/sessions/" +
      encodeURIComponent(order.payment_id) +
      "?expand%5B0%5D=payment_intent.latest_charge",
  );
  if (
    data.id !== order.payment_id ||
    data.client_reference_id !== order.id ||
    data.metadata?.order_id !== order.id ||
    data.amount_total !== Number(order.amount) ||
    data.currency !== "brl" ||
    data.mode !== "payment"
  )
    throw Error("Pagamento Stripe divergente");
  const intent = data.payment_intent,
    charge = typeof intent === "object" ? intent?.latest_charge : null;
  if (intent) {
    await sql(env, "UPDATE orders SET payment_intent=? WHERE id=?", [
      typeof intent === "string" ? intent : intent.id,
      order.id,
    ]);
  }
  if (
    charge &&
    typeof charge === "object" &&
    (charge.disputed || charge.amount_refunded > 0)
  ) {
    await sql(env, "UPDATE orders SET status=? WHERE id=?", [
      charge.disputed ? "chargedback" : "refunded",
      order.id,
    ]);
    return;
  }
  if (data.status === "expired") {
    await sql(
      env,
      "UPDATE orders SET status='expired' WHERE id=? AND status='waiting_payment'",
      [order.id],
    );
    return;
  }
  if (data.payment_status !== "paid" || data.status !== "complete") return;
  await fulfillOrder(env, config, order);
}
async function stripeOrder(env, field, value) {
  const result = await sql(
    env,
    "SELECT * FROM orders WHERE " + field + "=? AND payment_provider='stripe'",
    [value],
  );
  return result.rows.length
    ? Object.fromEntries(
        result.cols.map((c, i) => [c.name, result.rows[0][i].value]),
      )
    : null;
}
export async function stripeWebhook(request, env, config) {
  if (request.method !== "POST")
    return stripeReply({ error: "Método inválido" }, 405);
  const raw = await request.text();
  if (raw.length > 100000) return stripeReply({}, 413);
  const parts = (request.headers.get("Stripe-Signature") || "")
    .split(",")
    .map((p) => p.trim().split("="));
  const timestamp = parts.find((p) => p[0] === "t")?.[1];
  const signatures = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (
    !config.stripeWebhookSecret ||
    !/^\d+$/.test(timestamp || "") ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return stripeReply({ error: "Assinatura Stripe inválida." }, 401);
  const expected = await hmac(
    config.stripeWebhookSecret,
    timestamp + "." + raw,
  );
  if (!signatures.some((sig) => equal(expected, sig)))
    return stripeReply({ error: "Assinatura Stripe inválida." }, 401);
  const event = JSON.parse(raw),
    object = event.data?.object;
  if (!object?.id) return stripeReply({ ok: true });
  const sessionEvents = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ];
  let order = null;
  if (sessionEvents.includes(event.type))
    order = await stripeOrder(env, "payment_id", object.id);
  else if (
    [
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
    ].includes(event.type) &&
    object.payment_intent
  )
    order = await stripeOrder(env, "payment_intent", object.payment_intent);
  if (order) await reconcileStripe(env, config, order);
  return stripeReply({ ok: true });
}
export async function registerStripeWebhook(request, env, config) {
  const auth = await session(request, env);
  if (!auth || auth.email !== config.adminEmail)
    return stripeReply({ error: "Faça login." }, 401);
  if (
    request.method !== "POST" ||
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return stripeReply({ error: "Origem inválida." }, 403);
  if (!config.stripeKey)
    return stripeReply(
      { error: "Salve a chave secreta Stripe antes de registrar o webhook." },
      400,
    );
  if (new URL(request.url).protocol !== "https:")
    return stripeReply(
      { error: "O registro do webhook exige uma URL pública HTTPS." },
      400,
    );
  if (config.stripeWebhookId && config.stripeWebhookSecret)
    return stripeReply({ ok: true });
  const events = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.closed",
  ];
  const params = {
    url: new URL(request.url).origin + "/api/webhooks/stripe",
    api_version: "2024-06-20",
  };
  events.forEach((event, i) => (params["enabled_events[" + i + "]"] = event));
  const data = await stripeRequest(
    config,
    "/webhook_endpoints",
    "POST",
    params,
    "webhook-" +
      new URL(request.url).host +
      "-" +
      (await hmac(config.stripeKey, "webhook-registration")),
  );
  if (!data.id || !data.secret?.startsWith("whsec_"))
    throw Error("Webhook Stripe inválido");
  await saveSettings(env, {
    ...config,
    stripeWebhookId: data.id,
    stripeWebhookSecret: data.secret,
  });
  return stripeReply({ ok: true });
}
