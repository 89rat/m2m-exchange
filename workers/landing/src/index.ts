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

// Convenience redirects so short human links work from talks/posts.
app.get("/sell", (c) => c.redirect("https://gateway.code402.dev/v1/sellers", 302));
app.get("/directory", (c) => c.redirect("https://atlas.code402.dev", 302));
app.get("/github", (c) => c.redirect("https://github.com/89rat/m2m-exchange", 302));

export default app;
