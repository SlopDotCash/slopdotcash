// spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"; spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"
import { base58Decode, base64Decode, decodeTransaction, isSignature } from "@repo/platform/chain/solana";
import type { Attempt } from "../../../gen/frontend__walletAttempt.ts";
import { webStorage } from "../../platform/webStorage.ts";
import type { SlotStorage } from "../core/slots.ts";

export interface ListedStorage extends SlotStorage {
  readonly length: number;
  key(index: number): string | null;
}

export interface DirectTransaction {
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly data: string;
  readonly chainId: string;
  readonly nonce: string;
}

export interface JournalEntry {
  readonly transaction: DirectTransaction;
  readonly hash: string | null;
  readonly candidate?: string;
  readonly requestId?: string;
}

export type Journal = Readonly<Record<string, JournalEntry>>;

export type JournalRead = { readonly kind: "read"; readonly journal: Journal } | { readonly kind: "unreadable" };

export interface SolanaRecord {
  readonly attemptId?: string;
  readonly transaction: string;
  readonly signature: string | null;
  readonly candidate?: string;
}

export type SolanaRead = { readonly kind: "empty" } | { readonly kind: "read"; readonly record: SolanaRecord } | { readonly kind: "unreadable" };

export interface HistorySignature {
  readonly message: string;
  readonly signature: string;
}

export const preparedBytes = "prepared-transaction";

const evmHash = /^0x[a-f0-9]{64}$/iu;
const anyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const quantity = /^(0x[0-9a-f]+|0|[1-9][0-9]*)$/iu;
const legacyPrefix = "legacy-";
const empty: Attempt = { identity: "", bytesId: "", hash: "", candidate: "" };

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

/** @throws {never} */
export function isEvmHash(text: string): boolean {
  return evmHash.test(text);
}

/** @throws {never} */
export function isSolanaSignature(text: string): boolean {
  return text.length <= 88 && isSignature(text);
}

/** @throws {never} */
export function quantityOf(text: string): bigint | undefined {
  if (!quantity.test(text)) return undefined;
  try {
    return BigInt(text);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function nonceNumber(nonce: string): number | undefined {
  const value = quantityOf(nonce);
  return value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER) ? undefined : Number(value);
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}

/** @throws {never} */
export function transactionOf(value: unknown): DirectTransaction | undefined {
  const found = record(value);
  if (found === undefined) return undefined;
  const { from, to, value: amount, data, chainId, nonce } = found;
  if (typeof from !== "string" || typeof to !== "string" || typeof amount !== "string" || typeof data !== "string" || typeof chainId !== "string" || typeof nonce !== "string") return undefined;
  if (quantityOf(chainId) === undefined || nonceNumber(nonce) === undefined) return undefined;
  return { from, to, value: amount, data, chainId, nonce };
}

/** @throws {never} */
export function transactionBytes(transaction: DirectTransaction): string {
  const { from, to, value, data, chainId, nonce } = transaction;
  return JSON.stringify({ from, to, value, data, chainId, nonce });
}

function journalEntryOf(nonce: string, value: unknown, payer: string): JournalEntry | undefined {
  const found = record(value);
  if (found === undefined) return undefined;
  const transaction = transactionOf(found.transaction);
  const { hash, candidate, requestId } = found;
  if (transaction === undefined || transaction.nonce !== nonce || !sameAddress(transaction.from, payer)) return undefined;
  if (hash !== null && (typeof hash !== "string" || !evmHash.test(hash))) return undefined;
  if (candidate !== undefined && (typeof candidate !== "string" || !evmHash.test(candidate))) return undefined;
  if (requestId !== undefined && (typeof requestId !== "string" || !anyUuid.test(requestId))) return undefined;
  return { transaction, hash, ...(candidate === undefined ? {} : { candidate }), ...(requestId === undefined ? {} : { requestId }) };
}

/** @throws {never} */
export function readJournal(text: string | null, payer: string): JournalRead {
  if (text === null) return { kind: "read", journal: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable" };
  }
  const found = record(parsed);
  if (found === undefined) return { kind: "unreadable" };
  const journal: Record<string, JournalEntry> = {};
  for (const [nonce, value] of Object.entries(found)) {
    const entry = journalEntryOf(nonce, value, payer);
    if (entry === undefined) return { kind: "unreadable" };
    journal[nonce] = entry;
  }
  return { kind: "read", journal };
}

/** @throws {never} */
export function journalText(journal: Journal): string | null {
  return Object.keys(journal).length === 0 ? null : JSON.stringify(journal);
}

/** @throws {never} */
export function legacyIdentity(slot: string): string {
  return `${legacyPrefix}${slot}`;
}

/** @throws {never} */
export function storedIdentity(identity: string): string | undefined {
  return identity === "" || identity.startsWith(legacyPrefix) ? undefined : identity;
}

/** @throws {never} */
export function entryAttempt(entry: JournalEntry | undefined): Attempt {
  if (entry === undefined) return empty;
  const bytesId = transactionBytes(entry.transaction);
  if (entry.requestId !== undefined) return { identity: entry.requestId, bytesId, hash: entry.hash ?? "", candidate: entry.candidate ?? "" };
  const legacy = entry.candidate ?? entry.hash ?? "";
  if (legacy !== "") return { identity: "", bytesId, hash: "", candidate: legacy };
  return { identity: legacyIdentity(entry.transaction.nonce), bytesId, hash: "", candidate: "" };
}

/** @throws {never} */
export function attemptEntry(attempt: Attempt, transaction: DirectTransaction): JournalEntry {
  const requestId = storedIdentity(attempt.identity);
  return {
    transaction,
    hash: attempt.hash === "" ? null : attempt.hash,
    ...(attempt.candidate === "" ? {} : { candidate: attempt.candidate }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

/** @throws {never} */
export function readSolanaRecord(text: string | null, transaction: string): SolanaRead {
  if (text === null) return { kind: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable" };
  }
  const found = record(parsed);
  if (found === undefined) return { kind: "unreadable" };
  const { attemptId, transaction: saved, signature, candidate } = found;
  if (attemptId !== undefined && (typeof attemptId !== "string" || !uuidV4.test(attemptId))) return { kind: "unreadable" };
  if (saved !== transaction) return { kind: "unreadable" };
  if (signature !== null && (typeof signature !== "string" || !isSolanaSignature(signature))) return { kind: "unreadable" };
  if (candidate !== undefined && (typeof candidate !== "string" || !isSolanaSignature(candidate))) return { kind: "unreadable" };
  return { kind: "read", record: { ...(attemptId === undefined ? {} : { attemptId }), transaction, signature, ...(candidate === undefined ? {} : { candidate }) } };
}

/** @throws {never} */
export function solanaAttempt(found: SolanaRecord, messageId: string): Attempt {
  return { identity: found.attemptId ?? legacyIdentity(messageId), bytesId: preparedBytes, hash: found.signature ?? "", candidate: found.candidate ?? "" };
}

/** @throws {never} */
export function attemptSolanaRecord(attempt: Attempt, transaction: string): SolanaRecord {
  const attemptId = storedIdentity(attempt.identity);
  return {
    ...(attemptId === undefined ? {} : { attemptId }),
    transaction,
    signature: attempt.hash === "" ? null : attempt.hash,
    ...(attempt.candidate === "" ? {} : { candidate: attempt.candidate }),
  };
}

/** @throws {never} */
export function readHistory(text: string | null): Readonly<Record<string, HistorySignature>> {
  if (text === null) return {};
  try {
    const found = record(JSON.parse(text));
    if (found === undefined) return {};
    const kept: Record<string, HistorySignature> = {};
    for (const [messageId, value] of Object.entries(found)) {
      const entry = record(value);
      if (entry !== undefined && typeof entry.message === "string" && typeof entry.signature === "string") kept[messageId] = { message: entry.message, signature: entry.signature };
    }
    return kept;
  } catch {
    return {};
  }
}

/** @throws {never} */
export function signatureBytes(text: string): Uint8Array | undefined {
  if (!isSolanaSignature(text)) return undefined;
  return base58Decode(text);
}

/** @throws {never} */
export function transactionOfBytes(bytes: string): DirectTransaction | undefined {
  try {
    const parsed = transactionOf(JSON.parse(bytes));
    return parsed !== undefined && transactionBytes(parsed) === bytes ? parsed : undefined;
  } catch {
    return undefined;
  }
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
  if (text === null) return undefined;
  try {
    return record(JSON.parse(text));
  } catch {
    return undefined;
  }
}
