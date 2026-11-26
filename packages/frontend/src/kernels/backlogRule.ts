// spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"
export const BACKLOG_RULE_LIMIT = 50;
export const BACKLOG_RULE_DORMANT_DAYS = 14;
export const BACKLOG_RULE_START_MS = Date.UTC(2026, 11, 1, 0, 0, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BacklogObservation {
  readonly waitingOutside: number;
  readonly lastMergedAt: string | null;
}

export interface BacklogStatus {
  readonly outOfRotation: boolean;
  readonly reason: "none" | "catch-up" | "limit" | "dormant";
  readonly waitingOutside: number;
  readonly catchUpUntil: string | null;
}

export function backlogCatchUpUntil(record: unknown): string | null {
  if (typeof record !== "object" || record === null) return null;
  const slopbot = "slopbot" in record && typeof record.slopbot === "object" && record.slopbot !== null ? record.slopbot : undefined;
  const until = slopbot !== undefined && "catchUpUntil" in slopbot && typeof slopbot.catchUpUntil === "string" ? slopbot.catchUpUntil : null;
  return until !== null && Number.isFinite(Date.parse(until)) ? until : null;
}

export function evaluateBacklogRule(
  rows: ReadonlyArray<BacklogObservation>,
  catchUpUntil: string | null,
  nowMs: number,
): BacklogStatus {
  const waitingOutside = rows.reduce((sum, row) => sum + row.waitingOutside, 0);
  if (catchUpUntil !== null && Date.parse(catchUpUntil) > nowMs) {
    return { outOfRotation: true, reason: "catch-up", waitingOutside, catchUpUntil };
  }
  if (nowMs < BACKLOG_RULE_START_MS || rows.length === 0) {
    return { outOfRotation: false, reason: "none", waitingOutside, catchUpUntil };
  }
  if (waitingOutside >= BACKLOG_RULE_LIMIT) {
    return { outOfRotation: true, reason: "limit", waitingOutside, catchUpUntil };
  }
  if (waitingOutside > 0) {
    const latestMerge = rows.reduce<number | null>((latest, row) => {
      if (row.lastMergedAt === null) return latest;
      const ms = Date.parse(row.lastMergedAt);
      if (!Number.isFinite(ms)) return latest;
      return latest === null ? ms : Math.max(latest, ms);
    }, null);
    if (latestMerge !== null && nowMs - latestMerge >= BACKLOG_RULE_DORMANT_DAYS * DAY_MS) {
      return { outOfRotation: true, reason: "dormant", waitingOutside, catchUpUntil };
    }
  }
  return { outOfRotation: false, reason: "none", waitingOutside, catchUpUntil };
}

export const outOfRotationNoticeText =
  "This project is temporarily out of rotation while its maintainers work through open pull requests.";
