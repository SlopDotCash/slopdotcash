// spec/operations/notifications.md, "A failed or overdue case notice escalates once to a backup with current access"; spec/slopbot/spendAlerts.md, "One claim per run, in order, and an ambiguous send is never resent"
/** @throws {RangeError} */
export function utcText(millis: number): string {
  return new Date(millis).toUTCString();
}
