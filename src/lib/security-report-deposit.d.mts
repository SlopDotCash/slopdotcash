/** Types for the refundable security report deposit (PRD section 8). */

export declare const REPORT_DEPOSIT_NETWORK: "robinhood-mainnet";
export declare const REPORT_DEPOSIT_USD_MINOR: string;
export declare const REPORT_DEPOSIT_REFUND_SILENT_DAYS: number;
export declare const REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS: number;
export declare const REPORT_DEPOSIT_KEEPING_CLOSES: readonly [
  "spam",
  "duplicate",
  "out-of-scope",
];
export declare const REPORT_DEPOSIT_SWITCHED_ON: boolean;

/** `keccak256(abi.encodePacked("slop-report-v1", utf8(caseId)))`, lowercase 0x hex. */
export declare function reportDepositItem(caseId: string): string;

/** SLOP base units for the deposit at a rate, rounded up to a whole SLOP; null without a rate. */
export declare function reportDepositAmount(
  slopPerUsd: string | null | undefined,
): string | null;

/** True unless the project turned it off. */
export declare function reportDepositOn(
  project:
    | { readonly security?: { readonly reportDeposit?: boolean } }
    | null
    | undefined,
): boolean;
