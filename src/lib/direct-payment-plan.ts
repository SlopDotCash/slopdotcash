/**
 * Programmatic pre-sign check for direct security-bounty payments.
 *
 * The payment components used to send whatever transaction the server plan
 * contained, checking only the payer, chain, nonce and gas estimate on EVM
 * and only decoding the transaction on Solana. The approved terms (the
 * transfers shown in "Transfers still due") were displayed for a human to
 * compare, but nothing in code compared them: a plan whose recipient,
 * amount or asset disagreed with the approved transfers would still be
 * signed, and the loss would already have happened by the time the backend
 * `verify-payment` step refused it.
 *
 * These pure checks run before any wallet prompt. They mirror exactly how
 * the server builds the plan (`backend/security/direct-evm.ts`
 * `evmDirectTransactions` and `backend/security/direct-solana.ts`
 * `instructions`):
 *
 * - EVM, native asset: `to` is the recipient, `value` is the amount,
 *   `data` is `0x`.
 * - EVM, ERC-20 asset: `to` is the asset, `value` is zero, `data` is the
 *   `transfer(recipient, amount)` call.
 * - Solana, native SOL: one System `transfer` instruction per transfer.
 * - Solana, SPL asset: one associated-token-account creation per recipient
 *   plus one `transferChecked` per transfer, from the payer's associated
 *   account to the recipient's.
 *
 * Anything else in the plan — an extra instruction, a different recipient
 * or amount, a different mint, a different fee payer — fails the check, so
 * the component refuses to sign instead of asking the wallet. This is a
 * client-side guard only: the backend still verifies finalized receipts.
 * PRD section 6: "Mark an obligation paid only after finalized evidence
 * reconciles its exact vault or direct-payment source, recipient,
 * principal, fee, and asset. Reject replay, wrong owner, wrong asset,
 * partial completion, failed transfers, duplicates, and overpayment."
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { solanaAssociatedTokenAddress } from "../../contracts/solana/adapter";
import {
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../../contracts/solana/token-extensions";
import { decodeBase58Bytes, encodeBase58Bytes } from "./base58";
import { decodeBase64 } from "./byte-encoding";
import { EVM_NATIVE_ASSET, SOLANA_NATIVE_ASSET } from "./escrow-policy.mjs";

export type ApprovedDirectTransfer = {
  recipient: string;
  amountBase: string;
};

export type ApprovedEvmTransaction = {
  to: string;
  value: string;
  data: string;
};

export type ApprovedSolanaPlan = {
  transaction: string;
  messageId: string;
};

export type ApprovedSolanaAsset = {
  address: string;
  decimals: number;
};

const sameAddress = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

function amountBase(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)$/u.test(value)) return null;
  return BigInt(value);
}

function hexAmount(value: string): bigint | null {
  if (!/^0x[0-9a-f]+$/iu.test(value)) return null;
  return BigInt(value);
}

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-f]{40}$/iu.test(value);
}

const TRANSFER_SELECTOR = "0xa9059cbb";

/** One EVM transaction against the one approved transfer it must perform. */
function matchesEvmTransfer(
  transaction: ApprovedEvmTransaction,
  transfer: ApprovedDirectTransfer,
  assetAddress: string,
): boolean {
  const amount = amountBase(transfer.amountBase);
  if (amount === null || amount <= 0n) return false;
  if (!isEvmAddress(transfer.recipient)) return false;
  if (!isEvmAddress(transaction.to)) return false;
  const value = hexAmount(transaction.value);
  if (value === null) return false;
  if (assetAddress.toLowerCase() === EVM_NATIVE_ASSET) {
    return (
      sameAddress(transaction.to, transfer.recipient) &&
      value === amount &&
      (transaction.data === "0x" || transaction.data === "")
    );
  }
  if (!isEvmAddress(assetAddress)) return false;
  if (!sameAddress(transaction.to, assetAddress) || value !== 0n) return false;
  const data = transaction.data.toLowerCase();
  if (!data.startsWith(TRANSFER_SELECTOR) || data.length !== 2 + 8 + 64 + 64)
    return false;
  const recipient = `0x${data.slice(10 + 24, 10 + 64)}`;
  const calldataAmount = BigInt(`0x${data.slice(10 + 64)}`);
  return (
    sameAddress(recipient, transfer.recipient) && calldataAmount === amount
  );
}

/**
 * Every transaction in the plan must perform exactly the approved transfer
 * at the same position. The server emits the plan in transfer order, so a
 * length or order difference is a mismatch, not a reordering.
 */
export function matchesApprovedEvmPlan(
  transactions: readonly ApprovedEvmTransaction[],
  transfers: readonly ApprovedDirectTransfer[],
  assetAddress: string,
): boolean {
  if (transactions.length === 0) return false;
  if (transactions.length !== transfers.length) return false;
  return transactions.every((transaction, index) =>
    matchesEvmTransfer(transaction, transfers[index], assetAddress),
  );
}

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

type ParsedInstruction = {
  program: string;
  accounts: string[];
  data: Uint8Array;
};

type ParsedMessage = {
  keys: string[];
  blockhash: string;
  instructions: ParsedInstruction[];
};

function readShortvec(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } | null {
  let value = 0;
  for (let shift = 0; ; shift += 7) {
    if (offset >= bytes.length || shift > 28) return null;
    const byte = bytes[offset++];
    value |= (byte & 127) << shift;
    if (!(byte & 128)) return { value, next: offset };
  }
}

function u64le(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(
    0,
    true,
  );
}

/**
 * The legacy message the server builds (`contracts/solana/transactions.ts`
 * `message`): one required signer, no versioned address tables. Any other
 * shape is not a plan this component understands.
 */
function parseLegacyMessage(bytes: Uint8Array): ParsedMessage | null {
  if (bytes.length < 3 + 32 || bytes[0] !== 1 || bytes[1] !== 0) return null;
  let offset = 3;
  const count = readShortvec(bytes, offset);
  if (count === null) return null;
  offset = count.next;
  if (count.value < 2 || count.value > 32) return null;
  if (offset + 32 * (count.value + 1) > bytes.length) return null;
  const keys = Array.from({ length: count.value }, (_, index) =>
    encodeBase58Bytes(
      bytes.slice(offset + index * 32, offset + (index + 1) * 32),
    ),
  );
  offset += count.value * 32;
  const blockhash = encodeBase58Bytes(bytes.slice(offset, offset + 32));
  offset += 32;
  const instructionCount = readShortvec(bytes, offset);
  if (instructionCount === null) return null;
  offset = instructionCount.next;
  const instructions: ParsedInstruction[] = [];
  for (let index = 0; index < instructionCount.value; index++) {
    if (offset >= bytes.length) return null;
    const programIndex = bytes[offset++];
    if (programIndex >= keys.length) return null;
    const accountCount = readShortvec(bytes, offset);
    if (accountCount === null) return null;
    offset = accountCount.next;
    if (offset + accountCount.value > bytes.length) return null;
    const accounts = Array.from(
      { length: accountCount.value },
      (_, account) => {
        const keyIndex = bytes[offset + account];
        if (keyIndex >= keys.length) return null;
        return keys[keyIndex];
      },
    );
    if (accounts.some((account) => account === null)) return null;
    offset += accountCount.value;
    const dataLength = readShortvec(bytes, offset);
    if (dataLength === null) return null;
    offset = dataLength.next;
    if (offset + dataLength.value > bytes.length) return null;
    const data = bytes.slice(offset, offset + dataLength.value);
    offset += dataLength.value;
    instructions.push({
      program: keys[programIndex],
      accounts: accounts as string[],
      data,
    });
  }
  if (offset !== bytes.length) return null;
  return { keys, blockhash, instructions };
}

function isSolanaAddress(value: string): boolean {
  try {
    return (
      value.length >= 32 &&
      value.length <= 44 &&
      decodeBase58Bytes(value).length === 32 &&
      encodeBase58Bytes(decodeBase58Bytes(value)) === value
    );
  } catch {
    return false;
  }
}

/**
 * The unsigned Solana transaction must be exactly the approved transfers:
 * the fee payer is the payer, every value-moving instruction matches one
 * approved transfer, associated-token-account creations cover only approved
 * recipients, and no other instruction is present. The message id binds the
 * exact message bytes the server issued.
 */
export function matchesApprovedSolanaPlan(
  plan: ApprovedSolanaPlan,
  transfers: readonly ApprovedDirectTransfer[],
  asset: ApprovedSolanaAsset,
  payer: string,
): boolean {
  try {
    if (transfers.length === 0) return false;
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0) return false;
    if (!isSolanaAddress(payer) || !isSolanaAddress(asset.address))
      return false;
    const expected = transfers.map((transfer) => {
      const amount = amountBase(transfer.amountBase);
      if (amount === null || amount <= 0n) return null;
      if (!isSolanaAddress(transfer.recipient)) return null;
      return { recipient: transfer.recipient, amount };
    });
    if (expected.some((transfer) => transfer === null)) return false;
    const remaining = [
      ...(expected as { recipient: string; amount: bigint }[]),
    ];
    const wire = decodeBase64(plan.transaction);
    if (wire.length < 66 || wire[0] !== 1) return false;
    if (wire.slice(1, 65).some((byte) => byte !== 0)) return false;
    const message = wire.slice(65);
    if (encodeBase58Bytes(sha256(message)) !== plan.messageId) return false;
    const parsed = parseLegacyMessage(message);
    if (parsed === null) return false;
    if (parsed.keys[0] !== payer) return false;
    const native = asset.address === SOLANA_NATIVE_ASSET;
    for (const instruction of parsed.instructions) {
      if (instruction.program === SYSTEM_PROGRAM) {
        if (!native) return false;
        if (
          instruction.accounts.length !== 2 ||
          instruction.accounts[0] !== payer ||
          instruction.data.length !== 12 ||
          instruction.data[0] !== 2 ||
          instruction.data[1] !== 0 ||
          instruction.data[2] !== 0 ||
          instruction.data[3] !== 0
        )
          return false;
        const amount = u64le(instruction.data, 4);
        const index = remaining.findIndex(
          (transfer) =>
            transfer.recipient === instruction.accounts[1] &&
            transfer.amount === amount,
        );
        if (index < 0) return false;
        remaining.splice(index, 1);
        continue;
      }
      if (
        instruction.program === TOKEN_PROGRAM ||
        instruction.program === TOKEN_2022_PROGRAM
      ) {
        if (native) return false;
        if (
          instruction.accounts.length !== 4 ||
          instruction.data.length !== 10 ||
          instruction.data[0] !== 12 ||
          instruction.data[9] !== asset.decimals ||
          instruction.accounts[1] !== asset.address ||
          instruction.accounts[3] !== payer
        )
          return false;
        const amount = u64le(instruction.data, 1);
        const source = solanaAssociatedTokenAddress(
          asset.address,
          payer,
          instruction.program,
        );
        if (instruction.accounts[0] !== source) return false;
        const index = remaining.findIndex((transfer) => {
          if (transfer.amount !== amount) return false;
          const destination = solanaAssociatedTokenAddress(
            asset.address,
            transfer.recipient,
            instruction.program,
          );
          return instruction.accounts[2] === destination;
        });
        if (index < 0) return false;
        remaining.splice(index, 1);
        continue;
      }
      if (instruction.program === ASSOCIATED_TOKEN_PROGRAM) {
        if (native) return false;
        if (
          instruction.accounts.length !== 6 ||
          instruction.data.length !== 1 ||
          instruction.data[0] !== 1 ||
          instruction.accounts[0] !== payer ||
          instruction.accounts[3] !== asset.address ||
          instruction.accounts[4] !== SYSTEM_PROGRAM ||
          (instruction.accounts[5] !== TOKEN_PROGRAM &&
            instruction.accounts[5] !== TOKEN_2022_PROGRAM)
        )
          return false;
        const owner = instruction.accounts[2];
        if (
          !expected.some((transfer) => transfer?.recipient === owner) ||
          instruction.accounts[1] !==
            solanaAssociatedTokenAddress(
              asset.address,
              owner,
              instruction.accounts[5],
            )
        )
          return false;
        continue;
      }
      return false;
    }
    return remaining.length === 0;
  } catch {
    return false;
  }
}
