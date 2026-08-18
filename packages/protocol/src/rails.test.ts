import { describe, expect, it } from "vitest";
import {
  finalityFor,
  ledgerNet,
  railAllowedForTier,
  type LedgerEntry,
} from "./rails.js";

const entry = (
  direction: "debit" | "credit",
  amount: string,
  idempotencyKey: string,
): LedgerEntry => ({
  entryId: `e-${idempotencyKey}`,
  accountId: "acct-1",
  direction,
  amount,
  refType: direction === "credit" ? "topup" : "spend",
  refId: "ref-1",
  createdAt: 1_700_000_000,
  idempotencyKey,
});

describe("finalityFor (M2M/1.1 §3)", () => {
  it("prepaid settles instantly", () => {
    expect(finalityFor("prepaid", 1000)).toEqual({
      finalityClass: "instant",
      finalAt: 1000,
    });
  });

  it("x402 exact is deterministic and final at settlement", () => {
    expect(finalityFor("exact", 1000)).toEqual({
      finalityClass: "deterministic",
      finalAt: 1000,
    });
  });

  it("stripe fiat is reversible through the dispute window", () => {
    const f = finalityFor("fiat-stripe", 1000, 60);
    expect(f.finalityClass).toBe("reversible");
    expect(f.finalAt).toBe(1060);
  });

  it("escrow is conditional (reserved for v1.2)", () => {
    expect(finalityFor("escrow", 1000).finalityClass).toBe("conditional");
  });
});

describe("railAllowedForTier (M2M/1.1 §6)", () => {
  it("crypto rails are open to every tier", () => {
    expect(railAllowedForTier("exact", "crypto_native")).toBe(true);
    expect(railAllowedForTier("prepaid", "crypto_native")).toBe(true);
  });

  it("fiat rail requires verified_fiat or above", () => {
    expect(railAllowedForTier("fiat-stripe", "crypto_native")).toBe(false);
    expect(railAllowedForTier("fiat-stripe", "verified_fiat")).toBe(true);
    expect(railAllowedForTier("fiat-stripe", "enterprise")).toBe(true);
  });
});

describe("ledgerNet (M2M/1.1 §5.1 conservation)", () => {
  it("nets credits and debits as integers", () => {
    const entries = [
      entry("credit", "10000000", "k1"), // $10 top-up
      entry("debit", "5000", "k2"),      // $0.005 spend
      entry("debit", "5000", "k3"),
    ];
    expect(ledgerNet(entries)).toBe(10000000n - 10000n);
  });

  it("empty ledger nets to zero", () => {
    expect(ledgerNet([])).toBe(0n);
  });

  it("never goes fractional", () => {
    const entries = [entry("credit", "1", "k1"), entry("debit", "1", "k2")];
    expect(ledgerNet(entries)).toBe(0n);
  });
});
