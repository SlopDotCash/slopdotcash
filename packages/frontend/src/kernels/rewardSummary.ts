// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/backend/listing.md, "Funding never decides placement and placement never establishes funding"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import type { Chain } from "@repo/settlement/kernels/networks";
import { type BountyMode, bountyOverview, type CardPolicy, type CardVariant, cardNamesBounty, cardVariants } from "../../gen/frontend__views.ts";
import { type AssetKind, assetSymbol } from "./assetText.ts";
import { assetUrl } from "./explorers.ts";

export type SecurityProgramStatus = "draft" | "pending-approval" | "open" | "paused" | "closed";

export type BountyEligibility = "critical-loss-of-funds" | "in-scope-security";

export type ListingTier = "featured" | "community";

export interface RewardAsset {
  readonly kind: AssetKind;
  readonly network: Chain;
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
}

export interface BountyAmount {
  readonly grossMinor: bigint;
  readonly decimals: number;
  readonly asset?: { readonly kind: AssetKind; readonly symbol: string };
}

export interface SecurityBounty {
  readonly rewardMode: "separate" | "bounty-only";
  readonly status: SecurityProgramStatus;
  readonly eligibility: BountyEligibility;
  readonly amount: BountyAmount;
}

export interface CardProject {
  readonly status: "active" | "paused";
  readonly listingTier: ListingTier | "retired";
  readonly reward: {
    readonly kind: "monthly-pool" | "external-prize-share";
    readonly monthlyCapMinor: bigint;
    readonly externalOpportunity?: { readonly advertisedAmountDisplay?: string };
  };
  readonly rewardAsset?: RewardAsset;
  readonly securityBounty?: SecurityBounty;
}

export type RewardSummary =
  | { readonly kind: "monthly-pool"; readonly amount: string; readonly token?: { readonly symbol: string; readonly url: string } }
  | { readonly kind: "security-bounty"; readonly amount: string; readonly status: SecurityProgramStatus; readonly eligibility: BountyEligibility }
  | { readonly kind: "external-prize"; readonly amount: string | null }
  | { readonly kind: "points-only" };

const bountyModes = { separate: "SeparateBounty", "bounty-only": "BountyOnly" } as const satisfies Record<SecurityBounty["rewardMode"], BountyMode>;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** @throws {never} */
function compactWhole(value: string): string {
  return /^[\d,]+$/u.test(value) ? compact.format(BigInt(value.replaceAll(",", ""))).toLowerCase() : value;
}

/** @throws {never} */
export function cardPolicy({ status, reward, securityBounty }: CardProject): CardPolicy {
  return {
    reward: reward.kind === "external-prize-share" ? "ExternalPrizeShare" : "MonthlyPoolReward",
    monthlyCapPositive: reward.monthlyCapMinor > 0n,
    bounty: securityBounty ? bountyModes[securityBounty.rewardMode] : "NoBounty",
    bountyOpen: securityBounty?.status === "open",
    active: status === "active",
  };
}

/** @throws {RangeError} */
export function securityBountyAmountLabel({ amount }: Pick<SecurityBounty, "amount">): string {
  const shown = compactWhole(formatBaseUnits({ value: amount.grossMinor, decimals: amount.decimals }));
  if (!amount.asset) return `$${shown}`;
  const ticker = assetSymbol(amount.asset);
  return ticker === undefined ? shown : `${shown} ${ticker}`;
}

/** @throws {RangeError} */
function monthlyPoolSummary(capMinor: bigint, asset: RewardAsset | undefined): RewardSummary {
  const amount = formatBaseUnits({ value: capMinor, decimals: asset?.decimals ?? 6 });
  if (!asset || asset.kind === "stablecoin") return { kind: "monthly-pool", amount: `$${amount}` };
  const symbol = assetSymbol(asset);
  return symbol === undefined
    ? { kind: "monthly-pool", amount: compactWhole(amount) }
    : { kind: "monthly-pool", amount: compactWhole(amount), token: { symbol, url: assetUrl(asset) } };
}

/** @throws {RangeError} */
function summariesOf(variant: CardVariant, { reward, rewardAsset, securityBounty }: CardProject): RewardSummary[] {
  switch (variant) {
    case "ExternalPrizeCard":
      return [{ kind: "external-prize", amount: reward.externalOpportunity?.advertisedAmountDisplay ?? null }];
    case "MonthlyPoolCard":
      return [monthlyPoolSummary(reward.monthlyCapMinor, rewardAsset)];
    case "SecurityBountyCard":
      return securityBounty
        ? [{ kind: "security-bounty", amount: securityBountyAmountLabel(securityBounty), status: securityBounty.status, eligibility: securityBounty.eligibility }]
        : [];
    case "PointsOnlyCard":
      return [{ kind: "points-only" }];
    default: {
      const _exhaustive: never = variant;
      return _exhaustive;
    }
  }
}

/** @throws {RangeError} */
export function projectRewardSummaries(project: CardProject): RewardSummary[] {
  return cardVariants(cardPolicy(project)).flatMap((variant) => summariesOf(variant, project));
}

/** @throws {never} */
export function hasProjectCardBounty(project: CardProject): boolean {
  return cardNamesBounty(cardPolicy(project));
}

/** @throws {never} */
export function hasBountyOverview(project: CardProject): boolean {
  return bountyOverview(cardPolicy(project));
}
