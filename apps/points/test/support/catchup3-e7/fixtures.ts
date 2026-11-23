import { createHash } from "node:crypto";
import { sha256Of } from "@repo/platform/git/bytes";
import { type Award, type Journal, type Revision, type RevisionBody, journalText, keyText, revisionBodyText } from "../../../src/kernels/records/canonical.ts";
import type { CorrectionManifest, CorrectionSource } from "../../../src/corrections/apply/manifest.vibe";
import type { HistoricalPacket, PacketRetirement } from "../../../src/corrections/reviewed/packet.vibe";

export const time = "2026-11-15T01:00:00.000Z";
export const actor = { id: btoa("04:User42"), login: "origin", kind: "User" };
export const duplicateReason = "Owner-reviewed duplicate accepted work already rewarded by earlier sources.";

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends ReadonlyArray<infer U> ? Mutable<U>[] : T[K] extends object | undefined ? Mutable<T[K]> : T[K] };
export type Packet = Mutable<HistoricalPacket>;
export type Retirement = Mutable<PacketRetirement>;
type Source = Mutable<CorrectionSource>;

export const hash = (value: unknown) => sha256Of(JSON.stringify(value));
const oid = (raw: string) => createHash("sha1").update(`commit ${Buffer.byteLength(raw)}\0`).update(raw).digest("hex");
export const keyOf = (sourceId: string) => sha256Of(keyText({ projectId: "feed", actorId: actor.id, category: "merged-pull-request", sourceId }));

export function appended(journal: Journal, award: Award, sourceDigest: string, decision?: { sourceId: string; reason: string }): Journal {
  const previous = [...journal.revisions].reverse().find((row) => row.award.key === award.key);
  const body: RevisionBody = {
    previous: previous?.id ?? null,
    recordedAt: time,
    sourceDigest,
    sourceRule: "slop-score-v2",
    award,
    ...(decision === undefined ? {} : { decision: { sourceId: decision.sourceId, effectiveAt: time, reason: decision.reason, delta: award.amount - (previous?.award.amount ?? 0) } }),
  };
  const revision: Revision = { id: sha256Of(revisionBodyText(body)), ...body };
  return { ...journal, generatedAt: time, revisions: [...journal.revisions, revision] };
}

export const batchDigestOf = (journal: Journal) => sha256Of(journalText(journal));

export function baselineOf(journal: Journal) {
  return { revisionCount: journal.revisions.length, revisionIdsDigest: hash(journal.revisions.map((row) => row.id)) };
}

export function fixture() {
  const award: Award = {
    key: keyOf("PR_source"),
    actor: { id: actor.id, login: actor.login },
    projectId: "feed",
    category: "merged-pull-request",
    amount: 30,
    occurredAt: "2026-10-15T00:00:00.000Z",
    sourceId: "PR_source",
    sourceUrl: "https://github.com/feedforagents/feed/pull/1",
    workUnitId: "source",
    provisional: false,
  };
  const empty: Journal = { schemaVersion: "1", ruleVersion: "slop-points-v1", generatedAt: time, coverage: [], revisions: [] };
  const baseline = appended(empty, award, "a".repeat(64));
  const corrections: Mutable<CorrectionManifest> = {
    schemaVersion: "1",
    rule: "historical-implementation-allocation-v1",
    generatedAt: time,
    baseline: baselineOf(baseline),
    candidates: [{
      id: "correction_source",
      kind: "pull-request",
      projectId: "feed",
      sourceId: award.sourceId,
      sourceUrl: award.sourceUrl,
      occurredAt: award.occurredAt,
      workUnitId: award.workUnitId,
      sourceIds: [award.sourceId],
      expectedPredecessors: [{ key: award.key, revisionId: baseline.revisions[0]?.id ?? "" }],
      proof: {
        status: "complete",
        censusDigest: "c".repeat(64),
        sources: [{
          repository: "feedforagents/feed",
          repositoryNodeId: "R_feed",
          sourceId: award.sourceId,
          sourceUrl: award.sourceUrl,
          headSha: "b".repeat(40),
          occurredAt: award.occurredAt,
          author: actor,
          complete: true,
          commitCount: 1,
          commits: [{ sha: "b".repeat(40), parentCount: 1, author: actor, additions: 1, deletions: 0, firstAcceptedSourceId: award.sourceId }],
        }],
      },
    }],
  };
  const packet: Packet = {
    schemaVersion: "1",
    projectId: "feed",
    producerGithubId: "42",
    reviewerGithubId: "42",
    reviewedAt: time,
    baselineDigest: batchDigestOf(baseline),
    baselineRevisionCount: baseline.revisions.length,
    candidateDigest: batchDigestOf(baseline),
    revision: 1,
    manifestSha256: "d".repeat(64),
    sourceAudit: {
      repository: "feedforagents/feed",
      repositoryNodeId: "R_feed",
      from: "2026-09-27T00:00:00.000Z",
      through: "2026-11-01T00:00:00.000Z",
      sources: [{ id: "PR_source", number: 1, headSha: "b".repeat(40), mergedAt: award.occurredAt }],
    },
    valueSnapshot: null,
    valueKeys: [],
    corrections,
    recipientCorrections: [],
  };
  return { packet, baseline, award };
}

function duplicateRetirementFixture() {
  const f = fixture();
  const original = f.award;
  const earlierAward: Award = { ...original, key: keyOf("PR_earlier"), sourceId: "PR_earlier", sourceUrl: "https://github.com/feedforagents/feed/pull/2", workUnitId: "earlier", occurredAt: "2026-10-14T00:00:00.000Z" };
  const baseline = appended(f.baseline, earlierAward, "e".repeat(64));
  const candidate = f.packet.corrections.candidates[0];
  if (candidate === undefined || candidate.proof.status !== "complete") throw Error("fixture");
  const source = structuredClone(candidate.proof.sources[0]) as Source;
  const [commit] = source.commits;
  if (commit === undefined) throw Error("fixture");
  commit.parentShas = ["a".repeat(40)];
  commit.files = [{ path: "work.ts", additions: 1, deletions: 0 }];
  const earlier: Source = { ...structuredClone(source), sourceId: earlierAward.sourceId, sourceUrl: earlierAward.sourceUrl, occurredAt: earlierAward.occurredAt };
  commit.firstAcceptedSourceId = earlier.sourceId;
  const earlierCommit = earlier.commits[0];
  if (earlierCommit !== undefined) earlierCommit.firstAcceptedSourceId = earlier.sourceId;
  const retirement: Retirement = {
    sourceId: source.sourceId,
    workUnitId: original.workUnitId,
    source,
    earlierSources: [earlier],
    coverage: [{ commitSha: commit.sha, path: "work.ts", sourceId: earlier.sourceId }],
    evidence: "",
    evidenceSha256: "",
    expectedPredecessors: [{ key: original.key, revisionId: baseline.revisions[0]?.id ?? "" }],
  };
  f.packet.baselineDigest = batchDigestOf(baseline);
  f.packet.baselineRevisionCount = baseline.revisions.length;
  f.packet.corrections.baseline = baselineOf(baseline);
  const held = { ...structuredClone(candidate), proof: { status: "held" as const } };
  f.packet.corrections.candidates = [held, {
    ...structuredClone(held),
    id: "earlier",
    sourceId: earlier.sourceId,
    sourceUrl: earlier.sourceUrl,
    occurredAt: earlierAward.occurredAt,
    workUnitId: "earlier",
    sourceIds: [earlier.sourceId],
    expectedPredecessors: [{ key: earlierAward.key, revisionId: baseline.revisions[1]?.id ?? "" }],
  }];
  f.packet.sourceAudit.sources.push({ id: earlier.sourceId, number: 2, headSha: earlier.headSha, mergedAt: earlierAward.occurredAt });
  f.packet.duplicateRetirements = [retirement];
  return { ...f, baseline, retirement, original };
}

function earlierAcceptanceFixture() {
  const f = duplicateRetirementFixture();
  const { source } = f.retirement;
  const earlier = f.retirement.earlierSources[0];
  if (earlier === undefined) throw Error("fixture");
  const tree = "f".repeat(40);
  const baseRaw = `tree ${tree}\nauthor Human <human@example.test> 1 +0000\ncommitter Human <human@example.test> 1 +0000\n\nbase\n`;
  const baseSha = oid(baseRaw);
  const raw = `tree ${tree}\nparent ${baseSha}\nauthor Human <human@example.test> 1 +0000\ncommitter Human <human@example.test> 1 +0000\n\nwork\n`;
  const sha = oid(raw);
  for (const item of [source, earlier]) {
    item.headSha = sha;
    const [first] = item.commits;
    if (first === undefined) throw Error("fixture");
    first.sha = sha;
    first.parentShas = [baseSha];
  }
  for (const item of f.packet.sourceAudit.sources) item.headSha = sha;
  const mergeRaw = `tree ${tree}\nparent ${baseSha}\nparent ${sha}\nauthor Human <human@example.test> 2 +0000\ncommitter Human <human@example.test> 2 +0000\n\naccept\n`;
  f.retirement.acceptedPromotion = { headCommit: raw, mergeCommit: mergeRaw, mergeSha: oid(mergeRaw) };
  f.retirement.coverage = [];
  f.retirement.earlierAcceptanceProof = {
    commits: [{ sha, sourceId: earlier.sourceId }],
    sourceBaseSha: baseSha,
    objects: [{ sha, raw }, { sha: baseSha, raw: baseRaw }],
    contextSources: [{ id: earlier.sourceId, number: 2, headSha: sha, baseSha, mergedAt: earlier.occurredAt ?? "", mergeSha: sha }],
  };
  return f;
}

export function mixedSubmittedAndSquashFixture(perPathNative = false) {
  const f = earlierAcceptanceFixture();
  const { retirement } = f;
  const proof = retirement.earlierAcceptanceProof;
  const prior = retirement.earlierSources[0];
  const context = proof?.contextSources[0];
  if (proof === undefined || prior === undefined || context === undefined) throw Error("fixture proof");
  const tree = "f".repeat(40);
  const rawSquash = `tree ${tree}\nparent ${proof.sourceBaseSha}\nauthor Human <human@example.test> 2 +0000\ncommitter Human <human@example.test> 2 +0000\n\nsquash work\n`;
  const squashSha = oid(rawSquash);
  let nativeHead = retirement.source.headSha;
  let submittedHeadCommit = proof.objects[0]?.raw ?? "";
  if (perPathNative) {
    submittedHeadCommit = `tree ${tree}\nparent ${nativeHead}\nauthor Human <human@example.test> 2 +0000\ncommitter Human <human@example.test> 2 +0000\n\nsubmitted follow-up\n`;
    const submittedSha = oid(submittedHeadCommit);
    const first = prior.commits[0];
    if (first === undefined) throw Error("fixture");
    const submittedCommit = { ...first, sha: submittedSha, parentShas: [nativeHead], files: [{ path: "submitted.ts", additions: 1, deletions: 0 }] };
    prior.headSha = submittedSha;
    prior.commits.push(submittedCommit);
    prior.commitCount = prior.commits.length;
    retirement.source.commits.push(structuredClone(submittedCommit));
    context.headSha = submittedSha;
    proof.objects.push({ sha: submittedSha, raw: submittedHeadCommit });
    const audited = f.packet.sourceAudit.sources.find((source) => source.id === prior.sourceId);
    if (audited === undefined) throw Error("fixture prior audit");
    audited.headSha = submittedSha;
    nativeHead = submittedSha;
  }
  const rawHead = `tree ${tree}\nparent ${nativeHead}\nparent ${squashSha}\nauthor Human <human@example.test> 3 +0000\ncommitter Human <human@example.test> 3 +0000\n\npromotion head\n`;
  const headSha = oid(rawHead);
  const rawMerge = `tree ${tree}\nparent ${proof.sourceBaseSha}\nparent ${headSha}\nauthor Human <human@example.test> 4 +0000\ncommitter Human <human@example.test> 4 +0000\n\naccepted promotion\n`;
  const squashCommit = {
    sha: squashSha,
    parentCount: 1,
    parentShas: [proof.sourceBaseSha],
    author: prior.author,
    additions: 1,
    deletions: 0,
    firstAcceptedSourceId: retirement.sourceId,
    files: [{ path: "squashed.ts", additions: 1, deletions: 0 }],
  };
  retirement.acceptedSquashes = [{
    repositoryNodeId: prior.repositoryNodeId,
    sourceId: prior.sourceId,
    sourceUrl: prior.sourceUrl,
    headSha: prior.headSha,
    occurredAt: prior.occurredAt ?? "",
    author: prior.author,
    headCommit: submittedHeadCommit,
    acceptedCommit: rawSquash,
    commit: { ...squashCommit, firstAcceptedSourceId: prior.sourceId },
  }];
  retirement.source.headSha = headSha;
  retirement.source.commits.push(squashCommit, {
    sha: headSha,
    parentCount: 2,
    parentShas: [nativeHead, squashSha],
    author: actor,
    additions: null,
    deletions: null,
    firstAcceptedSourceId: retirement.sourceId,
    files: [],
    mergeResolution: {
      commitSha: headSha,
      parents: [nativeHead, squashSha],
      gitVersion: "git version 2.56.0",
      automaticTree: tree,
      resolvedTree: tree,
      hadConflicts: false,
      patch: "",
      patchSha256: sha256Of(""),
      paths: [],
    },
  } as (typeof retirement.source.commits)[number]);
  retirement.source.commitCount = retirement.source.commits.length;
  const firstAudit = f.packet.sourceAudit.sources[0];
  if (firstAudit !== undefined) firstAudit.headSha = headSha;
  context.mergeSha = squashSha;
  proof.objects.push({ sha: squashSha, raw: rawSquash }, { sha: headSha, raw: rawHead });
  retirement.coverage = [
    { commitSha: squashSha, path: "squashed.ts", sourceId: prior.sourceId },
    ...(perPathNative ? [{ commitSha: nativeHead, path: "submitted.ts", sourceId: prior.sourceId }] : []),
  ];
  retirement.acceptedPromotion = { headCommit: rawHead, mergeCommit: rawMerge, mergeSha: oid(rawMerge) };
  const bind = () => {
    const evidence = JSON.stringify({
      sourceId: retirement.sourceId,
      workUnitId: retirement.workUnitId,
      sourceSha256: hash(retirement.source),
      earlierSourcesSha256: hash(retirement.earlierSources),
      coverageSha256: hash(retirement.coverage),
      earlierAcceptanceProofSha256: hash(proof),
      acceptedSquashesSha256: hash(retirement.acceptedSquashes),
      acceptedPromotionSha256: hash(retirement.acceptedPromotion),
    });
    retirement.evidence = evidence;
    retirement.evidenceSha256 = sha256Of(evidence);
    const expected = appended(f.baseline, { ...f.original, amount: 0 }, hash(retirement), { sourceId: `owner_duplicate_${retirement.evidenceSha256}`, reason: duplicateReason });
    f.packet.candidateDigest = batchDigestOf(expected);
    return expected;
  };
  return { ...f, bind, prior, proof, context, squashSha };
}

export const protectionFor = (period: number) => [{ project: "feed", period, phase: "Collecting" as const, obligationExists: false }];

export function duplicateOrderFixture(mode: "behind" | "reverse" | "missing") {
  const f = mixedSubmittedAndSquashFixture()
  const retired = f.retirement.acceptedPromotion?.mergeSha
  const earlier = f.retirement.earlierAcceptanceProof?.contextSources[0]?.mergeSha
  if (retired === undefined || earlier === undefined) throw Error("fixture order")
  const audit = f.packet.sourceAudit
  const root = `/repos/${audit.repository}`
  const reads: string[] = []
  const fetcher = {
    async fetch(request: Request) {
      const url = new URL(request.url)
      reads.push(url.pathname + url.search)
      if (url.pathname === root) return Response.json({
        id: 1, node_id: audit.repositoryNodeId, full_name: audit.repository, private: false,
      })
      for (const source of audit.sources) {
        if (url.pathname === `${root}/pulls/${source.number}`) return Response.json({
          number: source.number, node_id: source.id, html_url: `https://github.com/${audit.repository}/pull/${source.number}`,
          head: { sha: source.headSha }, state: "closed", merged_at: source.mergedAt,
          base: { sha: source.headSha }, user: null, commits: 1,
          merge_commit_sha: source.id === f.retirement.sourceId ? retired : earlier,
        })
      }
      const oldHead = f.prior.headSha
      if (url.search === "?per_page=1&page=1" &&
        [oldHead, earlier].some((sha) => url.pathname === `${root}/compare/${retired}...${sha}`)) {
        if (mode === "missing") return Response.json({ message: "not found" }, { status: 404 })
        const reverse = mode === "reverse" && url.pathname.endsWith(oldHead)
        return Response.json({
          status: reverse ? "ahead" : "behind", behind_by: reverse ? 0 : 1,
          base_commit: { sha: retired }, merge_base_commit: { sha: reverse ? retired : earlier },
        })
      }
      return Response.json({ message: "unexpected fixture request" }, { status: 404 })
    },
  }
  return { ...f, reads, fetcher }
}
