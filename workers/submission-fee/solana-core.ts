/**
 * What the submission-fee Worker does on the Solana ledger in one run (PRD
 * section 6, "Submission fee deposits", "Solana"; operator decision,
 * 25 November 2026). Solana has no event log to scan: an open deposit is an
 * account of the `slop-submission-deposits` program, and the program closes
 * that account when the deposit is settled. So step 1 differs from core.ts
 * and the rest is shared with it:
 *
 *   1. list the open deposit records of the table's mint and fee wallet at
 *      finalized commitment; record those numbered at or above the cursor;
 *      for a recorded deposit whose record is gone, record how it was
 *      settled;
 *   2. judge each new deposit and mark its pull request paid (`judge`);
 *   3. copy what each pull request's row says is due onto its deposit
 *      (`plan`);
 *   4. record and send the next transaction (`send`).
 *
 * Before step 1 the one send in flight is reconciled (`reconcile`), so the
 * deposits of a send found finalized are settled from its own transaction
 * in the same run.
 *
 * A deposit is keyed by the id the program stored in its record, never by
 * the record's address: the address follows from the payer and a number the
 * payer picked, and the payer can use it again after a settlement.
 *
 * Anyone can deposit any mint and can name any address in a transaction, so
 * nothing here may depend on how many deposits exist or on how many
 * transactions name an address:
 *
 *   - the endpoint filters the listing to the table's mint and fee wallet
 *     and returns only each record's id, so a deposit of another mint or
 *     kept wallet is never fetched or recorded;
 *   - a recorded deposit the Worker never resolves (its amount is not the
 *     fee) leaves what is tracked and planned; its payer reclaims it;
 *   - a deposit is recorded from its record alone. The transaction that
 *     created it is looked for in one bounded read and is not needed;
 *   - a settlement the Worker sent itself is proven from that transaction.
 *     Any other is searched for between the slot the record was still open
 *     at and the slot it was seen gone at, a bounded number of reads in
 *     each run, continuing where the last run stopped;
 *   - every deposit is handled by itself: one that cannot be read, proven
 *     or sent is logged with a fixed reason, set aside and tried again
 *     later, and every step runs even when an earlier one failed.
 *
 * Everything recorded is read at finalized commitment, so a pull request is
 * marked paid only by a finalized deposit; there is no earlier confirmed
 * step. The cursor row holds the next deposit id, not a block. A refund
 * whose payer has no usable associated token account is parked, as a
 * blacklisted payer is on the EVM chains, and the Worker never creates a
 * token account.
 *
 * A resolve transaction of several deposits is all or nothing, and a payer
 * can close their token account between the simulation and the block. So
 * (operator decision, 26 November 2026):
 *
 *   - right before signing, the destinations and the simulation are read
 *     at confirmed commitment, not finalized, which leaves about a second
 *     instead of about thirteen for such a change;
 *   - a deposit that was in a send which landed and failed is from then on
 *     sent in a transaction of its own, so it cannot fail another's;
 *   - a deposit whose own single send landed and failed is parked, looked
 *     at again a day later like every parked deposit, and from then on sent
 *     after every other deposit, and only while less than half of the day's
 *     lamports is spent.
 */

import { submissionFeeSameAddress } from "../../src/lib/submission-fee.mjs";
import {
  type DepositedEvent,
  failureReason,
  judge,
  type NetworkDependencies,
  type NetworkResult,
  plan,
  recheck,
  reconcile,
  type SendEntry,
  send,
} from "./core";
import {
  SOLANA_LANDED_FAILED,
  SOLANA_MAX_BATCH,
  SOLANA_RECORDS_PER_READ,
  type SolanaFeeChain,
  type SolanaLedgerConfig,
  type SolanaListing,
  type SolanaSearchBudget,
} from "./solana";
import type { D1SolanaFeeStore, TrackedSolanaDeposit } from "./store";

/**
 * The most requests each part of a run makes to the Solana endpoint. They
 * add up to 230; `SOLANA_REQUESTS_PER_RUN` (300) is enforced by the client
 * itself, which refuses the request after the last.
 *
 *   authenticate the cluster                                    1
 *   list: Config, open records                                  2
 *   record: the records (up to 100 in one read), then for up
 *     to 25 new deposits one page of signatures and up to
 *     two transactions (25 x 3)                              1 + 75
 *   settlements the Worker sent (one transaction each)         20
 *   other settlements: pages of signatures and transactions  6 + 20
 *   the Config again, only when the listing failed              1
 *   parked deposits looked at again (5 x 5)                    25
 *   the send in flight: epoch, status, rebroadcast              3
 *   before a send: one record read for each candidate          15
 *   the send: per deposit one read; each attempt to build a
 *     transaction two reads, blockhash, simulation, fee
 *     (up to six attempts and five single simulations),
 *     broadcast                                      5 + 30 + 25 + 1
 */
export const SOLANA_STEP_REQUESTS =
  1 + 2 + (1 + 75) + 20 + (6 + 20) + 1 + 25 + 3 + 15 + (5 + 30 + 25 + 1);
/** Recorded deposits compared with the listing in one run. */
export const SOLANA_TRACKED_PER_RUN = 5000;
/** New deposits recorded in one run: one read of their records. */
export const SOLANA_RECORDED_PER_RUN = SOLANA_RECORDS_PER_READ;
/**
 * New deposits whose creating transaction is looked for in one run. Only a
 * deposit that names a pull request or report Slop asked a fee for is
 * looked up, so deposits for nothing cannot use the allowance up.
 */
export const SOLANA_CREATIONS_PER_RUN = 25;
/** Settlements of the Worker's own sends recorded in one run. */
export const SOLANA_OWN_SETTLEMENTS_PER_RUN = 20;
/** Searches for other settlements opened, and continued, in one run. */
export const SOLANA_SEARCHES_OPENED_PER_RUN = 50;
export const SOLANA_SEARCHES_PER_RUN = 10;
/** Pages of signatures and transactions all searches of a run may read. */
export const SOLANA_SEARCH_PAGES_PER_RUN = 6;
export const SOLANA_SEARCH_READS_PER_RUN = 20;
/** Planned deposits looked at to fill one batch. */
export const SOLANA_VETTED_PER_RUN = SOLANA_MAX_BATCH * 3;
/** Open records above which the run says so in its log and result. */
export const SOLANA_OPEN_ALERT = 1000;

export interface SolanaDependencies
  extends NetworkDependencies<SolanaFeeChain> {
  network: SolanaLedgerConfig;
  store: D1SolanaFeeStore;
}

export type SolanaResult = Omit<NetworkResult, "send"> & {
  send:
    | NetworkResult["send"]
    /** The loaded key is not the program's resolver; nothing was signed. */
    | "resolver_differs";
  /** Open records of the table's mint and fee wallet in the listing. */
  open: number | null;
  /** Listed records passed over: settled or changed before they were read. */
  skipped: number;
  /** Gone deposits whose settlement is still being searched for. */
  searching: number;
  /** Requests made to the Solana endpoint. */
  requests: number;
  /** Steps that failed, each with a reason that holds no provider text. */
  steps?: Record<string, string>;
  /** Present when a step failed; the other steps still ran. */
  error?: string;
};

/** A fixed word for why one deposit was set aside; never provider text. */
function setAside(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  if (name === "SolanaFeeBudgetError") return "request_limit";
  if (name === "SolanaFeeRpcError") return "read_failed";
  return "proof_failed";
}

/** Step 1. */
export async function scanSolana(
  deps: SolanaDependencies,
  listing: SolanaListing,
): Promise<{
  finalizedThrough: number;
  recorded: number;
  resolved: number;
  skipped: number;
  searching: number;
}> {
  const { store, chain, network } = deps;
  const at = () => deps.now().toISOString();
  const cursor = (await store.cursor(network.network)) ?? 1;
  const gone = (row: TrackedSolanaDeposit) =>
    // Still open only while the address holds this very deposit. A payer
    // can use an address again once its deposit is settled, so a record
    // with another id there means this one is settled too.
    listing.open.get(row.account) !== row.depositId;
  const settle = async (
    row: TrackedSolanaDeposit,
    settled: {
      state: "refunded" | "kept" | "reclaimed";
      txHash: string;
      at: string;
    },
  ) => {
    // Each outcome is its own write, so one that fails takes no other with
    // it. The cursor stays where it is.
    await store.writeSolanaPage(
      {
        network: network.network,
        from: cursor,
        to: cursor - 1,
        deposits: [],
        resolutions: [{ depositId: row.depositId, ...settled }],
        finalizedAt: at(),
      },
      new Map(),
    );
    await store.saveSolanaSearch(
      network.network,
      row.depositId,
      { before: null, candidate: null, reason: null, done: true },
      at(),
    );
  };
  const aside = (depositId: number, step: string, error: unknown) =>
    deps.log({
      event: "submission_fee_solana_set_aside",
      network: network.network,
      depositId,
      step,
      reason: setAside(error),
    });
  let resolved = 0;
  const done = new Set<number>();

  // Settlements the Worker sent itself: proven from its own transaction.
  for (const row of await store.ownSolanaSettlements(
    network.network,
    SOLANA_OWN_SETTLEMENTS_PER_RUN,
  )) {
    if (!gone(row)) continue;
    try {
      const settled = await chain.settledBy(row.txId, row);
      // Not readable yet; the next run reads it again.
      if (settled === null) continue;
      await settle(row, settled);
      done.add(row.depositId);
      resolved += 1;
    } catch (error) {
      aside(row.depositId, "own_settlement", error);
    }
  }

  // Every other recorded deposit whose record is gone gets a search, opened
  // once, between the last slot it was known open at and this listing.
  const tracked = await store.trackedSolanaDeposits(
    network.network,
    SOLANA_TRACKED_PER_RUN,
  );
  const compared = (await store.comparedSlot(network.network)) ?? 0;
  const searched = await store.searchedSolana(network.network);
  let opened = 0;
  let unopened = false;
  for (const row of tracked) {
    chain.track(row.depositId, row.account);
    if (!gone(row) || done.has(row.depositId) || searched.has(row.depositId))
      continue;
    if (opened === SOLANA_SEARCHES_OPENED_PER_RUN) {
      unopened = true;
      continue;
    }
    await store.openSolanaSearch(
      network.network,
      row.depositId,
      Math.max(row.blockNumber, compared),
      listing.openSlot,
      at(),
    );
    opened += 1;
  }
  // Every tracked deposit was compared with this listing: one found gone
  // later was still open at its slot.
  if (tracked.length < SOLANA_TRACKED_PER_RUN && !unopened)
    await store.setComparedSlot(network.network, listing.openSlot, at());
  else
    deps.log({
      event: "submission_fee_solana_comparison_partial",
      network: network.network,
      tracked: tracked.length,
    });

  // A bounded step of each open search, the one waiting longest first.
  const budget: SolanaSearchBudget = {
    pages: SOLANA_SEARCH_PAGES_PER_RUN,
    reads: SOLANA_SEARCH_READS_PER_RUN,
  };
  const searches = await store.solanaSearches(
    network.network,
    SOLANA_SEARCHES_PER_RUN,
  );
  let searching = 0;
  for (const row of searches) {
    if (done.has(row.depositId)) continue;
    if (budget.pages <= 0) {
      searching += 1;
      continue;
    }
    try {
      const step = await chain.search(row, row, budget);
      if (step.done && step.settlement !== null) {
        await settle(row, step.settlement);
        resolved += 1;
        continue;
      }
      searching += 1;
      await store.saveSolanaSearch(
        network.network,
        row.depositId,
        step.done
          ? // Nothing between the two slots settles it. Start over later.
            { before: null, candidate: null, reason: "not_found" }
          : { before: step.before, candidate: step.candidate, reason: null },
        at(),
      );
      if (step.done) aside(row.depositId, "settlement", { name: "NotFound" });
    } catch (error) {
      searching += 1;
      aside(row.depositId, "settlement", error);
      await store.saveSolanaSearch(
        network.network,
        row.depositId,
        {
          before: row.before,
          candidate: row.candidate,
          reason: setAside(error),
        },
        at(),
      );
    }
  }

  // Open records numbered at or above the cursor are new.
  const listed = [...listing.open]
    .filter(([, id]) => id >= cursor)
    .sort((left, right) => left[1] - right[1]);
  const fresh = listed.slice(0, SOLANA_RECORDED_PER_RUN);
  // Every listed id up to `through` is now recorded, or was settled before
  // it could be. The listing holds every open record of the table's mint
  // and fee wallet; when the page is cut short only up to the last taken.
  const through =
    fresh.length < listed.length
      ? fresh[fresh.length - 1][1]
      : Math.max(listing.depositCount, ...fresh.map(([, id]) => id));
  const deposits: (DepositedEvent & { blockTime: string })[] = [];
  const accounts = new Map<number, string>();
  let skipped = 0;
  let lookups = 0;
  if (fresh.length > 0) {
    const read = await chain.records(
      fresh.map(([account]) => account),
      listing.openSlot,
    );
    for (const [account, id] of fresh) {
      const record = read.records.get(account) ?? null;
      // Settled, or the address used again, between the listing and this
      // read; or not a record of the table's mint and fee wallet after all.
      if (
        record === null ||
        record.id !== id ||
        !submissionFeeSameAddress(network.network, record.mint, network.mint) ||
        !submissionFeeSameAddress(
          network.network,
          record.keptTo,
          network.feeWallet,
        )
      ) {
        skipped += 1;
        continue;
      }
      let created: { signature: string; slot: number } | null = null;
      if (
        lookups < SOLANA_CREATIONS_PER_RUN &&
        ((await store.itemByHash(record.item)) !== null ||
          (await store.reportByHash(record.item)) !== null)
      ) {
        lookups += 1;
        try {
          created = await chain.creation(account, record);
        } catch {
          // The deposit is recorded from its record either way.
          created = null;
        }
      }
      deposits.push({
        kind: "deposited",
        depositId: id,
        item: record.item,
        payer: record.payer,
        token: record.mint,
        amount: record.amount,
        keptTo: record.keptTo,
        // The creating transaction when the one read found it, and
        // otherwise the record's own address.
        txHash: created?.signature ?? account,
        // The finalized slot the record was read open at.
        blockNumber: read.slot,
        // Solana rows are written only from finalized reads.
        blockHash: "",
        logIndex: 0,
        // The cluster clock the program itself recorded.
        blockTime: new Date(record.depositedAt * 1000).toISOString(),
      });
      accounts.set(id, account);
      chain.track(id, account);
    }
  }
  if (skipped > 0)
    deps.log({
      event: "submission_fee_solana_skipped",
      network: network.network,
      count: skipped,
    });
  if (deposits.length > 0 || through >= cursor)
    await store.writeSolanaPage(
      {
        network: network.network,
        from: cursor,
        to: through,
        deposits,
        resolutions: [],
        finalizedAt: at(),
      },
      accounts,
    );
  return {
    finalizedThrough: Math.max(through, cursor - 1),
    recorded: deposits.length,
    resolved,
    skipped,
    searching,
  };
}

/**
 * The send in flight. A send of one deposit that landed and failed parks
 * that deposit before the send is marked failed: its payout cannot go
 * through by itself. A failed send of several deposits parks none; `vet`
 * sends each of them alone from then on.
 */
async function reconcileSolana(
  deps: SolanaDependencies,
): Promise<{ inFlight: boolean; parked: number }> {
  const { store, network } = deps;
  let parked = 0;
  const inFlight = await reconcile(deps, async (sent, reason) => {
    if (reason !== SOLANA_LANDED_FAILED || sent.deposits.length !== 1) return;
    const [entry] = sent.deposits;
    await store.park(
      network.network,
      entry,
      "reverted_alone",
      deps.now().toISOString(),
    );
    parked += 1;
    deps.log({
      event: "submission_fee_parked",
      network: network.network,
      depositId: entry.id,
      refund: entry.refund,
      reason: "reverted_alone",
    });
  });
  return { inFlight, parked };
}

/**
 * The planned deposits a send may carry: accepted deposits first, then the
 * rest, each compared by itself with its record on chain. One that cannot
 * be read is left for the next run; one whose record differs from its row
 * is parked. Neither stops another.
 *
 * A deposit that was in a send which landed and failed goes alone: when it
 * is the first in line it is the whole send, and otherwise it waits for a
 * later run. A deposit whose own single send failed goes after every other.
 */
async function vet(
  deps: SolanaDependencies,
  planned: readonly SendEntry[],
): Promise<{ entries: SendEntry[]; parked: number }> {
  const { store, chain, network } = deps;
  const first = await store.acceptedSolanaDue(
    network.network,
    SOLANA_VETTED_PER_RUN,
  );
  // A refund of a deposit that paid for nothing is a courtesy. Once half of
  // the day's network fees is spent, the rest is kept for deposits that
  // paid a pull request, so deposits for nothing cannot use the day up.
  const courtesy =
    deps.mode !== "live" ||
    (await store.solanaSpentToday(network.network, deps.now())) * 2n <
      BigInt(network.gas.perDayWei);
  if (!courtesy && planned.some((entry) => !first.has(entry.id)))
    deps.log({
      event: "submission_fee_solana_courtesy_refunds_wait",
      network: network.network,
    });
  const failed = await store.solanaFailedOnChain(network.network);
  // A deposit whose own send failed on chain costs a network fee each time
  // it fails again. Like a courtesy refund it waits once half of the day's
  // fees is spent, so the rest of the day is kept for the other deposits.
  if (!courtesy && planned.some((entry) => failed.alone.has(entry.id)))
    deps.log({
      event: "submission_fee_solana_failed_alone_waits",
      network: network.network,
    });
  const rest = planned.filter((entry) => !failed.alone.has(entry.id));
  const ordered = [
    ...rest.filter((entry) => first.has(entry.id)),
    ...(courtesy
      ? [
          ...rest.filter((entry) => !first.has(entry.id)),
          ...planned.filter((entry) => failed.alone.has(entry.id)),
        ]
      : []),
  ].slice(0, SOLANA_VETTED_PER_RUN);
  const entries: SendEntry[] = [];
  let parked = 0;
  for (const entry of ordered) {
    if (entries.length === SOLANA_MAX_BATCH) break;
    const alone = failed.together.has(entry.id);
    // Never beside another deposit: it waits for a run it is first in.
    if (alone && entries.length > 0) continue;
    try {
      const row = await store.deposit(network.network, entry.id);
      if (!row) throw new Error("A planned deposit has no row");
      const onChain = await chain.deposit(entry.id);
      // Its record is gone: settled, and its outcome is on its way.
      if (onChain.closed === true) continue;
      if (
        onChain.payer !== row.payer ||
        onChain.token !== row.token ||
        onChain.amount !== row.amount ||
        onChain.keptTo !== row.keptTo ||
        onChain.item.toLowerCase() !== row.item.toLowerCase()
      ) {
        if (deps.mode === "live") {
          await store.park(
            network.network,
            entry,
            "reverted_alone",
            deps.now().toISOString(),
          );
          parked += 1;
        }
        deps.log({
          event: "submission_fee_solana_set_aside",
          network: network.network,
          depositId: entry.id,
          step: "send",
          reason: "record_differs",
        });
        continue;
      }
      entries.push(entry);
      if (alone) break;
    } catch (error) {
      deps.log({
        event: "submission_fee_solana_set_aside",
        network: network.network,
        depositId: entry.id,
        step: "send",
        reason: setAside(error),
      });
    }
  }
  return { entries, parked };
}

/** The Solana ledger, one run. */
export async function runSolanaLedger(
  deps: SolanaDependencies,
): Promise<SolanaResult> {
  const { network, chain, store } = deps;
  const result: SolanaResult = {
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
    open: null,
    skipped: 0,
    searching: 0,
    requests: 0,
  };
  // A planned or in-flight deposit's record address is always found,
  // however many other deposits are recorded.
  chain.locate((depositId) => store.solanaAccount(network.network, depositId));
  // Authenticate the cluster before reading or advancing anything.
  if ((await chain.genesisHash()) !== network.genesisHash) {
    result.status = "chain_mismatch";
    return result;
  }
  const failed: Record<string, string> = {};
  // Every step runs by itself: one that fails is named in the result and
  // the log, and the steps after it still run.
  const step = async <T>(name: string, work: () => Promise<T>) => {
    try {
      return await work();
    } catch (error) {
      failed[name] = failureReason(error);
      deps.log({
        event: "submission_fee_solana_step_failed",
        network: network.network,
        step: name,
        reason: failed[name],
      });
      return null;
    }
  };
  const finish = () => {
    result.requests = chain.requests();
    if (Object.keys(failed).length > 0) {
      result.steps = failed;
      result.error = "submission_fee_operation_failed";
    }
    return result;
  };

  // The send in flight first: a send found finalized here has its deposits'
  // outcomes recorded from its own transaction by the scan below. A send
  // whose state could not be read counts as still in flight.
  const reconciled =
    deps.mode === "live"
      ? await step("reconcile", () => reconcileSolana(deps))
      : { inFlight: false, parked: 0 };
  const inFlight = reconciled === null || reconciled.inFlight;
  // A deposit parked because its own send failed on chain.
  result.parked = reconciled?.parked ?? 0;
  const listing = await step("list", () => chain.listing());
  if (listing !== null) {
    result.open = listing.open.size;
    if (listing.open.size >= SOLANA_OPEN_ALERT)
      deps.log({
        event: "submission_fee_solana_open_high",
        network: network.network,
        open: listing.open.size,
      });
    Object.assign(
      result,
      (await step("scan", () => scanSolana(deps, listing))) ?? {},
    );
  }
  Object.assign(result, (await step("judge", () => judge(deps))) ?? {});
  if (deps.mode === "live")
    result.released = (await step("recheck", () => recheck(deps))) ?? 0;
  if (inFlight) {
    result.send = "in_flight";
    return finish();
  }
  const planned = await step("plan", () => plan(deps));
  if (planned === null || planned.length === 0) return finish();
  const address = chain.address();
  if (deps.mode === "live" && address !== null) {
    // The program's resolver, from the listing or, when that failed, from
    // the Config alone.
    const resolver =
      listing?.resolver ??
      (await step("config", async () => (await chain.config()).resolver));
    if (resolver === null) return finish();
    if (address !== resolver) {
      deps.log({
        event: "submission_fee_solana_resolver_differs",
        network: network.network,
      });
      result.send = "resolver_differs";
      return finish();
    }
  }
  const vetted = await step("vet", () => vet(deps, planned));
  if (vetted === null) return finish();
  const sent = await step("send", () => send(deps, vetted.entries));
  if (sent !== null) {
    result.send = sent.send;
    result.parked += sent.parked;
  }
  result.parked += vetted.parked;
  return finish();
}
