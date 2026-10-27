import {
  findHistoricalRepository,
  isHistoricalRepositoryId,
} from "./projects.mjs";
import { TARGET_REPOSITORIES } from "./repositories.mjs";
export interface ProfileRecord {
  id: string;
  login: string;
  avatarUrl: string;
  repositories: {
    repository: string;
    merged: number;
    open: number;
    closed: number;
  }[];
}
export interface ProfileIndex {
  schemaVersion: "1" | "2";
  startedAt: string;
  generatedAt: string;
  /**
   * Every collected repository, plus the last census of a registered or
   * legacy repository that is no longer collected. Those counts are carried
   * unchanged, so a removed project does not erase contributor history.
   */
  repositories: { repository: string; count: number; excluded: number }[];
  people: ProfileRecord[];
  issues?: ProfileIssueHistory;
}
export interface ProfileIssueEvent {
  id: string;
  kind:
    | "closed"
    | "reopened"
    | "duplicate"
    | "unmarked-duplicate"
    | "transferred";
  occurredAt: string;
  reason: string | null;
  relatedIssueId: string | null;
}
export interface ProfileIssue {
  id: string;
  repository: string;
  number: number;
  authorId: string | null;
  createdAt: string;
  observedAt: string;
  state: "OPEN" | "CLOSED";
  reason: string | null;
  unavailableSince: string | null;
  correctedAt: string | null;
  /**
   * First observed when the visible events stopped reproducing the current
   * state, e.g. GitHub hides events by an account that is no longer
   * available. Absent on records published before this field existed.
   */
  historyIncompleteSince?: string | null;
  events: ProfileIssueEvent[];
}
export interface ProfileIssueHistory {
  firstObservedAt: string;
  repositories: { repository: string; count: number }[];
  items: ProfileIssue[];
  /**
   * Unchanged records of registered repositories outside this census, such as
   * a paused project's issues. They are not displayed; a reactivated project
   * resumes their history.
   */
  archived?: ProfileIssue[];
}
/**
 * `targets` defaults to the current active repositories. A previous census
 * may predate an activation or retirement, so its caller passes its own
 * registered inventory instead.
 */
export function assertProfiles(
  value: unknown,
  targets: readonly string[] = TARGET_REPOSITORIES.map((r) => r.id),
): asserts value is ProfileIndex {
  const v = value as ProfileIndex;
  const validCount = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (
    !v ||
    !["1", "2"].includes(v.schemaVersion) ||
    !Number.isFinite(Date.parse(v.startedAt)) ||
    !Number.isFinite(Date.parse(v.generatedAt)) ||
    Date.parse(v.startedAt) > Date.parse(v.generatedAt) ||
    !Array.isArray(v.people) ||
    !Array.isArray(v.repositories)
  )
    throw Error("Invalid profile census");
  // Every collected repository is present. A repository outside the census
  // keeps its last counts only when it is registered or legacy history.
  const inventory = new Set(v.repositories.map((r) => r.repository));
  if (
    inventory.size !== v.repositories.length ||
    !targets.every((id) => inventory.has(id)) ||
    ![...inventory].every(
      (id) => targets.includes(id) || isHistoricalRepositoryId(id),
    )
  )
    throw Error("Profile repository inventory mismatch");
  const ids = new Set<string>();
  const totals = new Map<string, number>();
  for (const p of v.people) {
    if (
      !p ||
      typeof p.id !== "string" ||
      typeof p.login !== "string" ||
      !/^[A-Za-z0-9_=-]{4,256}$/.test(p.id) ||
      ids.has(p.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(p.login) ||
      !Array.isArray(p.repositories)
    )
      throw Error("Invalid profile identity");
    ids.add(p.id);
    const url = new URL(p.avatarUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "avatars.githubusercontent.com" ||
      url.username ||
      url.password ||
      url.port
    )
      throw Error("Invalid profile image");
    const repos = new Set<string>();
    for (const r of p.repositories) {
      if (
        !inventory.has(r.repository) ||
        repos.has(r.repository) ||
        ![r.merged, r.open, r.closed].every(validCount)
      )
        throw Error("Invalid profile counts");
      repos.add(r.repository);
      totals.set(
        r.repository,
        (totals.get(r.repository) ?? 0) + r.merged + r.open + r.closed,
      );
    }
  }
  for (const r of v.repositories)
    if (
      ![r.count, r.excluded].every(validCount) ||
      (totals.get(r.repository) ?? 0) + r.excluded !== r.count
    )
      throw Error("Incomplete profile census");
  if (v.schemaVersion === "2") assertProfileIssues(v, targets);
  else if (v.issues !== undefined)
    throw Error("Unexpected legacy issue census");
}

function assertProfileIssues(index: ProfileIndex, targets: readonly string[]) {
  const history = index.issues;
  const time = (value: string) =>
    typeof value === "string" && Number.isFinite(Date.parse(value));
  if (
    !history ||
    !time(history.firstObservedAt) ||
    Date.parse(history.firstObservedAt) > Date.parse(index.generatedAt) ||
    !Array.isArray(history.repositories) ||
    !Array.isArray(history.items) ||
    (history.archived !== undefined && !Array.isArray(history.archived))
  )
    throw Error("Invalid issue history coverage");
  if (
    JSON.stringify(history.repositories.map((r) => r.repository).sort()) !==
    JSON.stringify([...targets].sort())
  )
    throw Error("Issue repository inventory mismatch");
  const people = new Set(index.people.map((p) => p.id));
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  const reason = (value: string | null) =>
    value === null ||
    (typeof value === "string" && /^[A-Z_]{1,64}$/.test(value));
  const records = [...history.items, ...(history.archived ?? [])];
  for (const [position, issue] of records.entries()) {
    const archived = position >= history.items.length;
    if (
      !issue ||
      typeof issue.id !== "string" ||
      !issue.id ||
      ids.has(issue.id) ||
      (archived
        ? targets.includes(issue.repository) ||
          !isHistoricalRepositoryId(issue.repository)
        : !targets.includes(issue.repository)) ||
      !Number.isSafeInteger(issue.number) ||
      issue.number <= 0 ||
      (issue.authorId !== null && !people.has(issue.authorId)) ||
      !time(issue.createdAt) ||
      !time(issue.observedAt) ||
      Date.parse(issue.createdAt) > Date.parse(issue.observedAt) ||
      Date.parse(issue.observedAt) > Date.parse(index.generatedAt) ||
      !["OPEN", "CLOSED"].includes(issue.state) ||
      !reason(issue.reason) ||
      (issue.unavailableSince !== null &&
        (!time(issue.unavailableSince) ||
          Date.parse(issue.unavailableSince) < Date.parse(issue.observedAt))) ||
      (issue.correctedAt !== null &&
        (!time(issue.correctedAt) ||
          Date.parse(issue.correctedAt) > Date.parse(issue.observedAt))) ||
      (issue.historyIncompleteSince != null &&
        (!time(issue.historyIncompleteSince) ||
          Date.parse(issue.historyIncompleteSince) <
            Date.parse(issue.createdAt) ||
          Date.parse(issue.historyIncompleteSince) >
            Date.parse(issue.observedAt))) ||
      !Array.isArray(issue.events)
    )
      throw Error("Invalid issue history record");
    ids.add(issue.id);
    if (!archived && issue.unavailableSince === null)
      counts.set(issue.repository, (counts.get(issue.repository) ?? 0) + 1);
    const events = new Set<string>();
    let previous = Date.parse(issue.createdAt);
    for (const event of issue.events) {
      if (
        !event ||
        typeof event.id !== "string" ||
        !event.id ||
        events.has(event.id) ||
        ![
          "closed",
          "reopened",
          "duplicate",
          "unmarked-duplicate",
          "transferred",
        ].includes(event.kind) ||
        !time(event.occurredAt) ||
        Date.parse(event.occurredAt) < previous ||
        Date.parse(event.occurredAt) > Date.parse(issue.observedAt) ||
        !reason(event.reason) ||
        (event.relatedIssueId !== null &&
          (typeof event.relatedIssueId !== "string" || !event.relatedIssueId))
      )
        throw Error("Invalid or incomplete issue event history");
      events.add(event.id);
      previous = Date.parse(event.occurredAt);
    }
    // A visible history that cannot reproduce the current state must say so,
    // and a record flagged as incomplete must actually be incomplete.
    const incomplete = issue.historyIncompleteSince != null;
    if (issueHistoryReconciles(issue) === incomplete)
      throw Error(
        incomplete
          ? "Issue history is flagged incomplete but reconciles"
          : "Issue history does not reconcile with its current state",
      );
  }
  for (const row of history.repositories)
    if (
      !Number.isSafeInteger(row.count) ||
      row.count < 0 ||
      (counts.get(row.repository) ?? 0) !== row.count
    )
      throw Error("Incomplete issue census");
}

/** Whether replaying the visible transitions reproduces the current state. */
export function issueHistoryReconciles(
  issue: Pick<ProfileIssue, "state" | "reason" | "events">,
) {
  let state = "OPEN";
  let reason: string | null = null;
  for (const event of issue.events)
    if (event.kind === "closed" || event.kind === "reopened") {
      state = event.kind === "closed" ? "CLOSED" : "OPEN";
      reason = event.reason;
    }
  return state === issue.state && reason === issue.reason;
}

export function profileCounts(p: ProfileRecord) {
  return p.repositories.reduce(
    (a, r) => ({
      merged: a.merged + r.merged,
      open: a.open + r.open,
      closed: a.closed + r.closed,
    }),
    { merged: 0, open: 0, closed: 0 },
  );
}

/** Canonical repository behind a census repository name, if it resolves. */
export function profileCanonicalRepository(repository: string): string | null {
  return (
    findHistoricalRepository(repository)?.repositoryId.toLowerCase() ?? null
  );
}

/** Canonical identities behind the currently collected repositories. */
export function collectedProfileRepositories(
  collected: readonly string[],
): ReadonlySet<string> {
  return new Set(
    collected
      .map(profileCanonicalRepository)
      .filter((project): project is string => project !== null),
  );
}

/**
 * True when a previous census row survives into the next census. A renamed
 * repository is collected under its current name, but a previous census
 * names it by the name it had then; both names resolve to the same canonical
 * repository, so the old row is replaced by the fresh full collection instead
 * of added to it. Rows for retired projects, and rows the registry does not
 * know, are still carried, preserving the archived-issue-history rule.
 */
export function isCarriedProfileRepository(
  repository: string,
  collected: ReadonlySet<string>,
  collectedRepositories: ReadonlySet<string>,
): boolean {
  if (collected.has(repository)) return false;
  const project = profileCanonicalRepository(repository);
  return project === null || !collectedRepositories.has(project);
}
