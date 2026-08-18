/**
 * Buyer agent: calls a paid endpoint on the m2m-gateway using the x402
 * payment protocol. It first probes the endpoint to print the raw 402
 * payment requirements, then retries with a signed USDC payment on
 * Base Sepolia via x402-fetch.
 *
 * Usage:
 *   BUYER_PRIVATE_KEY=0x... npm run buy [-- /api/weather|/api/echo]
 *
 * Env:
 *   BUYER_PRIVATE_KEY  EVM private key of the buyer wallet (testnet only!)
 *   GATEWAY_URL        Defaults to http://localhost:8787 (wrangler dev)
 */
import type { Hex } from "viem";
import {
  createSigner,
  decodeXPaymentResponse,
  wrapFetchWithPayment,
  type Signer,
} from "x402-fetch";

const NETWORK = process.env.NETWORK ?? "base-sepolia"; // "base" for mainnet (real USDC)
const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:8787";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function signerAddress(signer: Signer): string {
  // EvmSigner is a viem WalletClient (address on .account) or a LocalAccount
  // (address on .address). SvmSigner exposes .address too.
  if ("address" in signer && signer.address) return signer.address;
  if ("account" in signer && signer.account) return signer.account.address;
  return "unknown";
}

async function main() {
  const privateKey = process.env.BUYER_PRIVATE_KEY;
  if (!privateKey) {
    fail(
      "BUYER_PRIVATE_KEY is not set. Create a Base Sepolia test wallet, fund it " +
        "with USDC from https://faucet.circle.com, then export BUYER_PRIVATE_KEY=0x...",
    );
  }

  const endpoint = process.argv[2] ?? "/api/weather";
  const url = new URL(endpoint, GATEWAY_URL).toString();

  const signer = await createSigner(NETWORK, privateKey as Hex);
  console.log(`buyer wallet : ${signerAddress(signer)}`);
  console.log(`target       : ${url}\n`);

  // Step 1: unpaid probe — show the raw 402 payment requirements.
  const unpaid = await fetch(url);
  console.log(`[1] unpaid request  -> HTTP ${unpaid.status}`);
  const requirements = (await unpaid.json()) as unknown;
  console.log(JSON.stringify(requirements, null, 2));
  if (unpaid.status !== 402) {
    fail(`expected HTTP 402 from the gateway, got ${unpaid.status}`);
  }

  // Step 2: paid request — x402-fetch signs the payment and retries.
  const fetchWithPayment = wrapFetchWithPayment(fetch, signer);
  const init: RequestInit = endpoint.startsWith("/api/echo")
    ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "from buyer agent", ts: Date.now() }),
      }
    : {};

  console.log("\n[2] signing USDC payment and retrying...");
  const paid = await fetchWithPayment(url, init);
  const data = (await paid.json()) as unknown;
  console.log(`    paid request    -> HTTP ${paid.status}`);
  console.log(JSON.stringify(data, null, 2));
  if (!paid.ok) {
    fail(`paid request failed with HTTP ${paid.status}`);
  }

  // Step 3: payment receipt from the X-PAYMENT-RESPONSE header.
  const receiptHeader = paid.headers.get("x-payment-response");
  if (receiptHeader) {
    const receipt = decodeXPaymentResponse(receiptHeader);
    console.log("\n[3] payment receipt (X-PAYMENT-RESPONSE):");
    console.log(JSON.stringify(receipt, null, 2));
  } else {
    console.log("\n[3] no X-PAYMENT-RESPONSE header returned");
  }
}

await main();
