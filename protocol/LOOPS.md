# Operational loops for m2m-exchange (working doc)

Distilled from an external architecture discussion (Gemini, Aug 2026) about
loop-driven x402 services, filtered against STRATEGY.md's laws and the
raw-materials research. Three buckets: what we adopt, what we already have,
and what we explicitly reject. The backlog at the bottom is the iteration
queue for the improvement loop working this branch.

## The core adopted principle: hot path / cold path

Every request-path operation must justify its milliseconds; everything else
runs out-of-band. Applied to this codebase:

- **Hot path (per request, target <15ms of our own overhead):** 402 challenge
  generation, payment verification via facilitator middleware, prepaid-ledger
  debit, response delivery. One deliberate exception, already codified in the
  pre-release audit: **receipt INSERTs stay awaited** — a dropped receipt is a
  financial-state loss, not telemetry. We trade a few ms for books that are
  always right. Do not "optimize" this into waitUntil.
- **Cold path (queues/cron, zero client latency):** invoice computation
  (already on-demand from receipts), future netting/batch settlement (P2,
  aligned with the official batch-settlement scheme), atlas liveness probes
  (ATLAS-VERIFICATION.md §4), analytics aggregation, dynamic price
  recalculation.

## The five loops, mapped to this repo

| Loop | Status here | Where |
|---|---|---|
| safety (caps, replay, SSRF) | partial | x402 middleware nonces; `upstreamAllowed` SSRF guard; WAF rate limits are a MAINNET.md checklist item |
| efficacy (verify what buyers get) | spec'd | ATLAS-VERIFICATION.md probe + terms-consistency check; receipts as ground truth |
| monetize (settle, invoice, batch) | partial | receipts → `/v1/sellers/{id}/invoice`; netting ledger is P2/H4 |
| viral (referral propagation) | live | `invitation` payload in every paid seller-proxy response |
| scale (telemetry → pricing) | not started | backlog T2 below |

## Adopted (queued in the backlog)

1. **Dynamic pricing hook.** x402 v2 supports per-request pricing callbacks;
   our prices are compile-time consts. Introduce a config-driven price source
   (env/KV) so ops can reprice without a deploy — surge pricing comes later,
   repriceability first.
2. **Cold-path telemetry counters.** Cheap per-route counters (calls,
   settled volume, unique payers) aggregated from receipts on a schedule —
   feeds seller analytics, atlas ranking (§6), and eventually pricing.
3. **Idempotency keys on paid routes.** Agent retries must not double-pay.
   The x402 nonce already prevents replay of the *same* signature; an
   `Idempotency-Key` honored for a short window prevents a *fresh* signature
   for a duplicate intent. Design in P1.x with the D1 receipts table.
4. **MCP paidTool exposure.** The @m2m/mcp worker lists services; the next
   step is exposing seller listings as MCP tools with price metadata so
   agent frameworks discover them natively.
5. **402-challenge hygiene rule (safety, adopted as a law of the spec).**
   Never place imperative text in 402 challenge fields (`description`,
   error strings) beyond factual terms. Agents feed 402 bodies into LLM
   context; challenge fields are a prompt-injection surface. Our own
   `invitation` payload stays in *paid response bodies* (post-payment,
   buyer already committed) and must remain factual — pitch, register URL,
   protocol link — never instructions to the reading model.

## Rejected (and why)

- **Float yield / "micro-treasury rehypothecation"** (routing customer
  payment float through lending pools): violates law #1 — we never custody
  funds, and buyer USDC settles direct to seller wallets. There is no float
  to rehypothecate, by design. The assay agrees: earn on *your own* stocks,
  never on funds in flight.
- **Fabricated attestations** (`proofHash: "0x8f2a..."` placeholders): a
  receipt must reference a real settlement (tx hash) or not exist. Fake
  "verifiable" hashes are the ERC-8004 Sybil swamp we're differentiating
  against.
- **Budget-sniffing price discrimination** (reading `x-agent-budget-cap` to
  raise prices): short-term surplus extraction, long-term reputation
  suicide — and exactly the behavior atlas's terms-consistency check (probe
  price must equal listed price) exists to catch in others. Surge pricing,
  if ever, must be symmetric and published, never per-caller.
- **256-shard dispatch-namespace swarm, today:** the platform does ~0 rps
  organic. Cloudflare's single-worker isolate model already runs in 300+
  PoPs; sharding adds state-consistency risk (distributed nonce sync) with
  zero present benefit. Revisit at sustained >1k rps. What we keep from the
  idea: stateless workers + D1/queue decoupling, which we already have.
- **Optimistic serving before verification** ("pre-flight liquidity mirage"
  exposure): our middleware verifies AND settles before the handler runs.
  Slower per call, immune to the $5-wallet/$500-compute reconnaissance
  attack described in the source conversation. Keep verify-then-serve until
  netting (P2) introduces bounded, collateralized credit.

## Iteration backlog (the loop works top-down)

- [x] T1: this distillation; commit; arm push-access watcher (push blocked
      by GitHub write permissions as of 2026-08-20).
- [x] T2: config-driven pricing — env `PRICE_BASIC`/`PRICE_PREMIUM` overrides
      with integer-unit derivation, fail-closed validation, and tests
      (`priceConfig` in workers/gateway/src/index.ts). Reprice via a var
      change + deploy; no code edit.
- [ ] T3: receipts → per-service telemetry rollup (cold path, cron or
      on-read aggregation; feeds analytics + future atlas ranking).
- [ ] T4: idempotency-key design note in PROTOCOL.md (§ TBD) for paid
      routes; implementation behind D1.
- [ ] T5: security pass on the branch (free-route rate limits, 402 field
      hygiene audit).
- [ ] T6: MCP paidTool metadata for dynamic seller listings.

Each tick: retry `git push` (branch `claude/x402-raw-materials-pditgf`),
advance the topmost unchecked item, run typecheck + tests, commit.
