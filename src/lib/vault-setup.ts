import { buildCreateVaultCalldata } from "../../contracts/evm/adapter";
import {
  buildInitializeVaultInstructions,
  type SolanaVaultCreation,
} from "../../contracts/solana/owner-instructions";
import { message } from "../../contracts/solana/transactions";
import type { prepareSolanaWalletTransaction } from "../../contracts/solana/wallet-transactions";
import { decodeBase58Bytes } from "./base58";
import { ESCROW_NETWORKS, type EscrowDeployment } from "./escrow-policy.mjs";
import { isAssetDecimals, type PayoutPolicy } from "./payments/contracts";
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
interface VaultSetupReviewBase {
  payoutPolicy?: PayoutPolicy;
  network: EscrowDeployment["network"];
  owner: string;
  asset: string;
  cap: string;
  capDisplay: string;
  automatic: boolean;
  existingVault: string | null;
}
export type VaultSetupReview = VaultSetupReviewBase &
  (
    | {
        family: "evm";
        chainId: string;
        transaction: { from: string; to: string; data: string; value: string };
      }
    | {
        family: "solana";
        creation: SolanaVaultCreation;
        projectPda: string;
        vault: string;
        decimals: number;
        transaction: Awaited<
          ReturnType<typeof prepareSolanaWalletTransaction>
        > | null;
      }
  );

export function isVaultCreationId(network: string, value: string) {
  if (!Object.hasOwn(ESCROW_NETWORKS, network)) return false;
  if (ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS].family === "evm")
    return /^0x[0-9a-fA-F]{64}$/.test(value);
  try {
    return decodeBase58Bytes(value).length === 64;
  } catch {
    return false;
  }
}
export function solanaVaultCreationMessage(
  review: Extract<VaultSetupReview, { family: "solana" }>,
) {
  if (!review.transaction)
    throw new Error("Recover the existing vault transaction.");
  const plan = buildInitializeVaultInstructions(review.creation);
  const msg = message(
    review.owner,
    review.transaction.blockhash,
    plan.instructions,
  );
  const wire = Uint8Array.from(atob(review.transaction.transaction), (c) =>
    c.charCodeAt(0),
  );
  if (
    plan.projectPda !== review.projectPda ||
    plan.vault !== review.vault ||
    wire.length !== msg.length + 65 ||
    wire[0] !== 1 ||
    wire.slice(1, 65).some((byte) => byte !== 0) ||
    msg.some((byte, index) => wire[index + 65] !== byte)
  )
    throw new Error(
      "The transaction differs from the reviewed vault creation.",
    );
  return msg;
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
    : (project.rewardAsset?.address ?? network.asset);
  const cap = bounty ? "0" : project.reward.monthlyCapMinor;
  const capDisplay = bounty ? "" : project.reward.monthlyCapDisplay;
  const same = (a: unknown, b: string | null) =>
    typeof a === "string" &&
    (network.family === "solana"
      ? a === b
      : a.toLowerCase() === b?.toLowerCase());
  const invalid = () =>
    new Error(
      "The vault request does not match the displayed project, wallet and payment policy. Reload and review again.",
    );
  if (review?.family === "solana") {
    const creation = review.creation;
    if (
      (review.payoutPolicy ?? "ordinary") !==
        (input.payoutPolicy ?? "ordinary") ||
      (bounty &&
        (input.automatic ||
          project.securityBounty?.amount.currency !== "USDC" ||
          project.securityBounty.amount.network !== network.chain)) ||
      network.family !== "solana" ||
      review.network !== input.network ||
      !same(review.owner, owner) ||
      !same(review.asset, asset) ||
      review.cap !== cap ||
      review.capDisplay !== capDisplay ||
      review.automatic !== input.automatic ||
      !creation ||
      creation.owner !== owner ||
      creation.mint !== asset ||
      creation.projectDigest !== registryProjectDigest(project.id) ||
      (bounty
        ? creation.monthlyCap !== undefined ||
          creation.automaticMonthly !== undefined
        : creation.monthlyCap !== review.cap ||
          creation.automaticMonthly !== input.automatic) ||
      creation.payoutPolicy !== (input.payoutPolicy ?? "ordinary") ||
      !isAssetDecimals(review.decimals) ||
      review.decimals !==
        (bounty
          ? network.assetDecimals
          : (project.rewardAsset?.decimals ?? network.assetDecimals))
    )
      throw invalid();
    const plan = buildInitializeVaultInstructions(creation);
    if (
      plan.projectPda !== review.projectPda ||
      plan.vault !== review.vault ||
      (review.existingVault !== null && review.existingVault !== plan.vault)
    )
      throw invalid();
    if (review.transaction) solanaVaultCreationMessage(review);
    else if (!review.existingVault) throw invalid();
    return review;
  }
  if (
    review?.family !== "evm" ||
    network.family !== "evm" ||
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
    throw invalid();
  return review;
}
