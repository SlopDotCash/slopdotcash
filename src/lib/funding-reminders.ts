/** Deterministic, non-custodial cycle funding reminder copy. */
import {
  fundingReminderVisible,
  type ReminderLifecycle,
} from "./verified-frontend";

type CycleReminder = {
  kind: "funding-check";
  message: string;
};

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
  state: ReminderLifecycle;
}): CycleReminder | null {
  if (
    !fundingReminderVisible(
      input.kind === "monthly-pool",
      input.settledAt !== null,
      input.state,
      Date.parse(input.now) - Date.parse(input.closesAt),
    )
  ) {
    return null;
  }
  if (BigInt(input.capMinor) === 0n) return null;
  return {
    kind: "funding-check",
    message: "This record does not verify the month's funding status.",
  };
}
