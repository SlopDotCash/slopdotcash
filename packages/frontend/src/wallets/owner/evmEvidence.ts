// spec/settlement/ownerTransactions.md, "Only the exact finalized submitted transaction completes the request"; spec/frontend/batchedDeposit.md, "Included or missing-event evidence leaves verification pending"; spec/frontend/provisionalVault.md, "Included deposits are received pending finality only when there is an exact deposit event"
import { type EvmAddress, evmAddress } from "@repo/settlement/chain/evm/abi";
import { type EscrowEvent, type EscrowLog, decodeEscrowLogs } from "@repo/settlement/chain/evm/events";
import { type ReceiptStatus, batchRefused, batchStatus } from "./ownerDecisions.ts";
import type { EvmCallPlan } from "./ownerPlans.schema.ts";

export interface WalletReceipt {
  readonly status: string;
  readonly transactionHash: string;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly logs: ReadonlyArray<EscrowLog>;
}

export interface WalletTransaction {
  readonly from: string;
  readonly to: string | null;
  readonly input: string;
  readonly value: bigint;
}

export interface ExpectedCall {
  readonly from: string;
  readonly to: string;
  readonly input: string;
  readonly value: bigint;
}

export interface VaultEvent {
  readonly event: EscrowEvent;
  readonly logIndex: number;
}

export type BatchReport = { readonly kind: "pending" } | { readonly kind: "notSent" } | { readonly kind: "partial" } | { readonly kind: "unrecognized" } | { readonly kind: "landed"; readonly hash: string | undefined };

const hashPattern = /^0x[0-9a-fA-F]{64}$/u;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;

/** @throws {never} */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** @throws {never} */
function quantity(value: unknown): bigint | undefined {
  return typeof value === "string" && quantityPattern.test(value) ? BigInt(value) : undefined;
}

/** @throws {never} */
export function isTransactionHash(value: string): boolean {
  return hashPattern.test(value);
}

/** @throws {never} */
function logOf(value: unknown): EscrowLog | undefined {
  const log = record(value);
  if (log === undefined) return undefined;
  const { address, topics, data, blockNumber, blockHash, transactionHash, logIndex, removed } = log;
  const block = quantity(blockNumber);
  const index = quantity(logIndex);
  if (typeof address !== "string" || !Array.isArray(topics) || !topics.every((topic) => typeof topic === "string") || typeof data !== "string"
    || block === undefined || typeof blockHash !== "string" || typeof transactionHash !== "string" || index === undefined || index > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return { address, topics: topics as EscrowLog["topics"], data: data as EscrowLog["data"], blockNumber: block, blockHash: blockHash as EscrowLog["blockHash"], transactionHash: transactionHash as EscrowLog["transactionHash"], logIndex: Number(index), removed: removed === true };
}

/** @throws {never} */
export function receiptOf(value: unknown): WalletReceipt | undefined {
  const receipt = record(value);
  if (receipt === undefined) return undefined;
  const { status, transactionHash, blockNumber, blockHash, logs } = receipt;
  const block = quantity(blockNumber);
  if (typeof status !== "string" || typeof transactionHash !== "string" || block === undefined || typeof blockHash !== "string" || !Array.isArray(logs)) return undefined;
  const parsed = logs.map(logOf);
  if (parsed.some((log) => log === undefined)) return undefined;
  return { status, transactionHash, blockNumber: block, blockHash, logs: parsed.filter((log) => log !== undefined) };
}

/** @throws {never} */
export function transactionOf(value: unknown): WalletTransaction | undefined {
  const transaction = record(value);
  if (transaction === undefined) return undefined;
  const { from, to, input, value: sent } = transaction;
  const amount = quantity(sent);
  if (typeof from !== "string" || (to !== null && typeof to !== "string") || typeof input !== "string" || amount === undefined) return undefined;
  return { from, to, input, value: amount };
}

/** @throws {never} */
export function blockNumberOf(value: unknown): bigint | undefined {
  return quantity(record(value)?.number);
}

/** @throws {never} */
export function blockHashOf(value: unknown): string | undefined {
  const hash = record(value)?.hash;
  return typeof hash === "string" ? hash : undefined;
}

/** @throws {never} */
export function matchesCall(transaction: WalletTransaction, expected: ExpectedCall): boolean {
  return transaction.from.toLowerCase() === expected.from.toLowerCase()
    && transaction.to?.toLowerCase() === expected.to.toLowerCase()
    && transaction.input.toLowerCase() === expected.input.toLowerCase()
    && transaction.value === expected.value;
}

/** @throws {never} */
export function expectedOf(plan: EvmCallPlan): ExpectedCall {
  return { from: plan.from, to: plan.to, input: plan.data, value: BigInt(plan.value) };
}

/** @throws {never} */
export function receiptStatus(status: string): ReceiptStatus {
  return status === "0x1" ? "success" : status === "0x0" ? "reverted" : "other";
}

/** @throws {never} */
export function canonicalReceipt(receipt: WalletReceipt, hash: string, canonicalHash: string | undefined): boolean {
  return canonicalHash === receipt.blockHash && receipt.transactionHash.toLowerCase() === hash.toLowerCase();
}

/** @throws {never} */
export function vaultEvents(vault: string, receipt: WalletReceipt, name: EscrowEvent["name"]): ReadonlyArray<VaultEvent> {
  const source: EvmAddress | undefined = evmAddress(vault);
  if (source === undefined) return [];
  const own = receipt.logs.filter((log) => log.address.toLowerCase() === source.toLowerCase());
  return decodeEscrowLogs(source, own).flatMap((decoded) => (decoded.kind === "event" && decoded.event.name === name ? [{ event: decoded.event, logIndex: decoded.at.index }] : []));
}

/** @throws {never} */
export function atomicSupported(capabilities: unknown, chainId: bigint): boolean {
  const chains = record(capabilities);
  if (chains === undefined) return false;
  return Object.entries(chains).some(([chain, value]) => /^0x[0-9a-fA-F]+$/u.test(chain) && (BigInt(chain) === chainId || BigInt(chain) === 0n) && record(record(value)?.atomic)?.status === "supported");
}

/** @throws {never} */
export function batchRefusedCode(code: number | undefined): boolean {
  return code !== undefined && batchRefused(code);
}

/** @throws {never} */
export function batchReferenceOf(result: unknown): string | undefined {
  const id = typeof result === "string" ? result : record(result)?.id;
  return typeof id === "string" && id.length >= 1 && id.length <= 4096 ? id : undefined;
}

/** @throws {never} */
export function batchReport(reported: unknown): BatchReport {
  const status = record(reported)?.status;
  if (typeof status !== "number" || !Number.isSafeInteger(status)) return { kind: "unrecognized" };
  const kind = batchStatus(status);
  if (kind !== "landed") return { kind };
  const receipts = record(reported)?.receipts;
  const last = Array.isArray(receipts) ? record(receipts.at(-1))?.transactionHash : undefined;
  return { kind: "landed", hash: typeof last === "string" && hashPattern.test(last) ? last.toLowerCase() : undefined };
}

/** @throws {never} */
export function failureCode(error: object): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const code: unknown = "code" in current ? current.code : undefined;
    if (typeof code === "number") return code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** @throws {never} */
export function blockIndex(block: bigint): number {
  return block > 0n && block <= 9007199254740991n ? Number(block) : 0;
}
