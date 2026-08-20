/**
 * Stateless MCP transport for Cloudflare Workers.
 *
 * The official SDK's StreamableHTTPServerTransport is Node/express-shaped;
 * Workers hand us a web-standard Request. This adapter implements the SDK's
 * Transport interface for the stateless streamable-HTTP JSON profile: one
 * server instance per incoming POST, responses routed back by JSON-RPC id.
 *
 * Statelessness means a client's initialize handshake may have happened on a
 * different isolate, so before dispatching a non-initialize request we prime
 * the fresh server with a synthetic initialize + initialized notification.
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

type JsonRpcId = string | number;

function messageId(message: JSONRPCMessage): JsonRpcId | null {
  const m = message as { id?: JsonRpcId };
  return m.id ?? null;
}

export class WorkersJsonTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private waiters = new Map<JsonRpcId, (msg: JSONRPCMessage) => void>();

  async start(): Promise<void> {
    // Nothing to open: the Worker request IS the connection.
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const id = messageId(message);
    if (id === null) return; // server-initiated notifications have nowhere to go (stateless)
    const waiter = this.waiters.get(id);
    if (waiter) {
      this.waiters.delete(id);
      waiter(message);
    }
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  /** Feed a client message to the server; resolves with the response for requests. */
  dispatch(message: JSONRPCMessage): Promise<JSONRPCMessage> | null {
    const id = messageId(message);
    if (id === null) {
      this.onmessage?.(message);
      return null; // notification: no response will come
    }
    const response = new Promise<JSONRPCMessage>((resolve) => {
      this.waiters.set(id, resolve);
    });
    this.onmessage?.(message);
    return response;
  }
}

/** Synthetic handshake so a fresh per-request server accepts normal requests. */
export async function primeServer(transport: WorkersJsonTransport): Promise<void> {
  await transport.dispatch({
    jsonrpc: "2.0",
    id: "__init__",
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stateless-http", version: "0" },
    },
  } as JSONRPCMessage);
  transport.dispatch({ jsonrpc: "2.0", method: "notifications/initialized" } as JSONRPCMessage);
}
