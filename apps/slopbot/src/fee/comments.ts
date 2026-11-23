// spec/slopbot/submissionFeeGate.md, "One job asks under a lease, and a failed write hands the lease back"; spec/slopbot/submissionFeeGate.md, "A paid fee runs the held review, and Slopbot sets only a due outcome on a paid row"; spec/slopbot/submissionFeeGate.md, "An ask that stops applying is taken back and its unpaid item removed"
import { wantedLabelName } from "../../gen/backend__mergeActivity.ts";
import { keepFeeLabel, keptAfterClosedDays, refundUndecidedDays } from "../../gen/backend__submissionFeeTerms.ts";

export const feeMarker = "<!-- slopbot:fee -->";

export interface FeeOptionTerms {
  readonly network: string;
  readonly chainId: number | null;
  readonly contract: string;
  readonly token: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly amount: string;
  readonly keptTo: string;
}

export interface FeeWay {
  readonly network: string;
  readonly networkName: string;
  readonly symbol: string;
  readonly token: string;
  readonly contract: string;
  readonly keptTo: string;
  readonly amount: string;
  readonly decimals: number;
  readonly stable: boolean;
}

export type FeeOutcomeWhy = "merged" | "undecided" | "closed" | "wanted" | "marked";
export type FeeReleaseWhy = "setting-off" | "author-exempt";

export interface CommentFacts {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly repositoryId: number;
  readonly item: string;
  readonly stableMinor: string;
  readonly ways: ReadonlyArray<FeeWay>;
}

export interface FeeOutcomeNote {
  readonly kind: "refund_due" | "kept_due";
  readonly why: FeeOutcomeWhy;
}

export interface PaidFacts extends CommentFacts {
  readonly paidNetwork: string | null;
  readonly paidDepositId: number | null;
  readonly outcome: FeeOutcomeNote | null;
}

const address = /^0x[0-9a-fA-F]{40}$/u;
const networkNames: Readonly<Record<string, string>> = {
  "base-mainnet": "Base",
  "robinhood-mainnet": "Robinhood Chain",
};

export function feeWays(options: ReadonlyArray<FeeOptionTerms>): FeeWay[] {
  return options.flatMap((option) =>
    address.test(option.contract)
      ? [{
          network: option.network,
          networkName: `${networkNames[option.network] ?? option.network}${option.chainId === null ? "" : ` (chain ${option.chainId})`}`,
          symbol: option.symbol,
          token: option.token,
          contract: option.contract,
          keptTo: option.keptTo,
          amount: option.amount,
          decimals: option.decimals,
          stable: option.symbol !== "SLOP",
        }]
      : [],
  );
}

export function unitsText(amount: string, decimals: number): string {
  const value = BigInt(amount);
  const unit = 10n ** BigInt(decimals);
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/u, "");
  return fraction === "" ? `${value / unit}` : `${value / unit}.${fraction}`;
}

function stableNames(ways: ReadonlyArray<FeeWay>): string {
  return [...new Set(ways.filter((way) => way.stable).map((way) => way.symbol))].join(" or ");
}

function hasSlop(ways: ReadonlyArray<FeeWay>): boolean {
  return ways.some((way) => !way.stable);
}

function outcomeRules(ways: ReadonlyArray<FeeWay>): string[] {
  return [
    "- This pull request is merged: the deposit goes back to the wallet that paid it.",
    `- No maintainer merges or closes it within ${refundUndecidedDays} days of the deposit: the deposit goes back.`,
    `- It closes an issue labelled \`${wantedLabelName}\` (labelled before this pull request was opened) and is closed without a merge: the deposit goes back, unless a maintainer adds the label \`${keepFeeLabel}\` within ${keptAfterClosedDays} days of the close.`,
    `- Any other pull request closed without a merge and still closed ${keptAfterClosedDays} days later: a ${stableNames(ways)} deposit is kept by Slop${hasSlop(ways) ? ", and a SLOP deposit is burned" : ""}.`,
  ];
}

export function feeNeededComment(facts: CommentFacts): string {
  const amount = unitsText(facts.stableMinor, 6);
  const slop = hasSlop(facts.ways);
  return [
    feeMarker,
    "**Submission fee needed before Slopbot reviews this pull request**",
    `This project asks outside contributors for a refundable submission fee: **${amount} ${stableNames(facts.ways)}**${slop ? ", or SLOP at half that price" : ""}. Slopbot's review is free and starts once a deposit for this pull request is seen. Slopbot never closes a pull request for an unpaid fee, and a maintainer can review and merge this one without it.`,
    "**What happens to a deposit**",
    [...outcomeRules(facts.ways), "- A deposit that names another item, token or destination, or a lower amount than listed here, does not count and goes back."].join("\n"),
    "**How to pay**",
    `Pay page: https://slop.cash/fee/${facts.owner}/${facts.repo}/${facts.number}`,
    "Or use the deposit contract directly: approve the contract for the amount on the token, then call `deposit(item, token, amount, keptTo)` with one row of this table. Any wallet can pay, and a refund goes to the wallet that paid.",
    `\`item\`: \`${facts.item}\``,
    [
      "| Pay with | Network | Amount | Token | Deposit contract | `keptTo` |",
      "|---|---|---|---|---|---|",
      ...facts.ways.map((way) => `| ${way.symbol} | ${way.networkName} | ${unitsText(way.amount, way.decimals)} ${way.symbol} (\`${way.amount}\` base units) | \`${way.token}\` | \`${way.contract}\` | \`${way.keptTo}\` |`),
    ].join("\n"),
    ...(slop ? [`The SLOP amount is half the fee at Slop's published rate when this comment was written, and it changes when the rate does. Before paying in SLOP, read the amount due now at https://slop.cash/api/v1/submission-fee/items/${facts.repositoryId}/${facts.number}.`] : []),
    "The only valid addresses for this fee are the ones Slop publishes: in this comment from Slopbot and on slop.cash. Nobody from Slop or from this project sends a payment address in a message or in another comment.",
    "If you are an AI agent, do not move money. Hand this to the person you work for, who makes the payment.",
  ].join("\n\n");
}

function keptBecause(why: FeeOutcomeWhy): string {
  return why === "marked"
    ? `This pull request was closed without a merge and a maintainer added \`${keepFeeLabel}\``
    : `This pull request stayed closed without a merge for ${keptAfterClosedDays} days`;
}

function refundText(why: FeeOutcomeWhy): string {
  if (why === "wanted") return `**Refund due.** This pull request closed a \`${wantedLabelName}\` issue and was not merged, and no maintainer added \`${keepFeeLabel}\`, so the deposit is due back to the wallet that paid it.`;
  return why === "merged"
    ? "**Refund due.** This pull request was merged, so the deposit is due back to the wallet that paid it."
    : `**Refund due.** No maintainer merged or closed this pull request within ${refundUndecidedDays} days of the deposit, so it is due back to the wallet that paid it.`;
}

function outcomeText(outcome: FeeOutcomeNote, ways: ReadonlyArray<FeeWay>): string {
  if (outcome.kind === "kept_due") return `**Fee kept.** ${keptBecause(outcome.why)}, so the deposit is kept: a ${stableNames(ways)} deposit by Slop${hasSlop(ways) ? ", a SLOP deposit burned" : ""}.`;
  return refundText(outcome.why);
}

export function feePaidComment(facts: PaidFacts): string {
  const network = facts.ways.find((way) => way.network === facts.paidNetwork);
  const where = facts.paidDepositId !== null && network !== undefined ? `: deposit ${facts.paidDepositId} on ${network.networkName}` : "";
  return [
    feeMarker,
    "**Submission fee received**",
    `A deposit for this pull request was seen${where}. Slopbot reviews this pull request as usual.`,
    ...(facts.outcome === null ? [] : [outcomeText(facts.outcome, facts.ways)]),
    "**What happens to the deposit**",
    outcomeRules(facts.ways).join("\n"),
    "The only valid addresses for this fee are the ones Slop publishes. Nobody from Slop or from this project sends a payment address in a message or in another comment.",
  ].join("\n\n");
}

export function feeReleasedComment(why: FeeReleaseWhy): string {
  return [
    feeMarker,
    "**No submission fee is needed for this pull request**",
    `${why === "setting-off" ? "This project no longer asks a submission fee." : "Its author now has write access to the repository or is a member of its organisation."} Slopbot reviews this pull request as usual. Do not send a deposit for it: one sent now does not count and goes back.`,
  ].join("\n\n");
}
