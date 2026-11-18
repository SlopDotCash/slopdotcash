/**
 * What the submission-fee Worker does on one network in one run (PRD section
 * 6, "Submission fee deposits"), with no chain or database code of its own:
 *
 *   1. read the contract's finalized events and record them, cursor last;
 *   2. read the unfinalized `Deposited` events that already have the
 *      network's confirmation count on top of them;
 *   3. judge each new deposit and mark its pull request paid;
 *   4. copy what each pull request's row says is due onto its deposit;
 *   5. reconcile the one send in flight, then record and send the next.
 *
 * It decides nothing about merges or closes: `submission_fee_items.outcome`
 * is Slopbot's. It never keeps a deposit that does not count, and it never
 * signs a second transaction while one is unsettled.
 */

import {
  SUBMISSION_FEE_UNKNOWN_ITEM_GRACE_MS,
  type SubmissionFeeRate,
  type SubmissionFeeTerms,
  submissionDepositCounts,
  submissionFeeTokenKind,
  submissionResolveAction,
} from "../../src/lib/submission-fee.mjs";
import type { GasLimits, Mode, NetworkConfig } from "./config";

/** Finalized log pages read for one network in one run. */
export const FINALIZED_PAGES_PER_RUN = 10;
/** Unfinalized log pages read for one network in one run. */
export const CONFIRMED_PAGES_PER_RUN = 10;
/** Deposits judged for one network in one run. */
export const JUDGED_PER_RUN = 200;
/** Deposits one `resolveMany` transaction carries. */
export const MAX_BATCH = 20;

export type ChainEvent =
  | {
      kind: "deposited";
      depositId: number;
      item: string;
      payer: string;
      token: string;
      amount: string;
      keptTo: string;
      txHash: string;
      blockNumber: number;
      blockHash: string;
      logIndex: number;
    }
  | {
      kind: "resolved";
      depositId: number;
      refunded: boolean;
      txHash: string;
      blockNumber: number;
      blockHash: string;
      logIndex: number;
    }
  | {
      kind: "reclaimed";
      depositId: number;
      txHash: string;
      blockNumber: number;
      blockHash: string;
      logIndex: number;
    };
export type DepositedEvent = Extract<ChainEvent, { kind: "deposited" }>;

export interface DepositRow {
  network: string;
  depositId: number;
  item: string;
  repositoryId: number | null;
  pullNumber: number | null;
  payer: string;
  token: string;
  amount: string;
  keptTo: string;
  txHash: string;
  blockNumber: number;
  blockTime: string;
  finalizedAt: string | null;
  accepted: number | null;
  rejectReason: string | null;
  state: string;
}

export interface ItemRow {
  repositoryId: number;
  pullNumber: number;
  item: string;
  stableMinor: string;
  paidNetwork: string | null;
  paidDepositId: number | null;
  outcome: string | null;
}

export type SendState =
  | "recorded"
  | "submitted"
  | "unknown"
  | "finalized"
  | "failed";

export interface SendEntry {
  id: number;
  refund: boolean;
}

export interface SendRow {
  id: string;
  network: string;
  mode: "dry_run" | "live";
  contract: string;
  deposits: SendEntry[];
  resolver: string | null;
  txId: string | null;
  rawTx: string | null;
  evmNonce: number | null;
  maximumNativeWei: string | null;
  state: SendState;
  reason: string | null;
  blockNumber: number | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
}

/** The contract's own record of a deposit, as `deposits(id)` returns it. */
export interface ChainDeposit {
  payer: string;
  token: string;
  amount: string;
  keptTo: string;
  item: string;
  /** 0 none, 1 open, 2 refunded, 3 kept, 4 reclaimed. */
  state: number;
}

export interface PreparedSend {
  txId: string;
  rawTx: string;
  evmNonce: number;
  maximumNativeWei: string;
}

export type SendStatus =
  | { kind: "pending" }
  | { kind: "finalized"; blockNumber: number }
  | { kind: "failed"; reason: string }
  | { kind: "rebroadcast" };

export interface FeeChain {
  chainId(): Promise<number>;
  heads(): Promise<{ latest: number; finalized: number }>;
  /** Every contract event in the inclusive range, in chain order. */
  events(fromBlock: number, toBlock: number): Promise<ChainEvent[]>;
  /** The time of the canonical block with this number and hash. */
  blockTime(blockNumber: number, blockHash: string): Promise<string>;
  /**
   * Proves from the finalized receipt that this `Resolved` event moved the
   * deposit's exact amount of its token from the contract to `recipient`.
   */
  assertResolvedTransfer(
    event: Extract<ChainEvent, { kind: "resolved" }>,
    transfer: { token: string; recipient: string; amount: string },
  ): Promise<void>;
  deposit(depositId: number): Promise<ChainDeposit>;
  /** The resolver key's address, or null when no key is loaded. */
  address(): string | null;
  /** Simulates, then signs. `authorize` runs before the signature. */
  prepare(
    entries: readonly SendEntry[],
    authorize: (maximumNativeWei: string) => Promise<void>,
  ): Promise<PreparedSend>;
  broadcast(rawTx: string): Promise<void>;
  status(send: SendRow): Promise<SendStatus>;
}

export interface FinalizedPage {
  network: string;
  /** First block of the page; the cursor must still be here. */
  from: number;
  /** Last block of the page; the cursor moves to `to + 1`. */
  to: number;
  deposits: (DepositedEvent & { blockTime: string })[];
  resolutions: {
    depositId: number;
    state: "refunded" | "kept" | "reclaimed";
    txHash: string;
    at: string;
  }[];
  finalizedAt: string;
}

export interface FeeStore {
  hasItems(): Promise<boolean>;
  cursor(network: string): Promise<number | null>;
  deposit(network: string, depositId: number): Promise<DepositRow | null>;
  /** Writes a finalized page and its cursor as one atomic step. */
  writeFinalizedPage(page: FinalizedPage): Promise<void>;
  /**
   * Records unfinalized deposits. When `complete`, unfinalized rows inside
   * the range that the chain no longer reports are removed.
   */
  writeConfirmed(
    network: string,
    range: { from: number; to: number; complete: boolean },
    deposits: (DepositedEvent & { blockTime: string })[],
  ): Promise<void>;
  unjudged(network: string, limit: number): Promise<DepositRow[]>;
  itemByHash(item: string): Promise<ItemRow | null>;
  rates(): Promise<SubmissionFeeRate[]>;
  /** Marks the pull request paid by this deposit; false when another paid. */
  markPaid(deposit: DepositRow, item: ItemRow, at: string): Promise<boolean>;
  setJudgement(
    deposit: DepositRow,
    judgement: {
      accepted: 0 | 1;
      reason: string | null;
      item: ItemRow | null;
    },
  ): Promise<void>;
  /** Finalized deposits still in an open state, with their item rows. */
  resolvable(
    network: string,
  ): Promise<{ deposit: DepositRow; item: ItemRow | null }[]>;
  setDue(
    network: string,
    depositId: number,
    state: "open" | "refund_due" | "kept_due",
  ): Promise<void>;
  openSend(network: string): Promise<SendRow | null>;
  latestDryRun(network: string): Promise<SendRow | null>;
  /** Throws GasBudgetError when the day's native limit would be passed. */
  assertGasBudget(
    network: string,
    maximumNativeWei: string,
    limits: GasLimits,
    now: Date,
  ): Promise<void>;
  /** Records the send. A live row is refused over the day's native limit. */
  insertSend(row: SendRow, limits: GasLimits): Promise<void>;
  updateSend(
    id: string,
    fields: {
      state: SendState;
      reason?: string | null;
      blockNumber?: number | null;
      finalizedAt?: string | null;
      updatedAt: string;
    },
  ): Promise<void>;
}

export class GasBudgetError extends Error {}
/** Another run recorded a send for this network first. */
export class SendConflictError extends Error {}

/** Bounded, single-line error text for logs. */
export function message(error: unknown): string {
  // Provider errors can embed signed transaction bytes or an endpoint with a
  // key in its path. Never copy that text to logs.
  if (error instanceof GasBudgetError) return "submission_fee_gas_budget";
  return error instanceof TypeError
    ? "submission_fee_invalid_input"
    : "submission_fee_operation_failed";
}

export interface NetworkDependencies {
  mode: Exclude<Mode, "off">;
  network: NetworkConfig;
  terms: SubmissionFeeTerms;
  store: FeeStore;
  chain: FeeChain;
  now: () => Date;
  randomId: () => string;
  log: (event: Record<string, unknown>) => void;
}

export interface NetworkResult {
  network: string;
  status: "ran" | "chain_mismatch";
  finalizedThrough: number | null;
  recorded: number;
  resolved: number;
  judged: number;
  paid: number;
  send:
    | "none"
    | "in_flight"
    | "sent"
    | "recorded"
    | "unchanged"
    | "gas_budget"
    | "no_resolver_key";
}

const lower = (value: string) => value.toLowerCase();

async function withTimes(
  chain: FeeChain,
  events: readonly DepositedEvent[],
): Promise<(DepositedEvent & { blockTime: string })[]> {
  const times = new Map<string, string>();
  const out: (DepositedEvent & { blockTime: string })[] = [];
  for (const event of events) {
    const key = `${event.blockNumber}:${event.blockHash}`;
    let time = times.get(key);
    if (time === undefined) {
      time = await chain.blockTime(event.blockNumber, event.blockHash);
      times.set(key, time);
    }
    out.push({ ...event, blockTime: time });
  }
  return out;
}

/**
 * Steps 1 and 2: the finalized pages, oldest first, then the confirmed
 * window above the finalized block. A finalized `Resolved` event of an
 * accepted token is recorded only after its receipt proves the transfer it
 * stands for.
 */
export async function scan(
  deps: NetworkDependencies,
): Promise<{ finalizedThrough: number; recorded: number; resolved: number }> {
  const { store, chain, network } = deps;
  const { latest, finalized } = await chain.heads();
  if (finalized > latest) throw new Error("Finalized block is above the head");
  let next = (await store.cursor(network.network)) ?? network.startBlock;
  let recorded = 0;
  let resolved = 0;
  const page = network.scanPageBlocks;
  for (
    let pages = 0;
    pages < FINALIZED_PAGES_PER_RUN && next <= finalized;
    pages += 1
  ) {
    const to = Math.min(next + page - 1, finalized);
    const events = await chain.events(next, to);
    const seen = new Map<number, DepositedEvent>();
    const resolutions: FinalizedPage["resolutions"] = [];
    for (const event of events) {
      if (event.blockNumber < next || event.blockNumber > to)
        throw new Error("Event outside its page");
      if (event.kind === "deposited") {
        if (seen.has(event.depositId))
          throw new Error("Deposit id repeated in one page");
        seen.set(event.depositId, event);
        continue;
      }
      const at = await chain.blockTime(event.blockNumber, event.blockHash);
      if (event.kind === "reclaimed") {
        resolutions.push({
          depositId: event.depositId,
          state: "reclaimed",
          txHash: event.txHash,
          at,
        });
        continue;
      }
      // The deposit this resolves: one from this page, or an earlier row.
      const source =
        seen.get(event.depositId) ??
        (await store.deposit(network.network, event.depositId));
      if (!source || ("finalizedAt" in source && source.finalizedAt === null))
        throw new Error("Resolved event for an unknown deposit");
      // The accepted tokens emit the standard Transfer event, and only they
      // can ever be income. Another token's deposit is only ever refunded;
      // its contract event is recorded as it stands, so a token that emits
      // nothing cannot hold up the scan.
      if (
        submissionFeeTokenKind(network.network, source.token, deps.terms) !==
        null
      )
        await chain.assertResolvedTransfer(event, {
          token: source.token,
          recipient: event.refunded ? source.payer : source.keptTo,
          amount: source.amount,
        });
      resolutions.push({
        depositId: event.depositId,
        state: event.refunded ? "refunded" : "kept",
        txHash: event.txHash,
        at,
      });
    }
    await store.writeFinalizedPage({
      network: network.network,
      from: next,
      to,
      deposits: await withTimes(chain, [...seen.values()]),
      resolutions,
      finalizedAt: deps.now().toISOString(),
    });
    recorded += seen.size;
    resolved += resolutions.length;
    next = to + 1;
  }
  // Only once the finalized range is fully read does the confirmed window
  // start right above it.
  const confirmed = latest - network.confirmations;
  if (next > finalized && confirmed > finalized) {
    const found: DepositedEvent[] = [];
    let from = next;
    let pages = 0;
    for (; pages < CONFIRMED_PAGES_PER_RUN && from <= confirmed; pages += 1) {
      const to = Math.min(from + page - 1, confirmed);
      for (const event of await chain.events(from, to)) {
        if (event.blockNumber < from || event.blockNumber > to)
          throw new Error("Event outside its page");
        if (event.kind === "deposited") found.push(event);
      }
      from = to + 1;
    }
    const through = from - 1;
    if (through >= next) {
      await store.writeConfirmed(
        network.network,
        { from: next, to: through, complete: through === confirmed },
        await withTimes(chain, found),
      );
      recorded += found.length;
    }
  }
  return { finalizedThrough: next - 1, recorded, resolved };
}

/**
 * Step 3: judges deposits that have no judgement yet. A deposit that counts
 * marks its pull request paid first; only then is it recorded as accepted,
 * so two deposits can never both pay one pull request. A deposit whose pull
 * request Slop has not asked a fee for waits 24 hours after it is finalized,
 * in case the request is still on its way, and is then refused.
 */
export async function judge(
  deps: NetworkDependencies,
): Promise<{ judged: number; paid: number }> {
  const { store, network, terms } = deps;
  const rates = await store.rates();
  let judged = 0;
  let paid = 0;
  for (const deposit of await store.unjudged(network.network, JUDGED_PER_RUN)) {
    const item = await store.itemByHash(deposit.item);
    const verdict = submissionDepositCounts(
      network.network,
      deposit,
      item,
      rates,
      terms,
    );
    if (verdict.accepted && item) {
      const at = deps.now().toISOString();
      if (!(await store.markPaid(deposit, item, at))) continue;
      await store.setJudgement(deposit, { accepted: 1, reason: null, item });
      judged += 1;
      paid += 1;
      deps.log({
        event: "submission_fee_paid",
        network: network.network,
        depositId: deposit.depositId,
        repositoryId: item.repositoryId,
        pullNumber: item.pullNumber,
      });
      continue;
    }
    if (verdict.accepted) continue;
    if (verdict.reason === "unknown_item") {
      if (
        deposit.finalizedAt === null ||
        deps.now().getTime() - Date.parse(deposit.finalizedAt) <
          SUBMISSION_FEE_UNKNOWN_ITEM_GRACE_MS
      )
        continue;
    }
    await store.setJudgement(deposit, {
      accepted: 0,
      reason: verdict.reason,
      item,
    });
    judged += 1;
    deps.log({
      event: "submission_fee_refused",
      network: network.network,
      depositId: deposit.depositId,
      reason: verdict.reason,
    });
  }
  return { judged, paid };
}

/**
 * Step 4: what is due for each finalized open deposit, from the pure rule.
 * Returns the entries to send, oldest deposit first.
 */
export async function plan(deps: NetworkDependencies): Promise<SendEntry[]> {
  const { store, network } = deps;
  const entries: SendEntry[] = [];
  for (const { deposit, item } of await store.resolvable(network.network)) {
    const action = submissionResolveAction(network.network, deposit, item);
    const state =
      action === "refund"
        ? "refund_due"
        : action === "keep"
          ? "kept_due"
          : "open";
    if (state !== deposit.state)
      await store.setDue(network.network, deposit.depositId, state);
    if (action !== null)
      entries.push({ id: deposit.depositId, refund: action === "refund" });
  }
  return entries.sort((left, right) => left.id - right.id);
}

/** Reconciles the send in flight. True while one is still unsettled. */
export async function reconcile(deps: NetworkDependencies): Promise<boolean> {
  const { store, chain, network } = deps;
  const send = await store.openSend(network.network);
  if (!send) return false;
  if (send.contract !== network.contract)
    throw new Error("The recorded send names another contract");
  const status = await chain.status(send);
  const at = deps.now().toISOString();
  const base = { event: "", network: network.network, txId: send.txId };
  switch (status.kind) {
    case "pending":
      return true;
    case "finalized":
      await store.updateSend(send.id, {
        state: "finalized",
        reason: null,
        blockNumber: status.blockNumber,
        finalizedAt: at,
        updatedAt: at,
      });
      deps.log({ ...base, event: "submission_fee_send_finalized" });
      return false;
    case "failed":
      await store.updateSend(send.id, {
        state: "failed",
        reason: status.reason,
        updatedAt: at,
      });
      deps.log({
        ...base,
        event: "submission_fee_send_failed",
        reason: status.reason,
      });
      return false;
    case "rebroadcast":
      // The same signed bytes, never a new signature. Its native reserve is
      // already counted, so a resend adds no liability.
      try {
        await chain.broadcast(send.rawTx as string);
        await store.updateSend(send.id, {
          state: "submitted",
          reason: null,
          updatedAt: at,
        });
      } catch (error) {
        await store.updateSend(send.id, {
          state: "unknown",
          reason: message(error),
          updatedAt: at,
        });
      }
      return true;
  }
}

function sameEntries(left: readonly SendEntry[], right: readonly SendEntry[]) {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.id === right[index].id && entry.refund === right[index].refund,
    )
  );
}

/**
 * Step 5. The contract's own record is read for every entry first: only a
 * deposit that is still open on chain and matches the stored row is sent. In
 * `dry_run` the list is recorded and nothing is signed. In `live` the signed
 * bytes are recorded before they are broadcast, so a run that dies after
 * signing leaves a row the next run resends unchanged.
 */
export async function send(
  deps: NetworkDependencies,
  planned: readonly SendEntry[],
): Promise<NetworkResult["send"]> {
  const { store, chain, network, mode } = deps;
  const entries: SendEntry[] = [];
  for (const entry of planned) {
    if (entries.length === MAX_BATCH) break;
    const row = await store.deposit(network.network, entry.id);
    const onChain = await chain.deposit(entry.id);
    if (
      !row ||
      lower(onChain.payer) !== lower(row.payer) ||
      lower(onChain.token) !== lower(row.token) ||
      onChain.amount !== row.amount ||
      lower(onChain.keptTo) !== lower(row.keptTo) ||
      lower(onChain.item) !== lower(row.item)
    )
      throw new Error("A stored deposit differs from the contract's record");
    // Already resolved or reclaimed on chain: its event is still on its way
    // through the finalized scan.
    if (onChain.state !== 1) continue;
    entries.push(entry);
  }
  if (entries.length === 0) return "none";
  const at = deps.now().toISOString();
  const row: SendRow = {
    id: `sfs_${deps.randomId()}`,
    network: network.network,
    mode,
    contract: network.contract,
    deposits: entries,
    resolver: null,
    txId: null,
    rawTx: null,
    evmNonce: null,
    maximumNativeWei: null,
    state: "recorded",
    reason: null,
    blockNumber: null,
    createdAt: at,
    updatedAt: at,
    finalizedAt: null,
  };
  if (mode === "dry_run") {
    const last = await store.latestDryRun(network.network);
    if (
      last &&
      last.contract === row.contract &&
      sameEntries(last.deposits, entries)
    )
      return "unchanged";
    await store.insertSend(row, network.gas);
    deps.log({
      event: "submission_fee_would_send",
      network: network.network,
      deposits: entries,
    });
    return "recorded";
  }
  const resolver = chain.address();
  if (resolver === null) return "no_resolver_key";
  let prepared: PreparedSend;
  try {
    prepared = await chain.prepare(entries, (maximumNativeWei) =>
      store.assertGasBudget(
        network.network,
        maximumNativeWei,
        network.gas,
        deps.now(),
      ),
    );
    // Durable before broadcast. The insert repeats the day's limit and holds
    // the one-in-flight index, so a losing concurrent signer never
    // broadcasts its bytes.
    await store.insertSend(
      {
        ...row,
        resolver,
        txId: prepared.txId,
        rawTx: prepared.rawTx,
        evmNonce: prepared.evmNonce,
        maximumNativeWei: prepared.maximumNativeWei,
        state: "submitted",
      },
      network.gas,
    );
  } catch (error) {
    // Its bytes were never recorded, so they are never broadcast.
    if (error instanceof SendConflictError) return "in_flight";
    if (!(error instanceof GasBudgetError)) throw error;
    deps.log({
      event: "submission_fee_gas_budget",
      network: network.network,
    });
    return "gas_budget";
  }
  const sent = {
    network: network.network,
    txId: prepared.txId,
    deposits: entries,
  };
  try {
    await chain.broadcast(prepared.rawTx);
  } catch (error) {
    // The node may still hold the bytes. The next run resends them
    // unchanged; this run does not report them as sent.
    await store.updateSend(row.id, {
      state: "unknown",
      reason: message(error),
      updatedAt: deps.now().toISOString(),
    });
    deps.log({ event: "submission_fee_send_unknown", ...sent });
    return "in_flight";
  }
  deps.log({ event: "submission_fee_send_submitted", ...sent });
  return "sent";
}

/** One network, one run. */
export async function runNetwork(
  deps: NetworkDependencies,
): Promise<NetworkResult> {
  const { network, chain } = deps;
  const result: NetworkResult = {
    network: network.network,
    status: "ran",
    finalizedThrough: null,
    recorded: 0,
    resolved: 0,
    judged: 0,
    paid: 0,
    send: "none",
  };
  // Authenticate the chain before reading or advancing anything.
  if ((await chain.chainId()) !== network.chainId) {
    result.status = "chain_mismatch";
    return result;
  }
  Object.assign(result, await scan(deps));
  Object.assign(result, await judge(deps));
  const inFlight = deps.mode === "live" ? await reconcile(deps) : false;
  if (inFlight) {
    result.send = "in_flight";
    return result;
  }
  result.send = await send(deps, await plan(deps));
  return result;
}
