const REVANT_BASE = "https://api.revantpay.com";

export async function revant(config, path, method = "GET", body) {
  if (!config.revantApiKey) throw Error("Revant Pay não configurado");
  const response = await fetch(REVANT_BASE + "/v1" + path, {
    method,
    headers: {
      "x-api-key": config.revantApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error("Provedor de pagamento indisponível");
  return data;
}
