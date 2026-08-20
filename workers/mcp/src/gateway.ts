/**
 * Thin client for the m2m-exchange gateway API plus shared helpers used by
 * every tool: fetch with timeout, actionable error mapping, and the SSRF
 * guard for user-supplied probe URLs (mirrors workers/gateway registry.ts).
 */

export interface McpBindings {
  GATEWAY_URL: string;
}

const FETCH_TIMEOUT_MS = 15_000;

/** Maximum characters returned in any tool text response. */
export const CHARACTER_LIMIT = 25_000;

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function gatewayFetch<T>(
  env: McpBindings,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const base = env.GATEWAY_URL.replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new GatewayError(
      `gateway unreachable at ${base}${path}: ${e instanceof Error ? e.message : "fetch failed"}. ` +
        `Check code402_gateway_health first.`,
    );
  }
  const body = await res.text();
  if (!res.ok) {
    throw new GatewayError(errorHint(res.status, path, body), res.status);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new GatewayError(`gateway returned non-JSON from ${path}`);
  }
}

function errorHint(status: number, path: string, body: string): string {
  const detail = body.slice(0, 300);
  switch (status) {
    case 400:
      return `gateway rejected the request (400) at ${path}: ${detail}. Fix the listed field and retry.`;
    case 404:
      return `not found (404) at ${path}: ${detail}. For seller tools, register first with code402_register_seller.`;
    case 402:
      return `payment required (402) at ${path}. This MCP server only calls free endpoints; use an x402-capable client to pay.`;
    case 429:
      return `rate limited (429) at ${path}. Wait before retrying.`;
    default:
      return `gateway error ${status} at ${path}: ${detail}`;
  }
}

/**
 * SSRF guard for user-supplied probe URLs: https only, no private/loopback/
 * link-local/metadata targets. Compact mirror of the gateway's upstreamAllowed.
 */
export function probeTargetAllowed(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  if (h === "metadata.google.internal" || h === "169.254.169.254") return false;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  if (h.includes(":") && (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd"))) return false;
  return true;
}

/** USDC base units (6 decimals, integer string) -> "$0.005"-style dollars. */
export function unitsToDollars(units: string): string {
  const n = BigInt(units);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `$${whole}.${frac}` : `$${whole}`;
}

export function truncateText(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n[truncated at ${CHARACTER_LIMIT} characters — use limit/offset or a narrower query]`
  );
}
