/**
 * Network and facilitator resolution — the single place that decides whether
 * the platform speaks testnet (base-sepolia) or mainnet (base).
 *
 * Flip procedure: set NETWORK=base + CDP_API_KEY_ID/CDP_API_KEY_SECRET
 * (wrangler secrets) and deploy. See MAINNET.md.
 */
import { createFacilitatorConfig } from "@coinbase/x402";
import type { FacilitatorConfig, Resource } from "x402/types";

export type NetworkId = "base-sepolia" | "base";

/** Bindings that control network/facilitator selection. */
export interface NetworkBindings {
  /** "base-sepolia" (default) or "base" (mainnet). */
  NETWORK?: string;
  /** Optional facilitator URL override (testnet development). */
  FACILITATOR_URL?: string;
  /** Coinbase CDP API keys — REQUIRED for mainnet settlement. */
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}

/** Canonical USDC contract per network. */
export const USDC_BY_NETWORK: Record<NetworkId, `0x${string}`> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export function resolveNetwork(env: NetworkBindings): NetworkId {
  const n = env.NETWORK ?? "base-sepolia";
  if (n !== "base-sepolia" && n !== "base") {
    throw new Error(`unsupported NETWORK "${n}" — expected base-sepolia or base`);
  }
  return n;
}

export function usdcAddress(network: NetworkId): `0x${string}` {
  return USDC_BY_NETWORK[network];
}

/**
 * Facilitator selection:
 * - FACILITATOR_URL override always wins (local dev, custom facilitators).
 * - Mainnet REQUIRES the Coinbase CDP facilitator (the public x402.org
 *   facilitator serves testnets only — verified against /supported).
 * - Testnet defaults to the public facilitator (no key needed).
 */
export function resolveFacilitator(env: NetworkBindings): FacilitatorConfig | undefined {
  if (env.FACILITATOR_URL) return { url: env.FACILITATOR_URL as Resource };
  const network = resolveNetwork(env);
  if (network === "base") {
    if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
      throw new Error(
        "NETWORK=base requires CDP_API_KEY_ID and CDP_API_KEY_SECRET " +
          "(Coinbase CDP facilitator). Create them at https://cdp.coinbase.com and " +
          "set via `wrangler secret put`. See MAINNET.md.",
      );
    }
    return createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET);
  }
  return undefined;
}
