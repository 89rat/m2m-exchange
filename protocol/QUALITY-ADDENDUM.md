# Quality & Accountability Addendum

**Document:** QA-ADDENDUM v1.0 · **Applies to:** the code402 estate
(gateway.code402.dev, code402.dev, the code402 MCP endpoint)
**Operator:** JUANA LIMITED (England & Wales, Company No. 14043409)
**Change control:** this document is versioned in the public repository;
every amendment is a signed git commit with full history.

This addendum states the platform's quality posture in three pillars. Every
clause carries its **verification method** — a code path, a live endpoint, or
a public record. No clause relies on the operator's word alone. Claims we
cannot yet prove appear in §5 (Limitations), not in the pillars.

---

## Pillar I — Provable quality disciplines

Defects are prevented by construction, not by policy. Each discipline is
enforced in code and exercised by the automated suite on every commit.

| # | Discipline | Implementation | Verification method |
|---|---|---|---|
| I.1 | Integer money only | All monetary amounts are integer USDC base units (6 decimals) end to end; floating point is excluded from money paths (M2M/1 §2.3) | `packages/protocol/src/fees.ts` (BigInt arithmetic, property tests); repo rule in `AGENTS.md` |
| I.2 | Fail-closed configuration | Malformed price configuration or absent mainnet credentials cause the worker to refuse service rather than serve wrong terms | `workers/gateway/src/index.ts` `priceConfig()` (throws at construction); `network.ts` mainnet key check; tests assert the throw |
| I.3 | Verify-then-serve | Payment is verified and settled before the resource handler executes; no optimistic delivery | `x402-hono` middleware ordering in `workers/gateway/src/index.ts`; documented rejection of optimistic serving in `protocol/LOOPS.md` |
| I.4 | Durable receipts | Every settled payment writes a receipt (timestamp, payer, tx hash) with an **awaited** write — a dropped receipt is treated as a financial defect, not telemetry loss | receipt middleware in `workers/gateway/src/index.ts` and `registry.ts` (comment: pre-release audit §7); D1 `receipts` table |
| I.5 | Adversarial-input posture | Seller-supplied URLs pass an SSRF guard (private/loopback/metadata ranges rejected); payment-header parsing is fuzz-tested against hundreds of malformed payloads — never a 5xx, never a false accept | `upstreamAllowed()` + SSRF test matrix; fuzz suite in `workers/gateway/test/index.spec.ts` |
| I.6 | Uniform terms | The price in a 402 challenge is identical for every caller; per-caller discrimination is a rejected design (recorded, with reasons) | `protocol/LOOPS.md` (rejected list); `protocol/ATLAS-VERIFICATION.md` §3 terms-consistency check applies the same bar to every listed seller |
| I.7 | Tested in the production runtime | The full test suite executes inside the Cloudflare Workers runtime (vitest-pool-workers), not a Node simulator, on every commit | `.github/workflows/ci.yml`; public Actions history on the repository |
| I.8 | Wallet ownership is proven, not claimed | Sellers earn the verified badge via EIP-191 challenge/response against their registered wallet | `/v1/sellers/{id}/verify-challenge` + `/verify`; roundtrip and wrong-signer tests |

## Pillar II — Measured reliability

Quality is measured, not asserted. The measurement surfaces are public and
machine-readable; definitions are fixed here so numbers cannot be quietly
redefined.

| # | Measurement | Definition | Where to read it |
|---|---|---|---|
| II.1 | Settlement telemetry | Settled calls, gross volume, unique payers — lifetime and rolling 30 days; aggregates only | `GET gateway.code402.dev/v1/stats` (60s cache) |
| II.2 | Per-call receipts | Every paid response carries the settlement receipt (payer, tx hash); receipts reconcile 1:1 against on-chain settlements | `receipt` object in paid responses; `X-PAYMENT-RESPONSE` header |
| II.3 | Machine contract | The full public API surface with payment semantics | `GET gateway.code402.dev/openapi.json`, `/.well-known/x402.json` |
| II.4 | Directory liveness | Listings are probed on schedule; states (`live/stale/dead`), freshness windows, and anti-gaming rules are specified and the badge is unforgeable by policy — including by the operator | `protocol/ATLAS-VERIFICATION.md` (normative) |
| II.5 | Build health | Typecheck + full suite on every push, publicly visible | GitHub Actions on the repository |

**Mainnet commitments** (activate with the `NETWORK=base` flip, per the
published gate): daily receipts-vs-chain reconciliation (MAINNET.md §3);
service-level objectives published only after 90 days of production
measurement — targets will be derived from observed data, not invented.

## Pillar III — Accountable operator

| # | Fact | Verification method |
|---|---|---|
| III.1 | Operating entity: **JUANA LIMITED**, England & Wales, Company No. **14043409**, registered office Unit 7, Edison Building, Electric Wharf, Coventry, CV1 4JA, UK | Companies House public register |
| III.2 | Payment destination transparency: the platform's receiving wallet is published (`0x417Da74CDc0D3BabF6AdC851b6E5c638574c0D58`) and appears verbatim in every first-party 402 challenge | `workers/gateway/wrangler.toml`; any unpaid request to a first-party route |
| III.3 | Non-custodial architecture: buyer funds settle on-chain directly to seller wallets; the operator holds no client money at any time | `createSellerProxy()` (seller wallet as `payTo`); STRATEGY law #1; splitter-contract design (LOOPS.md T10) preserves this property by contract code |
| III.4 | Governance in public: operating laws, mainnet gate, rejected designs, and this addendum live in the public repository with full change history | `STRATEGY.md`, `MAINNET.md`, `protocol/LOOPS.md`, this file |
| III.5 | Escalation | `hello@code402.dev`; company service address above for formal notice |

## §4 — Risk allocation summary (what the model means for a counterparty)

- The operator's insolvency or compromise cannot trap client funds: there are
  none held (III.3).
- A gateway outage stops *new* paid calls; it cannot reverse or lose settled
  value — settlement is on-chain and receipts are durable (I.4, II.2).
- Wrong-price risk is bounded by construction: misconfiguration halts service
  rather than serving wrong terms (I.2), and quoted terms are uniform (I.6).

## §5 — Limitations (stated, not buried)

1. **Network status:** the platform currently settles on Base Sepolia
   (testnet). Mainnet activation is gated by the published checklist
   (MAINNET.md), including legal opinion and screening posture.
2. **Certifications:** the operator holds no SOC 2, ISO 27001, or equivalent
   attestation at this time. If and when pursued, reports will be referenced
   here; until then, assurance rests on the verifiable clauses above.
3. **SLOs:** no numeric availability/latency objectives are published yet —
   deliberately, until 90 days of production data exist (II, mainnet
   commitments).
4. **Regulatory perimeter:** the UK licensing analysis for the platform's fee
   models (including the contract-mediated split, LOOPS.md T10) is a matter
   for the legal opinion at the mainnet gate and is not asserted here.
5. **Third-party dependencies:** settlement finality depends on the
   underlying network and facilitator (x402.org on testnet; Coinbase CDP at
   mainnet); their availability is outside the operator's control and is
   surfaced, not masked, in error responses.

---

*Amendments require a commit to the public repository; the git history is
the authoritative change log of this addendum.*
