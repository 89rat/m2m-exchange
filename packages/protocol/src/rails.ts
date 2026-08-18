/**
 * M2M/1.1 rail adapters — types for multi-rail payments, prepaid credits,
 * and trust tiers. Normative source: protocol/M2M-1.1-rails.md.
 * All additions are backward compatible with M2M/1 (v1 consumers ignore them).
 */

import type {
  BaseUnitAmount,
  EvmAddress,
  ResourceId,
  UnixSeconds,
} from "./index.js";

/** Known rail schemes (M2M-1.1 §1). "escrow" is reserved for v1.2. */
export type RailScheme = "exact" | "fiat-stripe" | "prepaid" | "escrow";

/** How reversible a settlement is (§3). */
export type FinalityClass =
  | "instant"
  | "deterministic"
  | "reversible"
  | "conditional";

/** v1 x402 payment requirement (unchanged). */
export interface X402ExactOption {
  scheme: "exact";
  network: string;
  maxAmountRequired: BaseUnitAmount;
  resource: string;
  payTo: EvmAddress;
  asset: EvmAddress;
  maxTimeoutSeconds: number;
}

/** §2.2 — card/bank payment via a regulated processor. Minor-unit integers. */
export interface StripeFiatOption {
  scheme: "fiat-stripe";
  network: "stripe";
  maxAmountRequired: BaseUnitAmount;
  /** ISO 4217, lowercase, e.g. "usd". */
  currency: string;
  /** One-time checkout link scoped to the order. */
  paymentUrl: string;
  expiresAt: UnixSeconds;
  rail: { processor: "stripe"; statementDescriptor: string };
}

/** §2.3 — debit against the buyer's prepaid ledger balance (USD6 credits). */
export interface PrepaidOption {
  scheme: "prepaid";
  network: "m2m-ledger";
  maxAmountRequired: BaseUnitAmount;
  /** Synthetic 6-decimal USD ledger credit; not a token, not transferable. */
  asset: "USD6";
  account: string;
}

/** Polymorphic accepts[] entry (§2): buyer pays with ANY one option. */
export type PaymentOption = X402ExactOption | StripeFiatOption | PrepaidOption;

/** Receipt v1.1 fields (§3) — every rail normalizes to a settlementRef. */
export interface SettlementProof {
  /** txHash (x402), processor charge id (stripe), ledger entry id (prepaid). */
  settlementRef: string;
  finalityClass: FinalityClass;
  /** Receipt is irreversible at this time; equals settledAt for instant/deterministic. */
  finalAt: UnixSeconds;
}

/** §5.1 — double-entry ledger record. Balances are derived, never stored. */
export interface LedgerEntry {
  entryId: ResourceId;
  accountId: string;
  direction: "debit" | "credit";
  /** USD6 integer base units. */
  amount: BaseUnitAmount;
  refType: "topup" | "spend" | "refund" | "fee" | "payout";
  refId: string;
  createdAt: UnixSeconds;
  /** Unique; retries never double-post. */
  idempotencyKey: string;
}

/** §6 — seller trust tiers in the registry. */
export type TrustTier = "crypto_native" | "verified_fiat" | "enterprise";

export const TRUST_TIER_RANK: Record<TrustTier, number> = {
  crypto_native: 0,
  verified_fiat: 1,
  enterprise: 2,
};

/** True when a seller of `tier` may use rail `scheme` (§6). */
export function railAllowedForTier(scheme: RailScheme, tier: TrustTier): boolean {
  if (scheme === "fiat-stripe") return TRUST_TIER_RANK[tier] >= 1;
  return true; // crypto rails and prepaid are open to all tiers
}

/** §3 — compute finality metadata for a rail at settle time. */
export function finalityFor(
  scheme: RailScheme,
  settledAt: UnixSeconds,
  disputeWindowSeconds = 120 * 24 * 3600, // card chargeback window (~120 days)
): { finalityClass: FinalityClass; finalAt: UnixSeconds } {
  switch (scheme) {
    case "prepaid":
      return { finalityClass: "instant", finalAt: settledAt };
    case "exact":
      return { finalityClass: "deterministic", finalAt: settledAt };
    case "fiat-stripe":
      return {
        finalityClass: "reversible",
        finalAt: settledAt + disputeWindowSeconds,
      };
    case "escrow":
      return { finalityClass: "conditional", finalAt: settledAt };
  }
}

/**
 * §5.1 conservation check over a set of ledger entries: Σ credits − Σ debits.
 * Pure integer math; reconciliation jobs compare this against stored balances.
 */
export function ledgerNet(entries: readonly LedgerEntry[]): bigint {
  return entries.reduce(
    (acc, e) => acc + (e.direction === "credit" ? BigInt(e.amount) : -BigInt(e.amount)),
    0n,
  );
}
