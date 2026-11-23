/** Cross-window PR identities from an already validated canonical Points journal. */
import {
  OCTOBER_DUPLICATE_RETIREMENT_DECISION,
  type PointRevision,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import { validRepositoryPath } from "../src/lib/project-contracts";

export interface AcceptedImplementationPredecessor {
  id: string;
  number: number;
  url: string;
  mergedAt: string;
}

interface PredecessorScope {
  repository: string;
  projectId: string;
  mergedBefore: string;
  recordedThrough: string;
}

function cutoff(value: string): number {
  const at = Date.parse(value);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value)
    throw new Error("Implementation history requires an exact UTC cutoff");
  return at;
}

function pullNumber(url: string, prefix: string): number | undefined {
  if (!url.startsWith(prefix)) return undefined;
  const tail = url.slice(prefix.length);
  if (!/^[1-9][0-9]*$/u.test(tail)) return undefined;
  const number = Number(tail);
  return Number.isSafeInteger(number) ? number : undefined;
}

export function previousPositiveImplementationSources(
  journal: PointsJournal,
  scope: PredecessorScope,
): AcceptedImplementationPredecessor[] {
  if (
    !scope.projectId ||
    !validRepositoryPath(scope.repository) ||
    scope.repository.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Implementation history requires a configured repository");
  const acceptedBefore = cutoff(scope.mergedBefore);
  const recordedThrough = cutoff(scope.recordedThrough);
  const prefix = `https://github.com/${scope.repository}/pull/`;
  const latest = new Map<string, PointRevision>();
  // Revision order is append order, but recordedAt is monotonic only per key.
  for (const revision of journal.revisions) {
    if (Date.parse(revision.recordedAt) <= recordedThrough)
      latest.set(revision.award.key, revision);
  }

  const byId = new Map<
    string,
    {
      projectId: string;
      url: string;
      mergedAt: string;
      positive: boolean;
    }
  >();
  const byNumber = new Map<number, string>();
  const ambiguous = new Set<string>();
  for (const { award, decision } of latest.values()) {
    if (
      award.category !== "merged-pull-request" ||
      !award.sourceId ||
      award.key !==
        pointKey(
          award.projectId,
          award.actor.id,
          award.category,
          award.sourceId,
        )
    )
      continue;
    const id = award.sourceId;
    const positive =
      award.amount > 0 &&
      decision?.reason !== OCTOBER_DUPLICATE_RETIREMENT_DECISION;
    const prior = byId.get(id);
    if (!prior) {
      byId.set(id, {
        projectId: award.projectId,
        url: award.sourceUrl,
        mergedAt: award.occurredAt,
        positive,
      });
    } else if (
      prior.projectId !== award.projectId ||
      prior.url !== award.sourceUrl ||
      prior.mergedAt !== award.occurredAt
    ) {
      ambiguous.add(id);
    } else if (positive) {
      prior.positive = true;
    }
    const number = pullNumber(award.sourceUrl, prefix);
    if (number === undefined) continue;
    const owner = byNumber.get(number);
    if (owner !== undefined && owner !== id) {
      ambiguous.add(owner);
      ambiguous.add(id);
    } else {
      byNumber.set(number, id);
    }
  }

  const result: AcceptedImplementationPredecessor[] = [];
  for (const [id, source] of byId) {
    if (
      ambiguous.has(id) ||
      source.projectId !== scope.projectId ||
      !source.positive ||
      Date.parse(source.mergedAt) >= acceptedBefore
    )
      continue;
    const number = pullNumber(source.url, prefix);
    if (number !== undefined)
      result.push({ id, number, url: source.url, mergedAt: source.mergedAt });
  }
  return result.sort(
    (left, right) =>
      left.mergedAt.localeCompare(right.mergedAt) || left.number - right.number,
  );
}
