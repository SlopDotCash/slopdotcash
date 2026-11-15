import type { ValueMergeResolution } from "../../workers/slopbot/value-evidence-types";
import { mergeResolutionLineCounts } from "../../workers/slopbot/value-merge-resolution";
/**
 * Allocation-only correction of existing Points pools (PRD section 7).
 *
 * The caller is the reviewed, trusted-main collector. It authenticates GitHub
 * responses, the registry, retained-copy bindings and grouped decision scope.
 * This is not an upload validator or an alternative GitHub authority. It checks
 * the collector's structural proof, derives weights, and preserves the current
 * journal's value. The caller supplies current prospective participation bans.
 * Private eligibility must come from the protected workflow;
 * the ordinary pointsSql financial guard remains mandatory at publication.
 */

import {
  githubLinkDestinations,
  sameRepositoryCommitHints,
} from "../../workers/slopbot/value-commit-hints";
import type { Pull } from "../../workers/slopbot/value-evidence-types";
import { isCreditEligibleCommitAuthor } from "./commit-credit";
import { shareImplementationPoints } from "./implementation-allocation";
import {
  appendPointAwards,
  assertPointsJournal,
  latestPoints,
  OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION,
  type PointAward,
  type PointDecision,
  type PointRevision,
  type PointsJournal,
  pointKey,
  pointMembers,
} from "./points";
import { findHistoricalRepository } from "./projects.mjs";
import { sha256Hex } from "./sha256";

export interface CorrectionActor {
  id: string;
  login: string;
  kind: string;
}
export interface CorrectionCommit {
  sha: string;
  parentCount: number;
  mergeResolution?: ValueMergeResolution;
  /** Recorded only for an original PR that needs an authenticated follow-up graph. */
  parentShas?: string[];
  author: CorrectionActor | null;
  additions: number | null;
  deletions: number | null;
  /** Derived from the complete accepted-source census, never PR order alone. */
  firstAcceptedSourceId: string | null;
  /** Complete file counts are required for grouped claims and retained copies. */
  files?: { path: string; additions: number; deletions: number }[];
  retainedCopy?: {
    originalSourceId: string;
    originalCommitSha: string;
    /** Every changed path in this accepted commit has one verified binding. */
    boundPaths: string[];
    bindingDigest: string;
  };
}
export interface CorrectionSource {
  repository: string;
  repositoryNodeId: string;
  sourceId: string;
  sourceUrl: string;
  headSha: string;
  /** Null for a closed, unmerged original retained by an accepted copy. */
  occurredAt: string | null;
  author: CorrectionActor | null;
  complete: boolean;
  commitCount: number;
  commits: CorrectionCommit[];
}
export interface CorrectionClaim {
  id: string;
  /** The accepted copy, including when a different PR originally supplied it. */
  sourceId: string;
  commitSha: string;
  path: string;
}
interface CorrectionCandidateBase {
  id: string;
  projectId: string;
  sourceId: string;
  sourceUrl: string;
  occurredAt: string;
  workUnitId: string;
  /** Complete connected source scope, including retained originals. */
  sourceIds: string[];
  expectedPredecessors: { key: string; revisionId: string }[];
}
export interface OriginalContributorFollowup {
  sourceId: string;
  ancestorSha: string;
  commits: { sha: string; parentShas: string[] }[];
  reference?: {
    sourceDigest: string;
    pull: Pull;
    target: { id: string; number: number; url: string; repository: string };
    acknowledgement?: {
      node_id: string;
      body: string;
      user: { node_id: string; type: string } | null;
      created_at?: string;
      updated_at?: string;
      submitted_at?: string | null;
    };
    digest: string;
  };
}
export interface OriginalContributorRepair {
  sourceId: string;
  commitSha: string;
  authorNodeId: string;
  reference: {
    sourceDigests: Record<string, string>;
    pull: Pull;
    acceptingPull: Pull;
    acknowledgement?: NonNullable<
      OriginalContributorFollowup["reference"]
    >["acknowledgement"];
    headSha: string;
    bodyEdit?: {
      id: string;
      body: string;
      headRefOid: string;
      mergedAt: string;
      updatedAt: string;
      lastEditedAt: string | null;
      editor: { id: string; type: string } | null;
      author: { id: string; type: string };
    };
    digest: string;
  };
}
export interface OriginalContributorBinding {
  /** Native identical-SHA acceptance with authenticated accepted-parent edges. */
  exactAcceptance?: true;
  /** Exact reviewed unit within a multi-origin native integration. */
  claimIds?: string[];
  /** First accepted carrier when the recorded unit completes on its donor. */
  acceptedSourceId?: string;
  followups?: OriginalContributorFollowup[];
  repairs?: OriginalContributorRepair[];
  originalSourceId: string;
  originalCommitSha: string;
  acceptedCommitSha: string;
  boundPaths: string[];
  bindingDigest: string;
}
interface CompleteCorrectionProof {
  status: "complete";
  /** Digest of the complete accepted-source ownership census. */
  censusDigest: string;
  sources: CorrectionSource[];
  /** Verified retained implementation for the October 2026 replacement rule. */
  originalContributor?: OriginalContributorBinding;
  /** Independent native subproofs for one unit by the same verified person. */
  originalContributorParts?: OriginalContributorBinding[];
}
export type PointsImplementationCorrectionCandidate =
  | (CorrectionCandidateBase & {
      kind: "pull-request";
      proof: CompleteCorrectionProof | { status: "held" };
    })
  | (CorrectionCandidateBase & {
      kind: "work-unit";
      proof:
        | (CompleteCorrectionProof & {
            decisionDigest: string;
            /** Exact claim IDs of this unit in the authenticated decision. */
            expectedClaimIds: string[];
            claims: CorrectionClaim[];
          })
        | { status: "held" };
    });
export interface PointsCorrectionBaseline {
  revisionCount: number;
  /** SHA-256 of JSON.stringify(the ordered immutable revision ID array). */
  revisionIdsDigest: string;
}
export interface PointsImplementationCorrectionManifest {
  schemaVersion: "1";
  rule: "historical-implementation-allocation-v1";
  generatedAt: string;
  baseline: PointsCorrectionBaseline;
  candidates: PointsImplementationCorrectionCandidate[];
}
/** Keep this input private. No reason or financial state enters the result. */
export interface PointsCorrectionEligibility {
  candidateId: string;
  eligible: boolean;
}
export interface PointsCorrectionDisposition {
  candidateId: string;
  status: "applied" | "unchanged" | "held" | "retained" | "already-applied";
}
export interface PointsImplementationCorrectionResult {
  journal: PointsJournal;
  manifestDigest: string;
  dispositions: PointsCorrectionDisposition[];
}

const node = /^[A-Za-z0-9_=-]{4,256}$/u;
const digest = /^[a-f0-9]{64}$/u;
const sha = /^[a-f0-9]{40}$/u;
const fail = (message: string): never => {
  throw new TypeError(`Implementation correction: ${message}`);
};
function check(value: unknown, message: string): asserts value {
  if (!value) fail(message);
}
function instant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    left.length === right.length &&
    left.every((item) => rightSet.has(item))
  );
}
function actor(value: CorrectionActor | null): void {
  if (value === null) return;
  check(
    value &&
      node.test(value.id) &&
      (value.kind === "Bot"
        ? /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/u.test(value.login)
        : /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u.test(value.login)) &&
      ["User", "Bot", "Mannequin", "Organization"].includes(value.kind),
    "invalid GitHub actor",
  );
}
function eligibleActor(
  value: CorrectionActor | null,
): value is CorrectionActor & { kind: "User" } {
  return value?.kind === "User" && isCreditEligibleCommitAuthor(value);
}
function validParentShas(
  commit: CorrectionCommit,
): commit is CorrectionCommit & { parentShas: string[] } {
  return (
    Array.isArray(commit.parentShas) &&
    commit.parentShas.length === commit.parentCount &&
    new Set(commit.parentShas).size === commit.parentCount &&
    commit.parentShas.every(
      (parent) =>
        typeof parent === "string" && sha.test(parent) && parent !== commit.sha,
    )
  );
}

/** Unaccepted carrier-authored context cannot receive any accepted claim. */
export function isOriginalContributorContext(
  source: CorrectionSource,
  accepted: CorrectionSource,
): boolean {
  return (
    source.sourceId !== accepted.sourceId &&
    source.occurredAt === null &&
    source.complete &&
    source.repositoryNodeId === accepted.repositoryNodeId &&
    source.repository.toLowerCase() === accepted.repository.toLowerCase() &&
    eligibleActor(source.author) &&
    eligibleActor(accepted.author) &&
    source.author.id === accepted.author.id &&
    source.commits.every(
      (commit) =>
        !commit.retainedCopy &&
        (commit.firstAcceptedSourceId === null ||
          commit.firstAcceptedSourceId === accepted.sourceId),
    )
  );
}

/** A resolved direct reference retains the authenticated carrier statement. */
export function referencesOriginalContributorSource(
  body: string,
  repository: string,
  number: number,
): boolean {
  const text = githubLinkDestinations(body).replace(
    /\[[^[\]\n]*\](?:\[[^[\]\n]*\])?/gu,
    " ",
  );
  return [
    ...text.matchAll(
      /(?:https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/|(?<![\w/?.:=&-])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#)([1-9]\d*)\b/gu,
    ),
  ].some(
    (match) =>
      Number(match[3]) === number &&
      (match[1] ?? match[2] ?? repository).toLowerCase() ===
        repository.toLowerCase(),
  );
}

/** The accepting merger acknowledges a repair at its exact retained source head. */
export function isOriginalContributorRepair(
  repair: OriginalContributorRepair,
  original: CorrectionSource,
  accepted: CorrectionSource,
  commit: CorrectionCommit,
): boolean {
  const { digest: referenceDigest, ...reference } = repair.reference;
  const pull = reference.pull;
  const acknowledgement = reference.acknowledgement;
  const source = repair.sourceId === original.sourceId ? original : accepted;
  const text = acknowledgement?.body ?? pull.body ?? "";
  const bodyEdit = reference.bodyEdit;
  const bodyActor =
    bodyEdit?.lastEditedAt === null ? bodyEdit.author : bodyEdit?.editor;
  const actorId = acknowledgement?.user?.node_id ?? bodyActor?.id;
  const actorType = acknowledgement?.user?.type ?? bodyActor?.type;
  const occurredAt =
    acknowledgement?.created_at ??
    acknowledgement?.submitted_at ??
    bodyEdit?.lastEditedAt ??
    pull.updated_at;
  const edited = acknowledgement?.updated_at;
  return (
    (repair.sourceId === original.sourceId ||
      repair.sourceId === accepted.sourceId) &&
    repair.commitSha === commit.sha &&
    repair.authorNodeId === commit.author?.id &&
    eligibleActor(commit.author) &&
    Object.keys(reference.sourceDigests).length === 2 &&
    digest.test(reference.sourceDigests[original.sourceId] ?? "") &&
    digest.test(reference.sourceDigests[accepted.sourceId] ?? "") &&
    pull.node_id === source.sourceId &&
    Number.isSafeInteger(pull.number) &&
    pull.number > 0 &&
    source.sourceUrl.endsWith(`/pull/${pull.number}`) &&
    pull.html_url === source.sourceUrl &&
    pull.head.sha === source.headSha &&
    pull.state === "closed" &&
    (source.occurredAt === null
      ? pull.merged_at === null
      : pull.merged_at !== null &&
        Date.parse(pull.merged_at) === Date.parse(source.occurredAt)) &&
    accepted.occurredAt !== null &&
    actorType === "User" &&
    reference.acceptingPull.node_id === accepted.sourceId &&
    Number.isSafeInteger(reference.acceptingPull.number) &&
    accepted.sourceUrl.endsWith(`/pull/${reference.acceptingPull.number}`) &&
    reference.acceptingPull.head.sha === accepted.headSha &&
    reference.acceptingPull.html_url === accepted.sourceUrl &&
    reference.acceptingPull.merged_at !== null &&
    Date.parse(reference.acceptingPull.merged_at) ===
      Date.parse(accepted.occurredAt) &&
    reference.acceptingPull.merged_by?.type === "User" &&
    actorId === reference.acceptingPull.merged_by.node_id &&
    Number.isFinite(Date.parse(occurredAt ?? "")) &&
    Date.parse(occurredAt ?? "") <= Date.parse(pull.updated_at) &&
    (acknowledgement === undefined || acknowledgement.node_id.length > 0) &&
    (edited === undefined || edited === occurredAt) &&
    (acknowledgement !== undefined ||
      (bodyEdit?.id === pull.node_id &&
        bodyEdit.body === pull.body &&
        bodyEdit.headRefOid === pull.head.sha &&
        bodyEdit.mergedAt === pull.merged_at &&
        bodyEdit.updatedAt === pull.updated_at)) &&
    digest.test(referenceDigest) &&
    sha256Hex(JSON.stringify(reference)) === referenceDigest &&
    sha.test(reference.headSha) &&
    (repair.sourceId === original.sourceId ||
      referencesOriginalContributorSource(
        text,
        original.repository,
        Number(original.sourceUrl.split("/").at(-1)),
      )) &&
    sameRepositoryCommitHints(source.repository, text).includes(
      reference.headSha,
    ) &&
    (reference.headSha === original.headSha ||
      reference.headSha === accepted.headSha)
  );
}

/** Authenticate the later carrier range without counting intervening work. */
export function isOriginalContributorFollowup(
  source: CorrectionSource,
  accepted: CorrectionSource,
  binding: OriginalContributorFollowup | undefined,
  claims?: readonly CorrectionClaim[],
  scoped?: { anchorSha: string; origin: CorrectionActor },
): boolean {
  if (
    !binding ||
    binding.sourceId !== source.sourceId ||
    (binding.ancestorSha !== accepted.headSha &&
      binding.ancestorSha !== scoped?.anchorSha) ||
    !sha.test(binding.ancestorSha) ||
    source.sourceId === accepted.sourceId ||
    source.occurredAt === null ||
    accepted.occurredAt === null ||
    source.occurredAt < accepted.occurredAt ||
    source.repositoryNodeId !== accepted.repositoryNodeId ||
    !eligibleActor(source.author) ||
    !eligibleActor(accepted.author) ||
    (source.author.id !== accepted.author.id &&
      (!scoped || source.author.id !== scoped.origin.id))
  )
    return false;
  if (
    claims &&
    ((!claims.length && !scoped) ||
      claims.some((claim) => claim.sourceId !== source.sourceId))
  )
    return false;
  if (binding.reference) {
    if (claims) return false;
    const { digest: referenceDigest, ...reference } = binding.reference;
    const pull = reference.pull,
      target = reference.target;
    return (
      digest.test(referenceDigest) &&
      digest.test(reference.sourceDigest) &&
      sha256Hex(JSON.stringify(reference)) === referenceDigest &&
      binding.commits.length === 0 &&
      pull.node_id === source.sourceId &&
      pull.html_url === source.sourceUrl &&
      pull.head.sha === source.headSha &&
      pull.state === "closed" &&
      pull.merged_at !== null &&
      Date.parse(pull.merged_at) === Date.parse(source.occurredAt) &&
      pull.user.type === "User" &&
      pull.user.node_id === accepted.author.id &&
      target.id === accepted.sourceId &&
      target.url === accepted.sourceUrl &&
      target.url ===
        `https://github.com/${target.repository}/pull/${target.number}` &&
      target.repository.toLowerCase() === accepted.repository.toLowerCase() &&
      (referencesOriginalContributorSource(
        pull.body ?? "",
        target.repository,
        target.number,
      ) ||
        (reference.acknowledgement?.user?.type === "User" &&
          reference.acknowledgement.user.node_id === accepted.author.id &&
          Boolean(reference.acknowledgement.node_id) &&
          Number.isFinite(
            Date.parse(
              reference.acknowledgement.created_at ??
                reference.acknowledgement.submitted_at ??
                "",
            ),
          ) &&
          referencesOriginalContributorSource(
            reference.acknowledgement.body,
            target.repository,
            target.number,
          ))) &&
      source.commits.every(
        (commit) =>
          commit.parentCount > 1 ||
          (commit.firstAcceptedSourceId === source.sourceId &&
            !commit.retainedCopy &&
            commit.author?.id === accepted.author?.id &&
            commit.author?.kind === accepted.author?.kind),
      )
    );
  }
  if (!binding.commits.length) return false;
  const graph = new Map(binding.commits.map((commit) => [commit.sha, commit]));
  if (
    graph.size !== binding.commits.length ||
    !graph.has(source.headSha) ||
    binding.commits.some(
      (commit) =>
        !sha.test(commit.sha) ||
        !commit.parentShas.length ||
        new Set(commit.parentShas).size !== commit.parentShas.length ||
        commit.parentShas.some(
          (parent) => !sha.test(parent) || parent === commit.sha,
        ),
    )
  )
    return false;
  const visited = new Set<string>();
  const pending = [source.headSha];
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index];
    if (visited.has(current)) continue;
    visited.add(current);
    for (const parent of graph.get(current)?.parentShas ?? []) {
      if (graph.has(parent)) pending.push(parent);
    }
  }
  if (visited.size !== graph.size || graph.has(binding.ancestorSha))
    return false;
  const completed = new Set<string>();
  const descends = new Set([binding.ancestorSha]);
  for (let pass = 0; pass < graph.size; pass++) {
    let added = false;
    for (const commit of graph.values()) {
      if (
        completed.has(commit.sha) ||
        commit.parentShas.some(
          (parent) => graph.has(parent) && !completed.has(parent),
        )
      )
        continue;
      completed.add(commit.sha);
      if (commit.parentShas.some((parent) => descends.has(parent)))
        descends.add(commit.sha);
      added = true;
    }
    if (!added) break;
  }
  if (completed.size !== graph.size) return false;
  return (
    descends.has(source.headSha) &&
    (claims
      ? claims.every((claim) => {
          const commit = source.commits.find(
            (item) => item.sha === claim.commitSha,
          );
          return (
            commit &&
            correctionClaimCommit(commit) &&
            commit.files?.some((file) => file.path === claim.path) &&
            commit.firstAcceptedSourceId === source.sourceId &&
            !commit.retainedCopy &&
            (commit.author?.id === accepted.author?.id ||
              (scoped &&
                (commit.author === null ||
                  commit.author.id === scoped.origin.id))) &&
            (commit.author === null || commit.author.kind === "User") &&
            descends.has(commit.sha) &&
            validParentShas(commit) &&
            JSON.stringify(commit.parentShas) ===
              JSON.stringify(graph.get(commit.sha)?.parentShas)
          );
        })
      : source.commits.every(
          (commit) =>
            commit.parentCount > 1 ||
            (commit.firstAcceptedSourceId === source.sourceId &&
              !commit.retainedCopy &&
              commit.author?.id === accepted.author?.id &&
              commit.author?.kind === accepted.author?.kind &&
              descends.has(commit.sha) &&
              validParentShas(commit) &&
              JSON.stringify(commit.parentShas) ===
                JSON.stringify(graph.get(commit.sha)?.parentShas)),
        ))
  );
}

/** Verify a single reviewed unit while retaining the full integration census. */
export function originalContributorClaimScope(
  original: CorrectionSource,
  accepted: CorrectionSource,
  claims: readonly CorrectionClaim[],
  followups: readonly {
    source: CorrectionSource;
    binding: OriginalContributorFollowup;
  }[] = [],
  anchorSha = original.headSha,
  repairs: readonly OriginalContributorRepair[] = [],
): boolean {
  const origin = original.author;
  const carrier = accepted.author;
  if (
    !eligibleActor(origin) ||
    !eligibleActor(carrier) ||
    origin.id === carrier.id ||
    original.repositoryNodeId !== accepted.repositoryNodeId ||
    !original.complete ||
    original.commitCount !== original.commits.length ||
    !accepted.complete ||
    accepted.commitCount !== accepted.commits.length ||
    !claims.length ||
    new Set(claims.map((claim) => claim.id)).size !== claims.length
  )
    return false;
  const originals = new Map(
    original.commits.map((commit) => [commit.sha, commit]),
  );
  const anchor = originals.get(anchorSha);
  const acceptedAnchor = accepted.commits.find(
    (commit) => commit.sha === anchorSha,
  );
  if (
    originals.size !== original.commits.length ||
    !originals.has(original.headSha) ||
    !anchor ||
    !acceptedAnchor ||
    acceptedAnchor.firstAcceptedSourceId !== accepted.sourceId ||
    anchor.parentCount > 2 ||
    (anchor.parentCount > 1 && !eligibleActor(anchor.author)) ||
    (anchor.author !== null &&
      anchor.author.id !== origin.id &&
      anchor.author.id !== carrier.id) ||
    acceptedAnchor.author?.id !== anchor.author?.id ||
    acceptedAnchor.author?.kind !== anchor.author?.kind
  )
    return false;
  const graph = new Map<string, CorrectionCommit & { parentShas: string[] }>();
  for (const source of [accepted, ...followups.map((item) => item.source)]) {
    for (const commit of source.commits) {
      const previous = graph.get(commit.sha);
      const parentShas = commit.parentShas ?? previous?.parentShas;
      if (!parentShas || !validParentShas({ ...commit, parentShas }))
        return false;
      if (
        previous &&
        (JSON.stringify(previous.parentShas) !== JSON.stringify(parentShas) ||
          previous.author?.id !== commit.author?.id ||
          previous.author?.kind !== commit.author?.kind)
      )
        return false;
      graph.set(commit.sha, { ...commit, parentShas });
    }
  }
  for (const { binding } of followups) {
    for (const commit of binding.commits) {
      const existing = graph.get(commit.sha);
      if (
        existing &&
        JSON.stringify(existing.parentShas) !==
          JSON.stringify(commit.parentShas)
      )
        return false;
      if (!existing)
        graph.set(commit.sha, {
          ...commit,
          parentCount: commit.parentShas.length,
          author: null,
          additions: null,
          deletions: null,
          firstAcceptedSourceId: null,
        });
    }
  }
  for (const commit of original.commits) {
    const existing = graph.get(commit.sha);
    const parentShas = commit.parentShas ?? existing?.parentShas;
    if (!parentShas || !validParentShas({ ...commit, parentShas }))
      return false;
    if (
      existing &&
      (JSON.stringify(existing.parentShas) !== JSON.stringify(parentShas) ||
        (existing.firstAcceptedSourceId !== null &&
          (existing.author?.id !== commit.author?.id ||
            existing.author?.kind !== commit.author?.kind)))
    )
      return false;
    graph.set(commit.sha, { ...commit, parentShas });
  }
  const remaining = new Map(
    [...graph].map(([id, commit]) => [
      id,
      commit.parentShas.filter((parent) => graph.has(parent)).length,
    ]),
  );
  const ready = [...remaining]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  for (const id of ready)
    for (const [child, commit] of graph) {
      if (!commit.parentShas.includes(id)) continue;
      const count = (remaining.get(child) ?? 0) - 1;
      remaining.set(child, count);
      if (count === 0) ready.push(child);
    }
  if (ready.length !== graph.size) return false;
  const descends = (child: string, ancestor: string) => {
    const pending = [child];
    const visited = new Set<string>();
    for (const current of pending) {
      if (current === ancestor) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(graph.get(current)?.parentShas ?? []));
    }
    return false;
  };
  if (
    !original.commits.every((commit) => descends(original.headSha, commit.sha))
  )
    return false;
  const scoped = { anchorSha, origin };
  const followupIds = new Set(followups.map(({ source }) => source.sourceId));
  if (
    followupIds.size !== followups.length ||
    followupIds.has(accepted.sourceId) ||
    followups.some(
      ({ source, binding }) =>
        !isOriginalContributorFollowup(
          source,
          accepted,
          binding,
          claims.filter((claim) => claim.sourceId === source.sourceId),
          scoped,
        ),
    )
  )
    return false;
  if (
    new Set(repairs.map((repair) => repair.commitSha)).size !==
      repairs.length ||
    repairs.some((repair) => {
      const commit = graph.get(repair.commitSha);
      return (
        !commit ||
        !claims.some((claim) => claim.commitSha === repair.commitSha) ||
        !isOriginalContributorRepair(repair, original, accepted, commit) ||
        !descends(commit.sha, anchorSha) ||
        !descends(repair.reference.headSha, commit.sha)
      );
    })
  )
    return false;
  let hasOriginal = false;
  for (const claim of claims) {
    const source =
      claim.sourceId === accepted.sourceId
        ? accepted
        : followups.find((item) => item.source.sourceId === claim.sourceId)
            ?.source;
    const commit = source?.commits.find((item) => item.sha === claim.commitSha);
    if (
      !commit ||
      !correctionClaimCommit(commit) ||
      commit.firstAcceptedSourceId !== source?.sourceId ||
      !commit.files?.some((file) => file.path === claim.path)
    )
      return false;
    const repair = repairs.find((repair) => repair.commitSha === commit.sha);
    const acknowledgedRepair =
      repair !== undefined &&
      isOriginalContributorRepair(repair, original, accepted, commit) &&
      descends(commit.sha, anchorSha) &&
      descends(repair.reference.headSha, commit.sha);
    if (originals.has(commit.sha)) {
      if (
        commit.author !== null &&
        commit.author.id !== origin.id &&
        commit.author.id !== carrier.id &&
        !acknowledgedRepair
      )
        return false;
      if (commit.author?.id === carrier.id && !descends(commit.sha, anchorSha))
        return false;
      if (
        commit.parentCount <= 1 &&
        (commit.author === null || commit.author.id === origin.id)
      )
        hasOriginal = true;
    } else if (
      !eligibleActor(commit.author) ||
      (commit.author.id !== origin.id &&
        commit.author.id !== carrier.id &&
        !acknowledgedRepair) ||
      !descends(commit.sha, anchorSha)
    )
      return false;
  }
  return hasOriginal;
}

/** A carrier's commits count as follow-ups only after the verified contributor
 * has started work in the authenticated original PR history. */
export function originalContributorPrecedesFollowups(
  original: CorrectionSource,
  carrier: CorrectionActor | null,
): boolean {
  const origin = original.author;
  if (
    !eligibleActor(origin) ||
    !eligibleActor(carrier) ||
    origin.id === carrier.id
  )
    return false;
  const ordinary = original.commits.filter((commit) => commit.parentCount <= 1);
  if (
    !ordinary.some((commit) => commit.author?.id === origin.id) ||
    ordinary.some(
      (commit) =>
        !eligibleActor(commit.author) ||
        (commit.author.id !== origin.id && commit.author.id !== carrier.id),
    )
  )
    return false;
  if (ordinary.every((commit) => commit.author?.id === origin.id)) return true;

  const bySha = new Map(original.commits.map((commit) => [commit.sha, commit]));
  if (bySha.size !== original.commits.length || !bySha.has(original.headSha))
    return false;
  const pending = new Map<string, number>();
  const children = new Map<string, CorrectionCommit[]>();
  const ready: CorrectionCommit[] = [];
  for (const commit of original.commits) {
    if (!validParentShas(commit)) return false;
    const parents = commit.parentShas.filter((parent) => bySha.has(parent));
    pending.set(commit.sha, parents.length);
    if (!parents.length) ready.push(commit);
    for (const parent of parents) {
      const descendants = children.get(parent) ?? [];
      descendants.push(commit);
      children.set(parent, descendants);
    }
  }
  const reachable = new Set([original.headSha]);
  for (const oid of reachable) {
    for (const parent of bySha.get(oid)?.parentShas ?? [])
      if (bySha.has(parent)) reachable.add(parent);
  }
  if (reachable.size !== bySha.size) return false;
  const afterOrigin = new Set<string>();
  for (const commit of ready) {
    const hasOriginalAncestor = afterOrigin.has(commit.sha);
    const startedByOrigin =
      commit.parentCount <= 1 && commit.author?.id === origin.id;
    if (
      commit.parentCount <= 1 &&
      commit.author?.id === carrier.id &&
      !hasOriginalAncestor
    )
      return false;
    for (const child of children.get(commit.sha) ?? []) {
      if (hasOriginalAncestor || startedByOrigin) afterOrigin.add(child.sha);
      const waiting = (pending.get(child.sha) ?? 0) - 1;
      pending.set(child.sha, waiting);
      if (waiting === 0) ready.push(child);
    }
  }
  // A cycle refuses the source even if another branch supplied a valid origin.
  return ready.length === original.commits.length;
}

function sourceRepository(url: string, projectId: string): string {
  const parsed = new URL(url);
  const match = /^\/([^/]+\/[^/]+)\/pull\/[1-9][0-9]*$/u.exec(parsed.pathname);
  check(
    parsed.origin === "https://github.com" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      match,
    "invalid pull request URL",
  );
  check(
    findHistoricalRepository(match[1])?.projectId === projectId,
    "source repository does not belong to the project",
  );
  return match[1].toLowerCase();
}
export function createPointsCorrectionBaseline(
  journal: PointsJournal,
): PointsCorrectionBaseline {
  assertPointsJournal(journal);
  return {
    revisionCount: journal.revisions.length,
    revisionIdsDigest: sha256Hex(
      JSON.stringify(journal.revisions.map((revision) => revision.id)),
    ),
  };
}
export function pointsImplementationCorrectionDigest(
  manifest: PointsImplementationCorrectionManifest,
): string {
  return sha256Hex(JSON.stringify(manifest));
}
function poolKey(projectId: string, sourceId: string, unit?: string): string {
  return JSON.stringify([projectId, sourceId, unit ?? null]);
}
function pools(revisions: Iterable<PointRevision>) {
  const result = new Map<string, PointRevision[]>();
  for (const revision of revisions) {
    const award = revision.award;
    if (award.category !== "merged-pull-request") continue;
    const own =
      award.key ===
      pointKey(award.projectId, award.actor.id, award.category, award.sourceId);
    const key = poolKey(
      award.projectId,
      award.sourceId,
      own ? undefined : award.workUnitId,
    );
    const rows = result.get(key) ?? [];
    rows.push(revision);
    result.set(key, rows);
  }
  return result;
}
export function correctionClaimCommit(commit: CorrectionCommit): boolean {
  return (
    commit.parentCount <= 1 ||
    Boolean(
      commit.mergeResolution &&
        commit.parentShas &&
        mergeResolutionLineCounts(commit.mergeResolution, {
          sha: commit.sha,
          parents: commit.parentShas.map((sha) => ({ sha })),
        })?.length,
    )
  );
}
interface DerivedProof {
  actors: Map<string, CorrectionActor>;
  weights: Map<string, bigint>;
  /** Repository/commit/path scopes; * means all paths in an ordinary PR. */
  scopes: { commit: string; path: string }[];
}
function deriveProof(
  candidate: PointsImplementationCorrectionCandidate,
): DerivedProof | null {
  const proof = candidate.proof;
  if (proof.status === "held") return null;
  check(digest.test(proof.censusDigest), "invalid ownership census digest");
  if (proof.originalContributorParts !== undefined) {
    check(
      candidate.kind === "work-unit" &&
        candidate.proof.status === "complete" &&
        candidate.occurredAt.startsWith("2026-10-") &&
        proof.originalContributor === undefined &&
        proof.originalContributorParts.length >= 2 &&
        sameSet(
          proof.originalContributorParts.map((part) => part.originalSourceId),
          proof.originalContributorParts.map((part) => part.originalSourceId),
        ),
      "invalid multi-original native unit",
    );
    const parts = proof.originalContributorParts;
    const claims = candidate.proof.claims;
    check(
      sameSet(
        candidate.proof.expectedClaimIds,
        claims.map((claim) => claim.id),
      ) &&
        parts.every(
          (part) =>
            part.exactAcceptance === true &&
            Array.isArray(part.claimIds) &&
            part.claimIds.length > 0,
        ) &&
        sameSet(
          parts.flatMap((part) => part.claimIds ?? []),
          claims.map((claim) => claim.id),
        ) &&
        parts.some(
          (part) =>
            (part.acceptedSourceId ?? candidate.sourceId) ===
              candidate.sourceId ||
            part.originalSourceId === candidate.sourceId ||
            part.followups?.some(
              (followup) => followup.sourceId === candidate.sourceId,
            ),
        ),
      "native subproofs do not partition the complete unit",
    );
    const completion = proof.sources.find(
      (source) => source.sourceId === candidate.sourceId,
    );
    check(
      completion &&
        completion.sourceUrl === candidate.sourceUrl &&
        completion.occurredAt === candidate.occurredAt,
      "completion source does not match the recorded pool",
    );
    let result: DerivedProof | null = null;
    for (const part of parts) {
      const acceptedId = part.acceptedSourceId ?? candidate.sourceId;
      const accepted = proof.sources.find(
        (source) => source.sourceId === acceptedId,
      );
      check(
        accepted &&
          accepted.occurredAt !== null &&
          accepted.occurredAt <= candidate.occurredAt,
        "native subproof acceptance exceeds the unit completion",
      );
      const selected = claims.filter((claim) =>
        part.claimIds?.includes(claim.id),
      );
      const partSourceIds = new Set([
        accepted.sourceId,
        part.originalSourceId,
        ...(part.followups ?? []).map((followup) => followup.sourceId),
      ]);
      const partCompletion = proof.sources
        .filter(
          (source) =>
            partSourceIds.has(source.sourceId) &&
            source.occurredAt !== null &&
            source.occurredAt <= candidate.occurredAt,
        )
        .sort(
          (left, right) =>
            (right.occurredAt ?? "").localeCompare(left.occurredAt ?? "") ||
            left.sourceId.localeCompare(right.sourceId),
        )[0];
      check(
        partCompletion?.occurredAt,
        "native subproof lacks a verified completion source",
      );
      const binding = {
        ...part,
        acceptedSourceId:
          partCompletion.sourceId === accepted.sourceId
            ? undefined
            : accepted.sourceId,
      };
      const derived = deriveProof({
        ...candidate,
        sourceId: partCompletion.sourceId,
        sourceUrl: partCompletion.sourceUrl,
        occurredAt: partCompletion.occurredAt,
        proof: {
          ...candidate.proof,
          originalContributorParts: undefined,
          originalContributor: binding,
          expectedClaimIds: selected.map((claim) => claim.id),
          claims: selected,
        },
      });
      if (derived === null) return null;
      check(
        derived.actors.size === 1 &&
          (!result ||
            [...derived.actors.keys()][0] === [...result.actors.keys()][0]),
        "native subproofs identify different originating contributors",
      );
      if (result) result.scopes.push(...derived.scopes);
      else result = derived;
    }
    return result;
  }
  check(
    sameSet(
      candidate.sourceIds,
      proof.sources.map((source) => source.sourceId),
    ),
    "incomplete or duplicate source scope",
  );
  const sources = new Map(
    proof.sources.map((source) => [source.sourceId, source]),
  );
  let incomplete = false;
  for (const source of sources.values()) {
    const nativeCarrier = proof.originalContributor?.claimIds
      ? sources.get(
          proof.originalContributor.acceptedSourceId ?? candidate.sourceId,
        )
      : undefined;
    const nativeContext =
      nativeCarrier &&
      source.commits.every(
        (commit) =>
          commit.parentCount <= 2 &&
          commit.firstAcceptedSourceId === nativeCarrier.sourceId &&
          nativeCarrier.commits.some(
            (copy) =>
              copy.sha === commit.sha &&
              copy.parentCount === commit.parentCount &&
              copy.author?.id === commit.author?.id &&
              copy.author?.kind === commit.author?.kind,
          ),
      );
    const unclaimedContext =
      candidate.kind === "work-unit" &&
      proof.status === "complete" &&
      "claims" in proof &&
      !proof.claims.some((claim) => claim.sourceId === source.sourceId);
    const mergedOriginal =
      candidate.kind === "work-unit" &&
      proof.originalContributor?.exactAcceptance === true &&
      (proof.originalContributor.originalSourceId === source.sourceId ||
        nativeContext) &&
      source.sourceId !== candidate.sourceId &&
      source.occurredAt !== null &&
      source.occurredAt >= candidate.occurredAt;
    check(
      node.test(source.sourceId) &&
        node.test(source.repositoryNodeId) &&
        sha.test(source.headSha) &&
        count(source.commitCount) &&
        typeof source.complete === "boolean" &&
        (source.occurredAt === null || instant(source.occurredAt)) &&
        (source.occurredAt === null ||
          source.occurredAt <= candidate.occurredAt ||
          mergedOriginal ||
          unclaimedContext) &&
        sourceRepository(source.sourceUrl, candidate.projectId) ===
          source.repository.toLowerCase(),
      "invalid source identity",
    );
    actor(source.author);
    if (!source.complete || source.commitCount !== source.commits.length)
      incomplete = true;
    if (source.complete && source.commitCount === source.commits.length)
      check(
        source.commits.some((commit) => commit.sha === source.headSha),
        "complete commit census does not reach the source head",
      );
    check(
      new Set(source.commits.map((commit) => commit.sha)).size ===
        source.commits.length,
      "duplicate source commit",
    );
    for (const commit of source.commits) {
      check(
        sha.test(commit.sha) &&
          count(commit.parentCount) &&
          (commit.parentShas === undefined || validParentShas(commit)) &&
          (commit.additions === null || count(commit.additions)) &&
          (commit.deletions === null || count(commit.deletions)) &&
          (commit.firstAcceptedSourceId === null ||
            node.test(commit.firstAcceptedSourceId)),
        "invalid commit proof",
      );
      actor(commit.author);
      if (commit.mergeResolution) {
        const files = commit.parentShas
          ? mergeResolutionLineCounts(commit.mergeResolution, {
              sha: commit.sha,
              parents: commit.parentShas.map((sha) => ({ sha })),
            })
          : null;
        check(
          files && JSON.stringify(files) === JSON.stringify(commit.files),
          "resolution file evidence differs from canonical patch",
        );
      }
      if (commit.files) {
        check(
          sameSet(
            commit.files.map((file) => file.path),
            commit.files.map((file) => file.path),
          ) &&
            commit.files.every(
              (file) =>
                file.path && count(file.additions) && count(file.deletions),
            ),
          "invalid or duplicate commit file",
        );
        if (
          !commit.mergeResolution &&
          commit.additions !== null &&
          commit.deletions !== null
        )
          check(
            commit.files.reduce((n, file) => n + BigInt(file.additions), 0n) ===
              BigInt(commit.additions) &&
              commit.files.reduce(
                (n, file) => n + BigInt(file.deletions),
                0n,
              ) === BigInt(commit.deletions),
            "commit file counts do not reconcile",
          );
      }
    }
  }
  const completion = sources.get(candidate.sourceId);
  check(
    completion &&
      completion.sourceUrl === candidate.sourceUrl &&
      completion.occurredAt === candidate.occurredAt,
    "completion source does not match the recorded pool",
  );
  const acceptedSourceId = proof.originalContributor?.acceptedSourceId;
  const accepted = acceptedSourceId
    ? sources.get(acceptedSourceId)
    : completion;
  check(
    accepted &&
      (acceptedSourceId === undefined ||
        (node.test(acceptedSourceId) &&
          candidate.kind === "work-unit" &&
          ((proof.originalContributor?.originalSourceId ===
            candidate.sourceId &&
            proof.originalContributor.exactAcceptance === true) ||
            proof.originalContributor?.followups?.some(
              (item) => item.sourceId === candidate.sourceId,
            )) &&
          accepted.sourceId !== candidate.sourceId &&
          accepted.occurredAt !== null &&
          accepted.occurredAt <= candidate.occurredAt)),
    "accepted carrier does not bind the recorded original completion",
  );
  if (incomplete) return null;
  const actors = new Map<string, CorrectionActor>();
  const weights = new Map<string, bigint>();
  const scopes: DerivedProof["scopes"] = [];
  const credit = (source: CorrectionSource, commit: CorrectionCommit) => {
    if (eligibleActor(commit.author)) {
      check(!commit.retainedCopy, "linked author must not be overridden");
      return commit.author;
    }
    const retained = commit.retainedCopy;
    if (!retained) return eligibleActor(source.author) ? source.author : null;
    check(
      digest.test(retained.bindingDigest) &&
        node.test(retained.originalSourceId) &&
        sha.test(retained.originalCommitSha) &&
        retained.originalSourceId !== source.sourceId &&
        commit.files &&
        commit.files.length > 0 &&
        sameSet(
          retained.boundPaths,
          commit.files.map((file) => file.path),
        ),
      "retained copy lacks complete accepted-path bindings",
    );
    const original = sources.get(retained.originalSourceId);
    const originalCommit = original?.commits.find(
      (item) => item.sha === retained.originalCommitSha,
    );
    check(
      original &&
        original.occurredAt === null &&
        original.repositoryNodeId === source.repositoryNodeId &&
        originalCommit &&
        originalCommit.parentCount <= 1 &&
        (originalCommit.author?.id ?? null) === (commit.author?.id ?? null) &&
        (originalCommit.author?.kind ?? null) === (commit.author?.kind ?? null),
      "retained original does not bind this accepted commit",
    );
    return eligibleActor(original.author) ? original.author : null;
  };
  const add = (
    source: CorrectionSource,
    commit: CorrectionCommit,
    additions: number | null,
    deletions: number | null,
    path: string,
  ) => {
    if (
      !correctionClaimCommit(commit) ||
      (candidate.kind === "pull-request" && commit.parentCount > 1) ||
      commit.firstAcceptedSourceId !== source.sourceId
    )
      return;
    scopes.push({ commit: `${source.repositoryNodeId}\0${commit.sha}`, path });
    const recipient = credit(source, commit);
    if (!recipient) {
      incomplete = true;
      return;
    }
    actors.set(recipient.id, recipient);
    if (additions === null || deletions === null) {
      incomplete = true;
      return;
    }
    weights.set(
      recipient.id,
      (weights.get(recipient.id) ?? 0n) + BigInt(additions) + BigInt(deletions),
    );
  };
  if (candidate.kind === "pull-request") {
    for (const commit of accepted.commits)
      add(accepted, commit, commit.additions, commit.deletions, "*");
  } else {
    const grouped = candidate.proof;
    check(grouped.status === "complete", "missing grouped proof");
    check(
      digest.test(grouped.decisionDigest) &&
        grouped.expectedClaimIds.length > 0 &&
        sameSet(
          grouped.expectedClaimIds,
          grouped.claims.map((claim) => claim.id),
        ),
      "grouped claims do not match the retained unit scope",
    );
    for (const claim of grouped.claims) {
      check(
        node.test(claim.id) && sha.test(claim.commitSha) && claim.path,
        "invalid grouped claim",
      );
      const source = sources.get(claim.sourceId);
      const commit = source?.commits.find(
        (item) => item.sha === claim.commitSha,
      );
      const file = commit?.files?.find((item) => item.path === claim.path);
      check(
        source &&
          source.occurredAt !== null &&
          commit &&
          correctionClaimCommit(commit) &&
          commit.firstAcceptedSourceId === source.sourceId,
        "grouped claim has no unique accepted ordinary commit",
      );
      if (!file) {
        incomplete = true;
        continue;
      }
      add(source, commit, file.additions, file.deletions, claim.path);
    }
  }
  const scopeKeys = scopes.map((scope) => `${scope.commit}\0${scope.path}`);
  check(sameSet(scopeKeys, scopeKeys), "duplicate implementation claim");
  if (proof.originalContributor !== undefined) {
    const binding = proof.originalContributor;
    check(
      candidate.occurredAt.startsWith("2026-10-") &&
        binding &&
        (binding.exactAcceptance === undefined ||
          binding.exactAcceptance === true) &&
        digest.test(binding.bindingDigest) &&
        Array.isArray(binding.boundPaths) &&
        binding.boundPaths.length > 0,
      "original-contributor proof is invalid outside the October replacement rule",
    );
    const original = sources.get(binding.originalSourceId);
    const originalCommit = original?.commits.find(
      (commit) => commit.sha === binding.originalCommitSha,
    );
    const acceptedCommit = accepted.commits.find(
      (commit) => commit.sha === binding.acceptedCommitSha,
    );
    if (binding.claimIds !== undefined) {
      check(
        candidate.kind === "work-unit" &&
          candidate.proof.status === "complete" &&
          binding.exactAcceptance === true &&
          original &&
          acceptedCommit &&
          binding.originalCommitSha === binding.acceptedCommitSha &&
          sameSet(
            binding.boundPaths,
            acceptedCommit.parentCount === 2
              ? [
                  ...new Set(
                    candidate.proof.claims
                      .filter((claim) => claim.sourceId === accepted.sourceId)
                      .map((claim) => claim.path),
                  ),
                ]
              : (acceptedCommit.files ?? []).map((file) => file.path),
          ) &&
          sameSet(
            binding.claimIds,
            candidate.proof.claims.map((claim) => claim.id),
          ) &&
          originalContributorClaimScope(
            original,
            accepted,
            candidate.proof.claims,
            (binding.followups ?? []).map((followup) => {
              const source = sources.get(followup.sourceId);
              check(source, "original-contributor follow-up source is missing");
              return { source, binding: followup };
            }),
            binding.originalCommitSha,
            binding.repairs,
          ),
        "original-contributor unit scope does not bind the reviewed native claims",
      );
      if (incomplete) return null;
      const origin = original.author;
      check(eligibleActor(origin), "original unit creator is unavailable");
      return {
        actors: new Map([[origin.id, origin]]),
        weights: new Map([[origin.id, 1n]]),
        scopes,
      };
    }
    check(
      original &&
        original.sourceId !== accepted.sourceId &&
        (original.occurredAt === null ||
          (candidate.kind === "work-unit" &&
            binding.exactAcceptance === true &&
            original.occurredAt >= candidate.occurredAt &&
            original.commits.every(
              (commit) =>
                commit.parentCount <= 1 &&
                commit.firstAcceptedSourceId === accepted.sourceId &&
                accepted.commits.some(
                  (copy) =>
                    copy.sha === commit.sha &&
                    copy.parentCount === commit.parentCount &&
                    copy.author?.id === commit.author?.id &&
                    copy.author?.kind === commit.author?.kind,
                ),
            ))) &&
        original.repositoryNodeId === accepted.repositoryNodeId &&
        eligibleActor(original.author) &&
        eligibleActor(accepted.author) &&
        original.author.id !== accepted.author.id &&
        originalCommit &&
        originalCommit.parentCount <= 1 &&
        originalCommit.author?.id === original.author.id &&
        originalCommit.author.kind === original.author.kind &&
        acceptedCommit &&
        acceptedCommit.parentCount <= 1 &&
        acceptedCommit.firstAcceptedSourceId === accepted.sourceId &&
        (acceptedCommit.author === null ||
          (acceptedCommit.author.id === original.author.id &&
            acceptedCommit.author.kind === original.author.kind)) &&
        acceptedCommit.files &&
        sameSet(
          binding.boundPaths,
          acceptedCommit.files.map((file) => file.path),
        ),
      "original-contributor proof does not bind verified accepted work",
    );
    if (candidate.kind === "work-unit") {
      check(
        candidate.proof.status === "complete" &&
          candidate.proof.claims.every((claim) => {
            const commit = sources
              .get(claim.sourceId)
              ?.commits.find((item) => item.sha === claim.commitSha);
            return (
              !commit ||
              commit.parentCount <= 1 ||
              (eligibleActor(commit.author) &&
                (commit.author.id === original.author?.id ||
                  commit.author.id === accepted.author?.id))
            );
          }),
        "Claimed resolution has an unrelated author",
      );
      const claims =
        candidate.proof.status === "complete" ? candidate.proof.claims : [];
      const followupBindings = binding.followups ?? [];
      check(
        new Set(followupBindings.map((item) => item.sourceId)).size ===
          followupBindings.length,
        "duplicate original-contributor follow-up binding",
      );
      const followups = followupBindings.map((item) => {
        const source = sources.get(item.sourceId);
        check(
          source && isOriginalContributorFollowup(source, accepted, item),
          "invalid original-contributor follow-up ancestry",
        );
        return source;
      });
      const acceptedSources = [accepted, ...followups];
      const acceptedIds = new Set(
        acceptedSources.map((source) => source.sourceId),
      );
      check(
        [...sources.values()].every(
          (source) =>
            acceptedIds.has(source.sourceId) ||
            source.sourceId === original.sourceId ||
            isOriginalContributorContext(source, accepted),
        ) &&
          claims.every((claim) => acceptedIds.has(claim.sourceId)) &&
          acceptedSources.every((source) =>
            source.commits.every(
              (commit) =>
                commit.parentCount > 1 ||
                commit.firstAcceptedSourceId !== source.sourceId ||
                (commit.files !== undefined && commit.files.length > 0),
            ),
          ) &&
          claims.length > 0,
        "grouped original credit must cover one complete accepted replacement",
      );
    }
    check(
      binding.exactAcceptance !== true ||
        (binding.originalCommitSha === binding.acceptedCommitSha &&
          binding.originalCommitSha === original.headSha &&
          accepted.commits.every(validParentShas)),
      "exact original-contributor proof does not bind the original head",
    );
    const origin = original.author;
    const carrier = accepted.author;
    if (
      incomplete ||
      !originalContributorPrecedesFollowups(original, carrier) ||
      (binding.exactAcceptance === true &&
        !originalContributorPrecedesFollowups(
          { ...accepted, author: origin },
          carrier,
        )) ||
      accepted.commits.some(
        (commit) =>
          commit !== acceptedCommit &&
          commit.parentCount <= 1 &&
          commit.firstAcceptedSourceId === accepted.sourceId &&
          (!eligibleActor(commit.author) ||
            (commit.author.id !== origin.id &&
              commit.author.id !== carrier.id)),
      )
    )
      return null;
    return {
      actors: new Map([[origin.id, origin]]),
      weights: new Map([[origin.id, 1n]]),
      scopes,
    };
  }
  if (actors.size === 1 && incomplete && scopes.length > 0) {
    // A sole verified recipient needs no line ratio. Missing recipient identity
    // is different: every accepted scope must still resolve to that recipient.
    const allResolved =
      scopes.length ===
      (candidate.kind === "pull-request"
        ? accepted.commits.filter(
            (commit) =>
              commit.parentCount <= 1 &&
              commit.firstAcceptedSourceId === accepted.sourceId &&
              credit(accepted, commit) !== null,
          ).length
        : 0);
    if (allResolved)
      return {
        actors,
        weights: new Map([[[...actors.keys()][0], 0n]]),
        scopes,
      };
  }
  return incomplete || !actors.size ? null : { actors, weights, scopes };
}

/** Apply only a complete, current, privately eligible set of existing pools. */
export function applyPointsImplementationCorrections(
  journal: PointsJournal,
  manifest: PointsImplementationCorrectionManifest,
  eligibility: readonly PointsCorrectionEligibility[],
  recordedAt: string,
  participationBans: ReadonlyMap<string, string>,
): PointsImplementationCorrectionResult {
  assertPointsJournal(journal);
  check(
    participationBans instanceof Map,
    "current participation bans are required",
  );
  const bannedAt = new Map<string, number>();
  for (const [actorId, at] of participationBans) {
    check(
      typeof actorId === "string" && node.test(actorId) && instant(at),
      "invalid participation ban identity or date",
    );
    bannedAt.set(actorId, Date.parse(at));
  }
  check(
    manifest.schemaVersion === "1" &&
      manifest.rule === "historical-implementation-allocation-v1" &&
      instant(manifest.generatedAt) &&
      instant(recordedAt) &&
      recordedAt >= manifest.generatedAt &&
      recordedAt >= journal.generatedAt &&
      count(manifest.baseline.revisionCount) &&
      manifest.baseline.revisionCount <= journal.revisions.length &&
      digest.test(manifest.baseline.revisionIdsDigest),
    "invalid manifest or recording time",
  );
  const prefix = journal.revisions.slice(0, manifest.baseline.revisionCount);
  check(
    sha256Hex(JSON.stringify(prefix.map((revision) => revision.id))) ===
      manifest.baseline.revisionIdsDigest,
    "baseline is not the current journal prefix",
  );
  check(
    sameSet(
      manifest.candidates.map((candidate) => candidate.id),
      eligibility.map((entry) => entry.candidateId),
    ) && eligibility.every((entry) => typeof entry.eligible === "boolean"),
    "private eligibility must cover every candidate exactly once",
  );
  const permitted = new Map(
    eligibility.map((entry) => [entry.candidateId, entry.eligible]),
  );
  const baseline = latestPoints({ ...journal, revisions: prefix });
  const current = latestPoints(journal);
  const baselinePools = pools(baseline.values());
  const currentPools = pools(current.values());
  const manifestDigest = pointsImplementationCorrectionDigest(manifest);
  const priorApplication = journal.revisions.filter(
    (revision) => revision.sourceDigest === manifestDigest,
  );
  const plans = manifest.candidates.map((candidate) => {
    check(
      node.test(candidate.id) &&
        node.test(candidate.sourceId) &&
        instant(candidate.occurredAt) &&
        candidate.occurredAt <= manifest.generatedAt &&
        candidate.workUnitId &&
        sameSet(candidate.sourceIds, candidate.sourceIds) &&
        candidate.sourceIds.includes(candidate.sourceId) &&
        candidate.sourceIds.every((id) => node.test(id)) &&
        ["pull-request", "work-unit"].includes(candidate.kind),
      "invalid candidate identity",
    );
    sourceRepository(candidate.sourceUrl, candidate.projectId);
    if (candidate.kind === "work-unit")
      check(
        /^wu_[a-f0-9]{64}$/u.test(candidate.workUnitId),
        "invalid grouped unit ID",
      );
    const key = poolKey(
      candidate.projectId,
      candidate.sourceId,
      candidate.kind === "work-unit" ? candidate.workUnitId : undefined,
    );
    const previous = baselinePools.get(key) ?? [];
    check(previous.length > 0, "candidate has no recorded pool");
    check(
      sameSet(
        previous.map((revision) => `${revision.award.key}\0${revision.id}`),
        candidate.expectedPredecessors.map(
          (entry) => `${entry.key}\0${entry.revisionId}`,
        ),
      ) &&
        previous.every(
          ({ award }) =>
            award.occurredAt === candidate.occurredAt &&
            award.sourceUrl === candidate.sourceUrl &&
            award.workUnitId === candidate.workUnitId,
        ),
      "pool predecessors or immutable identity differ",
    );
    const appliedOctoberDecision = previous.some(
      (revision) =>
        revision.decision?.reason === OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION,
    );
    const usesOctoberDecision =
      candidate.proof.status === "complete" &&
      (candidate.proof.originalContributor !== undefined ||
        candidate.proof.originalContributorParts !== undefined);
    const proof =
      appliedOctoberDecision && !usesOctoberDecision
        ? null
        : deriveProof(candidate);
    if (candidate.kind === "work-unit" && candidate.proof.status === "complete")
      check(
        previous.every(
          (revision) =>
            revision.decision?.sourceId ===
            `value:${candidate.proof.status === "complete" ? candidate.proof.decisionDigest : ""}`,
        ),
        "grouped proof does not match retained valuation provenance",
      );
    const total = previous.reduce(
      (sum, revision) => sum + BigInt(revision.award.amount),
      0n,
    );
    check(total <= BigInt(Number.MAX_SAFE_INTEGER), "pool total overflows");
    const replacements: PointAward[] = [];
    if (proof && total > 0n) {
      const ids = [...proof.actors.keys()];
      const shares = shareImplementationPoints(
        Number(total),
        ids,
        proof.weights,
      );
      const template = previous[0].award;
      for (const [index, id] of ids.entries()) {
        const key = pointKey(
          candidate.projectId,
          id,
          "merged-pull-request",
          candidate.sourceId,
          candidate.kind === "work-unit" ? candidate.workUnitId : undefined,
        );
        const before = previous.find(
          (revision) => revision.award.key === key,
        )?.award;
        if (shares[index] === 0 && !before) continue;
        const recipient = proof.actors.get(id);
        check(recipient, "derived recipient is unavailable");
        replacements.push({
          ...(before ?? template),
          key,
          actor: before?.actor ?? { id, login: recipient.login },
          amount: shares[index],
        });
      }
      for (const { award } of previous)
        if (!replacements.some((replacement) => replacement.key === award.key))
          replacements.push({ ...award, amount: 0 });
    }
    const changed = replacements.filter(
      (award) =>
        JSON.stringify(award) !==
          JSON.stringify(baseline.get(award.key)?.award) ||
        (usesOctoberDecision &&
          award.amount > 0 &&
          baseline.get(award.key)?.decision?.reason !==
            OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION),
    );
    const participationHeld = replacements.some((award) => {
      const at = bannedAt.get(award.actor.id);
      return (
        award.amount > 0 &&
        at !== undefined &&
        Date.parse(candidate.occurredAt) >= at
      );
    });
    return {
      candidate,
      key,
      previous,
      proof,
      changed,
      participationHeld,
      usesOctoberDecision,
    };
  });
  check(
    sameSet(
      plans.flatMap((plan) =>
        plan.previous.map((revision) => revision.award.key),
      ),
      plans.flatMap((plan) =>
        plan.previous.map((revision) => revision.award.key),
      ),
    ),
    "a pool is selected more than once",
  );
  const selected = new Set(
    plans.flatMap((plan) =>
      plan.previous.map((revision) => revision.award.key),
    ),
  );
  const selectedSources = new Set(
    plans.flatMap((plan) =>
      plan.candidate.sourceIds.map((id) =>
        JSON.stringify([plan.candidate.projectId, id]),
      ),
    ),
  );
  for (const revision of baseline.values())
    check(
      !(
        revision.award.category === "merged-pull-request" &&
        revision.award.amount > 0 &&
        selectedSources.has(
          JSON.stringify([revision.award.projectId, revision.award.sourceId]),
        ) &&
        !selected.has(revision.award.key)
      ),
      "source scope omits a recorded implementation pool",
    );
  const commitIdentities = new Map<string, string>();
  const commitParents = new Map<string, string>();
  for (const plan of plans) {
    if (plan.candidate.proof.status !== "complete") continue;
    for (const source of plan.candidate.proof.sources)
      for (const commit of source.commits) {
        const key = `${source.repositoryNodeId}\0${commit.sha}`;
        const identity = JSON.stringify([
          commit.parentCount,
          commit.author?.id ?? null,
          commit.author?.kind ?? null,
          commit.additions,
          commit.deletions,
        ]);
        const previous = commitIdentities.get(key);
        check(
          previous === undefined || previous === identity,
          "immutable commit evidence conflicts",
        );
        commitIdentities.set(key, identity);
        if (commit.parentShas !== undefined) {
          const parents = JSON.stringify(commit.parentShas);
          const priorParents = commitParents.get(key);
          check(
            priorParents === undefined || priorParents === parents,
            "immutable commit parent evidence conflicts",
          );
          commitParents.set(key, parents);
        }
      }
  }
  // Existing positive pools can overlap because an ordinary PR award and a
  // later joint award were both retained. That ambiguity withholds their
  // connected component; it is not malformed evidence about unrelated work.
  const ambiguous = new Set<(typeof plans)[number]>();
  const scopes = new Map<string, Map<string, Set<(typeof plans)[number]>>>();
  for (const plan of plans)
    for (const scope of plan.proof?.scopes ?? []) {
      const paths =
        scopes.get(scope.commit) ??
        new Map<string, Set<(typeof plans)[number]>>();
      const overlapping =
        scope.path === "*"
          ? [...paths.values()].flatMap((owners) => [...owners])
          : [...(paths.get("*") ?? []), ...(paths.get(scope.path) ?? [])];
      for (const other of overlapping) {
        ambiguous.add(other);
        ambiguous.add(plan);
      }
      const owners = paths.get(scope.path) ?? new Set<(typeof plans)[number]>();
      owners.add(plan);
      paths.set(scope.path, owners);
      scopes.set(scope.commit, paths);
    }
  // An earlier successful application consumes the whole manifest. It must
  // never overwrite corrections or revocations appended after that application.
  if (priorApplication.length) {
    const expected = new Map(
      plans.flatMap((plan) => plan.changed).map((award) => [award.key, award]),
    );
    check(
      priorApplication.every(
        (revision) =>
          JSON.stringify(expected.get(revision.award.key)) ===
          JSON.stringify(revision.award),
      ),
      "recorded manifest application differs",
    );
    const applied = new Set(
      priorApplication.map((revision) => revision.award.key),
    );
    check(
      plans.every(
        (plan) =>
          !plan.changed.some((award) => applied.has(award.key)) ||
          plan.changed.every((award) => applied.has(award.key)),
      ),
      "partial recorded pool correction",
    );
    return {
      journal,
      manifestDigest,
      dispositions: plans.map((plan) => ({
        candidateId: plan.candidate.id,
        status: plan.changed.some((award) => applied.has(award.key))
          ? "already-applied"
          : "retained",
      })),
    };
  }
  // Connected sources move together: incomplete proof or private ineligibility
  // cannot leave one part of a grouped contribution reassigned in isolation.
  const parent = plans.map((_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parent[current] !== current) current = parent[current];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = current;
      index = next;
    }
    return current;
  };
  const sourceOwner = new Map<string, number>();
  plans.forEach((plan, index) => {
    for (const source of plan.candidate.sourceIds) {
      const key = JSON.stringify([plan.candidate.projectId, source]);
      const prior = sourceOwner.get(key);
      if (prior !== undefined) parent[root(index)] = root(prior);
      else sourceOwner.set(key, index);
    }
  });
  const components = new Map<number, typeof plans>();
  plans.forEach((plan, index) => {
    const key = root(index);
    const component = components.get(key) ?? [];
    component.push(plan);
    components.set(key, component);
  });
  const dispositions = new Map<string, PointsCorrectionDisposition["status"]>();
  const ready: typeof plans = [];
  const currentPositiveSources = new Map<string, PointRevision[]>();
  for (const revision of current.values()) {
    const award = revision.award;
    if (award.category !== "merged-pull-request" || award.amount <= 0) continue;
    const key = JSON.stringify([award.projectId, award.sourceId]);
    const rows = currentPositiveSources.get(key) ?? [];
    rows.push(revision);
    currentPositiveSources.set(key, rows);
  }
  for (const component of components.values()) {
    const retained = component.some(
      (plan) => !permitted.get(plan.candidate.id),
    );
    const held = component.some(
      (plan) => !plan.proof || ambiguous.has(plan) || plan.participationHeld,
    );
    if (retained || held) {
      for (const plan of component)
        dispositions.set(plan.candidate.id, retained ? "retained" : "held");
      continue;
    }
    if (!component.some((plan) => plan.changed.length > 0)) {
      for (const plan of component)
        dispositions.set(plan.candidate.id, "unchanged");
      continue;
    }
    // A fresh rolling publication may update held or no-write pools while this
    // historical census runs. Only a component that will append awards needs
    // exact current predecessors and complete current sibling scope.
    const componentKeys = new Set(
      component.flatMap((plan) =>
        plan.previous.map((revision) => revision.award.key),
      ),
    );
    const componentSources = new Set(
      component.flatMap((plan) =>
        plan.candidate.sourceIds.map((id) =>
          JSON.stringify([plan.candidate.projectId, id]),
        ),
      ),
    );
    for (const source of componentSources)
      check(
        (currentPositiveSources.get(source) ?? []).every((revision) =>
          componentKeys.has(revision.award.key),
        ),
        "current source scope adds an unselected implementation pool",
      );
    for (const plan of component) {
      const now = currentPools.get(plan.key) ?? [];
      check(
        sameSet(
          now.map((revision) => revision.id),
          plan.previous.map((revision) => revision.id),
        ),
        "selected predecessors changed after the baseline",
      );
    }
    ready.push(...component);
  }
  const apply = (selectedPlans: typeof plans) => {
    const awards = selectedPlans.flatMap((plan) => plan.changed);
    if (!awards.length) return journal;
    const decisions = new Map<string, PointDecision>();
    for (const plan of selectedPlans) {
      const valueSource = [...plan.previous]
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
        .find((revision) => revision.decision?.sourceId.startsWith("value:"))
        ?.decision?.sourceId;
      for (const award of plan.changed)
        decisions.set(award.key, {
          sourceId:
            baseline.get(award.key)?.decision?.sourceId ??
            valueSource ??
            plan.candidate.sourceId,
          effectiveAt: recordedAt,
          reason: plan.usesOctoberDecision
            ? OCTOBER_ORIGINAL_CONTRIBUTOR_DECISION
            : "Verified primary-commit changed lines reallocate this unchanged historical implementation Points pool; its value and occurrence date are preserved.",
        });
    }
    return appendPointAwards(
      journal,
      awards,
      manifestDigest,
      "slop-score-v2",
      recordedAt,
      decisions,
    );
  };
  const next = apply(ready);
  const heldProjects = new Set<string>();
  for (const project of new Set(
    ready.map((plan) => plan.candidate.projectId),
  )) {
    const periods = new Set(
      ready
        .filter((plan) => plan.candidate.projectId === project)
        .map((plan) => plan.candidate.occurredAt.slice(0, 7)),
    );
    for (const period of periods) {
      const before = pointMembers(journal, period, project);
      const after = pointMembers(next, period, project);
      const preservesProjection =
        before.reduce((n, member) => n + BigInt(member.total), 0n) ===
          after.reduce((n, member) => n + BigInt(member.total), 0n) &&
        before.reduce((n, member) => n + BigInt(member.monthly), 0n) ===
          after.reduce((n, member) => n + BigInt(member.monthly), 0n) &&
        after.every((member) => member.total >= 0 && member.monthly >= 0);
      if (!preservesProjection) heldProjects.add(project);
    }
  }
  for (const plan of ready)
    dispositions.set(
      plan.candidate.id,
      heldProjects.has(plan.candidate.projectId)
        ? "held"
        : plan.changed.length
          ? "applied"
          : "unchanged",
    );
  const result = heldProjects.size
    ? apply(ready.filter((plan) => !heldProjects.has(plan.candidate.projectId)))
    : next;
  return {
    journal: result,
    manifestDigest,
    dispositions: manifest.candidates.map((candidate) => {
      const status = dispositions.get(candidate.id);
      check(status, "candidate lacks a disposition");
      return { candidateId: candidate.id, status };
    }),
  };
}
