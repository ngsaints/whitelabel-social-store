import { sql } from "./turso.js";
import {
  settings,
  saveSettings,
  publicSettings,
  secretFields,
} from "./settings.js";
import { digest, hmac, equal, cookie, session, seal } from "./security.js";
const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export async function adminApi(request, env) {
  const path = new URL(request.url).pathname;
  if (
    !env.TURSO_DATABASE_URL ||
    !env.TURSO_AUTH_TOKEN ||
    !env.APP_ENCRYPTION_KEY
  )
    return json(
      {
        error:
          "Execute a instalação e configure Turso e APP_ENCRYPTION_KEY no .env.",
      },
      503,
    );
  if (
    request.method !== "GET" &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return json({ error: "Origem inválida." }, 403);
  try {
    const config = await settings(env);
    if (path === "/api/admin/session")
      return json({
        authenticated: Boolean(await session(request, env)),
        setup: !config.initialized,
      });
    if (path === "/api/admin/setup" && request.method === "POST") {
      if (config.initialized)
        return json({ error: "Instalação já concluída." }, 409);
      const body = await request.json();
      if (
        !env.SETUP_TOKEN ||
        env.SETUP_TOKEN.length < 32 ||
        !equal(
          await digest(String(body.token || "")),
          await digest(env.SETUP_TOKEN),
        )
      )
        return json({ error: "Token de instalação inválido." }, 401);
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return json({ error: "Informe um e-mail válido." }, 400);
      const initial = {
        initialized: true,
        adminEmail: email,
        name: "aura",
        accent: "#78b9df",
        markup: 50,
        exchangeRate: 1,
        currency: "USD",
        uvviEnvironment: "staging",
        salesEnabled: false,
        webhookSecret: crypto.randomUUID() + crypto.randomUUID(),
      };
      const claim = await sql(
        env,
        "INSERT OR IGNORE INTO settings(key,value) VALUES('store',?) RETURNING key",
        [await seal(env, initial)],
      );
      if (!claim.rows.length)
        return json({ error: "Instalação já concluída." }, 409);
      return json({ ok: true }, 200, {
        "Set-Cookie": await cookie(env, email, request),
      });
    }
    if (path === "/api/admin/otp/send" && request.method === "POST") {
      const { email } = await request.json();
      if (
        String(email || "")
          .trim()
          .toLowerCase() !== config.adminEmail
      )
        return json({ error: "E-mail não autorizado." }, 403);
      if (!config.resendKey || !config.resendFrom)
        return json(
          { error: "Configure Resend e remetente no primeiro acesso." },
          503,
        );
      const now = Date.now();
      const random = new Uint32Array(1);
      let n;
      do {
        crypto.getRandomValues(random);
        n = random[0];
      } while (n >= 4294000000);
      const code = String(n % 1000000).padStart(6, "0");
      const challenge = crypto.randomUUID();
      const hash = await hmac(env.APP_ENCRYPTION_KEY, challenge + ":" + code);
      const claim = await sql(
        env,
        "INSERT INTO otp(email,challenge,hash,expires,attempts,sent_at) VALUES(?,?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET challenge=excluded.challenge,hash=excluded.hash,expires=excluded.expires,attempts=0,sent_at=excluded.sent_at WHERE CAST(otp.sent_at AS INTEGER) < ? RETURNING email",
        [config.adminEmail, challenge, hash, now + 600000, now, now - 60000],
      );
      if (!claim.rows.length)
        return json({ error: "Aguarde 60 segundos para reenviar." }, 429);
      const sent = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.resendKey,
          "Content-Type": "application/json",
          "Idempotency-Key": challenge,
        },
        body: JSON.stringify({
          from: config.resendFrom,
          to: [config.adminEmail],
          subject: "Seu código de acesso à loja",
          text:
            "Seu código é " +
            code +
            ". Válido por 10 minutos. Não compartilhe este código.",
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!sent.ok)
        return json(
          {
            error:
              "Não foi possível enviar. Confira a chave e o domínio verificado no Resend.",
          },
          502,
        );
      return json({ ok: true });
    }
    if (path === "/api/admin/otp/verify" && request.method === "POST") {
      const body = await request.json();
      if (
        String(body.email || "")
          .trim()
          .toLowerCase() !== config.adminEmail
      )
        return json({ error: "Código inválido." }, 401);
      if (!/^\d{6}$/.test(String(body.code || "")))
        return json({ error: "Código deve ter seis dígitos." }, 400);
      const attempt = await sql(
        env,
        "UPDATE otp SET attempts=attempts+1 WHERE email=? AND CAST(expires AS INTEGER)>? AND attempts<5 RETURNING challenge,hash",
        [
          String(body.email || "")
            .trim()
            .toLowerCase(),
          Date.now(),
        ],
      );
      if (!attempt.rows.length)
        return json(
          { error: "Código expirado ou limite de tentativas atingido." },
          401,
        );
      const [challenge, stored] = attempt.rows[0].map((v) => v.value);
      const hash = await hmac(
        env.APP_ENCRYPTION_KEY,
        challenge + ":" + body.code,
      );
      if (!equal(hash, stored))
        return json({ error: "Código incorreto." }, 401);
      const used = await sql(
        env,
        "DELETE FROM otp WHERE email=? AND challenge=? AND hash=? RETURNING email",
        [config.adminEmail, challenge, hash],
      );
      if (!used.rows.length)
        return json({ error: "Código já utilizado." }, 401);
      return json({ ok: true }, 200, {
        "Set-Cookie": await cookie(env, config.adminEmail, request),
      });
    }
    const auth = await session(request, env);
    if (!auth || auth.email !== config.adminEmail)
      return json({ error: "Faça login para continuar." }, 401);
    if (path === "/api/admin/logout" && request.method === "POST")
      return json({ ok: true }, 200, {
        "Set-Cookie":
          "store_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      });
    if (path === "/api/admin/settings" && request.method === "GET")
      return json(publicSettings(config));
    if (path === "/api/admin/settings" && request.method === "PUT") {
      const b = await request.json();
      const next = { ...config };
      if (b.logoData !== undefined) {
        if (
          typeof b.logoData !== "string" ||
          b.logoData.length > 200000 ||
          (b.logoData &&
            !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
              b.logoData,
            ))
        )
          return json({ error: "Logo inválido. Use PNG, JPG ou WebP." }, 400);
        next.logoData = b.logoData;
      }
      for (const k of [
        "name",
        "tagline",
        "accent",
        "resendFrom",
        "currency",
        "hiddenServices",
      ])
        if (typeof b[k] === "string" && b[k].length <= 2000) next[k] = b[k];
      for (const k of secretFields)
        if (typeof b[k] === "string" && b[k].trim() && b[k].length <= 4096)
          next[k] = b[k].trim();
      if (
        !/^#[a-f0-9]{6}$/i.test(next.accent) ||
        !["USD", "BRL", "EUR"].includes(next.currency)
      )
        return json({ error: "Cor ou moeda inválida." }, 400);
      for (const k of ["markup", "exchangeRate"]) {
        if (b[k] !== undefined) {
          const n = Number(b[k]);
          if (
            !Number.isFinite(n) ||
            n < 0 ||
            n > 10000 ||
            (k === "exchangeRate" && n === 0)
          )
            return json({ error: "Margem ou câmbio inválido." }, 400);
          next[k] = n;
        }
      }
      if (["staging", "production"].includes(b.uvviEnvironment))
        next.uvviEnvironment = b.uvviEnvironment;
      const financialChanged = [
        "uvviClientId",
        "uvviClientSecret",
        "uvviEnvironment",
        "smmKey",
        "webhookSecret",
      ].some((k) => next[k] !== config[k]);
      if (financialChanged) {
        const existing = await sql(env, "SELECT COUNT(*) FROM orders");
        if (Number(existing.rows[0][0].value) > 0)
          return json(
            {
              error:
                "Há pedidos vinculados às credenciais atuais. A troca exige migração assistida.",
            },
            409,
          );
        next.webhookRegistered = false;
        next.salesEnabled = false;
      }
      if (typeof b.salesEnabled === "boolean")
        next.salesEnabled = b.salesEnabled;
      if (
        next.salesEnabled &&
        (!next.smmKey ||
          !next.uvviClientId ||
          !next.uvviClientSecret ||
          !next.webhookRegistered)
      )
        return json(
          { error: "Configure e registre o webhook antes de abrir vendas." },
          400,
        );
      await saveSettings(env, next);
      return json({ ok: true });
    }
    if (path === "/api/admin/orders" && request.method === "GET") {
      const data = await sql(
        env,
        "SELECT id,service_name,quantity,amount,status,provider_order,created_at FROM orders ORDER BY created_at DESC LIMIT 100",
      );
      return json({
        orders: data.rows.map((row) =>
          Object.fromEntries(data.cols.map((c, i) => [c.name, row[i].value])),
        ),
      });
    }
    return json({ error: "Rota não encontrada." }, 404);
  } catch {
    return json(
      {
        error:
          "Operação indisponível. Confira a instalação do banco e as configurações.",
      },
      503,
    );
  }
}
