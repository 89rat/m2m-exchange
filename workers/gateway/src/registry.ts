/**
 * Multi-tenant registry: seller onboarding, dynamic per-seller x402 routing,
 * and receipt logging. The platform routes and attests — it NEVER holds money:
 * buyer USDC goes directly to each seller's wallet (payTo from D1).
 */
import { Hono } from "hono";
import type { Address } from "viem";
import { paymentMiddleware } from "x402-hono";
import type { Resource } from "x402/types";
import { M2M_VERSION } from "@m2m/protocol";
import type { ServiceDescriptor } from "@m2m/protocol";
import { splitPayment, DEFAULT_FEE_SCHEDULE } from "@m2m/protocol";
import type { FeeSchedule, FeeSplit } from "@m2m/protocol";

export interface RegistryBindings {
  REGISTRY: D1Database;
  SELLER_WALLET_ADDRESS: string;
  FACILITATOR_URL?: string;
}

const NETWORK = "base-sepolia";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** Idempotent schema (mirrors migrations/0001_registry.sql) — safe to call on
 *  every isolate start; guarantees the registry works even before migrations
 *  run (tests, fresh environments). */
let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sellers (id TEXT PRIMARY KEY, wallet TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL, tier TEXT NOT NULL DEFAULT 'free', promoted INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY AUTOINCREMENT, seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE, service_id TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'GET', upstream_url TEXT NOT NULL, price_usd TEXT NOT NULL, description TEXT DEFAULT '', live INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, promoted INTEGER NOT NULL DEFAULT 0, UNIQUE(seller_id, service_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS receipts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, seller_id TEXT NOT NULL REFERENCES sellers(id), service_id TEXT NOT NULL, amount_usd TEXT NOT NULL, payer TEXT, tx_hash TEXT, raw_response TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_receipts_seller ON receipts(seller_id, ts DESC)`),
  ]);
  schemaReady = true;
}

function slugOk(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(s);
}

function priceOk(p: string): boolean {
  return /^\$?\d+(\.\d{1,6})?$/.test(p);
}

function scheduleForTier(tier: string): FeeSchedule {
  return tier === "pro"
    ? { feeScheduleVersion: 2, feeBps: 150, minFee: "100", maxFee: "1000000000000" } // Pro: 1.5%
    : DEFAULT_FEE_SCHEDULE; // Free: 2%
}

/** Dollar string ("$0.05") -> base-unit integer string ("50000"). */
function toUnits(price: string): string {
  return BigInt(Math.round(Number(price.replace("$", "")) * 1e6)).toString();
}

export function registryApp(env: RegistryBindings): Hono<{ Bindings: RegistryBindings }> {
  const app = new Hono<{ Bindings: RegistryBindings }>();
  app.use("/v1/*", async (c, next) => { await ensureSchema(env.REGISTRY); await next(); });

  // ---- Stream 1: take-rate invoice, computed from receipts via splitPayment ----
  // Sellers see their own invoice + analytics free (own-data rule).
  app.get("/v1/sellers/:sellerId/invoice", async (c) => {
    const sellerId = c.req.param("sellerId");
    const seller = await env.REGISTRY.prepare(`SELECT tier FROM sellers WHERE id = ?1`).bind(sellerId)
      .first<{ tier: string }>();
    if (!seller) return c.json({ m2mVersion: M2M_VERSION, error: { code: "SERVICE_NOT_FOUND", message: "unknown seller", retryable: false } }, 404);

    const since = Number(c.req.query("since") ?? 0);
    const rows = await env.REGISTRY.prepare(
      `SELECT amount_usd FROM receipts WHERE seller_id = ?1 AND ts >= ?2`,
    ).bind(sellerId, since).all<{ amount_usd: string }>();

    const schedule = scheduleForTier(seller.tier);
    let grossUnits = 0n;
    const splits: FeeSplit[] = [];
    for (const r of rows.results) {
      const s = splitPayment(toUnits(r.amount_usd), schedule);
      grossUnits += BigInt(s.gross);
      splits.push(s);
    }
    let feeUnits = 0n;
    for (const s of splits) feeUnits += BigInt(s.platformFee);

    return c.json({
      m2mVersion: M2M_VERSION,
      sellerId,
      tier: seller.tier,
      period_start: since,
      transactions: rows.results.length,
      gross_usdc_units: grossUnits.toString(),
      platform_fee_usdc_units: feeUnits.toString(),
      seller_net_usdc_units: (grossUnits - feeUnits).toString(),
      fee_schedule_version: schedule.feeScheduleVersion,
      fee_bps: schedule.feeBps,
      payment: "payable via x402 to the platform fee wallet (settles invoice)",
      note: "Invoice model: fee invoiced monthly against settled receipts. Splitter contract planned.",
    });
  });

  // ---- Seller analytics: own data, free forever ----
  app.get("/v1/sellers/:sellerId/analytics", async (c) => {
    const sellerId = c.req.param("sellerId");
    const totals = await env.REGISTRY.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(CAST(REPLACE(amount_usd,'$','') AS REAL)),0) gross
       FROM receipts WHERE seller_id = ?1`,
    ).bind(sellerId).first<{ n: number; gross: number }>();
    const byService = await env.REGISTRY.prepare(
      `SELECT service_id, COUNT(*) calls FROM receipts WHERE seller_id = ?1 GROUP BY service_id ORDER BY calls DESC`,
    ).bind(sellerId).all();
    const buyers = await env.REGISTRY.prepare(
      `SELECT COUNT(DISTINCT payer) n FROM receipts WHERE seller_id = ?1 AND payer IS NOT NULL`,
    ).bind(sellerId).first<{ n: number }>();
    return c.json({
      m2mVersion: M2M_VERSION, sellerId,
      total_settled_calls: totals?.n ?? 0,
      gross_usd: Number((totals?.gross ?? 0).toFixed(6)),
      unique_buyers: buyers?.n ?? 0,
      by_service: byService.results,
    });
  });

  // ---- Stream 2: tier upgrade (Pro = 1.5% + analytics priority; billing via x402 later) ----
  app.post("/v1/sellers/:sellerId/tier", async (c) => {
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as { tier?: string };
    if (body.tier !== "free" && body.tier !== "pro") return c.json({ error: "tier must be free|pro" }, 400);
    const r = await env.REGISTRY.prepare(`UPDATE sellers SET tier = ?2 WHERE id = ?1`).bind(c.req.param("sellerId"), body.tier).run();
    if (r.meta.changes === 0) return c.json({ error: "unknown seller" }, 404);
    return c.json({ m2mVersion: M2M_VERSION, sellerId: c.req.param("sellerId"), tier: body.tier, fee_bps: scheduleForTier(body.tier).feeBps });
  });

  // ---- Stream 3: promoted placement (admin-set for now; self-serve purchase later) ----
  app.post("/v1/sellers/:sellerId/services/:serviceId/promote", async (c) => {
    const r = await env.REGISTRY.prepare(
      `UPDATE listings SET promoted = 1 WHERE seller_id = ?1 AND service_id = ?2`,
    ).bind(c.req.param("sellerId"), c.req.param("serviceId")).run();
    if (r.meta.changes === 0) return c.json({ error: "unknown listing" }, 404);
    return c.json({ m2mVersion: M2M_VERSION, promoted: true, note: "promoted listings sort first in /v1/services (labeled)" });
  });

  // ---- Seller onboarding (free, self-serve) ----
  app.post("/v1/sellers", async (c) => {
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as {
      id?: string; wallet?: string; name?: string;
    };
    const id = String(body.id ?? "").toLowerCase();
    const wallet = String(body.wallet ?? "");
    if (!slugOk(id)) return c.json({ error: "id must be [a-z0-9-]{2,63}" }, 400);
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return c.json({ error: "wallet must be an EVM address" }, 400);
    if (!body.name) return c.json({ error: "name required" }, 400);

    const r = await env.REGISTRY.prepare(
      `INSERT INTO sellers (id, wallet, name, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET wallet = ?2, name = ?3`,
    ).bind(id, wallet.toLowerCase(), String(body.name).slice(0, 80), Date.now()).run();

    return c.json({ m2mVersion: M2M_VERSION, sellerId: id, wallet: wallet.toLowerCase(), storefront: `/s/${id}` }, 201);
  });

  // ---- List a service (self-serve; conformance = we probe the upstream on first sale) ----
  app.post("/v1/sellers/:sellerId/services", async (c) => {
    const sellerId = c.req.param("sellerId");
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as {
      serviceId?: string; method?: string; upstream_url?: string; price_usd?: string; description?: string;
    };
    const serviceId = String(body.serviceId ?? "").toLowerCase();
    if (!slugOk(serviceId)) return c.json({ error: "serviceId must be [a-z0-9-]{2,63}" }, 400);
    if (!body.upstream_url || !/^https:\/\//.test(body.upstream_url)) return c.json({ error: "upstream_url (https) required" }, 400);
    if (!body.price_usd || !priceOk(body.price_usd)) return c.json({ error: "price_usd like $0.05 required" }, 400);

    const seller = await env.REGISTRY.prepare(`SELECT id FROM sellers WHERE id = ?1`).bind(sellerId).first();
    if (!seller) return c.json({ m2mVersion: M2M_VERSION, error: { code: "SERVICE_NOT_FOUND", message: "unknown seller", retryable: false } }, 404);

    await env.REGISTRY.prepare(
      `INSERT INTO listings (seller_id, service_id, method, upstream_url, price_usd, description, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7)
       ON CONFLICT(seller_id, service_id) DO UPDATE SET upstream_url = ?4, price_usd = ?5, description = ?6, live = 1`,
    ).bind(sellerId, serviceId, String(body.method ?? "GET").toUpperCase(), body.upstream_url,
      body.price_usd.startsWith("$") ? body.price_usd : `$${body.price_usd}`,
      String(body.description ?? "").slice(0, 300), Date.now()).run();

    return c.json({
      m2mVersion: M2M_VERSION,
      listing: `/s/${sellerId}/${serviceId}`,
      paid_endpoint: `https://gateway.code402.dev/s/${sellerId}/${serviceId}`,
    }, 201);
  });

  // ---- Dynamic storefront entries for /v1/services merge ----
  return app;
}

/** Live listings as ServiceDescriptors (endpoint path = the platform-proxied route). */
export async function dynamicServiceDescriptors(env: RegistryBindings): Promise<ServiceDescriptor[]> {
  await ensureSchema(env.REGISTRY);
  const rows = await env.REGISTRY.prepare(
    `SELECT l.seller_id, l.service_id, l.method, l.price_usd, l.description, l.promoted
     FROM listings l JOIN sellers s ON s.id = l.seller_id WHERE l.live = 1
     ORDER BY l.promoted DESC, l.created_at ASC LIMIT 500`,
  ).all<{ seller_id: string; service_id: string; method: string; price_usd: string; description: string; promoted: number }>();
  return rows.results.map((l) => {
    const dollars = Number(l.price_usd.replace("$", ""));
    // 6-decimal USDC base units, integer string (M2M/1 §2.3)
    const units = BigInt(Math.round(dollars * 1e6)).toString();
    return {
      m2mVersion: M2M_VERSION,
      serviceId: `${l.seller_id}-${l.service_id}`,
      name: `${l.promoted ? "★ " : ""}${l.seller_id}/${l.service_id}`,
      description: l.description || `Third-party listing (paid direct to seller wallet).`,
      endpoint: `/s/${l.seller_id}/${l.service_id}`,
      method: l.method as ServiceDescriptor["method"],
      pricing: { mode: "static" as const, price: { amount: units, asset: USDC_BASE_SEPOLIA, network: NETWORK } },
    };
  });
}

/**
 * The multi-tenant paid route: /s/{sellerId}/{serviceId}.
 * Per-listing x402 middleware with the SELLER's wallet as payTo (direct,
 * non-custodial), then proxy to the seller's upstream and log the receipt.
 */
export function createSellerProxy(env: RegistryBindings) {
  return async (c: any) => {
    await ensureSchema(env.REGISTRY);
    const sellerId = c.req.param("sellerId");
    const serviceId = c.req.param("serviceId");

    const listing = await env.REGISTRY.prepare(
      `SELECT l.*, s.wallet FROM listings l JOIN sellers s ON s.id = l.seller_id
       WHERE l.seller_id = ?1 AND l.service_id = ?2 AND l.live = 1`,
    ).bind(sellerId, serviceId).first<{
      wallet: string; upstream_url: string; price_usd: string; method: string;
    }>();
    if (!listing) {
      return c.json({ m2mVersion: M2M_VERSION, error: { code: "SERVICE_NOT_FOUND", message: "unknown listing", retryable: false } }, 404);
    }

    // Build a per-listing x402 paywall with the seller's wallet as payTo.
    const sub = new Hono();
    const price = listing.price_usd.startsWith("$") ? listing.price_usd : `$${listing.price_usd}`;
    sub.use("*", paymentMiddleware(
      listing.wallet as Address,
      { [`/s/${sellerId}/${serviceId}`]: { price, network: NETWORK, config: { description: `${sellerId}/${serviceId} via m2m-exchange` } } },
      env.FACILITATOR_URL ? { url: env.FACILITATOR_URL as Resource } : undefined,
    ));
    sub.all("*", async (c2: any) => {
      // Payment settled (middleware passed) — proxy to the seller's upstream.
      let upstream: Response;
      try {
        upstream = await fetch(listing.upstream_url, {
          method: c2.req.method,
          headers: { "content-type": c2.req.header("content-type") ?? "application/json" },
          body: ["GET", "HEAD"].includes(c2.req.method) ? undefined : await c2.req.text(),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        return c2.json({ m2mVersion: M2M_VERSION, error: { code: "INTERNAL", message: "upstream fetch failed", retryable: true } }, 502);
      }
      // Receipt row = invoice basis (2% take-rate) + reputation seed.
      const payResp = c2.req.header("x-payment-response");
      let payer: string | null = null;
      let txHash: string | null = null;
      try {
        const pr = payResp ? JSON.parse(payResp) as { payer?: string; transaction?: string; txHash?: string } : null;
        payer = pr?.payer ?? null;
        txHash = pr?.transaction ?? pr?.txHash ?? null;
      } catch { /* receipt fields stay null; settle still verified by middleware */ }
      c2.executionCtx.waitUntil(
        env.REGISTRY.prepare(
          `INSERT INTO receipts (ts, seller_id, service_id, amount_usd, payer, tx_hash, raw_response) VALUES (?1,?2,?3,?4,?5,?6,?7)`,
        ).bind(Date.now(), sellerId, serviceId, price, payer, txHash, payResp ?? null).run(),
      );
      return c2.newResponse(upstream.body, upstream.status, Object.fromEntries(upstream.headers));
    });

    // Dispatch the original request through the paywalled sub-app.
    const url = new URL(c.req.url);
    const req = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: ["GET", "HEAD"].includes(c.req.method) ? undefined : await c.req.raw.clone().text(),
    });
    return sub.fetch(req, env, c.executionCtx);
  };
}
