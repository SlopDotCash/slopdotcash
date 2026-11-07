/** Supersession guarantees for joint reassessments (REPORT section 7):
 * digest-linked retirement, idempotency, joint->joint chains, partial
 * groups, multiple implementers, window boundary, and preservation when
 * the successor is stale or unpublished. Synthetic fixtures only. */
import { afterAll, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import {
  applyPointsSnapshot,
  emptyPointsJournal,
  latestPoints,
  type PointsJournal,
  pointMembers,
} from "../src/lib/points";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { VALUE_RUBRIC_VERSION } from "../src/lib/value-assessment";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import {
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { prepareValueRecord } from "../workers/slopbot/value-journal";
import { valueSourceDigest } from "../workers/slopbot/value-review";
import {
  prepareWorkUnitEvidence,
  type WorkUnitSource,
} from "../workers/slopbot/value-work-unit";
import {
  consumeWorkUnitHistory,
  readWorkUnitHistory,
} from "../workers/slopbot/value-work-unit-consumption";
import { prepareWorkUnitRecord } from "../workers/slopbot/value-work-unit-journal";

setSystemTime(new Date("2027-01-16T00:00:00.000Z"));
afterAll(() => setSystemTime());
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const actor = PENALIZED_AUTHOR;
const owner = PROJECT_OWNER;
const repository = TARGET_REPOSITORIES.find((r) => r.projectId === "asi")!;
const project = fixtureProject("asi");
const old = penaltyScoreInput([]).mergedPullRequests.find(
  (p) => p.id === "PR_november",
)!;
const base = "0".repeat(40);
const provenance = {
  channel: "chatgpt-subscription",
  provider: "openai",
  model: "fixture",
  client: "fixture",
  exactVariant: null,
  identityEvidence: "self-reported",
  apiReceipt: null,
} as const;

type Pull = typeof old;

function source(pull: Pull, path: string, who = actor): WorkUnitSource {
  const user = { node_id: who.id, login: who.login, type: "User" };
  const file = {
    filename: path,
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+export const fixed = true;",
    blob_url: `${repository.githubUrl}/blob/${pull.headRefOid}/${path}`,
  };
  return {
    policy: { sha: base, text: "CONTRIBUTING.md\nCredit accepted work once." },
    evidence: {
      repository: repository.id,
      repositoryPolicy: {
        id: repository.id,
        projectId: repository.projectId,
        integrationBranch: repository.integrationBranch,
        expectedNodeId: repository.expectedNodeId,
      },
      repositoryNodeId: repository.expectedNodeId ?? "R_asi",
      repositoryDatabaseId: 42,
      collectedAt: "2026-12-20T00:00:00.000Z",
      pull: {
        node_id: pull.id,
        number: pull.number,
        html_url: pull.url,
        title: pull.title,
        body: null,
        user,
        merged_by: user,
        state: "closed",
        merged_at: pull.mergedAt,
        closed_at: pull.closedAt,
        updated_at: pull.updatedAt,
        merge_commit_sha: pull.headRefOid,
        head: { sha: pull.headRefOid },
        base: { sha: base, ref: repository.integrationBranch },
        changed_files: 1,
        comments: 0,
        review_comments: 0,
        commits: 1,
      },
      files: [file],
      mergeCommitEvidence: {
        sha: pull.headRefOid,
        html_url: `${repository.githubUrl}/commit/${pull.headRefOid}`,
        parents: [{ sha: base }],
        stats: { additions: 1, deletions: 0, total: 1 },
        files: [file],
      },
      commits: [
        {
          sha: pull.headRefOid,
          html_url: `${repository.githubUrl}/commit/${pull.headRefOid}`,
          author: user,
          committer: user,
          parents: [{ sha: base }],
          commit: {
            message: "Repair the workflow",
            author: { date: pull.createdAt },
            committer: { date: pull.createdAt },
          },
        },
      ],
      reviews: [],
      comments: [],
      reviewComments: [],
      limitations: [],
      evidenceUrls: [pull.url],
      eligibleReviewIds: [],
      implementationActorNodeIds: [who.id],
      commitAttribution: [
        {
          sha: pull.headRefOid,
          actorNodeIds: [who.id],
          changedPaths: [path],
          files: [file],
          limitations: [],
        },
      ],
      relatedPullRequests: [],
    },
  } as WorkUnitSource;
}

function assessment(urls: string[], tier = "medium") {
  return {
    status: "assessed",
    tier,
    rationale: "One accepted workflow, assessed as one outcome.",
    dimensions: Object.fromEntries(
      [
        "alignment",
        "impact",
        "complexity",
        "verification",
        "maintenance",
        "overlap",
      ].map((k) => [k, "Synthetic deterministic accounting fixture."]),
    ),
    evidenceUrls: urls,
    relatedPullRequests: [],
    limitations: [],
    reviews: [],
  };
}

function input(at: string, pulls: Pull[], contexts: Pull[] = []) {
  const i = penaltyScoreInput([], at);
  const template = i.mergedPullRequestOutcomes.find((p) => p.id === old.id)!;
  i.mergedPullRequests = pulls.map((p) => structuredClone(p));
  i.mergedPullRequestOutcomes = pulls.map((p) => ({
    ...template,
    ...structuredClone(p),
    mergedAt: p.mergedAt!,
    baseRefName: repository.integrationBranch,
    commits: [{ oid: p.headRefOid, author: p.author ?? actor }],
  }));
  i.closedUnmergedPullRequests = [];
  i.source.counts.mergedPullRequests = pulls.length;
  i.source.counts.detailedMergedPullRequests = pulls.length;
  i.detailEligibleMergedPullRequestIds = [];
  if (contexts.length)
    i.valueContextPullRequests = contexts.map((p) => structuredClone(p));
  return i;
}

async function solo(pull: Pull, path: string, assessedAt: string, who = actor) {
  const src = source(pull, path, who);
  const prepared = await prepareValueRecord(
    {
      rubricVersion: VALUE_RUBRIC_VERSION,
      sourceDigest: await valueSourceDigest(src.evidence, src.policy),
      pullRequestNodeId: pull.id,
      headSha: pull.headRefOid,
      policySha: base,
      assessedAt,
      verdict: assessment([pull.url]),
      provenance,
    } as never,
    src.evidence,
    src.policy,
    "a".repeat(40),
    null,
    null,
    [project],
  );
  return {
    src,
    prepared,
    digest: prepared.recordDigest,
    decision: {
      status: "assessed",
      record: prepared.record,
      assessment: prepared.record.assessment,
      implementationActorNodeIds: [who.id],
      latestDigest: prepared.recordDigest,
      history: [
        {
          sequence: 1,
          record_digest: prepared.recordDigest,
          record_json: prepared.recordJson,
          recorded_at: assessedAt,
        },
      ],
    },
  };
}

type Solo = Awaited<ReturnType<typeof solo>>;

/** A second solo record for the same source, chained over the first via
 * `supersedes`. It is assessed but, in the interleaving scenario, no
 * snapshot ever publishes it. The returned decision mirrors what the
 * production ingestion hands the snapshot builder for a joint member:
 * the member's complete verified solo history with the new record as
 * its head. */
async function soloRevision(first: Solo, pull: Pull, assessedAt: string) {
  const prepared = await prepareValueRecord(
    {
      rubricVersion: VALUE_RUBRIC_VERSION,
      sourceDigest: await valueSourceDigest(
        first.src.evidence,
        first.src.policy,
      ),
      pullRequestNodeId: pull.id,
      headSha: pull.headRefOid,
      policySha: base,
      assessedAt,
      verdict: assessment([pull.url]),
      provenance,
    } as never,
    first.src.evidence,
    first.src.policy,
    "a".repeat(40),
    first.digest,
    "Reassessed on maintainer request before the joint review.",
    [project],
  );
  const row = (sequence: number, digest: string, json: string, at: string) => ({
    sequence,
    record_digest: digest,
    record_json: json,
    recorded_at: at,
  });
  return {
    prepared,
    digest: prepared.recordDigest,
    decision: {
      status: "assessed",
      record: prepared.record,
      assessment: prepared.record.assessment,
      implementationActorNodeIds: [actor.id],
      latestDigest: prepared.recordDigest,
      history: [
        row(
          1,
          first.digest,
          first.prepared.recordJson,
          "2026-11-06T00:00:00.000Z",
        ),
        row(2, prepared.recordDigest, prepared.recordJson, assessedAt),
      ],
    },
  };
}

type HistoryRow = {
  sequence: number;
  record_digest: string;
  record_json: string;
  recorded_at: string;
  assessment_key: string;
};

function soloSnapshot(at: string, entries: { pull: Pull; solo: Solo }[]) {
  const i = input(
    at,
    entries.map((e) => e.pull),
  );
  i.valueDecisions = new Map(
    entries.map((e) => [e.pull.id, e.solo.decision]),
  ) as never;
  const snapshot = createLeaderboardSnapshot(i);
  assertLeaderboardSnapshot(snapshot);
  return snapshot;
}

async function joint(opts: {
  sources: WorkUnitSource[];
  legacy: [string, string | null][];
  legacyPredecessors: string[];
  supersedes: string[];
  priorRows: HistoryRow[];
  assessedAt: string;
  tier?: string;
  targetId: string;
  reason: string;
}) {
  const evidence = await prepareWorkUnitEvidence(opts.sources, [repository]);
  expect(evidence.limitations).toEqual([]);
  const joint = await prepareWorkUnitRecord(
    {
      rubricVersion: VALUE_RUBRIC_VERSION,
      sourceDigest: evidence.sourceDigest,
      assessedAt: opts.assessedAt,
      verdict: {
        units: [
          {
            claimIds: evidence.claims.map((c) => c.id),
            assessment: assessment(
              opts.sources.map((s) => s.evidence.pull.html_url),
              opts.tier,
            ),
          },
        ],
      },
      provenance,
    } as never,
    evidence,
    "a".repeat(40),
    opts.supersedes,
    opts.legacyPredecessors,
    opts.reason,
    [project],
  );
  const row = {
    sequence: opts.priorRows.length + 1,
    record_digest: joint.recordDigest,
    record_json: joint.recordJson,
    recorded_at: opts.assessedAt,
    assessment_key: joint.assessmentKey,
  };
  const rows: HistoryRow[] = [...opts.priorRows, row];
  const graph = await readWorkUnitHistory(
    async (after: number) => ({
      throughSequence: rows.length,
      totalRecords: rows.length,
      records: rows.filter((r) => r.sequence > after),
      nextAfter: null,
    }),
    {
      repositoryNodeId: opts.sources[0].evidence.repositoryNodeId,
      pullRequestNodeId: opts.targetId,
    },
    [repository],
  );
  const consumed = await consumeWorkUnitHistory(
    graph,
    opts.sources,
    new Map(opts.legacy),
    [repository],
  );
  return { joint, row, consumed, digest: joint.recordDigest };
}

function apply(
  journal: ReturnType<typeof emptyPointsJournal>,
  snapshot: ReturnType<typeof createLeaderboardSnapshot>,
) {
  return applyPointsSnapshot(
    journal,
    snapshot,
    hash(snapshot),
    snapshot.generatedAt,
  );
}
const total = (journal: PointsJournal, who = actor) =>
  pointMembers(journal).find((m) => m.actor.id === who.id)?.total ?? 0;
const latestAmount = (journal: PointsJournal, sourceId: string) =>
  [...latestPoints(journal).values()]
    .filter((r) => r.award.sourceId === sourceId)
    .map((r) => r.award.amount);

function variantPull(
  id: string,
  number: number,
  at: string,
  head: string,
  who = actor,
): Pull {
  return {
    ...structuredClone(old),
    id,
    number,
    url: `${repository.githubUrl}/pull/${number}`,
    createdAt: at,
    updatedAt: at,
    closedAt: at,
    mergedAt: at,
    headRefOid: head,
    author: who,
  } as Pull;
}

/** Solo original at snapshot 1, then the assessed joint group. */
async function basePair(
  opts: { successorAt?: string; at?: string; followupWho?: typeof actor } = {},
) {
  const successorAt = opts.successorAt ?? "2026-12-15T00:00:00.000Z";
  const at = opts.at ?? "2026-12-20T00:00:00.000Z";
  const followup = variantPull(
    "PR_followup",
    18,
    successorAt,
    "f".repeat(40),
    opts.followupWho ?? actor,
  );
  const first = await solo(old, "first.ts", "2026-11-06T00:00:00.000Z");
  const initial = soloSnapshot("2026-11-20T00:00:00.000Z", [
    { pull: old, solo: first },
  ]);
  let journal = apply(emptyPointsJournal(initial.generatedAt), initial);
  expect(total(journal)).toBe(90);
  const followSrc = source(followup, "second.ts", opts.followupWho ?? actor);
  const j = await joint({
    sources: [first.src, followSrc],
    legacy: [
      [old.id, first.digest],
      [followup.id, null],
    ],
    legacyPredecessors: [first.digest],
    supersedes: [],
    priorRows: [],
    assessedAt: successorAt,
    targetId: followup.id,
    reason: "Assess the original and follow-up as one retained outcome.",
  });
  expect(j.consumed.status).toBe("assessed");
  const laterInput = input(at, [followup], [old]);
  laterInput.valueActors = new Map([
    [actor.id, actor],
    [owner.id, owner],
  ]);
  laterInput.jointValueDecisions = new Map([
    [old.id, j.consumed],
    [followup.id, j.consumed],
  ]) as never;
  const later = createLeaderboardSnapshot(laterInput);
  assertLeaderboardSnapshot(later);
  journal = apply(journal, later);
  return { first, followup, followSrc, j, initial, later, journal };
}

test("correction is a predecessor-linked revision and reapplying the snapshot adds nothing", async () => {
  const { first, j, later, journal } = await basePair();
  expect(later.valueAssessmentSupersessions).toEqual([
    { predecessorDigest: first.digest, successorDigest: j.digest },
  ]);
  const revisions = journal.revisions.filter(
    (r) => r.award.sourceId === old.id,
  );
  expect(revisions).toHaveLength(2);
  const [original, correction] = revisions;
  expect(original.award.amount).toBe(90);
  expect(correction.previous).toBe(original.id);
  expect(correction.award.amount).toBe(0);
  expect(correction.award.occurredAt).toBe(original.award.occurredAt);
  expect(correction.award.key).toBe(original.award.key);
  expect(correction.decision?.sourceId).toBe(`value:${j.digest}`);
  expect(correction.decision?.delta).toBe(-90);
  expect(correction.decision?.effectiveAt).toBe("2026-12-15T00:00:00.000Z");
  const count = journal.revisions.length;
  const again = apply(journal, later);
  expect(again.revisions.length).toBe(count);
  expect(total(again)).toBe(90);
});

test("joint -> joint: a later group retires the first joint award even after its completion leaves the census", async () => {
  const {
    first,
    followup,
    followSrc,
    j,
    journal: afterFirst,
  } = await basePair();
  expect(total(afterFirst)).toBe(90);
  const thirdAt = "2027-01-10T00:00:00.000Z";
  const third = variantPull("PR_third", 21, thirdAt, "7".repeat(40));
  const thirdSrc = source(third, "third.ts");
  const j2 = await joint({
    sources: [first.src, followSrc, thirdSrc],
    legacy: [
      [old.id, first.digest],
      [followup.id, null],
      [third.id, null],
    ],
    legacyPredecessors: [first.digest],
    supersedes: [j.digest],
    priorRows: [j.row],
    assessedAt: "2027-01-12T00:00:00.000Z",
    tier: "small",
    targetId: third.id,
    reason: "Reassess all three sources as one retained outcome.",
  });
  expect(j2.consumed.status).toBe("assessed");
  const i3 = input("2027-01-15T00:00:00.000Z", [third], [old, followup]);
  i3.valueActors = new Map([[actor.id, actor]]);
  i3.jointValueDecisions = new Map([
    [old.id, j2.consumed],
    [followup.id, j2.consumed],
    [third.id, j2.consumed],
  ]) as never;
  const snap3 = createLeaderboardSnapshot(i3);
  assertLeaderboardSnapshot(snap3);
  expect(snap3.valueAssessmentSupersessions).toEqual(
    [
      { predecessorDigest: first.digest, successorDigest: j2.digest },
      { predecessorDigest: j.digest, successorDigest: j2.digest },
    ].sort((a, b) => a.predecessorDigest.localeCompare(b.predecessorDigest)),
  );
  const journal = apply(afterFirst, snap3);
  // The first joint award (90, completion source PR_followup) is retired by
  // the second joint record; only the new small total (30) remains.
  expect(latestAmount(journal, followup.id)).toEqual([0]);
  expect(total(journal)).toBe(30);
});

test("a solo unit outside the group keeps its credit while the group predecessor retires", async () => {
  const otherAt = "2026-11-10T00:00:00.000Z";
  const other = variantPull("PR_other", 19, otherAt, "9".repeat(40));
  const first = await solo(old, "first.ts", "2026-11-06T00:00:00.000Z");
  const otherSolo = await solo(other, "other.ts", "2026-11-11T00:00:00.000Z");
  const initial = soloSnapshot("2026-11-20T00:00:00.000Z", [
    { pull: old, solo: first },
    { pull: other, solo: otherSolo },
  ]);
  let journal = apply(emptyPointsJournal(initial.generatedAt), initial);
  expect(total(journal)).toBe(180);
  const followup = variantPull(
    "PR_followup",
    18,
    "2026-12-15T00:00:00.000Z",
    "f".repeat(40),
  );
  const followSrc = source(followup, "second.ts");
  const j = await joint({
    sources: [first.src, followSrc],
    legacy: [
      [old.id, first.digest],
      [followup.id, null],
    ],
    legacyPredecessors: [first.digest],
    supersedes: [],
    priorRows: [],
    assessedAt: "2026-12-15T00:00:00.000Z",
    targetId: followup.id,
    reason: "Assess the original and follow-up as one retained outcome.",
  });
  const laterInput = input("2026-12-20T00:00:00.000Z", [followup], [old]);
  laterInput.valueActors = new Map([[actor.id, actor]]);
  laterInput.jointValueDecisions = new Map([
    [old.id, j.consumed],
    [followup.id, j.consumed],
  ]) as never;
  const later = createLeaderboardSnapshot(laterInput);
  assertLeaderboardSnapshot(later);
  journal = apply(journal, later);
  expect(latestAmount(journal, old.id)).toEqual([0]);
  expect(latestAmount(journal, other.id)).toEqual([90]);
  expect(total(journal)).toBe(180); // joint 90 + the untouched solo unit 90
});

test("multiple implementers: the joint total is conserved and split, the solo credit retires", async () => {
  const { journal } = await basePair({ followupWho: owner });
  expect(latestAmount(journal, old.id)).toEqual([0]);
  const authorTotal = total(journal, actor);
  const ownerTotal = total(journal, owner);
  expect(ownerTotal).toBeGreaterThan(0);
  expect(authorTotal).toBeGreaterThan(0);
  expect(authorTotal + ownerTotal).toBe(90);
});

test("window boundary: an original exactly at the window start still retires through the relation", async () => {
  const { later, journal } = await basePair({
    successorAt: "2026-12-08T00:00:00.000Z",
    at: "2026-12-10T00:00:00.000Z",
  });
  expect(later.window.from).toBe(old.mergedAt as string);
  expect(later.valueAssessmentSupersessions).toHaveLength(1);
  expect(total(journal)).toBe(90);
  expect(latestAmount(journal, old.id)).toEqual([0]);
});

test("a stale group publishes no supersession and the recorded credit stands", async () => {
  const first = await solo(old, "first.ts", "2026-11-06T00:00:00.000Z");
  const initial = soloSnapshot("2026-11-20T00:00:00.000Z", [
    { pull: old, solo: first },
  ]);
  let journal = apply(emptyPointsJournal(initial.generatedAt), initial);
  const followup = variantPull(
    "PR_followup",
    18,
    "2026-12-15T00:00:00.000Z",
    "f".repeat(40),
  );
  const followSrc = source(followup, "second.ts");
  const evidence = await prepareWorkUnitEvidence(
    [first.src, followSrc],
    [repository],
  );
  const joint = await prepareWorkUnitRecord(
    {
      rubricVersion: VALUE_RUBRIC_VERSION,
      sourceDigest: evidence.sourceDigest,
      assessedAt: "2026-12-15T00:00:00.000Z",
      verdict: {
        units: [
          {
            claimIds: evidence.claims.map((c) => c.id),
            assessment: assessment([old.url, followup.url]),
          },
        ],
      },
      provenance,
    } as never,
    evidence,
    "a".repeat(40),
    [],
    [first.digest],
    "Assess the original and follow-up as one retained outcome.",
    [project],
  );
  const row = {
    sequence: 1,
    record_digest: joint.recordDigest,
    record_json: joint.recordJson,
    recorded_at: "2026-12-15T00:00:00.000Z",
    assessment_key: joint.assessmentKey,
  };
  const graph = await readWorkUnitHistory(
    async () => ({
      throughSequence: 1,
      totalRecords: 1,
      records: [row],
      nextAfter: null,
    }),
    {
      repositoryNodeId: first.src.evidence.repositoryNodeId,
      pullRequestNodeId: followup.id,
    },
    [repository],
  );
  const stale = await consumeWorkUnitHistory(
    graph,
    [first.src, followSrc],
    new Map([
      [old.id, "b".repeat(64)],
      [followup.id, null],
    ]),
    [repository],
  );
  expect(stale.status).toBe("stale");
  // A stale group is not hydrated as context: the original simply leaves
  // the census, and no supersession may be inferred from that absence.
  const laterInput = input("2026-12-20T00:00:00.000Z", [followup]);
  laterInput.valueActors = new Map([[actor.id, actor]]);
  laterInput.jointValueDecisions = new Map([[followup.id, stale]]) as never;
  const later = createLeaderboardSnapshot(laterInput);
  assertLeaderboardSnapshot(later);
  expect(later.valueAssessmentSupersessions).toBeUndefined();
  journal = apply(journal, later);
  expect(latestAmount(journal, old.id)).toEqual([90]);
});

test("a supersession whose successor published nothing retires nothing", async () => {
  const { later, journal: _journal, initial } = await basePair();
  const trimmed = structuredClone(later);
  trimmed.ledger = trimmed.ledger.filter((e) => !e.id.includes(":joint:"));
  let journal = apply(emptyPointsJournal(initial.generatedAt), initial);
  journal = apply(journal, trimmed);
  expect(latestAmount(journal, old.id)).toEqual([90]);
  expect(
    journal.revisions.filter((r) => r.award.sourceId === old.id),
  ).toHaveLength(1);
});

test("an assessed but unpublished solo reassessment heading the member's chain does not strand the published original", async () => {
  // Snapshot 1 publishes the original solo assessment A (90).
  const first = await solo(old, "first.ts", "2026-11-06T00:00:00.000Z");
  const initial = soloSnapshot("2026-11-20T00:00:00.000Z", [
    { pull: old, solo: first },
  ]);
  let journal = apply(emptyPointsJournal(initial.generatedAt), initial);
  expect(total(journal)).toBe(90);

  // The same source is reassessed solo (B, chained over A) but no snapshot
  // runs before the joint assessment J is prepared, so B is never
  // published. J declares B — the solo chain's current head — as its
  // legacy predecessor, and the original has left the collection window,
  // so B's solo award appears in no ledger either.
  const reassessed = await soloRevision(first, old, "2026-12-01T00:00:00.000Z");
  const followup = variantPull(
    "PR_followup",
    18,
    "2026-12-15T00:00:00.000Z",
    "f".repeat(40),
  );
  const followSrc = source(followup, "second.ts");
  const j = await joint({
    sources: [first.src, followSrc],
    legacy: [
      [old.id, reassessed.digest],
      [followup.id, null],
    ],
    legacyPredecessors: [reassessed.digest],
    supersedes: [],
    priorRows: [],
    assessedAt: "2026-12-15T00:00:00.000Z",
    targetId: followup.id,
    reason: "Assess the original and follow-up as one retained outcome.",
  });
  expect(j.consumed.status).toBe("assessed");
  const laterInput = input("2026-12-20T00:00:00.000Z", [followup], [old]);
  laterInput.valueActors = new Map([
    [actor.id, actor],
    [owner.id, owner],
  ]);
  // Production hands the builder the member's verified solo decision
  // alongside the joint decision (the ingestion's legacy read); its
  // history is the chain A -> B with B as the unpublished head.
  laterInput.valueDecisions = new Map([[old.id, reassessed.decision]]) as never;
  laterInput.jointValueDecisions = new Map([
    [old.id, j.consumed],
    [followup.id, j.consumed],
  ]) as never;
  const later = createLeaderboardSnapshot(laterInput);
  assertLeaderboardSnapshot(later);
  // The relation names both digests: the declared head B and, through the
  // consumed solo chain, the published original A it superseded.
  expect(later.valueAssessmentSupersessions).toEqual(
    [
      { predecessorDigest: first.digest, successorDigest: j.digest },
      { predecessorDigest: reassessed.digest, successorDigest: j.digest },
    ].sort((a, b) => a.predecessorDigest.localeCompare(b.predecessorDigest)),
  );
  journal = apply(journal, later);
  // A's recorded award is retired by J's published decision; B never
  // published an award, so no revision carries its decision.
  const revisions = journal.revisions.filter(
    (r) => r.award.sourceId === old.id,
  );
  expect(revisions).toHaveLength(2);
  expect(revisions[1].award.amount).toBe(0);
  expect(revisions[1].decision?.sourceId).toBe(`value:${j.digest}`);
  expect(revisions[1].decision?.delta).toBe(-90);
  expect(
    journal.revisions.some(
      (r) => r.decision?.sourceId === `value:${reassessed.digest}`,
    ),
  ).toBe(false);
  expect(latestAmount(journal, old.id)).toEqual([0]);
  expect(total(journal)).toBe(90);
  const count = journal.revisions.length;
  expect(apply(journal, later).revisions.length).toBe(count);
});

/** Partitioned variant of `joint`: the claims credited to each named
 * source form their own unit with their own tier, so one unit of the
 * record can publish while another unit of the same record is withheld. */
async function jointPartitioned(opts: {
  sources: WorkUnitSource[];
  units: { pullId: string; tier: string }[];
  legacy: [string, string | null][];
  legacyPredecessors: string[];
  supersedes: string[];
  priorRows: HistoryRow[];
  assessedAt: string;
  targetId: string;
  reason: string;
}) {
  const evidence = await prepareWorkUnitEvidence(opts.sources, [repository]);
  expect(evidence.limitations).toEqual([]);
  const claimed = new Set<string>();
  const units = opts.units.map(({ pullId, tier }) => {
    const claimIds = evidence.claims
      .filter((claim) => claim.creditPullRequestId === pullId)
      .map((claim) => claim.id);
    expect(claimIds.length).toBeGreaterThan(0);
    for (const id of claimIds) {
      expect(claimed.has(id)).toBe(false);
      claimed.add(id);
    }
    const source = opts.sources.find((s) => s.evidence.pull.node_id === pullId);
    if (!source) throw new Error("Partition names a source outside the record");
    return {
      claimIds,
      assessment: assessment([source.evidence.pull.html_url], tier),
    };
  });
  expect(claimed.size).toBe(evidence.claims.length);
  const prepared = await prepareWorkUnitRecord(
    {
      rubricVersion: VALUE_RUBRIC_VERSION,
      sourceDigest: evidence.sourceDigest,
      assessedAt: opts.assessedAt,
      verdict: { units },
      provenance,
    } as never,
    evidence,
    "a".repeat(40),
    opts.supersedes,
    opts.legacyPredecessors,
    opts.reason,
    [project],
  );
  const row = {
    sequence: opts.priorRows.length + 1,
    record_digest: prepared.recordDigest,
    record_json: prepared.recordJson,
    recorded_at: opts.assessedAt,
    assessment_key: prepared.assessmentKey,
  };
  const rows: HistoryRow[] = [...opts.priorRows, row];
  const graph = await readWorkUnitHistory(
    async (after: number) => ({
      throughSequence: rows.length,
      totalRecords: rows.length,
      records: rows.filter((r) => r.sequence > after),
      nextAfter: null,
    }),
    {
      repositoryNodeId: opts.sources[0].evidence.repositoryNodeId,
      pullRequestNodeId: opts.targetId,
    },
    [repository],
  );
  const consumed = await consumeWorkUnitHistory(
    graph,
    opts.sources,
    new Map(opts.legacy),
    [repository],
  );
  return { joint: prepared, row, consumed, digest: prepared.recordDigest };
}

test("multi-unit record: a unit dropped by the rolling window does not retire its predecessor's recorded credit", async () => {
  const first = await solo(old, "first.ts", "2026-11-06T00:00:00.000Z");
  const initial = soloSnapshot("2026-11-20T00:00:00.000Z", [
    { pull: old, solo: first },
  ]);
  let journal = apply(emptyPointsJournal(initial.generatedAt), initial);
  expect(total(journal)).toBe(90);
  const followup = variantPull(
    "PR_followup",
    18,
    "2026-12-15T00:00:00.000Z",
    "f".repeat(40),
  );
  const followSrc = source(followup, "second.ts");
  const j = await jointPartitioned({
    sources: [first.src, followSrc],
    units: [
      { pullId: old.id, tier: "medium" },
      { pullId: followup.id, tier: "small" },
    ],
    legacy: [
      [old.id, first.digest],
      [followup.id, null],
    ],
    legacyPredecessors: [first.digest],
    supersedes: [],
    priorRows: [],
    assessedAt: "2026-12-15T00:00:00.000Z",
    targetId: followup.id,
    reason: "Assess the original and follow-up as two units of one record.",
  });
  expect(j.consumed.status).toBe("assessed");
  const laterInput = input("2026-12-20T00:00:00.000Z", [followup], [old]);
  laterInput.valueActors = new Map([[actor.id, actor]]);
  laterInput.jointValueDecisions = new Map([
    [old.id, j.consumed],
    [followup.id, j.consumed],
  ]) as never;
  const later = createLeaderboardSnapshot(laterInput);
  assertLeaderboardSnapshot(later);
  // The follow-up unit publishes its 30 Points under the joint digest
  // while the original's own unit is withheld by the rolling window:
  // the record published, but the unit covering the predecessor did not.
  const published = later.ledger.filter(
    (event) => event.scoreDecisionSourceId === `value:${j.digest}`,
  );
  expect(published.map((event) => event.scoreThirds)).toEqual([3]);
  expect(later.valueAssessmentSupersessions ?? []).toEqual([]);
  journal = apply(journal, later);
  expect(latestAmount(journal, old.id)).toEqual([90]);
  expect(total(journal)).toBe(120);
});

test("a share dropped for a banned actor does not retire that actor's earlier solo credit", async () => {
  const first = await solo(old, "first.ts", "2026-11-06T00:00:00.000Z");
  const initial = soloSnapshot("2026-11-20T00:00:00.000Z", [
    { pull: old, solo: first },
  ]);
  let journal = apply(emptyPointsJournal(initial.generatedAt), initial);
  expect(total(journal)).toBe(90);
  const followup = variantPull(
    "PR_followup",
    18,
    "2026-12-15T00:00:00.000Z",
    "f".repeat(40),
    owner,
  );
  const followSrc = source(followup, "second.ts", owner);
  const j = await joint({
    sources: [first.src, followSrc],
    legacy: [
      [old.id, first.digest],
      [followup.id, null],
    ],
    legacyPredecessors: [first.digest],
    supersedes: [],
    priorRows: [],
    assessedAt: "2026-12-15T00:00:00.000Z",
    targetId: followup.id,
    reason: "Assess the original and follow-up as one retained outcome.",
  });
  expect(j.consumed.status).toBe("assessed");
  const laterInput = input("2026-12-20T00:00:00.000Z", [followup], [old]);
  laterInput.valueActors = new Map([
    [actor.id, actor],
    [owner.id, owner],
  ]);
  // PRD section 8: the ban lands after the solo award was earned and
  // before the joint completion, so the banned actor's share of the
  // joint record is dropped while the co-implementer's share publishes.
  laterInput.participationBans = new Map([
    [actor.id, "2026-12-01T00:00:00.000Z"],
  ]);
  laterInput.jointValueDecisions = new Map([
    [old.id, j.consumed],
    [followup.id, j.consumed],
  ]) as never;
  const later = createLeaderboardSnapshot(laterInput);
  assertLeaderboardSnapshot(later);
  const published = later.ledger.filter(
    (event) => event.scoreDecisionSourceId === `value:${j.digest}`,
  );
  expect(published.map((event) => event.actor.id)).toEqual([owner.id]);
  expect(later.valueAssessmentSupersessions ?? []).toEqual([]);
  journal = apply(journal, later);
  // The pre-ban solo credit stays; only the co-implementer's share lands.
  expect(latestAmount(journal, old.id)).toEqual([90]);
  expect(total(journal, actor)).toBe(90);
  expect(total(journal, owner)).toBe(40);
});

test("an ancestor's declared solo predecessor retires through a later group when the member's solo chain is unavailable", async () => {
  // Snapshot 1 publishes solo A (90). Snapshot 2 publishes its solo
  // revision B, so the recorded award's decision is B.
  const first = await solo(old, "first.ts", "2026-11-06T00:00:00.000Z");
  const initial = soloSnapshot("2026-11-20T00:00:00.000Z", [
    { pull: old, solo: first },
  ]);
  let journal = apply(emptyPointsJournal(initial.generatedAt), initial);
  expect(total(journal)).toBe(90);
  const revised = await soloRevision(first, old, "2026-12-01T00:00:00.000Z");
  const secondInput = input("2026-12-05T00:00:00.000Z", [old]);
  secondInput.valueDecisions = new Map([[old.id, revised.decision]]) as never;
  const second = createLeaderboardSnapshot(secondInput);
  assertLeaderboardSnapshot(second);
  journal = apply(journal, second);
  expect(total(journal)).toBe(90);
  expect(
    journal.revisions.filter((r) => r.award.sourceId === old.id).at(-1)
      ?.decision?.sourceId,
  ).toBe(`value:${revised.digest}`);
  // J1 groups the original with a second pull request and declares B.
  // No snapshot ever publishes J1.
  const secondPull = variantPull(
    "PR_second",
    19,
    "2026-12-08T00:00:00.000Z",
    "9".repeat(40),
  );
  const secondSrc = source(secondPull, "second.ts");
  const j1 = await joint({
    sources: [first.src, secondSrc],
    legacy: [
      [old.id, revised.digest],
      [secondPull.id, null],
    ],
    legacyPredecessors: [revised.digest],
    supersedes: [],
    priorRows: [],
    assessedAt: "2026-12-10T00:00:00.000Z",
    targetId: secondPull.id,
    reason: "Group the original with the second pull request.",
  });
  expect(j1.consumed.status).toBe("assessed");
  // A further solo revision C is assessed (never published) and heads
  // the member's solo history when J2 is prepared, so J2 declares C;
  // B is declared only by the ancestor J1.
  const rerevised = await soloRevision(
    { ...first, digest: revised.digest, prepared: revised.prepared },
    old,
    "2026-12-20T00:00:00.000Z",
  );
  const thirdPull = variantPull(
    "PR_third",
    21,
    "2027-01-10T00:00:00.000Z",
    "7".repeat(40),
  );
  const thirdSrc = source(thirdPull, "third.ts");
  const j2 = await joint({
    sources: [first.src, secondSrc, thirdSrc],
    legacy: [
      [old.id, rerevised.digest],
      [secondPull.id, null],
      [thirdPull.id, null],
    ],
    legacyPredecessors: [rerevised.digest],
    supersedes: [j1.digest],
    priorRows: [j1.row],
    assessedAt: "2027-01-12T00:00:00.000Z",
    targetId: thirdPull.id,
    reason: "Reassess all three sources as one retained outcome.",
  });
  expect(j2.consumed.status).toBe("assessed");
  // Snapshot 3 publishes J2. The builder receives no solo decision for
  // the original member, so no solo chain can link B under C; B rides
  // only on the ancestor's own declaration.
  const thirdInput = input(
    "2027-01-15T00:00:00.000Z",
    [thirdPull],
    [old, secondPull],
  );
  thirdInput.valueActors = new Map([[actor.id, actor]]);
  thirdInput.jointValueDecisions = new Map([
    [old.id, j2.consumed],
    [secondPull.id, j2.consumed],
    [thirdPull.id, j2.consumed],
  ]) as never;
  const third = createLeaderboardSnapshot(thirdInput);
  assertLeaderboardSnapshot(third);
  expect(third.valueAssessmentSupersessions).toEqual(
    [
      { predecessorDigest: revised.digest, successorDigest: j2.digest },
      { predecessorDigest: rerevised.digest, successorDigest: j2.digest },
      { predecessorDigest: j1.digest, successorDigest: j2.digest },
    ].sort((a, b) =>
      a.predecessorDigest.localeCompare(b.predecessorDigest, "en"),
    ),
  );
  journal = apply(journal, third);
  expect(latestAmount(journal, old.id)).toEqual([0]);
  expect(total(journal)).toBe(90);
});

test("an ancestor's declared solo predecessors retire even after their member leaves the group", async () => {
  // Solo A is published; its revision B heads the member's chain.
  const first = await solo(old, "first.ts", "2026-11-06T00:00:00.000Z");
  const initial = soloSnapshot("2026-11-20T00:00:00.000Z", [
    { pull: old, solo: first },
  ]);
  let journal = apply(emptyPointsJournal(initial.generatedAt), initial);
  expect(total(journal)).toBe(90);
  const revised = await soloRevision(first, old, "2026-12-01T00:00:00.000Z");
  const secondPull = variantPull(
    "PR_second",
    19,
    "2026-12-08T00:00:00.000Z",
    "9".repeat(40),
  );
  const secondSrc = source(secondPull, "second.ts");
  const j1 = await joint({
    sources: [first.src, secondSrc],
    legacy: [
      [old.id, revised.digest],
      [secondPull.id, null],
    ],
    legacyPredecessors: [revised.digest],
    supersedes: [],
    priorRows: [],
    assessedAt: "2026-12-10T00:00:00.000Z",
    targetId: secondPull.id,
    reason: "Group the original with the second pull request.",
  });
  expect(j1.consumed.status).toBe("assessed");
  // J2 groups only the second and third pull requests and supersedes
  // J1. The current history read rejects a graph whose predecessor
  // keeps a member the successor dropped, so this decision is assembled
  // directly from its verified record and evidence: the builder must
  // still carry the ancestor's declared predecessors for any consumed
  // decision it accepts.
  const thirdPull = variantPull(
    "PR_third",
    21,
    "2027-01-10T00:00:00.000Z",
    "7".repeat(40),
  );
  const thirdSrc = source(thirdPull, "third.ts");
  const evidence = await prepareWorkUnitEvidence(
    [secondSrc, thirdSrc],
    [repository],
  );
  expect(evidence.limitations).toEqual([]);
  const prepared = await prepareWorkUnitRecord(
    {
      rubricVersion: VALUE_RUBRIC_VERSION,
      sourceDigest: evidence.sourceDigest,
      assessedAt: "2027-01-12T00:00:00.000Z",
      verdict: {
        units: [
          {
            claimIds: evidence.claims.map((c) => c.id),
            assessment: assessment([secondPull.url, thirdPull.url]),
          },
        ],
      },
      provenance,
    } as never,
    evidence,
    "a".repeat(40),
    [j1.digest],
    [],
    "Reassess the second and third sources as one retained outcome.",
    [project],
  );
  const row2 = {
    sequence: 2,
    record_digest: prepared.recordDigest,
    record_json: prepared.recordJson,
    recorded_at: "2027-01-12T00:00:00.000Z",
    assessment_key: prepared.assessmentKey,
  };
  const consumed2 = {
    status: "assessed",
    record: prepared.record,
    evidence,
    latestDigest: prepared.recordDigest,
    history: [j1.row, row2],
    throughSequence: 2,
  };
  const laterInput = input(
    "2027-01-15T00:00:00.000Z",
    [thirdPull],
    [secondPull],
  );
  laterInput.valueActors = new Map([[actor.id, actor]]);
  laterInput.valueDecisions = new Map([[old.id, revised.decision]]) as never;
  laterInput.jointValueDecisions = new Map([
    [secondPull.id, consumed2],
    [thirdPull.id, consumed2],
  ]) as never;
  const later = createLeaderboardSnapshot(laterInput);
  assertLeaderboardSnapshot(later);
  expect(later.valueAssessmentSupersessions).toEqual(
    [
      {
        predecessorDigest: first.digest,
        successorDigest: prepared.recordDigest,
      },
      {
        predecessorDigest: revised.digest,
        successorDigest: prepared.recordDigest,
      },
      { predecessorDigest: j1.digest, successorDigest: prepared.recordDigest },
    ].sort((a, b) =>
      a.predecessorDigest.localeCompare(b.predecessorDigest, "en"),
    ),
  );
  journal = apply(journal, later);
  expect(latestAmount(journal, old.id)).toEqual([0]);
  expect(total(journal)).toBe(90);
});
