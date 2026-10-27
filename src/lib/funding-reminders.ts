/** Deterministic, non-custodial cycle funding reminder copy. */

type CycleReminder = {
  kind: "funding-check";
  message: string;
};

type CycleReminderLifecycle =
  | "closed-no-awards"
  | "external-provisional"
  | "live"
  | "paid"
  | "payment-ready"
  | "review"
  | "settlement-planned"
  | "wound-up";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Remind the viewer to check current vault funding near cycle close. A public
 * cycle record and its manifest do not establish the monthly payment run's
 * funding state. Only that run can qualify obligations against current funds.
 * The inputs come from the validated cycle index and snapshot.
 */
export function cycleSettlementReminder(input: {
  closesAt: string;
  capMinor: string;
  kind: "external-prize-share" | "monthly-pool";
  now: string;
  settledAt: string | null;
  state: CycleReminderLifecycle;
}): CycleReminder | null {
  if (
    input.kind !== "monthly-pool" ||
    input.settledAt !== null ||
    input.state === "closed-no-awards" ||
    input.state === "external-provisional" ||
    input.state === "paid" ||
    input.state === "wound-up" ||
    Date.parse(input.now) - Date.parse(input.closesAt) < -7 * DAY_MS
  ) {
    return null;
  }
  if (BigInt(input.capMinor) === 0n) return null;
  return {
    kind: "funding-check",
    message: "This record does not verify the month's funding status.",
  };
}
