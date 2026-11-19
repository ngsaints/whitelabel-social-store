import { sql } from "./turso.js";
import { digest } from "./security.js";
export const rateLimitTable =
  "CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL)";
let rateLimitReady = null;
// Cloudflare sets CF-Connecting-IP itself; the Node server overwrites it from the socket.
export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}
// Fixed-window counter stored in Turso so it holds across instances.
export async function rateLimit(env, name, key, max, windowMs) {
  rateLimitReady ??= sql(env, rateLimitTable).catch((error) => {
    rateLimitReady = null;
    throw error;
  });
  await rateLimitReady;
  const now = Date.now();
  const result = await sql(
    env,
    "INSERT INTO rate_limits(bucket,count,reset_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN CAST(rate_limits.reset_at AS INTEGER)<=? THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN CAST(rate_limits.reset_at AS INTEGER)<=? THEN excluded.reset_at ELSE rate_limits.reset_at END RETURNING count",
    [name + ":" + (await digest(String(key))), now + windowMs, now, now],
  );
  if (Math.random() < 0.02)
    await sql(
      env,
      "DELETE FROM rate_limits WHERE CAST(reset_at AS INTEGER)<?",
      [now],
    ).catch(() => {});
  return Number(result.rows[0][0].value) <= max;
}
export const tooMany = (headers = {}) =>
  Response.json(
    { error: "Muitas tentativas. Aguarde alguns minutos." },
    { status: 429, headers: { "Cache-Control": "no-store", ...headers } },
  );
