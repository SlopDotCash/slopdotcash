/**
 * TEMPORARY COPY for the deposit Worker's branch; session A (deposit-backend)
 * owns this file. Types for the refundable SLOP deposit on a private report.
 */

export declare const REPORT_DEPOSIT_NETWORK: "robinhood-mainnet";
export declare const REPORT_DEPOSIT_USD_MINOR: string;
export declare const REPORT_DEPOSIT_REFUND_SILENT_DAYS: number;
export declare const REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS: number;
export declare const REPORT_DEPOSIT_KEEPING_CLOSES: readonly string[];
export declare function reportDepositItem(caseId: string): `0x${string}`;
export declare function reportDepositAmount(
  slopPerUsd: string | null | undefined,
): string | null;
export declare function reportDepositOn(
  project: { security?: { reportDeposit?: boolean } | null } | null | undefined,
): boolean;
