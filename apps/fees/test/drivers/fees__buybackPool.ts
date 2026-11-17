import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import { type Hex, keccak256, serializeTransaction, type TransactionSerializableEIP1559 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import type { Driver, Options } from "../../gen/fees__buybackPool.conformance.ts";
import type { Event, Pool } from "../../gen/fees__buybackPool.ts";
import type { Sender } from "../../gen/fees__runtime.ts";
import type { IncomeEntry } from "../../src/buyback/codec.vibe";
import type { ArrivalEntry, PoolInstance } from "../../src/buybackPool/codec.vibe";
import { type Facts, poolOf, send, sendFloors } from "../../src/buybackPool/store.vibe";
import { runText } from "../../src/journal/codec.vibe";
import { journal, send as journalSend } from "../../src/journal/store.vibe";
import { type GenerationNames, dayMs, generationInstance, generationNames, journalDatabase } from "../support/journal.ts";

const senders: ReadonlyArray<Sender> = ["ReleaseWorkflow", "Owner", "Worker", "Other"];
const buybackStart = 1_794_441_600_000;
const gwei = 1_000_000_000n;
const reservedUnits = 50_000;
const receiptBase = { RobinhoodFee: 1_000_000, SlopFee: 2_000_000 } as const;
const started = await journalDatabase("fee-buyback-pool-conformance");
const clock = settableClock(0);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(started.db), webCrypto, clock.layer));

let generation = 0;
let names: GenerationNames = generationNames(generation);
let pool: PoolInstance = instanceOf(generation, names);
const receipts = new Map<number, number>();

function hex(value: number, width: number): string {
  return value.toString(16).padStart(width, "0");
}

function offsetOf(at: number): number {
  return at * 1_000 * dayMs;
}

function instanceOf(at: number, named: GenerationNames): PoolInstance {
  const journalInstance = generationInstance(at, "Robinhood");
  return {
    scope: journalInstance.scope, offset: offsetOf(at), held: journalInstance.held, names: named, wallet: journalInstance.held.wallets[0] ?? "", journal: journalInstance,
    arrivalEvidence: [], arrivals: [], feeEvidence: [], fees: [], reserved: [], slopEvidence: [], slopFees: [], runs: 0, runFrom: 0,
  };
}

function senderOf(by: unknown): Sender {
  return senders.find((sender) => sender === by) ?? "Other";
}

function begin() {
  generation += 1;
  names = generationNames(generation);
  pool = instanceOf(generation, names);
  receipts.clear();
  clock.set(pool.offset + buybackStart);
}

function journalOf() {
  return { ...generationInstance(generation, "Robinhood"), held: pool.held };
}

async function leaseOn(): Promise<string | undefined> {
  const instance = journalOf();
  const { state } = await runtime.runPromise(journal(instance, names));
  const runId = state.lease.holder !== 0 && state.lease.expiresAt >= state.clock ? state.lease.holder : state.nextRun;
  if (runId === state.nextRun) {
    const acquired = await runtime.runPromise(Effect.exit(journalSend(instance, names, { type: "acquireLease", runId, trigger: "Recovery" }, "Worker")));
    if (!Exit.isSuccess(acquired)) return undefined;
  }
  const text = names.text("run", runId);
  return text === undefined ? undefined : runText(instance.scope, text, "Recovery");
}

function shellReceipt(kind: keyof typeof receiptBase, receipt: number, entry: Omit<IncomeEntry, "text" | "kind">): { readonly shellId: number; readonly entry: IncomeEntry } {
  const shellId = receiptBase[kind] + receipt;
  const text = `g${generation}-${kind}-${receipt}`;
  const made: IncomeEntry = { kind: kind === "RobinhoodFee" ? "RobinhoodFee" : "DirectFee", text, ...entry };
  names.bind("receipt", `pool:${made.kind}:${text}`, shellId);
  receipts.set(shellId, receipt);
  return { shellId, entry: made };
}

function shellEvent(event: Event): Event {
  switch (event.type) {
    case "recordRobinhoodFee": {
      const { shellId, entry } = shellReceipt("RobinhoodFee", event.robinhoodFee.receipt, { amount: amountOfNumber(event.robinhoodFee.amount), chainTime: event.robinhoodFee.chainTime });
      pool = { ...pool, feeEvidence: [...pool.feeEvidence, entry] };
      return { ...event, robinhoodFee: { ...event.robinhoodFee, receipt: shellId } };
    }
    case "receiveSlopFee": {
      const { shellId, entry } = shellReceipt("SlopFee", event.fee.receipt, { amount: event.fee.quantity, chainTime: event.fee.chainTime });
      pool = { ...pool, slopEvidence: [...pool.slopEvidence, entry] };
      return { ...event, fee: { ...event.fee, receipt: shellId } };
    }
    case "creditArrival": {
      const order = `0x${hex(generation, 8)}${hex(event.arrival.order, 56)}`;
      names.bind("hash", order, event.arrival.order);
      const entry: ArrivalEntry = { network: event.arrival.network, order, takeAmount: event.arrival.takeAmount, height: event.arrival.height };
      pool = { ...pool, arrivalEvidence: [...pool.arrivalEvidence, entry] };
      return event;
    }
    default:
      return event;
  }
}

function amountOfNumber(value: number): number[] {
  const limbs: number[] = [];
  let rest = Math.max(0, value);
  do {
    limbs.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  } while (rest > 0);
  return limbs;
}

async function evmSigned(nonce: number) {
  const account = privateKeyToAccount(`0x${hex(generation + 1, 64)}`);
  const unsigned: TransactionSerializableEIP1559 = { type: "eip1559", chainId: 4663, nonce, gas: 1n, maxFeePerGas: BigInt(reservedUnits) * gwei, maxPriorityFeePerGas: 0n, to: account.address, value: 0n };
  const rawTx = await account.signTransaction(unsigned);
  return { rawTx, intentHash: keccak256(serializeTransaction(unsigned)) };
}

async function sendFacts(tx: number, purchase: boolean): Promise<Facts> {
  const runId = await leaseOn();
  if (runId === undefined) return {};
  const floors = await runtime.runPromise(sendFloors({ ...pool, journal: journalOf() }));
  const bytes = await evmSigned(floors.evm);
  const txId = keccak256(bytes.rawTx as Hex);
  names.bind("tx", txId, tx);
  const limits = { perTransaction: 200_000n * gwei, perDay: 2_000_000n * gwei, additionalFeeReserve: 0n };
  const signed = { txId, rawTx: bytes.rawTx, nonce: floors.evm, maximumWei: (BigInt(reservedUnits) * gwei).toString(), intentHash: bytes.intentHash, limits, expiresAt: 4_102_444_800 };
  return { runId, signed, ...purchase ? { quote: { amountOut: "1", impactBps: 0, summary: JSON.stringify({ aggregator: "kyberswap", tx }) } } : {} };
}

async function factsFor(event: Event): Promise<Facts> {
  const base: Facts = { runId: `${pool.scope}buyback-pool-decisions`, wallet: pool.wallet };
  const receipt = { landedTxId: "", actualWei: "1000", blockHash: `0x${hex(generation, 64)}` };
  switch (event.type) {
    case "decidePurchase": return { ...base, detail: "KyberSwap routes: route not found", quote: { amountOut: "1", impactBps: event.quote.impactBps < 0 ? null : event.quote.impactBps, summary: "{}" } };
    case "decideBurn": return base;
    case "purchase": return { ...base, ...(await sendFacts(event.quote.tx, true)) };
    case "burn": return { ...base, ...(await sendFacts(event.burnRequest.tx, false)) };
    case "settlePurchase": return { ...base, receipt: { ...receipt, landedTxId: names.text("tx", event.swap.tx) ?? "" } };
    case "settleBurn": return { ...base, receipt: { ...receipt, landedTxId: names.text("tx", event.receipt.tx) ?? "" } };
    case "loseSend": return { ...base, detail: "broadcast answer withheld from https://rpc.invalid/key-1" };
    default: return base;
  }
}

async function dispatch(event: Event, by: unknown): Promise<"accepted" | "refused"> {
  const shell = shellEvent(event);
  const facts = await factsFor(shell);
  const sent = send({ ...pool, journal: journalOf() }, shell, senderOf(by), facts).pipe(
    Effect.tap((done) => Effect.sync(() => {
      pool = done.instance;
      if (event.type === "advanceClock") clock.set(pool.offset + event.now);
    })),
  );
  return outcome(sent, runtime);
}

async function observe(): Promise<Pool> {
  const { state } = await runtime.runPromise(poolOf(pool));
  const back = (receipt: number) => receipts.get(receipt) ?? receipt;
  return { ...state, rhReceipts: state.rhReceipts.map(back), slopReceipts: state.slopReceipts.map(back) };
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

export const options: Options = { keys: ["pool"], walks: 5, steps: 12 };
