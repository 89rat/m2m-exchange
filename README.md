# m2m-exchange

Machine-to-machine payment exchange built on **Cloudflare Workers** + the
**x402 payment protocol** (HTTP 402, USDC micropayments). Buyer agents pay
per-request; seller agents expose paid APIs behind an edge gateway.

**Phase 0 (this repo):** one working end-to-end *paid* HTTP request on the
Base Sepolia testnet — a buyer agent script pays USDC via x402 to call a demo
seller API behind a gateway worker.

**Live deployment (testnet):** https://m2m-gateway.akrivis.workers.dev
Free probe: `curl https://m2m-gateway.akrivis.workers.dev/healthz`
Seller wallet (receives test USDC): `0x2CC9237752CFEe65dB46530a958469E7ff12ac6B`
Testnet USDC only — no mainnet, no real funds.

## Architecture

```
                        HTTP GET /api/weather
          ┌──────────────────────────────────────────┐
          │                                          ▼
   ┌─────────────┐   402 + payment requirements   ┌────────────────────┐
   │ buyer agent │ ◄─────────────────────────────  │  gateway worker    │
   │ (x402-fetch │                                 │  (Cloudflare       │
   │  + viem)    │   GET + X-PAYMENT (EIP-3009     │   Workers + Hono   │
   │             │ ─────────────────────────────►  │   + x402-hono      │
   │ pays USDC   │    signed authorization)        │   middleware)      │
   └─────────────┘                                 └─────────┬──────────┘
          │                                                  │ verify+settle
          │                                          ┌───────▼──────────┐
          └─────────── USDC on Base Sepolia ───────► │ facilitator      │
                    (settled on-chain, 200 OK +      │ (x402.org public │
                     X-PAYMENT-RESPONSE receipt)     │  testnet service)│
                                                     └──────────────────┘
```

The gateway fronts the demo seller API. For P0 the demo paid endpoints live
inside the gateway worker itself (no separate seller worker — deliberately
kept simple).

### The 402 flow

1. Buyer sends a plain request to a paid route.
2. Gateway responds `402 Payment Required` with a JSON body:
   `{ x402Version: 1, accepts: [ { scheme: "exact", network: "base-sepolia",
   maxAmountRequired: "1000", payTo, asset, ... } ], error }`.
3. `x402-fetch` picks a requirement, signs an EIP-3009 `transferWithAuthorization`
   for the USDC amount with the buyer wallet, and retries with an
   `X-PAYMENT` header.
4. The gateway's `paymentMiddleware` asks the facilitator to verify and settle
   the payment on Base Sepolia, then runs the route handler and returns
   `200 OK` with the payload plus an `X-PAYMENT-RESPONSE` receipt header
   (tx hash, network, payer).

## Repository layout

```
m2m-exchange/
  package.json              # npm workspaces root (dev, test, typecheck, buy)
  tsconfig.base.json
  .dev.vars.example         # documented placeholders — no real keys
  protocol/
    PROTOCOL.md             # M2M/1 commerce protocol spec (state machine, messages)
    schemas/                # JSON Schema (2020-12) for every M2M/1 message
  workers/
    gateway/                # Hono gateway + x402 payment middleware
      src/index.ts          #   /healthz (free), /api/weather + /api/echo ($0.001)
      test/index.spec.ts    #   vitest, runs inside the Workers runtime
      wrangler.toml         #   name "m2m-gateway", nodejs_compat
  packages/
    protocol/               # @m2m/protocol: shared M2M/1 TS types (zero deps)
      src/index.ts          #   messages, TxState, error codes, §6.4 guard helpers
    buyer/
      src/buyer.ts          # Node CLI: pays USDC and fetches a paid endpoint
```

## Prerequisites

- Node.js >= 20 (developed on v24)
- Two Base Sepolia test wallets (one buyer, one seller). Any EVM wallet tool
  can generate them; never reuse mainnet keys.
- Testnet USDC in the **buyer** wallet from the Circle faucet:
  https://faucet.circle.com (select Base Sepolia, paste the buyer address).
  $0.10 of test USDC pays for ~100 requests at $0.001.

## Setup

```bash
npm install
cp .dev.vars.example workers/gateway/.dev.vars
# edit workers/gateway/.dev.vars: set SELLER_WALLET_ADDRESS to the seller wallet address
```

The buyer's private key is **not** read by wrangler — export it in your shell:

```bash
export BUYER_PRIVATE_KEY=0x<buyer wallet private key>   # testnet key only!
export GATEWAY_URL=http://localhost:8787                  # optional; this is the default
```

## Run your first paid request

Terminal 1 — start the gateway locally:

```bash
npm run dev          # wrangler dev on http://localhost:8787
```

Terminal 2 — run the buyer agent:

```bash
npm run buy                    # pays $0.001, calls /api/weather
npm run buy -- /api/echo       # pays $0.001, POSTs to /api/echo
```

The buyer prints the raw 402 payment requirements, the paid response body,
and the on-chain payment receipt. Free route for comparison:

```bash
curl http://localhost:8787/healthz
```

## Verify

```bash
npm run typecheck   # tsc --noEmit in gateway + buyer
npm test            # vitest in the Workers runtime (miniflare, no on-chain calls)
```

Unit tests cover: `/healthz` is free, paid routes return 402 with payment
requirements, and the 402 body matches the x402 spec (`x402Version`,
`accepts[]` with scheme/network/amount/payTo/asset). No on-chain settlement
is attempted in tests.

## x402 packages used

| package      | version | role                                        |
| ------------ | ------- | ------------------------------------------- |
| `x402`       | ^1.2.0  | protocol core (types, schemes, facilitator) |
| `x402-hono`  | ^1.2.0  | server `paymentMiddleware` for Hono         |
| `x402-fetch` | ^1.2.0  | client `wrapFetchWithPayment`               |
| `viem`       | ^2.55.x | wallet/signing (used by x402 and the buyer) |
| `hono`       | ^4.13.x | gateway HTTP framework                      |

Notes:

- Newer scoped `@x402/*` packages exist on npm (v2.x line); this repo pins the
  documented v1 line (`x402`, `x402-hono`, `x402-fetch`), which the brief
  targets.
- The facilitator defaults to the public testnet facilitator at
  `https://x402.org/facilitator` (built into the `x402` package) — no API key
  required. To use a different facilitator (e.g. Coinbase CDP), set
  `FACILITATOR_URL` in `workers/gateway/.dev.vars`.
- Payment network is `base-sepolia`; price is `$0.001` (1000 USDC base units)
  per call.

## Roadmap

- **P1** — seller registry (who sells what, at what price), Cloudflare D1 for
  registry/metadata storage, typed buyer/seller SDKs wrapping the raw x402
  flow, service discovery endpoint.
- **P2** — Durable Object clearing ledger for per-pair netting (aggregate many
  micropayments, settle net amounts on-chain periodically instead of paying
  gas per request), reconciliation jobs, dispute/audit trail.
