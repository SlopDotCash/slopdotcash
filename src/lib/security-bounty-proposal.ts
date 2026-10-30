import type { GithubActor } from "./project-contracts";
import type { FundingChoice } from "./project-proposal";
import { parseAssetAmount } from "./project-schema.mjs";
import {
  REWARD_ASSET_NETWORKS,
  type RewardAssetChoice,
  rewardAssetChoice,
} from "./reward-asset.mjs";
import {
  formatSecurityAmount,
  isFullAwardSplit,
  SECURITY_SPLIT,
  type SecurityBountyAmount,
  type SecurityBountySplitPolicy,
  type SecurityBountyTerms,
  securityBountySplit,
} from "./security-bounty.mjs";

export const PRIVATE_BOUNTY_CRITERIA =
  "A reproducible security vulnerability within the project scope. The owner confirms impact and the first qualifying report.";
export const PRIVATE_BOUNTY_TESTING =
  "Use local tests with synthetic data and funds. Do not exploit live systems or access other users' data.";
export const PRIVATE_BOUNTY_DISCLOSURE =
  "Keep reports private until the owner approves disclosure.";
export type BountyAmountDraft = Omit<SecurityBountyAmount, "asset"> & {
  asset: RewardAssetChoice;
};

/** New asset choices stay unverified until the API reads their metadata. */
export function bountyAmountFields(choice: FundingChoice): BountyAmountDraft {
  const asset = rewardAssetChoice(
    choice.network,
    choice.assetKind,
    choice.tokenAddress,
    choice.tokenSymbol,
  );
  const network = REWARD_ASSET_NETWORKS[asset.network];
  const decimals = asset.kind === "token" ? 36 : network[asset.kind].decimals;
  return {
    asset,
    currency: asset.symbol,
    decimals,
    network: asset.network,
    grossMinor:
      asset.kind === "token"
        ? "0"
        : parseAssetAmount(choice.monthlyAmount, decimals),
  };
}

export function bountyAmountPreview(
  amount: SecurityBountyAmount | BountyAmountDraft,
  rawAmount: string,
  split: SecurityBountySplitPolicy = SECURITY_SPLIT,
): { gross: string; researcher: string; slop: string } {
  if (amount.grossMinor === "0")
    return {
      gross: `${rawAmount} ${amount.currency}`,
      researcher: isFullAwardSplit(split) ? "100%" : "75%",
      slop: isFullAwardSplit(split) ? "0%" : "25%",
    };
  const values = securityBountySplit(amount.grossMinor, split);
  return {
    gross: formatSecurityAmount(values.grossMinor, amount),
    researcher: formatSecurityAmount(values.researcherMinor, amount),
    slop: formatSecurityAmount(values.slopMinor, amount),
  };
}

/** A new bounty uses the same project, private intake and frozen award terms. */
export function privateBountyTerms(input: {
  name: string;
  repository: string;
  commit: string;
  scope: string;
  criteria: string;
  testing: string;
  funding: FundingChoice;
  actor: GithubActor;
}): Omit<SecurityBountyTerms, "amount"> & { amount: BountyAmountDraft } {
  const owner = {
    githubId: input.actor.githubId,
    githubLogin: input.actor.githubLogin,
  };
  return {
    version: "1",
    status: "open",
    rewardMode: "bounty-only",
    eligibility: "in-scope-security",
    fundingPolicy: "after-approval",
    amount: bountyAmountFields(input.funding),
    split: { ...SECURITY_SPLIT },
    sponsor: { name: input.name, githubId: owner.githubId },
    funding: { state: "pledged" },
    capacity: {
      awards: null,
      closesAt: null,
      exhaustionRule:
        "The owner decides each qualifying finding separately and funds an approved award before payment. No award or available funding is guaranteed.",
    },
    scope: {
      sourceRevisions: [{ repository: input.repository, commit: input.commit }],
      deployments: [],
      includedAssets: [input.repository],
      excludedDependencies: ["Third-party systems and dependencies"],
      testingPermission: input.testing.trim() || PRIVATE_BOUNTY_TESTING,
      severityRubric: input.criteria.trim(),
      lossDefinition: input.scope.trim(),
    },
    intake: {
      kind: "github-private-vulnerability-reporting",
      repository: input.repository,
    },
    responseTargets: {
      acknowledgeHours: 24,
      triageBusinessDays: 3,
      updateIntervalDays: 7,
    },
    approvers: { technical: [owner], financial: [owner], dispute: [owner] },
    dispute: {
      authority: "advisory",
      process:
        "Request a review through the private case appeal. Slopbot triages it and an authorized human decides escalated disputes.",
    },
    disclosure: PRIVATE_BOUNTY_DISCLOSURE,
    safeHarbor:
      "Follow the published testing rules and report in good faith. These terms grant no permission to access third-party systems or conduct harmful testing.",
  };
}
