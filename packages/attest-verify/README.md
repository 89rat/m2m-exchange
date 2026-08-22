# @code402/attest-verify

Seller-side enforcement for the code402 origin-attestation rail.

When code402 proxies a **settled, paid** call to your API, the request carries an
`X-Code402-Attestation` header — an Ed25519-signed, 60-second proof naming your
listing, the payer, and the settled amount. Enforcing it means direct-to-origin
traffic gets 402'd and only gateway-routed paid calls execute.

## Install

Single file — copy `index.ts` into your project (zero dependencies), or import the
package in this monorepo. Node 18+, Cloudflare Workers, Deno, Bun.

## Enforce (any fetch-style handler)

```ts
import { verifyCode402Attestation } from "@code402/attest-verify";

export default {
  async fetch(request: Request) {
    const check = await verifyCode402Attestation(request.headers);
    if (!check.valid) {
      return new Response(
        JSON.stringify({ error: "payment rail required — route via code402", reason: check.reason }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }
    // check.fields = { sellerId, serviceId, payer, amountUnits, nonce, ... }
    return new Response(JSON.stringify({ ok: true, payer: check.fields!.payer }));
  },
};
```

## Express / Hono middleware sketch

```ts
app.use("/api/paid", async (req, res, next) => {
  const check = await verifyCode402Attestation(req.headers as any);
  if (!check.valid) return res.status(402).json({ error: "route via code402", reason: check.reason });
  (req as any).attestation = check.fields;
  next();
});
```

## The wire format (verify it yourself — don't trust us)

```
header    = base64url(canonical) "." base64url(Ed25519_signature)
canonical = sellerId|serviceId|payer|amountUnits|nonce|issuedAtMs|expiresAtMs
public key = published at https://gateway.code402.dev/.well-known/x402.json (attestation.public_key_x)
TTL       = 60 seconds — an attestation proves THIS call, not a session
```

Key rotation is safe by construction: this module fetches the published key and
caches it for 24h; pin `publicKeyX` yourself if you want zero outbound calls.
