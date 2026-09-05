/** Deterministic, non-custodial cycle and settler reminder copy. */

export type SettlementReminder =
  | { kind: "accessibility-unknown"; message: string }
  | { kind: "cycle-close"; message: string }
  | { kind: "overdue"; message: string }
  | { kind: "ready-to-sign"; message: string }
  | { kind: "settler-seven-day"; message: string }
  | { kind: "unfunded"; message: string };

export type SettlementReminderLifecycle =
  | "closed-no-awards"
  | "external-provisional"
  | "live"
  | "paid"
  | "payment-ready"
  | "review"
  | "settlement-planned";

const DAY_MS = 24 * 60 * 60 * 1_000;

function utc(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function settlementReminder(
  closesAt: string,
  now: string,
  settledAt: string | null = null,
): SettlementReminder | null {
  const close = Date.parse(closesAt);
  const current = Date.parse(now);
  const settled = settledAt === null ? null : Date.parse(settledAt);
  if (
    !Number.isFinite(close) ||
    !Number.isFinite(current) ||
    (settled !== null && !Number.isFinite(settled))
  ) {
    throw new TypeError("settlement reminder timestamps are invalid");
  }
  if (settledAt !== null) return null;
  const elapsed = current - close;
  if (elapsed < -7 * DAY_MS) {
    return null;
  }
  if (elapsed < 0) {
    return {
      kind: "settler-seven-day",
      message: `Settler reminder: this cycle closes ${utc(closesAt)} UTC in seven days or less. Prepare the reviewed allocation; Slop will only create an unsigned plan.`,
    };
  }
  if (elapsed < DAY_MS) {
    return {
      kind: "cycle-close",
      message: `UTC cycle-close warning: this cycle closed ${utc(closesAt)} UTC. Review allocations now; the ready-to-sign reminder begins after 24 hours.`,
    };
  }
  if (elapsed <= 3 * DAY_MS) {
    return {
      kind: "ready-to-sign",
      message:
        "Ready-to-sign reminder: the declared settler should sign and broadcast the reviewed unsigned plan outside Slop. Slop never handles keys.",
    };
  }
  return {
    kind: "overdue",
    message:
      "Overdue settlement reminder: more than 72 hours have passed since UTC cycle close without reconciled settlement evidence.",
  };
}

/**
 * Suppresses signing language for cycles that never enter platform settlement
 * and distinguishes an unfunded pledge from committed but constrained funds.
 * Disabled payments never imply an absent commitment or a settlement deadline.
 */
export function cycleSettlementReminder(input: {
  closesAt: string;
  fundingState: "committed" | "pledged" | "external-opportunity";
  kind: "external-prize-share" | "monthly-pool";
  now: string;
  paymentMode: "disabled" | "enabled";
  settledAt: string | null;
  state: SettlementReminderLifecycle;
}): SettlementReminder | null {
  if (
    input.kind !== "monthly-pool" ||
    input.state === "closed-no-awards" ||
    input.state === "external-provisional" ||
    input.state === "paid"
  ) {
    return null;
  }
  const reminder = settlementReminder(
    input.closesAt,
    input.now,
    input.settledAt,
  );
  if (reminder === null) return null;
  if (input.paymentMode === "disabled") {
    if (input.fundingState === "committed") {
      return {
        kind: "accessibility-unknown",
        message:
          "Committed funding reminder: funds remain constrained; accessibility and payability are not proven. Payments are disabled pending a reviewed authenticated accessibility evidence protocol.",
      };
    }
    return {
      kind: "unfunded",
      message:
        "Unfunded pool reminder: no funding is committed and payments are disabled. Allocations remain projected; payments require reviewed accessibility evidence and activation.",
    };
  }
  return reminder;
}
