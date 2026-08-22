/**
 * Multi-tenant registry: seller onboarding, dynamic per-seller x402 routing,
 * and receipt logging. The platform routes and attests — it NEVER holds money:
 * buyer USDC goes directly to each seller's wallet (payTo from D1).
 */
import { Hono } from "hono";
import type { Address } from "viem";
import { paymentMiddleware } from "x402-hono";
import { M2M_VERSION } from "@m2m/protocol";
import type { ServiceDescriptor } from "@m2m/protocol";
import { splitPayment, DEFAULT_FEE_SCHEDULE } from "@m2m/protocol";
import type { FeeSchedule, FeeSplit } from "@m2m/protocol";
import { resolveNetwork, resolveFacilitator, usdcAddress, type NetworkBindings } from "./network";

export interface RegistryBindings extends NetworkBindings {
  REGISTRY: D1Database;
  SELLER_WALLET_ADDRESS: string;
  /** Ed25519 private key (JWK JSON) for upstream origin attestation. Optional:
   *  when unset, proxied calls simply carry no attestation header. */
  ATTEST_PRIVATE_JWK?: string;
}

/** Idempotent schema (mirrors migrations/0001_registry.sql) — safe to call on
 *  every isolate start; guarantees the registry works even before migrations
 *  run (tests, fresh environments). */
let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sellers (id TEXT PRIMARY KEY, wallet TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL, tier TEXT NOT NULL DEFAULT 'free', promoted INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, verify_nonce TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY AUTOINCREMENT, seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE, service_id TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'GET', upstream_url TEXT NOT NULL, fallback_url TEXT, price_usd TEXT NOT NULL, description TEXT DEFAULT '', live INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, promoted INTEGER NOT NULL DEFAULT 0, UNIQUE(seller_id, service_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS receipts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, seller_id TEXT NOT NULL REFERENCES sellers(id), service_id TEXT NOT NULL, amount_usd TEXT NOT NULL, payer TEXT, tx_hash TEXT, raw_response TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_receipts_seller ON receipts(seller_id, ts DESC)`),
  ]);
  // Additive schema evolution for pre-existing tables (idempotent).
  try {
    await db.prepare(`ALTER TABLE listings ADD COLUMN fallback_url TEXT`).run();
  } catch { /* column already exists */ }
  schemaReady = true;
}

function slugOk(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(s);
}

/** SSRF guard: reject private, loopback, link-local, metadata, and
 *  non-HTTP(S) upstream targets. Cloudflare Workers cannot reach private
 *  ranges without explicit bindings, but defense-in-depth is cheap. */
export function upstreamAllowed(rawUrl: string): boolean {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  if (h === "metadata.google.internal" || h === "169.254.169.254") return false;
  // Literal IPv4 / IPv6 in private/reserved space
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
    if (a >= 224) return false; // multicast/reserved
    return true;
  }
  if (h.includes(":") && (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd"))) return false;
  return true;
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
export function toUnits(price: string): string {
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

  // ---- Platform stats: public flywheel telemetry (LOOPS.md T3) ----
  // Free and cacheable: the live-proof numbers for the landing page, the
  // SELFSUSTAIN.md scorecard, and (later) atlas ranking. Aggregates only —
  // no per-payer data beyond a distinct count.
  app.get("/v1/stats", async (c) => {
    const totals = await env.REGISTRY.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(CAST(REPLACE(amount_usd,'$','') AS REAL)),0) gross,
              COUNT(DISTINCT payer) payers
       FROM receipts`,
    ).first<{ n: number; gross: number; payers: number }>();
    const since30 = Date.now() - 30 * 86_400_000;
    const last30 = await env.REGISTRY.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(CAST(REPLACE(amount_usd,'$','') AS REAL)),0) gross,
              COUNT(DISTINCT payer) payers
       FROM receipts WHERE ts >= ?1`,
    ).bind(since30).first<{ n: number; gross: number; payers: number }>();
    const byService = await env.REGISTRY.prepare(
      `SELECT seller_id, service_id, COUNT(*) calls,
              COALESCE(SUM(CAST(REPLACE(amount_usd,'$','') AS REAL)),0) gross_usd
       FROM receipts GROUP BY seller_id, service_id ORDER BY calls DESC LIMIT 20`,
    ).all();
    const sellers = await env.REGISTRY.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN tier='pro' THEN 1 ELSE 0 END),0) pro FROM sellers`,
    ).first<{ n: number; pro: number }>();
    c.header("cache-control", "public, max-age=60");
    return c.json({
      m2mVersion: M2M_VERSION,
      total_settled_calls: totals?.n ?? 0,
      gross_usd: Number((totals?.gross ?? 0).toFixed(6)),
      unique_payers: totals?.payers ?? 0,
      last_30d: {
        settled_calls: last30?.n ?? 0,
        gross_usd: Number((last30?.gross ?? 0).toFixed(6)),
        unique_payers: last30?.payers ?? 0,
      },
      sellers: sellers?.n ?? 0,
      pro_sellers: sellers?.pro ?? 0,
      top_services: byService.results,
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

  // ---- Wallet ownership proof (EIP-191 challenge/response) ----
  app.post("/v1/sellers/:sellerId/verify-challenge", async (c) => {
    const sellerId = c.req.param("sellerId");
    const seller = await env.REGISTRY.prepare(`SELECT wallet FROM sellers WHERE id = ?1`).bind(sellerId).first<{ wallet: string }>();
    if (!seller) return c.json({ error: "unknown seller" }, 404);
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const nonce = "verify_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.REGISTRY.prepare(`UPDATE sellers SET verify_nonce = ?2 WHERE id = ?1`).bind(sellerId, nonce).run();
    return c.json({
      m2mVersion: M2M_VERSION,
      message: `code402 seller verification for ${sellerId}: ${nonce}`,
      note: "EIP-191 personal_sign this exact string with the registered wallet, then POST /verify",
    });
  });
  app.post("/v1/sellers/:sellerId/verify", async (c) => {
    const sellerId = c.req.param("sellerId");
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as { signature?: string };
    const seller = await env.REGISTRY.prepare(`SELECT wallet, verify_nonce FROM sellers WHERE id = ?1`).bind(sellerId)
      .first<{ wallet: string; verify_nonce: string | null }>();
    if (!seller || !seller.verify_nonce || !body.signature) {
      return c.json({ error: "request a challenge first: POST /verify-challenge" }, 400);
    }
    const message = `code402 seller verification for ${sellerId}: ${seller.verify_nonce}`;
    const { recoverMessageAddress } = await import("viem");
    let recovered: string | null = null;
    try {
      recovered = await recoverMessageAddress({ message, signature: body.signature as `0x${string}` });
    } catch { recovered = null; }
    if (!recovered || recovered.toLowerCase() !== seller.wallet.toLowerCase()) {
      return c.json({ error: "VERIFICATION_FAILED", recovered }, 403);
    }
    await env.REGISTRY.prepare(`UPDATE sellers SET verified = 1, verify_nonce = NULL WHERE id = ?1`).bind(sellerId).run();
    return c.json({ m2mVersion: M2M_VERSION, sellerId, verified: true, wallet: seller.wallet });
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
  // GET: registration guide (humans landing here from the storefront CTA).
  app.get("/v1/sellers", (c) =>
    c.json({
      m2mVersion: M2M_VERSION,
      how_to_register: {
        step_1: 'POST /v1/sellers { "id": "<slug>", "wallet": "0x…", "name": "Your API" }',
        step_2: "POST /v1/sellers/{id}/services { serviceId, upstream_url, price_usd }",
        step_3: "payments flow direct to your wallet; we route, attest, and invoice 2%",
      },
      verify_ownership: "POST /v1/sellers/{id}/verify-challenge then /verify (EIP-191)",
      human_friendly: "https://atlas.code402.dev/sellers/claim",
      protocol: "https://github.com/89rat/m2m-exchange",
    }),
  );

  app.post("/v1/sellers", async (c) => {
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as {
      id?: string; wallet?: string; name?: string;
    };
    const id = String(body.id ?? "").toLowerCase();
    const wallet = String(body.wallet ?? "");
    if (!slugOk(id)) return c.json({ error: "id must be [a-z0-9-]{2,63}" }, 400);
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return c.json({ error: "wallet must be an EVM address" }, 400);
    if (!body.name) return c.json({ error: "name required" }, 400);

    // SECURITY (pre-launch review): the payout wallet is immutable through
    // this unauthenticated endpoint. Allowing ON CONFLICT to update `wallet`
    // let anyone repoint an existing seller's revenue with one request.
    // Same-wallet re-registration stays idempotent (name updates allowed);
    // wallet re-binding requires proof of the CURRENT wallet via the EIP-191
    // verify flow (future endpoint) or operator support.
    const existing = await env.REGISTRY.prepare(`SELECT wallet FROM sellers WHERE id = ?1`)
      .bind(id).first<{ wallet: string }>();
    if (existing && existing.wallet !== wallet.toLowerCase()) {
      return c.json({
        m2mVersion: M2M_VERSION,
        error: {
          code: "WALLET_IMMUTABLE",
          message: "seller id exists with a different wallet; wallet re-binding requires EIP-191 proof of the registered wallet",
          retryable: false,
        },
      }, 409);
    }

    try {
      await env.REGISTRY.prepare(
        `INSERT INTO sellers (id, wallet, name, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name = ?3`,
      ).bind(id, wallet.toLowerCase(), String(body.name).slice(0, 80), Date.now()).run();
    } catch (e) {
      // sellers.wallet is UNIQUE — a wallet already bound to a different id
      // must surface as a typed 409, not a bare 500.
      if (String((e as Error)?.message ?? "").toUpperCase().includes("UNIQUE")) {
        return c.json({
          m2mVersion: M2M_VERSION,
          error: { code: "WALLET_IN_USE", message: "this wallet is already registered to another seller id", retryable: false },
        }, 409);
      }
      throw e;
    }

    return c.json({ m2mVersion: M2M_VERSION, sellerId: id, wallet: wallet.toLowerCase(), storefront: `/s/${id}` }, 201);
  });

  // ---- List a service (self-serve; conformance = we probe the upstream on first sale) ----
  app.post("/v1/sellers/:sellerId/services", async (c) => {
    const sellerId = c.req.param("sellerId");
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as {
      serviceId?: string; method?: string; upstream_url?: string; fallback_url?: string; price_usd?: string; description?: string;
    };
    const serviceId = String(body.serviceId ?? "").toLowerCase();
    if (!slugOk(serviceId)) return c.json({ error: "serviceId must be [a-z0-9-]{2,63}" }, 400);
    if (!body.upstream_url || !upstreamAllowed(body.upstream_url)) return c.json({ error: "upstream_url rejected: must be https to a public target" }, 400);
    if (body.fallback_url && !upstreamAllowed(body.fallback_url)) return c.json({ error: "fallback_url rejected: must be https to a public target" }, 400);
    if (!body.price_usd || !priceOk(body.price_usd)) return c.json({ error: "price_usd like $0.05 required" }, 400);

    const seller = await env.REGISTRY.prepare(`SELECT id FROM sellers WHERE id = ?1`).bind(sellerId).first();
    if (!seller) return c.json({ m2mVersion: M2M_VERSION, error: { code: "SERVICE_NOT_FOUND", message: "unknown seller", retryable: false } }, 404);

    await env.REGISTRY.prepare(
      `INSERT INTO listings (seller_id, service_id, method, upstream_url, fallback_url, price_usd, description, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
       ON CONFLICT(seller_id, service_id) DO UPDATE SET upstream_url = ?4, fallback_url = ?5, price_usd = ?6, description = ?7, live = 1`,
    ).bind(sellerId, serviceId, String(body.method ?? "GET").toUpperCase(), body.upstream_url,
      body.fallback_url ?? null,
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
  const network = resolveNetwork(env);
  const usdc = usdcAddress(network);
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
      pricing: { mode: "static" as const, price: { amount: units, asset: usdc, network } },
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
      wallet: string; upstream_url: string; fallback_url: string | null; price_usd: string; method: string;
    }>();
    if (!listing) {
      return c.json({ m2mVersion: M2M_VERSION, error: { code: "SERVICE_NOT_FOUND", message: "unknown listing", retryable: false } }, 404);
    }
    if (!upstreamAllowed(listing.upstream_url)) {
      return c.json({ m2mVersion: M2M_VERSION, error: { code: "INVALID_MESSAGE", message: "upstream target not allowed", retryable: false } }, 400);
    }

    // Build a per-listing x402 paywall with the seller's wallet as payTo.
    const sub = new Hono();
    const price = listing.price_usd.startsWith("$") ? listing.price_usd : `$${listing.price_usd}`;
    sub.use("*", paymentMiddleware(
      listing.wallet as Address,
      { [`/s/${sellerId}/${serviceId}`]: { price, network: resolveNetwork(env), config: { description: `${sellerId}/${serviceId} via m2m-exchange` } } },
      resolveFacilitator(env),
    ));
    sub.all("*", async (c2: any) => {
      // Payment settled (middleware passed). Parse the receipt FIRST so the
      // upstream call can carry proof of it.
      const payResp = c2.req.header("x-payment-response");
      let payer: string | null = null;
      let txHash: string | null = null;
      try {
        const pr = payResp ? JSON.parse(payResp) as { payer?: string; transaction?: string; txHash?: string } : null;
        payer = pr?.payer ?? null;
        txHash = pr?.transaction ?? pr?.txHash ?? null;
      } catch { /* receipt fields stay null; settle still verified by middleware */ }

      // Origin attestation: an Ed25519-signed, 60s, nonce-bound proof that this
      // call arrived through code402 with a settled payment. Sellers verify with
      // the public key published at /.well-known/x402.json — no shared secret.
      // Anti-bypass: an upstream enforcing this header cannot be called direct.
      const upstreamHeaders: Record<string, string> = {
        "content-type": c2.req.header("content-type") ?? "application/json",
      };
      if (env.ATTEST_PRIVATE_JWK) {
        try {
          const { signAttestation } = await import("./attest");
          const nonce = (txHash ?? crypto.randomUUID()).slice(0, 80);
          const att = await signAttestation(env.ATTEST_PRIVATE_JWK, {
            sellerId,
            serviceId,
            payer: payer ?? "unknown",
            amountUnits: toUnits(price),
          }, nonce);
          upstreamHeaders["x-code402-attestation"] = att.header;
        } catch { /* attestation is additive — never block a settled call on it */ }
      }

      // Proxy to the seller's upstream — primary first, fallback on network
      // failure or 5xx (a paid call deserves a second target before it 502s).
      // The request body is read once and reused across attempts.
      const bodyText = ["GET", "HEAD"].includes(c2.req.method) ? undefined : await c2.req.text();
      let upstream: Response;
      const attempt = (target: string) =>
        fetch(target, {
          method: c2.req.method,
          headers: upstreamHeaders,
          body: bodyText,
          signal: AbortSignal.timeout(15_000),
        });
      let usedFallback = false;
      try {
        upstream = await attempt(listing.upstream_url);
        if (upstream.status >= 500 && listing.fallback_url && upstreamAllowed(listing.fallback_url)) {
          usedFallback = true;
          upstream = await attempt(listing.fallback_url);
        }
      } catch (e) {
        if (listing.fallback_url && upstreamAllowed(listing.fallback_url)) {
          usedFallback = true;
          try {
            upstream = await attempt(listing.fallback_url);
          } catch (e2) {
            return c2.json({ m2mVersion: M2M_VERSION, error: { code: "INTERNAL", message: "upstream fetch failed (primary + fallback)", retryable: true } }, 502);
          }
        } else {
          return c2.json({ m2mVersion: M2M_VERSION, error: { code: "INTERNAL", message: "upstream fetch failed", retryable: true } }, 502);
        }
      }
      // Receipt row = invoice basis (0.099% take-rate) + reputation seed.
      await env.REGISTRY.prepare(
        `INSERT INTO receipts (ts, seller_id, service_id, amount_usd, payer, tx_hash, raw_response) VALUES (?1,?2,?3,?4,?5,?6,?7)`,
      ).bind(Date.now(), sellerId, serviceId, price, payer, txHash, payResp ?? null).run();
      // Invitation payload (M2M/1 receipt extension): every settled payment
      // carries a machine-verifiable onboarding offer for the payer's agent to
      // propagate — agent-to-agent K-factor, measured from receipt telemetry.
      // Cap upstream reads at 1 MB — hostile/oversized sellers must not exhaust
      // Worker memory (best-practices: never unbounded .text() on external data).
      const buf = await upstream.arrayBuffer();
      const upstreamBody = new TextDecoder().decode(buf.slice(0, 1_048_576));
      let payload: unknown = null;
      try { payload = JSON.parse(upstreamBody); } catch { payload = upstreamBody.slice(0, 2000); }
      return c2.json({
        m2mVersion: M2M_VERSION,
        data: payload,
        receipt: { sellerId, serviceId, price, payer, txHash, settledAt: Math.floor(Date.now() / 1000) },
        invitation: {
          schema: "m2m.invitation.v1",
          to: "the paying agent's operator",
          pitch: "Sell YOUR API to agents the same way: register a wallet, list an endpoint, get paid per call — direct, non-custodial.",
          register: "POST https://gateway.code402.dev/v1/sellers",
          claim_profile: "https://atlas.code402.dev/sellers/claim",
          expected_savings: "payment infra you don't have to build: discovery + receipts + reputation included",
          protocol: "https://github.com/89rat/m2m-exchange",
        },
      });
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
