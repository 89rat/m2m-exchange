# AGENTS.md — m2m-exchange (guidance for AI coding agents)

## What this is
M2M/1: the open commerce protocol for machines (discovery → quotes → orders → receipts)
above swappable payment rails (x402 today; fiat + prepaid specified in v1.1).
Includes a live multi-tenant marketplace gateway.

## If you're integrating agent payments
- Read protocol/PROTOCOL.md first (normative), then M2M-1.1-rails.md for multi-rail.
- Types: `@m2m/protocol` (workspace package) — always import types from there, never redefine.
- Live gateway: https://gateway.code402.dev (GET /v1/services is the machine storefront).
- Selling: POST /v1/sellers → POST /v1/sellers/{id}/services → payments go direct to seller wallet (non-custodial).

## Hard rules
- Integer money only (BigInt base units). Floats in money paths are bugs.
- All 402 challenges/prices must satisfy §6.4 agreement (accepts[] == order terms).
- Nonces/quotes/orders are single-use; idempotency-key every state-changing POST.
- Never custody funds. Partners (Stripe/chain) hold money; we hold receipts.

## Tests
vitest-pool-workers against real D1+DO semantics; `npm test` in workers/gateway.
