/**
 * A maintainer's intake cap (operator decision, 17 November 2026; PRD
 * section 5). A project owner may set one whole number in project settings:
 * pause new contributors when this many outside pull requests are open.
 * Absent means off.
 *
 * The count is the stored daily merge activity (`repository_merge_activity`,
 * `GET /api/v1/merge-activity`): open pull requests whose author is not an
 * owner, member or collaborator and not a bot, drafts left out. While any
 * repository of an active project has at least that many, the project is left
 * out of the home page, /sponsors and agent discovery, its page says so, and
 * Slopbot skips its free advisory review of new pull requests. It comes back
 * by itself when a later read is below the number. A count that was never
 * read, could not be read, or is older than `INTAKE_COUNT_MAX_AGE_MS` pauses
 * nothing. Scoring and payment never read this.
 */

export const INTAKE_CAP_LIMITS = Object.freeze({ min: 1, max: 500 });

/** A stored count older than this no longer pauses the project. */
export const INTAKE_COUNT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** The project page line while new contributors are paused. */
export const INTAKE_PAUSED_NOTICE =
  "This project has paused new contributors because its review queue is full. Accepted work still records points.";

/** Validates `project.slopbot.intakeCap`. */
export function assertIntakeCap(value, field) {
  if (
    !Number.isSafeInteger(value) ||
    value < INTAKE_CAP_LIMITS.min ||
    value > INTAKE_CAP_LIMITS.max
  )
    throw new TypeError(
      `${field} must be a whole number from ${INTAKE_CAP_LIMITS.min} to ${INTAKE_CAP_LIMITS.max}`,
    );
}

/** The owner's intake cap, or null when it is off. */
export function intakeCap(project) {
  const cap = project?.slopbot?.intakeCap;
  return Number.isSafeInteger(cap) && cap >= INTAKE_CAP_LIMITS.min ? cap : null;
}

/** True when one stored count is recent enough and at or above the cap. */
export function countAtCap(cap, openOutside, observedAt, now) {
  if (!Number.isSafeInteger(openOutside) || openOutside < cap) return false;
  const observed = Date.parse(observedAt ?? "");
  return (
    Number.isFinite(observed) &&
    now.getTime() - observed <= INTAKE_COUNT_MAX_AGE_MS
  );
}

/**
 * Whether an active project has paused new contributors: its cap is set and
 * a recent stored count of one of its repositories is at or above it. Missing
 * rows (not loaded, failed, never read) pause nothing.
 */
export function intakePaused(project, rows, now) {
  const cap = intakeCap(project);
  if (cap === null || project.status !== "active" || !rows) return false;
  return rows.some((row) =>
    countAtCap(cap, row.openOutside, row.observedAt, now),
  );
}
