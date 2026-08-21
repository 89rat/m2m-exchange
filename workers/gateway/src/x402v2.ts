/**
 * x402 v2 discovery compatibility shim.
 *
 * The gateway runs x402-hono ^1.2 (v1-era), whose 402 challenge advertises
 * `accepts[].maxAmountRequired` and a short network name ("base-sepolia").
 * x402scan flags that as "v1" and wants v2: `accepts[].amount` (atomic units)
 * and CAIP-2 networks.
 *
 * This middleware post-processes the 402 that x402-hono produced and ADDS the v2
 * fields — `amount` (copied from the atomic-unit `maxAmountRequired`) and
 * `networkId` (CAIP-2) — WITHOUT removing the v1 fields the settlement path
 * verifies against. Additive and non-breaking: real x402-fetch clients keep
 * signing from `maxAmountRequired`/`network`; scanners see the v2 shape. It also
 * emits a base64 `PAYMENT-REQUIRED` response header for header-based scanners.
 *
 * NOTE: this is a compatibility layer, not a protocol upgrade. If x402scan still
 * reports v1 after this, the definitive fix is bumping x402 / x402-hono to a v2
 * release (which changes the verification path and MUST be tested on testnet
 * with a real payment before shipping).
 */
import type { MiddlewareHandler } from "hono";

const CAIP2: Record<string, string> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

export function x402v2Compat(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.res.status !== 402) return;
    if (!(c.res.headers.get("content-type") ?? "").includes("json")) return;

    let body: { x402Version?: number; accepts?: Record<string, unknown>[] } | null;
    try {
      body = (await c.res.clone().json()) as typeof body;
    } catch {
      return;
    }
    if (!body || !Array.isArray(body.accepts)) return;

    const accepts = body.accepts.map((a) => {
      const network = a.network as string | undefined;
      return {
        ...a,
        // v2 field name; value is already atomic units in the v1 payload.
        amount: (a.amount ?? a.maxAmountRequired) as unknown,
        // additive CAIP-2 identifier; original `network` is preserved for v1 clients.
        networkId: (a.networkId ?? (network ? CAIP2[network] ?? network : undefined)) as unknown,
      };
    });

    const patched = { ...body, accepts };
    const headers = new Headers(c.res.headers);
    try {
      headers.set(
        "PAYMENT-REQUIRED",
        btoa(JSON.stringify({ x402Version: body.x402Version ?? 1, resource: new URL(c.req.url).pathname, accepts })),
      );
    } catch {
      /* header is a bonus; ignore encoding failures */
    }
    c.res = new Response(JSON.stringify(patched), { status: 402, headers });
  };
}
