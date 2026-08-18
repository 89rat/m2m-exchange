/**
 * Prepaid credits ledger (M2M/1.1 §2.3, §6) — the machine-native subscription
 * and the P2 netting embryo.
 *
 * Design per spec: double-entry, append-only entries; balances are DERIVED by
 * replay (never stored as mutable rows); conservation invariant
 * Σcredits − Σdebits = Σbalances verifiable at any time. Credits are claims on
 * services — not a token, not transferable, not redeemable for value — which
 * keeps the platform software, not a money transmitter.
 */
import { Hono } from "hono";
import { M2M_VERSION } from "@m2m/protocol";

export interface PrepaidBindings {
  REGISTRY: D1Database;
}

let prepaidSchemaReady = false;
export async function ensurePrepaidSchema(db: D1Database): Promise<void> {
  if (prepaidSchemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,            -- account id (a-xxxx)
      wallet TEXT NOT NULL UNIQUE,    -- owner EVM address
      key_hash TEXT NOT NULL,         -- SHA-256 of bearer key
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      account TEXT NOT NULL REFERENCES accounts(id),
      kind TEXT NOT NULL CHECK (kind IN ('credit','debit')),
      usd6 TEXT NOT NULL,             -- 6-decimal USD credit units, integer string
      reason TEXT NOT NULL,           -- 'topup:<txhash>' | 'call:<serviceId>'
      UNIQUE(ts, account, reason)     -- natural idempotency per event
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account, id)`),
  ]);
  prepaidSchemaReady = true;
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Derived balance: replay of entries. No mutable row to race. */
export async function balanceOf(db: D1Database, accountId: string): Promise<bigint> {
  const r = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN kind='credit' THEN CAST(usd6 AS INTEGER) ELSE 0 END),0)
     - COALESCE(SUM(CASE WHEN kind='debit'  THEN CAST(usd6 AS INTEGER) ELSE 0 END),0) AS bal
     FROM ledger_entries WHERE account = ?1`,
  ).bind(accountId).first<{ bal: number }>();
  return BigInt(r?.bal ?? 0);
}

/** Conservation audit: Σ(credits−debits) across ALL accounts == Σ balances (trivially true
 *  with derived balances, but the check also catches negative balances = overdrafts). */
export async function ledgerVerify(db: D1Database): Promise<{ ok: boolean; accounts: number; overdrafts: string[] }> {
  const rows = await db.prepare(
    `SELECT account, SUM(CASE WHEN kind='credit' THEN CAST(usd6 AS INTEGER) ELSE -CAST(usd6 AS INTEGER) END) AS bal
     FROM ledger_entries GROUP BY account`,
  ).all<{ account: string; bal: number }>();
  const overdrafts = rows.results.filter((r) => r.bal < 0).map((r) => r.account);
  return { ok: overdrafts.length === 0, accounts: rows.results.length, overdrafts };
}

/** Authenticate a bearer key → account row. */
async function authAccount(db: D1Database, req: Request): Promise<{ id: string; wallet: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer m2m_")) return null;
  const row = await db.prepare(`SELECT id, wallet FROM accounts WHERE key_hash = ?1`)
    .bind(await sha256(auth.slice("Bearer ".length)))
    .first<{ id: string; wallet: string }>();
  return row ?? null;
}

export function prepaidApp(env: PrepaidBindings): Hono<{ Bindings: PrepaidBindings }> {
  const app = new Hono<{ Bindings: PrepaidBindings }>();

  // Open an account (free). Returns the bearer key exactly once.
  app.post("/v1/accounts", async (c) => {
    await ensurePrepaidSchema(env.REGISTRY);
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as { wallet?: string };
    if (!body.wallet || !/^0x[0-9a-fA-F]{40}$/.test(body.wallet)) {
      return c.json({ error: "wallet (EVM address) required" }, 400);
    }
    const wallet = body.wallet.toLowerCase();
    const existing = await env.REGISTRY.prepare(`SELECT id FROM accounts WHERE wallet = ?1`).bind(wallet).first<{ id: string }>();
    if (existing) return c.json({ error: "account exists for this wallet", accountId: existing.id }, 409);

    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const key = "m2m_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const id = "a-" + (await sha256(key)).slice(0, 10);
    await env.REGISTRY.prepare(
      `INSERT INTO accounts (id, wallet, key_hash, created_at) VALUES (?1,?2,?3,?4)`,
    ).bind(id, wallet, await sha256(key), Date.now()).run();
    return c.json({ m2mVersion: M2M_VERSION, accountId: id, apiKey: key, note: "store apiKey now; use Authorization: Bearer <key> to spend credits" }, 201);
  });

  // Balance inquiry (free, by wallet — public like a chain balance).
  app.get("/v1/accounts/:wallet", async (c) => {
    await ensurePrepaidSchema(env.REGISTRY);
    const wallet = c.req.param("wallet").toLowerCase();
    const acct = await env.REGISTRY.prepare(`SELECT id FROM accounts WHERE wallet = ?1`).bind(wallet).first<{ id: string }>();
    if (!acct) return c.json({ m2mVersion: M2M_VERSION, wallet, balance_usd6: "0", note: "no account" });
    return c.json({ m2mVersion: M2M_VERSION, wallet, accountId: acct.id, balance_usd6: (await balanceOf(env.REGISTRY, acct.id)).toString() });
  });

  // Conservation audit (free; the §6 invariant check).
  app.get("/v1/ledger/verify", async (c) => {
    await ensurePrepaidSchema(env.REGISTRY);
    return c.json({ m2mVersion: M2M_VERSION, ...(await ledgerVerify(env.REGISTRY)) });
  });

  return app;
}

/** Attach to /api/* BEFORE x402 middleware: bearer key + sufficient balance = serve + debit. */
export function createPrepaidDebitMiddleware(env: PrepaidBindings, priceOf: (path: string) => string | null) {
  return async (c: any, next: () => Promise<void>) => {
    await ensurePrepaidSchema(env.REGISTRY);
    const auth = c.req.header("authorization") ?? "";
    if (!auth.startsWith("Bearer m2m_")) return next();

    const acct = await authAccount(env.REGISTRY, c.req.raw);
    if (!acct) return c.json({ error: "INVALID_ACCOUNT_KEY" }, 401);

    const price = priceOf(c.req.path);
    if (price == null) return next();

    const cost = BigInt(Math.round(Number(price.replace("$", "")) * 1e6));
    const bal = await balanceOf(env.REGISTRY, acct.id);
    if (bal < cost) {
      return c.json({
        m2mVersion: M2M_VERSION,
        error: { code: "INSUFFICIENT_CREDITS", message: `balance ${bal} < cost ${cost} usd6; top up via x402 payment to /v1/accounts/topup`, retryable: false },
        balance_usd6: bal.toString(),
      }, 402);
    }
    await next(); // handler succeeded
    if (c.res.status < 400) {
      const reason = `call:${c.req.path.replace("/api/", "")}`;
      c.executionCtx.waitUntil(
        env.REGISTRY.prepare(
          `INSERT INTO ledger_entries (ts, account, kind, usd6, reason) VALUES (?1,?2,'debit',?3,?4)`,
        ).bind(Date.now(), acct.id, cost.toString(), reason).run(),
      );
    }
  };
}

/** Credit an account after a settled x402 top-up payment (called from the topup route). */
export async function creditAccount(db: D1Database, wallet: string, usd6: string, reason: string): Promise<void> {
  const acct = await db.prepare(`SELECT id FROM accounts WHERE wallet = ?1`).bind(wallet.toLowerCase()).first<{ id: string }>();
  if (!acct) throw new Error("no account for wallet");
  await db.prepare(
    `INSERT INTO ledger_entries (ts, account, kind, usd6, reason) VALUES (?1,?2,'credit',?3,?4)`,
  ).bind(Date.now(), acct.id, usd6, reason).run();
}
