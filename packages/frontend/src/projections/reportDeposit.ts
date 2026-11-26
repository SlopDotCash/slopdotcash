// spec/security/reportDeposit.md, "A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"
import { slopDecimals } from "@repo/backend/client";
import { REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS, REPORT_DEPOSIT_NETWORK, REPORT_DEPOSIT_USD_MINOR, type ReportDepositState } from "@repo/security/client";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { networkLabel } from "../kernels/assetText.ts";

export type { ReportDepositState };

export interface ReportDepositStatus {
  readonly state: ReportDepositState;
  readonly amountText: string | null;
  readonly payPath: string | null;
}

export const REPORT_DEPOSIT_USD_TEXT = formatBaseUnits({ value: BigInt(REPORT_DEPOSIT_USD_MINOR), decimals: 6 });

const about = `about ${REPORT_DEPOSIT_USD_TEXT} US dollars of SLOP on ${networkLabel(REPORT_DEPOSIT_NETWORK)}`;
const keepingCloses = "unless the report is closed as spam, a duplicate or out of scope";

export const REPORT_DEPOSIT_NOTICE = `A refundable deposit of ${about} is needed before the report is screened; it is sent back ${keepingCloses}.`;

export const REPORT_DEPOSIT_SETTING_HINT = `A private report is screened once its reporter deposits ${about}, sent back ${keepingCloses}.`;

export const REPORT_DEPOSIT_SPAM_INFO = `a paid deposit is kept after ${REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS} days with no open appeal`;

const statusText: Readonly<Record<ReportDepositState, string>> = {
  needed: "Deposit needed",
  paid: "Deposit recorded",
  refund_due: "Deposit recorded, to be sent back",
  kept_due: "Deposit recorded, to be kept",
  refunded: "Deposit sent back",
  kept: "Deposit kept",
};

const payPathPattern = /^\/fee\/report\/(sc_[A-Za-z0-9_-]{8,72})$/u;
const baseUnitsPattern = /^[1-9][0-9]{0,38}$/u;

/** @throws {never} */
export function reportDepositStatus(value: unknown): ReportDepositStatus | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { state, amount, payPath } = value as Record<string, unknown>;
  if (typeof state !== "string" || !Object.hasOwn(statusText, state)) return null;
  return {
    state: state as ReportDepositState,
    amountText: typeof amount === "string" && baseUnitsPattern.test(amount) ? `${formatBaseUnits({ value: BigInt(amount), decimals: slopDecimals })} SLOP` : null,
    payPath: typeof payPath === "string" && payPathPattern.test(payPath) ? payPath : null,
  };
}

/** @throws {never} */
export function reportDepositPathCase(payPath: string): string | null {
  return payPathPattern.exec(payPath)?.[1] ?? null;
}

/** @throws {never} */
export function reportDepositStatusText(status: ReportDepositStatus): string {
  return status.state === "needed" && status.amountText ? `${statusText.needed}: ${status.amountText}` : statusText[status.state];
}
