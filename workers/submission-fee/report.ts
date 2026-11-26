/**
 * The two pure rules for the refundable SLOP deposit on a private security
 * report (operator decision, 21 November 2026; PRD section 8): whether a
 * deposit pays its report, and what the resolver may send for it. They read
 * no chain, database or clock.
 *
 * The backend writes the report's row in `security_report_deposits` and
 * decides what is due on it. This Worker only marks the row paid and sends
 * what the row says.
 */

import { REPORT_DEPOSIT_NETWORK } from "../../src/lib/security-report-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  type SubmissionFeeTerms,
  submissionFeeTokenKind,
} from "../../src/lib/submission-fee.mjs";

/** A report's row with `mode = 'asked'`. A `recorded` row is never one. */
export interface ReportRow {
  caseId: string;
  item: string;
  /** SLOP base units due, fixed when the report was asked. */
  slopAmount: string;
  paidNetwork: string | null;
  paidDepositId: number | null;
  outcome: string | null;
}

export type ReportDepositRefusal =
  | "unknown_item"
  | "token_not_accepted"
  | "report_wrong_network"
  | "report_token_not_slop"
  | "wrong_kept_to"
  | "report_amount_invalid"
  | "amount_below_due"
  | "item_already_paid"
  | "item_already_decided";

const AMOUNT = /^(0|[1-9][0-9]{0,38})$/u;
const same = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/**
 * Whether a deposit pays for its report.
 *
 * It counts only when all of these hold: the network is Robinhood Chain; the
 * token is SLOP from the table; a kept deposit would go to the burn address;
 * the amount is at least the amount the row asked for; and the report is not
 * already paid by another deposit or decided. Everything else is refused
 * with a reason and never kept. A refused deposit of an accepted token is
 * refunded. One of a token outside the table keeps the reason
 * `token_not_accepted`, which leaves it unresolved for its payer to reclaim.
 */
export function reportDepositCounts(
  network: string,
  deposit: {
    readonly depositId: number | string;
    readonly token: string;
    readonly amount: string;
    readonly keptTo: string;
  },
  report: ReportRow | null,
  terms: SubmissionFeeTerms = {},
):
  | { accepted: true; due: string }
  | { accepted: false; reason: ReportDepositRefusal } {
  const refuse = (reason: ReportDepositRefusal) =>
    ({ accepted: false, reason }) as const;
  // The token first, as for a pull request: the resolver never calls into a
  // token nobody reviewed, whatever else the deposit says.
  const kind = submissionFeeTokenKind(network, deposit.token, terms);
  if (kind === null) return refuse("token_not_accepted");
  if (network !== REPORT_DEPOSIT_NETWORK) return refuse("report_wrong_network");
  if (kind !== "slop") return refuse("report_token_not_slop");
  if (!same(deposit.keptTo, terms.burn ?? SUBMISSION_FEE_BURN))
    return refuse("wrong_kept_to");
  if (!report) return refuse("unknown_item");
  if (!AMOUNT.test(report.slopAmount) || BigInt(report.slopAmount) <= 0n)
    return refuse("report_amount_invalid");
  if (!AMOUNT.test(deposit.amount))
    throw new TypeError("deposit.amount must be a base-unit decimal string");
  const due = BigInt(report.slopAmount);
  if (BigInt(deposit.amount) < due) return refuse("amount_below_due");
  const paidBy = report.paidDepositId;
  const own =
    paidBy !== null &&
    report.paidNetwork === network &&
    String(paidBy) === String(deposit.depositId);
  // A second deposit for a report that is already paid or decided pays for
  // nothing; the deposit that paid stays accepted.
  if (!own && paidBy !== null) return refuse("item_already_paid");
  if (!own && report.outcome !== null) return refuse("item_already_decided");
  return { accepted: true, due: due.toString() };
}

/**
 * What the resolver may send for a deposit that names a report: "refund",
 * "keep" or null.
 *
 * Nothing before the deposit is finalized and judged, or once it has left
 * the open states, and never for a token outside the table. A refused
 * deposit is refunded whatever the row says. An accepted one is refunded
 * when the row it paid says `refund_due`. It is kept only when that row says
 * `kept_due`, names this very deposit as the one that paid, and the deposit
 * itself is SLOP on Robinhood Chain whose kept destination is the burn
 * address. No other input can produce "keep".
 */
export function reportResolveAction(
  network: string,
  deposit: {
    readonly depositId: number | string;
    readonly token: string;
    readonly keptTo: string;
    readonly finalizedAt: string | null;
    readonly state: string;
    readonly accepted: number | boolean | null;
  },
  report: ReportRow | null,
  terms: SubmissionFeeTerms = {},
): "refund" | "keep" | null {
  if (!deposit.finalizedAt) return null;
  if (!["open", "refund_due", "kept_due"].includes(deposit.state)) return null;
  const kind = submissionFeeTokenKind(network, deposit.token, terms);
  if (kind === null) return null;
  if (deposit.accepted === 0 || deposit.accepted === false) return "refund";
  if (deposit.accepted !== 1 && deposit.accepted !== true) return null;
  if (
    !report ||
    report.paidNetwork !== network ||
    String(report.paidDepositId) !== String(deposit.depositId)
  )
    return null;
  if (report.outcome === "refund_due") return "refund";
  if (
    report.outcome === "kept_due" &&
    network === REPORT_DEPOSIT_NETWORK &&
    kind === "slop" &&
    same(deposit.keptTo, terms.burn ?? SUBMISSION_FEE_BURN)
  )
    return "keep";
  return null;
}
