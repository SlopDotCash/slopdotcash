// spec/backend/mergeActivity.md, "A bounded daily run reads due repositories of active projects"
export const backlogWaitingLimit = 50;
export const dormantAfterDays = 14;
export const dormantWarningAfterDays = 10;
export const catchUpMaxDays = 14;
export const backlogRuleFrom = "2026-12-01T00:00:00.000Z";
export const catchUpHistoryMax = 240;
export const intakeCountMaxAgeMs = 72 * 60 * 60 * 1000;

const dayMs = 24 * 60 * 60 * 1000;
const ruleFromMs = Date.parse(backlogRuleFrom);
const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface BacklogCountRow {
  readonly observedAt: string;
  readonly waitingOutside: number | null;
  readonly lastMergedAt: string | null;
}

export interface CatchUpEntry {
  readonly startedAt: string;
}

export interface BacklogSlopbotSettings {
  readonly catchUpUntil?: string | null;
  readonly catchUpHistory?: ReadonlyArray<CatchUpEntry>;
}

export interface BacklogProjectManifest {
  readonly id?: string;
  readonly status?: string;
  readonly listingTier?: string;
  readonly reward?: { readonly kind?: string; readonly monthlyCapMinor?: string } | null;
  readonly securityBounty?: { readonly rewardMode?: string } | null;
  readonly slopbot?: BacklogSlopbotSettings | null;
}

export interface BacklogFigures {
  readonly waiting: number;
  readonly lastMergedAt: string | null;
}

export type BacklogReason = "backlog" | "dormant" | null;

export interface BacklogState {
  readonly judged: boolean;
  readonly figures: BacklogFigures | null;
  readonly daysSinceMerge: number | null;
  readonly reason: BacklogReason;
  readonly catchingUpUntil: string | null;
  readonly started: boolean;
  readonly wouldBeOut: boolean;
  readonly outOfRotation: boolean;
}

function isInstant(value: unknown): value is string {
  return (
    typeof value === "string"
    && isoInstant.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value
  );
}

export function securityOnly(project: BacklogProjectManifest | null | undefined): boolean {
  const program = project?.securityBounty;
  return (
    program !== undefined
    && program !== null
    && (program.rewardMode === "bounty-only" || project?.reward?.monthlyCapMinor === "0")
  );
}

export function backlogJudged(project: BacklogProjectManifest | null | undefined): boolean {
  return (
    project !== undefined
    && project !== null
    && project.status === "active"
    && project.listingTier !== "retired"
    && project.reward?.kind === "monthly-pool"
    && !securityOnly(project)
  );
}

export function backlogRuleStarted(nowMs: number): boolean {
  return nowMs >= ruleFromMs;
}

export function backlogFigures(rows: ReadonlyArray<BacklogCountRow> | undefined, nowMs: number): BacklogFigures | null {
  if (rows === undefined) return null;
  let waiting = 0;
  let lastMergedAt: string | null = null;
  let fresh = false;
  for (const row of rows) {
    const observed = Date.parse(row.observedAt);
    if (
      !Number.isFinite(observed)
      || nowMs - observed > intakeCountMaxAgeMs
      || row.waitingOutside === null
      || !Number.isSafeInteger(row.waitingOutside)
      || row.waitingOutside < 0
    ) continue;
    fresh = true;
    waiting += row.waitingOutside;
    const merged = row.lastMergedAt;
    if (
      merged !== null
      && !Number.isNaN(Date.parse(merged))
      && (lastMergedAt === null || Date.parse(merged) > Date.parse(lastMergedAt))
    ) {
      lastMergedAt = merged;
    }
  }
  return fresh ? { waiting, lastMergedAt } : null;
}

export function catchUpEnd(project: BacklogProjectManifest | null | undefined, nowMs: number): string | null {
  const until = project?.slopbot?.catchUpUntil;
  return isInstant(until) && Date.parse(until) > nowMs ? until : null;
}

function daysSince(iso: string | null, nowMs: number): number | null {
  return iso === null ? null : Math.floor((nowMs - Date.parse(iso)) / dayMs);
}

export function backlogState(project: BacklogProjectManifest | null | undefined, rows: ReadonlyArray<BacklogCountRow> | undefined, nowMs: number): BacklogState {
  const judged = backlogJudged(project);
  const figures = judged ? backlogFigures(rows, nowMs) : null;
  const sinceMerge = figures === null ? null : daysSince(figures.lastMergedAt, nowMs);
  let reason: BacklogReason = null;
  if (figures !== null) {
    if (figures.waiting >= backlogWaitingLimit) reason = "backlog";
    else if (figures.waiting >= 1 && (sinceMerge === null || sinceMerge >= dormantAfterDays)) reason = "dormant";
  }
  const catchingUpUntil = judged ? catchUpEnd(project, nowMs) : null;
  const wouldBeOut = reason !== null && catchingUpUntil === null;
  const started = backlogRuleStarted(nowMs);
  return {
    judged,
    figures,
    daysSinceMerge: sinceMerge,
    reason,
    catchingUpUntil,
    started,
    wouldBeOut,
    outOfRotation: wouldBeOut && started,
  };
}

export function backlogOutOfRotation(project: BacklogProjectManifest | null | undefined, rows: ReadonlyArray<BacklogCountRow> | undefined, nowMs: number): boolean {
  return backlogState(project, rows, nowMs).outOfRotation;
}

export function dormancyNear(state: BacklogState): boolean {
  return (
    state.judged
    && state.reason === null
    && state.catchingUpUntil === null
    && state.figures !== null
    && state.figures.waiting >= 1
    && state.daysSinceMerge !== null
    && state.daysSinceMerge >= dormantWarningAfterDays
    && state.daysSinceMerge < dormantAfterDays
  );
}

function pullRequests(count: number): string {
  return count === 1 ? "1 outside pull request" : `${count} outside pull requests`;
}

function reasonText(state: BacklogState): string {
  const waiting = state.figures?.waiting ?? 0;
  return state.reason === "backlog"
    ? `${pullRequests(waiting)} have waited a week or more for a maintainer`
    : `no pull request has been merged in ${dormantAfterDays} days while outside pull requests wait`;
}

export function backlogPreviewDetail(state: BacklogState): string {
  return `From 1 December 2026, a project with ${backlogWaitingLimit} or more outside pull requests waiting a week for a maintainer, or no merge in ${dormantAfterDays} days while outside pull requests wait, leaves the home page, /sponsors and agent discovery until that is fixed. Your project would leave today: ${reasonText(state)}. You can mark it as catching up on reviews for up to ${catchUpMaxDays} days from its settings.`;
}

export function backlogWarningDetail(state: BacklogState): string {
  return `No pull request has been merged in ${state.daysSinceMerge} days while outside pull requests wait. After ${dormantAfterDays} days the project leaves the home page, /sponsors and agent discovery until a maintainer merges. You can mark it as catching up on reviews for up to ${catchUpMaxDays} days from its settings.`;
}

export function backlogOutDetail(state: BacklogState): string {
  return `Your project left the home page, /sponsors and agent discovery: ${reasonText(state)}. It returns by itself once ${
    state.reason === "backlog" ? `fewer than ${backlogWaitingLimit} wait` : "a maintainer merges"
  }. You can mark it as catching up on reviews for up to ${catchUpMaxDays} days from its settings. Accepted work still records points.`;
}

export function utcMonth(iso: string): string {
  return iso.slice(0, 7);
}

export function catchUpOfferedEnd(nowMs: number): string {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + catchUpMaxDays)).toISOString();
}

export function catchUpStartAllowed(project: BacklogProjectManifest | null | undefined, nowMs: number): boolean {
  const month = utcMonth(new Date(nowMs).toISOString());
  return !(project?.slopbot?.catchUpHistory ?? []).some((entry) => utcMonth(entry.startedAt) === month);
}
