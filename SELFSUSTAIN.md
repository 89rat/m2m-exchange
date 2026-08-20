# SELFSUSTAIN.md — the break-even scorecard

Self-sustaining, concretely (STRATEGY.md law #4): **monthly revenue ≥ monthly
burn, with burn < $500/mo, for 30 consecutive days** (H2's metric). This page
is the ledger for that question. Live inputs come from `GET /v1/stats` on the
gateway — the flywheel's public telemetry (LOOPS.md T3).

## 1. The cost base (small team + subscriptions + Cloudflare)

Fill in actuals; defaults are the expected ceiling. Everything else (salaries)
is deliberately out of scope until H3 per law #4.

| Line item | Expected | Actual |
|---|---|---|
| Cloudflare Workers paid plan | $5/mo | |
| Domains (code402.dev, codex402.dev, akrivis…) | ~$5/mo amortized | |
| Claude subscription (the build/ops loop) | $20–200/mo | |
| CDP facilitator fees (1,000 free, then $0.001/settle) | ~$0 at current volume | |
| RPC / misc | $0–10/mo | |
| **Burn ceiling** | **≤ $500/mo (law #4)** | |

## 1b. First 90 days: the $2,500 bridge

Stated goal: **$2,500 of revenue across the first 3 months (~$833/mo), then
the flywheel takes over.** In the first 90 days of a two-sided marketplace
starting from zero, neither 29 Pro sellers nor $41K/mo of GMV is realistic —
so the bridge revenue comes from the asset that already exists: JUANA LIMITED
is an IT consultancy, and the fastest first dollars are **productized
launches**, sold around the platform, delivered on it.

**The offer — "Concierge launch" ($750 fixed, one week):** we make your API
agent-payable end to end: seller registration + EIP-191 verification, listing
and pricing setup, MCP exposure, atlas Live-verified badge, receipts/invoice
walkthrough, and a working paid call from a real agent. Zero new code needed —
every deliverable is a feature that already exists on the gateway.

Routes to $2,500, ranked by probability:

| Route | 90-day realistic | Contribution |
|---|---|---|
| A. Concierge launches (3–4 × $750) | 3 closes from ~15 conversations | **$2,250** |
| B. Pro subscriptions (each launch converts) | 4–8 sellers × $29 × 1–2 mo | $150–450 |
| C. GMV take-rate (2%) | <$2K GMV in month 3 | <$40 |

A + B clears $2,500 without route C mattering — and every concierge launch
*is* flywheel fuel: a live seller, a verified listing, stats on the board,
invitations propagating. The service revenue and the flywheel are the same
motion.

Milestones: **wk 1** deploy estate + mainnet gate · **wk 2–6** fifteen seller
conversations (targeting below) · **wk 3–10** deliver 3–4 launches ·
**wk 12** review: if `/v1/stats` shows strangers transacting, shift weight
from services to flywheel; if not, sell 4 more launches.

### Who the fifteen conversations are (ICP targeting)

Lead with **ICP-0 — the founder's own domain**: PLM & engineering-data
owners. This is where credibility is already earned, and it maps to the
highest-value calls in the ecosystem:

| ICP | Who | The pitch that lands |
|---|---|---|
| **0. PLM / engineering data** (warmest) | PLM catalog owners, CAD/STEP model libraries, FEA/simulation-as-a-service, compliance registries (RoHS/REACH checks) | "Let a design agent buy one certified STEP model or one solver run for $5 — no 12-month license, no PO, paid to your wallet." |
| **1. Scraped-and-abused data providers** | Niche datasets (real-estate feeds, logistics rates, patent/parts registries) being crawled for free | "Answer scrapers with 402 instead of 403 — turn bot traffic you already pay to serve into per-call revenue." (Seller-consented, on their own endpoints.) |
| **2. Indie tool builders** | Solo devs with single-purpose utilities (OCR, extraction, conversion) | "Monetize in 5 minutes with zero billing infrastructure; agents that need you once can pay you once." |
| **3. Agent agencies / integrators** | Teams building client workflows on LangChain/CrewAI etc. | "Stop juggling 20 API subscriptions per client — one wallet, pay per invocation, consolidated receipts." |

Sequencing: five ICP-0 conversations first (existing network), then five
ICP-1 (findable: whose robots.txt and WAF pages show scraper pain), then
five across ICP-2/3 (developer communities, honest participation — no
covert seeding per DISTRIBUTION.md).

## 2. The break-even equation

Revenue streams that exist in code today: 2% take-rate (Free tier),
1.5% + $29/mo (Pro tier), promoted placement (priced later).

```
$500/mo  =  17 Pro sellers × $29
         or $25,000/mo GMV × 2%
         or any mix:  29·P + 0.02·G ≥ 500
```

Open pricing decision (owner call, not code): Pro is currently $29/mo +
1.5% take. Alternative worth considering: **$29/mo + 0% take** ("keep 100%
of your revenue") — a stronger conversion pitch that caps platform upside;
switch is one line in `scheduleForTier` if chosen.

Reference mixes:

| Pro sellers | GMV needed/mo | Comment |
|---|---|---|
| 0 | $25,000 | pure take-rate — needs ~$830/day of settled volume |
| 5 | $17,750 | |
| 10 | $10,500 | |
| **17** | **$0** | subscription-only break-even — the fastest credible path |

At the assay's ecosystem reality (~$28–50K/day organic volume across ALL of
x402), capturing $830/day of GMV is a ~2% ecosystem share — hard. Seventeen
Pro sellers is a sales problem, not a share-of-ecosystem problem. **The
flywheel's near-term job is Pro sellers; GMV take-rate compounds later.**

## 3. The five numbers (from /v1/stats)

| # | Metric | Source | Self-sustain threshold |
|---|---|---|---|
| 1 | Stranger transactions/week | `last_30d.unique_payers` (excl. own wallets) | > 0, rising |
| 2 | GMV mix above $1/tx | `top_services.gross_usd` distribution | rising |
| 3 | K-factor | sellers who arrived via receipt invitations | → 1 |
| 4 | Net revenue days | §1 actuals vs (2% × `gross_usd` + 29 × `pro_sellers`) | 30 straight |
| 5 | Take-rate integrity | invoices settled ÷ invoices issued | ~100% |

## 4. The flywheel and its trigger conditions

Each stage is armed by the previous one; the machine parts are built — the
starter motor is deployment.

```
deploy → indexed → first stranger call → invitation propagates → sellers list
   ↑                                                                  │
   └── stats climb → landing proof strengthens → more sellers ────────┘
```

| Stage | Trigger | Status |
|---|---|---|
| Live estate | routes flipped + `wrangler deploy` ×3 | ⏳ human switch |
| Discoverable | Bazaar/MCP-directory indexing + llms.txt crawled | code ready |
| First stranger | a real agent pays a listed service | needs the above |
| Propagation | invitation payload in every paid response | live in code |
| Proof compounds | /v1/stats → landing live strip | live in code |
| Revenue | Pro upgrades + monthly invoices | engine live, billing at mainnet |

## 5. The three switches only a human can flip

1. **Deploy the estate** — uncomment routes in `workers/landing/wrangler.toml`
   and `workers/mcp/wrangler.toml`, then `wrangler deploy` in landing, mcp,
   and gateway. (~30 minutes)
2. **Mainnet gate** (MAINNET.md) — CDP keys, hardware posture for
   `0x417Da74CDc0D3BabF6AdC851b6E5c638574c0D58`, screening plan. Without
   `NETWORK=base`, revenue is structurally $0.
3. **First ten seller conversations** — the flywheel amplifies traction; it
   does not create the first sellers. Ten humans with APIs worth $1+/call,
   pointed at the 60-second onboarding. Everything after them compounds.

## 6. Review cadence

The improvement loop keeps shipping (LOOPS.md backlog). Review this page
weekly against /v1/stats; when metric #4 hits 30 consecutive days, this file
gets a `STATUS: SELF-SUSTAINING` header and H3 begins.
