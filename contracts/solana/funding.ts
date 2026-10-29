import {
  acceptsPayoutFee,
  ordinaryFee,
} from "../../src/lib/payments/contracts";
import {
  readVaultTotals,
  type SolanaEscrowConfig,
  solanaMintDetails,
  solanaPubkey,
  solanaRpc,
  solanaUint,
  solanaVaultAddress,
  verifySolanaDeployment,
} from "./adapter";
import { inspectTokenAccount } from "./token";
import {
  ata,
  bytes,
  createAta,
  type Instruction,
  instructionData,
  le,
  message,
  TOKEN,
} from "./transactions";

import {
  checkSolanaWalletTransaction,
  prepareSolanaWalletTransaction,
  SolanaWalletActionError as SolanaFundingError,
} from "./wallet-transactions";

export { SolanaFundingError };

export type SolanaFundingDeployment = Pick<
  SolanaEscrowConfig,
  "programId" | "projectPda" | "vault" | "mint" | "owner" | "feeRecipient"
> & { tokenProgram?: string };

export interface SolanaFundingIntent {
  operation: "deposit" | "withdraw";
  wallet: string;
  gross: string;
  blockhash: string;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SolanaFundingError("Invalid chain response");
  return value as Record<string, unknown>;
}
function baseAmount(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > (1n << 64n) - 1n)
    throw new SolanaFundingError(
      "The amount is outside the Solana vault's supported range.",
    );
  return BigInt(value);
}
/** Same accounts and instruction order as the reviewed owner planner. */
function fundingInstructions(
  config: SolanaFundingDeployment,
  intent: Omit<SolanaFundingIntent, "blockhash">,
): Instruction[] {
  bytes(intent.wallet);
  const gross = baseAmount(intent.gross);
  const tokenProgram = config.tokenProgram ?? TOKEN;
  if (solanaVaultAddress(config.programId, config.projectPda) !== config.vault)
    throw new SolanaFundingError("The vault does not belong to this project.");
  if (intent.operation !== "deposit" && intent.operation !== "withdraw")
    throw new SolanaFundingError("Unknown vault action.");
  if (intent.operation === "withdraw" && intent.wallet !== config.owner)
    throw new SolanaFundingError(
      "Only the vault owner's wallet can withdraw free funds.",
    );
  const accounts = [
    { key: intent.wallet, write: true },
    { key: config.projectPda, write: true },
    { key: config.mint, write: false },
    {
      key:
        intent.operation === "deposit"
          ? ata(config.mint, intent.wallet, tokenProgram)
          : config.vault,
      write: true,
    },
    {
      key:
        intent.operation === "deposit"
          ? config.vault
          : ata(config.mint, intent.wallet, tokenProgram),
      write: true,
    },
  ];
  accounts.push({ key: tokenProgram, write: false });
  const action = {
    program: config.programId,
    accounts,
    data: instructionData(intent.operation, le(gross)),
  };
  return intent.operation === "deposit"
    ? [action]
    : [
        createAta(intent.wallet, config.mint, config.owner, tokenProgram),
        action,
      ];
}
export function solanaFundingMessage(
  config: SolanaFundingDeployment,
  intent: SolanaFundingIntent,
): Uint8Array {
  return message(
    intent.wallet,
    intent.blockhash,
    fundingInstructions(config, intent),
  );
}

/** Explicit review only. No key, signature or send RPC is available through this planner. */
export async function prepareSolanaFunding(
  config: SolanaEscrowConfig,
  intent: Omit<SolanaFundingIntent, "blockhash">,
) {
  await verifySolanaDeployment(config);
  const { tokenProgram } = await solanaMintDetails(config, config.mint);
  const instructions = fundingInstructions({ ...config, tokenProgram }, intent);
  const totals = await readVaultTotals(config);
  if (totals.asset !== config.mint)
    throw new SolanaFundingError("The vault asset changed.");
  const gross = baseAmount(intent.gross);
  if (intent.operation === "withdraw") {
    if (totals.freeBalance === null || gross > BigInt(totals.freeBalance))
      throw new SolanaFundingError(
        "The amount exceeds the vault's free balance. Reserved awards cannot be withdrawn.",
      );
  } else {
    const response = object(
      await solanaRpc(config, "getAccountInfo", [
        ata(config.mint, intent.wallet, tokenProgram),
        { commitment: "finalized", encoding: "base64" },
      ]),
    );
    if (!response.value)
      throw new SolanaFundingError(
        "Your wallet has no token account for this deposit.",
      );
    let data: Uint8Array;
    try {
      data = inspectTokenAccount(response.value, tokenProgram).bytes;
    } catch {
      throw new SolanaFundingError(
        "The deposit token account could not be verified.",
      );
    }
    if (
      solanaPubkey(data, 0) !== config.mint ||
      solanaPubkey(data, 32) !== intent.wallet ||
      data[108] !== 1
    )
      throw new SolanaFundingError(
        "The deposit token account is unavailable or frozen.",
      );
    if (solanaUint(data, 64) < gross)
      throw new SolanaFundingError(
        "Your token balance is too low for this deposit.",
      );
  }
  const prepared = await prepareSolanaWalletTransaction(
    config,
    intent.wallet,
    instructions,
  );
  const fee = intent.operation === "withdraw" ? ordinaryFee(gross) : 0n;
  return {
    ...intent,
    ...prepared,
    tokenProgram,
    gross: gross.toString(),
    fee: fee.toString(),
    net: (gross - fee).toString(),
    decimals: totals.decimals,
    freeBalance: totals.freeBalance,
  };
}

/** A pasted ID is accepted only for this exact wallet action, finalized with reconciled token deltas. */
export async function checkSolanaFunding(
  config: SolanaEscrowConfig,
  intent: SolanaFundingIntent,
  transactionId: string,
) {
  const { tokenProgram } = await solanaMintDetails(config, config.mint);
  const msg = solanaFundingMessage({ ...config, tokenProgram }, intent);
  const checked = await checkSolanaWalletTransaction(
    config,
    intent.wallet,
    msg,
    transactionId,
    intent.operation === "deposit",
  );
  if (checked.status !== "finalized") return checked.status;
  const meta = checked.meta;
  // Wallet guards can recompile the same action with different account indices.
  // Token-balance metadata indexes the verified finalized message.
  const keys = checked.accountKeys;
  function balances(value: unknown): Map<string, bigint> {
    if (!Array.isArray(value))
      throw new SolanaFundingError("Finalized token balances are missing.");
    const result = new Map<string, bigint>();
    for (const item of value) {
      const entry = object(item);
      if (entry.mint !== config.mint) continue;
      const index = Number(entry.accountIndex);
      const amount = object(entry.uiTokenAmount).amount;
      if (
        !Number.isSafeInteger(index) ||
        !keys[index] ||
        typeof amount !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(amount) ||
        result.has(keys[index])
      )
        throw new SolanaFundingError("Finalized token balances are invalid.");
      result.set(keys[index], BigInt(amount));
    }
    return result;
  }
  const before = balances(meta.preTokenBalances),
    after = balances(meta.postTokenBalances);
  const deltas = new Map<string, bigint>();
  const add = (key: string, value: bigint) =>
    deltas.set(key, (deltas.get(key) ?? 0n) + value);
  const gross = baseAmount(intent.gross);
  if (intent.operation === "deposit") {
    add(config.vault, gross);
    add(ata(config.mint, intent.wallet, tokenProgram), -gross);
  } else {
    // The withdrawal fee stays in the vault until claim_fees. A program not yet
    // upgraded to rounded-up fees still takes floor(gross / 50).
    const owner = ata(config.mint, config.owner, tokenProgram);
    const fee = gross - ((after.get(owner) ?? 0n) - (before.get(owner) ?? 0n));
    if (!acceptsPayoutFee(gross, fee))
      throw new SolanaFundingError(
        "The withdrawal fee is not 2% of the amount.",
      );
    add(config.vault, fee - gross);
    add(ata(config.mint, config.owner, tokenProgram), gross - fee);
  }
  for (const [key, delta] of deltas) {
    if (
      !after.has(key) ||
      (after.get(key) ?? 0n) - (before.get(key) ?? 0n) !== delta
    )
      throw new SolanaFundingError(
        "Finalized token movements do not match this action.",
      );
  }
  return "finalized";
}
