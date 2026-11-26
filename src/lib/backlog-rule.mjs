/**
 * The backlog rule (operator decision, 23 November 2026; PRD sections 5 and
 * 7). It applies to every active monthly-pool project the same way, team
 * projects included, from `BACKLOG_RULE_FROM`.
 *
 * The inputs are the stored daily merge activity (`repository_merge_activity`,
 * `GET /api/v1/merge-activity`). Only rows read within
 * `INTAKE_COUNT_MAX_AGE_MS` count. Over those rows, `waiting` is the sum of
 * outside pull requests open seven days or more with no response from anyone
 * who can merge, and the last merge is the latest merge of any repository.
 *
 * - Over the limit: `waiting` is `BACKLOG_WAITING_LIMIT` or more. Required for
 *   every project; the owner's intake cap stays a separate, optional, lower
 *   limit.
 * - Dormant: at least one outside pull request waits and no pull request was
 *   merged in `DORMANT_AFTER_DAYS` days (or none was ever found).
 *
 * External-prize projects and security-only programs are not judged.
 *
 * A project over the limit or dormant is out of rotation: it is left out of
 * the home page, /sponsors and agent discovery. Nothing else changes: points,
 * payments, Slopbot reviews and the project page by link stay as they are.
 * It comes back by itself at the first recent read where neither holds. No
 * recent row means no decision, so the project stays listed.
 *
 * An owner may mark the project as catching up on reviews for up to
 * `CATCH_UP_MAX_DAYS` days, starting at most once per UTC month. While that
 * runs the rule does not take the project out of rotation.
 * `project.slopbot.catchUpUntil` is the owner's end; the server alone writes
 * `project.slopbot.catchUpHistory`, one entry per start.
 */

import { INTAKE_COUNT_MAX_AGE_MS } from "./intake-cap.mjs";

/** Outside pull requests waiting a week or more that take a project out. */
export const BACKLOG_WAITING_LIMIT = 50;
/** Days without a merge, while work waits, that make a project dormant. */
export const DORMANT_AFTER_DAYS = 14;
/** Days without a merge at which the owner is warned. */
export const DORMANT_WARNING_AFTER_DAYS = 10;
/** The longest catch-up pause. */
export const CATCH_UP_MAX_DAYS = 14;
/** The rule takes effect at this instant. */
export const BACKLOG_RULE_FROM = "2026-12-01T00:00:00.000Z";
/** The most catch-up starts one manifest keeps. */
export const CATCH_UP_HISTORY_MAX = 240;

const DAY_MS = 24 * 60 * 60 * 1000;
const RULE_FROM_MS = Date.parse(BACKLOG_RULE_FROM);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isInstant(value) {
  return (
    typeof value === "string" &&
    ISO_INSTANT.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/** Validates `project.slopbot.catchUpUntil`. */
export function assertCatchUpUntil(value, field) {
  if (!isInstant(value))
    throw new TypeError(`${field} must be an ISO 8601 UTC instant`);
}

/** Validates `project.slopbot.catchUpHistory`. */
export function assertCatchUpHistory(value, field) {
  if (!Array.isArray(value) || value.length > CATCH_UP_HISTORY_MAX)
    throw new TypeError(
      `${field} must list at most ${CATCH_UP_HISTORY_MAX} starts`,
    );
  let previous = "";
  for (const [index, entry] of value.entries()) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 1 ||
      !isInstant(entry.startedAt)
    )
      throw new TypeError(`${field}[${index}] must be { startedAt }`);
    if (entry.startedAt <= previous)
      throw new TypeError(`${field} must be in order of start`);
    previous = entry.startedAt;
  }
}

/**
 * True for a security-only program: a private security program that is the
 * whole offer (bounty-only), or one beside a monthly amount of zero, such as
 * Umia and Orbio. The rule does not judge it.
 */
export function securityOnly(project) {
  const program = project?.securityBounty;
  return (
    program !== undefined &&
    program !== null &&
    (program.rewardMode === "bounty-only" ||
      project.reward?.monthlyCapMinor === "0")
  );
}

/**
 * True for an active, listed monthly-pool project that is not a
 * security-only program: the rule judges it. External-prize projects are
 * not judged.
 */
export function backlogJudged(project) {
  return (
    !!project &&
    project.status === "active" &&
    project.listingTier !== "retired" &&
    project.reward?.kind === "monthly-pool" &&
    !securityOnly(project)
  );
}

/** True once the rule has taken effect. */
export function backlogRuleStarted(now) {
  return now.getTime() >= RULE_FROM_MS;
}

/**
 * The recent figures of a project's repositories, or null when no row was
 * read within `INTAKE_COUNT_MAX_AGE_MS`.
 */
export function backlogFigures(rows, now) {
  if (!rows) return null;
  let waiting = 0;
  let lastMergedAt = null;
  let fresh = false;
  for (const row of rows) {
    const observed = Date.parse(row?.observedAt ?? "");
    if (
      !Number.isFinite(observed) ||
      now.getTime() - observed > INTAKE_COUNT_MAX_AGE_MS ||
      !Number.isSafeInteger(row.waitingOutside) ||
      row.waitingOutside < 0
    )
      continue;
    fresh = true;
    waiting += row.waitingOutside;
    const merged = row.lastMergedAt ?? null;
    if (
      merged !== null &&
      !Number.isNaN(Date.parse(merged)) &&
      (lastMergedAt === null || Date.parse(merged) > Date.parse(lastMergedAt))
    )
      lastMergedAt = merged;
  }
  return fresh ? { waiting, lastMergedAt } : null;
}

/** The end of a running catch-up pause, or null when none runs. */
export function catchUpEnd(project, now) {
  const until = project?.slopbot?.catchUpUntil;
  return isInstant(until) && Date.parse(until) > now.getTime() ? until : null;
}

/** Whole days since the last merge, or null when none was found. */
function daysSince(iso, now) {
  return iso === null
    ? null
    : Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
}

/**
 * The backlog state of a project at `now`.
 *
 * - `judged`: an active, listed monthly-pool project.
 * - `figures`: the recent figures, or null (no decision).
 * - `reason`: "backlog", "dormant" or null on the figures alone.
 * - `catchingUpUntil`: the end of a running catch-up pause.
 * - `wouldBeOut`: out of rotation if the rule had taken effect.
 * - `outOfRotation`: out of rotation now.
 */
export function backlogState(project, rows, now) {
  const judged = backlogJudged(project);
  const figures = judged ? backlogFigures(rows, now) : null;
  const sinceMerge = figures ? daysSince(figures.lastMergedAt, now) : null;
  let reason = null;
  if (figures !== null) {
    if (figures.waiting >= BACKLOG_WAITING_LIMIT) reason = "backlog";
    else if (
      figures.waiting >= 1 &&
      (sinceMerge === null || sinceMerge >= DORMANT_AFTER_DAYS)
    )
      reason = "dormant";
  }
  const catchingUpUntil = judged ? catchUpEnd(project, now) : null;
  const wouldBeOut = reason !== null && catchingUpUntil === null;
  return {
    judged,
    figures,
    daysSinceMerge: sinceMerge,
    reason,
    catchingUpUntil,
    started: backlogRuleStarted(now),
    wouldBeOut,
    outOfRotation: wouldBeOut && backlogRuleStarted(now),
  };
}

/** True when the backlog rule leaves the project out of rotation now. */
export function backlogOutOfRotation(project, rows, now) {
  return backlogState(project, rows, now).outOfRotation;
}

/**
 * True when dormancy is near: work waits, the last merge is at least
 * `DORMANT_WARNING_AFTER_DAYS` and under `DORMANT_AFTER_DAYS` days old, and
 * neither the limit nor a catch-up pause applies.
 */
export function dormancyNear(state) {
  return (
    state.judged &&
    state.reason === null &&
    state.catchingUpUntil === null &&
    state.figures !== null &&
    state.figures.waiting >= 1 &&
    state.daysSinceMerge !== null &&
    state.daysSinceMerge >= DORMANT_WARNING_AFTER_DAYS &&
    state.daysSinceMerge < DORMANT_AFTER_DAYS
  );
}

/** A date such as "13 December 2026". */
export function backlogDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function pullRequests(count) {
  return count === 1
    ? "1 outside pull request"
    : `${count} outside pull requests`;
}

/** The project page line, or null when nothing is shown. */
export function backlogNotice(state) {
  if (!state.started) return null;
  if (state.catchingUpUntil !== null)
    return `The maintainers are catching up on reviews until ${backlogDate(state.catchingUpUntil)}.`;
  if (!state.outOfRotation || state.figures === null) return null;
  return state.reason === "backlog"
    ? `This project is out of rotation: ${pullRequests(state.figures.waiting)} have waited a week or more for a maintainer. Accepted work still records points.`
    : `This project is out of rotation: no pull request has been merged in ${DORMANT_AFTER_DAYS} days while outside pull requests wait. It returns once a maintainer merges.`;
}

/** The plain reason, for owner notices and the manage page. */
function reasonText(state) {
  return state.reason === "backlog"
    ? `${pullRequests(state.figures.waiting)} have waited a week or more for a maintainer`
    : `no pull request has been merged in ${DORMANT_AFTER_DAYS} days while outside pull requests wait`;
}

/** The one line of state on the manage page, or null for an exempt project. */
export function backlogStatusLine(state) {
  if (!state.judged) return null;
  if (state.figures === null)
    return "Review backlog: not read in the last 3 days, so the project stays listed.";
  const since = state.daysSinceMerge;
  const last =
    since === null
      ? "no merge found"
      : since <= 0
        ? "last merge today"
        : since === 1
          ? "last merge 1 day ago"
          : `last merge ${since} days ago`;
  const figures = `Review backlog: ${pullRequests(state.figures.waiting)} waiting a week or more, ${last}.`;
  if (state.catchingUpUntil !== null)
    return `${figures} Catching up on reviews until ${backlogDate(state.catchingUpUntil)}, so the project stays listed.`;
  if (state.outOfRotation)
    return `${figures} Out of rotation: left off the home page, /sponsors and agent discovery.`;
  if (state.wouldBeOut)
    return `${figures} From 1 December 2026 this takes the project off the home page, /sponsors and agent discovery.`;
  return `${figures} The project stays listed.`;
}

/** The owner notice before the rule starts, for a project that would be out. */
export function backlogPreviewDetail(state) {
  return `From 1 December 2026, a project with ${BACKLOG_WAITING_LIMIT} or more outside pull requests waiting a week for a maintainer, or no merge in ${DORMANT_AFTER_DAYS} days while outside pull requests wait, leaves the home page, /sponsors and agent discovery until that is fixed. Your project would leave today: ${reasonText(state)}. You can mark it as catching up on reviews for up to ${CATCH_UP_MAX_DAYS} days from its settings.`;
}

/** The owner notice when dormancy is near. */
export function backlogWarningDetail(state) {
  return `No pull request has been merged in ${state.daysSinceMerge} days while outside pull requests wait. After ${DORMANT_AFTER_DAYS} days the project leaves the home page, /sponsors and agent discovery until a maintainer merges. You can mark it as catching up on reviews for up to ${CATCH_UP_MAX_DAYS} days from its settings.`;
}

/** The owner notice the day a project leaves rotation. */
export function backlogOutDetail(state) {
  return `Your project left the home page, /sponsors and agent discovery: ${reasonText(state)}. It returns by itself once ${
    state.reason === "backlog"
      ? `fewer than ${BACKLOG_WAITING_LIMIT} wait`
      : "a maintainer merges"
  }. You can mark it as catching up on reviews for up to ${CATCH_UP_MAX_DAYS} days from its settings. Accepted work still records points.`;
}

/** The UTC month of an instant, "YYYY-MM". */
function utcMonth(iso) {
  return iso.slice(0, 7);
}

/**
 * The server's catch-up step of an owner revision. Returns the next slopbot
 * settings with the history the server writes, or throws a TypeError whose
 * message the owner sees.
 *
 * - The history only changes here; a submitted change to it is refused.
 * - Clearing the end is always allowed.
 * - A new end must be after now and no more than 14 days after now.
 * - Changing the end of a running pause keeps its start and may not reach
 *   past 14 days from that start.
 * - A new start is refused when the history already has a start in the
 *   current UTC month.
 */
export function applyCatchUpChange(previous, next, now) {
  const before = previous ?? {};
  const after = next ?? {};
  const beforeHistory = before.catchUpHistory ?? [];
  const afterHistory = after.catchUpHistory ?? [];
  if (JSON.stringify(beforeHistory) !== JSON.stringify(afterHistory))
    throw new TypeError("The catch-up history cannot change");
  if (before.catchUpUntil === after.catchUpUntil) return next;
  if (after.catchUpUntil === undefined) return next;
  assertCatchUpUntil(after.catchUpUntil, "project.slopbot.catchUpUntil");
  const end = Date.parse(after.catchUpUntil);
  const at = now.getTime();
  if (end <= at || end > at + CATCH_UP_MAX_DAYS * DAY_MS)
    throw new TypeError(
      `Catching up on reviews must end within ${CATCH_UP_MAX_DAYS} days from now`,
    );
  const running = catchUpEnd({ slopbot: before }, now);
  if (running !== null) {
    const start = beforeHistory.at(-1)?.startedAt;
    const limit =
      start === undefined
        ? Date.parse(running)
        : Date.parse(start) + CATCH_UP_MAX_DAYS * DAY_MS;
    if (end > limit)
      throw new TypeError(
        `A catch-up pause lasts at most ${CATCH_UP_MAX_DAYS} days from its start`,
      );
    return next;
  }
  const month = utcMonth(now.toISOString());
  if (beforeHistory.some((entry) => utcMonth(entry.startedAt) === month))
    throw new TypeError(
      "Catching up on reviews can start once per calendar month (UTC); it already started this month",
    );
  return {
    ...after,
    catchUpHistory: [...beforeHistory, { startedAt: now.toISOString() }],
  };
}

/**
 * The end the manage page offers for a new pause: the start of the UTC day
 * 14 days ahead, so it is never past 14 days from the server's now.
 */
export function catchUpOfferedEnd(now) {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + CATCH_UP_MAX_DAYS,
    ),
  ).toISOString();
}

/** True when a new pause may start now (none started this UTC month). */
export function catchUpStartAllowed(project, now) {
  const month = utcMonth(now.toISOString());
  return !(project?.slopbot?.catchUpHistory ?? []).some(
    (entry) => utcMonth(entry.startedAt) === month,
  );
}
