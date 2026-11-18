/** Protected Pages timing metadata. A correlation is a fresh operator nonce. */
export const INTAKE_CORRELATION_HEADER = "x-slop-intake-correlation";
export const MAX_INTAKE_BODY_BYTES = 33 * 1024 * 1024;

export function isIntakeCorrelation(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

const phases = [
  "owner-admitted",
  "body-eof",
  "parsed",
  "heartbeat-queued",
  "rpc-dispatch",
  "terminal",
] as const;
type IntakePhase = (typeof phases)[number];
type IntakeStatus = 200 | 400 | 409;
type Milestone = {
  event: "historical-intake-pages-milestone";
  correlation: string;
  phase: IntakePhase;
  elapsedMs: number;
  bodyBytes: number | null;
  terminalStatus: IntakeStatus | null;
};
const knownPhases = new Set<string>(phases);

export function pagesIntakeObserver(correlation: string, start: number) {
  return (
    phase: IntakePhase,
    {
      bodyBytes = null,
      terminalStatus = null,
    }: {
      bodyBytes?: number | null;
      terminalStatus?: IntakeStatus | null;
    } = {},
  ) => {
    try {
      const event: Milestone = {
        event: "historical-intake-pages-milestone",
        correlation,
        phase,
        elapsedMs: Math.round(performance.now() - start),
        bodyBytes,
        terminalStatus,
      };
      console.log(JSON.stringify(event));
    } catch {
      // Diagnostic loss must not change the intake result.
    }
  };
}

/** Only the exact opted-in correlation and complete fixed shape can leave the inspector. */
export function projectPagesIntakeMilestone(
  value: unknown,
  correlation: string,
): Milestone | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Milestone;
  if (
    Object.keys(row).sort().join() !==
      "bodyBytes,correlation,elapsedMs,event,phase,terminalStatus" ||
    row.event !== "historical-intake-pages-milestone" ||
    !isIntakeCorrelation(row.correlation) ||
    row.correlation !== correlation ||
    !knownPhases.has(row.phase) ||
    !Number.isSafeInteger(row.elapsedMs) ||
    row.elapsedMs < 0 ||
    (row.phase === "body-eof"
      ? row.bodyBytes === null ||
        !Number.isSafeInteger(row.bodyBytes) ||
        row.bodyBytes < 0 ||
        row.bodyBytes > MAX_INTAKE_BODY_BYTES
      : row.bodyBytes !== null) ||
    (row.phase === "terminal"
      ? row.terminalStatus !== 200 &&
        row.terminalStatus !== 400 &&
        row.terminalStatus !== 409
      : row.terminalStatus !== null)
  )
    return null;
  return {
    event: row.event,
    correlation: row.correlation,
    phase: row.phase,
    elapsedMs: row.elapsedMs,
    bodyBytes: row.bodyBytes,
    terminalStatus: row.terminalStatus,
  };
}
