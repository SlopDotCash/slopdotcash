// spec/backend/submissionFeeTerms.md, "A SLOP rate is in force from its own hour, and the previous one still counts for 48 hours"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { lowerAmount, rateMicros, rateScale, slopFeeUnits, twoSignificant } from "./submissionFeeKernels.ts";

const positive = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 10n ** 40n }));
const stable = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1_000_000n, maximum: 10_000_000n }));
const rate = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 10n ** 30n }));

const significant = (value: bigint) => value.toString().replace(/0+$/u, "").length;
const halfUnit = (value: bigint) => {
  const digits = value.toString().length;
  return digits <= 2 ? 0n : 10n ** BigInt(digits - 2) / 2n;
};

export const feesKeepTwoSignificantDigitsRoundedHalfUp = contract({
  input: Schema.Struct({ value: positive }),
  run: ({ value }) => twoSignificant(value),
  invariant: ({ value }, rounded) => rounded > 0n && significant(rounded) <= 2 && (rounded > value ? rounded - value : value - rounded) <= halfUnit(value),
});

export const slopFeeIsHalfTheStableFeeAtTheRate = contract({
  input: Schema.Struct({ stableMinor: stable, rateScaled: rate }),
  run: ({ stableMinor, rateScaled }) => slopFeeUnits(stableMinor, rateScaled, 5000n, 1_000_000n),
  invariant: ({ stableMinor, rateScaled }, fee) => {
    const exact = (stableMinor * rateScaled * 5000n) / 10_000_000_000n;
    return exact === 0n ? fee === 0n : fee === twoSignificant(exact);
  },
});

export const theLowerAmountIsOneOfBoth = contract({
  input: Schema.Struct({ left: positive, right: positive }),
  run: ({ left, right }) => lowerAmount(left, right),
  invariant: ({ left, right }, lower) => (lower === left || lower === right) && lower <= left && lower <= right,
});

export const rateTextRoundsToSixDecimals = contract({
  input: Schema.Struct({ whole: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 999_999_999_999n })) }),
  run: ({ whole }) => rateMicros(whole * rateScale),
  invariant: ({ whole }, micros) => micros === whole * 1_000_000n,
});
