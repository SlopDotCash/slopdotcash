// spec/security/reportDeposit.md, "A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt"; spec/security/reportDeposit.md, "Unpaid asks are released when the switch or the project turns the deposit off"
import { REPORT_DEPOSIT_SWITCHED_ON, reportDepositOn } from "@repo/security/client";
import { REPORT_DEPOSIT_NOTICE } from "../../../projections/reportDeposit.ts";

/** One sentence before a reporter files, shown only while Slop asks the deposit and the program's registry record has not turned it off. */
export function DepositNotice({ project }: { project: unknown }) {
  return REPORT_DEPOSIT_SWITCHED_ON && reportDepositOn(project) ? <p className="text-sm text-muted-foreground">{REPORT_DEPOSIT_NOTICE}</p> : null;
}
