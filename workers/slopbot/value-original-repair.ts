/** Authenticate a copied follow-up without changing its primary author. */
import { isCreditEligibleCommitAuthor } from "../../src/lib/commit-credit";
import {
  isOriginalContributorRepair,
  type OriginalContributorRepair,
} from "../../src/lib/original-contributor-repair";
import type { CorrectionSource } from "../../src/lib/points-implementation-corrections";
import { sha256Hex } from "../../src/lib/sha256";
import type { Commit } from "./value-evidence-types";
import { valueJsonDigest } from "./value-json-digest";
import { retainedEditIdentity } from "./value-retained-copy";
import type { WorkUnitSource } from "./value-work-unit-types";

export function retainedRepair(
  original: WorkUnitSource,
  accepted: WorkUnitSource,
  acceptedCommitSha: string,
  originalCommitSha: string,
  path: string,
): OriginalContributorRepair | null {
  const source = original.evidence,
    integration = accepted.evidence;
  const repair = integration.commits.find(
    (commit) => commit.sha === acceptedCommitSha,
  );
  if (
    repair?.author?.type !== "User" ||
    !isCreditEligibleCommitAuthor({
      id: repair.author.node_id,
      kind: repair.author.type,
    }) ||
    source.limitations.length ||
    integration.limitations.length ||
    source.repositoryNodeId !== integration.repositoryNodeId ||
    source.repositoryDatabaseId !== integration.repositoryDatabaseId ||
    source.pull.number >= integration.pull.number ||
    source.pull.user.node_id === integration.pull.user.node_id ||
    !integration.repairBodyEdit ||
    !integration.pull.merged_at ||
    source.commits.length !== source.pull.commits ||
    integration.commits.length !== integration.pull.commits
  )
    return null;
  const originalFiles = source.commitAttribution.filter(
    (entry) => entry.sha === originalCommitSha,
  );
  const acceptedFiles = integration.commitAttribution.filter(
    (entry) => entry.sha === acceptedCommitSha,
  );
  const before = originalFiles[0]?.files?.filter(
    (file) => file.filename === path,
  );
  const after = acceptedFiles[0]?.files?.filter(
    (file) => file.filename === path,
  );
  if (
    originalFiles.length !== 1 ||
    acceptedFiles.length !== 1 ||
    originalFiles[0].limitations.length ||
    acceptedFiles[0].limitations.length ||
    before?.length !== 1 ||
    after?.length !== 1 ||
    retainedEditIdentity(before[0]) === null ||
    retainedEditIdentity(before[0]) !== retainedEditIdentity(after[0])
  )
    return null;
  if (
    source.commits.some(
      (commit) =>
        commit.parents.length !== 1 ||
        commit.author?.node_id !== source.pull.user.node_id,
    ) ||
    !integration.commits.some(
      (commit) => commit.sha === integration.pull.head.sha,
    ) ||
    !source.commits.some((commit) => commit.sha === source.pull.head.sha)
  )
    return null;
  const graph = new Map<string, Commit>();
  for (const commit of [...source.commits, ...integration.commits]) {
    const prior = graph.get(commit.sha);
    if (prior && JSON.stringify(prior) !== JSON.stringify(commit)) return null;
    if (
      !commit.parents.every(({ sha }) => /^[a-f0-9]{40}$/u.test(sha)) ||
      new Set(commit.parents.map(({ sha }) => sha)).size !==
        commit.parents.length
    )
      return null;
    graph.set(commit.sha, commit);
  }
  const active = new Set<string>(),
    done = new Set<string>();
  const acyclic = (sha: string): boolean => {
    if (active.has(sha)) return false;
    if (done.has(sha)) return true;
    active.add(sha);
    for (const parent of graph.get(sha)?.parents ?? [])
      if (!acyclic(parent.sha)) return false;
    active.delete(sha);
    done.add(sha);
    return true;
  };
  if (![...graph.keys()].every(acyclic)) return null;
  const descends = (head: string, target: string): boolean => {
    const pending = [head],
      visited = new Set<string>();
    for (const sha of pending) {
      if (sha === target) return true;
      if (visited.has(sha)) continue;
      visited.add(sha);
      pending.push(...(graph.get(sha)?.parents ?? []).map((p) => p.sha));
    }
    return false;
  };
  const anchors = source.commits.filter(
    (commit) =>
      commit.parents.length === 1 &&
      commit.author?.node_id === source.pull.user.node_id &&
      integration.commits.some((copy) => copy.sha === commit.sha),
  );
  if (
    !anchors.some((anchor) => descends(repair.sha, anchor.sha)) ||
    !descends(integration.pull.head.sha, repair.sha) ||
    !integration.commits.every((commit) =>
      descends(integration.pull.head.sha, commit.sha),
    ) ||
    !source.commits.every((commit) =>
      descends(source.pull.head.sha, commit.sha),
    )
  )
    return null;
  const convert = (input: WorkUnitSource): CorrectionSource => ({
    repository: input.evidence.repository,
    repositoryNodeId: input.evidence.repositoryNodeId,
    sourceId: input.evidence.pull.node_id,
    sourceUrl: input.evidence.pull.html_url,
    headSha: input.evidence.pull.head.sha,
    occurredAt: input.evidence.pull.merged_at,
    author: {
      id: input.evidence.pull.user.node_id,
      login: input.evidence.pull.user.login,
      kind: input.evidence.pull.user.type,
    },
    complete: true,
    commitCount: input.evidence.commits.length,
    commits: [],
  });
  const digest = (input: WorkUnitSource) => {
    const { collectedAt: _, ...evidence } = input.evidence;
    return valueJsonDigest({ policy: input.policy, evidence });
  };
  const reference = {
    sourceDigests: {
      [source.pull.node_id]: digest(original),
      [integration.pull.node_id]: digest(accepted),
    },
    pull: integration.pull,
    acceptingPull: integration.pull,
    headSha: integration.pull.head.sha,
    bodyEdit: integration.repairBodyEdit,
  };
  const result: OriginalContributorRepair = {
    sourceId: integration.pull.node_id,
    commitSha: repair.sha,
    authorNodeId: repair.author.node_id,
    reference: { ...reference, digest: sha256Hex(JSON.stringify(reference)) },
  };
  const commit = {
    sha: repair.sha,
    parentCount: repair.parents.length,
    parentShas: repair.parents.map((p) => p.sha),
    author: {
      id: repair.author.node_id,
      login: repair.author.login,
      kind: repair.author.type,
    },
    additions: 0,
    deletions: 0,
    firstAcceptedSourceId: integration.pull.node_id,
  };
  return isOriginalContributorRepair(
    result,
    convert(original),
    convert(accepted),
    commit,
  )
    ? result
    : null;
}
