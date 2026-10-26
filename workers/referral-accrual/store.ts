import { PARTICIPATION_BAN_QUERY } from "../../backend/projects/account-bans";
import { CLAIM_CHAIN } from "./config";
import {
  type AccrualFile,
  type AccrualRow,
  type AccrualStore,
  type Candidate,
  type Hold,
  LOCK_MS,
  type PostRow,
  type PostStore,
  type PriorAccrual,
  periodBounds,
} from "./core";

type D1Value = string | number | null;
interface D1Statement {
  bind(...values: D1Value[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface ReferralD1Database {
  prepare(query: string): D1Statement;
  batch?(statements: D1Statement[]): Promise<unknown[]>;
}

const ACCRUAL_COLUMNS: [keyof AccrualRow, string][] = [
  ["obligationId", "obligation_id"],
  ["period", "period"],
  ["runId", "run_id"],
  ["projectId", "project_id"],
  ["referrerGithubId", "referrer_github_id"],
  ["referrerGithubLogin", "referrer_github_login"],
  ["network", "network"],
  ["paidTransaction", "paid_transaction"],
  ["paidObservedAt", "paid_observed_at"],
  ["grossBase", "gross_base"],
  ["assetAddress", "asset_address"],
  ["assetSymbol", "asset_symbol"],
  ["rateBasePerMicro", "rate_base_per_micro"],
  ["computedBase", "computed_base"],
  ["accruedBase", "accrued_base"],
  ["outcome", "outcome"],
  ["reason", "reason"],
  ["ruleVersion", "rule_version"],
  ["createdAt", "created_at"],
];

export class D1AccrualStore implements AccrualStore, PostStore {
  constructor(private readonly db: ReferralD1Database) {}

  async acquireLock(runId: string, now: Date) {
    const expires = new Date(now.getTime() + LOCK_MS).toISOString();
    const result = await this.db
      .prepare(
        `INSERT INTO referral_accrual_locks (scope, run_id, expires_at)
         VALUES ('accrual', ?, ?)
         ON CONFLICT(scope) DO UPDATE SET run_id = excluded.run_id,
           expires_at = excluded.expires_at
         WHERE referral_accrual_locks.expires_at < ?`,
      )
      .bind(runId, expires, now.toISOString())
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async releaseLock(runId: string, now: Date) {
    await this.db
      .prepare(
        `DELETE FROM referral_accrual_locks
          WHERE scope = 'accrual' AND run_id = ? AND expires_at >= ?`,
      )
      .bind(runId, now.toISOString())
      .run();
  }

  async filedPeriods() {
    const { results } = await this.db
      .prepare(
        "SELECT period, epoch FROM referral_accrual_files ORDER BY epoch",
      )
      .all<{ period: string; epoch: number }>();
    return results;
  }

  async candidates(period: string): Promise<Candidate[]> {
    const { start, end } = periodBounds(period);
    const { results } = await this.db
      .prepare(
        `SELECT o.id AS obligation_id, o.project_id, o.network, o.asset_address,
                o.asset_decimals, o.gross_base, o.paid_transaction,
                e.observed_at AS paid_observed_at,
                p.referrer_github_id, p.referrer_github_login
           FROM payment_obligations o
           JOIN payment_events e
             ON e.network = o.network AND e.transaction_id = o.paid_transaction
            AND e.obligation_id = o.id AND e.kind = 'paid'
           JOIN projects p ON p.id = o.project_id
          WHERE o.state = 'paid' AND p.referrer_github_id IS NOT NULL
            AND e.observed_at >= ? AND e.observed_at < ?
            AND NOT EXISTS (SELECT 1 FROM referral_accruals a WHERE a.obligation_id = o.id)
          ORDER BY e.observed_at, o.id`,
      )
      .bind(start, end)
      .all<{
        obligation_id: string;
        project_id: string;
        network: string;
        asset_address: string;
        asset_decimals: number;
        gross_base: string;
        paid_transaction: string;
        paid_observed_at: string;
        referrer_github_id: string;
        referrer_github_login: string;
      }>();
    return results.map((row) => ({
      obligationId: row.obligation_id,
      projectId: row.project_id,
      network: row.network,
      assetAddress: row.asset_address,
      assetDecimals: row.asset_decimals,
      grossBase: row.gross_base,
      paidTransaction: row.paid_transaction,
      paidObservedAt: row.paid_observed_at,
      referrerGithubId: row.referrer_github_id,
      referrerGithubLogin: row.referrer_github_login,
    }));
  }

  async priorAccruals(): Promise<PriorAccrual[]> {
    const { results } = await this.db
      .prepare(
        `SELECT project_id, referrer_github_id, referrer_github_login, accrued_base
           FROM referral_accruals
          WHERE outcome IN ('accrued', 'project_cap', 'pool_cap')
          ORDER BY period, paid_observed_at, obligation_id`,
      )
      .all<{
        project_id: string;
        referrer_github_id: string;
        referrer_github_login: string;
        accrued_base: string;
      }>();
    return results.map((row) => ({
      projectId: row.project_id,
      referrerGithubId: row.referrer_github_id,
      referrerGithubLogin: row.referrer_github_login,
      accruedBase: row.accrued_base,
    }));
  }

  async firstPaidAt(projectId: string) {
    const row = await this.db
      .prepare(
        `SELECT MIN(e.observed_at) AS first FROM payment_obligations o
           JOIN payment_events e
             ON e.network = o.network AND e.transaction_id = o.paid_transaction
            AND e.obligation_id = o.id AND e.kind = 'paid'
          WHERE o.project_id = ? AND o.state = 'paid'`,
      )
      .bind(projectId)
      .first<{ first: string | null }>();
    return row?.first ?? null;
  }

  async activeHold(projectId: string): Promise<Hold | null> {
    const row = await this.db
      .prepare(
        `SELECT id, project_id, reason, created_at FROM referral_holds
          WHERE project_id = ? AND lifted_at IS NULL ORDER BY created_at LIMIT 1`,
      )
      .bind(projectId)
      .first<{
        id: string;
        project_id: string;
        reason: string;
        created_at: string;
      }>();
    return row
      ? {
          id: row.id,
          projectId: row.project_id,
          reason: row.reason,
          createdAt: row.created_at,
        }
      : null;
  }

  async hasParticipationBan(githubId: string) {
    return (
      (await this.db
        .prepare(PARTICIPATION_BAN_QUERY)
        .bind(githubId)
        .first<{ banned: number }>()) !== null
    );
  }

  async claimWallet(githubId: string) {
    const row = await this.db
      .prepare(
        `SELECT w.wallet_address FROM wallet_claims w
           JOIN payment_wallet_authorizations a ON a.claim_id = w.id
          WHERE w.github_user_id = ? AND w.chain = ?
            AND NOT EXISTS (SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id = w.id)
          LIMIT 1`,
      )
      .bind(githubId, CLAIM_CHAIN)
      .first<{ wallet_address: string }>();
    if (!row) return null;
    const address = row.wallet_address.toLowerCase();
    return /^0x[0-9a-f]{40}$/u.test(address) ? address : null;
  }

  async pinnedWallets() {
    const { results } = await this.db
      .prepare("SELECT referrer_github_id, wallet FROM referral_claim_wallets")
      .all<{ referrer_github_id: string; wallet: string }>();
    return new Map(results.map((row) => [row.referrer_github_id, row.wallet]));
  }

  async insertAccruals(rows: AccrualRow[]) {
    const columns = ACCRUAL_COLUMNS.map(([, column]) => column).join(", ");
    const placeholders = ACCRUAL_COLUMNS.map(() => "?").join(", ");
    for (const row of rows)
      await this.db
        .prepare(
          `INSERT INTO referral_accruals (${columns}) VALUES (${placeholders})`,
        )
        .bind(...ACCRUAL_COLUMNS.map(([key]) => row[key] as D1Value))
        .run();
  }

  async insertFile(file: AccrualFile) {
    await this.db
      .prepare(
        `INSERT INTO referral_accrual_files
           (period, epoch, run_id, mode, body, body_sha256, merkle_root,
            tree_total_base, leaf_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        file.period,
        file.epoch,
        file.runId,
        file.mode,
        file.body,
        file.bodySha256,
        file.merkleRoot,
        file.treeTotalBase,
        file.leafCount,
        file.createdAt,
      )
      .run();
    for (const pin of file.pins)
      await this.db
        .prepare(
          `INSERT INTO referral_claim_wallets (referrer_github_id, wallet, pinned_period, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(pin.githubId, pin.wallet, file.period, file.createdAt)
        .run();
  }

  async openPosts(network: string) {
    const { results } = await this.db
      .prepare(
        `SELECT ${POST_SELECT} FROM referral_root_posts
          WHERE network = ? AND state IN ('submitted', 'unknown')
          ORDER BY created_at`,
      )
      .bind(network)
      .all<Record<string, D1Value>>();
    return results.map(postFromRow);
  }

  async acceptedPosts(network: string) {
    const { results } = await this.db
      .prepare(
        `SELECT ${POST_SELECT} FROM referral_root_posts
          WHERE network = ? AND state IN ('submitted', 'unknown', 'finalized', 'voided')
          ORDER BY epoch`,
      )
      .bind(network)
      .all<Record<string, D1Value>>();
    return results.map(postFromRow);
  }

  async postableFiles() {
    const { results } = await this.db
      .prepare(
        `SELECT period, merkle_root, tree_total_base FROM referral_accrual_files
          WHERE merkle_root IS NOT NULL ORDER BY epoch`,
      )
      .bind()
      .all<{ period: string; merkle_root: string; tree_total_base: string }>();
    return results.map((row) => ({
      period: row.period,
      merkleRoot: row.merkle_root,
      treeTotalBase: row.tree_total_base,
    }));
  }

  async insertPost(row: PostRow) {
    await this.db
      .prepare(
        `INSERT INTO referral_root_posts (${POST_SELECT}) VALUES (${POST_COLUMNS.map(() => "?").join(", ")})`,
      )
      .bind(...POST_COLUMNS.map(([key]) => row[key] as D1Value))
      .run();
  }

  async updatePost(id: string, fields: Partial<PostRow>) {
    const entries = Object.entries(fields);
    if (entries.length === 0) return;
    const result = await this.db
      .prepare(
        `UPDATE referral_root_posts SET ${entries
          .map(([key]) => {
            const column = POST_COLUMN.get(key as keyof PostRow);
            if (!column) throw new TypeError(`Unknown field ${key}`);
            return `${column} = ?`;
          })
          .join(", ")} WHERE id = ?`,
      )
      .bind(...entries.map(([, value]) => value as D1Value), id)
      .run();
    if ((result.meta?.changes ?? 0) !== 1)
      throw new Error("Referral root post was not updated");
  }
}

const POST_COLUMNS: [keyof PostRow, string][] = [
  ["id", "id"],
  ["runId", "run_id"],
  ["period", "period"],
  ["epoch", "epoch"],
  ["network", "network"],
  ["distributor", "distributor"],
  ["token", "token"],
  ["poster", "poster"],
  ["merkleRoot", "merkle_root"],
  ["totalBase", "total_base"],
  ["txId", "tx_id"],
  ["rawTx", "raw_tx"],
  ["evmNonce", "evm_nonce"],
  ["state", "state"],
  ["reason", "reason"],
  ["blockNumber", "block_number"],
  ["voidAcknowledgedAt", "void_acknowledged_at"],
  ["createdAt", "created_at"],
  ["updatedAt", "updated_at"],
  ["submittedAt", "submitted_at"],
  ["finalizedAt", "finalized_at"],
];
const POST_COLUMN = new Map(POST_COLUMNS);
const POST_SELECT = POST_COLUMNS.map(([, column]) => column).join(", ");

function postFromRow(row: Record<string, D1Value>): PostRow {
  return Object.fromEntries(
    POST_COLUMNS.map(([key, column]) => [key, row[column] ?? null]),
  ) as unknown as PostRow;
}
