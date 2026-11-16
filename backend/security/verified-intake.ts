/** Actual persisted intake states, independent of transport or authority. */
export type IntakeScreeningState =
  | "queued"
  | "running"
  | "legitimate"
  | "needs-information"
  | "spam"
  | "unavailable";

export type IntakeReviewState =
  | { kind: "unreviewed" }
  | { kind: "forward" }
  | { kind: "request-information" }
  | { kind: "other" };

export interface IntakeQualification {
  review: IntakeReviewState;
  screening: string;
}

export type IntakeScreeningClock =
  | { kind: "invalid" }
  | { kind: "known"; now: bigint; started: bigint };

export type IntakeRecovery =
  | { state: "running"; clock: IntakeScreeningClock }
  | { state: "queued" }
  | { state: "unavailable" }
  | { state: "legitimate" }
  | { state: "needs-information" }
  | { state: "spam" };

/** Preserve absent human review distinctly from both explicit decisions. */
//@ verify
//@ pure
//@ ensures decision == null <==> \result.kind == "unreviewed"
//@ ensures decision == "forward" <==> \result.kind == "forward"
//@ ensures decision == "request-information" <==> \result.kind == "request-information"
export function intakeReviewState(decision: string | null): IntakeReviewState {
  if (decision === null) return { kind: "unreviewed" };
  if (decision === "forward") return { kind: "forward" };
  return decision === "request-information"
    ? { kind: "request-information" }
    : { kind: "other" };
}

/** An explicit human decision takes precedence over automatic screening. */
//@ verify
//@ pure
//@ ensures \result <==> input.review.kind == "forward" || (input.review.kind == "unreviewed" && input.screening == "legitimate")
//@ ensures input.review.kind == "forward" ==> \result
//@ ensures input.review.kind == "request-information" ==> !\result
//@ ensures input.review.kind == "other" ==> !\result
//@ ensures input.review.kind == "unreviewed" && input.screening != "legitimate" ==> !\result
export function qualifiedIntake(input: IntakeQualification): boolean {
  return (
    input.review.kind === "forward" ||
    (input.review.kind === "unreviewed" && input.screening === "legitimate")
  );
}

/** Retry queued/unavailable work, or a running screen strictly past its age. */
//@ verify
//@ pure
//@ requires maximumAge >= 0
//@ ensures \result <==> input.state == "queued" || input.state == "unavailable" || (input.state == "running" && input.clock.kind == "known" && input.clock.now - input.clock.started > maximumAge)
//@ ensures input.state == "running" && input.clock.kind == "invalid" ==> !\result
//@ ensures input.state == "running" && input.clock.kind == "known" && input.clock.now - input.clock.started <= maximumAge ==> !\result
//@ ensures input.state == "legitimate" || input.state == "needs-information" || input.state == "spam" ==> !\result
export function recoverableIntakeScreening(
  input: IntakeRecovery,
  maximumAge: bigint,
): boolean {
  if (input.state === "queued" || input.state === "unavailable") return true;
  if (input.state !== "running" || input.clock.kind !== "known") return false;
  return input.clock.now - input.clock.started > maximumAge;
}
