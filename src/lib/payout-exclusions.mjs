/**
 * Explicit payout exclusions (PRD section 7): owners, funded employees and
 * related parties keep their public Points but receive no share of a
 * project's pool. An excluded weight leaves the allocation, so it never
 * reduces another contributor's share. Changes apply prospectively: a
 * revision may not change who is excluded in the open UTC month or earlier.
 *
 * Each entry names an immutable GitHub identity and the UTC months it covers:
 * from `fromCycle` up to, but not including, `untilCycle` (null: open-ended).
 */

import { githubUserIdFromNodeId } from "./github-actor.ts";

const PAYOUT_EXCLUSION_RELATIONSHIPS = Object.freeze([
  "owner",
  "funded-employee",
  "related-party",
]);

const CYCLE = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const KEYS = [
  "actorId",
  "fromCycle",
  "login",
  "nodeId",
  "relationship",
  "untilCycle",
];

function covers(entry, cycleId) {
  return (
    entry.fromCycle <= cycleId &&
    (entry.untilCycle === null || cycleId < entry.untilCycle)
  );
}

/** Throws unless the list is a well-formed, non-overlapping exclusion list. */
export function validatePayoutExclusions(value, field) {
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError(`${field} must be a nonempty array`);
  const identities = new Map();
  value.forEach((entry, index) => {
    const path = `${field}[${index}]`;
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join() !== KEYS.join()
    )
      throw new TypeError(`${path} must contain exactly ${KEYS.join(", ")}`);
    if (
      typeof entry.actorId !== "string" ||
      !/^[1-9][0-9]{0,19}$/u.test(entry.actorId) ||
      typeof entry.nodeId !== "string" ||
      githubUserIdFromNodeId(entry.nodeId) !== entry.actorId ||
      typeof entry.login !== "string" ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(entry.login)
    )
      throw new TypeError(`${path} must name one immutable GitHub identity`);
    if (!PAYOUT_EXCLUSION_RELATIONSHIPS.includes(entry.relationship))
      throw new TypeError(
        `${path}.relationship must be ${PAYOUT_EXCLUSION_RELATIONSHIPS.join(", ")}`,
      );
    if (
      typeof entry.fromCycle !== "string" ||
      !CYCLE.test(entry.fromCycle) ||
      !(
        entry.untilCycle === null ||
        (typeof entry.untilCycle === "string" &&
          CYCLE.test(entry.untilCycle) &&
          entry.untilCycle > entry.fromCycle)
      )
    )
      throw new TypeError(
        `${path} must cover at least one UTC month, from fromCycle until untilCycle`,
      );
    const known = identities.get(entry.nodeId);
    if (known && known.actorId !== entry.actorId)
      throw new TypeError(`${path} disagrees about one GitHub identity`);
    for (const other of known?.entries ?? [])
      if (
        (other.untilCycle === null || entry.fromCycle < other.untilCycle) &&
        (entry.untilCycle === null || other.fromCycle < entry.untilCycle)
      )
        throw new TypeError(`${path} overlaps another exclusion of the actor`);
    identities.set(entry.nodeId, {
      actorId: entry.actorId,
      entries: [...(known?.entries ?? []), entry],
    });
  });
  return value;
}

/** The relationship that excludes an actor node ID from a cycle, or null. */
export function payoutExclusionFor(project, cycleId, actorNodeId) {
  return (
    (project.reward.payoutExclusions ?? []).find(
      (entry) => entry.nodeId === actorNodeId && covers(entry, cycleId),
    )?.relationship ?? null
  );
}

/** Numeric GitHub user IDs excluded from a cycle. */
export function payoutExcludedGithubUserIds(project, cycleId) {
  return new Set(
    (project.reward.payoutExclusions ?? [])
      .filter((entry) => covers(entry, cycleId))
      .map((entry) => entry.actorId),
  );
}

function excludedSet(exclusions, cycleId) {
  return exclusions
    .filter((entry) => covers(entry, cycleId))
    .map((entry) => `${entry.nodeId}\0${entry.actorId}\0${entry.relationship}`)
    .sort()
    .join("\n");
}

/**
 * Refuses a revision that changes who is excluded, or why, in the open UTC
 * month of `now` or any earlier month. A new or changed exclusion starts with
 * the next UTC month at the earliest.
 */
export function assertPayoutExclusionTransition(previous, next, now) {
  const before = previous.reward.payoutExclusions ?? [];
  const after = next.reward.payoutExclusions ?? [];
  const openCycle = now.toISOString().slice(0, 7);
  const starts = [...before, ...after].map((entry) => entry.fromCycle).sort();
  if (starts.length === 0) return;
  const month = new Date(`${starts[0]}-01T00:00:00.000Z`);
  for (
    let cycleId = starts[0];
    cycleId <= openCycle;
    month.setUTCMonth(month.getUTCMonth() + 1),
      cycleId = month.toISOString().slice(0, 7)
  )
    if (excludedSet(before, cycleId) !== excludedSet(after, cycleId))
      throw new TypeError(
        `payout exclusions apply prospectively; ${cycleId} cannot change`,
      );
}
