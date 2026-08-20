/**
 * code402-mcp-server — MCP endpoint for the code402/m2m-exchange estate.
 *
 * Stateless streamable-HTTP JSON profile: every POST /mcp carries one
 * JSON-RPC message; a fresh McpServer handles it and the JSON response is
 * returned in the HTTP body (no sessions, no SSE). Discovery + seller ops
 * only — never custody, never keys (STRATEGY.md law #1).
 */
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./tools";
import { WorkersJsonTransport, primeServer } from "./transport";
import type { McpBindings } from "./gateway";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rpcError(id: string | number | null, code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleMcp(request: Request, env: McpBindings): Promise<Response> {
  let message: JSONRPCMessage;
  try {
    message = (await request.json()) as JSONRPCMessage;
  } catch {
    return rpcError(null, -32700, "Parse error: body must be a single JSON-RPC message");
  }
  if (Array.isArray(message)) {
    return rpcError(null, -32600, "Batch requests are not supported; send one message per POST");
  }
  // Only client REQUESTS (method + id) and NOTIFICATIONS (method, no id) are
  // valid inbound. A response-shaped body (id but no method) would register a
  // waiter the server never resolves — hanging the request — so reject it.
  const m = message as { method?: string; id?: string | number };
  if (typeof m.method !== "string") {
    return rpcError(m.id ?? null, -32600, "Invalid Request: expected a JSON-RPC request or notification (method required)");
  }

  const server = buildServer(env);
  const transport = new WorkersJsonTransport();
  await server.connect(transport);

  try {
    const method = (message as { method?: string }).method ?? "";
    if (method !== "initialize" && !method.startsWith("notifications/")) {
      // Stateless: each POST gets a fresh server, so re-run the handshake.
      await primeServer(transport);
    }
    const pending = transport.dispatch(message);
    if (!pending) return new Response(null, { status: 202 }); // notification
    const response = await pending;
    return json(response);
  } finally {
    await server.close().catch(() => {});
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return json({ status: "ok", service: "code402-mcp", gateway: env.GATEWAY_URL });
    }
    if (url.pathname === "/mcp" || url.pathname === "/") {
      if (request.method !== "POST") {
        return json(
          {
            error: "Method not allowed: this MCP server speaks stateless JSON — POST one JSON-RPC message to /mcp",
            server: "code402-mcp-server",
          },
          405,
        );
      }
      return handleMcp(request, env);
    }
    return json({ error: "not found; MCP endpoint is POST /mcp" }, 404);
  },
} satisfies ExportedHandler<McpBindings>;
