/**
 * The pay page for the refundable SLOP deposit on a private security report
 * (`/fee/report/<caseId>`; operator decision, 21 November 2026; PRD section
 * 8). This file holds the page's pure rules: which case an address names and
 * whether the deposit record the API returned may be shown and paid.
 *
 * The address bar only names the case. The item hash is computed here, and
 * the one way to pay must be SLOP on Robinhood Chain into the published
 * deposit contract with the burn address as its kept-to address, as the
 * tables in `submission-fee.mjs` name them. A record that does not match is
 * refused whole; the page never repairs it. The record carries no project,
 * reporter or report text, and this file reads none.
 */

import { formatBaseUnits } from "./base-units.mjs";
import { networkLabel } from "./network-names";
import {
  REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS,
  REPORT_DEPOSIT_NETWORK,
  REPORT_DEPOSIT_USD_MINOR,
  reportDepositItem,
} from "./security-report-deposit.mjs";
import { SUBMISSION_FEE_SLOP_DECIMALS } from "./submission-fee.mjs";
import {
  type FeeItem,
  FeeRecordError,
  type FeeTables,
  type FeeWay,
  PUBLISHED_FEE_TABLES,
  readFeeSettlement,
  savedFeeWay,
} from "./submission-fee-page";

/** One report's deposit record, with every address checked. */
export type ReportDeposit = Pick<
  FeeItem,
  "item" | "askedAt" | "paid" | "outcome" | "outcomeAt" | "resolveTransaction"
> & {
  caseId: string;
  /** The one way to pay, or nothing once a deposit is recorded. */
  due: FeeWay[];
};

// The same identifier contract as the Inbox and the security API.
const CASE = /^sc_[A-Za-z0-9_-]{8,72}$/u;
const WHOLE_SLOP = 10n ** BigInt(SUBMISSION_FEE_SLOP_DECIMALS);

/** The case named by `/fee/report/<caseId>`, or null. */
export function reportDepositCase(caseId: string): string | null {
  return CASE.test(caseId) ? caseId : null;
}

/** The API path of one report's deposit record. */
export function reportDepositPath(caseId: string): string {
  return `/api/v1/submission-fee/reports/${caseId}`;
}

/** The pay page of one report's deposit. */
export function reportDepositPayPath(caseId: string): string {
  return `/fee/report/${caseId}`;
}

/** The record did not match the published tables; nothing from it is used. */
export class ReportDepositRecordError extends FeeRecordError {
  constructor() {
    super(
      "The deposit record for this report could not be checked against Slop's published addresses. Do not pay from this page.",
    );
  }
}

/**
 * Reads the API's deposit record for one report. It must be the record of
 * exactly this case, its item must be the hash computed here, and its one
 * way to pay must be a whole number of SLOP on Robinhood Chain into the
 * published contract, kept to the burn address. The amount is the record's:
 * it was fixed when the deposit was asked. Anything else throws; nothing is
 * offered from it.
 */
export function readReportDeposit(
  value: unknown,
  caseId: string,
  tables: FeeTables = PUBLISHED_FEE_TABLES,
): ReportDeposit {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new FeeRecordError();
    const body = value as Record<string, unknown>;
    if (reportDepositCase(caseId) === null) throw new FeeRecordError();
    const item = reportDepositItem(caseId);
    if (
      body.schema !== "slop-report-deposit-v1" ||
      body.caseId !== caseId ||
      typeof body.item !== "string" ||
      body.item.toLowerCase() !== item ||
      !Array.isArray(body.due) ||
      body.due.length > 1
    )
      throw new FeeRecordError();
    const due = body.due.map((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry))
        throw new FeeRecordError();
      // The record lists one amount; a deposit of less does not count.
      const way = savedFeeWay(
        { ...entry, minimumAccepted: (entry as { amount?: unknown }).amount },
        tables,
      );
      if (
        way.network !== REPORT_DEPOSIT_NETWORK ||
        way.kind !== "slop" ||
        BigInt(way.amount) % WHOLE_SLOP !== 0n
      )
        throw new FeeRecordError();
      return way;
    });
    const settled = readFeeSettlement(body, due.length, tables);
    if (
      settled.paid
        ? settled.paid.network !== REPORT_DEPOSIT_NETWORK ||
          settled.paid.kind !== "slop"
        : due.length !== 1
    )
      throw new FeeRecordError();
    return { caseId, item, due, ...settled };
  } catch (error) {
    if (error instanceof FeeRecordError) throw new ReportDepositRecordError();
    throw error;
  }
}

/** "5": the deposit's size in whole US dollars, as the notices state it. */
export const REPORT_DEPOSIT_USD_TEXT = formatBaseUnits(
  REPORT_DEPOSIT_USD_MINOR,
  6,
);
const ABOUT = `about ${REPORT_DEPOSIT_USD_TEXT} US dollars of SLOP on ${networkLabel(REPORT_DEPOSIT_NETWORK)}`;
const KEEPING_CLOSES =
  "unless the report is closed as spam, a duplicate or out of scope";

/** One sentence before a reporter files, on a program that asks the deposit. */
export const REPORT_DEPOSIT_NOTICE = `A refundable deposit of ${ABOUT} is needed before the report is screened; it is sent back ${KEEPING_CLOSES}.`;

/** One sentence under the owner's checkbox. */
export const REPORT_DEPOSIT_SETTING_HINT = `A private report is screened once its reporter deposits ${ABOUT}, sent back ${KEEPING_CLOSES}.`;
/**
 * What the owner's "Spam" mark on a rejected report does (PRD section 8). It
 * is the only record that closes a report as spam.
 */
export const REPORT_DEPOSIT_SPAM_INFO = `a paid deposit is kept after ${REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS} days with no open appeal`;

export type ReportDepositState =
  | "needed"
  | "paid"
  | "refund_due"
  | "refunded"
  | "kept_due"
  | "kept";

/** The reporter's own view of a report's deposit, from the Inbox and case reads. */
export type ReportDepositStatus = {
  state: ReportDepositState;
  /** "395 SLOP", or null when the read carried no readable amount. */
  amountText: string | null;
  /** The report's pay page, or null when the read named anything else. */
  payPath: string | null;
};

const STATUS_TEXT: Record<ReportDepositState, string> = {
  needed: "Deposit needed",
  paid: "Deposit recorded",
  refund_due: "Deposit recorded, to be sent back",
  kept_due: "Deposit recorded, to be kept",
  refunded: "Deposit sent back",
  kept: "Deposit kept",
};
const PAY_PATH = /^\/fee\/report\/(sc_[A-Za-z0-9_-]{8,72})$/u;
const BASE_UNITS = /^[1-9][0-9]{0,38}$/u;

/**
 * Reads the `deposit` field of the reporter's own report or case read. Null,
 * absent or unrecognised means no deposit is asked for the report.
 */
export function reportDepositStatus(
  value: unknown,
): ReportDepositStatus | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const { state, amount, payPath } = value as Record<string, unknown>;
  if (typeof state !== "string" || !Object.hasOwn(STATUS_TEXT, state))
    return null;
  return {
    state: state as ReportDepositState,
    amountText:
      typeof amount === "string" && BASE_UNITS.test(amount)
        ? `${formatBaseUnits(amount, SUBMISSION_FEE_SLOP_DECIMALS)} SLOP`
        : null,
    payPath:
      typeof payPath === "string" && PAY_PATH.test(payPath) ? payPath : null,
  };
}

/** The case a report's pay path names, for reading its public record. */
export function reportDepositPathCase(payPath: string): string | null {
  return PAY_PATH.exec(payPath)?.[1] ?? null;
}

/** "Deposit needed: 395 SLOP", "Deposit recorded", "Deposit sent back". */
export function reportDepositStatusText(status: ReportDepositStatus): string {
  return status.state === "needed" && status.amountText
    ? `${STATUS_TEXT.needed}: ${status.amountText}`
    : STATUS_TEXT[status.state];
}
