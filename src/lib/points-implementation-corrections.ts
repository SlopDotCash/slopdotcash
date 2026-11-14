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
import { isCreditEligibleCommitAuthor } from "./commit-credit";
import { shareImplementationPoints } from "./implementation-allocation";
import {
  appendPointAwards,
  assertPointsJournal,
  latestPoints,
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
interface CompleteCorrectionProof {
  status: "complete";
  /** Digest of the complete accepted-source ownership census. */
  censusDigest: string;
  sources: CorrectionSource[];
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
    check(
      node.test(source.sourceId) &&
        node.test(source.repositoryNodeId) &&
        sha.test(source.headSha) &&
        count(source.commitCount) &&
        typeof source.complete === "boolean" &&
        (source.occurredAt === null || instant(source.occurredAt)) &&
        (source.occurredAt === null ||
          source.occurredAt <= candidate.occurredAt) &&
        sourceRepository(source.sourceUrl, candidate.projectId) ===
          source.repository.toLowerCase(),
      "invalid source identity",
    );
    actor(source.author);
    if (!source.complete || source.commitCount !== source.commits.length)
      incomplete = true;
    if (source.complete && source.commitCount === source.commits.length)
      check(
        source.commits.length > 0 &&
          source.commits.at(-1)?.sha === source.headSha,
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
          (commit.additions === null || count(commit.additions)) &&
          (commit.deletions === null || count(commit.deletions)) &&
          (commit.firstAcceptedSourceId === null ||
            node.test(commit.firstAcceptedSourceId)),
        "invalid commit proof",
      );
      actor(commit.author);
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
        if (commit.additions !== null && commit.deletions !== null)
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
  const accepted = sources.get(candidate.sourceId);
  check(
    accepted &&
      accepted.sourceUrl === candidate.sourceUrl &&
      accepted.occurredAt === candidate.occurredAt,
    "completion source does not match the recorded pool",
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
      commit.parentCount > 1 ||
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
        source && source.occurredAt !== null && commit,
        "grouped claim has no unique accepted ordinary commit",
      );
      // A verified synchronization merge resolution may be a unit claim, but
      // only non-merge commits supply implementation lines (as add() does).
      if (commit.parentCount > 1) continue;
      check(
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
    const proof = deriveProof(candidate);
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
        JSON.stringify(baseline.get(award.key)?.award),
    );
    const participationHeld = replacements.some((award) => {
      const at = bannedAt.get(award.actor.id);
      return (
        award.amount > 0 &&
        at !== undefined &&
        Date.parse(candidate.occurredAt) >= at
      );
    });
    return { candidate, key, previous, proof, changed, participationHeld };
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
          reason:
            "Verified primary-commit changed lines reallocate this unchanged historical implementation Points pool; its value and occurrence date are preserved.",
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
