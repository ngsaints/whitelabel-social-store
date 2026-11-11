export async function catalog(config) {
  const res = await fetch("https://smmhype.com/api/v2", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: config.smmKey, action: "services" }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok || !Array.isArray(data)) throw Error("Catálogo indisponível");
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
