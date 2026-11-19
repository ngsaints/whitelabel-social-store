import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { schema } from "../worker/schema.js";
import { rateLimit } from "../worker/limits.js";
import { catalog } from "../worker/catalog.js";
import app from "../worker/index.js";

const env = {
  TURSO_DATABASE_URL: "libsql://limits.turso.io",
  TURSO_AUTH_TOKEN: "test",
};
function mockTurso(db, extra = async () => null) {
  return async (url, options = {}) => {
    const u = String(url);
    if (!u.includes("limits.turso.io")) return extra(u, options);
    const stmt = JSON.parse(options.body).requests[0].stmt;
    const prepared = db.prepare(stmt.sql);
    const columns = prepared.columns();
    const args = stmt.args.map((v) => v.value);
    const rows = columns.length ? prepared.all(...args) : [];
    if (!columns.length) prepared.run(...args);
    return Response.json({
      results: [
        {
          type: "ok",
          response: {
            result: {
              cols: columns.map((c) => ({ name: c.name })),
              rows: rows.map((r) =>
                columns.map((c) => ({ type: "text", value: String(r[c.name]) })),
              ),
            },
          },
        },
      ],
    });
  };
}

test("limite por janela conta por chave e reinicia ao expirar", async () => {
  const db = new DatabaseSync(":memory:");
  schema.forEach((s) => db.exec(s));
  const original = globalThis.fetch;
  globalThis.fetch = mockTurso(db);
  try {
    for (let i = 0; i < 3; i++)
      assert.equal(await rateLimit(env, "t", "1.1.1.1", 3, 60000), true);
    assert.equal(await rateLimit(env, "t", "1.1.1.1", 3, 60000), false);
    assert.equal(await rateLimit(env, "t", "2.2.2.2", 3, 60000), true);
    assert.equal(await rateLimit(env, "other", "1.1.1.1", 3, 60000), true);
    for (let i = 0; i < 2; i++) await rateLimit(env, "short", "ip", 1, 30);
    assert.equal(await rateLimit(env, "short", "ip", 1, 30), false);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await rateLimit(env, "short", "ip", 1, 30), true);
    assert.ok(
      !JSON.stringify(db.prepare("SELECT bucket FROM rate_limits").all()).includes(
        "1.1.1.1",
      ),
      "IP não fica salvo em texto puro",
    );
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test("seleção bloqueia excesso de gravações do mesmo IP", async () => {
  const db = new DatabaseSync(":memory:");
  schema.forEach((s) => db.exec(s));
  const original = globalThis.fetch;
  globalThis.fetch = mockTurso(db);
  const put = (ip) =>
    app.fetch(
      new Request("https://store.test/api/selection", {
        method: "PUT",
        headers: {
          origin: "https://store.test",
          authorization: "Bearer " + crypto.randomUUID(),
          "cf-connecting-ip": ip,
        },
        body: "[]",
      }),
      env,
    );
  try {
    for (let i = 0; i < 60; i++) assert.equal((await put("9.9.9.9")).status, 200);
    assert.equal((await put("9.9.9.9")).status, 429);
    assert.equal((await put("8.8.8.8")).status, 200);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test("catálogo usa cache do provedor e aplica preço atual", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json([
      { service: 7, name: "X", type: "Default", rate: "10", min: 1, max: 10 },
    ]);
  };
  try {
    const first = await catalog({ smmKey: "cache-key", markup: 0 });
    const second = await catalog({ smmKey: "cache-key", markup: 50 });
    assert.equal(calls, 1);
    assert.equal(first[0].rate, "10.00");
    assert.equal(second[0].rate, "15.00");
    assert.deepEqual(
      await catalog({ smmKey: "cache-key", hiddenServices: "7" }),
      [],
    );
    await catalog({ smmKey: "another-key" });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
