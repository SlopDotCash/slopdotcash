import { formatBaseUnits } from "./base-units.mjs";
import type { ProjectDefinition } from "./projects.mjs";
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
  return `${amount} ${bounty.amount.asset.symbol}`;
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
              symbol: asset.symbol.replace(/^\$/u, ""),
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
