/**
 * @code402/attest-verify — seller-side enforcement for the origin-attestation rail.
 *
 * Drop this into any API that sits behind the code402 gateway. When the gateway
 * proxies a settled, paid call to your upstream, it attaches an
 * X-Code402-Attestation header: an Ed25519-signed, 60-second, nonce-bound proof
 * naming the listing, the payer, and the settled amount.
 *
 * Enforcing it means direct-to-origin calls get rejected and only paid,
 * gateway-routed traffic executes — the anti-bypass lock.
 *
 * Zero dependencies. Works in Node 18+, Cloudflare Workers, Deno, Bun.
 *
 * Usage (any fetch-style handler):
 *
 *   import { verifyCode402Attestation, CODE402_ATTESTATION_HEADER } from "@code402/attest-verify";
 *
 *   const check = await verifyCode402Attestation(request.headers);
 *   if (!check.valid) return new Response("payment rail required", { status: 402 });
 *   // check.fields: { sellerId, serviceId, payer, amountUnits, nonce, issuedAtMs, expiresAtMs }
 */

export const CODE402_ATTESTATION_HEADER = "x-code402-attestation";
export const CODE402_KEYS_URL =
  "https://gateway.code402.dev/.well-known/x402.json";

/** Default TTL tolerance: header is minted with a 60s expiry; we enforce it. */
export interface AttestationFields {
  sellerId: string;
  serviceId: string;
  payer: string;
  amountUnits: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface AttestationCheck {
  valid: boolean;
  expired: boolean;
  reason?: string;
  fields?: AttestationFields;
}

function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Fetch (once) and cache the gateway's published Ed25519 public key. */
let cachedKey: { x: string; fetchedAt: number } | null = null;
export async function code402PublicKeyX(refreshAfterMs = 86_400_000): Promise<string> {
  if (cachedKey && Date.now() - cachedKey.fetchedAt < refreshAfterMs) return cachedKey.x;
  const res = await fetch(CODE402_KEYS_URL);
  if (!res.ok) throw new Error(`code402 manifest unreachable (${res.status})`);
  const manifest = (await res.json()) as { attestation?: { public_key_x?: string } };
  const x = manifest.attestation?.public_key_x;
  if (!x) throw new Error("code402 manifest carries no attestation public key");
  cachedKey = { x, fetchedAt: Date.now() };
  return x;
}

/**
 * Verify the attestation header from an inbound request.
 * Pass a Headers instance (or a plain header map). Public key defaults to the
 * gateway's published key (fetched + cached); pass `publicKeyX` to pin it.
 */
export async function verifyCode402Attestation(
  headers: Headers | Record<string, string | undefined>,
  publicKeyX?: string,
): Promise<AttestationCheck> {
  const raw =
    headers instanceof Headers
      ? headers.get(CODE402_ATTESTATION_HEADER)
      : (headers[CODE402_ATTESTATION_HEADER] ??
        headers["X-Code402-Attestation"]);
  if (!raw) return { valid: false, expired: false, reason: "missing attestation header" };

  const [payloadB64, sigB64] = raw.split(".");
  if (!payloadB64 || !sigB64) return { valid: false, expired: false, reason: "malformed header" };

  const payload = new TextDecoder().decode(b64uDecode(payloadB64));
  const parts = payload.split("|");
  if (parts.length !== 7) return { valid: false, expired: false, reason: "malformed payload" };
  const [sellerId, serviceId, payer, amountUnits, nonce, iat, exp] = parts as [
    string, string, string, string, string, string, string,
  ];

  const expiresAtMs = Number(exp);
  if (Date.now() > expiresAtMs) {
    return { valid: false, expired: true, reason: "attestation expired (60s TTL)" };
  }

  const x = publicKeyX ?? (await code402PublicKeyX());
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x } as JsonWebKey,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    key,
    b64uDecode(sigB64) as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(payload),
  );
  if (!ok) return { valid: false, expired: false, reason: "bad signature" };

  return {
    valid: true,
    expired: false,
    fields: {
      sellerId: sellerId!,
      serviceId: serviceId!,
      payer: payer!,
      amountUnits: amountUnits!,
      nonce: nonce!,
      issuedAtMs: Number(iat),
      expiresAtMs,
    },
  };
}
