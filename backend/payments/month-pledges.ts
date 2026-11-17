/**
 * On-chain month pledges (operator decision, 15 November 2026, PRD section 6).
 *
 * An owner may lock a month's pool in an upgraded vault (EVM `pledgeMonths`,
 * Solana `pledge_month`). While a month is pledged the contract refuses a
 * withdrawal that would take the locked amount, and Slop's executor may
 * reserve that month even when the owner turned automatic payment off. The
 * pledge ends when the month is reserved, or lapses when the month's commit
 * window closes.
 *
 * The payments Worker reads each vault's pledges with its finalized counters
 * and stores them beside the snapshot (migration 0128). Pages and the monthly
 * coordinator read only those stored rows (PRD section 9).
 */

import type { D1TransactionalDatabase as D1Database } from "../d1";

/** One vault's pledge state as both chain readers return it. */
export type ChainMonthPledges = {
  openPledgedGross: bigint;
  pledges: { period: number; amount: bigint; open: boolean }[];
};

/** A vault's pledges as stored and served: months as YYYY-MM, amounts as text. */
export type StoredMonthPledges = {
  openPledgedGross: string;
  pledges: { period: string; amount: string; open: boolean }[];
};

/** How many months, from the previous one, a refresh reads. */
export const PLEDGE_READ_MONTHS = 13;

/** "2026-12" to 202612, as the contracts number periods. */
export function chainPeriod(period: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(period))
    throw new Error("Invalid month");
  return Number(period.replace("-", ""));
}

/** 202612 to "2026-12". */
export function sitePeriod(period: number): string {
  const text = String(period);
  if (!Number.isSafeInteger(period) || !/^\d{4}(0[1-9]|1[0-2])$/u.test(text))
    throw new Error("Invalid pledge period");
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

/** The previous UTC month of `at`, then the next twelve. */
export function pledgeReadPeriods(at: Date): string[] {
  return Array.from({ length: PLEDGE_READ_MONTHS }, (_, index) =>
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1 + index, 1))
      .toISOString()
      .slice(0, 7),
  );
}

/** Canonical text, or a refusal for anything a chain reader must never return. */
export function storedMonthPledges(
  read: ChainMonthPledges,
): StoredMonthPledges {
  const amount = (value: bigint) => {
    if (typeof value !== "bigint" || value < 0n || value >= 2n ** 128n)
      throw new Error("Invalid pledge amount");
    return value.toString();
  };
  const seen = new Set<string>();
  const pledges = read.pledges.map((pledge) => {
    const period = sitePeriod(pledge.period);
    if (seen.has(period)) throw new Error("Duplicate pledge period");
    seen.add(period);
    if (typeof pledge.open !== "boolean") throw new Error("Invalid pledge");
    return { period, amount: amount(pledge.amount), open: pledge.open };
  });
  return {
    openPledgedGross: amount(read.openPledgedGross),
    pledges: pledges.sort((a, b) => a.period.localeCompare(b.period)),
  };
}

/**
 * The SQL condition that the month bound as (?1 project, ?2 network,
 * ?3 vault, ?4 period) was pledged on chain in that vault: a stored pledge
 * above zero, open or since closed. A closed pledge was either reserved or
 * lapsed after its commit window, which the window checks already refuse.
 * A pledge in any other vault of the project, such as a replaced one, gives
 * no consent.
 */
export const MONTH_PLEDGED_SQL =
  "EXISTS(SELECT 1 FROM vault_month_pledges WHERE project_id=? AND network=? AND vault=? AND period=? AND amount<>'0')";

/**
 * The same condition for a frozen run, correlated to the row `alias` that has
 * `project_id`, `period` and `network`: a pledge in the vault the run pays.
 */
export function runPledgedSql(alias: string): string {
  return `EXISTS(SELECT 1 FROM monthly_payment_runs pr JOIN vault_month_pledges pp ON pp.project_id=pr.project_id AND pp.network=pr.network AND pp.vault=pr.vault AND pp.period=pr.period WHERE pr.project_id=${alias}.project_id AND pr.period=${alias}.period AND pr.network=${alias}.network AND pp.amount<>'0')`;
}

/** The vault that pays a month, and the month. */
export type PledgeScope = {
  projectId: string;
  network: string;
  vault: string;
  period: string;
};

const scopeBinds = (scope: PledgeScope) => [
  scope.projectId,
  scope.network,
  scope.vault,
  scope.period,
];

/**
 * True when the owner pledged this month on chain in the vault that pays it.
 * A pledge is the owner's consent to reserve the month, whatever the
 * automatic default says, and while the project is paused or restricted;
 * never for a retired project (operator decision, 15 November 2026).
 */
export async function monthPledged(
  db: Pick<D1Database, "prepare">,
  scope: PledgeScope,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT ${MONTH_PLEDGED_SQL} pledged`)
    .bind(...scopeBinds(scope))
    .first<{ pledged: number }>();
  return row?.pledged === 1;
}

/** A pledge lets a paused or restricted project's month go ahead; retirement ends it. */
export function pledgeKeepsMonth(
  pledged: boolean,
  manifest: { listingTier?: string },
): boolean {
  return pledged && manifest.listingTier !== "retired";
}

/**
 * Funds another open pledge holds back from this month: the contract never
 * lets one month take another month's pledge. Null when the vault has no
 * pledge support.
 */
export async function otherOpenPledges(
  db: Pick<D1Database, "prepare">,
  input: { projectId: string; network: string; vault: string; period: string },
): Promise<bigint | null> {
  const row = await db
    .prepare(
      "SELECT s.open_pledged_gross total,(SELECT amount FROM vault_month_pledges p WHERE p.project_id=s.project_id AND p.network=s.network AND p.vault=s.vault AND p.period=? AND p.open=1) own FROM vault_snapshots s WHERE s.project_id=? AND s.network=? AND s.vault=?",
    )
    .bind(input.period, input.projectId, input.network, input.vault)
    .first<{ total: string | null; own: string | null }>();
  if (!row || row.total === null) return null;
  const other = BigInt(row.total) - BigInt(row.own ?? "0");
  return other > 0n ? other : 0n;
}

/**
 * Whether a closed month may be committed on chain: the owner's automatic
 * default is on, or the owner pledged the month in the vault that pays it.
 */
export async function monthlyConsent(
  db: Pick<D1Database, "prepare">,
  scope: PledgeScope,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT (${MONTH_PLEDGED_SQL} OR COALESCE((SELECT automatic FROM monthly_payment_settings WHERE project_id=? ORDER BY sequence DESC LIMIT 1),1)=1) consent`,
    )
    .bind(...scopeBinds(scope), scope.projectId)
    .first<{ consent: number }>();
  return row?.consent === 1;
}

/**
 * `monthlyConsent` for a frozen run, judged against the vault the run pays.
 * Without a run only the automatic default counts.
 */
export async function runConsent(
  db: Pick<D1Database, "prepare">,
  run: { projectId: string; period: string; network: string },
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT (${runPledgedSql("q")} OR COALESCE((SELECT automatic FROM monthly_payment_settings WHERE project_id=q.project_id ORDER BY sequence DESC LIMIT 1),1)=1) consent FROM (SELECT ? project_id, ? period, ? network) q`,
    )
    .bind(run.projectId, run.period, run.network)
    .first<{ consent: number }>();
  return row?.consent === 1;
}
