const REVANT_BASE = "https://revantpay.com/api/v1";

export async function revant(
  config,
  path,
  method = "GET",
  body,
  idempotencyKey,
) {
  if (!config.revantApiKey) throw Error("Revant Pay não configurado");
  const response = await fetch(REVANT_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${config.revantApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error("Provedor de pagamento indisponível");
  return data;
}

// Webhook Revant Pay: header X-Revantpay-Signature: t=<unix>,v1=<hex hmac-sha256>
// A assinatura é calculada sobre "<timestamp>.<corpo bruto>".
export function parseRevantSignature(header) {
  const match = String(header || "").match(/^t=(\d+),v1=([a-f0-9]{64})$/i);
  return match
    ? { timestamp: match[1], signature: match[2].toLowerCase() }
    : null;
}
