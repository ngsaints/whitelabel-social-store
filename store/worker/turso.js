export async function sql(env, statement, args = []) {
  const endpoint = new URL(
    env.TURSO_DATABASE_URL.replace(/^libsql:/, "https:"),
  );
  if (endpoint.protocol !== "https:") throw Error("Turso requer HTTPS");
  endpoint.pathname = "/v2/pipeline";
  endpoint.search = "";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.TURSO_AUTH_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: {
            sql: statement,
            args: args.map((value) => ({ type: "text", value: String(value) })),
            want_rows: true,
          },
        },
        { type: "close" },
      ],
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || data.results?.[0]?.type !== "ok")
    throw Error("Turso indisponível");
  return data.results[0].response.result;
}
export async function selectionApi(request, env) {
  const reply = (data, status = 200) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN)
    return reply({ enabled: false });
  if (!["GET", "PUT"].includes(request.method))
    return reply({ error: "Método inválido" }, 405);
  if (
    request.method === "PUT" &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return reply({ error: "Origem inválida" }, 403);
  const token = (request.headers.get("authorization") || "").replace(
    /^Bearer /,
    "",
  );
  if (!/^[a-f0-9-]{36}$/.test(token))
    return reply({ error: "Sessão inválida" }, 401);
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  try {
    if (request.method === "GET") {
      const data = await sql(
        env,
        "SELECT payload FROM selections WHERE session_hash = ?",
        [hash],
      );
      return reply({
        enabled: true,
        items: data.rows.length ? JSON.parse(data.rows[0][0].value) : [],
      });
    }
    const text = await request.text();
    if (text.length > 20000)
      return reply({ error: "Seleção muito grande" }, 413);
    const items = JSON.parse(text);
    if (
      !Array.isArray(items) ||
      items.length > 30 ||
      items.some(
        (s) =>
          typeof s.name !== "string" ||
          s.name.length > 500 ||
          typeof s.link !== "string" ||
          s.link.length > 2048 ||
          !Number.isInteger(s.quantity) ||
          s.quantity < 1 ||
          !Number.isFinite(s.total),
      )
    )
      return reply({ error: "Seleção inválida" }, 400);
    await sql(
      env,
      "INSERT INTO selections(session_hash,payload,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(session_hash) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
      [hash, JSON.stringify(items)],
    );
    return reply({ enabled: true });
  } catch {
    return reply({ error: "Não foi possível sincronizar a seleção." }, 503);
  }
}
