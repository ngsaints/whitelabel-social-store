// Local UI preview only. Isolated, in-memory data; no external provider calls.
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import app from "../worker/index.js";
import { schema } from "../worker/schema.js";
import { saveSettings } from "../worker/settings.js";
import { cookie } from "../worker/security.js";
const db = new DatabaseSync(":memory:");
schema.forEach((s) => db.exec(s));
const env = {
  TURSO_DATABASE_URL: "libsql://preview.invalid",
  TURSO_AUTH_TOKEN: "local-preview-only",
  APP_ENCRYPTION_KEY: "local-preview-only-no-production-secrets-00000000",
};
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith("https://preview.invalid/"))
    throw Error("External network disabled in preview");
  const statement = JSON.parse(options.body).requests[0].stmt,
    query = db.prepare(statement.sql),
    cols = query.columns(),
    args = statement.args.map((v) => v.value);
  const rows = cols.length ? query.all(...args) : (query.run(...args), []);
  return Response.json({
    results: [
      {
        type: "ok",
        response: {
          result: {
            cols: cols.map((c) => ({ name: c.name })),
            rows: rows.map((r) =>
              cols.map((c) => ({
                type: r[c.name] === null ? "null" : "text",
                value: r[c.name] === null ? null : String(r[c.name]),
              })),
            ),
          },
        },
      },
    ],
  });
};
await saveSettings(env, {
  initialized: true,
  adminEmail: "demo@example.com",
  name: "aura",
  accent: "#78b9df",
  tagline: "Uma nova perspectiva para sua presença digital.",
  markup: 50,
  exchangeRate: 5,
  currency: "USD",
  uvviEnvironment: "staging",
  salesEnabled: false,
});
http
  .createServer(async (req, res) => {
    try {
      const origin = "http://localhost:4174";
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 240000) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      const authCookie = await cookie(
        env,
        "demo@example.com",
        new Request(origin),
      );
      const request = new Request(origin + req.url, {
        method: req.method,
        headers: { ...req.headers, cookie: authCookie },
        ...(!["GET", "HEAD"].includes(req.method) ? { body } : {}),
      });
      const response = await app.fetch(request, env);
      let text = await response.text();
      if (response.headers.get("content-type")?.includes("text/html"))
        text = text.replace(
          "<body>",
          '<body><div style="padding:10px;text-align:center;background:#fff1d8;color:#715025;font:13px Segoe UI,sans-serif">DEMO LOCAL · Dados temporários · Pagamentos e integrações externas desativados</div>',
        );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(text);
    } catch {
      res.writeHead(500);
      res.end("Local preview error");
    }
  })
  .listen(4174, "127.0.0.1", () =>
    console.log(
      "Admin demo: http://localhost:4174/admin (temporary local data only)",
    ),
  );
