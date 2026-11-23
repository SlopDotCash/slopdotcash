/**
 * D1 reads and writes of the submission-fee Worker (migrations 0139 and
 * 0140, and `submission_fee_items` from migration 0141, which Slopbot owns).
 * Amounts are decimal text and are never summed in SQL, except the native
 * gas reserve, which the configuration bounds to exact JavaScript integers.
 *
 * A deposit can also pay a private security report. Its row is in
 * `security_report_deposits` (migration 0145, which the backend owns). The
 * Worker writes only `paid_at`, `paid_network`, `paid_deposit_id` there, and
 * the final `refunded` or `kept` with its time. Where that table does not
 * exist yet, every statement here is the one it was before report deposits.
 * A report's deposit keeps `repository_id` and `pull_number` null.
 */

import { isConstraintFailure } from "../../backend/d1";
import type { SubmissionFeeRate } from "../../src/lib/submission-fee.mjs";
import type { GasLimits } from "./config";
import {
  type DepositedEvent,
  type DepositRow,
  type FeeStore,
  type FinalizedPage,
  GasBudgetError,
  type ItemRow,
  type ParkReason,
  type ReportRow,
  SendConflictError,
  type SendEntry,
  type SendRow,
  type SendState,
} from "./core";

type D1Value = string | number | null;
interface D1Statement {
  bind(...values: D1Value[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface SubmissionFeeD1Database {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

const DEPOSIT = `d.network, d.deposit_id, d.item, d.repository_id, d.pull_number,
  d.payer, d.token, d.amount, d.kept_to, d.tx_hash, d.block_number,
  d.block_time, d.finalized_at, d.accepted, d.reject_reason, d.state`;
const ITEM = `i.repository_id AS item_repository_id, i.pull_number AS item_pull_number,
  i.item AS item_item, i.stable_minor, i.paid_network, i.paid_deposit_id, i.outcome`;
const REPORT = `r.case_id AS report_case_id, r.item AS report_item,
  r.slop_amount AS report_slop_amount, r.paid_network AS report_paid_network,
  r.paid_deposit_id AS report_paid_deposit_id, r.outcome AS report_outcome`;

type DepositRecord = {
  network: string;
  deposit_id: number;
  item: string;
  repository_id: number | null;
  pull_number: number | null;
  payer: string;
  token: string;
  amount: string;
  kept_to: string;
  tx_hash: string;
  block_number: number;
  block_time: string;
  finalized_at: string | null;
  accepted: number | null;
  reject_reason: string | null;
  state: string;
};
type ItemRecord = {
  item_repository_id: number | null;
  item_pull_number: number | null;
  item_item: string | null;
  stable_minor: string | null;
  paid_network: string | null;
  paid_deposit_id: number | null;
  outcome: string | null;
};

const depositOf = (row: DepositRecord): DepositRow => ({
  network: row.network,
  depositId: row.deposit_id,
  item: row.item,
  repositoryId: row.repository_id,
  pullNumber: row.pull_number,
  payer: row.payer,
  token: row.token,
  amount: row.amount,
  keptTo: row.kept_to,
  txHash: row.tx_hash,
  blockNumber: row.block_number,
  blockTime: row.block_time,
  finalizedAt: row.finalized_at,
  accepted: row.accepted,
  rejectReason: row.reject_reason,
  state: row.state,
});
const itemOf = (row: ItemRecord): ItemRow | null =>
  row.item_repository_id === null ||
  row.item_pull_number === null ||
  row.item_item === null ||
  row.stable_minor === null
    ? null
    : {
        repositoryId: row.item_repository_id,
        pullNumber: row.item_pull_number,
        item: row.item_item,
        stableMinor: row.stable_minor,
        paidNetwork: row.paid_network,
        paidDepositId: row.paid_deposit_id,
        outcome: row.outcome,
      };

type ReportRecord = {
  report_case_id: string | null;
  report_item: string | null;
  report_slop_amount: string | null;
  report_paid_network: string | null;
  report_paid_deposit_id: number | null;
  report_outcome: string | null;
};
const reportOf = (row: Partial<ReportRecord>): ReportRow | null =>
  typeof row.report_case_id !== "string" ||
  typeof row.report_item !== "string" ||
  typeof row.report_slop_amount !== "string"
    ? null
    : {
        caseId: row.report_case_id,
        item: row.report_item,
        slopAmount: row.report_slop_amount,
        paidNetwork: row.report_paid_network ?? null,
        paidDepositId: row.report_paid_deposit_id ?? null,
        outcome: row.report_outcome ?? null,
      };

type SendRecord = {
  id: string;
  network: string;
  mode: "dry_run" | "live";
  contract: string;
  deposits: string;
  resolver: string | null;
  tx_id: string | null;
  raw_tx: string | null;
  evm_nonce: number | null;
  maximum_native_wei: string | null;
  state: SendState;
  reason: string | null;
  block_number: number | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
};
function entriesOf(text: string): SendEntry[] {
  const value = JSON.parse(text) as unknown;
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) =>
        entry &&
        Number.isSafeInteger(entry.id) &&
        entry.id > 0 &&
        typeof entry.refund === "boolean" &&
        Object.keys(entry).length === 2,
    )
  )
    throw new Error("A recorded send has an invalid deposit list");
  return value as SendEntry[];
}
const sendOf = (row: SendRecord): SendRow => ({
  id: row.id,
  network: row.network,
  mode: row.mode,
  contract: row.contract,
  deposits: entriesOf(row.deposits),
  resolver: row.resolver,
  txId: row.tx_id,
  rawTx: row.raw_tx,
  evmNonce: row.evm_nonce,
  maximumNativeWei: row.maximum_native_wei,
  state: row.state,
  reason: row.reason,
  blockNumber: row.block_number,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  finalizedAt: row.finalized_at,
});

/** A stored deposit equals the event being written. */
const SAME = `submission_fee_deposits.item = excluded.item
  AND submission_fee_deposits.payer = excluded.payer
  AND submission_fee_deposits.token = excluded.token
  AND submission_fee_deposits.amount = excluded.amount
  AND submission_fee_deposits.kept_to = excluded.kept_to
  AND submission_fee_deposits.tx_hash = excluded.tx_hash
  AND submission_fee_deposits.block_number = excluded.block_number
  AND submission_fee_deposits.block_time = excluded.block_time`;
const UPSERT = `INSERT INTO submission_fee_deposits
    (network, deposit_id, item, payer, token, amount, kept_to, tx_hash,
     block_number, block_time, finalized_at, state)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
  ON CONFLICT(network, deposit_id) DO UPDATE SET
    accepted = CASE WHEN ${SAME} THEN submission_fee_deposits.accepted END,
    reject_reason = CASE WHEN ${SAME} THEN submission_fee_deposits.reject_reason END,
    repository_id = CASE WHEN ${SAME} THEN submission_fee_deposits.repository_id END,
    pull_number = CASE WHEN ${SAME} THEN submission_fee_deposits.pull_number END,
    item = excluded.item, payer = excluded.payer, token = excluded.token,
    amount = excluded.amount, kept_to = excluded.kept_to,
    tx_hash = excluded.tx_hash, block_number = excluded.block_number,
    block_time = excluded.block_time, finalized_at = excluded.finalized_at
  WHERE submission_fee_deposits.finalized_at IS NULL`;
/**
 * The pull request stops being paid by an unfinalized deposit that the chain
 * now reports with other contents. Bound: network, deposit id, then the
 * event's eight fields.
 */
const unpayChanged = (table: string) => `UPDATE ${table}
     SET paid_at = NULL, paid_network = NULL, paid_deposit_id = NULL
   WHERE paid_network = ?1 AND paid_deposit_id = ?2 AND outcome IS NULL
     AND EXISTS (SELECT 1 FROM submission_fee_deposits d
                  WHERE d.network = ?1 AND d.deposit_id = ?2 AND d.finalized_at IS NULL
                    AND NOT (d.item = ?3 AND d.payer = ?4 AND d.token = ?5
                             AND d.amount = ?6 AND d.kept_to = ?7 AND d.tx_hash = ?8
                             AND d.block_number = ?9 AND d.block_time = ?10))`;
const UNPAY_CHANGED = unpayChanged("submission_fee_items");
/** The same for a report: it waits for a deposit again. */
const UNPAY_CHANGED_REPORT = unpayChanged("security_report_deposits");

const utcDay = (now: Date) => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
const SPENT_TODAY = `(SELECT COALESCE(SUM(CAST(maximum_native_wei AS INTEGER)), 0)
    FROM submission_fee_sends WHERE network = ? AND mode = 'live' AND created_at >= ?)`;

function assertPerTransaction(maximumNativeWei: string, limits: GasLimits) {
  if (
    !/^[1-9][0-9]*$/u.test(maximumNativeWei) ||
    BigInt(maximumNativeWei) > BigInt(limits.perTransactionWei)
  )
    throw new GasBudgetError(
      "The transaction exceeds the native fee limit; nothing was signed",
    );
}

export class D1FeeStore implements FeeStore {
  private reportsTable: Promise<boolean> | null = null;

  constructor(private readonly db: SubmissionFeeD1Database) {}

  /**
   * Whether `security_report_deposits` exists, read once for this store. A
   * store lives for one run, so a table created later is seen by the next.
   */
  private hasReports() {
    this.reportsTable ??= this.db
      .prepare(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'security_report_deposits'",
      )
      .first<{ found: number }>()
      .then(
        (row) => row?.found === 1,
        (error) => {
          this.reportsTable = null;
          throw error;
        },
      );
    return this.reportsTable;
  }

  async hasItems() {
    const row = await this.db
      .prepare(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'submission_fee_items'",
      )
      .first<{ found: number }>();
    return row?.found === 1;
  }

  async cursor(network: string) {
    const row = await this.db
      .prepare(
        "SELECT next_block FROM submission_fee_cursors WHERE network = ?",
      )
      .bind(network)
      .first<{ next_block: number }>();
    return row ? row.next_block : null;
  }

  async deposit(network: string, depositId: number) {
    const row = await this.db
      .prepare(
        `SELECT ${DEPOSIT} FROM submission_fee_deposits d WHERE d.network = ? AND d.deposit_id = ?`,
      )
      .bind(network, depositId)
      .first<DepositRecord>();
    return row ? depositOf(row) : null;
  }

  private depositStatements(
    network: string,
    deposit: DepositedEvent & { blockTime: string },
    finalizedAt: string | null,
    reports: boolean,
  ): D1Statement[] {
    const fields: D1Value[] = [
      deposit.item,
      deposit.payer,
      deposit.token,
      deposit.amount,
      deposit.keptTo,
      deposit.txHash,
      deposit.blockNumber,
      deposit.blockTime,
    ];
    return [
      this.db
        .prepare(UNPAY_CHANGED)
        .bind(network, deposit.depositId, ...fields),
      ...(reports
        ? [
            this.db
              .prepare(UNPAY_CHANGED_REPORT)
              .bind(network, deposit.depositId, ...fields),
          ]
        : []),
      this.db
        .prepare(finalizedAt === null ? `${UPSERT} AND NOT (${SAME})` : UPSERT)
        .bind(network, deposit.depositId, ...fields, finalizedAt),
    ];
  }

  async writeFinalizedPage(page: FinalizedPage) {
    const reports = await this.hasReports();
    const statements: D1Statement[] = [];
    for (const deposit of page.deposits)
      statements.push(
        ...this.depositStatements(
          page.network,
          deposit,
          page.finalizedAt,
          reports,
        ),
      );
    for (const resolution of page.resolutions) {
      statements.push(
        this.db
          .prepare(
            `UPDATE submission_fee_deposits SET state = ?, resolve_tx = ?, resolved_at = ?
              WHERE network = ? AND deposit_id = ? AND finalized_at IS NOT NULL
                AND state IN ('open', 'refund_due', 'kept_due')`,
          )
          .bind(
            resolution.state,
            resolution.txHash,
            resolution.at,
            page.network,
            resolution.depositId,
          ),
        // A reclaim returns the fee to its payer, as a refund does.
        this.db
          .prepare(
            `UPDATE submission_fee_items SET outcome = ?, outcome_at = ?
              WHERE paid_network = ? AND paid_deposit_id = ?
                AND (outcome IS NULL OR outcome IN ('refund_due', 'kept_due'))`,
          )
          .bind(
            resolution.state === "kept" ? "kept" : "refunded",
            resolution.at,
            page.network,
            resolution.depositId,
          ),
      );
      // The report this deposit paid gets the same final outcome and time.
      // The backend's `outcome_reason` stays as it is.
      if (reports)
        statements.push(
          this.db
            .prepare(
              `UPDATE security_report_deposits SET outcome = ?, outcome_at = ?
                WHERE paid_network = ? AND paid_deposit_id = ?
                  AND (outcome IS NULL OR outcome IN ('refund_due', 'kept_due'))`,
            )
            .bind(
              resolution.state === "kept" ? "kept" : "refunded",
              resolution.at,
              page.network,
              resolution.depositId,
            ),
        );
    }
    // What is still unfinalized at or below this page was reorganised away.
    for (const table of reports
      ? ["submission_fee_items", "security_report_deposits"]
      : ["submission_fee_items"])
      statements.push(
        this.db
          .prepare(
            `UPDATE ${table}
                SET paid_at = NULL, paid_network = NULL, paid_deposit_id = NULL
              WHERE paid_network = ?1 AND outcome IS NULL
                AND paid_deposit_id IN (SELECT deposit_id FROM submission_fee_deposits
                   WHERE network = ?1 AND finalized_at IS NULL AND block_number <= ?2)`,
          )
          .bind(page.network, page.to),
      );
    statements.push(
      this.db
        .prepare(
          "DELETE FROM submission_fee_deposits WHERE network = ? AND finalized_at IS NULL AND block_number <= ?",
        )
        .bind(page.network, page.to),
      // The cursor never moves back, so an older overlapping run cannot rewind it.
      this.db
        .prepare(
          `INSERT INTO submission_fee_cursors (network, next_block) VALUES (?, ?)
           ON CONFLICT(network) DO UPDATE SET next_block = excluded.next_block
           WHERE excluded.next_block > submission_fee_cursors.next_block`,
        )
        .bind(page.network, page.to + 1),
    );
    await this.db.batch(statements);
  }

  async writeConfirmed(
    network: string,
    range: { from: number; to: number; complete: boolean },
    deposits: (DepositedEvent & { blockTime: string })[],
  ) {
    const reports = await this.hasReports();
    const statements: D1Statement[] = [];
    for (const deposit of deposits)
      statements.push(
        ...this.depositStatements(network, deposit, null, reports),
      );
    if (range.complete) {
      const seen = JSON.stringify(deposits.map((deposit) => deposit.depositId));
      const gone = `network = ?1 AND finalized_at IS NULL AND block_number BETWEEN ?2 AND ?3
        AND deposit_id NOT IN (SELECT value FROM json_each(?4))`;
      for (const table of reports
        ? ["submission_fee_items", "security_report_deposits"]
        : ["submission_fee_items"])
        statements.push(
          this.db
            .prepare(
              `UPDATE ${table}
                  SET paid_at = NULL, paid_network = NULL, paid_deposit_id = NULL
                WHERE paid_network = ?1 AND outcome IS NULL
                  AND paid_deposit_id IN (SELECT deposit_id FROM submission_fee_deposits WHERE ${gone})`,
            )
            .bind(network, range.from, range.to, seen),
        );
      statements.push(
        this.db
          .prepare(`DELETE FROM submission_fee_deposits WHERE ${gone}`)
          .bind(network, range.from, range.to, seen),
      );
    }
    if (statements.length > 0) await this.db.batch(statements);
  }

  async unjudged(network: string, limit: number) {
    // Deposits whose pull request or report is known come first, so
    // deposits for unknown items cannot hold them back.
    const known = (await this.hasReports())
      ? `EXISTS (SELECT 1 FROM submission_fee_items i WHERE i.item = d.item)
           OR EXISTS (SELECT 1 FROM security_report_deposits r
                       WHERE r.item = d.item AND r.mode = 'asked')`
      : "EXISTS (SELECT 1 FROM submission_fee_items i WHERE i.item = d.item)";
    const { results } = await this.db
      .prepare(
        `SELECT ${DEPOSIT} FROM submission_fee_deposits d
          WHERE d.network = ? AND d.accepted IS NULL
          ORDER BY (${known}) DESC, d.deposit_id
          LIMIT ?`,
      )
      .bind(network, limit)
      .all<DepositRecord>();
    return results.map(depositOf);
  }

  async itemByHash(item: string) {
    const row = await this.db
      .prepare(
        `SELECT ${ITEM} FROM submission_fee_items i WHERE i.item = ? ORDER BY i.repository_id, i.pull_number LIMIT 1`,
      )
      .bind(item)
      .first<ItemRecord>();
    return row ? itemOf(row) : null;
  }

  async reportByHash(item: string) {
    if (!(await this.hasReports())) return null;
    // `item` is unique in the table. A row record-only mode wrote asks for
    // nothing, so it is not a report a deposit can pay.
    const row = await this.db
      .prepare(
        `SELECT ${REPORT} FROM security_report_deposits r WHERE r.item = ? AND r.mode = 'asked'`,
      )
      .bind(item)
      .first<ReportRecord>();
    return row ? reportOf(row) : null;
  }

  async rates(): Promise<SubmissionFeeRate[]> {
    const { results } = await this.db
      .prepare(
        "SELECT effective_at, slop_per_usd FROM submission_fee_rates ORDER BY effective_at",
      )
      .all<{ effective_at: string; slop_per_usd: string }>();
    return results.map((row) => ({
      effectiveAt: row.effective_at,
      slopPerUsd: row.slop_per_usd,
    }));
  }

  async markPaid(deposit: DepositRow, item: ItemRow, at: string) {
    const result = await this.db
      .prepare(
        `UPDATE submission_fee_items
            SET paid_at = COALESCE(paid_at, ?), paid_network = ?, paid_deposit_id = ?
          WHERE repository_id = ? AND pull_number = ?
            AND ((paid_deposit_id IS NULL AND outcome IS NULL)
                 OR (paid_network = ? AND paid_deposit_id = ?))`,
      )
      .bind(
        at,
        deposit.network,
        deposit.depositId,
        item.repositoryId,
        item.pullNumber,
        deposit.network,
        deposit.depositId,
      )
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async markReportPaid(deposit: DepositRow, report: ReportRow, at: string) {
    const result = await this.db
      .prepare(
        `UPDATE security_report_deposits
            SET paid_at = COALESCE(paid_at, ?), paid_network = ?, paid_deposit_id = ?
          WHERE case_id = ? AND mode = 'asked'
            AND ((paid_deposit_id IS NULL AND outcome IS NULL)
                 OR (paid_network = ? AND paid_deposit_id = ?))`,
      )
      .bind(
        at,
        deposit.network,
        deposit.depositId,
        report.caseId,
        deposit.network,
        deposit.depositId,
      )
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async setJudgement(
    deposit: DepositRow,
    judgement: { accepted: 0 | 1; reason: string | null; item: ItemRow | null },
  ) {
    // Bound to the judged contents, so a deposit replaced meanwhile by the
    // chain's later report keeps no judgement of the earlier one.
    await this.db
      .prepare(
        `UPDATE submission_fee_deposits
            SET accepted = ?, reject_reason = ?, repository_id = ?, pull_number = ?
          WHERE network = ? AND deposit_id = ? AND accepted IS NULL AND tx_hash = ?`,
      )
      .bind(
        judgement.accepted,
        judgement.reason,
        judgement.item?.repositoryId ?? null,
        judgement.item?.pullNumber ?? null,
        deposit.network,
        deposit.depositId,
        deposit.txHash,
      )
      .run();
  }

  // A deposit of a token outside the table is never resolved, so it is not
  // read again every run.
  //
  // A report's row is joined only to the deposit it names as the one that
  // paid, and only while it is an asked row.
  async resolvable(network: string) {
    const reports = await this.hasReports();
    const columns = reports
      ? `${DEPOSIT}, ${ITEM}, ${REPORT}`
      : `${DEPOSIT}, ${ITEM}`;
    const reportJoin = reports
      ? `LEFT JOIN security_report_deposits r
             ON r.paid_network = d.network AND r.paid_deposit_id = d.deposit_id
            AND r.item = d.item AND r.mode = 'asked'`
      : "";
    const reportDue = reports
      ? "OR r.outcome IN ('refund_due', 'kept_due')"
      : "";
    const { results } = await this.db
      .prepare(
        `SELECT ${columns} FROM submission_fee_deposits d
           LEFT JOIN submission_fee_items i
             ON i.repository_id = d.repository_id AND i.pull_number = d.pull_number
           ${reportJoin}
          WHERE d.network = ? AND d.finalized_at IS NOT NULL AND d.accepted IS NOT NULL
            AND d.state IN ('open', 'refund_due', 'kept_due')
            AND (d.accepted = 0 OR d.state <> 'open'
                 OR i.outcome IN ('refund_due', 'kept_due') ${reportDue})
            AND (d.reject_reason IS NULL OR d.reject_reason <> 'token_not_accepted')
          ORDER BY d.deposit_id`,
      )
      .bind(network)
      .all<DepositRecord & ItemRecord & Partial<ReportRecord>>();
    return results.map((row) => ({
      deposit: depositOf(row),
      item: itemOf(row),
      report: reportOf(row),
    }));
  }

  async parked(network: string) {
    const { results } = await this.db
      .prepare(
        "SELECT deposit_id FROM submission_fee_parked WHERE network = ? AND released_at IS NULL",
      )
      .bind(network)
      .all<{ deposit_id: number }>();
    return new Set(results.map((row) => row.deposit_id));
  }

  async park(
    network: string,
    entry: SendEntry,
    reason: ParkReason,
    at: string,
  ) {
    await this.db
      .prepare(
        `INSERT INTO submission_fee_parked
           (network, deposit_id, refund, reason, parked_at, checked_at, checks, released_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT (network, deposit_id) DO UPDATE SET
           refund = excluded.refund, reason = excluded.reason,
           parked_at = CASE WHEN released_at IS NULL THEN parked_at ELSE excluded.parked_at END,
           checked_at = excluded.checked_at, checks = checks + 1, released_at = NULL`,
      )
      .bind(network, entry.id, entry.refund ? 1 : 0, reason, at, at)
      .run();
  }

  async parkedToCheck(network: string, before: string, limit: number) {
    const { results } = await this.db
      .prepare(
        `SELECT deposit_id, refund FROM submission_fee_parked
          WHERE network = ? AND released_at IS NULL AND checked_at <= ?
          ORDER BY checked_at, deposit_id LIMIT ?`,
      )
      .bind(network, before, limit)
      .all<{ deposit_id: number; refund: number }>();
    return results.map((row) => ({
      id: row.deposit_id,
      refund: row.refund === 1,
    }));
  }

  async checkedParked(
    network: string,
    depositId: number,
    released: boolean,
    at: string,
  ) {
    await this.db
      .prepare(
        `UPDATE submission_fee_parked
            SET checked_at = ?, checks = checks + 1,
                released_at = CASE WHEN ? = 1 THEN ? ELSE NULL END
          WHERE network = ? AND deposit_id = ? AND released_at IS NULL`,
      )
      .bind(at, released ? 1 : 0, at, network, depositId)
      .run();
  }

  async setDue(
    network: string,
    depositId: number,
    state: "open" | "refund_due" | "kept_due",
  ) {
    await this.db
      .prepare(
        `UPDATE submission_fee_deposits SET state = ?
          WHERE network = ? AND deposit_id = ? AND finalized_at IS NOT NULL
            AND state IN ('open', 'refund_due', 'kept_due')`,
      )
      .bind(state, network, depositId)
      .run();
  }

  async openSend(network: string) {
    const row = await this.db
      .prepare(
        "SELECT * FROM submission_fee_sends WHERE network = ? AND state IN ('submitted', 'unknown')",
      )
      .bind(network)
      .first<SendRecord>();
    return row ? sendOf(row) : null;
  }

  async latestDryRun(network: string) {
    const row = await this.db
      .prepare(
        "SELECT * FROM submission_fee_sends WHERE network = ? AND mode = 'dry_run' ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .bind(network)
      .first<SendRecord>();
    return row ? sendOf(row) : null;
  }

  async assertGasBudget(
    network: string,
    maximumNativeWei: string,
    limits: GasLimits,
    now: Date,
  ) {
    assertPerTransaction(maximumNativeWei, limits);
    const row = await this.db
      .prepare(`SELECT ${SPENT_TODAY} AS spent`)
      .bind(network, utcDay(now))
      .first<{ spent: number }>();
    if (
      BigInt(row?.spent ?? 0) + BigInt(maximumNativeWei) >
      BigInt(limits.perDayWei)
    )
      throw new GasBudgetError(
        "The day's native fee limit is reached; nothing was signed",
      );
  }

  async insertSend(row: SendRow, limits: GasLimits) {
    const columns: D1Value[] = [
      row.id,
      row.network,
      row.mode,
      row.contract,
      JSON.stringify(row.deposits),
      row.resolver,
      row.txId,
      row.rawTx,
      row.evmNonce,
      row.maximumNativeWei,
      row.state,
      row.reason,
      row.blockNumber,
      row.createdAt,
      row.updatedAt,
      row.finalizedAt,
    ];
    const insert = `INSERT INTO submission_fee_sends
        (id, network, mode, contract, deposits, resolver, tx_id, raw_tx, evm_nonce,
         maximum_native_wei, state, reason, block_number, created_at, updated_at, finalized_at)
      SELECT ${columns.map(() => "?").join(", ")}`;
    let changes: number;
    try {
      if (row.mode === "dry_run")
        changes =
          (
            await this.db
              .prepare(insert)
              .bind(...columns)
              .run()
          ).meta?.changes ?? 0;
      else {
        const reserve = row.maximumNativeWei ?? "";
        assertPerTransaction(reserve, limits);
        // The day's limit is checked again inside the insert itself.
        changes =
          (
            await this.db
              .prepare(`${insert} WHERE ${SPENT_TODAY} + ? <= ?`)
              .bind(
                ...columns,
                row.network,
                utcDay(new Date(row.createdAt)),
                Number(reserve),
                Number(limits.perDayWei),
              )
              .run()
          ).meta?.changes ?? 0;
      }
    } catch (error) {
      if (isConstraintFailure(error))
        throw new SendConflictError("Another send is already recorded");
      throw error;
    }
    if (changes !== 1)
      throw new GasBudgetError(
        "The day's native fee limit is reached; nothing was sent",
      );
  }

  async updateSend(
    id: string,
    fields: {
      state: SendState;
      reason?: string | null;
      blockNumber?: number | null;
      finalizedAt?: string | null;
      updatedAt: string;
    },
  ) {
    const result = await this.db
      .prepare(
        `UPDATE submission_fee_sends
            SET state = ?, reason = ?, block_number = ?, finalized_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        fields.state,
        fields.reason ?? null,
        fields.blockNumber ?? null,
        fields.finalizedAt ?? null,
        fields.updatedAt,
        id,
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1)
      throw new Error("A recorded send was not updated");
  }

  // The SLOP rate and the price readings it is averaged from.

  async latestRate(): Promise<SubmissionFeeRate | null> {
    const row = await this.db
      .prepare(
        "SELECT effective_at, slop_per_usd FROM submission_fee_rates ORDER BY effective_at DESC LIMIT 1",
      )
      .first<{ effective_at: string; slop_per_usd: string }>();
    return row
      ? { effectiveAt: row.effective_at, slopPerUsd: row.slop_per_usd }
      : null;
  }

  /** One reading per UTC hour; a second reading of the hour is ignored. */
  async insertSample(sample: {
    sampledAt: string;
    blockNumber: number;
    slopPerUsd: string;
    source: string;
  }) {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO submission_fee_price_samples
           (sampled_hour, sampled_at, block_number, slop_per_usd, source)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        sample.sampledAt.slice(0, 13),
        sample.sampledAt,
        sample.blockNumber,
        sample.slopPerUsd,
        sample.source,
      )
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async samplesSince(since: string, source: string): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        "SELECT slop_per_usd FROM submission_fee_price_samples WHERE sampled_at >= ? AND source = ? ORDER BY sampled_hour",
      )
      .bind(since, source)
      .all<{ slop_per_usd: string }>();
    return results.map((row) => row.slop_per_usd);
  }

  async insertRate(rate: {
    effectiveAt: string;
    slopPerUsd: string;
    source: string;
    createdAt: string;
  }) {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO submission_fee_rates (effective_at, slop_per_usd, source, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(rate.effectiveAt, rate.slopPerUsd, rate.source, rate.createdAt)
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }
}
