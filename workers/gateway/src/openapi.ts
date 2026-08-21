/**
 * OpenAPI 3.1 description of the gateway's public API — the CANONICAL discovery
 * contract x402scan / @agentcash/discovery parse (served at GET /openapi.json).
 *
 * x402scan requirements honored here (https://x402scan.com/discovery/spec):
 *  - info.title, info.version, info.x-guidance, info.contact.email
 *  - paid ops carry x-payment-info { price:{mode,currency,amount}, protocols:[{x402:{}}] }
 *    with amount as DECIMAL USD, plus responses.402
 *  - every invocable op exposes an INPUT and an OUTPUT schema
 *  - free/public ops declare security: [] (explicitly unauthenticated)
 *  - templated per-seller path removed from discovery (unresolvable on probe;
 *    concrete listings are discovered via GET /v1/services instead)
 */

const X_PAYMENT_PARAM = {
  name: "X-PAYMENT",
  in: "header",
  required: false,
  description: "Signed EIP-3009 payment authorization matching the 402 challenge terms. Omit to receive the 402 challenge.",
  schema: { type: "string" },
} as const;

const PAYMENT_REQUIRED_402 = { description: "Payment Required" } as const;

/** decimal-USD string like "0.001000" from a "$0.001" tier string. */
function usd(tier: string): string {
  return Number(tier.replace("$", "")).toFixed(6);
}

function paidOp(args: {
  operationId: string;
  summary: string;
  priceUsd: string;
  outputSchema: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
}) {
  const op: Record<string, unknown> = {
    operationId: args.operationId,
    summary: args.summary,
    parameters: [X_PAYMENT_PARAM],
    "x-payment-info": {
      price: { mode: "fixed", currency: "USD", amount: args.priceUsd },
      protocols: [{ x402: {} }],
    },
    responses: {
      "200": {
        description: "Paid response. X-PAYMENT-RESPONSE header carries the settlement receipt (payer, tx hash).",
        content: { "application/json": { schema: args.outputSchema } },
      },
      "402": PAYMENT_REQUIRED_402,
    },
  };
  if (args.inputSchema) {
    op.requestBody = { required: true, content: { "application/json": { schema: args.inputSchema } } };
  }
  return op;
}

/** Free/public op: explicitly unauthenticated (security: []) with an output schema. */
function freeOp(summary: string, outputSchema: Record<string, unknown>, extra?: Record<string, unknown>) {
  return {
    summary,
    security: [],
    responses: { "200": { description: summary, content: { "application/json": { schema: outputSchema } } } },
    ...extra,
  };
}

const OBJ = (properties: Record<string, unknown>, required?: string[]) => ({
  type: "object",
  properties,
  ...(required ? { required } : {}),
});

export function openApiSpec(
  gatewayUrl: string,
  opts: { basicUsd?: string; premiumUsd?: string; contactEmail?: string } = {},
): Record<string, unknown> {
  const basic = usd(opts.basicUsd ?? "$0.001");
  const premium = usd(opts.premiumUsd ?? "$0.005");
  const email = opts.contactEmail ?? "hello@code402.dev";

  return {
    openapi: "3.1.0",
    info: {
      title: "code402 gateway",
      version: "1.0.0",
      description:
        "Machine-payable APIs over x402 (HTTP 402 + USDC) on the open M2M/1 protocol. Non-custodial: payments settle direct to seller wallets.",
      "x-guidance":
        "Pay-per-call APIs over x402. To call a paid route, send the request; you receive HTTP 402 with an x402 challenge (accepts[] carries scheme, CAIP-2 network, amount in USDC atomic units, asset, payTo). Sign an EIP-3009 USDC authorization for those terms and retry with the X-PAYMENT header; the 200 response returns your data plus an X-PAYMENT-RESPONSE receipt (payer, tx hash). Prices are also listed decimal-USD in each operation's x-payment-info and live at GET /v1/services. Free routes (health, catalog, stats, seller registration) require no payment. Start with GET /v1/services to enumerate every payable service.",
      contact: { url: "https://code402.dev", email },
    },
    servers: [{ url: gatewayUrl }],
    paths: {
      // ---- Free / public (identity-free) ----
      "/healthz": {
        get: freeOp(
          "Health + configured settlement network (free)",
          OBJ({ status: { type: "string" }, service: { type: "string" }, network: { type: "string" } }),
        ),
      },
      "/v1/services": {
        get: freeOp(
          "M2M/1 ServiceList: every payable service with live integer-unit USDC pricing (free)",
          OBJ({ m2mVersion: { type: "integer" }, services: { type: "array", items: { type: "object" } } }),
        ),
      },
      "/v1/stats": {
        get: freeOp(
          "Public platform telemetry: settled calls, gross, unique payers (free)",
          OBJ({ total_settled_calls: { type: "integer" }, gross_usd: { type: "number" }, unique_payers: { type: "integer" } }),
        ),
      },
      "/v1/sellers": {
        get: freeOp("Seller registration guide (free)", OBJ({ how_to_register: { type: "array", items: { type: "string" } } })),
        post: {
          operationId: "registerSeller",
          summary: "Register or update a seller (free). Payments settle direct to this wallet.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: OBJ(
                  {
                    id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,62}$" },
                    wallet: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
                    name: { type: "string", maxLength: 80 },
                  },
                  ["id", "wallet", "name"],
                ),
              },
            },
          },
          responses: {
            "201": {
              description: "Seller registered",
              content: { "application/json": { schema: OBJ({ sellerId: { type: "string" }, wallet: { type: "string" }, storefront: { type: "string" } }) } },
            },
            "400": { description: "validation error naming the field" },
          },
        },
      },
      "/v1/sellers/{sellerId}/services": {
        post: {
          operationId: "listService",
          summary: "List an API for sale behind the x402 paywall (free to list)",
          security: [],
          parameters: [{ name: "sellerId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: OBJ(
                  {
                    serviceId: { type: "string" },
                    upstream_url: { type: "string", description: "public https target" },
                    price_usd: { type: "string", description: "like $0.05" },
                    method: { type: "string" },
                    description: { type: "string", maxLength: 300 },
                  },
                  ["serviceId", "upstream_url", "price_usd"],
                ),
              },
            },
          },
          responses: {
            "201": { description: "Listing created", content: { "application/json": { schema: OBJ({ listing: { type: "object" }, paid_endpoint: { type: "string" } }) } } },
          },
        },
      },
      "/v1/sellers/{sellerId}/analytics": {
        get: {
          operationId: "sellerAnalytics",
          summary: "Seller's own settlement analytics (free)",
          security: [],
          parameters: [{ name: "sellerId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Analytics",
              content: { "application/json": { schema: OBJ({ total_settled_calls: { type: "integer" }, gross_usd: { type: "number" }, unique_buyers: { type: "integer" }, by_service: { type: "object" } }) } },
            },
          },
        },
      },
      "/v1/sellers/{sellerId}/invoice": {
        get: {
          operationId: "sellerInvoice",
          summary: "Take-rate invoice computed from settled receipts (free)",
          security: [],
          parameters: [
            { name: "sellerId", in: "path", required: true, schema: { type: "string" } },
            { name: "since", in: "query", required: false, schema: { type: "integer", description: "unix ms" } },
          ],
          responses: { "200": { description: "Invoice", content: { "application/json": { schema: OBJ({ fee_units: { type: "string" }, currency: { type: "string" } }) } } } },
        },
      },

      // ---- Paid (x402) ----
      "/api/weather": {
        get: paidOp({
          operationId: "weather",
          summary: "Demo weather reading (paid, basic tier)",
          priceUsd: basic,
          outputSchema: OBJ({ location: { type: "string" }, temperatureC: { type: "number" }, conditions: { type: "string" }, paid: { type: "boolean" }, paidTo: { type: "string" } }),
        }),
      },
      "/api/forecast": {
        get: paidOp({
          operationId: "forecast",
          summary: "5-day forecast (paid, premium tier)",
          priceUsd: premium,
          outputSchema: OBJ({ location: { type: "string" }, days: { type: "array", items: { type: "object" } }, paid: { type: "boolean" }, paidTo: { type: "string" } }),
        }),
      },
      "/api/echo": {
        post: paidOp({
          operationId: "echo",
          summary: "Echo the request body (paid, basic tier)",
          priceUsd: basic,
          inputSchema: OBJ({ message: { type: "string", description: "any JSON is echoed back" } }),
          outputSchema: OBJ({ echo: {}, method: { type: "string" }, paid: { type: "boolean" } }),
        }),
      },
      "/api/x402-probe": {
        post: paidOp({
          operationId: "x402Probe",
          summary: "Probe any https URL for a valid x402 paywall; returns normalized terms (paid, premium tier)",
          priceUsd: premium,
          inputSchema: OBJ({ url: { type: "string", format: "uri", description: "https URL to probe" } }, ["url"]),
          outputSchema: OBJ({ url: { type: "string" }, status: { type: "integer" }, isX402: { type: "boolean" }, terms: { type: ["object", "null"] }, latencyMs: { type: "integer" }, paid: { type: "boolean" } }),
        }),
      },
      "/api/vat-check": {
        post: paidOp({
          operationId: "vatCheck",
          summary: "ISO 7064 MOD-97-10 VAT checksum validation (paid, premium tier)",
          priceUsd: premium,
          inputSchema: OBJ({ vat_number: { type: "string", description: "e.g. GB123456789" } }, ["vat_number"]),
          outputSchema: OBJ({ vat_number: { type: "string" }, country: { type: "string" }, valid: { type: "boolean" }, checksum: { type: "integer" }, paid: { type: "boolean" } }),
        }),
      },
    },
  };
}
