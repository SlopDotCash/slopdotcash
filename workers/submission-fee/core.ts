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
 * A deposit can name a private security report instead of a pull request
 * (PRD section 8, operator decision of 21 November 2026). Its row is in
 * `security_report_deposits`, its rule is in `report.ts`, and steps 3 to 5
 * treat it the same way: mark the report paid, then send what its row says.
 *
 * It decides nothing about merges or closes: `submission_fee_items.outcome`
 * is Slopbot's, and a report row's `outcome` is the backend's. It never keeps
 * a deposit that does not count, and it never signs a second transaction
 * while one is unsettled. A deposit of a token outside the table is never
 * resolved: its payer reclaims it from the contract. A deposit whose payout
 * the token refuses is parked, so the deposits behind it are still resolved.
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
import {
  type ReportRow,
  reportDepositCounts,
  reportResolveAction,
} from "./report";

export type { ReportRow } from "./report";

/** Finalized log pages read for one network in one run. */
export const FINALIZED_PAGES_PER_RUN = 10;
/** Unfinalized log pages read for one network in one run. */
export const CONFIRMED_PAGES_PER_RUN = 10;
/** Deposits judged for one network in one run. */
export const JUDGED_PER_RUN = 200;
/** Deposits one `resolveMany` transaction carries. */
export const MAX_BATCH = 20;
/** Parked deposits simulated again for one network in one run. */
export const PARKED_CHECKS_PER_RUN = 5;
/** How long a parked deposit waits before it is simulated again. */
export const PARKED_RECHECK_MS = 24 * 60 * 60 * 1000;

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

/**
 * Why a deposit was parked. `payout_failed`: the contract's own error named
 * it. `reverted_alone`: the batch reverted without naming a deposit, and this
 * one reverted when simulated by itself while another went through.
 */
export type ParkReason = "payout_failed" | "reverted_alone";

/** What simulating one deposit's resolution by itself showed. */
export type ProbeResult = "ok" | "payout_failed" | "reverted";

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
  /**
   * Simulates one deposit's resolution from the resolver's address. Signs
   * and sends nothing. A provider failure throws; only a revert is a result.
   */
  probe(entry: SendEntry): Promise<ProbeResult>;
  /**
   * Simulates, then signs. `authorize` runs before the signature. A
   * simulation that reverts throws PayoutFailedError when the contract names
   * the deposit it could not pay, and SendRevertedError otherwise.
   */
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
  /**
   * The report a deposit was asked for under this item, or null. A row that
   * record-only mode wrote (`mode = 'recorded'`) asks for nothing and is
   * never returned.
   */
  reportByHash(item: string): Promise<ReportRow | null>;
  rates(): Promise<SubmissionFeeRate[]>;
  /** Marks the pull request paid by this deposit; false when another paid. */
  markPaid(deposit: DepositRow, item: ItemRow, at: string): Promise<boolean>;
  /** Marks the report paid by this deposit; false when another paid. */
  markReportPaid(
    deposit: DepositRow,
    report: ReportRow,
    at: string,
  ): Promise<boolean>;
  setJudgement(
    deposit: DepositRow,
    judgement: {
      accepted: 0 | 1;
      reason: string | null;
      item: ItemRow | null;
    },
  ): Promise<void>;
  /**
   * Finalized deposits still in an open state, each with the pull request's
   * row it was matched to, or the report's row that names it as the deposit
   * that paid.
   */
  resolvable(
    network: string,
  ): Promise<
    { deposit: DepositRow; item: ItemRow | null; report: ReportRow | null }[]
  >;
  setDue(
    network: string,
    depositId: number,
    state: "open" | "refund_due" | "kept_due",
  ): Promise<void>;
  /** The deposits set aside because their payout cannot go through. */
  parked(network: string): Promise<Set<number>>;
  park(
    network: string,
    entry: SendEntry,
    reason: ParkReason,
    at: string,
  ): Promise<void>;
  /** Parked deposits last simulated at or before `before`, oldest first. */
  parkedToCheck(
    network: string,
    before: string,
    limit: number,
  ): Promise<SendEntry[]>;
  /** Records a new simulation of a parked deposit, releasing it or not. */
  checkedParked(
    network: string,
    depositId: number,
    released: boolean,
    at: string,
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
/** The simulation reverted and the contract named the deposit it could not pay. */
export class PayoutFailedError extends Error {
  constructor(readonly depositId: number) {
    super("The contract could not pay out a deposit");
  }
}
/** The simulation reverted without naming a deposit. Nothing was signed. */
export class SendRevertedError extends Error {}
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

const STEP = Symbol("submission-fee-step");
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/u;

/**
 * Wraps a chain reader or store so an error from one of its methods carries
 * that method's name, as `<label>.<method>`. Nothing else about the object
 * changes.
 */
export function labelled<T extends object>(target: T, label: string): T {
  const mark = (error: unknown, step: string) => {
    if (
      typeof error === "object" &&
      error !== null &&
      !(STEP in error) &&
      Object.isExtensible(error)
    )
      Object.defineProperty(error, STEP, { value: step });
    return error;
  };
  return new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key, object);
      if (typeof value !== "function" || typeof key !== "string") return value;
      const step = `${label}.${key}`;
      return (...args: unknown[]) => {
        try {
          const result = value.apply(object, args);
          return result instanceof Promise
            ? result.catch((error: unknown) => {
                throw mark(error, step);
              })
            : result;
        } catch (error) {
          throw mark(error, step);
        }
      };
    },
  });
}

/**
 * Where and how a network's run failed, for logs: the labelled step, then
 * for up to four errors down the cause chain the error class name and any
 * numeric HTTP status or JSON-RPC code. It never copies an error message,
 * a URL or request data, which can hold a key or signed bytes.
 */
export function failureReason(error: unknown): string {
  const parts: string[] = [];
  let step = "unlabelled";
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") break;
    const item = current as {
      name?: unknown;
      status?: unknown;
      code?: unknown;
      cause?: unknown;
      [STEP]?: unknown;
    };
    if (typeof item[STEP] === "string" && step === "unlabelled")
      step = item[STEP];
    const name =
      typeof item.name === "string" && SAFE_NAME.test(item.name)
        ? item.name
        : "Error";
    const status = Number.isSafeInteger(item.status)
      ? `:status-${item.status}`
      : "";
    const code = Number.isSafeInteger(item.code) ? `:code-${item.code}` : "";
    parts.push(`${name}${status}${code}`);
    current = item.cause;
  }
  return [step, ...parts].join("/").slice(0, 240);
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
    | "no_resolver_key"
    /** Every deposit of the batch was parked; nothing was signed. */
    | "parked"
    /** The simulation reverted and no single deposit explains it. */
    | "reverted";
  /** Deposits parked in this run. */
  parked: number;
  /** Parked deposits returned to the queue in this run. */
  released: number;
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
      // can ever be income. The Worker never resolves another token's
      // deposit; if the resolver role is used by hand for one, the contract
      // event is recorded as it stands, so a token that emits nothing
      // cannot hold up the scan.
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
 *
 * An item no pull request has may be a report's. A report's deposit is
 * judged by `reportDepositCounts` and marks the report's row paid the same
 * way. A row that record-only mode wrote is not read here, so a deposit
 * that names one is an unknown item like any other.
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
    const report = item ? null : await store.reportByHash(deposit.item);
    if (report) {
      const verdict = reportDepositCounts(
        network.network,
        deposit,
        report,
        terms,
      );
      if (verdict.accepted) {
        const at = deps.now().toISOString();
        if (!(await store.markReportPaid(deposit, report, at))) continue;
        // No pull request: the row's repository and pull number stay null.
        await store.setJudgement(deposit, {
          accepted: 1,
          reason: null,
          item: null,
        });
        judged += 1;
        paid += 1;
        // The log names the deposit only, never the report.
        deps.log({
          event: "submission_fee_report_paid",
          network: network.network,
          depositId: deposit.depositId,
        });
        continue;
      }
      await store.setJudgement(deposit, {
        accepted: 0,
        reason: verdict.reason,
        item: null,
      });
      judged += 1;
      deps.log({
        event: "submission_fee_refused",
        network: network.network,
        depositId: deposit.depositId,
        reason: verdict.reason,
      });
      continue;
    }
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
 * Step 4: what is due for each finalized open deposit, from the pure rule
 * of the pull request or of the report it paid. Returns the entries to send,
 * oldest deposit first.
 */
export async function plan(deps: NetworkDependencies): Promise<SendEntry[]> {
  const { store, network } = deps;
  const entries: SendEntry[] = [];
  const parked = await store.parked(network.network);
  for (const { deposit, item, report } of await store.resolvable(
    network.network,
  )) {
    // A report's row is returned only for the deposit it names as paid.
    const action = report
      ? reportResolveAction(network.network, deposit, report, deps.terms)
      : submissionResolveAction(network.network, deposit, item, deps.terms);
    const state =
      action === "refund"
        ? "refund_due"
        : action === "keep"
          ? "kept_due"
          : "open";
    if (state !== deposit.state)
      await store.setDue(network.network, deposit.depositId, state);
    // A parked deposit keeps what is due on its row and stays out of the
    // batch until a later simulation shows its payout would go through.
    if (action !== null && !parked.has(deposit.depositId))
      entries.push({ id: deposit.depositId, refund: action === "refund" });
  }
  return entries.sort((left, right) => left.id - right.id);
}

/**
 * Simulates a few parked deposits again, the ones not looked at for a day,
 * and returns to the queue those whose payout would now go through (a token
 * unpaused, a payer taken off a blacklist) or that are no longer open on
 * chain (reclaimed by their payer). Signs nothing.
 */
export async function recheck(deps: NetworkDependencies): Promise<number> {
  const { store, chain, network } = deps;
  if (chain.address() === null) return 0;
  const before = new Date(
    deps.now().getTime() - PARKED_RECHECK_MS,
  ).toISOString();
  let released = 0;
  for (const entry of await store.parkedToCheck(
    network.network,
    before,
    PARKED_CHECKS_PER_RUN,
  )) {
    const open = (await chain.deposit(entry.id)).state === 1;
    const free = !open || (await chain.probe(entry)) === "ok";
    await store.checkedParked(
      network.network,
      entry.id,
      free,
      deps.now().toISOString(),
    );
    if (!free) continue;
    released += 1;
    deps.log({
      event: "submission_fee_unparked",
      network: network.network,
      depositId: entry.id,
      reason: open ? "payout_would_succeed" : "no_longer_open",
    });
  }
  return released;
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
 *
 * `resolveMany` is all or nothing, so one deposit whose payout the token
 * refuses would fail every batch it is in. When the simulation reverts, the
 * deposit the contract names is parked and the rest are simulated again. When
 * the revert names none, each deposit is simulated alone: those that fail
 * are parked as long as another goes through, so a fault of the whole
 * contract or key parks nothing.
 */
export async function send(
  deps: NetworkDependencies,
  planned: readonly SendEntry[],
): Promise<{ send: NetworkResult["send"]; parked: number }> {
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
  if (entries.length === 0) return { send: "none", parked: 0 };
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
      return { send: "unchanged", parked: 0 };
    await store.insertSend(row, network.gas);
    deps.log({
      event: "submission_fee_would_send",
      network: network.network,
      deposits: entries,
    });
    return { send: "recorded", parked: 0 };
  }
  const resolver = chain.address();
  if (resolver === null) return { send: "no_resolver_key", parked: 0 };
  let batch = entries;
  let parked = 0;
  let probed = false;
  const park = async (entry: SendEntry, reason: ParkReason) => {
    await store.park(network.network, entry, reason, deps.now().toISOString());
    parked += 1;
    deps.log({
      event: "submission_fee_parked",
      network: network.network,
      depositId: entry.id,
      refund: entry.refund,
      reason,
    });
  };
  const reverted = () => {
    deps.log({
      event: "submission_fee_send_reverted",
      network: network.network,
      deposits: batch,
    });
    return { send: "reverted" as const, parked };
  };
  let prepared: PreparedSend | null = null;
  // Every pass signs, stops, or sets at least one deposit aside, so the loop
  // ends within one batch's length.
  while (prepared === null) {
    if (batch.length === 0) return { send: "parked", parked };
    try {
      const signed = await chain.prepare(batch, (maximumNativeWei) =>
        store.assertGasBudget(
          network.network,
          maximumNativeWei,
          network.gas,
          deps.now(),
        ),
      );
      // Durable before broadcast. The insert repeats the day's limit and
      // holds the one-in-flight index, so a losing concurrent signer never
      // broadcasts its bytes.
      await store.insertSend(
        {
          ...row,
          deposits: batch,
          resolver,
          txId: signed.txId,
          rawTx: signed.rawTx,
          evmNonce: signed.evmNonce,
          maximumNativeWei: signed.maximumNativeWei,
          state: "submitted",
        },
        network.gas,
      );
      prepared = signed;
    } catch (error) {
      // Its bytes were never recorded, so they are never broadcast.
      if (error instanceof SendConflictError)
        return { send: "in_flight", parked };
      if (error instanceof GasBudgetError) {
        deps.log({
          event: "submission_fee_gas_budget",
          network: network.network,
        });
        return { send: "gas_budget", parked };
      }
      const failedId =
        error instanceof PayoutFailedError ? error.depositId : null;
      const named = batch.find((entry) => entry.id === failedId);
      if (named) {
        await park(named, "payout_failed");
        batch = batch.filter((entry) => entry !== named);
        continue;
      }
      if (
        !(error instanceof SendRevertedError) &&
        !(error instanceof PayoutFailedError)
      )
        throw error;
      if (probed) return reverted();
      probed = true;
      // The revert names no deposit of this batch: try each one alone.
      const alone: { entry: SendEntry; result: ProbeResult }[] = [];
      for (const entry of batch) {
        // Resolved or reclaimed since it was read: nothing to send or park.
        if ((await chain.deposit(entry.id)).state !== 1) continue;
        alone.push({ entry, result: await chain.probe(entry) });
      }
      const through = alone.filter(({ result }) => result === "ok");
      for (const { entry, result } of alone) {
        if (result === "payout_failed") await park(entry, "payout_failed");
        else if (result === "reverted" && through.length > 0)
          await park(entry, "reverted_alone");
      }
      // Nothing goes through alone either, and the contract blames no
      // deposit: the fault is not one deposit's, so none is parked for it.
      if (through.length === 0 && parked === 0) return reverted();
      batch = through.map(({ entry }) => entry);
    }
  }
  const sent = {
    network: network.network,
    txId: prepared.txId,
    deposits: batch,
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
    return { send: "in_flight", parked };
  }
  deps.log({ event: "submission_fee_send_submitted", ...sent });
  return { send: "sent", parked };
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
    parked: 0,
    released: 0,
  };
  // Authenticate the chain before reading or advancing anything.
  if ((await chain.chainId()) !== network.chainId) {
    result.status = "chain_mismatch";
    return result;
  }
  Object.assign(result, await scan(deps));
  Object.assign(result, await judge(deps));
  if (deps.mode === "live") result.released = await recheck(deps);
  const inFlight = deps.mode === "live" ? await reconcile(deps) : false;
  if (inFlight) {
    result.send = "in_flight";
    return result;
  }
  Object.assign(result, await send(deps, await plan(deps)));
  return result;
}
