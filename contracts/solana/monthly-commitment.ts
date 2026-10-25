/** The owner's monthly commitment setting (`set_monthly_commitment`). Plans and checks only. */
import {
  type SolanaEscrowConfig,
  solanaMintDecimals,
  solanaVaultAddress,
  verifySolanaDeployment,
} from "./adapter";
import type { SolanaFundingDeployment } from "./funding";
import { bytes, instructionData, le, message } from "./transactions";
import {
  checkSolanaWalletTransaction,
  prepareSolanaWalletTransaction,
  SolanaWalletActionError,
} from "./wallet-transactions";

export interface SolanaMonthlyCommitmentIntent {
  wallet: string;
  /** Token base units as decimal text; 0 only when turning the commitment off. */
  cap: string;
  enabled: boolean;
}
export interface SolanaMonthlyCommitmentState {
  cap: string;
  enabled: boolean;
}
const U64 = (1n << 64n) - 1n;
// Project account offsets: u8 purpose at 306, u64 monthly_cap at 307, bool monthly_enabled at 315.
const PURPOSE = 306;
const MONTHLY_CAP = 307;
const MONTHLY_ENABLED = 315;

function cap(intent: SolanaMonthlyCommitmentIntent) {
  if (
    typeof intent.cap !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/.test(intent.cap) ||
    BigInt(intent.cap) > U64
  )
    throw new SolanaWalletActionError(
      "The monthly cap is outside the Solana vault's supported range.",
    );
  if (typeof intent.enabled !== "boolean")
    throw new SolanaWalletActionError("Choose whether to turn it on or off.");
  if (intent.enabled && intent.cap === "0")
    throw new SolanaWalletActionError(
      "Turning on automatic monthly payment needs a positive monthly amount.",
    );
  return BigInt(intent.cap);
}
/** Accounts in the program's order: the owner signer, then the writable project. */
export function solanaMonthlyCommitmentInstruction(
  config: SolanaFundingDeployment,
  intent: SolanaMonthlyCommitmentIntent,
) {
  bytes(intent.wallet);
  const amount = cap(intent);
  if (intent.wallet !== config.owner)
    throw new SolanaWalletActionError(
      "Connect the vault owner's wallet to change automatic monthly payment.",
    );
  if (solanaVaultAddress(config.programId, config.projectPda) !== config.vault)
    throw new SolanaWalletActionError(
      "The vault does not belong to this project.",
    );
  return {
    program: config.programId,
    accounts: [
      { key: intent.wallet, write: false },
      { key: config.projectPda, write: true },
    ],
    data: instructionData(
      "set_monthly_commitment",
      le(amount),
      Uint8Array.of(intent.enabled ? 1 : 0),
    ),
  };
}
export function solanaMonthlyCommitmentMessage(
  config: SolanaFundingDeployment,
  intent: SolanaMonthlyCommitmentIntent & { blockhash: string },
) {
  return message(intent.wallet, intent.blockhash, [
    solanaMonthlyCommitmentInstruction(config, intent),
  ]);
}
/** Reads the setting from a verified Project account. */
export function solanaMonthlyCommitmentState(
  project: Uint8Array,
): SolanaMonthlyCommitmentState {
  const flag = project[MONTHLY_ENABLED];
  if (flag !== 0 && flag !== 1)
    throw new SolanaWalletActionError(
      "The monthly commitment state could not be read.",
    );
  return {
    cap: new DataView(project.buffer, project.byteOffset)
      .getBigUint64(MONTHLY_CAP, true)
      .toString(),
    enabled: flag === 1,
  };
}

/** The finalized setting and the mint decimals of a verified ordinary project. */
export async function readSolanaMonthlyCommitment(config: SolanaEscrowConfig) {
  const project = await verifySolanaDeployment(config);
  if (project[PURPOSE] !== 0)
    throw new SolanaWalletActionError(
      "Only an ordinary project vault takes automatic monthly payment.",
    );
  return {
    current: solanaMonthlyCommitmentState(project),
    decimals: await solanaMintDecimals(config, config.mint),
  };
}
/**
 * Reads the finalized setting and, when the requested one differs, plans and simulates the
 * owner's unsigned transaction. It never signs or broadcasts.
 */
export async function prepareSolanaMonthlyCommitment(
  config: SolanaEscrowConfig,
  intent: SolanaMonthlyCommitmentIntent,
) {
  const instruction = solanaMonthlyCommitmentInstruction(config, intent);
  const { current, decimals } = await readSolanaMonthlyCommitment(config);
  const unchanged =
    current.cap === intent.cap && current.enabled === intent.enabled;
  return {
    wallet: intent.wallet,
    cap: intent.cap,
    enabled: intent.enabled,
    decimals,
    current,
    transaction: unchanged
      ? null
      : await prepareSolanaWalletTransaction(config, intent.wallet, [
          instruction,
        ]),
  };
}

/** A pasted signature counts only for this exact setting, finalized without error. */
export async function checkSolanaMonthlyCommitment(
  config: SolanaEscrowConfig,
  intent: SolanaMonthlyCommitmentIntent & { blockhash: string },
  transactionId: string,
) {
  const checked = await checkSolanaWalletTransaction(
    config,
    intent.wallet,
    solanaMonthlyCommitmentMessage(config, intent),
    transactionId,
  );
  return checked.status;
}
