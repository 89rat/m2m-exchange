# DEPLOY.md — taking the estate live (testnet)

The exact sequence, copy-paste ready. Works from a local machine with
`npx wrangler login`, or through the Cloudflare Developer Platform connector
in a Claude session. Mainnet is NOT this document — that's MAINNET.md.

## 0. Pre-flight (once)

- [ ] `npm install && npm run typecheck && npm test` — must be green (57 tests)
- [ ] Confirm control of the receiving wallet: send dust test-USDC (Base
      Sepolia) to `0x417Da74CDc0D3BabF6AdC851b6E5c638574c0D58` and see it
- [ ] Cloudflare dashboard → code402.dev zone → Email → Email Routing →
      route `hello@code402.dev` to a real inbox (the site publishes it)

## 1. Gateway (updates the existing worker in place)

No route change needed — `gateway.code402.dev` is already attached.

```bash
cd workers/gateway
npx wrangler deploy
# verify:
curl -s https://gateway.code402.dev/healthz                     # network base-sepolia
curl -s https://gateway.code402.dev/v1/stats | head -c 300      # NEW telemetry
curl -s https://gateway.code402.dev/openapi.json | head -c 200  # NEW manifest
curl -s https://gateway.code402.dev/api/weather | grep -o '0x417Da74[^"]*'  # NEW payTo
```

## 2. Landing (takes over the code402.dev root — the deliberate flip)

```bash
cd workers/landing
# uncomment in wrangler.toml:
#   routes = [ { pattern = "code402.dev", custom_domain = true } ]
npx wrangler deploy
# verify:
curl -s https://code402.dev/ | grep -o "Turn any API into"
curl -s https://code402.dev/llms.txt | head -3
curl -s https://code402.dev/.well-known/x402.json
```

If code402.dev currently serves something you want to keep, export it first —
this deploy replaces the root site.

## 3. MCP server

```bash
cd workers/mcp
# uncomment in wrangler.toml:
#   routes = [ { pattern = "mcp.code402.dev", custom_domain = true } ]
npx wrangler deploy
# verify:
curl -s https://mcp.code402.dev/healthz
curl -s https://mcp.code402.dev/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o 'code402_[a-z_]*' | sort -u   # 8 tools
```

(If you prefer `atlas.code402.dev/mcp` instead of the dedicated subdomain,
attach a route on the atlas zone/worker and update `workers/mcp/server.json`
`remotes[0].url` to match BEFORE the MCP-registry submission.)

## 4. Immediately after (same hour)

- [ ] `curl https://gateway.code402.dev/admin/indexnow` — ping crawlers
- [ ] GitHub repo topics: `x402, mcp, agent-payments, micropayments, usdc,
      cloudflare-workers`
- [ ] Start DISTRIBUTION.md tier-2 submissions (MCP registry via
      `mcp-publisher`, Smithery/PulseMCP/Glama) — LOOPS.md T7
- [ ] Buy-side smoke test end to end: `NETWORK=base-sepolia npm run buy`

## Rollback

Each worker is independent. `npx wrangler rollback` (or redeploy the previous
commit) reverts one worker without touching the others. Removing the landing
route returns the root domain to whatever served it before.
