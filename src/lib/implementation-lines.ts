import {
  valueAdditionCount,
  valueDeletionCount,
} from "../../workers/slopbot/value-patch";
import type {
  WorkUnitClaim,
  WorkUnitEvidence,
} from "../../workers/slopbot/value-work-unit-types";
import { implementationCreditActors } from "./commit-credit";

/** Recompute recipients without rewriting the retained valuation evidence. */
export function workUnitCreditActorIds(
  evidence: WorkUnitEvidence,
  claim: WorkUnitClaim,
): string[] | null {
  const source = evidence.sources.find(
    (item) => item.evidence.pull.node_id === claim.creditPullRequestId,
  )?.evidence;
  if (!source) return null;
  // Older in-memory evidence may contain only its verified claim recipients.
  // Live collection retains every source commit and takes the primary-author path.
  if (!source.commits) return claim.implementationActorNodeIds;
  const commits = source.commits.filter(
    (commit) => commit.sha === claim.commitSha,
  );
  if (commits.length !== 1) return null;
  // A synchronization merge, including its verified conflict resolution,
  // credits nobody: the split uses the unique accepted, non-merge commits.
  if (commits[0].parents.length > 1) return [];
  const commit = commits[0];
  return implementationCreditActors(
    { id: source.pull.user.node_id, kind: source.pull.user.type },
    [
      commit.author
        ? { id: commit.author.node_id, kind: commit.author.type }
        : null,
    ],
  ).map((actor) => actor.id);
}

/** Each canonical commit/path claim contributes its changed lines once.
 * For a retained copy, use the accepted copy's file changes so previously
 * accepted hunks omitted from that copy cannot increase this allocation.
 */
export function workUnitLineWeights(
  evidence: WorkUnitEvidence,
  claims: readonly WorkUnitClaim[],
): Map<string, bigint> | null {
  const weights = new Map<string, bigint>();
  const seen = new Set<string>();
  for (const claim of claims) {
    if (seen.has(claim.id)) return null;
    seen.add(claim.id);
    const actors = workUnitCreditActorIds(evidence, claim);
    if (actors === null || actors.length > 1) return null;
    if (!actors.length) continue;
    const sourceId =
      claim.retainedCopy?.acceptancePullRequestId ?? claim.creditPullRequestId;
    const commitSha = claim.retainedCopy?.acceptedCommitSha ?? claim.commitSha;
    const source = evidence.sources.find(
      (item) => item.evidence.pull.node_id === sourceId,
    )?.evidence;
    const attribution = source?.commitAttribution?.filter(
      (item) => item.sha === commitSha,
    );
    if (attribution?.length !== 1 || attribution[0].limitations.length)
      return null;
    const files = attribution[0].files?.filter(
      (file) => file.filename === claim.path,
    );
    if (files?.length !== 1) return null;
    const additions = valueAdditionCount(files[0]);
    const deletions = valueDeletionCount(files[0]);
    if (
      !Number.isSafeInteger(additions) ||
      !Number.isSafeInteger(deletions) ||
      additions < 0 ||
      deletions < 0
    )
      return null;
    const actorId = actors[0];
    weights.set(
      actorId,
      (weights.get(actorId) ?? 0n) + BigInt(additions) + BigInt(deletions),
    );
  }
  return weights;
}
