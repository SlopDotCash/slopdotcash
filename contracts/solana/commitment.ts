import {
  acceptsPayoutFee,
  ordinaryFee,
} from "../../src/lib/payments/contracts";
import {
  readVaultTotals,
  type SolanaEscrowConfig,
  solanaAwardId,
  solanaPaymentAdapter,
  solanaRpc,
  solanaVaultAddress,
  verifySolanaDeployment,
} from "./adapter";
import type { SolanaFundingDeployment } from "./funding";
import {
  bytes,
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
  SolanaWalletActionError,
} from "./wallet-transactions";

export interface SolanaCommitmentIntent {
  wallet: string;
  sourceDigest: string;
  githubUserId: string;
  gross: string;
}
function digest(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new SolanaWalletActionError("The award source digest is invalid.");
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}
function commitmentInstruction(
  config: SolanaFundingDeployment,
  intent: SolanaCommitmentIntent,
) {
  if (intent.wallet !== config.owner)
    throw new SolanaWalletActionError(
      "Connect the vault owner's wallet to authorize awards.",
    );
  if (solanaVaultAddress(config.programId, config.projectPda) !== config.vault)
    throw new SolanaWalletActionError(
      "The vault does not belong to this project.",
    );
  if (
    ![intent.githubUserId, intent.gross].every(
      (value) =>
        /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= (1n << 64n) - 1n,
    )
  )
    throw new SolanaWalletActionError(
      "The award identity or amount is invalid.",
    );
  const source = digest(intent.sourceDigest);
  const award = digest(solanaAwardId(config.projectPda, intent.sourceDigest));
  return {
    program: config.programId,
    accounts: [
      { key: intent.wallet, write: true },
      { key: config.projectPda, write: true },
      { key: config.vault, write: false },
      {
        key: pda(config.programId, [
          encoder.encode("origin"),
          bytes(config.projectPda),
          source,
        ]),
        write: true,
      },
      {
        key: pda(config.programId, [
          encoder.encode("award"),
          bytes(config.projectPda),
          award,
        ]),
        write: true,
      },
      { key: SYSTEM, write: false },
    ],
    data: instructionData(
      "commit",
      award,
      source,
      le(BigInt(intent.githubUserId)),
      le(BigInt(intent.gross)),
    ),
  };
}
export function solanaCommitmentMessage(
  config: SolanaFundingDeployment,
  intent: SolanaCommitmentIntent & { blockhash: string },
) {
  return message(intent.wallet, intent.blockhash, [
    commitmentInstruction(config, intent),
  ]);
}
export async function prepareSolanaCommitment(
  config: SolanaEscrowConfig,
  intent: SolanaCommitmentIntent,
) {
  const instruction = commitmentInstruction(config, intent);
  await verifySolanaDeployment(config);
  const totals = await readVaultTotals(config);
  if (totals.asset !== config.mint)
    throw new SolanaWalletActionError("The vault asset changed.");
  const existing = (await solanaRpc(config, "getAccountInfo", [
    instruction.accounts[3].key,
    { commitment: "finalized", encoding: "base64" },
  ])) as { value?: unknown };
  if (!existing || !Object.hasOwn(existing, "value"))
    throw new SolanaWalletActionError(
      "The existing award state could not be verified.",
    );
  if (existing.value !== null)
    throw new SolanaWalletActionError(
      "This award is already committed. Check its existing transaction.",
    );
  if (
    totals.freeBalance === null ||
    BigInt(totals.freeBalance) < BigInt(intent.gross)
  )
    throw new SolanaWalletActionError(
      "The vault has insufficient free funds for this award.",
    );
  const transaction = await prepareSolanaWalletTransaction(
    config,
    intent.wallet,
    [instruction],
  );
  const gross = BigInt(intent.gross),
    fee = ordinaryFee(gross);
  return {
    ...intent,
    ...transaction,
    fee: fee.toString(),
    net: (gross - fee).toString(),
    decimals: totals.decimals,
    freeBalance: totals.freeBalance,
  };
}
export async function checkSolanaCommitment(
  config: SolanaEscrowConfig,
  intent: SolanaCommitmentIntent & { blockhash: string },
  transactionId: string,
) {
  const checked = await checkSolanaWalletTransaction(
    config,
    intent.wallet,
    solanaCommitmentMessage(config, intent),
    transactionId,
  );
  if (checked.status !== "finalized") return checked.status;
  const event = await solanaPaymentAdapter(config).verifyFinalized({
    kind: "reserved",
    transactionId,
    eventIndex: 0,
    obligationId: solanaAwardId(config.projectPda, intent.sourceDigest),
  });
  const gross = BigInt(intent.gross),
    fee = BigInt(event.feeMicro);
  if (
    event.githubUserId !== intent.githubUserId ||
    event.sourceDigest !== intent.sourceDigest ||
    event.grossMicro !== intent.gross ||
    !acceptsPayoutFee(gross, fee) ||
    event.netMicro !== (gross - fee).toString()
  )
    throw new SolanaWalletActionError(
      "The finalized commitment differs from the approved award.",
    );
  return "finalized" as const;
}
