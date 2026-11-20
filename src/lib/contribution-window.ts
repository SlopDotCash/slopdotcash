/**
 * UTC calendar date in the same en-US form as `formatDate`.
 * A contribution window is the half-open UTC interval [from, to) (PRD
 * section 6: the period is the calendar UTC month). `to` is the first
 * excluded instant.
 */
function formatUtcDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

/** Inclusive dates of a half-open contribution window [from, to). */
export function formatContributionWindow(from: string, to: string): string {
  const lastIncluded = new Date(Date.parse(to) - 1).toISOString();
  return `${formatUtcDate(from)}–${formatUtcDate(lastIncluded)}`;
}
