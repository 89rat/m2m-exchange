/**
 * Origin attestation — the anti-bypass rail for proxied seller calls.
 *
 * Every paid call the gateway proxies to a seller's upstream carries an
 * X-Code402-Attestation header: an Ed25519-signed, expiring, nonce-bound proof
 * that THIS request arrived through code402 with a settled payment attached.
 * Sellers verify it with the published public key — no shared secret, no call
 * back to us. An upstream that enforces it cannot be bypassed directly.
 *
 * Wire format:  base64url(canonicalPayload) + "." + base64url(Ed25519 sig)
 * Canonical:    sellerId|serviceId|payer|amountUnits|nonce|issuedAtMs|expiresAtMs
 *               (pipe-joined, charset-validated — no field may contain '|')
 *
 * Better than the HMAC-ticket draft this replaces: asymmetric (sellers verify
 * with a public key, nothing to leak), expiring, and bound to the payment
 * receipt fields rather than a bare task id.
 */

const FIELD_SAFE = /^[A-Za-z0-9_.:@$-]{1,128}$/;
const b64u = (b: ArrayBuffer | Uint8Array): string => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64uEncode = (s: string) => b64u(new TextEncoder().encode(s));

function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export interface AttestationFields {
  sellerId: string;
  serviceId: string;
  payer: string;        // buyer wallet, or "unknown" if the receipt omitted it
  amountUnits: string;  // integer USDC base units settled for this call
}

export interface Attestation {
  header: string;       // value for X-Code402-Attestation
  expiresAtMs: number;
}

const TTL_MS = 60_000; // 60s — proof of THIS call, not a reusable pass

function assertField(name: string, v: string): void {
  if (!FIELD_SAFE.test(v)) throw new Error(`attestation field ${name} is not canonical-safe`);
}

async function importPrivateKey(jwkJson: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkJson) as JsonWebKey;
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
}

/** Verify with the public half — used by sellers and by our own tests. */
export async function verifyAttestation(header: string, publicKeyX: string): Promise<{
  valid: boolean;
  expired: boolean;
  fields?: (AttestationFields & { nonce: string; issuedAtMs: number; expiresAtMs: number }) | undefined;
}> {
  try {
    const [payloadB64, sigB64] = header.split(".");
    if (!payloadB64 || !sigB64) return { valid: false, expired: false };
    const payload = new TextDecoder().decode(b64uDecode(payloadB64));
    const parts = payload.split("|");
    if (parts.length !== 7) return { valid: false, expired: false };
    const [sellerId, serviceId, payer, amountUnits, nonce, iat, exp] = parts;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: publicKeyX } as JsonWebKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify("Ed25519", key, b64uDecode(sigB64), new TextEncoder().encode(payload));
    const expiresAtMs = Number(exp);
    return {
      valid: ok && Date.now() <= expiresAtMs,
      expired: Date.now() > expiresAtMs,
      fields: ok
        ? { sellerId: sellerId!, serviceId: serviceId!, payer: payer!, amountUnits: amountUnits!, nonce: nonce!, issuedAtMs: Number(iat), expiresAtMs }
        : undefined,
    };
  } catch {
    return { valid: false, expired: false };
  }
}

/** Sign one attestation for a settled, about-to-be-proxied call. */
export async function signAttestation(
  privateJwkJson: string,
  f: AttestationFields,
  nonce: string,
): Promise<Attestation> {
  assertField("sellerId", f.sellerId);
  assertField("serviceId", f.serviceId);
  assertField("payer", f.payer);
  assertField("amountUnits", f.amountUnits);
  assertField("nonce", nonce);
  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + TTL_MS;
  const canonical = [f.sellerId, f.serviceId, f.payer, f.amountUnits, nonce, issuedAtMs, expiresAtMs].join("|");
  const key = await importPrivateKey(privateJwkJson);
  const sig = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(canonical));
  return { header: `${b64uEncode(canonical)}.${b64u(sig)}`, expiresAtMs };
}
