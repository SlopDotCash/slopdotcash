// spec/security/reportDeposit.md, "A report that waits for its deposit belongs to its reporter alone"
import type { Statement } from "@repo/platform/d1";

export type CaseColumn = "c.id" | "d.case_id" | "i.case_id" | "s.case_id" | "security_cases.id" | "?";

/** @throws {never} */
export function depositHeldOn(column: CaseColumn): Statement {
  return { text: `EXISTS (SELECT 1 FROM security_report_deposits rd WHERE rd.case_id = ${column} AND rd.mode = 'asked' AND rd.paid_at IS NULL AND rd.outcome IS NULL)`, params: [] };
}

/** @throws {never} */
export function depositHeldFor(caseId: string): Statement {
  return { text: `SELECT 1 AS held WHERE ${depositHeldOn("?").text}`, params: [caseId] };
}
