# @m2m/tollbooth-client

The Invisible Wallet. Wraps `fetch`; when any request returns a Code402 402 challenge,
the client JCS-canonicalizes the payload (RFC 8785), signs it with EIP-191, and retries
with `X-402-Payment` — returning the final 200 data. Payments just happen.

```bash
npm i @m2m/tollbooth-client
```
```js
import { TollboothClient } from "@m2m/tollbooth-client";
const c = new TollboothClient(process.env.PRIVATE_KEY);
const data = await c.fetchJson("https://code402-tollbooth.akrivis.workers.dev/api/hello");
```
Conformance vectors: tests/vectors.json in the repo.
