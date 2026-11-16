/** Pure decisions used by browser workflows; parsing and effects stay with callers. */

export type ContributorAllocationDisposition =
  | "sent"
  | "scheduled"
  | "awaiting-wallet"
  | "unclaimed";

export function allocationDisposition(
  recordedTransfer: boolean,
  closed: boolean,
  registeredWallet: boolean,
  beforeDeadline: boolean,
): ContributorAllocationDisposition {
  //@ verify
  //@ ensures (\result === "sent") === recordedTransfer
  //@ ensures (\result === "unclaimed") === (!recordedTransfer && (closed || (!registeredWallet && !beforeDeadline)))
  //@ ensures (\result === "scheduled") === (!recordedTransfer && !closed && registeredWallet)
  //@ ensures (\result === "awaiting-wallet") === (!recordedTransfer && !closed && !registeredWallet && beforeDeadline)
  if (recordedTransfer) return "sent";
  if (closed) return "unclaimed";
  if (registeredWallet) return "scheduled";
  return beforeDeadline ? "awaiting-wallet" : "unclaimed";
}

export function transientHttpStatus(status: number): boolean {
  //@ verify
  //@ ensures \result === (status === 0 || status >= 500)
  //@ ensures status >= 400 && status < 500 ==> !\result
  return status === 0 || status >= 500;
}

export function freshCacheAge(age: number, lifetime: number): boolean {
  //@ verify
  //@ ensures \result === (age >= 0 && age < lifetime)
  //@ ensures age < 0 || age >= lifetime ==> !\result
  return age >= 0 && age < lifetime;
}

export function draftStillNeeded(
  localSubmission: boolean,
  hasAdvisory: boolean,
  state: string,
  terminalFailure: boolean,
): boolean {
  //@ verify
  //@ ensures \result === (localSubmission && !hasAdvisory && (state === "draft" || state === "submitting" || state === "uncertain" || (state === "failed" && !terminalFailure)))
  //@ ensures !localSubmission || hasAdvisory ==> !\result
  //@ ensures state === "failed" && terminalFailure ==> !\result
  //@ ensures \result ==> state === "draft" || state === "submitting" || state === "uncertain" || state === "failed"
  if (!localSubmission || hasAdvisory) return false;
  if (state === "draft" || state === "submitting" || state === "uncertain")
    return true;
  return state === "failed" && !terminalFailure;
}

export type ReminderLifecycle =
  | "closed-no-awards"
  | "external-provisional"
  | "live"
  | "paid"
  | "payment-ready"
  | "review"
  | "settlement-planned"
  | "wound-up";

export function fundingReminderVisible(
  monthlyPool: boolean,
  settled: boolean,
  state: ReminderLifecycle,
  elapsed: number,
): boolean {
  //@ verify
  //@ ensures \result === (monthlyPool && !settled && state !== "closed-no-awards" && state !== "external-provisional" && state !== "paid" && state !== "wound-up" && elapsed >= -604800000)
  //@ ensures \result ==> monthlyPool && !settled
  //@ ensures state === "closed-no-awards" || state === "external-provisional" || state === "paid" || state === "wound-up" ==> !\result
  //@ ensures elapsed < -604800000 ==> !\result
  return (
    monthlyPool &&
    !settled &&
    state !== "closed-no-awards" &&
    state !== "external-provisional" &&
    state !== "paid" &&
    state !== "wound-up" &&
    !(elapsed < -604_800_000)
  );
}

export function identityPollDelay(
  intervalSeconds: number,
  remaining: number,
): number {
  //@ verify
  //@ requires 1 <= intervalSeconds && intervalSeconds <= 10
  //@ ensures \result <= 10000 && \result <= remaining
  //@ ensures remaining >= 0 ==> \result >= 0
  //@ ensures remaining <= intervalSeconds * 1000 ==> \result === remaining
  //@ ensures intervalSeconds * 1000 <= remaining ==> \result === intervalSeconds * 1000
  return Math.min(intervalSeconds * 1000, remaining);
}

export function roundedUsdcCents(minor: bigint): bigint {
  //@ verify
  //@ requires minor >= 0n
  //@ ensures \result >= 0n
  //@ ensures \result * 10000n <= minor + 5000n
  //@ ensures minor + 5000n < (\result + 1n) * 10000n
  return (minor + 5_000n) / 10_000n;
}
