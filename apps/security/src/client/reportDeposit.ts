// spec/security/reportDeposit.md, "A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"
import { slopDecimals, slopRateScaled, stableDecimals } from "@repo/backend/client";
import { keccak } from "@repo/platform/chain/evm";
import { keptAfterClosedMs, refundSilentMs } from "../../gen/security__reportDeposit.ts";

const dayMs = 24 * 60 * 60 * 1000;
const caseIdPattern = /^sc_[A-Za-z0-9_-]{8,72}$/u;
const oneSlop = 10n ** BigInt(slopDecimals);

export const REPORT_DEPOSIT_NETWORK = "robinhood-mainnet";
export const REPORT_DEPOSIT_USD_MINOR = "5000000";
export const REPORT_DEPOSIT_REFUND_SILENT_DAYS = refundSilentMs / dayMs;
export const REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS = keptAfterClosedMs / dayMs;
export const REPORT_DEPOSIT_KEEPING_CLOSES = ["spam", "duplicate", "out-of-scope"] as const;
export const REPORT_DEPOSIT_SWITCHED_ON = true;

export type ReportDepositState = "needed" | "paid" | "refund_due" | "refunded" | "kept_due" | "kept";

export interface ReportDepositView {
  readonly state: ReportDepositState;
  readonly amount: string;
  readonly payPath: string;
}

/** @throws {never} */
export function isReportCaseId(caseId: string): boolean {
  return caseIdPattern.test(caseId);
}

/** `keccak256(abi.encodePacked("slop-report-v1", caseId))` in lowercase hex, or undefined for anything but a Slop case id. @throws {never} */
export function reportDepositItem(caseId: string): string | undefined {
  if (!isReportCaseId(caseId)) return undefined;
  return keccak(new TextEncoder().encode(`slop-report-v1${caseId}`)).toLowerCase();
}

/** SLOP base units for the deposit at a rate, rounded up to a whole SLOP; undefined without a valid rate. @throws {never} */
export function reportDepositAmount(slopPerUsd: string | null | undefined): string | undefined {
  if (slopPerUsd === null || slopPerUsd === undefined) return undefined;
  const scaled = slopRateScaled(slopPerUsd);
  if (scaled === undefined) return undefined;
  const numerator = BigInt(REPORT_DEPOSIT_USD_MINOR) * scaled;
  const denominator = 10n ** BigInt(stableDecimals) * oneSlop;
  return (((numerator + denominator - 1n) / denominator) * oneSlop).toString();
}

function member(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

/** True unless the project's manifest sets `security.reportDeposit` to false. @throws {never} */
export function reportDepositOn(project: unknown): boolean {
  return member(member(project, "security"), "reportDeposit") !== false;
}

/** The setting read from a stored manifest's JSON text; unreadable text reads as on, as an absent setting does. @throws {never} */
export function reportDepositOnManifest(text: string): boolean {
  try {
    return reportDepositOn(JSON.parse(text) as unknown);
  } catch {
    return true;
  }
}

/** "395 SLOP" for a base-unit amount. @throws {never} */
export function depositAmountText(baseUnits: string): string {
  const value = /^[0-9]{1,78}$/u.test(baseUnits) ? BigInt(baseUnits) : 0n;
  const fraction = (value % oneSlop).toString().padStart(slopDecimals, "0").replace(/0+$/u, "");
  return `${value / oneSlop}${fraction === "" ? "" : `.${fraction}`} SLOP`;
}

/** @throws {never} */
export function reportDepositPayPath(caseId: string): string {
  return `/fee/report/${caseId}`;
}
