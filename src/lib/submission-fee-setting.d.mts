/** Types for a project's submission fee setting (PRD section 5). */

export type SubmissionFeeSetting = {
  readonly enabled: boolean;
  /** Six-decimal stablecoin base units; absent means the platform default. */
  readonly amountMinor?: string;
};

export declare const SUBMISSION_FEE_SETTING_LIMITS: Readonly<{
  defaultMinor: string;
  minMinor: string;
  maxMinor: string;
}>;
export declare const SUBMISSION_FEE_DECIMALS: number;
export declare const SUBMISSION_FEE_HINT: string;
export declare function submissionFeeAmountText(minor: string | bigint): string;
export declare function assertSubmissionFeeSetting(
  value: unknown,
  field: string,
): asserts value is SubmissionFeeSetting;
export declare function submissionFeeSetting(
  project:
    | {
        readonly slopbot?: { readonly submissionFee?: SubmissionFeeSetting };
      }
    | null
    | undefined,
): { amountMinor: string } | null;
export declare function submissionFeeAmountDraft(
  text: string,
):
  | { amountMinor: string; error: undefined }
  | { amountMinor: undefined; error: string };
