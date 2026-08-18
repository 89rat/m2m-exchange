import { Hono } from "hono";
import type { Address } from "viem";
import { paymentMiddleware } from "x402-hono";
import { M2M_VERSION } from "@m2m/protocol";
import type { ServiceDescriptor, ServiceList } from "@m2m/protocol";
import { registryApp, dynamicServiceDescriptors, createSellerProxy } from "./registry";
import { prepaidApp, createPrepaidDebitMiddleware, creditAccount } from "./prepaid";
import { resolveNetwork, resolveFacilitator, usdcAddress, type NetworkBindings } from "./network";

/**
 * Environment bindings for the gateway worker.
 * SELLER_WALLET_ADDRESS comes from .dev.vars locally / vars in wrangler.toml.
 */
export interface Bindings extends NetworkBindings {
  /** EVM address that receives USDC payments (the "seller" wallet). */
  SELLER_WALLET_ADDRESS: string;
  /** Multi-tenant registry (sellers, listings, receipts). */
  REGISTRY: D1Database;
}

const PRICE_BASIC = "$0.001";
const PRICE_PREMIUM = "$0.005";

/** USDC base-unit amounts (6 decimals) as integer strings (M2M/1 §2.3). */
const PRICE_BASE_UNITS = "1000";
const PRICE_PREMIUM_BASE_UNITS = "5000";

/**
 * M2M/1 §6.1 ServiceDescriptors. Static pricing (§4.2) — these services skip
 * quote/order and use the plain x402 402 flow (§6.3). Quote/order endpoints
 * land in P1.5 with D1 persistence.
 */
function serviceDescriptors(env: Bindings): ServiceDescriptor[] {
  const network = resolveNetwork(env);
  const usdc = usdcAddress(network);
  const staticPrice = { amount: PRICE_BASE_UNITS, asset: usdc, network };
  const premiumPrice = { amount: PRICE_PREMIUM_BASE_UNITS, asset: usdc, network };
  // Premium tier: $0.005 = 5000 USDC base units (integer string, M2M/1 §2.3).
  return [
    {
      m2mVersion: M2M_VERSION,
      serviceId: "weather",
      name: "Weather reading",
      description: "Current conditions snapshot (demo smoke test).",
      endpoint: "/api/weather",
      method: "GET",
      pricing: { mode: "static", price: staticPrice },
    },
    {
      m2mVersion: M2M_VERSION,
      serviceId: "echo",
      name: "Echo",
      description: "Echoes the paid request body back (integration smoke test).",
      endpoint: "/api/echo",
      method: "POST",
      pricing: { mode: "static", price: staticPrice },
    },
    {
      m2mVersion: M2M_VERSION,
      serviceId: "x402-probe",
      name: "x402 endpoint prober",
      description:
        "Probes any https URL for a valid x402 402 paywall and returns normalized price/network/payTo terms. Built for agents that need to verify a payable endpoint before budgeting.",
      endpoint: "/api/x402-probe",
      method: "POST",
      pricing: { mode: "static", price: premiumPrice },
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", format: "uri" } },
        required: ["url"],
      },
    },
    {
      m2mVersion: M2M_VERSION,
      serviceId: "vat-mod97",
      name: "VAT number check (MOD-97)",
      description:
        "Deterministic ISO 7064 MOD-97-10 checksum validation of European VAT numbers. Machine-verifiable, no external calls.",
      endpoint: "/api/vat-check",
      method: "POST",
      pricing: { mode: "static", price: premiumPrice },
      inputSchema: {
        type: "object",
        properties: { vat_number: { type: "string" } },
        required: ["vat_number"],
      },
    },
    {
      m2mVersion: M2M_VERSION,
      serviceId: "forecast",
      name: "5-day forecast (premium tier)",
      description:
        "Premium-priced demo service ($0.005) proving tiered pricing on the same rail.",
      endpoint: "/api/forecast",
      method: "GET",
      pricing: { mode: "static", price: premiumPrice },
    },
  ];
}

export function createApp(env: Bindings) {
  const app = new Hono<{ Bindings: Bindings }>();
  const network = resolveNetwork(env);
  const facilitator = resolveFacilitator(env);

  // IndexNow key file + ping endpoint.
  app.get("/gatew2e061f0cc950fd261c3783209b1b913a.txt", (c) => c.text("gatew2e061f0cc950fd261c3783209b1b913a\n"));
  app.get("/admin/indexnow", async (c) => {
    const urls = ["https://gateway.code402.dev/", "https://gateway.code402.dev/v1/services", "https://gateway.code402.dev/llms.txt"];
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "gateway.code402.dev", key: "gatew2e061f0cc950fd261c3783209b1b913a", keyLocation: "https://gateway.code402.dev/gatew2e061f0cc950fd261c3783209b1b913a.txt", urlList: urls }),
    });
    return c.json({ pinged: urls.length, indexnow_status: res.status });
  });

  // Free route — no payment required.
  app.get("/healthz", (c) =>
    c.json({ status: "ok", service: "m2m-gateway", network }),
  );

  // M2M/1 §6.1 discovery: machine-readable storefront (free).
  app.get("/v1/services", async (c) => {
    const dynamic = await dynamicServiceDescriptors(env).catch(() => []);
    const body: ServiceList = { m2mVersion: M2M_VERSION, services: [...serviceDescriptors(env), ...dynamic] };
    return c.json(body);
  });

  // Multi-tenant: seller onboarding + dynamic per-seller payTo routes.
  app.route("/", registryApp(env));
  app.route("/", prepaidApp(env));
  app.all("/s/:sellerId/:serviceId", createSellerProxy(env));

  // Self-manifest so x402-native crawlers (incl. Coinbase Bazaar) find us.
  app.get("/.well-known/x402.json", (c) =>
    c.json({
      name: "m2m-exchange gateway",
      description: "Open M2M/1 commerce protocol gateway: sell any API to AI agents, per-call x402 USDC, non-custodial, prepaid credits, multi-tenant marketplace.",
      services: "/v1/services",
      sellers_api: "/v1/sellers",
      protocol: "M2M/1 + M2M/1.1 rails",
      discovery_index: "https://atlas.code402.dev",
      directory: "https://atlas.code402.dev/directory.md",
      settlement_layer: "https://code402.dev",
    }),
  );

  // LLM/crawler-readable index (free).
  app.get("/llms.txt", (c) => {
    const svcs = serviceDescriptors(env);
    const lines = [
      "# m2m-exchange gateway",
      "> Machine-payable APIs on x402 (USDC, Base Sepolia). M2M/1 protocol; discovery at GET /v1/services. Sell your own API: POST /v1/sellers.",
      "> Ecosystem: discovery index https://atlas.code402.dev (209+ services, /directory.md) · settlement layer https://code402.dev",
      "",
      ...svcs.map((s) => `- [${s.name}](https://gateway.code402.dev${s.endpoint}): priced per /v1/services — ${s.description ?? ""}`),
      "",
      "Pay: plain HTTP GET/POST -> 402 challenge -> retry with X-PAYMENT (EIP-3009 USDC). See protocol/PROTOCOL.md.",
    ];
    return c.text(lines.join("\n"));
  });

  // Prepaid top-up SKUs (x402-paid; discrete amounts because middleware prices are static).
  const TOPUP_SKUS: Record<string, string> = { usd1: "$1", usd5: "$5", usd20: "$20" };
  app.use("/v1/accounts/topup/:sku", async (c, next) => {
    const sku = c.req.param("sku");
    if (!(sku in TOPUP_SKUS)) return c.json({ error: "sku must be usd1|usd5|usd20" }, 400);
    const sub = new (await import("hono")).Hono();
    const { paymentMiddleware } = await import("x402-hono");
    sub.use("*", paymentMiddleware(
      env.SELLER_WALLET_ADDRESS as Address,
      { [`/v1/accounts/topup/${sku}`]: { price: TOPUP_SKUS[sku]!, network, config: { description: `Prepaid credit top-up ${TOPUP_SKUS[sku]}` } } },
      facilitator,
    ));
    sub.get("*", async (c2: any) => {
      const payResp = c2.req.header("x-payment-response");
      let payer: string | null = null; let txHash = "unknown";
      if (payResp) {
        try {
          const pr = JSON.parse(payResp) as { payer?: string; transaction?: string };
          payer = pr.payer ?? null; txHash = pr.transaction ?? "unknown";
        } catch { /* settled by middleware */ }
      }
      if (!payer) return c2.json({ m2mVersion: M2M_VERSION, paid: true, credited: false, note: "settled but payer unknown; contact support with txHash" });
      const usd = Number(TOPUP_SKUS[sku]!.replace("$", ""));
      c2.executionCtx.waitUntil(
        creditAccount(env.REGISTRY, payer, BigInt(Math.round(usd * 1e6)).toString(), `topup:${txHash}`).catch(() => {}),
      );
      return c2.json({ m2mVersion: M2M_VERSION, paid: true, credited: true, amount_usd6: BigInt(Math.round(usd * 1e6)).toString(), account_wallet: payer });
    });
    return sub.fetch(new Request(c.req.url, { headers: c.req.raw.headers }), env, c.executionCtx);
  });

  // Prepaid credits: bearer key + sufficient balance = serve + debit (skips x402).
  const firstPartyPrices: Record<string, string> = {
    "/api/weather": PRICE_BASIC, "/api/echo": PRICE_BASIC,
    "/api/x402-probe": PRICE_PREMIUM, "/api/vat-check": PRICE_PREMIUM, "/api/forecast": PRICE_PREMIUM,
  };
  app.use("/api/*", createPrepaidDebitMiddleware(env, (p) => firstPartyPrices[p] ?? null));

  // x402-paid topup: ?usd=<amount> — after settle, credits the account ledger.
  app.use("/v1/accounts/topup", async (c, next) => {
    await next();
    const payResp = c.req.header("x-payment-response");
    if (!payResp || c.res.status >= 400) return;
    let payer: string | null = null; let txHash = "unknown";
    try {
      const pr = JSON.parse(payResp) as { payer?: string; transaction?: string };
      payer = pr.payer ?? null; txHash = pr.transaction ?? "unknown";
    } catch { /* settled flag only */ }
    const usd = Number(new URL(c.req.url).searchParams.get("usd") ?? "0");
    if (!payer || !(usd > 0)) return;
    c.executionCtx.waitUntil(
      creditAccount(env.REGISTRY, payer, BigInt(Math.round(usd * 1e6)).toString(), `topup:${txHash}`).catch(() => {}),
    );
  });

  // Everything under /api/* is paywalled via the x402 payment middleware.
  app.use(
    "/api/*",
    paymentMiddleware(
      env.SELLER_WALLET_ADDRESS as Address,
      {
        "/api/weather": {
          price: PRICE_BASIC,
          network,
          config: { description: "Demo weather reading, paid in USDC on Base Sepolia" },
        },
        "/api/echo": {
          price: PRICE_BASIC,
          network,
          config: { description: "Demo echo endpoint, paid in USDC on Base Sepolia" },
        },
        "/api/x402-probe": {
          price: PRICE_PREMIUM,
          network,
          config: { description: "Probe any URL for a valid x402 paywall, $0.005/call" },
        },
        "/api/vat-check": {
          price: PRICE_PREMIUM,
          network,
          config: { description: "ISO 7064 MOD-97 VAT checksum validation, $0.005/call" },
        },
        "/api/forecast": {
          price: PRICE_PREMIUM,
          network,
          config: { description: "5-day forecast, premium tier, $0.005/call" },
        },
      },
      facilitator,
    ),
  );

  // D1 receipts persistence: log every settled first-party payment (H1).
  // Runs after paymentMiddleware; X-PAYMENT-RESPONSE present = settled.
  app.use("/api/*", async (c, next) => {
    await next();
    const payResp = c.req.header("x-payment-response");
    if (!payResp || c.res.status >= 400) return;
    let payer: string | null = null;
    let txHash: string | null = null;
    try {
      const pr = JSON.parse(payResp) as { payer?: string; transaction?: string; txHash?: string };
      payer = pr.payer ?? null;
      txHash = pr.transaction ?? pr.txHash ?? null;
    } catch { /* fields stay null */ }
    const price = c.req.url.includes("/x402-probe") || c.req.url.includes("/vat-check") || c.req.url.includes("/forecast")
      ? PRICE_PREMIUM : PRICE_BASIC;
    c.executionCtx.waitUntil(
      env.REGISTRY.prepare(
        `INSERT INTO receipts (ts, seller_id, service_id, amount_usd, payer, tx_hash, raw_response) VALUES (?1,?2,?3,?4,?5,?6,?7)`,
      ).bind(Date.now(), "platform", c.req.path.replace("/api/", ""), price, payer, txHash, payResp).run(),
    );
  });

  // Paid route: demo weather data.
  app.get("/api/weather", (c) =>
    c.json({
      location: "Base Sepolia",
      temperatureC: 21.5,
      conditions: "clear",
      paid: true,
      paidTo: env.SELLER_WALLET_ADDRESS,
    }),
  );

  // Paid route: 5-day forecast (premium tier demo).
  app.get("/api/forecast", (c) =>
    c.json({
      location: "Base Sepolia",
      days: [21.5, 22.1, 20.8, 19.9, 23.4].map((t, i) => ({
        day: i + 1,
        temperatureC: t,
        conditions: i % 2 ? "clear" : "cloudy",
      })),
      paid: true,
      paidTo: env.SELLER_WALLET_ADDRESS,
    }),
  );

  // Paid route: echoes the request body back.
  app.all("/api/echo", async (c) => {
    let body: unknown = null;
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      body = await c.req.json().catch(() => null);
    }
    return c.json({ echo: body, method: c.req.method, paid: true });
  });

  // Paid route: real service — probe any URL for a valid x402 paywall
  // and return normalized M2M/1-style terms.
  app.post("/api/x402-probe", async (c) => {
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as { url?: string };
    const { url } = body;
    if (!url || !/^https:\/\//.test(url)) {
      return c.json({ error: "url (https) required" }, 400);
    }
    const started = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const bodyText = res.status === 402 ? await res.text() : null;
      let terms: unknown = null;
      if (bodyText) {
        try {
          const j = JSON.parse(bodyText) as {
            accepts?: Record<string, string>[] | null;
          };
          const a = j.accepts?.[0] ?? null;
          if (a) {
            terms = {
              scheme: a.scheme ?? null,
              network: a.network ?? null,
              amount: a.maxAmountRequired ?? null,
              payTo: a.payTo ?? null,
              asset: a.asset ?? null,
            };
          }
        } catch {
          terms = null;
        }
      }
      return c.json({
        url,
        status: res.status,
        isX402: res.status === 402 && terms !== null,
        terms,
        latencyMs: Date.now() - started,
        paid: true,
      });
    } catch (e) {
      return c.json({ url, error: e instanceof Error ? e.message : "fetch failed", paid: true }, 502);
    }
  });

  // Paid route: real service — deterministic VAT MOD-97 checksum (ISO 7064).
  app.post("/api/vat-check", async (c) => {
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as { vat_number?: string };
    const { vat_number } = body;
    const raw = String(vat_number ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z]{2}[0-9A-Z]{2,18}$/.test(raw)) {
      return c.json({ error: "vat_number must be like CC + 2-18 alphanumeric chars" }, 400);
    }
    const cc = raw.slice(0, 2);
    const digits = raw.slice(2);
    // ISO 7064 MOD 97-10: move letters to the end, A=10..Z=35, verify mod 97 == 1
    const reordered = digits + String((cc.charCodeAt(0) - 55)) + String(cc.charCodeAt(1) - 55);
    const numeric = reordered.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
    const check = numeric.split("").reduce((acc, d) => (acc * 10 + Number(d)) % 97, 0);
    const valid = check === 1;
    return c.json({ vat_number: raw, country: cc, valid, checksum: check, paid: true });
  });

  return app;
}

export default {
  fetch(request, env, ctx) {
    // Build the app per request so env bindings (payTo) are always current.
    return createApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Bindings>;
