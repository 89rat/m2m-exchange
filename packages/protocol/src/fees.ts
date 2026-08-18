/**
 * M2M/1 platform monetization — fee schedule and take-rate math.
 *
 * All arithmetic is integer (BigInt) on base units. Floats never touch money
 * (PROTOCOL.md §2.3, §8 rule 7). Fees are deterministic: same inputs, same
 * fee, every time, verifiable by both parties before signing.
 */

import type { BaseUnitAmount } from "./index.js";

/** Platform fee policy. Versioned so quotes can pin the schedule they used. */
export interface FeeSchedule {
  /** Schema/policy version, bumped on any change. */
  feeScheduleVersion: number;
  /** Ad valorem fee in basis points (1 bps = 0.01%). 200 = 2%. */
  feeBps: number;
  /** Minimum fee per transaction, base units. Floors tiny transactions. */
  minFee: BaseUnitAmount;
  /** Maximum fee per transaction, base units. Caps large ones. */
  maxFee: BaseUnitAmount;
}

/** Result of splitting a gross payment into seller and platform shares. */
export interface FeeSplit {
  gross: BaseUnitAmount;
  platformFee: BaseUnitAmount;
  sellerNet: BaseUnitAmount;
  feeScheduleVersion: number;
}

/**
 * ad_valorem = floor(gross * bps / 10_000), then clamped to [minFee, maxFee].
 * platformFee can never exceed gross; sellerNet is never negative.
 */
export function splitPayment(
  gross: BaseUnitAmount,
  schedule: FeeSchedule,
): FeeSplit {
  const g = BigInt(gross);
  if (g < 0n) throw new RangeError("gross must be a non-negative base-unit integer");

  let fee = (g * BigInt(schedule.feeBps)) / 10_000n;
  const min = BigInt(schedule.minFee);
  const max = BigInt(schedule.maxFee);
  if (fee < min) fee = min;
  if (fee > max) fee = max;
  if (fee > g) fee = g; // degenerate case: fee clamped to gross

  return {
    gross: g.toString(),
    platformFee: fee.toString(),
    sellerNet: (g - fee).toString(),
    feeScheduleVersion: schedule.feeScheduleVersion,
  };
}

/** Default launch schedule: 2% with a $0.0001 floor (100 base units of 6dp USDC). */
export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  feeScheduleVersion: 1,
  feeBps: 200,
  minFee: "100",
  maxFee: "1000000000000", // $1M cap — effectively uncapped at launch
};
