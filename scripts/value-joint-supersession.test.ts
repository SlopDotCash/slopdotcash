/** Supersession guarantees for joint reassessments (REPORT section 7):
 * digest-linked retirement, idempotency, joint->joint chains, partial
 * groups, multiple implementers, window boundary, and preservation when
 * the successor is stale or unpublished. Synthetic fixtures only. */
import { afterAll, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  createLeaderboardSnapshot,
  assertLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import {
  applyPointsSnapshot,
  emptyPointsJournal,
  latestPoints,
  pointMembers,
} from "../src/lib/points";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { VALUE_RUBRIC_VERSION } from "../src/lib/value-assessment";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import {
  penaltyScoreInput,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
} from "../tests/penalty-score-fixture";
import { prepareValueRecord } from "../workers/slopbot/value-journal";
import { valueSourceDigest } from "../workers/slopbot/value-review";
import {
  prepareWorkUnitEvidence,
  type WorkUnitSource,
} from "../workers/slopbot/value-work-unit";
import { prepareWorkUnitRecord } from "../workers/slopbot/value-work-unit-journal";
import {
  consumeWorkUnitHistory,
  readWorkUnitHistory,
} from "../workers/slopbot/value-work-unit-consumption";

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
  priorRows: unknown[];
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
  const rows = [...opts.priorRows, row] as { sequence: number }[];
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
const total = (journal: never, who = actor) =>
  pointMembers(journal).find((m) => m.actor.id === who.id)?.total ?? 0;
const latestAmount = (journal: never, sourceId: string) =>
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
  expect(later.window.from).toBe(old.mergedAt);
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
