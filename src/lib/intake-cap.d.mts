/** Types for a maintainer's intake cap (PRD section 5). */

export type IntakeCount = {
  /** Null or absent: the open count was not read for this repository yet. */
  readonly openOutside?: number | null;
  readonly observedAt: string | null;
};

export declare const INTAKE_CAP_LIMITS: Readonly<{ min: number; max: number }>;
export declare const INTAKE_COUNT_MAX_AGE_MS: number;
export declare const INTAKE_PAUSED_NOTICE: string;
export declare function assertIntakeCap(
  value: unknown,
  field: string,
): asserts value is number;
export declare function intakeCap(
  project:
    | { readonly slopbot?: { readonly intakeCap?: number } }
    | null
    | undefined,
): number | null;
export declare function countAtCap(
  cap: number,
  openOutside: number | null | undefined,
  observedAt: string | null | undefined,
  now: Date,
): boolean;
export declare function intakePaused(
  project: {
    readonly status: string;
    readonly slopbot?: { readonly intakeCap?: number };
  },
  rows: readonly IntakeCount[] | null | undefined,
  now: Date,
): boolean;
