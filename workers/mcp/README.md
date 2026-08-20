# code402-mcp-server (`@m2m/mcp`)

MCP endpoint for the code402 / m2m-exchange estate: lets any MCP client
(Claude, Cursor, Bedrock AgentCore, …) discover machine-payable services,
probe x402 payment terms, and run seller operations against the gateway.

**Non-custodial by design** (STRATEGY.md law #1): no tool touches funds or
private keys. Paying for a service stays in the buyer's own x402 client
(`x402-fetch` + the buyer's wallet); this server covers everything around
the payment.

## Protocol profile

Stateless streamable-HTTP JSON: `POST /mcp` with one JSON-RPC message per
request, JSON response in the body. No sessions, no SSE — every request is
served by a fresh server instance (see `src/transport.ts` for the Workers
adapter around the official `@modelcontextprotocol/sdk`). Notifications
return `202`; `GET /mcp` returns `405` with a hint.

## Tools

| Tool | Access | What it does |
|---|---|---|
| `code402_list_services` | read | Storefront listing with filter + pagination (`GET /v1/services`) |
| `code402_get_service` | read | One service by `serviceId`, with close-match hints |
| `code402_probe_endpoint` | read | Unpaid GET to any public https URL; normalizes x402 402 terms (SSRF-guarded) |
| `code402_gateway_health` | read | Gateway `/healthz` + configured settlement network |
| `code402_register_seller` | write | `POST /v1/sellers` — register/update a seller (payments go to the seller's wallet) |
| `code402_create_listing` | write | `POST /v1/sellers/{id}/services` — put an API behind the x402 paywall |
| `code402_get_seller_analytics` | read | Seller's own settled calls, gross, unique buyers |
| `code402_get_seller_invoice` | read | Take-rate invoice from settled receipts (integer USDC units) |

## Configuration

- `GATEWAY_URL` (wrangler var): gateway base URL, default `https://gateway.code402.dev`.
  Point it at a local `wrangler dev` gateway during development.

## Develop & test

```bash
npm run dev -w @m2m/mcp        # wrangler dev (POST JSON-RPC to /mcp)
npm run test -w @m2m/mcp       # vitest in the Workers runtime (outbound fetch stubbed)
npm run typecheck -w @m2m/mcp
```

Example smoke call against a running instance:

```bash
curl -s localhost:8787/mcp -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"tools/list"
}' | jq '.result.tools[].name'
```

## Evals

`evals/eval.xml` holds 10 read-only Q&A pairs (see the mcp-builder skill's
format) written against the gateway's first-party catalog. They assume the
P0 demo services are live; re-verify answers after catalog changes.

## Deploy

The endpoint is advertised as `atlas.code402.dev/mcp`. The route in
`wrangler.toml` is commented out — attaching it takes over that hostname/path,
so the flip is a manual decision, same policy as `workers/landing`.
