// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"; spec/fees/conversion.md, "A recorded send without a reservation is imported at its own worst case"; spec/fees/conversion.md, "A same-nonce EVM replacement changes only its fees, in bounded steps"
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64 } from "@scure/base";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import type { D1Database } from "@repo/platform/bindings";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { type SettableClock, settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { type Hex, keccak256, serializeTransaction, type TransactionSerializableEIP1559 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Event, type Fee, type RecordedSend, additionalReserve, replacementFees } from "../../gen/fees__conversion.ts";
import type { Driver, Outcome } from "../../gen/_conformance.ts";
import { type Network, type Sender, transactionCeilingOf } from "../../gen/fees__runtime.ts";
import { type Instance, type NameKind, type Names, runText } from "../../src/journal/codec.vibe";
import { type Facts, journal, send } from "../../src/journal/store.vibe";
import { unpublished } from "../../src/runtime/config.vibe";

export const dayMs = 86_400_000;
const foreignBase = 1_000_000;
const megawei = 1_000_000n;
const gwei = 1_000_000_000n;
const senders: ReadonlyArray<Sender> = ["ReleaseWorkflow", "Owner", "Worker", "Other"];
const solanaProgram = new Uint8Array(32).fill(7);

export function hex(value: number, width: number): string {
  return value.toString(16).padStart(width, "0");
}

export interface GenerationNames extends Names {
  bind(kind: NameKind, text: string, value: number): void;
}

/** @throws {never} */
export function generationNames(generation: number): GenerationNames {
  const numbers = new Map<string, number>();
  const texts = new Map<string, string>();
  const bind = (kind: NameKind, text: string, value: number) => {
    numbers.set(`${kind}:${text}`, value);
    texts.set(`${kind}:${value}`, text);
    return value;
  };
  return {
    number: (kind, text) => numbers.get(`${kind}:${text}`) ?? bind(kind, text, foreignBase + numbers.size),
    text: (kind, value) => {
      const found = texts.get(`${kind}:${value}`);
      if (found !== undefined || kind === "tx") return found;
      const made = `g${generation}-${kind}-${value}`;
      bind(kind, made, value);
      return made;
    },
    bind: (kind, text, value) => {
      bind(kind, text, value);
    },
  };
}

function evmKey(generation: number, wallet = 1): Hex {
  return wallet === 1 ? `0x${hex(generation + 1, 64)}` : `0x${hex(generation + 1, 32)}${hex(wallet, 32)}`;
}

function solanaSeed(generation: number): Uint8Array {
  return sha256(new TextEncoder().encode(`fee journal Solana wallet ${generation}`));
}

function generationOf(instance: Instance): number {
  return instance.epoch / (1_000 * dayMs);
}

/** @throws {never} */
export function generationInstance(generation: number, network: Network = "Base"): Instance {
  return {
    network,
    scope: `g${generation}:`,
    epoch: generation * 1_000 * dayMs,
    held: { runtime: unpublished.runtime, wallets: [privateKeyToAccount(evmKey(generation)).address.toLowerCase(), base58.encode(ed25519.getPublicKey(solanaSeed(generation)))] },
    tokens: [],
    receipts: [],
    vaults: [],
  };
}

interface Signed { readonly txId: string; readonly rawTx: string; readonly intentHash: string }

function compact(value: number): number[] {
  return value < 128 ? [value] : [(value & 127) | 128, value >> 7];
}

function solanaSend(instance: Instance, nonce: number): Signed {
  const seed = solanaSeed(generationOf(instance));
  const blockhash = sha256(new TextEncoder().encode(`fee journal blockhash ${instance.scope}${nonce}`));
  const message = Uint8Array.from([1, 0, 1, ...compact(2), ...ed25519.getPublicKey(seed), ...solanaProgram, ...blockhash, ...compact(1), 1, ...compact(0), ...compact(1), nonce & 255]);
  const signature = ed25519.sign(message, seed);
  return { txId: base58.encode(signature), rawTx: base64.encode(Uint8Array.from([...compact(1), ...signature, ...message])), intentHash: base58.encode(sha256(message)) };
}

async function evmSend(instance: Instance, nonce: number, gas: number, maxFee: number, priority: number, wallet = 1): Promise<Signed> {
  const account = privateKeyToAccount(evmKey(generationOf(instance), wallet));
  const unsigned: TransactionSerializableEIP1559 = { type: "eip1559", chainId: 8453, nonce, gas: BigInt(gas), maxFeePerGas: BigInt(maxFee) * megawei, maxPriorityFeePerGas: BigInt(priority) * megawei, to: account.address, value: 0n };
  const rawTx = await account.signTransaction(unsigned);
  return { txId: keccak256(rawTx), rawTx, intentHash: keccak256(serializeTransaction(unsigned)) };
}

async function reservedSend(instance: Instance, nonce: number, maximum: number): Promise<Signed> {
  return instance.network === "Solana" ? solanaSend(instance, nonce) : evmSend(instance, nonce, 1, maximum, 0);
}

async function replacementSend(instance: Instance, state: Fee, id: number): Promise<Signed> {
  const row = state.rows[id - 1];
  if (row === undefined || row.attempts.length === 0) return { txId: "", rawTx: "", intentHash: "" };
  const fees = replacementFees(state, row);
  return evmSend(instance, row.nonce, row.gasLimit, fees.maxFee, fees.priorityFee);
}

function bound(names: GenerationNames, tx: number, signed: Signed): Facts {
  names.bind("tx", signed.txId, tx);
  return signed;
}

export async function factsFor(event: Event, names: GenerationNames, instance: Instance, state?: Fee): Promise<Facts> {
  const solana = instance.network === "Solana";
  const receipt = (actualNative: number): Facts => ({
    actualWei: solana ? String(actualNative) : (BigInt(actualNative) * megawei).toString(),
    blockHash: `0x${hex(instance.epoch, 64)}`,
  });
  switch (event.type) {
    case "addToken": return { token: `0x${hex(generationOf(instance), 8)}${hex(instance.tokens.length + 1, 32)}` };
    case "evaluate": return { targetToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", summary: JSON.stringify({ route: "journal" }) };
    case "reserveGas": return { intentHash: (await reservedSend(instance, event.nonce, event.maximum)).intentHash, ...solana ? { blockhashSlot: 40 } : {} };
    case "sign": {
      const signed = await reservedSend(instance, event.send.nonce, solana ? transactionCeilingOf("Solana") : event.send.gasLimit * event.send.fees.maxFee + additionalReserve(instance.network));
      return { ...bound(names, event.send.tx, signed), expiresAt: Math.ceil((event.send.deadline + instance.epoch) / 1_000) };
    }
    case "claim": {
      const claim = event.vaultClaim;
      const signed = solana ? solanaSend(instance, claim.nonce) : await evmSend(instance, claim.nonce, claim.gasLimit, claim.fees.maxFee, claim.fees.priority);
      return { ...bound(names, claim.tx, signed), vault: JSON.stringify({ vault: names.text("vault", claim.vault), projectId: `g${generationOf(instance)}-project` }) };
    }
    case "replace": return state === undefined ? {} : bound(names, event.tx, await replacementSend(instance, state, event.id));
    case "finalizeSend":
    case "settleExpired": return receipt(event.receipt.actualNative);
    case "broadcastFail":
    case "failPreparation":
    case "rebroadcast": return { detail: `journal ${event.type} answer withheld from https://rpc.invalid/key-1 Request body: {}` };
    case "recordScan": return { blockhash: "journal-blockhash", nextSlot: event.scan.coverage.fromSlot, expectedHash: "journal-expected", page: JSON.stringify([{ slot: event.scan.coverage.fromSlot }]) };
    case "expireSolana": {
      const context = { firstAvailableSlot: 1, finalizedContextSlot: event.proof.coverage.tipSlot, signatureContextSlot: event.proof.coverage.tipSlot };
      return { blockhash: "journal-blockhash", providers: [context, context] };
    }
    default: return {};
  }
}

const recordedKinds = { Conversion: "conversion", Approval: "approval", Claim: "claim" } as const;

export interface Recording {
  readonly db: D1Database;
  readonly instance: Instance;
  readonly names: GenerationNames;
  readonly runId: string;
  readonly token: string;
  readonly recorded: RecordedSend;
  readonly now: string;
}

/** @throws {never} */
export async function seedRecorded(recording: Recording): Promise<string | undefined> {
  const { db, instance, names, runId, token, recorded, now } = recording;
  if (recorded.wallet <= 0 || instance.network === "Solana" || recorded.nonce < 0 || recorded.gasLimit <= 0 || recorded.fees.maxFee <= 0 || recorded.fees.priority < 0 || recorded.fees.priority > recorded.fees.maxFee) return undefined;
  const known = recorded.wallet === 1 ? instance.held.wallets[0] : undefined;
  const wallet = known ?? privateKeyToAccount(evmKey(generationOf(instance), recorded.wallet)).address.toLowerCase();
  if (known === undefined) names.bind("wallet", wallet, recorded.wallet);
  const signed = await evmSend(instance, recorded.nonce, recorded.gasLimit, recorded.fees.maxFee, recorded.fees.priority, recorded.wallet);
  names.bind("tx", signed.txId, recorded.tx);
  const conversion = recorded.kind === "Conversion";
  const expiresAt = recorded.kind === "Claim" ? null : Math.ceil((recorded.deadline + instance.epoch) / 1_000);
  await db
    .prepare("INSERT INTO fee_conversions (kind, id, run_id, network, mode, fee_wallet, token, target_token, amount_in, min_amount_out, quote_value_micro, tx_id, raw_tx, evm_nonce, expires_at, state, created_at, updated_at, submitted_at) SELECT ?, ?, ?, ?, 'live', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM fee_conversions WHERE tx_id = ?)")
    .bind(recordedKinds[recorded.kind], `recorded-${signed.txId.slice(2, 40)}`, runId, instance.network.toLowerCase(), wallet, token, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", String(recorded.amountIn), conversion ? String(recorded.minimumOutput) : null, recorded.valueMicro, signed.txId, signed.rawTx, recorded.nonce, expiresAt, now, now, now, signed.txId)
    .run();
  return signed.txId;
}

export interface JournalDatabase extends AsyncDisposable {
  readonly db: D1Database;
}

export async function journalDatabase(name: string): Promise<JournalDatabase> {
  const mf = startWorker({ d1: { FEE_DB: name } });
  const failed = (await migrate(mf, "FEE_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) {
    await mf.dispose();
    throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  }
  const db = await database(mf, "FEE_DB");
  return { db, [Symbol.asyncDispose]: () => mf.dispose() };
}

export function senderOf(by: unknown): Sender {
  return senders.find((sender) => sender === by) ?? "Other";
}

export async function gweiSigned(generation: number, chainId: number, nonce: number, maximumUnits: number) {
  const account = privateKeyToAccount(evmKey(generation));
  const unsigned: TransactionSerializableEIP1559 = { type: "eip1559", chainId, nonce, gas: 1n, maxFeePerGas: BigInt(maximumUnits) * gwei, maxPriorityFeePerGas: 0n, to: account.address, value: 0n };
  const rawTx = await account.signTransaction(unsigned);
  return { rawTx, intentHash: keccak256(serializeTransaction(unsigned)) };
}

function journalRuntime(db: D1Database, clock: SettableClock) {
  return ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));
}

export interface JournalHarness extends AsyncDisposable {
  readonly db: D1Database;
  readonly clock: SettableClock;
  readonly runtime: ReturnType<typeof journalRuntime>;
}

export async function journalHarness(name: string): Promise<JournalHarness> {
  const started = await journalDatabase(name);
  const clock = settableClock(0);
  const runtime = journalRuntime(started.db, clock);
  return {
    db: started.db,
    clock,
    runtime,
    [Symbol.asyncDispose]: async () => {
      await runtime.dispose();
      await started[Symbol.asyncDispose]();
    },
  };
}

export async function heldLease(harness: JournalHarness, instance: Instance, names: GenerationNames): Promise<string | undefined> {
  const { state } = await harness.runtime.runPromise(journal(instance, names));
  const runId = state.lease.holder !== 0 && state.lease.expiresAt >= state.clock ? state.lease.holder : state.nextRun;
  if (runId === state.nextRun) {
    const acquired = await harness.runtime.runPromise(Effect.exit(send(instance, names, { type: "acquireLease", runId, trigger: "Recovery" }, "Worker")));
    if (!Exit.isSuccess(acquired)) return undefined;
  }
  const text = names.text("run", runId);
  return text === undefined ? undefined : runText(instance.scope, text, "Recovery");
}

export interface JournalApplication<E, V> {
  reset(): void;
  dispatch(event: E, by: unknown): Promise<Outcome>;
  observe(): Promise<V>;
}

export function journalDriver<E, V>(harness: JournalHarness, application: JournalApplication<E, V>): Driver<E, V> & AsyncDisposable {
  application.reset();
  return {
    reset: () => application.reset(),
    dispatch: (_key, event, by) => application.dispatch(event, by),
    observe: () => application.observe(),
    [Symbol.asyncDispose]: () => harness[Symbol.asyncDispose](),
  };
}
