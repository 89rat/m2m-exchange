import { describe, expect, it } from "vitest";
import { signAttestation, verifyAttestation } from "../src/attest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The real keypair generated for this deployment lives only in .secrets/ and
// Cloudflare secrets. Tests mint an ephemeral pair per run — no fixed vectors
// to go stale or leak.
async function mintTestPair(): Promise<{ privateJwk: string; publicX: string }> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pair = kp as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { privateJwk: JSON.stringify(jwk), publicX: jwk.x! };
}

const FIELDS = {
  sellerId: "acme",
  serviceId: "lookup",
  payer: "0x7bf6e1b420116c6fe54c0c1fa2452353eea50596",
  amountUnits: "5000",
};

describe("origin attestation", () => {
  it("signs and verifies a well-formed attestation", async () => {
    const { privateJwk, publicX } = await mintTestPair();
    const att = await signAttestation(privateJwk, FIELDS, "nonce-123");
    const res = await verifyAttestation(att.header, publicX);
    expect(res.valid).toBe(true);
    expect(res.expired).toBe(false);
    expect(res.fields?.sellerId).toBe("acme");
    expect(res.fields?.amountUnits).toBe("5000");
  });

  it("rejects a tampered payload", async () => {
    const { privateJwk, publicX } = await mintTestPair();
    const att = await signAttestation(privateJwk, FIELDS, "nonce-123");
    // flip one character inside the signature segment (after the ".")
    const [p64, sig] = att.header.split(".") as [string, string];
    const flipped = sig[0] === "A" ? "B" : "A";
    const res = await verifyAttestation(`${p64}.${flipped}${sig.slice(1)}`, publicX);
    expect(res.valid).toBe(false);
  });

  it("rejects a wrong public key", async () => {
    const { privateJwk } = await mintTestPair();
    const att = await signAttestation(privateJwk, FIELDS, "nonce-123");
    // the published production key must NOT verify a test-pair signature
    const res = await verifyAttestation(att.header, "E8qkNazBt2VA28opkiVkmR80YTGy4-PH3YjuRB12-xA");
    expect(res.valid).toBe(false);
  });

  it("rejects malformed headers", async () => {
    const { publicX } = await mintTestPair();
    expect((await verifyAttestation("garbage", publicX)).valid).toBe(false);
    expect((await verifyAttestation("a.b.c", publicX)).valid).toBe(false);
  });

  it("refuses non-canonical-safe fields (injection guard)", async () => {
    await expect(
      mintTestPair().then(({ privateJwk }) =>
        signAttestation(privateJwk, { ...FIELDS, sellerId: "a|b" }, "nonce-1"),
      ),
    ).rejects.toThrow("canonical-safe");
  });

  it("the committed public key verifies signatures from the committed private key", async () => {
    // Guards against key-rotation accidents: .secrets/attest-key.json must
    // match the public key published in the gateway manifest.
    let jwk: string;
    try {
      jwk = readFileSync(fileURLToPath(new URL("../../../.secrets/attest-key.json", import.meta.url).href), "utf-8");
    } catch {
      return; // file absent in CI — skip rather than fail
    }
    const att = await signAttestation(jwk, FIELDS, "ci-check");
    const res = await verifyAttestation(att.header, "E8qkNazBt2VA28opkiVkmR80YTGy4-PH3YjuRB12-xA");
    expect(res.valid).toBe(true);
  });
});
