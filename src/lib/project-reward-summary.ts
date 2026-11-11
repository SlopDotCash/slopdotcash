import { formatBaseUnits } from "./base-units.mjs";
import type { ProjectDefinition } from "./projects.mjs";
import { formatAssetSymbol } from "./reward-asset.mjs";
import type {
  SecurityBountyTerms,
  SecurityProgramStatus,
} from "./security-bounty.mjs";

/** Display variants derive only from the registry's reward policy. */
export type ProjectRewardSummary =
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

export function projectRewardSummaries(
  project: ProjectDefinition,
): ProjectRewardSummary[] {
  const summaries: ProjectRewardSummary[] = [];
  const { reward, rewardAsset: asset, securityBounty: bounty } = project;
  if (reward.kind === "external-prize-share") {
    summaries.push({
      kind: "external-prize",
      amount: reward.externalOpportunity?.advertisedAmountDisplay ?? null,
    });
  } else if (
    BigInt(reward.monthlyCapMinor) > 0n &&
    bounty?.rewardMode !== "bounty-only"
  ) {
    const amount = formatBaseUnits(
      reward.monthlyCapMinor,
      asset?.decimals ?? 6,
    );
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
                    : asset.network === "base"
                      ? "https://basescan.org/"
                      : asset.network === "robinhood"
                        ? "https://robinhoodchain.blockscout.com/"
                        : "https://etherscan.io/"
                  : asset.network === "solana"
                    ? asset.address.endsWith("pump")
                      ? `https://pump.fun/coin/${asset.address}`
                      : `https://solscan.io/token/${asset.address}`
                    : `https://${
                        asset.network === "base"
                          ? "basescan.org"
                          : asset.network === "robinhood"
                            ? "robinhoodchain.blockscout.com"
                            : "etherscan.io"
                      }/token/${asset.address}`,
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
