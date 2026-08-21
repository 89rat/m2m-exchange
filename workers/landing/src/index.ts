import { Hono } from "hono";
import { landingHtml, llmsTxt, x402Manifest } from "./page";

/**
 * code402.dev root worker: the human landing page plus the machine surfaces
 * every x402-native crawler expects at a domain root. No bindings, no state —
 * everything dynamic (live service count, gateway health) is fetched
 * client-side from gateway.code402.dev so this worker stays trivially cheap.
 */
const app = new Hono();

const CACHE = "public, max-age=300";

app.get("/", (c) => {
  c.header("cache-control", CACHE);
  return c.html(landingHtml());
});

app.get("/healthz", (c) => c.json({ status: "ok", service: "code402-landing" }));

app.get("/llms.txt", (c) => {
  c.header("cache-control", CACHE);
  return c.text(llmsTxt());
});

app.get("/.well-known/x402.json", (c) => {
  c.header("cache-control", CACHE);
  return c.json(x402Manifest());
});

// Agent card (A2A /.well-known/agent.json convention): one document that tells
// any autonomous agent what this estate is, what it can do, and where to pay.
app.get("/.well-known/agent.json", (c) => {
  c.header("cache-control", CACHE);
  return c.json({
    name: "code402",
    description:
      "Open M2M/1 commerce layer on x402 (HTTP 402): machine-payable API catalog, probe-verified trust index, seller registration, settlement receipts. Non-custodial USDC on Base.",
    url: "https://code402.dev",
    provider: { organization: "JUANA LIMITED", url: "https://code402.dev" },
    version: "1.0.0",
    protocols: ["x402", "m2m/1", "mcp"],
    capabilities: {
      discovery: "https://atlas.code402.dev",
      catalog: "https://gateway.code402.dev/v1/services",
      registerSeller: "https://gateway.code402.dev/v1/sellers",
      mcp: "https://mcp.code402.dev/mcp",
      trust: "https://code402.dev/trust",
      openapi: "https://gateway.code402.dev/openapi.json",
    },
    payment: { schemes: ["exact"], asset: "USDC", networks: ["base-sepolia", "base"] },
    contact: "hello@code402.dev",
  });
});

app.get("/robots.txt", (c) =>
  c.text(["User-agent: *", "Allow: /", "", "Sitemap: https://code402.dev/sitemap.xml"].join("\n")),
);

app.get("/sitemap.xml", (c) => {
  const urls = ["https://code402.dev/", "https://code402.dev/llms.txt"];
  c.header("content-type", "application/xml");
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
      `\n</urlset>\n`,
  );
});

// Legacy surfaces preserved across the go-live flip: /trust, /docs, /pricing
// and the root-level /x402.json stay served by the previous production worker
// (code402-edge-prod) via its workers.dev subdomain, so existing badge links,
// citations, and the daily-updated trust record never 404. Port these natively
// once the trust surface is rebuilt on the new stack.
const LEGACY = "https://code402-edge-prod.akrivis.workers.dev";
const LEGACY_PATHS = ["/trust", "/docs", "/pricing", "/x402.json"];

for (const p of LEGACY_PATHS) {
  const proxy = (c: any) => {
    const url = new URL(c.req.url);
    return fetch(LEGACY + url.pathname + url.search, c.req.raw as any);
  };
  app.all(p, proxy);
  app.all(`${p}/*`, proxy);
}

// Convenience redirects so short human links work from talks/posts.
app.get("/sell", (c) => c.redirect("https://gateway.code402.dev/v1/sellers", 302));
app.get("/directory", (c) => c.redirect("https://atlas.code402.dev", 302));
app.get("/github", (c) => c.redirect("https://github.com/89rat/m2m-exchange", 302));

export default app;
