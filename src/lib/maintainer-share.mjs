/**
 * A project's maintainer share (operator decision, 18 November 2026; PRD
 * section 6). A project owner may set a share of the monthly amount, up to
 * 30%, that goes to the people who decide outside pull requests. Absent
 * means no share.
 *
 * The share comes out of the monthly amount before the points split, so a
 * month never distributes more than its amount. It is split among the
 * accounts that merged or closed another person's outside pull request in
 * that UTC month, in proportion to the number each decided. A month with no
 * such decision has no maintainer share and the whole amount stays with
 * contributors (`src/lib/payments/maintainer-share.ts`).
 *
 * A change applies from the next UTC month: `maintainerShareHistory` keeps
 * the share that every month through the open one had. The server alone
 * writes the history.
 */

import { resolveRewardCapMinor } from "./reward-cap.mjs";

/** Basis points of the monthly amount. */
export const MAINTAINER_SHARE_LIMITS = Object.freeze({ min: 0, max: 3000 });

const CYCLE = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

function basisPoints(value, minimum) {
  return (
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= MAINTAINER_SHARE_LIMITS.max
  );
}

/** Validates `project.reward.maintainerShare`: 1 to 3000, or omitted. */
export function assertMaintainerShare(value, field) {
  if (!basisPoints(value, 1))
    throw new TypeError(
      `${field} must be whole basis points from 1 to ${MAINTAINER_SHARE_LIMITS.max}, or omitted`,
    );
}

/**
 * Validates `project.reward.maintainerShareHistory`: the share of every
 * month through `throughCycle`, oldest first.
 */
export function assertMaintainerShareHistory(value, field) {
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError(`${field} must be a nonempty array`);
  let previous = "";
  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join() !== "basisPoints,throughCycle" ||
      typeof entry.throughCycle !== "string" ||
      !CYCLE.test(entry.throughCycle) ||
      entry.throughCycle <= previous ||
      !basisPoints(entry.basisPoints, 0)
    )
      throw new TypeError(
        `${field} must list basisPoints and throughCycle in chronological UTC months`,
      );
    previous = entry.throughCycle;
  }
}

/** The maintainer share of one UTC month, in basis points of its amount. */
export function maintainerShareBasisPoints(project, cycleId) {
  if (typeof cycleId !== "string" || !CYCLE.test(cycleId))
    throw new TypeError("maintainer share requires a valid UTC cycle month");
  const reward = project?.reward;
  if (reward?.kind !== "monthly-pool") return 0;
  const past = (reward.maintainerShareHistory ?? []).find(
    (entry) => cycleId <= entry.throughCycle,
  );
  return past ? past.basisPoints : (reward.maintainerShare ?? 0);
}

/**
 * The reward of a revision that changes the share during `openCycle`: every
 * month through the open one keeps the share it had, so the new share starts
 * with the next UTC month. A second change in the same month keeps the
 * month's first recorded share.
 */
export function prospectiveMaintainerShare(before, after, openCycle) {
  const previous = before.maintainerShare ?? 0;
  if (previous === (after.maintainerShare ?? 0)) return after;
  const history = before.maintainerShareHistory ?? [];
  const last = history.at(-1);
  if (last && last.throughCycle >= openCycle) return after;
  return {
    ...after,
    maintainerShareHistory: [
      ...history,
      { throughCycle: openCycle, basisPoints: previous },
    ],
  };
}

/** "20%" or "12.5%"; no share is "None". */
export function maintainerShareLabel(points) {
  return basisPoints(points, 1) ? `${points / 100}%` : "None";
}

function monthName(cycleId) {
  const [year, month] = cycleId.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en", {
    month: "long",
    timeZone: "UTC",
  });
}

function nextCycle(cycleId) {
  const [year, month] = cycleId.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

/**
 * The share of the open UTC month and the share from the next one, in basis
 * points, or null when the project has no monthly amount or no share in
 * either month.
 */
export function publishedMaintainerShare(project, now) {
  const reward = project?.reward;
  if (reward?.kind !== "monthly-pool") return null;
  const cycleId = now.toISOString().slice(0, 7);
  // This month's amount is its cycle override when one is set, as every
  // other monthly amount display resolves it.
  if (BigInt(resolveRewardCapMinor(project, cycleId)) === 0n) return null;
  const current = maintainerShareBasisPoints(project, cycleId);
  const next = reward.maintainerShare ?? 0;
  if (current === 0 && next === 0) return null;
  return { current, next, nextCycle: nextCycle(cycleId) };
}

const lower = (points) => (points > 0 ? maintainerShareLabel(points) : "none");

/** The project page sentence, or null when there is no share to show. */
export function maintainerShareNotice(project, now) {
  const share = publishedMaintainerShare(project, now);
  if (share === null) return null;
  const who =
    "split among the maintainers who merge or close outside pull requests";
  return share.current === share.next
    ? `Maintainer share: ${lower(share.current)} of the monthly amount, ${who}.`
    : `Maintainer share: ${lower(share.current)} of the monthly amount this month, ${lower(share.next)} from ${monthName(share.nextCycle)}, ${who}.`;
}

/** The short card line, or null when there is no share to show. */
export function maintainerShareCardLine(project, now) {
  const share = publishedMaintainerShare(project, now);
  if (share === null) return null;
  return share.current === share.next
    ? `Maintainer share ${lower(share.current)}`
    : `Maintainer share ${lower(share.next)} from ${monthName(share.nextCycle)}`;
}
