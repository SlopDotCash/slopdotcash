import { Effect } from "effect";
import { type Hex, keccak256 } from "viem";
import { outcome } from "@repo/platform/testing/area";
import type { Options } from "../../gen/fees__buyback.conformance.ts";
import type { Buyback, Event } from "../../gen/fees__buyback.ts";
import type { Network } from "../../gen/fees__runtime.ts";
import type { IncomeEntry, Leg } from "../../src/buyback/codec.vibe";
import { type Facts, ledgerOf, send, sendFloors } from "../../src/buyback/store.vibe";
import { type GenerationNames, generationInstance, generationNames, gweiSigned, heldLease, hex, journalDriver, journalHarness, senderOf } from "../support/journal.ts";

const buybackStart = 1_794_441_600_000;
const gwei = 1_000_000_000n;
const kinds = ["ConversionOutput", "UsdcClaim", "DirectFee", "KeptSubmissionFee", "RobinhoodFee"] as const;
const harness = await journalHarness("fee-buyback-conformance");
const { clock, runtime } = harness;

let generation = 0;
let names: GenerationNames = generationNames(generation);
let leg: Leg = legOf(generation, names);
const incomeIds = new Map<number, number>();

function legOf(at: number, named: GenerationNames): Leg {
  const instance = generationInstance(at, "Base");
  return { network: "Base", scope: instance.scope, offset: instance.epoch, held: instance.held, names: named, journal: instance, evidence: [], income: [], cancelling: [], reported: [] };
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

function leaseOn(network: Network): Promise<string | undefined> {
  return heldLease(harness, journalOf(network), names);
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

async function sendFacts(event: Extract<Event, { type: "approveOrder" | "order" }>): Promise<Facts> {
  const runId = await leaseOn(leg.network);
  if (runId === undefined) return {};
  const instance = journalOf(leg.network);
  const floors = await runtime.runPromise(sendFloors({ ...leg, journal: instance }, instance));
  const solana = leg.network === "Solana";
  const nonce = solana ? floors.solana : floors.evm;
  const maximum = solana ? event.request.nativeFee : 50_000;
  const bytes = solana ? { rawTx: `g${generation}-solana-order-${event.request.tx}`, intentHash: `g${generation}-intent-${event.request.tx}` } : await gweiSigned(generation, 8453, nonce, maximum);
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

export const driver = journalDriver<Event, Buyback>(harness, { reset: begin, dispatch, observe });

export const options: Options = { keys: ["leg"], walks: 5, steps: 12 };
