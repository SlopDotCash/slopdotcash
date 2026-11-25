/**
 * What the submission-fee Worker does on the Solana ledger in one run (PRD
 * section 6, "Submission fee deposits", "Solana"; operator decision,
 * 25 November 2026). Solana has no event log to scan: an open deposit is an
 * account of the `slop-submission-deposits` program, and the program closes
 * that account when the deposit is settled. So step 1 differs from core.ts
 * and the rest is shared with it:
 *
 *   1. read the program's `Config` and every open deposit account at
 *      finalized commitment; record the open deposits numbered at or above
 *      the cursor, and for each recorded deposit whose account is gone or
 *      now holds another deposit, record how the first settlement on that
 *      address after its creation settled it;
 *   2. judge each new deposit and mark its pull request paid (`judge`);
 *   3. copy what each pull request's row says is due onto its deposit
 *      (`plan`);
 *   4. reconcile the one send in flight, then record and send the next
 *      (`reconcile`, `send`).
 *
 * A deposit is keyed by the id the program stored in its record, never by
 * the record's address: the address follows from the payer and a number the
 * payer picked, and the payer can use it again after a settlement.
 *
 * Everything is read at finalized commitment, so a pull request is marked
 * paid only by a finalized deposit; there is no earlier confirmed step. The
 * cursor row holds the next deposit id, not a block. A deposit of a mint
 * outside the table is recorded, refused and never resolved; its payer
 * reclaims it from the program. A refund whose payer has no usable
 * associated token account is parked, as a blacklisted payer is on the EVM
 * chains, and the Worker never creates a token account.
 */

import {
  type DepositedEvent,
  type FinalizedPage,
  judge,
  type NetworkDependencies,
  type NetworkResult,
  plan,
  recheck,
  reconcile,
  send,
} from "./core";
import type { SolanaFeeChain, SolanaLedgerConfig } from "./solana";
import type { D1SolanaFeeStore } from "./store";

/** Recorded open deposits compared with the chain in one run. */
export const SOLANA_OPEN_ROWS_PER_RUN = 500;
/** New deposits recorded in one run; each costs two more reads. */
export const SOLANA_RECORDED_PER_RUN = 50;
/** Settlements read in one run; each costs two more reads. */
export const SOLANA_SETTLEMENTS_PER_RUN = 20;

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
};

/** Step 1. */
export async function scanSolana(
  deps: SolanaDependencies,
): Promise<{
  finalizedThrough: number;
  recorded: number;
  resolved: number;
  resolver: string;
}> {
  const { store, chain, network } = deps;
  const snapshot = await chain.snapshot();
  const open = new Map(snapshot.open.map((entry) => [entry.account, entry]));

  // Recorded deposits whose record account is gone are settled.
  const known = await store.openSolanaDeposits(
    network.network,
    SOLANA_OPEN_ROWS_PER_RUN,
  );
  const resolutions: FinalizedPage["resolutions"] = [];
  for (const { deposit, account } of known) {
    chain.track(deposit.depositId, account);
    // Still open only while the address holds this very deposit. A payer
    // can use an address again once its deposit is settled, so a record
    // with another id there means this one is settled too.
    if (open.get(account)?.id === deposit.depositId) continue;
    if (resolutions.length >= SOLANA_SETTLEMENTS_PER_RUN) continue;
    const settled = await chain.settlement({ account, ...deposit });
    if (settled === null) {
      // The closing transaction is not readable yet; the next run retries.
      deps.log({
        event: "submission_fee_solana_settlement_unread",
        network: network.network,
        depositId: deposit.depositId,
      });
      continue;
    }
    resolutions.push({ depositId: deposit.depositId, ...settled });
  }

  // Open deposits numbered at or above the cursor are new.
  const cursor = (await store.cursor(network.network)) ?? 1;
  const fresh = snapshot.open
    .filter((entry) => entry.id >= cursor)
    .slice(0, SOLANA_RECORDED_PER_RUN);
  const truncated =
    snapshot.open.filter((entry) => entry.id >= cursor).length > fresh.length;
  // Every id up to `through` is now recorded or was settled before it was
  // seen. The snapshot is complete up to the Config's count; when the page
  // is cut short it is complete only up to the last deposit taken.
  const through = truncated
    ? Math.min(snapshot.depositCount, fresh[fresh.length - 1].id)
    : snapshot.depositCount;
  const deposits: (DepositedEvent & { blockTime: string })[] = [];
  const accounts = new Map<number, string>();
  for (const entry of fresh) {
    const created = await chain.created(entry.account, snapshot.openSlot);
    deposits.push({
      kind: "deposited",
      depositId: entry.id,
      item: entry.item,
      payer: entry.payer,
      token: entry.mint,
      amount: entry.amount,
      keptTo: entry.keptTo,
      txHash: created.signature,
      blockNumber: created.slot,
      // Solana rows are written only from finalized reads.
      blockHash: "",
      logIndex: 0,
      // The cluster clock the program itself recorded.
      blockTime: new Date(entry.depositedAt * 1000).toISOString(),
    });
    accounts.set(entry.id, entry.account);
    chain.track(entry.id, entry.account);
  }
  const unseen =
    Math.max(0, through - cursor + 1) -
    fresh.filter((entry) => entry.id <= through).length;
  if (unseen > 0)
    // Settled before the Worker ever recorded them (by hand, or after a long
    // stop). Nothing was asked of them and nothing is recorded.
    deps.log({
      event: "submission_fee_solana_settled_unseen",
      network: network.network,
      count: unseen,
    });
  if (deposits.length > 0 || resolutions.length > 0 || through >= cursor)
    await store.writeSolanaPage(
      {
        network: network.network,
        from: cursor,
        to: through,
        deposits,
        resolutions,
        finalizedAt: deps.now().toISOString(),
      },
      accounts,
    );
  return {
    finalizedThrough: Math.max(through, cursor - 1),
    recorded: deposits.length,
    resolved: resolutions.length,
    resolver: snapshot.resolver,
  };
}

/** The Solana ledger, one run. */
export async function runSolanaLedger(
  deps: SolanaDependencies,
): Promise<SolanaResult> {
  const { network, chain } = deps;
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
  };
  // Authenticate the cluster before reading or advancing anything.
  if ((await chain.genesisHash()) !== network.genesisHash) {
    result.status = "chain_mismatch";
    return result;
  }
  const { resolver, ...scanned } = await scanSolana(deps);
  Object.assign(result, scanned);
  Object.assign(result, await judge(deps));
  if (deps.mode === "live") result.released = await recheck(deps);
  if (deps.mode === "live" && (await reconcile(deps))) {
    result.send = "in_flight";
    return result;
  }
  const planned = await plan(deps);
  const address = chain.address();
  if (
    deps.mode === "live" &&
    planned.length > 0 &&
    address !== null &&
    address !== resolver
  ) {
    deps.log({
      event: "submission_fee_solana_resolver_differs",
      network: network.network,
    });
    result.send = "resolver_differs";
    return result;
  }
  Object.assign(result, await send(deps, planned));
  return result;
}
