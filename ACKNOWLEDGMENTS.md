# Acknowledgments — the people who built the engine

This project stands on work we didn't do. Credit where it's due:

- **The x402 team at Coinbase (CDP)** — for x402 itself: HTTP 402 challenges,
  EIP-3009 gasless USDC payment flows, and the facilitator model. Our entire
  settlement layer rides their rail. https://x402.org
- **The x402 Foundation & Linux Foundation** — for taking x402 to neutral
  stewardship with 22 co-building organizations. The standard survives its
  creator because of them.
- **Cloudflare Workers team** — the edge substrate this entire stack runs on
  (Workers, D1, Durable Objects, KV, R2, Queues), and for native x402 support.
- **agent402.tools** — their on-chain leaderboard (settled-volume scans of
  transferWithAuthorization events) seeded our seller trust scores and the
  7-day on-chain evidence we build on. Build relationships, don't just scrape them.
- **The awesome-x402 maintainers (xpaysh)** — the canonical ecosystem list;
  our PR #1243 is a small repayment for the discovery their curation enables.
- **agenttoll.dev** — whose buyer-metadata/402-challenge pattern (GET free
  terms, POST the challenge) taught our prober a real-world protocol shape.
- **Coinbase Agentic.Market** — whose public catalog API we ingest; being
  aggregate-able is a form of openness worth naming.
- **Blockscout** — the open Base block explorer API behind our on-chain
  verification and settlement lookups.
- **The viem, Hono, canonicalize, noble, worker-build, and Rust/WASM teams** —
  the libraries and toolchains that make "verify locally at the edge" possible.
- **Everyone in the x402-foundation GitHub threads** arguing out the
  vendor-neutral EIP-191 offline-verification model — the Tollbooth follows
  where that discussion leads.

If we missed you, it's an error, not a choice — open an issue and you'll be added.
