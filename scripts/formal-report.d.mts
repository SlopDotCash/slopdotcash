export interface FormalReportExpectation {
  checkoutRoot: string;
  model: string;
  sha256: string;
  sources: Record<string, string>;
  toolHashes: Record<string, string>;
  verify: boolean;
  commands: string[][];
  finiteTransition: Record<string, unknown>;
  safetyView: Record<string, unknown> | null;
  quintVersion: string;
  timeoutMs: number;
}
export function formalToolPaths(verify: boolean): string[];
export function formalTimeoutMs(model: string, verify: boolean): number;
export function formalStageArguments(
  model: string,
  verify: boolean,
  finiteTransition: { step: string } | null,
  temporalProperties?: string[],
): string[][];
export function formalReportProblems(
  report: unknown,
  expected: FormalReportExpectation,
): string[];

export function formalAdapterOverlaySha256(adapterSha256: string): string;
