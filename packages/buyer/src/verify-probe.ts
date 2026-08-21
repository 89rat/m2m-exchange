/**
 * One-off: create a REAL signed x402 payment with the load-test key and POST it
 * to the live facilitator /verify — the exact call the gateway middleware makes.
 * Never prints the key.
 */
import type { Hex } from "viem";
import { createSigner, wrapFetchWithPayment } from "x402-fetch";

const KEY = (await import("node:fs")).readFileSync("../../.secrets/loadtest-key", "utf-8").trim() as Hex;

// Build a real payment by intercepting what wrapFetchWithPayment sends:
// easiest real payload = do the 402 probe, sign via the x402 client internals.
const signer = await createSigner("base-sepolia", KEY);

const probe = await fetch("https://gateway.code402.dev/api/weather");
const challenge = await probe.json() as any;
const requirements = challenge.accepts[0];

// Use the x402 client library to create the signed payment payload
const { createPaymentHeader } = await import("x402/client" as any).catch(() => ({})) as any;
let payload: any;
if (createPaymentHeader) {
  const headerB64 = await createPaymentHeader(signer, 1, requirements);
  payload = JSON.parse(Buffer.from(headerB64, "base64").toString());
} else {
  // fallback: sign EIP-3009 manually via the signer's signTypedData
  throw new Error("x402/client createPaymentHeader unavailable");
}

const body = { x402Version: 1, paymentPayload: payload, paymentRequirements: requirements };
const res = await fetch("https://facilitator.code402.dev/verify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
console.log("facilitator /verify HTTP", res.status);
console.log((await res.text()).slice(0, 500));
