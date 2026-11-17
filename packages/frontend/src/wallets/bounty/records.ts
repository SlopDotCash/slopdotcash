// spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"; spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"
import { base58Decode, base64Decode, decodeTransaction } from "@repo/platform/chain/solana";
import { Result, Schema } from "effect";
import type { Attempt } from "../../../gen/frontend__walletAttempt.ts";
import { webStorage } from "../../platform/webStorage.ts";
import type { SlotStorage } from "../core/slots.ts";
import { type Saved, directAttempt, savedOf, solanaAttempt as savedSolanaAttempt } from "./attempts.ts";
import { DirectTransaction, EvmHash, HistorySignature, Journal, type JournalEntry, Nonce, Quantity, SolanaRecord, SolanaSignature } from "./records.schema.ts";

export type { DirectTransaction, HistorySignature, Journal, JournalEntry, SolanaRecord } from "./records.schema.ts";

export interface ListedStorage extends SlotStorage {
  readonly length: number;
  key(index: number): string | null;
}

export type JournalRead = { readonly kind: "read"; readonly journal: Journal } | { readonly kind: "unreadable" };

export type SolanaRead = { readonly kind: "empty" } | { readonly kind: "read"; readonly record: SolanaRecord } | { readonly kind: "unreadable" };

export const preparedBytes = "prepared-transaction";

const legacyPrefix = "legacy-";
const empty: Attempt = { identity: "", bytesId: "", hash: "", candidate: "" };
const decodeDirect = Schema.decodeUnknownResult(DirectTransaction);
const decodeJournal = Schema.decodeUnknownResult(Journal);
const decodeSolanaRecord = Schema.decodeUnknownResult(SolanaRecord);
const decodeHistory = Schema.decodeUnknownResult(HistorySignature);
const isQuantity = Schema.is(Quantity);
const isNonce = Schema.is(Nonce);

/** @throws {never} */
export function bountyStorage(): ListedStorage | undefined {
  return webStorage("session");
}

/** @throws {never} */
export function keysWithPrefix(storage: ListedStorage | undefined, prefix: string): ReadonlyArray<string> {
  if (storage === undefined) return [];
  const found: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) found.push(key);
    }
  } catch {
    return [];
  }
  return found.sort();
}

/** @throws {never} */
export function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export const isEvmHash = Schema.is(EvmHash);

export const isSolanaSignature = Schema.is(SolanaSignature);

/** @throws {never} */
export function quantityOf(text: string): bigint | undefined {
  return isQuantity(text) ? BigInt(text) : undefined;
}

/** @throws {never} */
export function nonceNumber(nonce: string): number | undefined {
  return isNonce(nonce) ? Number(BigInt(nonce)) : undefined;
}

/** @throws {never} */
export function transactionOf(value: unknown): DirectTransaction | undefined {
  const decoded = decodeDirect(value);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

/** @throws {never} */
export function transactionBytes(transaction: DirectTransaction): string {
  const { from, to, value, data, chainId, nonce } = transaction;
  return JSON.stringify({ from, to, value, data, chainId, nonce });
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function payersJournal(journal: Journal, payer: string): boolean {
  return Object.entries(journal).every(([nonce, entry]) => entry.transaction.nonce === nonce && sameAddress(entry.transaction.from, payer));
}

/** @throws {never} */
export function readJournal(text: string | null, payer: string): JournalRead {
  if (text === null) return { kind: "read", journal: {} };
  const decoded = decodeJournal(parsed(text));
  return Result.isSuccess(decoded) && payersJournal(decoded.success, payer) ? { kind: "read", journal: decoded.success } : { kind: "unreadable" };
}

/** @throws {never} */
export function journalText(journal: Journal): string | null {
  return Object.keys(journal).length === 0 ? null : JSON.stringify(journal);
}

/** @throws {never} */
export function legacyIdentity(slot: string): string {
  return `${legacyPrefix}${slot}`;
}

function savedEntry(entry: JournalEntry): Saved {
  return { identity: entry.requestId ?? "", hash: entry.hash ?? "", candidate: entry.candidate ?? "" };
}

/** @throws {never} */
export function entryAttempt(entry: JournalEntry | undefined): Attempt {
  return entry === undefined ? empty : directAttempt(savedEntry(entry), transactionBytes(entry.transaction), legacyIdentity(entry.transaction.nonce));
}

/** @throws {never} */
export function attemptEntry(attempt: Attempt, transaction: DirectTransaction): JournalEntry {
  const saved = savedOf(attempt, legacyIdentity(transaction.nonce));
  return {
    transaction,
    hash: saved.hash === "" ? null : saved.hash,
    ...(saved.candidate === "" ? {} : { candidate: saved.candidate }),
    ...(saved.identity === "" ? {} : { requestId: saved.identity }),
  };
}

/** @throws {never} */
export function readSolanaRecord(text: string | null, transaction: string): SolanaRead {
  if (text === null) return { kind: "empty" };
  const decoded = decodeSolanaRecord(parsed(text));
  return Result.isSuccess(decoded) && decoded.success.transaction === transaction ? { kind: "read", record: decoded.success } : { kind: "unreadable" };
}

/** @throws {never} */
export function solanaAttempt(found: SolanaRecord, messageId: string): Attempt {
  return savedSolanaAttempt({ identity: found.attemptId ?? "", hash: found.signature ?? "", candidate: found.candidate ?? "" }, preparedBytes, legacyIdentity(messageId));
}

/** @throws {never} */
export function attemptSolanaRecord(attempt: Attempt, transaction: string, messageId: string): SolanaRecord {
  const saved = savedOf(attempt, legacyIdentity(messageId));
  return {
    ...(saved.identity === "" ? {} : { attemptId: saved.identity }),
    transaction,
    signature: saved.hash === "" ? null : saved.hash,
    ...(saved.candidate === "" ? {} : { candidate: saved.candidate }),
  };
}

/** @throws {never} */
export function readHistory(text: string | null): Readonly<Record<string, HistorySignature>> {
  const found = parsedRecord(text);
  if (found === undefined) return {};
  const kept: Record<string, HistorySignature> = {};
  for (const [messageId, value] of Object.entries(found)) {
    const entry = decodeHistory(value);
    if (Result.isSuccess(entry)) kept[messageId] = entry.success;
  }
  return kept;
}

/** @throws {never} */
export function signatureBytes(text: string): Uint8Array | undefined {
  if (!isSolanaSignature(text)) return undefined;
  return base58Decode(text);
}

/** @throws {never} */
export function transactionOfBytes(bytes: string): DirectTransaction | undefined {
  const found = transactionOf(parsed(bytes));
  return found !== undefined && transactionBytes(found) === bytes ? found : undefined;
}

/** @throws {never} */
export function sameAttempt(left: Attempt, right: Attempt): boolean {
  return left.identity === right.identity && left.bytesId === right.bytesId && left.hash === right.hash && left.candidate === right.candidate;
}

/** @throws {never} */
export function payerMessage(transaction: string, payer: string): { readonly wire: Uint8Array; readonly message: Uint8Array } | undefined {
  const wire = base64Decode(transaction);
  if (wire === undefined) return undefined;
  const decoded = decodeTransaction(wire);
  if (decoded.kind !== "decoded") return undefined;
  const { message, signatures, messageBytes } = decoded.value;
  const unsigned = signatures.length === 1 && signatures.every((signature) => signature.every((byte) => byte === 0));
  if (message.version !== "legacy" || message.header.requiredSignatures !== 1 || message.accountKeys[0] !== payer || !unsigned) return undefined;
  return { wire, message: messageBytes };
}

/** @throws {never} */
export function parsedRecord(text: string | null): Readonly<Record<string, unknown>> | undefined {
  const value = text === null ? undefined : parsed(text);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}
