import { sql } from "./turso.js";
import { seal, unseal } from "./security.js";
export async function settings(env) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) return {};
  const result = await sql(env, "SELECT value FROM settings WHERE key='store'");
  return result.rows.length ? unseal(env, result.rows[0][0].value) : {};
}
export async function saveSettings(env, value) {
  await sql(
    env,
    "INSERT INTO settings(key,value) VALUES('store',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [await seal(env, value)],
  );
}
export const secretFields = [
  "smmKey",
  "resendKey",
  "uvviClientId",
  "uvviClientSecret",
  "webhookSecret",
];
export function publicSettings(value) {
  const safe = { ...value };
  for (const key of secretFields) {
    safe[key] = "";
    safe[key + "Configured"] = Boolean(value[key]);
  }
  return safe;
}
