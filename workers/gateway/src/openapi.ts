/**
 * OpenAPI 3.1 description of the gateway's public API — the integration
 * manifest most tool hubs (Composio, Bazaar crawlers, framework adapters)
 * parse. Served at GET /openapi.json. Prices are config-driven (LOOPS.md
 * T2), so paid routes reference GET /v1/services for live terms instead of
 * hardcoding amounts.
 */

const PAYMENT_REQUIRED_RESPONSE = {
  description:
    "x402 payment required. Body carries accepts[] with scheme, network, maxAmountRequired (USDC base units), payTo, asset. Sign an EIP-3009 authorization for the quoted terms and retry with the X-PAYMENT header.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          x402Version: { type: "integer" },
          accepts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                scheme: { type: "string" },
                network: { type: "string" },
                maxAmountRequired: { type: "string", description: "USDC base units (6 decimals), integer string" },
                payTo: { type: "string" },
                asset: { type: "string" },
                resource: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const X_PAYMENT_PARAM = {
  name: "X-PAYMENT",
  in: "header",
  required: false,
  description: "Signed EIP-3009 payment authorization matching the 402 challenge terms. Omit to receive the 402 challenge.",
  schema: { type: "string" },
} as const;

export function openApiSpec(gatewayUrl: string): Record<string, unknown> {
  const paid = (summary: string, method: "get" | "post", extra?: Record<string, unknown>) => ({
    [method]: {
      summary,
      parameters: [X_PAYMENT_PARAM],
      responses: {
        "200": { description: "Paid response. X-PAYMENT-RESPONSE header carries the settlement receipt (payer, tx hash)." },
        "402": PAYMENT_REQUIRED_RESPONSE,
      },
      ...extra,
    },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "code402 gateway",
      version: "1.0.0",
      description:
        "Machine-payable APIs over x402 (HTTP 402 + USDC) on the open M2M/1 protocol. Live pricing and the full catalog: GET /v1/services. Non-custodial: payments settle direct to seller wallets.",
      contact: { url: "https://code402.dev" },
    },
    servers: [{ url: gatewayUrl }],
    paths: {
      "/healthz": {
        get: { summary: "Health + configured settlement network (free)", responses: { "200": { description: "{ status, service, network }" } } },
      },
      "/v1/services": {
        get: { summary: "M2M/1 ServiceList: every payable service with live integer-unit USDC pricing (free)", responses: { "200": { description: "{ m2mVersion, services[] }" } } },
      },
      "/v1/stats": {
        get: { summary: "Public platform telemetry: settled calls, gross, unique payers, top services (free, 60s cache)", responses: { "200": { description: "aggregate stats" } } },
      },
      "/v1/sellers": {
        get: { summary: "Seller registration guide (free)", responses: { "200": { description: "how_to_register steps" } } },
        post: {
          summary: "Register or update a seller (free). Payments settle direct to this wallet.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["id", "wallet", "name"], properties: { id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,62}$" }, wallet: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, name: { type: "string", maxLength: 80 } } } } },
          },
          responses: { "201": { description: "{ sellerId, wallet, storefront }" }, "400": { description: "validation error naming the field" } },
        },
      },
      "/v1/sellers/{sellerId}/services": {
        post: {
          summary: "List an API for sale behind the x402 paywall (free to list; 2% take-rate invoiced on settled receipts)",
          parameters: [{ name: "sellerId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["serviceId", "upstream_url", "price_usd"], properties: { serviceId: { type: "string" }, upstream_url: { type: "string", description: "public https target" }, price_usd: { type: "string", description: "like $0.05" }, method: { type: "string" }, description: { type: "string", maxLength: 300 } } } } },
          },
          responses: { "201": { description: "{ listing, paid_endpoint }" } },
        },
      },
      "/v1/sellers/{sellerId}/analytics": {
        get: { summary: "Seller's own settlement analytics (free)", parameters: [{ name: "sellerId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "{ total_settled_calls, gross_usd, unique_buyers, by_service }" } } },
      },
      "/v1/sellers/{sellerId}/invoice": {
        get: { summary: "Take-rate invoice computed from settled receipts (free)", parameters: [{ name: "sellerId", in: "path", required: true, schema: { type: "string" } }, { name: "since", in: "query", schema: { type: "integer", description: "unix ms" } }], responses: { "200": { description: "integer USDC-unit invoice" } } },
      },
      "/s/{sellerId}/{serviceId}": {
        get: {
          summary: "Third-party listing (paid, x402): settles direct to the seller wallet, response carries receipt + invitation",
          parameters: [{ name: "sellerId", in: "path", required: true, schema: { type: "string" } }, { name: "serviceId", in: "path", required: true, schema: { type: "string" } }, X_PAYMENT_PARAM],
          responses: { "200": { description: "{ m2mVersion, data, receipt, invitation }" }, "402": PAYMENT_REQUIRED_RESPONSE, "404": { description: "SERVICE_NOT_FOUND" } },
        },
      },
      "/api/weather": paid("Demo weather reading (paid, basic tier)", "get"),
      "/api/forecast": paid("5-day forecast (paid, premium tier)", "get"),
      "/api/echo": paid("Echo the request body (paid, basic tier)", "post"),
      "/api/x402-probe": paid("Probe any https URL for a valid x402 paywall; returns normalized terms (paid, premium tier)", "post", {
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" } } } } } },
      }),
      "/api/vat-check": paid("ISO 7064 MOD-97-10 VAT checksum validation (paid, premium tier)", "post", {
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["vat_number"], properties: { vat_number: { type: "string" } } } } } },
      }),
    },
  };
}
