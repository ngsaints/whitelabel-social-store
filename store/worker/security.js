const enc = new TextEncoder(),
  dec = new TextDecoder();
export const hex = (b) =>
  Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export async function digest(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}
export async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
export function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function aes(env) {
  if (!env.APP_ENCRYPTION_KEY || env.APP_ENCRYPTION_KEY.length < 32)
    throw Error(
      "Configure uma chave de criptografia com pelo menos 32 caracteres.",
    );
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", enc.encode(env.APP_ENCRYPTION_KEY)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aes(env),
    enc.encode(JSON.stringify(value)),
  );
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)));
}
export async function unseal(env, value) {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return JSON.parse(
    dec.decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, 12) },
        await aes(env),
        bytes.slice(12),
      ),
    ),
  );
}
export async function cookie(env, email, request) {
  const payload = btoa(
    JSON.stringify({ email, exp: Date.now() + 8 * 3600000 }),
  );
  const signature = await hmac(env.APP_ENCRYPTION_KEY, payload);
  return (
    "store_admin=" +
    payload +
    "." +
    signature +
    "; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800" +
    (new URL(request.url).protocol === "https:" ? "; Secure" : "")
  );
}
export async function session(request, env) {
  try {
    const token = request.headers
      .get("cookie")
      ?.match(/(?:^|; )store_admin=([^;]+)/)?.[1];
    if (!token || !env.APP_ENCRYPTION_KEY) return null;
    const [payload, signature] = token.split(".");
    if (!equal(await hmac(env.APP_ENCRYPTION_KEY, payload), signature))
      return null;
    const data = JSON.parse(atob(payload));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
