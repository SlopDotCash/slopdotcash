// spec/settlement/vaultDeposits.md, "A record row is a positive amount of one finalized deposit event"; spec/settlement/vaultDeposits.md, "A run reads pages up to the finalized block and stores each page with its cursor"; spec/settlement/solanaVaultDeposits.md, "A run reads newest first below the interval it resumes and above the covered position"
import type { Address, Decoded, FetchedTransaction } from "@repo/platform/chain/solanaWire";
import type { Bytes32, EvmAddress } from "../chain/evm/abi.ts";
import { type EscrowLog, decodeEscrowLogs } from "../chain/evm/events.ts";
import { hex, readU64 } from "../chain/solana/bytes.ts";
import { anchorDiscriminator } from "../chain/solana/instructions.ts";
import { type ResolvedInstruction, resolveInstruction, resolvedKeys } from "../chain/solana/transactions.ts";

export interface EvmDeposit {
  readonly transaction: Bytes32;
  readonly index: number;
  readonly block: bigint;
  readonly blockHash: Bytes32;
  readonly depositor: string;
  readonly amount: bigint;
}

export interface SolanaDeposit {
  readonly index: number;
  readonly depositor: Address;
  readonly amount: bigint;
}

export type EvmDepositIssue = "Unexpected deposit event";

export type SolanaDepositIssue = "Unexpected deposit instruction" | "Unexpected deposit amount" | "Invalid transaction instructions";

export const DEPOSIT_TAGS: ReadonlyArray<string> = ["deposit", "deposit_native"].map((name) => hex(anchorDiscriminator(name)));

const DEPOSIT_DATA_BYTES = 16;

/** @throws {never} */
export function evmDeposits(vault: EvmAddress, logs: ReadonlyArray<EscrowLog>, range: { readonly from: bigint; readonly to: bigint }): Decoded<ReadonlyArray<EvmDeposit>, EvmDepositIssue> {
  const found: EvmDeposit[] = [];
  for (const decoded of decodeEscrowLogs(vault, logs)) {
    if (decoded.kind !== "event" || decoded.event.name !== "Deposited" || decoded.at.block < range.from || decoded.at.block > range.to)
      return { kind: "malformed", issue: "Unexpected deposit event" };
    found.push({
      transaction: decoded.at.transaction.toLowerCase() as Bytes32,
      index: decoded.at.index,
      block: decoded.at.block,
      blockHash: decoded.at.blockHash.toLowerCase() as Bytes32,
      depositor: decoded.event.depositor.toLowerCase(),
      amount: decoded.event.amount,
    });
  }
  return { kind: "decoded", value: found };
}

/** @throws {never} */
export function executionOrder(fetched: FetchedTransaction): ReadonlyArray<ResolvedInstruction> | undefined {
  const message = fetched.transaction.message;
  const keys = resolvedKeys(message, { writable: fetched.meta.loadedWritable, readonly: fetched.meta.loadedReadonly });
  const flat: ResolvedInstruction[] = [];
  for (const [top, compiled] of message.instructions.entries()) {
    const instruction = resolveInstruction(compiled, keys);
    if (instruction === undefined) return undefined;
    flat.push(instruction);
    for (const group of fetched.meta.innerInstructions.filter((inner) => inner.index === top)) {
      for (const child of group.instructions) {
        const resolved = resolveInstruction(child, keys);
        if (resolved === undefined) return undefined;
        flat.push(resolved);
      }
    }
  }
  return flat;
}

/** @throws {never} */
export function depositInstruction(instruction: ResolvedInstruction, program: Address, project: Address): Decoded<SolanaDeposit | undefined, SolanaDepositIssue> {
  if (instruction.program !== program || !DEPOSIT_TAGS.includes(hex(instruction.data.slice(0, 8)))) return { kind: "decoded", value: undefined };
  const [depositor, account] = instruction.accounts;
  if (instruction.data.length < DEPOSIT_DATA_BYTES || depositor === undefined || account === undefined) return { kind: "malformed", issue: "Unexpected deposit instruction" };
  if (account !== project) return { kind: "decoded", value: undefined };
  const amount = readU64(instruction.data, 8);
  if (amount <= 0n) return { kind: "malformed", issue: "Unexpected deposit amount" };
  return { kind: "decoded", value: { index: 0, depositor, amount } };
}

/** @throws {never} */
export function solanaDeposits(fetched: FetchedTransaction, program: Address, project: Address): Decoded<ReadonlyArray<SolanaDeposit>, SolanaDepositIssue> {
  const flat = executionOrder(fetched);
  if (flat === undefined) return { kind: "malformed", issue: "Invalid transaction instructions" };
  const found: SolanaDeposit[] = [];
  for (const [index, instruction] of flat.entries()) {
    const read = depositInstruction(instruction, program, project);
    if (read.kind === "malformed") return read;
    if (read.value !== undefined) found.push({ ...read.value, index });
  }
  return { kind: "decoded", value: found };
}
