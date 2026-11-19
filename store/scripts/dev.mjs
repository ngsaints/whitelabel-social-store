import http from "node:http";
import app from "../worker/index.js";
const port = Number(process.env.PORT || 4173),
  origin = process.env.APP_URL || "http://localhost:" + port;
const server = http.createServer(async (req, res) => {
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 240000) {
        res.writeHead(413);
        res.end();
        return;
      }
    }
    // Never trust a client-sent IP header; derive it from the socket or, behind
    // a reverse proxy (TRUST_PROXY=1), from the entry the proxy appended last.
    const headers = { ...req.headers };
    delete headers["cf-connecting-ip"];
    const forwarded = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean);
    headers["cf-connecting-ip"] =
      (process.env.TRUST_PROXY === "1" && forwarded.at(-1)) ||
      req.socket.remoteAddress ||
      "unknown";
    const response = await app.fetch(
      new Request(origin + req.url, {
        method: req.method,
        headers,
        ...(!["GET", "HEAD"].includes(req.method) ? { body } : {}),
      }),
      process.env,
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch {
    res.writeHead(500);
    res.end("Erro interno");
  }
});
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log("Local: " + origin),
);
