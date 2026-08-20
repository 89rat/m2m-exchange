# MAINNET.md — flipping m2m-exchange to Base mainnet (real USDC)

The platform is mainnet-ready in code. This document is the gate: every box
must be checked before `NETWORK=base` is deployed. Real money is unforgiving —
testnet habits leak, and the leak is expensive exactly once.

Operating entity: **JUANA LIMITED**, registered in England & Wales,
Company No. 14043409 — Unit 7, Edison Building, Electric Wharf, Coventry,
CV1 4JA, UK. The legal opinion, screening posture, and any money-services
analysis in this gate are obtained for and in the name of this entity.

## What the code already does

- `workers/gateway/src/network.ts` is the single network/facilitator switch:
  - `NETWORK` env: `base-sepolia` (default) or `base`.
  - USDC contract resolved per network (Sepolia `0x036C…`, mainnet `0x833589…`).
  - Mainnet REQUIRES the Coinbase CDP facilitator — the public
    `x402.org/facilitator` serves testnets only (verified against its
    `/supported` endpoint: v1 `base-sepolia` + `solana-devnet` only).
  - Missing CDP keys on mainnet = the worker refuses to boot (fail closed).
- Buyer CLI: `NETWORK=base npm run buy` pays real USDC.
- Fee engine, receipts, prepaid ledger, registry: network-agnostic.

## Prerequisite: funds on the right chain

The 25.4901 USDC withdrawn on **Ethereum mainnet** cannot pay a Base gateway.
Either bridge it (https://bridge.base.org) or withdraw fresh from the exchange
directly on **Base**. The paying wallet also needs ~$1–2 of **ETH on Base**
for gas. x402 settlement itself is facilitator-sponsored; gas is for the
buyer's own EIP-3009 signing-adjacent transactions and wallet management.

## The checklist (in order)

### 1. Coinbase CDP keys (user action — cannot be automated)
- [ ] Create a CDP project at https://cdp.coinbase.com → API Keys → new key
- [ ] `npx wrangler secret put CDP_API_KEY_ID`
- [ ] `npx wrangler secret put CDP_API_KEY_SECRET`
- [ ] Verify: CDP dashboard shows the key with x402 facilitator scope

### 2. Wallet posture
- Designated platform receiving wallet (JUANA LIMITED):
  `0x417Da74CDc0D3BabF6AdC851b6E5c638574c0D58` — the payTo in every
  first-party 402 challenge (testnet now, mainnet after this gate).
- [ ] Seller/platform receiving wallet moved off the dev box: hardware wallet
      or dedicated account. The gateway never signs (receiving only), but the
      withdrawal key is now worth real money.
- [ ] Buyer wallet for pilot: the funded `0xd654…4729`-style wallet, key in a
      password manager, NEVER in the repo, `.dev.vars` is gitignored — keep it
      that way.
- [ ] Confirm zero mainnet private keys anywhere in git history:
      `git log -p | grep -c "0x[0-9a-f]\{64\}"` should find only addrs (40 hex)

### 3. Safety controls
- [ ] Rate limiting on free routes (`/healthz`, `/v1/services`, `/llms.txt`)
      via Cloudflare WAF rules in the dashboard
- [ ] Sanctions screening plan documented (even if v1 = blocklist check on
      `payTo` config + known-bad payer list)
- [ ] Reconciliation job: receipts table vs on-chain settlements, daily

### 4. Flip
- [ ] `wrangler.toml`: set `NETWORK = "base"` in `[vars]`
- [ ] `npm run typecheck && npm test` (tests pin `base-sepolia` via env default;
      they must pass unchanged)
- [ ] `npx wrangler deploy`
- [ ] Verify 402 shows mainnet terms:
      `curl -s https://gateway.code402.dev/api/weather | jq .accepts[0].network`
      → `"base"`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

### 5. First real paid call (the milestone)
- [ ] `NETWORK=base GATEWAY_URL=https://gateway.code402.dev BUYER_PRIVATE_KEY=0x... npm run buy`
- [ ] Confirm on BaseScan: tx from buyer wallet → seller wallet, $0.001 USDC
- [ ] Confirm receipt row in D1
- [ ] Screenshot it. That's the first real dollar through your own rail.

### 6. Rollback
- `NETWORK = "base-sepolia"` in `[vars]`, redeploy. 60 seconds, nothing else
  changes. Testnet and mainnet are one env var apart by design.

## Standing rule

Prices are in USD terms; the facilitator settles exact USDC amounts. Start
with the current $0.001/$0.005 tiers — mainnet pilot is about proving the
flow, not maximizing ticket size. Raise prices after 100 clean settlements.
