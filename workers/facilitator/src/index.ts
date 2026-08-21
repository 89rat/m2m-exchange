/**
 * code402 self-hosted x402 facilitator — verify + settle as a Cloudflare Worker.
 *
 * Implements the facilitator HTTP API that x402-hono's paymentMiddleware
 * expects:
 *   GET  /supported  → { kinds: [{ scheme: "exact", network }] }
 *   POST /verify     → { isValid, invalidReason?, payer? }
 *   POST /settle     → { success, error?, txHash?, networkId? }
 *
 * Custody boundary: the relayer key (RELAYER_PRIVATE_KEY) pays gas only. USDC
 * moves buyer → seller directly via EIP-3009 transferWithAuthorization; the
 * authorization names the recipient, so the relayer cannot redirect funds.
 *
 * Access guard: when FACILITATOR_KEY is set, callers must send it as the
 * X-FACILITATOR-KEY header. Without it, anyone could burn the relayer's gas.
 */
import { Hono } from "hono";
import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { settle, verify } from "x402/facilitator";
import type { PaymentPayload, PaymentRequirements } from "x402/types";

export interface FacilitatorBindings {
  NETWORK?: string;
  RPC_URL?: string;
  RELAYER_PRIVATE_KEY?: string;
  FACILITATOR_KEY?: string;
}

type NetworkId = "base-sepolia" | "base";

const CHAIN_BY_NETWORK: Record<NetworkId, Chain> = {
  "base-sepolia": baseSepolia,
  base,
};

const DEFAULT_RPC: Record<NetworkId, string> = {
  "base-sepolia": "https://sepolia.base.org",
  base: "https://mainnet.base.org",
};

function resolveNetwork(env: FacilitatorBindings): NetworkId {
  const n = env.NETWORK ?? "base-sepolia";
  if (n !== "base-sepolia" && n !== "base") {
    throw new Error(`unsupported NETWORK "${n}" — expected base-sepolia or base`);
  }
  return n;
}

/** Decode the base64 payment header into a PaymentPayload. Throws on garbage. */
export function decodePaymentHeader(paymentHeader: string): PaymentPayload {
  const json = Buffer.from(paymentHeader, "base64").toString("utf-8");
  const payload = JSON.parse(json) as PaymentPayload;
  if (!payload || typeof payload !== "object" || !("payload" in payload)) {
    throw new Error("malformed payment header");
  }
  return payload;
}

/** Validate the facilitator request body shape before touching the chain. */
export function parseFacilitatorRequest(body: unknown): {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
} {
  if (!body || typeof body !== "object") throw new Error("body must be an object");
  const b = body as Record<string, unknown>;
  if (typeof b.paymentHeader !== "string" || !b.paymentHeader) {
    throw new Error("paymentHeader (base64) is required");
  }
  if (!b.paymentRequirements || typeof b.paymentRequirements !== "object") {
    throw new Error("paymentRequirements is required");
  }
  return {
    payload: decodePaymentHeader(b.paymentHeader),
    requirements: b.paymentRequirements as PaymentRequirements,
  };
}

const app = new Hono<{ Bindings: FacilitatorBindings }>();

app.get("/healthz", (c) =>
  c.json({ status: "ok", service: "code402-facilitator", network: resolveNetwork(c.env) }),
);

app.get("/supported", (c) => {
  const network = resolveNetwork(c.env);
  return c.json({
    kinds: [{ x402Version: 1, scheme: "exact", network }],
  });
});

/** Shared-secret guard — active only when FACILITATOR_KEY is configured. */
function authorized(c: { req: { header: (n: string) => string | undefined }; env: FacilitatorBindings }): boolean {
  if (!c.env.FACILITATOR_KEY) return true;
  return c.req.header("x-facilitator-key") === c.env.FACILITATOR_KEY;
}

/**
 * Estate binding: this facilitator spends relayer gas only on payments for
 * resources served from the code402 estate. Without this, anyone who found
 * the endpoint could settle their own payments on our gas bill.
 */
const ESTATE_SUFFIX = ".code402.dev";
const ESTATE_ROOT = "code402.dev";

export function isEstateResource(requirements: PaymentRequirements): boolean {
  try {
    const host = new URL(requirements.resource ?? "").hostname;
    return host === ESTATE_ROOT || host.endsWith(ESTATE_SUFFIX);
  } catch {
    return false;
  }
}

app.post("/verify", async (c) => {
  if (!authorized(c)) return c.json({ isValid: false, invalidReason: "unauthorized" }, 401);
  const network = resolveNetwork(c.env);
  let parsed;
  try {
    parsed = parseFacilitatorRequest(await c.req.json());
  } catch (e) {
    return c.json(
      { isValid: false, invalidReason: e instanceof Error ? e.message : "bad request" },
      400,
    );
  }
  const client = createPublicClient({
    chain: CHAIN_BY_NETWORK[network],
    transport: http(c.env.RPC_URL ?? DEFAULT_RPC[network]),
  });
  const result = await verify(client as never, parsed.payload, parsed.requirements);
  return c.json(result);
});

app.post("/settle", async (c) => {
  if (!authorized(c)) return c.json({ success: false, error: "unauthorized" }, 401);
  const network = resolveNetwork(c.env);
  if (!c.env.RELAYER_PRIVATE_KEY) {
    // Fail closed: a facilitator without a relayer cannot settle, and a
    // misconfigured money path must say so loudly, never improvise.
    return c.json({ success: false, error: "relayer key not configured" }, 500);
  }
  let parsed;
  try {
    parsed = parseFacilitatorRequest(await c.req.json());
  } catch (e) {
    return c.json(
      { success: false, error: e instanceof Error ? e.message : "bad request" },
      400,
    );
  }
  if (!isEstateResource(parsed.requirements)) {
    return c.json(
      { success: false, error: "resource outside the code402 estate" },
      403,
    );
  }

  const rpcUrl = c.env.RPC_URL ?? DEFAULT_RPC[network];
  const chain = CHAIN_BY_NETWORK[network];

  // Verify before spending gas — never submit an invalid authorization.
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const check = await verify(publicClient as never, parsed.payload, parsed.requirements);
  if (!check.isValid) {
    return c.json(
      { success: false, error: check.invalidReason ?? "verification failed" },
      400,
    );
  }

  const account = privateKeyToAccount(c.env.RELAYER_PRIVATE_KEY as `0x${string}`);
  const signer = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const result = await settle(signer as never, parsed.payload, parsed.requirements);

  // x402 settle → facilitator wire shape ({ success, txHash, networkId }).
  const r = result as { success: boolean; transaction?: string; network?: string; errorReason?: string };
  return c.json({
    success: r.success,
    txHash: r.transaction,
    networkId: r.network ?? network,
    ...(r.success ? {} : { error: r.errorReason ?? "settlement failed" }),
  });
});

export default app;
