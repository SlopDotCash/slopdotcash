/** Types for the slopbot:ready label settings (PRD section 5). */

export type ReadyLabelSettings = {
  readonly enabled: boolean;
  readonly approvals: number;
  readonly maxChangedLines: number;
  readonly maxChangedFiles: number;
  readonly protectedPaths: readonly string[];
};

export declare const READY_LABEL_LIMITS: Readonly<{
  minApprovals: number;
  maxApprovals: number;
  minChangedLines: number;
  maxChangedLines: number;
  minChangedFiles: number;
  maxChangedFiles: number;
  maxProtectedPaths: number;
  maxProtectedPathLength: number;
}>;
export declare const READY_LABEL_DEFAULTS: Readonly<{
  approvals: number;
  maxChangedLines: number;
  maxChangedFiles: number;
}>;
export declare function protectedPathProblem(pattern: unknown): string | null;
export declare function assertReadyLabelSettings(
  value: unknown,
  field: string,
): asserts value is ReadyLabelSettings;
export declare function readyLabelSettings(
  project:
    | { readonly slopbot?: { readonly readyLabel?: ReadyLabelSettings } }
    | null
    | undefined,
): ReadyLabelSettings | null;
