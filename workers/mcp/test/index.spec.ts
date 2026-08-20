import { SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const MCP_URL = "https://code402-mcp.test/mcp";

interface RpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

let nextId = 1;
async function rpc(method: string, params?: Record<string, unknown>): Promise<RpcResponse> {
  const res = await SELF.fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as RpcResponse;
}

interface ToolCallResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const r = await rpc("tools/call", { name, arguments: args });
  expect(r.error).toBeUndefined();
  return r.result as unknown as ToolCallResult;
}

// ---- outbound fetch stubbing ----
// Tests and the worker share one isolate under vitest-pool-workers, so the
// worker's bare fetch() resolves to globalThis.fetch — stub it per test.
// (SELF.fetch is a service binding and is unaffected.)
type RouteHandler = (req: Request) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let routes: Record<string, RouteHandler> = {};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  routes = {};
  (globalThis as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const handler = routes[url.host + url.pathname];
    if (!handler) throw new Error(`unexpected outbound fetch in test: ${req.url}`);
    return handler(req);
  }) as typeof fetch;
});

afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = realFetch;
});

const SERVICES_PAYLOAD = {
  m2mVersion: 1,
  services: [
    {
      serviceId: "weather",
      name: "Weather reading",
      description: "Current conditions snapshot (demo smoke test).",
      endpoint: "/api/weather",
      method: "GET",
      pricing: { mode: "static", price: { amount: "1000", asset: "0xusdc", network: "base-sepolia" } },
    },
    {
      serviceId: "x402-probe",
      name: "x402 endpoint prober",
      description: "Probes any https URL for a valid x402 paywall.",
      endpoint: "/api/x402-probe",
      method: "POST",
      pricing: { mode: "static", price: { amount: "5000", asset: "0xusdc", network: "base-sepolia" } },
    },
  ],
};

describe("code402 MCP server", () => {
  it("answers initialize with its server info", async () => {
    const r = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    const info = r.result?.serverInfo as { name: string };
    expect(info.name).toBe("code402-mcp-server");
  });

  it("lists the 8 code402 tools", async () => {
    const r = await rpc("tools/list");
    const tools = (r.result?.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(tools).toEqual([
      "code402_create_listing",
      "code402_gateway_health",
      "code402_get_seller_analytics",
      "code402_get_seller_invoice",
      "code402_get_service",
      "code402_list_services",
      "code402_probe_endpoint",
      "code402_register_seller",
    ]);
  });

  it("code402_list_services returns paginated services from the gateway", async () => {
    routes["gateway.code402.dev/v1/services"] = () => jsonResponse(SERVICES_PAYLOAD);

    const result = await callTool("code402_list_services", { limit: 1 });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(body.total).toBe(2);
    expect(body.count).toBe(1);
    expect(body.has_more).toBe(true);
    expect(body.next_offset).toBe(1);
    const first = (body.services as Array<Record<string, unknown>>)[0]!;
    expect(first.serviceId).toBe("weather");
    expect(first.price).toBe("$0.001");
    expect(first.url).toBe("https://gateway.code402.dev/api/weather");
  });

  it("code402_get_service reports close matches for unknown ids", async () => {
    routes["gateway.code402.dev/v1/services"] = () => jsonResponse(SERVICES_PAYLOAD);

    const result = await callTool("code402_get_service", { serviceId: "weather-x" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("weather");
  });

  it("code402_probe_endpoint rejects private targets without any fetch", async () => {
    const result = await callTool("code402_probe_endpoint", { url: "https://10.0.0.8/paid" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("public https");
  });

  it("code402_probe_endpoint normalizes a live 402 challenge", async () => {
    routes["paid.example.com/api"] = () =>
      jsonResponse(
        {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "base-sepolia",
              maxAmountRequired: "5000",
              payTo: "0x417Da74CDc0D3BabF6AdC851b6E5c638574c0D58",
              asset: "0xusdc",
            },
          ],
        },
        402,
      );

    const result = await callTool("code402_probe_endpoint", { url: "https://paid.example.com/api" });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0]!.text) as {
      isX402: boolean;
      terms: { price: string; payTo: string };
    };
    expect(body.isX402).toBe(true);
    expect(body.terms.price).toBe("$0.005");
    expect(body.terms.payTo).toBe("0x417Da74CDc0D3BabF6AdC851b6E5c638574c0D58");
  });

  it("code402_register_seller posts to the gateway and relays the storefront", async () => {
    routes["gateway.code402.dev/v1/sellers"] = async (req) => {
      expect(req.method).toBe("POST");
      const body = (await req.json()) as { id: string };
      expect(body.id).toBe("acme");
      return jsonResponse({ m2mVersion: 1, sellerId: "acme", wallet: "0x" + "a".repeat(40), storefront: "/s/acme" }, 201);
    };

    const result = await callTool("code402_register_seller", {
      id: "acme",
      wallet: "0x" + "a".repeat(40),
      name: "Acme Data API",
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("acme");
  });

  it("surfaces actionable gateway errors instead of raw failures", async () => {
    routes["gateway.code402.dev/v1/sellers/ghost/analytics"] = () =>
      jsonResponse({ error: "unknown seller" }, 404);

    const result = await callTool("code402_get_seller_analytics", { sellerId: "ghost" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("code402_register_seller");
  });

  it("rejects invalid tool arguments before any gateway call", async () => {
    const r = await rpc("tools/call", {
      name: "code402_register_seller",
      arguments: { id: "acme", wallet: "not-an-address", name: "Acme" },
    });
    // Depending on SDK version this surfaces as a protocol error or a
    // tool-level error result — either way it must name the invalid field
    // and never reach the gateway (no route stubbed, so a call would throw).
    const text = r.error
      ? r.error.message
      : (r.result as unknown as ToolCallResult).content.map((c) => c.text).join(" ");
    expect(r.error ?? (r.result as unknown as ToolCallResult).isError).toBeTruthy();
    expect(text).toMatch(/EVM address|wallet/i);
  });

  it("rejects a response-shaped body (id, no method) with -32600 instead of hanging", async () => {
    const res = await SELF.fetch(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RpcResponse;
    expect(body.error?.code).toBe(-32600);
  });

  it("code402_probe_endpoint reports a redirect without following it (SSRF hop guard)", async () => {
    routes["redir.example.com/r"] = () =>
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    const result = await callTool("code402_probe_endpoint", { url: "https://redir.example.com/r" });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0]!.text) as { isX402: boolean; status: number; redirectedTo: string };
    expect(body.isX402).toBe(false);
    expect(body.status).toBe(302);
    expect(body.redirectedTo).toContain("169.254.169.254");
  });

  it("returns 202 for notifications and 405 for GET", async () => {
    const notif = await SELF.fetch(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(notif.status).toBe(202);

    const get = await SELF.fetch(MCP_URL);
    expect(get.status).toBe(405);
  });
});
