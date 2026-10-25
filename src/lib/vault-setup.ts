import { buildCreateVaultCalldata } from "../../contracts/evm/adapter";
import { ESCROW_NETWORKS, type EscrowDeployment } from "./escrow-policy.mjs";
import type { PayoutPolicy } from "./payments/contracts";
import type { ProjectDefinition } from "./projects.mjs";
import { sha256Hex } from "./sha256";

/** Stable across revisions; the same digest binds every chain and vault purpose. */
export const registryProjectDigest = (id: string) =>
  sha256Hex(`slop-project:${id}`);

export interface VaultSetupInput {
  payoutPolicy?: PayoutPolicy;
  network: EscrowDeployment["network"];
  claimId: string;
  automatic: boolean;
}
export interface VaultSetupReview {
  payoutPolicy?: PayoutPolicy;
  network: EscrowDeployment["network"];
  owner: string;
  asset: string;
  cap: string;
  capDisplay: string;
  automatic: boolean;
  existingVault: string | null;
  chainId: string;
  transaction: { from: string; to: string; data: string; value: string };
}

/** Check the exact monetary request before asking the owner wallet to sign it. */
export function checkedVaultSetupReview(
  value: unknown,
  project: ProjectDefinition,
  input: VaultSetupInput,
  owner: string,
): VaultSetupReview {
  const review = value as VaultSetupReview | null;
  const network = ESCROW_NETWORKS[input.network];
  const bounty = input.payoutPolicy === "security-bounty";
  const asset = bounty
    ? network.asset
    : project.rewardAsset?.kind === "token"
      ? project.rewardAsset.address
      : network.asset;
  const cap = bounty ? "0" : project.reward.monthlyCapMinor;
  const capDisplay = bounty ? "" : project.reward.monthlyCapDisplay;
  const same = (a: unknown, b: string | null) =>
    typeof a === "string" && a.toLowerCase() === b?.toLowerCase();
  if (
    !review ||
    (review.payoutPolicy ?? "ordinary") !==
      (input.payoutPolicy ?? "ordinary") ||
    (bounty &&
      (input.automatic ||
        project.securityBounty?.amount.currency !== "USDC" ||
        project.securityBounty.amount.network !== network.chain)) ||
    review.network !== input.network ||
    review.chainId !== network.chainId ||
    !same(review.owner, owner) ||
    !same(review.asset, asset) ||
    review.cap !== cap ||
    review.capDisplay !== capDisplay ||
    review.automatic !== input.automatic ||
    !review.transaction ||
    !same(review.transaction.from, owner) ||
    !/^0x[0-9a-fA-F]{40}$/.test(review.transaction.to) ||
    review.transaction.value !== "0x0" ||
    (review.existingVault !== null &&
      !/^0x[0-9a-fA-F]{40}$/.test(review.existingVault)) ||
    review.transaction.data !==
      buildCreateVaultCalldata({
        projectId: `0x${registryProjectDigest(project.id)}`,
        asset: String(asset),
        ...(bounty
          ? { payoutPolicy: "security-bounty" as const }
          : { monthlyCap: cap, automaticMonthly: input.automatic }),
      })
  )
    throw new Error(
      "The vault request does not match the displayed project, wallet and payment policy. Reload and review again.",
    );
  return review;
}
