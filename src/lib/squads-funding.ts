/**
 * Read-only assertions for a Squads v4 vault commitment on Solana mainnet.
 * The vault is a third-party, non-upgradeable smart contract that Slop does
 * not control; these checks parse finalized RPC evidence and never read a
 * key, sign, broadcast, or claim custody.
 */

import { SOLANA_MAINNET_USDC_MINT, USDC_DECIMALS } from "./settlement-plan";
import { isSolanaAddress } from "./wallets";

/** Squads v4 program with a burned upgrade authority. */
export const SQUADS_V4_PROGRAM_ID =
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf" as const;
export const SPL_TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as const;
export const COMMITMENT_SQUADS_VERIFIER_VERSION =
  "commitment-squads-v1" as const;

export interface VerifiedSquadsVaultState {
  balanceMinor: string;
  slot: number;
  tokenAccount: string;
  vault: string;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function slot(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return Number(value);
}

/**
 * Validates one finalized `getAccountInfo` result for the vault's USDC token
 * account: the exact SPL token program, the canonical USDC mint, the declared
 * vault as owner, and a canonical integer raw balance.
 */
export function assertSquadsVaultUsdcState(
  resultValue: unknown,
  vault: string,
  tokenAccount: string,
): VerifiedSquadsVaultState {
  if (!isSolanaAddress(vault) || !isSolanaAddress(tokenAccount)) {
    throw new TypeError("vault or token account is not a Solana public key");
  }
  if (vault === tokenAccount) {
    throw new TypeError("vault and its token account must differ");
  }
  const result = record(resultValue, "Solana account response");
  const context = record(result.context, "Solana account response.context");
  const observedSlot = slot(context.slot, "Solana account response slot");
  if (result.value === null || result.value === undefined) {
    throw new TypeError(
      "vault USDC token account is absent at finalized commitment",
    );
  }
  const account = record(result.value, "Solana token account");
  if (account.owner !== SPL_TOKEN_PROGRAM_ID) {
    throw new TypeError(
      "vault token account is not owned by the SPL token program",
    );
  }
  const data = record(account.data, "Solana token account data");
  if (data.program !== "spl-token") {
    throw new TypeError("vault token account data is not parsed SPL token");
  }
  const parsed = record(data.parsed, "Solana token account parsed data");
  if (parsed.type !== "account") {
    throw new TypeError("vault token account is not a token account");
  }
  const info = record(parsed.info, "Solana token account info");
  if (info.mint !== SOLANA_MAINNET_USDC_MINT) {
    throw new TypeError("vault token account mint is not mainnet USDC");
  }
  if (info.owner !== vault) {
    throw new TypeError(
      "vault token account owner is not the declared vault address",
    );
  }
  const amount = record(info.tokenAmount, "Solana token account amount");
  if (
    amount.decimals !== USDC_DECIMALS ||
    typeof amount.amount !== "string" ||
    amount.amount.length > 40 ||
    !/^(?:0|[1-9]\d*)$/u.test(amount.amount)
  ) {
    throw new TypeError("vault token account balance is not canonical");
  }
  return {
    balanceMinor: amount.amount,
    slot: observedSlot,
    tokenAccount,
    vault,
  };
}
