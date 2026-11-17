// spec/settlement/money.md, "Full-width ordinary and private fee calculations conserve every base unit"; spec/settlement/money.md, "Ordinary fees round upward and private splits require exact division"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { ordinaryFeeAmount, ordinaryNetAmount, privateFeeAmount, privateResearcherAmount } from "../../gen/settlement__money.ts";
import { fromAmount, MAX_BASE_UNITS, toAmount } from "./amounts.ts";
import { bountyFeeBase, bountyResearcherBase, ordinaryFeeBase, ordinaryNetBase, payoutAmountsAccepted } from "./fees.ts";

const gross = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: MAX_BASE_UNITS }));

const ordinary = (value: bigint) => ({ fee: ordinaryFeeBase(value), net: ordinaryNetBase(value) });

export const ordinaryFeeMatchesTheFullWidthRule = contract({
  input: gross,
  run: ordinary,
  invariant: (value, { fee, net }) =>
    fee + net === value
    && fee === fromAmount(ordinaryFeeAmount(toAmount(value)))
    && net === fromAmount(ordinaryNetAmount(toAmount(value)))
    && (value === 0n || payoutAmountsAccepted(value, fee, net, false, MAX_BASE_UNITS)),
});

const divisibleByFour = Arbitrary.schema(Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: MAX_BASE_UNITS / 4n })))
  .pipe(Arbitrary.map((quarter) => quarter * 4n));

const bounty = (value: bigint) => ({ fee: bountyFeeBase(value), researcher: bountyResearcherBase(value) });

export const bountySplitMatchesTheFullWidthRule = contract({
  input: divisibleByFour,
  run: bounty,
  invariant: (value, { fee, researcher }) =>
    fee + researcher === value
    && researcher === fee * 3n
    && fee === fromAmount(privateFeeAmount(toAmount(value)))
    && researcher === fromAmount(privateResearcherAmount(toAmount(value)))
    && payoutAmountsAccepted(value, fee, researcher, true, MAX_BASE_UNITS),
});

export const baseUnitsSurviveLimbs = contract({ input: gross, run: toAmount, inverse: fromAmount });
