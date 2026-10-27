/** Owner-signed creation, checked against a current reviewed deployment. */
import {
  type SolanaProgramConfig,
  solanaMintDetails,
  solanaRpc,
  verifySolanaDeployment,
  verifySolanaProgram,
} from "./adapter";
import {
  buildInitializeVaultInstructions,
  type SolanaVaultCreation,
} from "./owner-instructions";
import { message } from "./transactions";
import {
  checkSolanaCreationTransaction,
  prepareSolanaWalletTransaction,
  SolanaWalletActionError,
} from "./wallet-transactions";

export class SolanaVaultCreationFailed extends SolanaWalletActionError {}

function candidate(template: SolanaProgramConfig, input: SolanaVaultCreation) {
  if (
    input.programId !== template.programId ||
    input.networkDomain !== template.networkDomain ||
    input.identityAuthority !== template.identityAuthority ||
    input.feeRecipient !== template.feeRecipient ||
    input.bindingDelaySeconds !== template.bindingDelaySeconds ||
    input.rotationDelaySeconds !== template.rotationDelaySeconds
  )
    throw new SolanaWalletActionError(
      "The creation policy differs from the reviewed program.",
    );
  const plan = buildInitializeVaultInstructions(input);
  return {
    plan,
    config: {
      ...template,
      payoutPolicy: input.payoutPolicy ?? "ordinary",
      projectId: input.projectDigest,
      projectPda: plan.projectPda,
      vault: plan.vault,
      owner: input.owner,
      mint: input.mint,
    },
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SolanaWalletActionError("Invalid creation chain response.");
  return value as Record<string, unknown>;
}

/** No signature or broadcast; the owner reviews fees and signs in their wallet. */
export async function prepareSolanaVaultCreation(
  template: SolanaProgramConfig,
  input: SolanaVaultCreation,
  registrationOnly = false,
) {
  await verifySolanaProgram(template);
  const mint = await solanaMintDetails(template, input.mint);
  const { plan, config } = candidate(template, {
    ...input,
    tokenProgram: mint.tokenProgram,
  });
  const decimals = mint.decimals;
  const existing = object(
    await solanaRpc(template, "getAccountInfo", [
      plan.projectPda,
      { commitment: "finalized", encoding: "base64" },
    ]),
  ).value;
  if (existing !== null) {
    try {
      await verifySolanaDeployment(config, input.projectDigest);
    } catch (error) {
      // The reviewed program and Config passed above; a failure now is the project account itself.
      if (
        error instanceof Error &&
        (error.message.startsWith("RPC") ||
          error.name === "TimeoutError" ||
          error.name === "AbortError" ||
          error instanceof TypeError)
      )
        throw error;
      throw new SolanaWalletActionError(
        "An account already exists at this project address and does not match this creation request.",
      );
    }
    return {
      projectPda: plan.projectPda,
      vault: plan.vault,
      decimals,
      existingVault: plan.vault,
      transaction: null,
    };
  }
  return {
    projectPda: plan.projectPda,
    vault: plan.vault,
    decimals,
    existingVault: null,
    transaction: registrationOnly
      ? null
      : await prepareSolanaWalletTransaction(
          template,
          input.owner,
          plan.instructions,
        ),
  };
}

/** Recover by signature alone; the finalized transaction supplies its blockhash. */
export async function verifySolanaVaultCreation(
  template: SolanaProgramConfig,
  input: SolanaVaultCreation,
  transactionId: string,
) {
  await verifySolanaProgram(template);
  const mint = await solanaMintDetails(template, input.mint);
  const { plan, config } = candidate(template, {
    ...input,
    tokenProgram: mint.tokenProgram,
  });
  const raw = await solanaRpc(template, "getTransaction", [
    transactionId,
    {
      encoding: "json",
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  if (raw === null) return null;
  const transaction = object(object(raw).transaction);
  const blockhash = object(transaction.message).recentBlockhash;
  if (typeof blockhash !== "string")
    throw new SolanaWalletActionError("The creation blockhash is unavailable.");
  const result = await checkSolanaCreationTransaction(
    template,
    input.owner,
    message(input.owner, blockhash, plan.instructions),
    transactionId,
  );
  if (result.status === "pending") return null;
  if (result.status === "failed")
    throw new SolanaVaultCreationFailed(
      "The exact vault creation transaction failed. Review a new request.",
    );
  // The exact finalized message above set the reviewed monthly policy atomically.
  // A later owner change to that setting does not block registration.
  await verifySolanaDeployment(config, input.projectDigest);
  return { projectPda: plan.projectPda, vault: plan.vault };
}
