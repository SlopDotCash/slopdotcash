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
  events: ProfileIssueEvent[];
}
export interface ProfileIssueHistory {
  firstObservedAt: string;
  repositories: { repository: string; count: number }[];
  items: ProfileIssue[];
}
export function assertProfiles(value: unknown): asserts value is ProfileIndex {
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
  const targets = TARGET_REPOSITORIES.map((r) => r.id).sort();
  if (
    JSON.stringify(v.repositories.map((r) => r.repository).sort()) !==
    JSON.stringify(targets)
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
        !targets.includes(r.repository) ||
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
  if (v.schemaVersion === "2") assertProfileIssues(v);
  else if (v.issues !== undefined)
    throw Error("Unexpected legacy issue census");
}

function assertProfileIssues(index: ProfileIndex) {
  const history = index.issues;
  const time = (value: string) =>
    typeof value === "string" && Number.isFinite(Date.parse(value));
  if (
    !history ||
    !time(history.firstObservedAt) ||
    Date.parse(history.firstObservedAt) > Date.parse(index.generatedAt) ||
    !Array.isArray(history.repositories) ||
    !Array.isArray(history.items)
  )
    throw Error("Invalid issue history coverage");
  const targets = TARGET_REPOSITORIES.map((r) => r.id).sort();
  if (
    JSON.stringify(history.repositories.map((r) => r.repository).sort()) !==
    JSON.stringify(targets)
  )
    throw Error("Issue repository inventory mismatch");
  const people = new Set(index.people.map((p) => p.id));
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  const reason = (value: string | null) =>
    value === null ||
    (typeof value === "string" && /^[A-Z_]{1,64}$/.test(value));
  for (const issue of history.items) {
    if (
      !issue ||
      typeof issue.id !== "string" ||
      !issue.id ||
      ids.has(issue.id) ||
      !targets.includes(issue.repository) ||
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
      !Array.isArray(issue.events)
    )
      throw Error("Invalid issue history record");
    ids.add(issue.id);
    if (issue.unavailableSince === null)
      counts.set(issue.repository, (counts.get(issue.repository) ?? 0) + 1);
    const events = new Set<string>();
    let previous = Date.parse(issue.createdAt);
    let state = "OPEN";
    let stateReason: string | null = null;
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
      if (event.kind === "closed" || event.kind === "reopened") {
        state = event.kind === "closed" ? "CLOSED" : "OPEN";
        stateReason = event.reason;
      }
    }
    if (state !== issue.state || stateReason !== issue.reason)
      throw Error("Issue history does not reconcile with its current state");
  }
  for (const row of history.repositories)
    if (
      !Number.isSafeInteger(row.count) ||
      row.count < 0 ||
      (counts.get(row.repository) ?? 0) !== row.count
    )
      throw Error("Incomplete issue census");
}

/** Diagnostic outcomes only; these counts never change score or money. */
export function profileIssueOutcomes(
  issues: readonly ProfileIssue[],
  actorId: string,
  repository?: string,
  period?: string,
) {
  if (period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
    throw Error("Invalid UTC outcome period");
  const end =
    period === undefined
      ? Infinity
      : Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1);
  const counts = {
    open: 0,
    reopened: 0,
    completed: 0,
    notPlanned: 0,
    duplicate: 0,
    unknown: 0,
    transferred: 0,
    unavailable: 0,
    corrected: 0,
  };
  for (const issue of issues) {
    if (
      issue.authorId !== actorId ||
      (repository !== undefined && issue.repository !== repository) ||
      Date.parse(issue.createdAt) >= end
    )
      continue;
    const history = issue.events
      .filter((event) => Date.parse(event.occurredAt) < end)
      .reverse();
    const transition = history.find(
      (event) => event.kind === "closed" || event.kind === "reopened",
    );
    // A monthly result uses the last transition as of month end and only
    // counts issues whose creation/transition occurred in that UTC month.
    const occurredAt = transition?.occurredAt ?? issue.createdAt;
    if (
      period !== undefined &&
      new Date(occurredAt).toISOString().slice(0, 7) !== period
    )
      continue;
    if (issue.unavailableSince !== null) {
      counts.unavailable++;
      continue;
    }
    if (issue.correctedAt !== null) counts.corrected++;
    if (history.some((event) => event.kind === "transferred"))
      counts.transferred++;
    if (transition?.kind !== "closed") {
      if (transition?.kind === "reopened") counts.reopened++;
      else counts.open++;
      continue;
    }
    // GitHub also places these events on the canonical issue. That issue
    // must not become a duplicate because another issue points to it.
    const duplicate = history.find(
      (event) =>
        (event.kind === "duplicate" || event.kind === "unmarked-duplicate") &&
        event.relatedIssueId !== null &&
        event.relatedIssueId !== issue.id,
    );
    if (transition.reason === "DUPLICATE" || duplicate?.kind === "duplicate")
      counts.duplicate++;
    else if (transition.reason === "COMPLETED") counts.completed++;
    else if (transition.reason === "NOT_PLANNED") counts.notPlanned++;
    else counts.unknown++;
  }
  return counts;
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
