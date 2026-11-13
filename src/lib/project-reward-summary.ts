import { formatBaseUnits } from "./base-units.mjs";
import { evmExplorerOrigin } from "./payments/contracts";
import { monthlyAmountDisplay } from "./project-schema.mjs";
import type { ProjectDefinition } from "./projects.mjs";
import { formatAssetSymbol } from "./reward-asset.mjs";
import { resolveRewardCapMinor } from "./reward-cap.mjs";
import type {
  SecurityBountyTerms,
  SecurityProgramStatus,
} from "./security-bounty.mjs";

/** Display variants derive only from the registry's reward policy. */
type ProjectRewardSummary =
  | {
      kind: "monthly-pool";
      amount: string;
      token?: { symbol: string; url: string };
    }
  | {
      kind: "security-bounty";
      amount: string;
      status: SecurityProgramStatus;
      eligibility: SecurityBountyTerms["eligibility"];
    }
  | { kind: "external-prize"; amount: string | null }
  | { kind: "points-only" };

function compactWhole(value: string): string {
  if (!/^[\d,]+$/u.test(value)) return value;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  })
    .format(BigInt(value.replaceAll(",", "")))
    .toLowerCase();
}

export function securityBountyAmountLabel(
  bounty: Pick<SecurityBountyTerms, "amount">,
): string {
  const amount = compactWhole(
    formatBaseUnits(bounty.amount.grossMinor, bounty.amount.decimals),
  );
  if (!bounty.amount.asset) return `$${amount}`;
  return `${amount} ${formatAssetSymbol(bounty.amount.asset.symbol, bounty.amount.asset.kind)}`;
}

/** Card copy may name a separate paid offer without changing ordinary work. */
export function hasProjectCardBounty(project: {
  reward: Pick<ProjectDefinition["reward"], "kind" | "monthlyCapMinor">;
  securityBounty?: Pick<SecurityBountyTerms, "rewardMode" | "status">;
}): boolean {
  const bounty = project.securityBounty;
  return (
    bounty !== undefined &&
    (bounty.rewardMode === "bounty-only" ||
      (bounty.rewardMode === "separate" &&
        bounty.status === "open" &&
        project.reward.kind === "monthly-pool" &&
        BigInt(project.reward.monthlyCapMinor) === 0n))
  );
}

/** The cap for the current UTC month: a mid-month change applies from the next. */
export function currentMonthlyCapMinor(
  project: ProjectDefinition,
  now: Date = new Date(),
): string {
  return resolveRewardCapMinor(project, now.toISOString().slice(0, 7));
}

/** A $0 monthly pool pays no money; accepted work still earns points. */
export function monthlyPoolPointsOnly(
  project: ProjectDefinition,
  now: Date = new Date(),
): boolean {
  return (
    project.reward.kind === "monthly-pool" &&
    currentMonthlyCapMinor(project, now) === "0"
  );
}

/** The stored display stays valid only while the cap equals the default. */
export function monthlyCapDisplayFor(
  project: ProjectDefinition,
  minor: string,
): string {
  return minor === project.reward.monthlyCapMinor
    ? project.reward.monthlyCapDisplay
    : monthlyAmountDisplay(minor, project.rewardAsset);
}

export function currentMonthlyCapDisplay(
  project: ProjectDefinition,
  now: Date = new Date(),
): string {
  return monthlyCapDisplayFor(project, currentMonthlyCapMinor(project, now));
}

export function projectRewardSummaries(
  project: ProjectDefinition,
  now: Date = new Date(),
): ProjectRewardSummary[] {
  const summaries: ProjectRewardSummary[] = [];
  const { reward, rewardAsset: asset, securityBounty: bounty } = project;
  const capMinor = currentMonthlyCapMinor(project, now);
  if (reward.kind === "external-prize-share") {
    summaries.push({
      kind: "external-prize",
      amount: reward.externalOpportunity?.advertisedAmountDisplay ?? null,
    });
  } else if (BigInt(capMinor) > 0n && bounty?.rewardMode !== "bounty-only") {
    const amount = formatBaseUnits(capMinor, asset?.decimals ?? 6);
    summaries.push(
      asset && asset.kind !== "stablecoin"
        ? {
            kind: "monthly-pool",
            amount: compactWhole(amount),
            token: {
              symbol: formatAssetSymbol(asset.symbol, asset.kind),
              url:
                asset.kind === "native"
                  ? asset.network === "solana"
                    ? "https://solscan.io/"
                    : `${evmExplorerOrigin(asset.network)}/`
                  : asset.network === "solana"
                    ? asset.address.endsWith("pump")
                      ? `https://pump.fun/coin/${asset.address}`
                      : `https://solscan.io/token/${asset.address}`
                    : `${evmExplorerOrigin(asset.network)}/token/${asset.address}`,
            },
          }
        : { kind: "monthly-pool", amount: `$${amount}` },
    );
  }
  if (bounty) {
    summaries.push({
      kind: "security-bounty",
      amount: securityBountyAmountLabel(bounty),
      status: bounty.status,
      eligibility: bounty.eligibility,
    });
  }
  if (summaries.length === 0) summaries.push({ kind: "points-only" });
  return summaries;
}
