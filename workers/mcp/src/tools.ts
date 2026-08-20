/**
 * code402-mcp-server tools.
 *
 * Scope is deliberately non-custodial (STRATEGY.md law #1): discovery,
 * probing, and seller operations only. Paying for services requires the
 * buyer's own key and stays in the buyer's x402 client — no tool here ever
 * touches funds or private keys.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CHARACTER_LIMIT,
  GatewayError,
  gatewayFetch,
  probeTargetAllowed,
  truncateText,
  unitsToDollars,
  type McpBindings,
} from "./gateway";

interface ServiceDescriptor {
  serviceId: string;
  name: string;
  description?: string;
  endpoint: string;
  method: string;
  pricing: { mode: string; price: { amount: string; asset: string; network: string } };
}

interface ServiceList {
  m2mVersion: number;
  services: ServiceDescriptor[];
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(structured: Record<string, unknown>, text?: string): ToolResult {
  return {
    content: [{ type: "text", text: truncateText(text ?? JSON.stringify(structured, null, 2)) }],
    structuredContent: structured,
  };
}

function fail(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}

async function run(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GatewayError) return fail(e.message);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function serviceView(s: ServiceDescriptor, gatewayUrl: string) {
  return {
    serviceId: s.serviceId,
    name: s.name,
    description: s.description ?? "",
    method: s.method,
    url: `${gatewayUrl.replace(/\/$/, "")}${s.endpoint}`,
    price: unitsToDollars(s.pricing.price.amount),
    price_usdc_units: s.pricing.price.amount,
    network: s.pricing.price.network,
  };
}

export function buildServer(env: McpBindings): McpServer {
  const server = new McpServer({ name: "code402-mcp-server", version: "1.0.0" });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  server.registerTool(
    "code402_list_services",
    {
      title: "List machine-payable services",
      description:
        "List services on the code402 gateway storefront (GET /v1/services): first-party APIs and third-party seller listings, each with method, URL, USDC price, and network. " +
        "No account or API key exists or is needed anywhere on the gateway — paid services are accountless, priced per call via x402. " +
        "Paying for a service requires an x402-capable HTTP client with the buyer's own wallet — this tool only discovers. " +
        "Returns { total, count, offset, has_more, next_offset?, services: [{ serviceId, name, description, method, url, price, price_usdc_units, network }] }.",
      inputSchema: {
        query: z.string().max(200).optional().describe("Case-insensitive substring filter on serviceId, name, and description"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum services to return (default 20)"),
        offset: z.number().int().min(0).optional().describe("Services to skip (pagination, default 0)"),
      },
      annotations: readOnly,
    },
    async ({ query, limit: rawLimit, offset: rawOffset }) =>
      run(async () => {
        const limit = rawLimit ?? 20;
        const offset = rawOffset ?? 0;
        const list = await gatewayFetch<ServiceList>(env, "/v1/services");
        const q = query?.toLowerCase();
        const filtered = q
          ? list.services.filter((s) =>
              [s.serviceId, s.name, s.description ?? ""].some((f) => f.toLowerCase().includes(q)),
            )
          : list.services;
        const page = filtered.slice(offset, offset + limit);
        const hasMore = filtered.length > offset + page.length;
        return ok({
          total: filtered.length,
          count: page.length,
          offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: offset + page.length } : {}),
          services: page.map((s) => serviceView(s, env.GATEWAY_URL)),
        });
      }),
  );

  server.registerTool(
    "code402_get_service",
    {
      title: "Get one service",
      description:
        "Fetch a single service from the code402 storefront by its serviceId (as returned by code402_list_services). " +
        "Returns the same service shape as code402_list_services, or an error naming close matches when the id is unknown.",
      inputSchema: {
        serviceId: z.string().min(2).max(80).describe("Exact serviceId, e.g. 'weather' or 'acme-lookup'"),
      },
      annotations: readOnly,
    },
    async ({ serviceId }) =>
      run(async () => {
        const list = await gatewayFetch<ServiceList>(env, "/v1/services");
        const hit = list.services.find((s) => s.serviceId === serviceId);
        if (!hit) {
          const near = list.services
            .filter((s) => s.serviceId.includes(serviceId) || serviceId.includes(s.serviceId))
            .map((s) => s.serviceId)
            .slice(0, 5);
          return fail(
            `no service with serviceId '${serviceId}'.` +
              (near.length ? ` Close matches: ${near.join(", ")}.` : " Use code402_list_services to browse."),
          );
        }
        return ok(serviceView(hit, env.GATEWAY_URL));
      }),
  );

  server.registerTool(
    "code402_probe_endpoint",
    {
      title: "Probe a URL for x402 payment terms",
      description:
        "Send an unpaid GET to any public https URL and report whether it answers with a valid x402 402 challenge, plus normalized terms " +
        "{ scheme, network, amount (USDC base units), price (dollars), payTo, asset }. Use before budgeting a payment or to liveness-check a listing. " +
        "No payment is ever sent. Private/internal addresses are rejected.",
      inputSchema: {
        url: z.string().max(2000).regex(/^https:\/\/.+/, "must be a public https URL").describe("Public https URL of the endpoint to probe"),
      },
      annotations: { ...readOnly, idempotentHint: false },
    },
    async ({ url }) =>
      run(async () => {
        if (!probeTargetAllowed(url)) {
          return fail("url must be public https (no private, loopback, or metadata addresses)");
        }
        const started = Date.now();
        let res: Response;
        try {
          res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        } catch (e) {
          return ok({ url, reachable: false, isX402: false, error: e instanceof Error ? e.message : "fetch failed" });
        }
        let terms: Record<string, string | null> | null = null;
        if (res.status === 402) {
          try {
            const j = (await res.json()) as { accepts?: Array<Record<string, string>> };
            const a = j.accepts?.[0];
            if (a) {
              terms = {
                scheme: a.scheme ?? null,
                network: a.network ?? null,
                amount: a.maxAmountRequired ?? null,
                price: a.maxAmountRequired ? unitsToDollars(a.maxAmountRequired) : null,
                payTo: a.payTo ?? null,
                asset: a.asset ?? null,
              };
            }
          } catch {
            terms = null;
          }
        }
        return ok({
          url,
          reachable: true,
          status: res.status,
          isX402: res.status === 402 && terms !== null,
          terms,
          latencyMs: Date.now() - started,
        });
      }),
  );

  server.registerTool(
    "code402_gateway_health",
    {
      title: "Gateway health & network",
      description:
        "Check the code402 gateway's /healthz: returns { status, service, network } where network is the settlement chain currently configured (e.g. base-sepolia or base).",
      inputSchema: {},
      annotations: readOnly,
    },
    async () =>
      run(async () => {
        const h = await gatewayFetch<Record<string, string>>(env, "/healthz");
        return ok(h);
      }),
  );

  server.registerTool(
    "code402_register_seller",
    {
      title: "Register a seller",
      description:
        "Register a seller on the code402 gateway (or update its name — the payout wallet is immutable once set; re-binding requires EIP-191 proof): POST /v1/sellers with { id, wallet, name }. Payments for the seller's listings settle " +
        "directly to this wallet (non-custodial). Registration is free; the platform invoices a take-rate on settled receipts (Free tier 2%, Pro 1.5%). " +
        "Returns { sellerId, wallet, storefront }. Prove wallet ownership later via the gateway's EIP-191 verify-challenge flow.",
      inputSchema: {
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "lowercase slug, 2-63 chars").describe("Seller slug, e.g. 'acme'"),
        wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "EVM address").describe("EVM wallet that receives USDC payments"),
        name: z.string().min(1).max(80).describe("Human-readable seller name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, wallet, name }) =>
      run(async () => {
        const r = await gatewayFetch<Record<string, unknown>>(env, "/v1/sellers", {
          method: "POST",
          body: JSON.stringify({ id, wallet, name }),
        });
        return ok(r, `Registered seller '${id}' (payments -> ${wallet}). Next: code402_create_listing.`);
      }),
  );

  server.registerTool(
    "code402_create_listing",
    {
      title: "List an API for sale",
      description:
        "Create or update a paid listing for a registered seller: POST /v1/sellers/{sellerId}/services with { serviceId, upstream_url, price_usd, method?, description? }. " +
        "The gateway then serves the listing at /s/{sellerId}/{serviceId} behind an x402 paywall paying the seller's wallet directly. " +
        "Returns { listing, paid_endpoint }.",
      inputSchema: {
        sellerId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).describe("Registered seller slug"),
        serviceId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).describe("Listing slug, e.g. 'lookup'"),
        upstream_url: z.string().max(2000).regex(/^https:\/\/.+/, "must be a public https URL").describe("Public https URL of the API being sold"),
        price_usd: z.string().regex(/^\$?\d+(\.\d{1,6})?$/, "like $0.05").describe("Price per call, e.g. '$0.05'"),
        method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional().describe("HTTP method of the upstream (default GET)"),
        description: z.string().max(300).optional().describe("What buyers get for the price"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ sellerId, serviceId, upstream_url, price_usd, method, description }) =>
      run(async () => {
        const r = await gatewayFetch<Record<string, unknown>>(env, `/v1/sellers/${sellerId}/services`, {
          method: "POST",
          body: JSON.stringify({ serviceId, upstream_url, price_usd, method: method ?? "GET", description }),
        });
        return ok(r, `Listed ${sellerId}/${serviceId} at ${price_usd}. Paid endpoint: ${String(r.paid_endpoint ?? "")}`);
      }),
  );

  server.registerTool(
    "code402_get_seller_analytics",
    {
      title: "Seller analytics",
      description:
        "Fetch a seller's own settlement analytics (free): GET /v1/sellers/{sellerId}/analytics. " +
        "Returns { total_settled_calls, gross_usd, unique_buyers, by_service: [{ service_id, calls }] }.",
      inputSchema: {
        sellerId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).describe("Registered seller slug"),
      },
      annotations: readOnly,
    },
    async ({ sellerId }) =>
      run(async () => {
        const r = await gatewayFetch<Record<string, unknown>>(env, `/v1/sellers/${sellerId}/analytics`);
        return ok(r);
      }),
  );

  server.registerTool(
    "code402_get_seller_invoice",
    {
      title: "Seller take-rate invoice",
      description:
        "Compute a seller's platform-fee invoice from settled receipts: GET /v1/sellers/{sellerId}/invoice?since={unix_ms}. " +
        "Returns { tier, transactions, gross_usdc_units, platform_fee_usdc_units, seller_net_usdc_units, fee_bps }. Amounts are integer USDC base units (6 decimals).",
      inputSchema: {
        sellerId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).describe("Registered seller slug"),
        since: z.number().int().min(0).optional().describe("Unix ms timestamp; only receipts at/after this are invoiced (default 0)"),
      },
      annotations: readOnly,
    },
    async ({ sellerId, since }) =>
      run(async () => {
        const r = await gatewayFetch<Record<string, unknown>>(env, `/v1/sellers/${sellerId}/invoice?since=${since ?? 0}`);
        return ok(r);
      }),
  );

  return server;
}

export { CHARACTER_LIMIT };
