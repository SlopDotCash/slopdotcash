// spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"; spec/settlement/money.md, "Contract amounts stay inside the unsigned integer range of their network"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { formatBaseUnits, MAX_BASE_UNITS, MAX_DECIMALS, parseDecimalAmount } from "@repo/settlement/kernels/amounts";
import { showAmount } from "../../gen/frontend__presentation.ts";

const baseUnits = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: MAX_BASE_UNITS }));
const positiveBaseUnits = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: MAX_BASE_UNITS }));
const decimals = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_DECIMALS }));
const safeDecimals = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 15 }));
const safeUnits = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));

export const formattedAmountsParseBackExactly = contract({
  input: Schema.Struct({ value: positiveBaseUnits, decimals }),
  run: ({ value, decimals }) => parseDecimalAmount({ text: formatBaseUnits({ value, decimals, grouping: false }), decimals }),
  invariant: ({ value }, parsed) => parsed.kind === "Parsed" && parsed.amount === value,
});

export const groupingOnlyInsertsCommasEveryThreeWholeDigits = contract({
  input: Schema.Struct({ value: baseUnits, decimals }),
  run: ({ value, decimals }) => ({ grouped: formatBaseUnits({ value, decimals }), plain: formatBaseUnits({ value, decimals, grouping: false }) }),
  invariant: (_amount, { grouped, plain }) => /^\d{1,3}(?:,\d{3})*(?:\.\d*[1-9])?$/u.test(grouped) && grouped.replaceAll(",", "") === plain,
});

export const formattedAmountsMatchTheShownAmountRule = contract({
  input: Schema.Struct({ units: safeUnits, decimals: safeDecimals }),
  run: ({ units, decimals }) => formatBaseUnits({ value: BigInt(units), decimals, grouping: false }),
  invariant: ({ units, decimals }, text) => {
    const { whole, fraction, fractionDigits } = showAmount(units, decimals);
    return text === (fractionDigits === 0 ? `${whole}` : `${whole}.${String(fraction).padStart(fractionDigits, "0")}`);
  },
});
