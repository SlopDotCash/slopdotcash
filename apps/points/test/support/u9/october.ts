import { sha256Of } from "@repo/platform/git/bytes";
import { type Award, type Journal, type Revision, type RevisionBody, keyText, revisionBodyText } from "../../../src/kernels/records/canonical.ts";
import type { CorrectionActor, CorrectionManifest } from "../../../src/corrections/apply/manifest.vibe";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends ReadonlyArray<infer U> ? Mutable<U>[] : T[K] extends object | undefined ? Mutable<T[K]> : T[K] };
export type Manifest = Mutable<CorrectionManifest>;
type Candidate = Manifest["candidates"][number];
type Proof = Extract<Candidate["proof"], { status: "complete" }>;
type Source = Proof["sources"][number];
type Commit = Source["commits"][number];

export const A: CorrectionActor = { id: "MDQ6VXNlcjQy", login: "author-a", kind: "User" };
export const B: CorrectionActor = { id: "MDQ6VXNlcjQz", login: "author-b", kind: "User" };
export const C: CorrectionActor = { id: "MDQ6VXNlcjQ0", login: "carrier", kind: "User" };
export const correctedAt = "2026-11-13T01:00:00.000Z";
export const laterAt = "2026-11-14T00:00:00.000Z";
export const SOURCE = "PR_first";
export const correctionRegistry = JSON.stringify({ projects: [{ id: "asi", repositories: [{ id: "SlopDotCash/asi" }] }] });
const occurred = "2026-01-01T00:00:00.000Z";
const baselineAt = "2026-11-01T00:00:00.000Z";
const collectedAt = "2026-11-13T00:00:00.000Z";
const firstUrl = "https://github.com/SlopDotCash/asi/pull/1";
const value = "d".repeat(64);
const october = "2026-10-23T00:00:00.000Z";
const sha = (letter: string) => letter.repeat(40);

/** @throws {Error} */
function first<T>(items: ReadonlyArray<T>): T {
  const [item] = items;
  if (item === undefined) throw new Error("fixture is empty");
  return item;
}

/** @throws {Error} */
function at<T>(items: ReadonlyArray<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`fixture has no item ${index}`);
  return item;
}

/** @throws {Error} */
function complete(candidate: Candidate): Proof {
  const proof = candidate.proof;
  if (proof.status !== "complete") throw new Error("fixture proof is held");
  return proof;
}

/** @throws {Error} */
function binding(proof: Proof) {
  const bound = proof.originalContributor;
  if (bound === undefined) throw new Error("fixture has no original-contributor binding");
  return bound;
}

/** @throws {never} */
export function award(who: CorrectionActor = C, amount = 13, source = SOURCE, unit = "wu_asi_pr_1", grouped = false): Award {
  return {
    key: sha256Of(keyText({ projectId: "asi", actorId: who.id, category: "merged-pull-request", sourceId: source, ...(grouped ? { workUnitId: unit } : {}) })),
    actor: { id: who.id, login: who.login },
    projectId: "asi",
    category: "merged-pull-request",
    amount,
    occurredAt: occurred,
    sourceId: source,
    sourceUrl: source === SOURCE ? firstUrl : "https://github.com/SlopDotCash/asi/pull/2",
    workUnitId: unit,
    provisional: false,
  };
}

/** @throws {never} */
export function latest(journal: Journal): Map<string, Revision> {
  const rows = new Map<string, Revision>();
  for (const revision of journal.revisions) rows.set(revision.award.key, revision);
  return rows;
}

/** @throws {never} */
function initial(awards: ReadonlyArray<Award>, grouped = false): Journal {
  const revisions = [...awards].sort((left, right) => left.key.localeCompare(right.key)).map((row): Revision => {
    const body: RevisionBody = {
      previous: null,
      recordedAt: baselineAt,
      sourceDigest: "a".repeat(64),
      sourceRule: grouped ? "slop-score-v2" : "slop-score-v1",
      award: row,
      ...(grouped ? { decision: { sourceId: `value:${value}`, effectiveAt: baselineAt, reason: "Retained grouped assessment.", delta: row.amount } } : {}),
    };
    return { id: sha256Of(revisionBodyText(body)), ...body };
  });
  return { schemaVersion: "1", ruleVersion: "slop-points-v1", generatedAt: baselineAt, coverage: [], revisions };
}

/** @throws {never} */
function source(): Source {
  return {
    repository: "SlopDotCash/asi",
    repositoryNodeId: "R_kgDOT23CXA",
    sourceId: SOURCE,
    sourceUrl: firstUrl,
    headSha: sha("b"),
    occurredAt: occurred,
    author: C,
    complete: true,
    commitCount: 2,
    commits: [
      { sha: sha("a"), parentCount: 1, author: A, additions: 1, deletions: 0, firstAcceptedSourceId: SOURCE, files: [{ path: "one.ts", additions: 1, deletions: 0 }] },
      { sha: sha("b"), parentCount: 1, author: B, additions: 2, deletions: 1, firstAcceptedSourceId: SOURCE, files: [{ path: "two.ts", additions: 2, deletions: 1 }] },
    ],
  };
}

/** @throws {never} */
function predecessors(journal: Journal, sourceId?: string) {
  return [...latest(journal).values()].filter((row) => sourceId === undefined || row.award.sourceId === sourceId).map((row) => ({ key: row.award.key, revisionId: row.id }));
}

/** @throws {never} */
function candidate(journal: Journal): Candidate {
  return {
    id: "correction_first",
    kind: "pull-request",
    projectId: "asi",
    sourceId: SOURCE,
    sourceUrl: firstUrl,
    occurredAt: occurred,
    workUnitId: "wu_asi_pr_1",
    sourceIds: [SOURCE],
    expectedPredecessors: predecessors(journal, SOURCE),
    proof: { status: "complete", censusDigest: "c".repeat(64), sources: [source()] },
  };
}

/** @throws {never} */
function manifest(journal: Journal, candidates: Candidate[] = [candidate(journal)]): Manifest {
  return {
    schemaVersion: "1",
    rule: "historical-implementation-allocation-v1",
    generatedAt: collectedAt,
    baseline: { revisionCount: journal.revisions.length, revisionIdsDigest: sha256Of(JSON.stringify(journal.revisions.map((row) => row.id))) },
    candidates,
  };
}

/** @throws {never} */
export function amounts(journal: Journal, sourceId = SOURCE): Record<string, number> {
  return Object.fromEntries([...latest(journal).values()].filter((row) => row.award.sourceId === sourceId).map((row) => [row.award.actor.id, row.award.amount]));
}

/** @throws {never} */
export function totalOf(journal: Journal): number {
  return [...latest(journal).values()].reduce((sum, row) => sum + row.award.amount, 0);
}

/** @throws {Error} */
export function octoberReplacement(occurredAt = october, awards: ReadonlyArray<Award> = [award(A, 10), award(C, 20)]) {
  const journal = initial(awards.map((row) => ({ ...row, occurredAt })));
  const input = manifest(journal);
  const row = first(input.candidates);
  const proof = complete(row);
  const accepted = first(proof.sources);
  row.occurredAt = occurredAt;
  accepted.occurredAt = occurredAt;
  at(accepted.commits, 1).author = C;
  const originalId = "PR_original";
  proof.sources.push({
    ...accepted,
    sourceId: originalId,
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/10",
    headSha: sha("c"),
    occurredAt: null,
    author: A,
    commitCount: 1,
    commits: [{ ...first(accepted.commits), sha: sha("c"), firstAcceptedSourceId: null }],
  });
  row.sourceIds.push(originalId);
  proof.originalContributor = { originalSourceId: originalId, originalCommitSha: sha("c"), acceptedCommitSha: sha("a"), boundPaths: ["one.ts"], bindingDigest: "f".repeat(64) };
  return { journal, input, proof };
}

/** @throws {Error} */
export function legacyAfter(journal: Journal): Manifest {
  const legacy = octoberReplacement();
  const input = manifest(journal);
  const row = first(input.candidates);
  row.occurredAt = first(legacy.input.candidates).occurredAt;
  complete(row).sources = legacy.proof.sources.slice(0, 1);
  return input;
}

/** @throws {Error} */
export function octoberOriginalWithFollowup() {
  const sample = octoberReplacement();
  const original = at(sample.proof.sources, 1);
  const contributorCommit = first(original.commits);
  contributorCommit.parentShas = [sha("0")];
  const baseSync: Commit = { ...contributorCommit, sha: sha("d"), parentCount: 2, parentShas: [contributorCommit.sha, sha("9")], additions: null, deletions: null };
  const followup: Commit = { ...contributorCommit, sha: sha("e"), author: C, parentShas: [baseSync.sha] };
  original.headSha = followup.sha;
  original.commits = [followup, baseSync, contributorCommit];
  original.commitCount = original.commits.length;
  return { ...sample, original, contributorCommit, followup, baseSync };
}

type FollowupSample = ReturnType<typeof octoberOriginalWithFollowup>;

export const unauthenticatedFollowups: ReadonlyArray<(sample: FollowupSample) => void> = [
  (sample) => { delete sample.followup.parentShas; },
  (sample) => { sample.followup.parentShas = [sha("8")]; },
  (sample) => { sample.followup.author = null; },
  (sample) => { sample.followup.author = B; },
  (sample) => { sample.baseSync.parentShas = [sample.contributorCommit.sha, sample.followup.sha]; },
  (sample) => {
    sample.original.headSha = sample.baseSync.sha;
    sample.contributorCommit.parentShas = [sample.followup.sha];
    sample.followup.parentShas = [sha("8")];
    sample.baseSync.parentShas = [sample.contributorCommit.sha, sha("7")];
  },
];

/** @throws {Error} */
export function malformedFollowup() {
  const sample = octoberOriginalWithFollowup();
  sample.baseSync.parentShas = [sample.contributorCommit.sha, sample.contributorCommit.sha];
  return sample;
}

/** @throws {Error} */
export function competingContributor() {
  const sample = octoberReplacement();
  at(first(sample.proof.sources).commits, 1).author = B;
  return sample;
}

/** @throws {Error} */
export function unrelatedAnchor() {
  const sample = octoberReplacement();
  binding(sample.proof).boundPaths = ["unrelated.ts"];
  return sample;
}

/** @throws {Error} */
export function octoberGroupedReplacement() {
  const sample = octoberReplacement();
  const unit = `wu_${"e".repeat(64)}`;
  const journal = initial([...latest(sample.journal).values()].map(({ award: row }) => ({
    ...row,
    key: sha256Of(keyText({ projectId: row.projectId, actorId: row.actor.id, category: row.category, sourceId: row.sourceId, workUnitId: unit })),
    workUnitId: unit,
  })), true);
  const accepted = first(sample.proof.sources);
  const claims = accepted.commits.flatMap((commit) => (commit.files ?? []).map((file, index) => ({ id: `claim_${commit.sha}_${index}`, sourceId: accepted.sourceId, commitSha: commit.sha, path: file.path })));
  const grouped: Candidate = {
    ...first(sample.input.candidates),
    kind: "work-unit",
    workUnitId: unit,
    expectedPredecessors: predecessors(journal),
    proof: { ...sample.proof, decisionDigest: value, expectedClaimIds: claims.map((claim) => claim.id), claims },
  };
  return { journal, input: manifest(journal, [grouped]), grouped, proof: complete(grouped) };
}

/** @throws {Error} */
export function exactGroupedReplacement() {
  const sample = octoberGroupedReplacement();
  const accepted = first(sample.proof.sources);
  const original = at(sample.proof.sources, 1);
  const [head, next] = [first(accepted.commits), at(accepted.commits, 1)];
  original.headSha = head.sha;
  first(original.commits).sha = head.sha;
  head.parentShas = [sha("0")];
  next.parentShas = [head.sha];
  const bound = binding(sample.proof);
  bound.exactAcceptance = true;
  bound.originalCommitSha = head.sha;
  return { ...sample, next };
}

type GroupedSample = ReturnType<typeof octoberGroupedReplacement>;

export const groupedFaults: ReadonlyArray<readonly [string, (sample: GroupedSample) => void]> = [
  ["partial-claims", (sample) => { sample.proof.claims?.pop(); }],
  ["foreign-source", (sample) => { first(sample.proof.claims ?? []).sourceId = at(sample.proof.sources, 1).sourceId; }],
  ["extra-original", (sample) => {
    const other = structuredClone(at(sample.proof.sources, 1));
    other.sourceId = "PR_second_original";
    other.sourceUrl = "https://github.com/SlopDotCash/asi/pull/11";
    sample.proof.sources.push(other);
    sample.grouped.sourceIds.push(other.sourceId);
  }],
  ["third-author", (sample) => { at(first(sample.proof.sources).commits, 1).author = B; }],
  ["missing-files", (sample) => { delete at(first(sample.proof.sources).commits, 1).files; }],
  ["wrong-value", (sample) => { sample.proof.decisionDigest = "b".repeat(64); }],
];

/** @throws {Error} */
export function mergedDonorGroupedReplacement() {
  const sample = octoberGroupedReplacement();
  const accepted = first(sample.proof.sources);
  const donor = at(sample.proof.sources, 1);
  const [head, next] = [first(accepted.commits), at(accepted.commits, 1)];
  donor.occurredAt = "2026-10-23T00:00:03.000Z";
  donor.headSha = head.sha;
  const donorCommit = first(donor.commits);
  donorCommit.sha = donor.headSha;
  donorCommit.firstAcceptedSourceId = accepted.sourceId;
  head.parentShas = [sha("0")];
  next.parentShas = [head.sha];
  const bound = binding(sample.proof);
  bound.exactAcceptance = true;
  bound.originalCommitSha = donor.headSha;
  return { ...sample, accepted, donor };
}

/** @throws {Error} */
export function laterAcceptedFollowup() {
  const sample = octoberGroupedReplacement();
  const { grouped, proof } = sample;
  const accepted = first(proof.sources);
  const followup: Source = {
    ...structuredClone(accepted),
    sourceId: "PR_followup",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/4",
    headSha: sha("9"),
    occurredAt: "2026-10-24T00:00:00.000Z",
    commits: [{ sha: sha("9"), parentCount: 1, parentShas: [accepted.headSha], author: C, firstAcceptedSourceId: "PR_followup", additions: 3, deletions: 0, files: [{ path: "followup.ts", additions: 3, deletions: 0 }] }],
    commitCount: 1,
  };
  proof.sources.push(followup);
  grouped.sourceIds.push(followup.sourceId);
  proof.claims?.push({ id: "claim_followup", sourceId: followup.sourceId, commitSha: followup.headSha, path: "followup.ts" });
  proof.expectedClaimIds?.push("claim_followup");
  const bound = binding(proof);
  bound.acceptedSourceId = accepted.sourceId;
  bound.followups = [{ sourceId: followup.sourceId, ancestorSha: accepted.headSha, commits: [{ sha: followup.headSha, parentShas: [accepted.headSha] }] }];
  const followupAt = followup.occurredAt ?? "";
  grouped.sourceId = followup.sourceId;
  grouped.sourceUrl = followup.sourceUrl;
  grouped.occurredAt = followupAt;
  const journal = initial([...latest(sample.journal).values()].map(({ award: row }) => ({
    ...row,
    key: sha256Of(keyText({ projectId: row.projectId, actorId: row.actor.id, category: row.category, sourceId: followup.sourceId, workUnitId: row.workUnitId })),
    sourceId: followup.sourceId,
    sourceUrl: followup.sourceUrl,
    occurredAt: followupAt,
  })), true);
  grouped.expectedPredecessors = predecessors(journal);
  return { ...sample, journal, input: manifest(journal, [grouped]), accepted, followup };
}

/** @throws {Error} */
export function scopedUnlinkedOriginal() {
  const sample = mergedDonorGroupedReplacement();
  const { proof, accepted, donor } = sample;
  first(donor.commits).author = null;
  first(accepted.commits).author = null;
  const third = structuredClone(at(accepted.commits, 1));
  third.sha = sha("f");
  third.author = B;
  third.parentShas = [accepted.headSha];
  accepted.commits.push(third);
  accepted.commitCount += 1;
  accepted.headSha = third.sha;
  binding(proof).claimIds = (proof.claims ?? []).map((claim) => claim.id);
  return sample;
}

type ScopedSample = ReturnType<typeof scopedUnlinkedOriginal>;

export const nativeUnitFaults: ReadonlyArray<readonly [string, (sample: ScopedSample) => void]> = [
  ["claim-scope", (sample) => { binding(sample.proof).claimIds = []; }],
  ["third-author-claim", (sample) => { at(sample.proof.claims ?? [], 1).commitSha = sha("f"); }],
  ["missing-origin", (sample) => {
    sample.proof.claims = (sample.proof.claims ?? []).slice(1);
    sample.proof.expectedClaimIds = sample.proof.claims.map((claim) => claim.id);
    binding(sample.proof).claimIds = [...sample.proof.expectedClaimIds];
  }],
  ["disconnected-followup", (sample) => { at(sample.accepted.commits, 1).parentShas = [sha("0")]; }],
  ["linked-other-origin", (sample) => { first(sample.donor.commits).author = B; }],
  ["wrong-copy", (sample) => { first(sample.accepted.commits).author = B; }],
];

/** @throws {Error} */
export function multiOriginalPrUnit() {
  const sample = scopedUnlinkedOriginal();
  const { donor, accepted, grouped, proof } = sample;
  const second = structuredClone(donor);
  second.sourceId = "PR_second_original";
  second.sourceUrl = "https://github.com/SlopDotCash/asi/pull/5";
  second.headSha = sha("6");
  const secondCommit = first(second.commits);
  secondCommit.sha = second.headSha;
  secondCommit.parentShas = [sha("0")];
  secondCommit.additions = 1;
  secondCommit.deletions = 0;
  secondCommit.files = [{ path: "second.ts", additions: 1, deletions: 0 }];
  accepted.commits.push(structuredClone(secondCommit));
  accepted.commitCount += 1;
  proof.sources.push(second);
  grouped.sourceIds.push(second.sourceId);
  const secondClaim = { id: "claim_second_original", sourceId: accepted.sourceId, commitSha: second.headSha, path: "second.ts" };
  proof.claims?.push(secondClaim);
  proof.expectedClaimIds?.push(secondClaim.id);
  const firstBinding = binding(proof);
  const secondBinding = { ...structuredClone(firstBinding), originalSourceId: second.sourceId, originalCommitSha: second.headSha, acceptedCommitSha: second.headSha, boundPaths: ["second.ts"], claimIds: [secondClaim.id] };
  delete proof.originalContributor;
  proof.originalContributorParts = [firstBinding, secondBinding];
  return { ...sample, second };
}

type MultiSample = ReturnType<typeof multiOriginalPrUnit>;

/** @throws {Error} */
function parts(sample: MultiSample) {
  const found = sample.proof.originalContributorParts;
  if (found === undefined) throw new Error("fixture has no original-contributor parts");
  return found;
}

export const multiOriginalFaults: ReadonlyArray<readonly [string, (sample: MultiSample) => void]> = [
  ["missing-claim", (sample) => { const part = first(parts(sample)); part.claimIds = part.claimIds?.slice(1); }],
  ["repeated-claim", (sample) => { at(parts(sample), 1).claimIds?.push(first(parts(sample)).claimIds?.[0] ?? "missing_claim"); }],
  ["duplicate-original", (sample) => { at(parts(sample), 1).originalSourceId = first(parts(sample)).originalSourceId; }],
  ["ordinary", (sample) => { sample.grouped.kind = "pull-request"; }],
  ["unscoped", (sample) => { delete first(parts(sample)).claimIds; }],
  ["late-acceptance", (sample) => { sample.accepted.occurredAt = "2026-10-26T00:00:00.000Z"; }],
  ["expected-scope", (sample) => { sample.proof.expectedClaimIds?.pop(); }],
];

/** @throws {Error} */
export function independentClaimUnit() {
  const sample = multiOriginalPrUnit();
  const { accepted, proof } = sample;
  const commit: Commit = { sha: sha("8"), parentCount: 1, parentShas: [sha("0")], author: C, firstAcceptedSourceId: accepted.sourceId, additions: 5, deletions: 0, files: [{ path: "independent.ts", additions: 5, deletions: 0 }] };
  accepted.commits.push(commit);
  accepted.commitCount += 1;
  const claim = { id: "claim_independent", sourceId: accepted.sourceId, commitSha: commit.sha, path: "independent.ts" };
  proof.claims?.push(claim);
  proof.expectedClaimIds?.push(claim.id);
  proof.independentClaimIds = [claim.id];
  return sample;
}

/** @throws {Error} */
export function overlappingIndependentClaim(sample: ReturnType<typeof independentClaimUnit>): void {
  sample.proof.independentClaimIds?.push(first(sample.proof.claims ?? []).id);
}

/** @throws {Error} */
export function unpartitionedIndependentClaims() {
  const sample = scopedUnlinkedOriginal();
  sample.proof.independentClaimIds = [];
  return sample;
}
