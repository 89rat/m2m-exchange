/**
 * M2M/1 commerce protocol types.
 *
 * Normative source: protocol/PROTOCOL.md. These types mirror
 * protocol/schemas/*.json and are shared by the gateway, buyer agent, and
 * future seller SDKs. Zero runtime dependencies — types plus pure guards.
 *
 * Conventions (PROTOCOL.md §2):
 * - money is an unsigned integer decimal string in base units; never a float
 * - timestamps are integer unix seconds
 * - every message carries `m2mVersion: 1`
 */

export const M2M_VERSION = 1 as const;

/** EIP-55 checksummed or lowercase EVM address. */
export type EvmAddress = `0x${string}`;

/** Unsigned integer decimal string in asset base units, e.g. "1000" = $0.001 USDC. */
export type BaseUnitAmount = string;

/** Seconds since Unix epoch (UTC). */
export type UnixSeconds = number;

/** serviceId / quoteId / orderId / receiptId. */
export type ResourceId = string;

/** Amount + asset + network always travel together (§2.3). */
export interface MoneyAmount {
  amount: BaseUnitAmount;
  /** ERC-20 contract address. */
  asset: EvmAddress;
  /** x402 network string, e.g. "base-sepolia". */
  network: string;
}

/** Transaction lifecycle states (§5). */
export type TxState =
  | "QUOTED"
  | "ACCEPTED"
  | "SETTLED"
  | "REJECTED"
  | "EXPIRED"
  | "FAILED";

/** Terminal states per §5 invariants. */
export const TERMINAL_STATES: ReadonlySet<TxState> = new Set([
  "SETTLED",
  "REJECTED",
  "EXPIRED",
]);

/** §4.2 — what a seller offers. */
export interface ServiceDescriptor {
  m2mVersion: typeof M2M_VERSION;
  serviceId: ResourceId;
  name: string;
  description?: string;
  /** Path relative to the gateway origin, e.g. "/api/weather". */
  endpoint: `/${string}`;
  method: "GET" | "POST" | "PUT" | "DELETE";
  pricing:
    | { mode: "static"; price: MoneyAmount }
    | { mode: "quoted" };
  /** JSON Schema the paid call's params/body must conform to. */
  inputSchema?: Record<string, unknown>;
}

/** §6.1 — GET /v1/services response body. */
export interface ServiceList {
  m2mVersion: typeof M2M_VERSION;
  services: ServiceDescriptor[];
}

/** §4.3 — POST /v1/quotes body. */
export interface QuoteRequest {
  m2mVersion: typeof M2M_VERSION;
  serviceId: ResourceId;
  params?: Record<string, unknown>;
}

/** §4.4 — firm, single-use, expiring price commitment. */
export interface Quote {
  m2mVersion: typeof M2M_VERSION;
  quoteId: ResourceId;
  serviceId: ResourceId;
  price: MoneyAmount;
  payTo: EvmAddress;
  expiresAt: UnixSeconds;
  /** keccak256 of the canonical JSON of the bound commercial terms. */
  termsHash?: `0x${string}`;
}

/** §4.5 — POST /v1/orders body. Send with an Idempotency-Key header. */
export interface OrderRequest {
  m2mVersion: typeof M2M_VERSION;
  quoteId: ResourceId;
}

/** Subset of x402 v1 payment requirements carried in an Order (§4.5). */
export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: BaseUnitAmount;
  resource: string;
  payTo: EvmAddress;
  asset: EvmAddress;
  maxTimeoutSeconds: number;
}

/** §4.5 — 201 response from POST /v1/orders. */
export interface Order {
  m2mVersion: typeof M2M_VERSION;
  orderId: ResourceId;
  quoteId: ResourceId;
  serviceId: ResourceId;
  price: MoneyAmount;
  /** Payee inherited from the quote; every accepts[] entry must match it (§6.4). */
  payTo: EvmAddress;
  expiresAt: UnixSeconds;
  /** x402 requirements for the order's resource URL; must agree with price (§6.4). */
  accepts: X402PaymentRequirement[];
}

/** §4.6 — proof of settled commerce, returned with the paid resource. */
export interface Receipt {
  m2mVersion: typeof M2M_VERSION;
  receiptId: ResourceId;
  /** null for static services (no order was placed). */
  orderId: ResourceId | null;
  serviceId: ResourceId;
  price: MoneyAmount;
  payer: EvmAddress;
  payTo: EvmAddress;
  txHash: `0x${string}`;
  settledAt: UnixSeconds;
}

/** §7 error codes. */
export type ErrorCode =
  | "UNSUPPORTED_VERSION"
  | "INVALID_MESSAGE"
  | "SERVICE_NOT_FOUND"
  | "QUOTE_NOT_FOUND"
  | "QUOTE_REJECTED"
  | "QUOTE_EXPIRED"
  | "QUOTE_CONSUMED"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_PAYABLE"
  | "AMOUNT_MISMATCH"
  | "RATE_LIMITED"
  | "INTERNAL";

/** §7 — all non-2xx M2M/1 responses. */
export interface ErrorObject {
  m2mVersion: typeof M2M_VERSION;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

/** Build an ErrorObject. */
export function errorObject(
  code: ErrorCode,
  message: string,
  retryable: boolean,
): ErrorObject {
  return { m2mVersion: M2M_VERSION, error: { code, message, retryable } };
}

/** §2.4 — a quote or order is expired when now >= expiresAt. */
export function isExpired(expiresAt: UnixSeconds, now?: UnixSeconds): boolean {
  return (now ?? Math.floor(Date.now() / 1000)) >= expiresAt;
}

/** §6.4 — every accepts[] entry must agree exactly with the order price. */
export function paymentRequirementsMatchPrice(order: Order): boolean {
  return order.accepts.every(
    (req) =>
      req.maxAmountRequired === order.price.amount &&
      req.asset.toLowerCase() === order.price.asset.toLowerCase() &&
      req.network === order.price.network &&
      req.payTo.toLowerCase() === order.payTo.toLowerCase(),
  );
}
