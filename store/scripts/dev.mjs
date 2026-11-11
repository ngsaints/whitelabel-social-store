import http from "node:http";
import app from "../worker/index.js";
const port = Number(process.env.PORT || 4173),
  origin = process.env.APP_URL || "http://localhost:" + port;
const server = http.createServer(async (req, res) => {
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 60000) {
        res.writeHead(413);
        res.end();
        return;
      }
    }
    const response = await app.fetch(
      new Request(origin + req.url, {
        method: req.method,
        headers: req.headers,
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
