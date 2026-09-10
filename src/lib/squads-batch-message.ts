/** Deterministic unsigned Squads Batch messages. No RPC, keys or dependencies.
 * Official Squads v4 af94153ff77a28b6effe46b9c94baaa93742b48c:
 * state/vault_transaction.rs and SDK types.ts (compact input vs stored Borsh).
 */
import type { SettlementExecutionPlan } from "./settlement-plan";
import { SOLANA_MAINNET_USDC_MINT } from "./settlement-plan";
import {
  deriveVaultUsdcTokenAccount,
  SPL_TOKEN_PROGRAM_ID,
} from "./squads-funding";

export const MAX_SQUADS_CHILD_TRANSFERS = 5;
export const SQUADS_ATA_PROGRAM =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SQUADS_SYSTEM_PROGRAM = "11111111111111111111111111111111";
export function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}
export function littleEndian(value: bigint | number, size: number): Uint8Array {
  let n = BigInt(value);
  if (n < 0n || n >= 1n << BigInt(size * 8))
    throw new TypeError("Integer exceeds binary field");
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = Number(n & 255n);
    n >>= 8n;
  }
  return bytes;
}
export function solanaKeyBytes(value: string): Uint8Array {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const char of value) {
    const i = alphabet.indexOf(char);
    if (i < 0) throw new TypeError("Invalid public key");
    n = n * 58n + BigInt(i);
  }
  if (n >= 1n << 256n) throw new TypeError("Public key overflow");
  return littleEndian(n, 32).reverse();
}
export const bytesBase64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
export interface BatchMessageInstruction {
  programId: string;
  accounts: string[];
  data: Uint8Array;
}
export interface SquadsCompiledChild {
  keys: string[];
  writableCount: number;
  instructions: BatchMessageInstruction[];
  storedBytes: Uint8Array;
  /** Compact Squads TransactionMessage bytes, NOT a Solana wire transaction. */
  inputBytes: Uint8Array;
}

/** Always creates canonical recipient ATAs idempotently, then TransferChecked.
 * Child subsets never change amounts, recipient owners, intent sets or fee.
 */
export async function compileSquadsBatchChild(
  plan: SettlementExecutionPlan,
  transferIndexes: number[],
): Promise<SquadsCompiledChild> {
  if (
    !transferIndexes.length ||
    transferIndexes.length > MAX_SQUADS_CHILD_TRANSFERS ||
    new Set(transferIndexes).size !== transferIndexes.length ||
    transferIndexes.some(
      (i) => !Number.isInteger(i) || i < 0 || i >= plan.transfers.length,
    )
  )
    throw new TypeError("Invalid bounded child subset");
  const source = await deriveVaultUsdcTokenAccount(plan.sourceOwner);
  const rows = await Promise.all(
    transferIndexes.map(async (i) => ({
      transfer: plan.transfers[i],
      ata: await deriveVaultUsdcTokenAccount(plan.transfers[i].recipientOwner),
    })),
  );
  const writable = [
    ...new Set([plan.sourceOwner, source, ...rows.map((r) => r.ata)]),
  ];
  const readonly = [
    ...new Set([
      SOLANA_MAINNET_USDC_MINT,
      SPL_TOKEN_PROGRAM_ID,
      SQUADS_ATA_PROGRAM,
      SQUADS_SYSTEM_PROGRAM,
      ...rows.map((r) => r.transfer.recipientOwner),
    ]),
  ].filter((k) => !writable.includes(k));
  // Funding authority and recipient owner must not alias writable token accounts.
  if (rows.some((r) => writable.includes(r.transfer.recipientOwner)))
    throw new TypeError("Unexpected recipient owner privilege alias");
  const keys = [...writable, ...readonly];
  const instructions: BatchMessageInstruction[] = [];
  const created = new Set<string>();
  for (const { transfer, ata } of rows) {
    if (!created.has(ata)) {
      instructions.push({
        programId: SQUADS_ATA_PROGRAM,
        accounts: [
          plan.sourceOwner,
          ata,
          transfer.recipientOwner,
          SOLANA_MAINNET_USDC_MINT,
          SQUADS_SYSTEM_PROGRAM,
          SPL_TOKEN_PROGRAM_ID,
        ],
        data: new Uint8Array([1]),
      });
      created.add(ata);
    }
    instructions.push({
      programId: SPL_TOKEN_PROGRAM_ID,
      accounts: [source, SOLANA_MAINNET_USDC_MINT, ata, plan.sourceOwner],
      data: joinBytes([
        new Uint8Array([12]),
        littleEndian(BigInt(transfer.amountMinor), 8),
        new Uint8Array([6]),
      ]),
    });
  }
  const serialize = (stored: boolean) => {
    const length = (n: number, small = 1) =>
      littleEndian(n, stored ? 4 : small);
    return joinBytes([
      new Uint8Array([1, 1, writable.length - 1]),
      length(keys.length),
      ...keys.map(solanaKeyBytes),
      length(instructions.length),
      ...instructions.map((ix) =>
        joinBytes([
          new Uint8Array([keys.indexOf(ix.programId)]),
          length(ix.accounts.length),
          new Uint8Array(ix.accounts.map((k) => keys.indexOf(k))),
          length(ix.data.length, 2),
          ix.data,
        ]),
      ),
      length(0), // No address lookup tables in this bounded format.
    ]);
  };
  return {
    keys,
    writableCount: writable.length,
    instructions,
    storedBytes: serialize(true),
    inputBytes: serialize(false),
  };
}

/** Integer-only human-readable USDC; never Number/parseFloat on money. */
export function exactUsdcDecimal(minor: string): string {
  if (!/^(0|[1-9][0-9]*)$/u.test(minor))
    throw new TypeError("Invalid USDC micro-units");
  const s = minor.padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
}
