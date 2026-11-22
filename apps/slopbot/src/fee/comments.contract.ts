// spec/slopbot/submissionFeeGate.md, "One job asks under a lease, and a failed write hands the lease back"; spec/slopbot/submissionFeeGate.md, "A paid fee runs the held review, and Slopbot sets only a due outcome on a paid row"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { type FeeOptionTerms, feeMarker, feeNeededComment, feePaidComment, feeReleasedComment, feeWays, unitsText } from "./comments.ts";

const usdc: FeeOptionTerms = { network: "base-mainnet", chainId: 8453, contract: `0x${"de".repeat(20)}`, token: `0x${"83".repeat(20)}`, symbol: "USDC", decimals: 6, amount: "2000000", keptTo: `0x${"aa".repeat(20)}` };
const slop: FeeOptionTerms = { ...usdc, token: `0x${"51".repeat(20)}`, symbol: "SLOP", decimals: 18, amount: "75000000000000000000", keptTo: `0x${"00".repeat(19)}01` };

function facts(options: ReadonlyArray<FeeOptionTerms>, number: number) {
  return { owner: "ada", repo: "widgets", number, repositoryId: 8101, item: `0x${"ab".repeat(32)}`, stableMinor: "2000000", ways: feeWays(options) };
}

export const onlyAPublishedContractIsOffered = contract({
  input: Schema.Array(Schema.Boolean),
  run: (published) => feeWays(published.map((on) => ({ ...usdc, contract: on ? usdc.contract : "" }))).length,
  invariant: (published, offered) => offered === published.filter((on) => on).length,
});

export const baseUnitsReadBackExactly = contract({
  input: Schema.Tuple([Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000_000 })), Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 18 }))]),
  run: ([amount, decimals]) => unitsText(String(amount), decimals),
  invariant: ([amount, decimals], text) => {
    const [whole, fraction = ""] = text.split(".");
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0") === BigInt(amount) && !fraction.endsWith("0");
  },
});

export const everyFeeCommentCarriesTheMarker = contract({
  input: Schema.Tuple([Schema.Boolean, Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 }))]),
  run: ([withSlop, number]) => {
    const options = withSlop ? [usdc, slop] : [usdc];
    return [
      feeNeededComment(facts(options, number)),
      feePaidComment({ ...facts(options, number), paidNetwork: "base-mainnet", paidDepositId: 3, outcome: null }),
      feePaidComment({ ...facts(options, number), paidNetwork: null, paidDepositId: null, outcome: { kind: "kept_due", why: "closed" } }),
      feeReleasedComment(withSlop ? "setting-off" : "author-exempt"),
    ];
  },
  invariant: ([withSlop, number], bodies) =>
    bodies.every((body) => body.startsWith(`${feeMarker}\n`)) &&
    bodies[0].includes(`/fee/ada/widgets/${number}`) === true &&
    bodies[0].includes(`/api/v1/submission-fee/items/8101/${number}`) === withSlop,
});
