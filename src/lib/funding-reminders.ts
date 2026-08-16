/** Deterministic, non-custodial cycle and settler reminder copy. */

export type SettlementReminder =
  | { kind: "cycle-close"; message: string }
  | { kind: "overdue"; message: string }
  | { kind: "ready-to-sign"; message: string }
  | { kind: "settler-seven-day"; message: string };

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
  if (!Number.isFinite(close) || !Number.isFinite(current)) {
    throw new TypeError("settlement reminder timestamps are invalid");
  }
  if (settledAt !== null) return null;
  const elapsed = current - close;
  if (elapsed < -7 * DAY_MS) {
    return {
      kind: "cycle-close",
      message: `UTC cycle-close warning: this cycle closes ${utc(closesAt)} UTC.`,
    };
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
