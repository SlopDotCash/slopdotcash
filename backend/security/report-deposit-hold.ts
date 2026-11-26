/**
 * The one definition of "this report waits for its deposit" (PRD section 8,
 * "Report deposit"). A report is held while its deposit row asks (`asked`),
 * no payment is recorded and no outcome is set. A `recorded` row, written in
 * record-only mode or when the deposit stopped applying, never holds.
 *
 * Every place that screens, notifies, lists for the owner, decides or
 * forwards a report uses this condition, so one rule covers them all. This
 * module imports nothing.
 */

/** SQL condition: the case in `caseColumn` waits for its deposit. */
export function depositHeldSql(caseColumn: string): string {
  return `EXISTS (SELECT 1 FROM security_report_deposits rd WHERE rd.case_id = ${caseColumn} AND rd.mode = 'asked' AND rd.paid_at IS NULL AND rd.outcome IS NULL)`;
}

type Reader = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
    };
  };
};

/** True while the case waits for its deposit. */
export async function depositHeld(
  deps: { db: Reader },
  caseId: string,
): Promise<boolean> {
  const row = await deps.db
    .prepare(`SELECT 1 AS held WHERE ${depositHeldSql("?")}`)
    .bind(caseId)
    .first<{ held: number }>();
  return row !== null;
}

/** The plain reason a held report is not forwarded or screened. */
export const DEPOSIT_REQUIRED_MESSAGE =
  "This report waits for its deposit. Nothing else happens to it until the deposit is recorded.";
