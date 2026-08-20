# Atlas Live-Verification — v1 (M2M/1 discovery extension)

Specification for the liveness-verification and badge system of the atlas
discovery index (atlas.code402.dev). The key words MUST, MUST NOT, SHOULD,
and MAY are to be interpreted as in RFC 2119.

Status: draft for implementation. Additive to M2M/1 (§6.1 ServiceDescriptor);
nothing below changes existing messages — verification data rides in a new
optional field.

## 1. Why this exists

Public x402 indexes decay: independent audits of the ecosystem found only
~21% of 78,000+ indexed routes pass a strict live 402 check, and most
published agent cards are not spec-compliant. An agent budgeting real money
cannot afford to pay a dead endpoint, and a directory that cannot tell live
from dead is worth nothing to it.

Atlas therefore treats **verification, not listing, as the product**. Listing
is free and open (anyone can be indexed); the verified state is earned by
passing recurring, machine-run probes. The probe history is first-party data
the index accumulates and no scraper can replicate — the durable half of a
discovery business.

## 2. Verification states

Every atlas listing is in exactly one state:

| State | Meaning |
|---|---|
| `unverified` | Indexed (crawled or submitted) but never probed successfully. |
| `live` | Last probe passed and is fresh (§4). The only state that earns the badge. |
| `stale` | Previously live; freshness window exceeded without a passing probe. |
| `dead` | N consecutive probe failures (§4). Delisted from default views. |

State transitions are monotone within a probe cycle: a listing moves toward
`live` only via a passing probe, and toward `dead` only via consecutive
failures. Manual overrides MUST NOT set `live` — the badge is unforgeable by
policy, including by us.

## 3. The probe

A probe is the same check the gateway's paid `/api/x402-probe` service
performs, run by the atlas prober on schedule:

1. Send the listing's declared method to its endpoint **without** an
   `X-PAYMENT` header, with a 10 s timeout.
2. **PASS** requires all of:
   - HTTP status is exactly `402`;
   - the body parses as JSON with a non-empty `accepts[]` array;
   - `accepts[0]` carries `scheme`, `network`, `maxAmountRequired`, `payTo`,
     and `asset`;
   - **terms consistency:** `maxAmountRequired`, `network`, and `payTo` match
     the listing's registered price, network, and seller wallet (integer
     base-unit comparison per M2M/1 §2.3). A live endpoint whose on-wire terms
     drift from its listed terms is a FAIL — mispriced listings are worse for
     a paying agent than dead ones.
3. Any other outcome (timeout, non-402, malformed body, terms mismatch) is a
   **FAIL** with a recorded reason code:
   `TIMEOUT | NOT_402 | BAD_BODY | TERMS_MISMATCH | TLS_ERROR | DNS_ERROR`.

The prober MUST NOT send payment. Liveness verification is free-tier
observation; paid conformance probing (does the API deliver what its schema
promises after settlement) is a separate, future tier (§8).

Probes SHOULD run from at least two network vantage points; a listing is
scored on the best result per cycle (an endpoint reachable from anywhere
counts as reachable).

## 4. Cadence and freshness

- Default probe cadence: every listing at least once per **6 hours**;
  promoted and high-traffic listings at least hourly.
- `live` freshness window: a passing probe within the last **24 hours**.
- `live` → `stale`: no passing probe for 24–72 hours.
- → `dead`: **3 consecutive** failed probes spanning at least 24 hours
  (a single bad deploy or transient outage never kills a listing).
- `dead` → `live`: a single passing probe restores it (with history intact).

All windows are configuration, not protocol; the values above are the launch
defaults and MUST be published on the atlas about page.

## 5. Badge data model

Verification rides in an optional `verification` object on the M2M/1
ServiceDescriptor (schema: `schemas/atlas-verification.json`, to be added
with the implementation):

```json
{
  "m2mVersion": 1,
  "serviceId": "acme-lookup",
  "endpoint": "/s/acme/lookup",
  "pricing": { "mode": "static", "price": { "amount": "50000", "asset": "0x…", "network": "base" } },
  "verification": {
    "state": "live",
    "lastProbeAt": 1787150000,
    "lastPassAt": 1787150000,
    "consecutiveFailures": 0,
    "failReason": null,
    "probeCount30d": 120,
    "passRate30d": 0.98,
    "sellerVerified": true
  }
}
```

Field rules:

- `state` MUST be one of the four states in §2.
- `lastProbeAt` / `lastPassAt` are Unix seconds; `lastPassAt` MUST be absent
  or ≤ `lastProbeAt`.
- `passRate30d` is passes ÷ probes over a rolling 30 days, two decimals.
- `sellerVerified` mirrors the gateway's EIP-191 wallet-ownership proof
  (registry `sellers.verified`) — a distinct axis from liveness: liveness
  says *the endpoint answers correctly*; sellerVerified says *a wallet owner
  claims it*. The directory renders them as separate badges.
- Consumers MUST treat a missing `verification` object as `unverified`.

## 6. Rendering rules (directory, directory.md, MCP)

- Default views (HTML directory, `/directory.md`, MCP list tool) MUST show
  only `live` listings first, then `stale` (labeled), and MUST NOT show
  `dead` listings except behind an explicit "show delisted" affordance.
- Every rendered listing MUST show state and `lastProbeAt` ("verified 2h
  ago") — an undated badge is indistinguishable from a lie.
- `/directory.md` puts the state machine-readably on each line, e.g.
  `- [acme/lookup](…) — $0.05 — live ✓ (probed 2026-08-19T14:00Z, 98% 30d)`.
- Ranking within the `live` set: `promoted` flag first (labeled ★, per the
  existing registry semantics), then **settlement telemetry** where the
  gateway has it (30-day settled calls, unique payers from receipts), then
  `passRate30d`, then age. Telemetry from our own receipts is the ranking
  input no rival index can scrape — use it, and say that we use it.

## 7. Anti-gaming

- **No pay-to-badge.** Promotion buys position *within* the live set, never
  the `live` state itself (§2's manual-override rule).
- **Terms consistency (§3.2)** blocks the bait-and-switch: listing $0.01 in
  the index while the wire demands $1.00.
- **Sybil pressure** on liveness is self-defeating (a probe passing means the
  endpoint genuinely serves a valid 402), but ranking telemetry could be
  wash-traded. Mitigation: unique-payer counts weigh more than raw call
  counts, and payers whose only activity is a single seller's services are
  discounted. Full wash detection lands with the settlement indexer.
- **Probe evasion** (serving 402 only to the prober's IPs) is why probes run
  from multiple vantages with unremarkable user agents; the prober's
  addresses MUST NOT be published.

## 8. Roadmap (non-normative)

- **v1.1 — paid conformance tier:** the prober pays (testnet first) and
  validates the response against the listing's `inputSchema`/output promise;
  earns a distinct `conformant` badge. This turns the existing paid
  `/api/x402-probe` service into the verification engine, and its probe
  spend into the directory's cost of goods.
- **v1.2 — public liveness report:** weekly auto-published stats (live rate,
  median endpoint lifetime, fail-reason mix) — the ecosystem citation asset.
- **v1.3 — verification webhooks:** sellers subscribe to state changes on
  their own listings (the first seller-side observability product).

## 9. Interop notes

- The `verification` object is an atlas extension; gateways and other indexes
  MAY copy it verbatim. It deliberately does not conflict with x402 v2
  discovery-extension metadata — atlas can attach it to descriptors sourced
  from any crawler.
- Nothing here creates custody, holds funds, or touches payment flow: the
  prober observes 402 challenges and (in v1.1+) pays as an ordinary buyer.
