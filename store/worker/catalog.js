// Raw provider catalog per API key; pricing and hidden services are applied
// on every call so admin changes take effect immediately.
const catalogCache = new Map();
const catalogTtl = 60000;
async function providerServices(smmKey) {
  const cached = catalogCache.get(smmKey);
  if (cached && cached.expires > Date.now()) return cached.pending;
  const pending = (async () => {
    const res = await fetch("https://smmhype.com/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: smmKey, action: "services" }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data)) throw Error("Catálogo indisponível");
    return data;
  })();
  catalogCache.clear();
  catalogCache.set(smmKey, { pending, expires: Date.now() + catalogTtl });
  pending.catch(() => {
    if (catalogCache.get(smmKey)?.pending === pending)
      catalogCache.delete(smmKey);
  });
  return pending;
}
export async function catalog(config) {
  const data = await providerServices(config.smmKey);
  const hidden = new Set(
    String(config.hiddenServices || "")
      .split(",")
      .map((x) => x.trim()),
  );
  return data
    .filter(
      (s) =>
        s.type === "Default" &&
        !hidden.has(String(s.service)) &&
        Number.isFinite(Number(s.rate)) &&
        Number(s.rate) > 0,
    )
    .map((s) => ({
      ...s,
      rate: (
        Math.ceil(
          Number(s.rate) *
            Number(config.exchangeRate || 1) *
            (1 + Number(config.markup || 0) / 100) *
            100,
        ) / 100
      ).toFixed(2),
    }));
}
