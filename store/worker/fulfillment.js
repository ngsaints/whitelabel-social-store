import { sql } from "./turso.js";
import { unseal } from "./security.js";
export async function fulfillOrder(env, config, order) {
  const claim = await sql(
    env,
    "UPDATE orders SET status='submitting' WHERE id=? AND status='waiting_payment' RETURNING id",
    [order.id],
  );
  if (!claim.rows.length) return;
  const customer = await unseal(env, order.customer);
  try {
    const response = await fetch("https://smmhype.com/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: config.smmKey,
        action: "add",
        service: order.service_id,
        link: customer.link,
        quantity: order.quantity,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || !data.order) throw Error("Envio não confirmado");
    await sql(
      env,
      "UPDATE orders SET status='submitted',provider_order=? WHERE id=?",
      [data.order, order.id],
    );
  } catch {
    await sql(
      env,
      "UPDATE orders SET status='fulfillment_unknown' WHERE id=? AND status='submitting'",
      [order.id],
    );
  }
}
