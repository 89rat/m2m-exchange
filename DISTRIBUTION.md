# DISTRIBUTION.md — marketplace & registry runbook

Getting listed everywhere agents (and agent developers) look. Ordered by
leverage ÷ effort. Legend: 🤖 automatic once deployed · 🖱 human clicks
(~minutes) · 🔑 needs keys/gas/accounts. Deploy the estate first — every
surface below indexes the *live* endpoints, and dead listings hurt (the
ecosystem's #1 failure mode is graveyard indexes).

## Tier 1 — x402-native (agents discover tools here)

| Surface | How listing works | Who/when |
|---|---|---|
| **Coinbase x402 Bazaar** | Auto-indexed for sellers settling via the **CDP facilitator** with `discoverable: true`. Testnet/x402.org facilitator is NOT indexed — this unlocks at the mainnet flip (MAINNET.md gate → CDP keys). Distribution bonus: Bazaar is mounted in AWS Bedrock AgentCore Gateway. | 🔑 at mainnet |
| **x402scan (Merit Systems)** | Free self-serve registry; auto-approves any URL returning a valid x402 schema. Submit `gateway.code402.dev` paid routes at x402scan.com once live on mainnet. | 🖱 post-mainnet |
| **x402 v2 discovery extension** | Any facilitator/crawler can read seller metadata. Our `.well-known/x402.json` (gateway + root) and `llms.txt` are already crawl-ready. | 🤖 live in code |
| **Community indexes (TOLL-402, 402index, agent-tools.cloud)** | Crawl public sources incl. awesome-lists and .well-known manifests. Being crawlable is the mechanism; they re-crawl continuously. Their liveness probes must find us alive (atlas's own bar). | 🤖 once deployed |
| **awesome-x402 lists (GitHub)** | PR adding code402 to community awesome-x402 / awesome-agent-payments lists. High crawler fan-out for low effort. | 🖱 (owner account) |

## Tier 2 — MCP registries (agent frameworks discover tools here)

| Surface | How listing works | Who/when |
|---|---|---|
| **Official MCP Registry** (registry.modelcontextprotocol.io) | Publish `workers/mcp/server.json` (already in repo) with the `mcp-publisher` CLI, authenticating the `io.github.89rat` namespace via GitHub login. Do after the MCP worker is deployed at its public URL. | 🖱 15 min post-deploy |
| **Smithery / PulseMCP / Glama / mcp.so** | Self-serve submissions (mostly "add server" forms pointing at the public MCP URL + repo). These are the directories agent-tools.cloud re-crawls, so listings compound. | 🖱 30 min post-deploy |
| **Claude / Cursor ecosystem docs** | Once in the official registry, most clients surface it automatically; no separate action. | 🤖 |

## Tier 3 — identity & reputation registries (trust rank)

| Surface | How listing works | Who/when |
|---|---|---|
| **ERC-8004 identity registry** | On-chain registration of the agent/service identity (gas + the operating wallet signs). Worth doing for standards presence; reputation entries there are Sybil-swamped, so treat as identity only. | 🔑 post-mainnet |
| **Companies-House-anchored operator identity** | Already shipped: JUANA LIMITED in the landing footer + machine `operator` field in x402.json — the KYA signal crawlers and enterprises actually check. | 🤖 done |

## Tier 4 — developer-channel packages (devs find rails here)

| Surface | How listing works | Who/when |
|---|---|---|
| **npm: @m2m/tollbooth-client** | `npm publish` from packages/client (needs npm org/token). Package README already points at the gateway. | 🔑 owner token |
| **PyPI: agent-tools** | `python -m build && twine upload` from packages/agent-tools (needs PyPI token). LangChain/CrewAI wiring documented in its README. | 🔑 owner token |
| **GitHub topics** | Add repo topics: `x402`, `mcp`, `agent-payments`, `micropayments`, `usdc`, `cloudflare-workers` — GitHub topic pages are crawled by most tool indexes. | 🖱 2 min |

## Tier 5 — human channels (sellers, not agents)

Product Hunt / HN Show / dev.to write-up / X thread — human-discovery for the
Concierge-launch pipeline (SELFSUSTAIN.md §1b). Do after the estate is live so
every link lands on working, verifiable endpoints. 🖱

## Sequencing (ties to SELFSUSTAIN.md milestones)

```
wk 1  deploy estate ──► Tier 1 crawl-automatics go live (🤖)
      + GitHub topics, awesome-list PRs (🖱, 30 min)
      + MCP registry + Smithery/PulseMCP/Glama (🖱, 45 min)
wk 2  mainnet flip ──► CDP facilitator ──► Bazaar auto-index (🔑)
      + x402scan submission (🖱, 5 min)
      + ERC-8004 identity registration (🔑)
wk 2+ npm + PyPI publishes (🔑)  ·  human-channel posts (🖱)
```

Measurement: every surface should show up as new unique payers in
`GET /v1/stats` — if a listing is live for 2 weeks and drives zero probes or
calls, note it here and stop investing in that surface.
