import { fetchWithDeadline, readBoundedJson } from "./browser-json";

/** One repository row of `GET /api/v1/merge-activity` (#1993). */
export type RepositoryMergeActivity = {
  repository: string;
  observedAt: string;
  lastAttemptFailed: boolean;
  lastMergedAt: string | null;
  waitingOutside: number;
  waitingCapped: boolean;
  mergedOutsideLast30Days: number;
  medianHoursToMerge: number | null;
  /**
   * Open outside pull requests, answered or not, for the intake cap
   * (src/lib/intake-cap.mjs). Null or absent until the repository is read
   * again after the count was added.
   */
  openOutside?: number | null;
  openOutsideCapped?: boolean;
};

export type MergeActivityIndex = Map<string, RepositoryMergeActivity[]>;

function isRow(value: unknown): value is RepositoryMergeActivity {
  const row = value as RepositoryMergeActivity;
  const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  return (
    !!row &&
    typeof row.repository === "string" &&
    !Number.isNaN(Date.parse(row.observedAt)) &&
    typeof row.lastAttemptFailed === "boolean" &&
    (row.lastMergedAt === null ||
      !Number.isNaN(Date.parse(row.lastMergedAt))) &&
    count(row.waitingOutside) &&
    typeof row.waitingCapped === "boolean" &&
    count(row.mergedOutsideLast30Days) &&
    (row.openOutside === undefined ||
      row.openOutside === null ||
      count(row.openOutside)) &&
    (row.openOutsideCapped === undefined ||
      typeof row.openOutsideCapped === "boolean") &&
    (row.medianHoursToMerge === null ||
      (typeof row.medianHoursToMerge === "number" &&
        row.medianHoursToMerge >= 0))
  );
}

export async function loadMergeActivity(
  signal: AbortSignal,
): Promise<{ index: MergeActivityIndex }> {
  const response = await fetchWithDeadline("/api/v1/merge-activity", {
    signal,
  });
  if (!response.ok) throw new Error("Merge activity unavailable");
  const value = (await readBoundedJson(
    response,
    1_048_576,
    "merge activity",
  )) as {
    schema?: unknown;
    projects?: Array<{ projectId?: unknown; repositories?: unknown }>;
  } | null;
  if (
    value?.schema !== "slop-merge-activity-v1" ||
    !Array.isArray(value.projects)
  )
    throw new Error("Merge activity could not be read");
  const index: MergeActivityIndex = new Map();
  for (const project of value.projects) {
    if (
      typeof project?.projectId !== "string" ||
      !Array.isArray(project.repositories) ||
      !project.repositories.every(isRow)
    )
      throw new Error("Merge activity could not be read");
    index.set(project.projectId, project.repositories);
  }
  return { index };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ago(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function duration(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 48) {
    const rounded = Math.round(hours);
    return rounded === 1 ? "1 hour" : `${rounded} hours`;
  }
  const days = Math.round(hours / 24);
  return `${days} days`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** The one-line merge summary for a project's repositories, or null when none was read. */
export function mergeActivityLine(
  rows: readonly RepositoryMergeActivity[] | undefined,
  now: Date,
): string | null {
  if (!rows?.length) return null;
  let last: string | null = null;
  let waiting = 0;
  let capped = false;
  let observed = rows[0].observedAt;
  let busiest = rows[0];
  for (const row of rows) {
    if (row.lastMergedAt && (last === null || row.lastMergedAt > last))
      last = row.lastMergedAt;
    waiting += row.waitingOutside;
    capped ||= row.waitingCapped;
    if (row.observedAt < observed) observed = row.observedAt;
    if (row.mergedOutsideLast30Days > busiest.mergedOutsideLast30Days)
      busiest = row;
  }
  const parts = [
    last ? `last merge ${ago(last, now)}` : "no merge found",
    waiting === 0
      ? "no outside pull request waiting 7+ days"
      : `${waiting}${capped ? "+" : ""} outside pull ${
          waiting === 1 && !capped ? "request" : "requests"
        } waiting 7+ days for a maintainer`,
    busiest.medianHoursToMerge === null || busiest.mergedOutsideLast30Days === 0
      ? "no outside pull request merged in 30 days"
      : `outside pull requests merged in a median ${duration(
          busiest.medianHoursToMerge,
        )} (30 days)`,
    `checked ${shortDate(observed)}`,
  ];
  return `Merging: ${parts.join(" · ")}`;
}

/** The short card form: last merge, waiting outside pull requests, median. */
export function mergeActivityCardLine(
  rows: readonly RepositoryMergeActivity[] | undefined,
  now: Date,
): string | null {
  if (!rows?.length) return null;
  let last: string | null = null;
  let waiting = 0;
  let capped = false;
  let busiest = rows[0];
  for (const row of rows) {
    if (row.lastMergedAt && (last === null || row.lastMergedAt > last))
      last = row.lastMergedAt;
    waiting += row.waitingOutside;
    capped ||= row.waitingCapped;
    if (row.mergedOutsideLast30Days > busiest.mergedOutsideLast30Days)
      busiest = row;
  }
  const parts = [
    last ? `Last merge ${ago(last, now)}` : "No merge found",
    `${waiting}${capped ? "+" : ""} outside ${
      waiting === 1 && !capped ? "PR" : "PRs"
    } waiting 7+ days`,
  ];
  if (
    busiest.medianHoursToMerge !== null &&
    busiest.mergedOutsideLast30Days > 0
  )
    parts.push(`median merge ${duration(busiest.medianHoursToMerge)}`);
  return parts.join(" · ");
}
