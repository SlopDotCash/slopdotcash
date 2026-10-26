import {
  type prepareSolanaCommitment,
  solanaCommitmentMessage,
} from "../../contracts/solana/commitment";
import { decodeBase58Bytes } from "./base58";
import { readBoundedJson } from "./browser-json";
import type { VaultConnection } from "./evm-vault-actions";
import type { OwnerCommitmentPlan } from "./owner-commitment-actions";
import { isAssetDecimals } from "./payments/contracts";
import { apiRequest } from "./project-api";
import { sendSolanaWalletTransaction } from "./solana-vault-actions";

export type SolanaCommitmentPlan = Awaited<
  ReturnType<typeof prepareSolanaCommitment>
>;
export function verifySolanaCommitmentPlan(
  plan: OwnerCommitmentPlan,
  transaction: SolanaCommitmentPlan,
  wallet: string,
) {
  const deployment = plan.deployment;
  if (!deployment.programId || !deployment.projectPda)
    throw new Error("The Solana vault configuration is incomplete.");
  if (
    !transaction ||
    transaction.wallet !== wallet ||
    wallet !== deployment.owner ||
    transaction.sourceDigest !== plan.award.sourceDigest ||
    transaction.githubUserId !== plan.award.githubUserId ||
    transaction.gross !== plan.award.gross ||
    transaction.fee !== plan.award.fee ||
    transaction.net !== plan.award.net ||
    !isAssetDecimals(transaction.decimals) ||
    typeof transaction.blockhash !== "string" ||
    decodeBase58Bytes(transaction.blockhash).length !== 32 ||
    !Number.isSafeInteger(transaction.lastValidBlockHeight) ||
    transaction.lastValidBlockHeight < 0 ||
    typeof transaction.transaction !== "string" ||
    typeof transaction.freeBalance !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/.test(transaction.freeBalance) ||
    typeof transaction.networkFeeLamports !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(transaction.networkFeeLamports)
  )
    throw new Error(
      "The prepared transaction differs from the reviewed award.",
    );
  const msg = solanaCommitmentMessage(
    {
      ...deployment,
      programId: deployment.programId,
      projectPda: deployment.projectPda,
      mint: deployment.asset,
    },
    transaction,
  );
  const wire = Uint8Array.from(atob(transaction.transaction), (c) =>
    c.charCodeAt(0),
  );
  if (
    wire.length !== 65 + msg.length ||
    wire[0] !== 1 ||
    wire.slice(1, 65).some((byte) => byte !== 0) ||
    msg.some((byte, index) => byte !== wire[index + 65])
  )
    throw new Error(
      "The prepared transaction differs from the reviewed award.",
    );
  return msg;
}
async function request(
  plan: OwnerCommitmentPlan,
  body: Record<string, unknown>,
) {
  const response = await apiRequest(
    `payments/projects/${encodeURIComponent(plan.projectId)}/monthly/${encodeURIComponent(plan.cycleId)}/solana-commitment`,
    {
      body: {
        network: plan.deployment.network,
        vault: plan.deployment.vault,
        ...body,
      },
      timeoutMs: 120_000,
    },
  );
  const value = (await readBoundedJson(
    response,
    65536,
    "Solana award commitment",
  )) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The commitment service returned an invalid response.");
  if (!response.ok)
    throw new Error(
      typeof value.message === "string"
        ? value.message
        : "The award could not be verified. Retry the review or transaction check.",
    );
  return value;
}
export async function reviewSolanaCommitment(
  plan: OwnerCommitmentPlan,
  wallet: VaultConnection,
) {
  if (!wallet.solanaSend)
    throw new Error("Choose a wallet with Solana transaction support.");
  const value = await request(plan, {
    step: "review",
    wallet: wallet.address,
    githubUserId: plan.award.githubUserId,
    manifestSha256: plan.manifestSha256,
    snapshotSha256: plan.snapshotSha256,
  });
  if (JSON.stringify(value.plan) !== JSON.stringify(plan))
    throw new Error("The prepared award changed. Reload its review.");
  const transaction = value.transaction as SolanaCommitmentPlan;
  verifySolanaCommitmentPlan(plan, transaction, wallet.address);
  return transaction;
}
export async function sendSolanaCommitment(
  plan: OwnerCommitmentPlan,
  wallet: VaultConnection,
  transaction: SolanaCommitmentPlan,
  beforeSend: () => void,
) {
  const msg = verifySolanaCommitmentPlan(plan, transaction, wallet.address);
  return sendSolanaWalletTransaction(
    plan.deployment,
    wallet,
    transaction.transaction,
    msg,
    beforeSend,
  );
}
export async function checkSolanaOwnerCommitment(
  plan: OwnerCommitmentPlan,
  wallet: VaultConnection,
  transaction: SolanaCommitmentPlan,
  transactionId: string,
) {
  verifySolanaCommitmentPlan(plan, transaction, wallet.address);
  const value = await request(plan, {
    step: "check",
    wallet: wallet.address,
    sourceDigest: transaction.sourceDigest,
    githubUserId: transaction.githubUserId,
    gross: transaction.gross,
    blockhash: transaction.blockhash,
    transactionId,
  });
  if (
    value.status !== "pending" &&
    value.status !== "failed" &&
    value.status !== "finalized"
  )
    throw new Error("The transaction status could not be verified.");
  return value.status;
}
