import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_SCHEDULE, splitPayment, type FeeSchedule } from "./fees.js";

describe("splitPayment (integer take-rate math)", () => {
  it("computes 2% ad valorem exactly", () => {
    // gross $1.00 = 1_000_000 base units (6dp USDC), 200 bps = $0.02
    const s = splitPayment("1000000", DEFAULT_FEE_SCHEDULE);
    expect(s.platformFee).toBe("20000");
    expect(s.sellerNet).toBe("980000");
    expect(s.feeScheduleVersion).toBe(1);
  });

  it("floors fractional fees (integer truncation, no rounding up)", () => {
    // 2% of 999 base units = 19.98 -> floor 19
    const s = splitPayment("999", { ...DEFAULT_FEE_SCHEDULE, minFee: "0" });
    expect(s.platformFee).toBe("19");
    expect(s.sellerNet).toBe("980");
  });

  it("applies minFee to tiny transactions", () => {
    // 2% of $0.001 (1000 base units) = 20, but minFee 100 wins
    const s = splitPayment("1000", DEFAULT_FEE_SCHEDULE);
    expect(s.platformFee).toBe("100");
    expect(s.sellerNet).toBe("900");
  });

  it("applies maxFee to huge transactions", () => {
    const schedule: FeeSchedule = { feeScheduleVersion: 2, feeBps: 200, minFee: "0", maxFee: "5000" };
    const s = splitPayment("1000000000", schedule); // $1000 gross
    expect(s.platformFee).toBe("5000");
    expect(s.sellerNet).toBe("999995000");
  });

  it("never lets the fee exceed gross", () => {
    const s = splitPayment("50", DEFAULT_FEE_SCHEDULE); // minFee 100 > gross 50
    expect(s.platformFee).toBe("50");
    expect(s.sellerNet).toBe("0");
  });

  it("handles zero gross", () => {
    const s = splitPayment("0", DEFAULT_FEE_SCHEDULE);
    expect(s.platformFee).toBe("0");
    expect(s.sellerNet).toBe("0");
  });

  it("rejects negative amounts", () => {
    expect(() => splitPayment("-1", DEFAULT_FEE_SCHEDULE)).toThrow(RangeError);
  });

  it("is deterministic: same inputs, same fee", () => {
    const a = splitPayment("123456789", DEFAULT_FEE_SCHEDULE);
    const b = splitPayment("123456789", DEFAULT_FEE_SCHEDULE);
    expect(a).toEqual(b);
  });
});
