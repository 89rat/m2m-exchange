# Pre-Release Audit — translated to our substrate
Source: paranoid M2M pre-release checklist (HW/TYPES/FFI/CODE/NET/SEC/OBS/RES).
Our stack: Cloudflare Workers + DO + D1, not bare metal. Translation table:

| Audit domain | Their requirement | Our equivalent | Status |
|---|---|---|---|
| HW (core pinning, cache lines) | n/a at edge | Cloudflare manages isolation/cores | delegated |
| TYPES: replay/soundness | exact nonce tracking, no probabilistic rejection | NonceGuard DO: exact, fail-closed, single-writer | ✅ |
| TYPES: integer overflow | u128 ledger math | BigInt base units everywhere | ✅ |
| TYPES: fuzz the parser | malformed 402 payloads | 200-case fuzz suite: never 500, never accepted | ✅ today |
| TYPES: TOCTOU (same bytes verified) | sign/verify identical slice | JCS canonical string signed IS the string verified | ✅ |
| FFI (C ABI, alignment) | n/a — viem/noble in-process | library boundary, no FFI | delegated |
| CODE: lock-free MPSC | ring buffer | DO serialization model (single-threaded by construction) | ✅ by design |
| NET: backpressure/429 | token bucket, load shed | 120/min/IP token bucket on all public APIs | ✅ |
| SEC: challenge-response binding | server nonce signed by client | Tollbooth: server nonce inside signed canonical | ✅ |
| SEC: no probabilistic nonce stores | exact membership | DO storage: exact, never probabilistic | ✅ |
| SEC: constant-time | CMOV audits | viem/noble audited primitives; no hand-rolled crypto | delegated |
| SEC: keys in HSM | PKCS#11 | Secrets store now; HSM/hardware wallet at mainnet gate | 🔒 gated |
| OBS: financial logs must never drop | block, don't drop | Receipts now AWAITED before response (this commit) | ✅ today |
| OBS: no secrets in logs | — | receipts store public chain data only (payer, txhash) | ✅ |
| RES: WAL durability | O_DIRECT + aligned writes | D1/DO storage (Cloudflare-managed durability) | delegated |
| RES: ledger circuit breaker | trip on N failures | facilitator failover | ⏳ roadmap issue |
| RES: split-brain fencing | distributed lease | single DO instance per name = fencing by construction | ✅ |

Two real gaps closed by this commit: (1) awaited receipt writes (audit §7 correction
— dropped financial logs are a compliance violation, not telemetry loss);
(2) payment-header fuzzing (audit §2 — malformed payloads must never 500 or satisfy payment).
One roadmap item filed: facilitator circuit breaker.
