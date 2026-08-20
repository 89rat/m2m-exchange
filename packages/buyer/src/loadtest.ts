/**
 * code402 self-settlement load test — LABELED VOLUME, NEVER COUNTED AS DEMAND.
 *
 * Runs a tunable number of real x402 purchases against the live gateway from a
 * dedicated, publicly declared load-test wallet. Every call is a genuine 402 →
 * sign → settle round trip on Base Sepolia. Every receipt is written to an
 * append-only JSONL evidence log, and the run ends with a summary + SHA-256
 * of the log so the volume can be published with proof and labeled
 * self_trade=true on the trust page.
 *
 * Usage:
 *   BUYER_PRIVATE_KEY=0x... npx tsx src/loadtest.ts
 *
 * Env (all optional except the key):
 *   BUYER_PRIVATE_KEY   Sepolia test wallet key (TESTNET ONLY — never mainnet)
 *   GATEWAY_URL         default https://gateway.code402.dev
 *   TARGET_CALLS        total paid calls to attempt (default 1000)
 *   CONCURRENCY         parallel workers (default 4)
 *   RATE_PER_SEC        global paid-call rate cap (default 2 — see notes)
 *   DRY_RUN             "1" = no key needed, measures only the unpaid 402 path
 *
 * Real-world constraints (learned, not guessed):
 *  - The public x402 facilitator settles every payment on Sepolia. Sustained
 *    millions/day depends on its rate limits — ramp RATE_PER_SEC and watch
 *    failures before scaling.
 *  - Each call spends test USDC ($0.001 basic tier). 1M calls = $1,000 test
 *    USDC. The seller wallet is ours (0x417D…0D58), so funds can be recycled
 *    back to the buyer between phases.
 *  - Cloudflare cost at 6M requests/day burst: ~$0 within the paid plan's
 *    included 10M requests + ~$0.36 CPU overage.
 */
import type { Hex } from "viem";
import { createSigner, wrapFetchWithPayment, type Signer } from "x402-fetch";
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync, readFileSync } from "node:fs";

const NETWORK = process.env.NETWORK ?? "base-sepolia";
const GATEWAY_URL = process.env.GATEWAY_URL ?? "https://gateway.code402.dev";
const TARGET = Number(process.env.TARGET_CALLS ?? "1000");
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? "4"));
const RATE = Math.max(0.1, Number(process.env.RATE_PER_SEC ?? "2"));
const DRY_RUN = process.env.DRY_RUN === "1";
const ENDPOINTS = ["/api/weather", "/api/echo"];
const LOG = `loadtest-evidence-${new Date().toISOString().slice(0, 10)}.jsonl`;

const minIntervalMs = 1000 / RATE;
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + minIntervalMs;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

type Outcome = {
  i: number;
  ts: string;
  endpoint: string;
  unpaidStatus: number;
  paidStatus: number;
  latencyMs: number;
  tx?: string;
  error?: string;
};

const stats = { ok: 0, failed: 0, unpaidWrong: 0, latencies: [] as number[] };

async function oneCall(i: number, paidFetch: typeof fetch | null, payer: string) {
  await throttle();
  const endpoint = ENDPOINTS[i % ENDPOINTS.length]!;
  const url = new URL(endpoint, GATEWAY_URL).toString();
  const t0 = Date.now();
  const out: Outcome = {
    i,
    ts: new Date().toISOString(),
    endpoint,
    unpaidStatus: 0,
    paidStatus: 0,
    latencyMs: 0,
  };
  try {
    const unpaid = await fetch(url);
    out.unpaidStatus = unpaid.status;
    if (unpaid.status !== 402) {
      stats.unpaidWrong++;
      out.error = `unpaid probe returned ${unpaid.status}`;
    } else if (!DRY_RUN && paidFetch) {
      const init: RequestInit = endpoint.endsWith("/echo")
        ? { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ loadtest: true, i, payer }) }
        : {};
      const paid = await paidFetch(url, init);
      out.paidStatus = paid.status;
      await paid.text().catch(() => "");
      const rcpt = paid.headers.get("x-payment-response");
      if (rcpt) {
        try {
          out.tx = JSON.parse(Buffer.from(rcpt, "base64").toString()).transaction;
        } catch { /* receipt parse is best-effort */ }
      }
      if (paid.status === 200) stats.ok++; else { stats.failed++; out.error = `paid ${paid.status}`; }
    }
  } catch (e) {
    stats.failed++;
    out.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
  }
  out.latencyMs = Date.now() - t0;
  stats.latencies.push(out.latencyMs);
  appendFileSync(LOG, JSON.stringify(out) + "\n");
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  console.log(`code402 load test — LABELED SELF-TRADE VOLUME`);
  console.log(`gateway=${GATEWAY_URL} target=${TARGET} concurrency=${CONCURRENCY} rate=${RATE}/s dryRun=${DRY_RUN}`);
  console.log(`evidence: ${LOG}`);

  let payer = "DRY_RUN";
  let paidFetch: typeof fetch | null = null;
  if (!DRY_RUN) {
    const key = process.env.BUYER_PRIVATE_KEY;
    if (!key) {
      console.error("BUYER_PRIVATE_KEY not set (or use DRY_RUN=1 for the unpaid path)");
      process.exit(1);
    }
    const signer: Signer = await createSigner(NETWORK, key as Hex);
    payer = "address" in signer && signer.address ? String(signer.address) : "unknown";
    paidFetch = wrapFetchWithPayment(fetch, signer) as unknown as typeof fetch;
    console.log(`payer (public label): ${payer}`);
  }

  const started = Date.now();
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const i = idx++;
      if (i >= TARGET) return;
      await oneCall(i, paidFetch, payer);
      if ((i + 1) % 100 === 0) {
        const dt = (Date.now() - started) / 1000;
        console.log(`progress ${i + 1}/${TARGET} ok=${stats.ok} failed=${stats.failed} unpaidWrong=${stats.unpaidWrong} elapsed=${dt.toFixed(0)}s`);
      }
    }
  });
  await Promise.all(workers);

  const lat = stats.latencies.sort((a, b) => a - b);
  const hash = createHash("sha256").update(readFileSync(LOG)).digest("hex");
  const summary = {
    label: "self_trade_loadtest",
    payer,
    gateway: GATEWAY_URL,
    network: NETWORK,
    target: TARGET,
    completed: stats.ok + stats.failed + (DRY_RUN ? TARGET - stats.unpaidWrong : 0),
    paidOk: stats.ok,
    failed: stats.failed,
    unpaidProbeAnomalies: stats.unpaidWrong,
    latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99) },
    wallClockSec: Math.round((Date.now() - started) / 1000),
    evidenceFile: LOG,
    evidenceSha256: hash,
    note: "All volume in this file is self_trade=true. It is excluded from demand metrics and published only as proof of throughput and of the labeling machinery.",
  };
  writeFileSync(LOG.replace(".jsonl", "-summary.json"), JSON.stringify(summary, null, 2));
  console.log("\n=== RUN SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
}

await main();
