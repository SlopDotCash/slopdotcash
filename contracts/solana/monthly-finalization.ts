/** Owner-signed reservation of a complete monthly allocation; never a token transfer. */
import { hexToBytes } from "@noble/hashes/utils.js";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import { verifyMonthlyOwnerAuthorization } from "../monthly-authorization";
import {
  readVaultTotals,
  type SolanaEscrowConfig,
  verifySolanaDeployment,
} from "./adapter";
import {
  bytes,
  concat,
  encoder,
  instructionData,
  le,
  message,
  pda,
  SYSTEM,
} from "./transactions";
import {
  checkSolanaWalletTransaction,
  prepareSolanaWalletTransaction,
} from "./wallet-transactions";

export function solanaMonthlyOwnerInstructions(
  authorization: MonthlyAuthorization,
  wallet: string,
) {
  const { plan, signatureHex } = authorization;
  const deployment = plan.deployment;
  if (
    plan.family !== "solana" ||
    !deployment.programId ||
    !deployment.projectPda ||
    !plan.frozenAt ||
    wallet !== deployment.owner
  )
    throw new Error("Connect the vault owner's Solana wallet.");
  const signed = hexToBytes(plan.messageHex);
  const offsets = new Uint8Array(16);
  offsets[0] = 1;
  const view = new DataView(offsets.buffer);
  [48, 65535, 16, 65535, 112, signed.length, 65535].forEach((value, index) => {
    view.setUint16(2 + index * 2, value, true);
  });
  const period = new Uint8Array(4);
  new DataView(period.buffer).setUint32(
    0,
    Number(plan.request.period.replace("-", "")),
    true,
  );
  const month = pda(deployment.programId, [
    encoder.encode("month"),
    bytes(deployment.projectPda),
    period,
  ]);
  return [
    {
      program: "Ed25519SigVerify111111111111111111111111111",
      accounts: [],
      data: concat(
        offsets,
        bytes(deployment.identityAuthority),
        hexToBytes(signatureHex),
        signed,
      ),
    },
    {
      program: deployment.programId,
      accounts: [
        { key: wallet, write: true },
        { key: deployment.projectPda, write: true },
        { key: deployment.vault, write: false },
        { key: month, write: true },
        { key: "Sysvar1nstructions1111111111111111111111111", write: false },
        { key: SYSTEM, write: false },
      ],
      data: instructionData(
        "commit_monthly",
        period,
        hexToBytes(plan.allocationRoot),
        le(BigInt(plan.totalGrossBase)),
        le(BigInt(plan.frozenAt)),
      ),
    },
  ];
}

export function solanaMonthlyOwnerMessage(
  authorization: MonthlyAuthorization,
  wallet: string,
  blockhash: string,
) {
  return message(
    wallet,
    blockhash,
    solanaMonthlyOwnerInstructions(authorization, wallet),
  );
}

export async function prepareSolanaMonthlyFinalization(
  config: SolanaEscrowConfig,
  authorization: MonthlyAuthorization,
  wallet: string,
) {
  await verifyMonthlyOwnerAuthorization(authorization, {
    ...authorization.plan.request,
    deployment: authorization.plan.deployment,
  });
  if (
    config.owner !== wallet ||
    config.projectPda !== authorization.plan.deployment.projectPda ||
    config.vault !== authorization.plan.deployment.vault ||
    config.mint !== authorization.plan.deployment.asset
  )
    throw new Error("The reviewed Solana vault changed.");
  const instructions = solanaMonthlyOwnerInstructions(authorization, wallet);
  await verifySolanaDeployment(config);
  const totals = await readVaultTotals(config);
  if (
    totals.freeBalance === null ||
    BigInt(totals.freeBalance) < BigInt(authorization.plan.totalGrossBase)
  )
    throw new Error(
      "The whole monthly allocation needs enough free vault funds.",
    );
  const transaction = await prepareSolanaWalletTransaction(
    config,
    wallet,
    instructions,
  );
  return {
    ...transaction,
    wallet,
    decimals: totals.decimals,
    freeBalance: totals.freeBalance,
  };
}

export async function checkSolanaMonthlyFinalization(
  config: SolanaEscrowConfig,
  authorization: MonthlyAuthorization,
  wallet: string,
  blockhash: string,
  transactionId: string,
) {
  await verifyMonthlyOwnerAuthorization(authorization, {
    ...authorization.plan.request,
    deployment: authorization.plan.deployment,
  });
  if (
    config.projectPda !== authorization.plan.deployment.projectPda ||
    config.vault !== authorization.plan.deployment.vault ||
    config.mint !== authorization.plan.deployment.asset
  )
    throw new Error("The reviewed Solana vault changed.");
  const msg = solanaMonthlyOwnerMessage(authorization, wallet, blockhash);
  const status = await checkSolanaWalletTransaction(
    config,
    wallet,
    msg,
    transactionId,
  );
  // The exact owner-signed instruction and finalized successful transaction
  // establish the reservation. Reading a newer account is not required here.
  return status.status;
}

export type SolanaMonthlyOwnerPlan = Awaited<
  ReturnType<typeof prepareSolanaMonthlyFinalization>
>;
