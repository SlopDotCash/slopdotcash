// spec/security/reportDeposit.md, "A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { depositAmountText, reportDepositAmount, reportDepositItem, reportDepositOn } from "./reportDeposit.ts";

const caseIdText = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{8,72}$/u));

export const theDepositIsFiveDollarsRoundedUpToWholeSlop = contract({
  input: Schema.Tuple([Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000_000 })), Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 999_999 }))]),
  run: ([whole, micros]) => reportDepositAmount(micros === 0 ? `${whole}` : `${whole}.${String(micros).padStart(6, "0")}`),
  invariant: ([whole, micros], amount) => {
    if (amount === undefined) return false;
    const units = BigInt(amount);
    const one = 10n ** 18n;
    const exact = 5n * (BigInt(whole) * 1_000_000n + BigInt(micros));
    return units % one === 0n && (units / one) * 1_000_000n >= exact && (units / one - 1n) * 1_000_000n < exact;
  },
});

export const knownRatesGiveTheirDeposit = contract({
  input: Schema.Literal("vectors"),
  run: () => [reportDepositAmount("395"), reportDepositAmount("0.5"), reportDepositAmount(null), depositAmountText("1975000000000000000000"), depositAmountText("1500000000000000000")],
  invariant: (_, outcomes) => JSON.stringify(outcomes) === JSON.stringify(["1975000000000000000000", "3000000000000000000", undefined, "1975 SLOP", "1.5 SLOP"]),
});

export const everyCaseHasItsOwnItem = contract({
  input: Schema.Tuple([caseIdText, caseIdText]),
  run: ([left, right]) => [reportDepositItem(`sc_${left}`), reportDepositItem(`sc_${right}`), reportDepositItem(left)],
  invariant: ([left, right], [first, second, bare]) => first !== undefined && /^0x[0-9a-f]{64}$/u.test(first) && (left === right) === (first === second) && bare === undefined,
});

export const onlyAnExplicitFalseTurnsTheDepositOff = contract({
  input: Schema.Union([Schema.Boolean, Schema.Null, Schema.String]),
  run: (setting) => [reportDepositOn({ security: { reportDeposit: setting } }), reportDepositOn({}), reportDepositOn(undefined)],
  invariant: (setting, [on, absent, none]) => on === (setting !== false) && absent && none,
});
