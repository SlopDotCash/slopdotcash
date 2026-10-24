import { buildCreateVaultCalldata } from "../../contracts/evm/adapter";
import { ESCROW_NETWORKS, type EscrowDeployment } from "./escrow-policy.mjs";
import type { ProjectDefinition } from "./projects.mjs";
import { sha256Hex } from "./sha256";

/** Stable across revisions; the same digest binds every chain and vault purpose. */
export const registryProjectDigest = (id: string) =>
  sha256Hex(`slop-project:${id}`);

export interface VaultSetupInput {
  network: EscrowDeployment["network"];
  claimId: string;
  automatic: boolean;
}
export interface VaultSetupReview {
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
  const asset =
    project.rewardAsset?.kind === "token"
      ? project.rewardAsset.address
      : network.asset;
  const same = (a: unknown, b: string | null) =>
    typeof a === "string" && a.toLowerCase() === b?.toLowerCase();
  if (
    !review ||
    review.network !== input.network ||
    review.chainId !== network.chainId ||
    !same(review.owner, owner) ||
    !same(review.asset, asset) ||
    review.cap !== project.reward.monthlyCapMinor ||
    review.capDisplay !== project.reward.monthlyCapDisplay ||
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
        monthlyCap: project.reward.monthlyCapMinor,
        automaticMonthly: input.automatic,
      })
  )
    throw new Error(
      "The vault request does not match the displayed project, wallet and monthly policy. Reload and review again.",
    );
  return review;
}
