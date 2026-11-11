import { paymentMethods } from "./gateways.js";
import { page } from "./page.js";
import { selectionApi } from "./turso.js";
import { adminApi } from "./admin.js";
import { adminPage } from "./admin-page.js";
import { settings } from "./settings.js";
import { catalog } from "./catalog.js";
import { paymentApi } from "./payments.js";
import { checkoutHtml } from "./checkout-page.js";
import { heroArt, visualCss } from "./visuals.js";
import { languageHtml } from "./i18n.js";
export const demo = [
  [1, "Seguidores para Instagram", "Instagram", "8.90", 100, 10000, true],
  [2, "Curtidas para Instagram", "Instagram", "3.50", 50, 20000, false],
  [3, "Visualizações para Reels", "Instagram", "1.20", 100, 100000, false],
  [4, "Seguidores para TikTok", "TikTok", "12.90", 100, 10000, true],
  [5, "Visualizações para TikTok", "TikTok", "0.90", 1000, 100000, false],
  [6, "Visualizações para YouTube", "YouTube", "18.50", 100, 50000, false],
].map(([service, name, category, rate, min, max, refill]) => ({
  service,
  name,
  category,
  rate,
  min,
  max,
  refill,
  type: "Default",
}));
export default {
  async fetch(request, env = {}) {
    const path = new URL(request.url).pathname;
    if (path === "/admin")
      return new Response(
        adminPage.replace("</body>", languageHtml + "</body>"),
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
            "Content-Security-Policy":
              "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'",
          },
        },
      );
    if (
      path === "/api/admin/webhook" ||
      path === "/api/admin/stripe/webhook" ||
      path === "/api/webhooks/stripe" ||
      path === "/api/webhooks/uvvipay" ||
      path === "/api/checkout" ||
      path.startsWith("/api/orders/")
    )
      return paymentApi(request, env);
    if (path.startsWith("/api/admin/")) return adminApi(request, env);
    if (path === "/api/selection") return selectionApi(request, env);
    let configDb = {};
    try {
      configDb = await settings(env);
    } catch {
      if (env.TURSO_AUTH_TOKEN)
        return Response.json(
          { error: "Configuração indisponível." },
          { status: 503 },
        );
    }
    if (path === "/api/services" && request.method === "GET") {
      if (configDb.smmKey) {
        try {
          return Response.json(
            {
              demo: false,
              currency: "BRL",
              salesEnabled: Boolean(configDb.salesEnabled),
              paymentMethods: configDb.salesEnabled
                ? paymentMethods(configDb)
                : [],
              services: await catalog(configDb),
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            { error: "Catálogo indisponível." },
            { status: 502 },
          );
        }
      }
      if (!env.SMM_API_KEY)
        return Response.json({ demo: true, currency: "USD", services: demo });
      try {
        const res = await fetch("https://smmhype.com/api/v2", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            key: env.SMM_API_KEY,
            action: "services",
          }),
          signal: AbortSignal.timeout(15000),
        });
        const services = await res.json();
        if (!res.ok || !Array.isArray(services)) throw Error();
        return Response.json(
          { demo: false, currency: env.SMM_CURRENCY || "USD", services },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch {
        return Response.json(
          { error: "Catálogo temporariamente indisponível." },
          { status: 502 },
        );
      }
    }
    if (path !== "/") return new Response("Not found", { status: 404 });
    const config = JSON.stringify({
      name: configDb.name || env.STORE_NAME || "aura",
      logoData: configDb.logoData || "",
      accent: /^#[a-f0-9]{6}$/i.test(configDb.accent || env.STORE_ACCENT || "")
        ? configDb.accent || env.STORE_ACCENT
        : "#78b9df",
      tagline:
        configDb.tagline ||
        env.STORE_TAGLINE ||
        "Uma nova perspectiva para sua presença digital.",
    }).replace(/</g, "\\u003c");
    return new Response(
      page
        .replace("/* STORE_CONFIG */", config)
        .replace("</head>", visualCss + "</head>")
        .replace(
          /<div class="art"[\s\S]*?<\/div><\/div><\/section>/,
          heroArt + "</section>",
        )
        .replace(
          "O próximo capítulo<br>da sua presença",
          "Seu próximo passo<br>nas redes sociais",
        )
        .replace("</body>", checkoutHtml + languageHtml + "</body>"),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'",
        },
      },
    );
  },
};
