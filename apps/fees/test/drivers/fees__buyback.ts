import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { type Hex, keccak256, serializeTransaction, type TransactionSerializableEIP1559 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import type { Driver, Options } from "../../gen/fees__buyback.conformance.ts";
import type { Buyback, Event } from "../../gen/fees__buyback.ts";
import type { Network, Sender } from "../../gen/fees__runtime.ts";
import type { IncomeEntry, Leg } from "../../src/buyback/codec.vibe";
import { type Facts, ledgerOf, send, sendFloors } from "../../src/buyback/store.vibe";
import { runText } from "../../src/journal/codec.vibe";
import { journal, send as journalSend } from "../../src/journal/store.vibe";
import { type GenerationNames, dayMs, generationInstance, generationNames, journalDatabase } from "../support/journal.ts";

const senders: ReadonlyArray<Sender> = ["ReleaseWorkflow", "Owner", "Worker", "Other"];
const buybackStart = 1_794_441_600_000;
const gwei = 1_000_000_000n;
const kinds = ["ConversionOutput", "UsdcClaim", "DirectFee", "RobinhoodFee"] as const;
const started = await journalDatabase("fee-buyback-conformance");
const clock = settableClock(0);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(started.db), webCrypto, clock.layer));

let generation = 0;
let names: GenerationNames = generationNames(generation);
let leg: Leg = legOf(generation, names);
const incomeIds = new Map<number, number>();

function hex(value: number, width: number): string {
  return value.toString(16).padStart(width, "0");
}

function offsetOf(at: number): number {
  return at * 1_000 * dayMs;
}

function legOf(at: number, named: GenerationNames): Leg {
  const instance = generationInstance(at, "Base");
  return { network: "Base", scope: instance.scope, offset: offsetOf(at), held: instance.held, names: named, journal: instance, evidence: [], income: [], cancelling: [], reported: [] };
}

function senderOf(by: unknown): Sender {
  return senders.find((sender) => sender === by) ?? "Other";
}

function begin() {
  generation += 1;
  names = generationNames(generation);
  leg = legOf(generation, names);
  incomeIds.clear();
  clock.set(leg.offset + buybackStart);
}

function journalOf(network: Network) {
  return { ...generationInstance(generation, network), held: leg.held };
}

async function leaseOn(network: Network): Promise<string | undefined> {
  const instance = journalOf(network);
  const { state } = await runtime.runPromise(journal(instance, names));
  const now = state.clock;
  const runId = state.lease.holder !== 0 && state.lease.expiresAt >= now ? state.lease.holder : state.nextRun;
  if (runId === state.nextRun) {
    const acquired = await runtime.runPromise(Effect.exit(journalSend(instance, names, { type: "acquireLease", runId, trigger: "Recovery" }, "Worker")));
    if (!Exit.isSuccess(acquired)) return undefined;
  }
  const text = names.text("run", runId);
  return text === undefined ? undefined : runText(instance.scope, text, "Recovery");
}

function shellIncome(event: Extract<Event, { type: "recordIncome" }>): Event {
  const shellId = (kinds.indexOf(event.key.kind) + 1) * 1_000_000 + event.key.id;
  incomeIds.set(shellId, event.key.id);
  const text = `g${generation}-income-${event.key.kind}-${event.key.id}`;
  names.bind("receipt", `${event.key.kind}:${text}`, shellId);
  const entry: IncomeEntry = { kind: event.key.kind, text, amount: event.incomeAmount, chainTime: event.chainTime };
  leg = { ...leg, evidence: [...leg.evidence, entry] };
  return { ...event, key: { ...event.key, id: shellId } };
}

function orderText(order: number): string {
  const text = `0x${hex(generation, 8)}${hex(order, 56)}`;
  names.bind("hash", text, order);
  return text;
}

function txText(tx: number, rawTx: string): string {
  const txId = leg.network === "Solana" ? `g${generation}solana${hex(tx, 24)}` : keccak256(rawTx as Hex);
  names.bind("tx", txId, tx);
  return txId;
}

async function evmSigned(nonce: number, maximumUnits: number) {
  const account = privateKeyToAccount(`0x${hex(generation + 1, 64)}`);
  const unsigned: TransactionSerializableEIP1559 = { type: "eip1559", chainId: 8453, nonce, gas: 1n, maxFeePerGas: BigInt(maximumUnits) * gwei, maxPriorityFeePerGas: 0n, to: account.address, value: 0n };
  const rawTx = await account.signTransaction(unsigned);
  return { rawTx, intentHash: keccak256(serializeTransaction(unsigned)) };
}

async function sendFacts(event: Extract<Event, { type: "approveOrder" | "order" }>): Promise<Facts> {
  const runId = await leaseOn(leg.network);
  if (runId === undefined) return {};
  const instance = journalOf(leg.network);
  const floors = await runtime.runPromise(sendFloors({ ...leg, journal: instance }, instance));
  const solana = leg.network === "Solana";
  const nonce = solana ? floors.solana : floors.evm;
  const maximum = solana ? event.request.nativeFee : 50_000;
  const bytes = solana ? { rawTx: `g${generation}-solana-order-${event.request.tx}`, intentHash: `g${generation}-intent-${event.request.tx}` } : await evmSigned(nonce, maximum);
  const txId = txText(event.request.tx, bytes.rawTx);
  const limits = solana ? { perTransaction: 50_000_000n, perDay: 100_000_000n, additionalFeeReserve: 0n } : { perTransaction: 100_000n * gwei, perDay: 1_000_000n * gwei, additionalFeeReserve: 50_000n * gwei };
  const signed = { txId, rawTx: bytes.rawTx, nonce, maximumWei: solana ? String(maximum) : (BigInt(maximum) * gwei).toString(), intentHash: bytes.intentHash, limits };
  const terms = { provider: "debridge" as const, orderId: orderText(event.request.orderId), takeToken: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", takeAmount: String(event.request.takeAmount), takeChainId: "4663", receiver: leg.held.wallets[0] ?? "", nativeFee: String(event.request.nativeFee), salt: "1" };
  return { runId, signed, balance: String(event.request.balance), summary: JSON.stringify({ provider: "debridge", orderId: terms.orderId }), takeAmount: terms.takeAmount, ...event.type === "order" ? { terms } : {} };
}

async function observed(): Promise<Buyback> {
  return runtime.runPromise(ledgerOf(leg).pipe(Effect.map((ledger) => ledger.state)));
}

async function factsFor(event: Event): Promise<Facts> {
  const base: Facts = { runId: `${leg.scope}buyback-decisions`, wallet: leg.held.wallets[leg.network === "Solana" ? 1 : 0] ?? "", token: leg.network === "Solana" ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", balance: "0" };
  const receipt = async (tx: number) => ({ ...base, receipt: { landedTxId: names.text("tx", tx) ?? "", actualWei: "1000", blockHash: `0x${hex(generation, 64)}`, paid: String((await observed()).orderAmount) } });
  switch (event.type) {
    case "decide": return { ...base, detail: "DLN ERROR_LOW_GIVE_AMOUNT: no route", takeAmount: String(event.quote.takeAmount) };
    case "approveOrder":
    case "order": return { ...base, ...(await sendFacts(event)) };
    case "settleApproval":
    case "settleOrder": return receipt(event.receipt.tx);
    case "loseSend": return { ...base, detail: "broadcast answer withheld from https://rpc.invalid/key-1" };
    case "observeArrival": return { ...base, runId: (await leaseOn("Robinhood")) ?? "", blockHash: `0x${hex(event.arrival.height, 64)}` };
    case "observeRefund": return { ...base, runId: (await leaseOn(leg.network)) ?? "", blockHash: `0x${hex(event.refund.height, 64)}` };
    default: return base;
  }
}

async function dispatch(event: Event, by: unknown): Promise<"accepted" | "refused"> {
  const shell = event.type === "recordIncome" ? shellIncome(event) : event;
  const facts = await factsFor(shell);
  const current = { ...leg, journal: journalOf(leg.network) };
  const sent = send(current, shell, senderOf(by), facts).pipe(
    Effect.tap((done) => Effect.sync(() => {
      leg = done.leg;
      if (event.type === "advanceClock") clock.set(leg.offset + event.now);
    })),
  );
  return outcome(sent, runtime);
}

async function observe(): Promise<Buyback> {
  const state = await observed();
  return { ...state, sources: state.sources.map((key) => ({ ...key, id: incomeIds.get(key.id) ?? key.id })) };
}

begin();

export const driver: Driver & AsyncDisposable = {
  reset: () => begin(),
  dispatch: (_key, event, by) => dispatch(event, by),
  observe: () => observe(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await started[Symbol.asyncDispose]();
  },
};

export const options: Options = { keys: ["leg"], walks: 5, steps: 12 };
