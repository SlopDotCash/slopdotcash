import { formatBaseUnits } from "./base-units.mjs";
import type { ProjectDefinition } from "./projects.mjs";
import { formatAssetSymbol } from "./reward-asset.mjs";
import { roundedUsdcCents } from "./verified-frontend";

/**
 * Parts per million as a percent, half up to two decimal places.
 * 10,000 ppm is 1%. 150 ppm is 0.015% and displays as 0.02%.
 * The ratio is exact in integers; binary `toFixed` rounds 0.015 down to 0.01.
 */
export function formatPercent(partsPerMillion: number): string {
  const negative = partsPerMillion < 0;
  const magnitude = Math.abs(partsPerMillion);
  const hundredths = Math.floor((magnitude + 50) / 100);
  const text = `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${text}%`;
}

export function formatMicroUsdc(value: string): string {
  const amount = BigInt(value);
  const fraction = amount % 1_000_000n;
  if (fraction === 0n) {
    return `$${new Intl.NumberFormat("en-US").format(amount / 1_000_000n)}`;
  }
  const roundedCents = roundedUsdcCents(amount);
  const whole = roundedCents / 100n;
  const cents = (roundedCents % 100n).toString().padStart(2, "0");
  return `$${new Intl.NumberFormat("en-US").format(whole)}.${cents}`;
}

/** The asset fields a page needs to name one reward amount. */
type RewardAmountAsset = {
  kind: "native" | "stablecoin" | "token";
  decimals: number;
  symbol: string;
};

/**
 * One reward amount in that project's asset. A stablecoin, and a legacy pool
 * with no stored asset, is USDC. A token or native coin uses its own base
 * units and symbol (PRD section 6: never present tokens as dollars).
 */
export function formatRewardMinor(
  minor: string,
  asset?: RewardAmountAsset,
): string {
  if (!asset || asset.kind === "stablecoin") return formatMicroUsdc(minor);
  return `${formatBaseUnits(minor, asset.decimals)} ${formatAssetSymbol(asset.symbol, asset.kind)}`;
}

/**
 * Commitment is a balance claim, never proof that signers can act. This
 * protocol has no authenticated accessibility evidence type yet.
 */
export function monthlyPoolUnfunded(
  reward: Pick<ProjectDefinition["reward"], "committedMinor" | "fundingState">,
): boolean {
  return (
    reward.fundingState !== "committed" || BigInt(reward.committedMinor) === 0n
  );
}

/** Formats the unit of a schema-validated cap without changing its amount. */
export function formatRewardCapDisplay(
  display: string,
  asset?: Pick<RewardAmountAsset, "kind" | "symbol">,
): string {
  return asset && asset.kind !== "stablecoin"
    ? display.replace(/\S+$/u, () =>
        formatAssetSymbol(asset.symbol, asset.kind),
      )
    : display;
}

export function monthlyPoolLabel(
  reward: Pick<
    ProjectDefinition["reward"],
    "committedMinor" | "fundingState" | "monthlyCapDisplay"
  >,
  asset?: RewardAmountAsset,
): string {
  const cap = formatRewardCapDisplay(reward.monthlyCapDisplay, asset);
  return monthlyPoolUnfunded(reward)
    ? `${cap} monthly · not funded`
    : `${formatRewardMinor(reward.committedMinor, asset)} funded · ${cap} monthly`;
}
