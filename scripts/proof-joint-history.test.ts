/** Synthetic accepted-source fixtures test deterministic accounting, not model quality. */
import { afterAll, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { handlePointsApi } from "../backend/points/handler";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
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
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";
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
import { pointsSql } from "./generate-points";

setSystemTime(new Date("2026-12-21T00:00:00.000Z"));
afterAll(() => setSystemTime());
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const actor = PENALIZED_AUTHOR;
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

function source(pull: typeof old, path: string): WorkUnitSource {
  const user = { node_id: actor.id, login: actor.login, type: "User" };
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
      implementationActorNodeIds: [actor.id],
      commitAttribution: [
        {
          sha: pull.headRefOid,
          actorNodeIds: [actor.id],
          changedPaths: [path],
          files: [file],
          limitations: [],
        },
      ],
      relatedPullRequests: [],
    },
  } as WorkUnitSource;
}

function assessment(urls: string[]) {
  return {
    status: "assessed",
    tier: "medium",
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

function input(at: string, pull: typeof old) {
  const i = penaltyScoreInput([], at);
  const originalOutcome = i.mergedPullRequestOutcomes.find(
    (p) => p.id === old.id,
  )!;
  i.mergedPullRequests = [structuredClone(pull)];
  i.mergedPullRequestOutcomes = [
    {
      ...originalOutcome,
      ...pull,
      mergedAt: pull.mergedAt!,
      baseRefName: repository.integrationBranch,
      commits: [{ oid: pull.headRefOid, author: actor }],
    },
  ];
  i.closedUnmergedPullRequests = [];
  i.source.counts.mergedPullRequests = 1;
  i.source.counts.detailedMergedPullRequests = 1;
  i.detailEligibleMergedPullRequestIds = [];
  return i;
}

async function pair(withinWindow = false) {
  const successorAt = withinWindow
    ? "2026-11-25T00:00:00.000Z"
    : "2026-12-15T00:00:00.000Z";
  const at = withinWindow
    ? "2026-11-30T00:00:00.000Z"
    : "2026-12-20T00:00:00.000Z";
  const followup = {
    ...structuredClone(old),
    id: "PR_followup",
    number: 18,
    url: `${repository.githubUrl}/pull/18`,
    createdAt: successorAt,
    updatedAt: successorAt,
    closedAt: successorAt,
    mergedAt: successorAt,
    headRefOid: "f".repeat(40),
  };
  const original = source(old, "first.ts");
  const follow = source(followup, "second.ts");
  const verdict = assessment([old.url]);
  const prepared = await prepareValueRecord(
    {
      rubricVersion: VALUE_RUBRIC_VERSION,
      sourceDigest: await valueSourceDigest(original.evidence, original.policy),
      pullRequestNodeId: old.id,
      headSha: old.headRefOid,
      policySha: base,
      assessedAt: "2026-11-06T00:00:00.000Z",
      verdict,
      provenance,
    } as never,
    original.evidence,
    original.policy,
    "a".repeat(40),
    null,
    null,
    [project],
  );
  const firstInput = input("2026-11-20T00:00:00.000Z", old);
  firstInput.valueDecisions = new Map([
    [
      old.id,
      {
        status: "assessed",
        record: prepared.record,
        assessment: prepared.record.assessment,
        implementationActorNodeIds: [actor.id],
        latestDigest: prepared.recordDigest,
        history: [
          {
            sequence: 1,
            record_digest: prepared.recordDigest,
            record_json: prepared.recordJson,
            recorded_at: "2026-11-06T00:00:00.000Z",
          },
        ],
      } as never,
    ],
  ]);
  const initial = createLeaderboardSnapshot(firstInput);
  const evidence = await prepareWorkUnitEvidence(
    [original, follow],
    [repository],
  );
  expect(evidence.limitations).toEqual([]);
  expect(evidence.claims).toHaveLength(2);
  const joint = await prepareWorkUnitRecord(
    {
      rubricVersion: VALUE_RUBRIC_VERSION,
      sourceDigest: evidence.sourceDigest,
      assessedAt: successorAt,
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
    [prepared.recordDigest],
    "Assess the original and follow-up as one retained outcome.",
    [project],
  );
  const row = {
    sequence: 1,
    record_digest: joint.recordDigest,
    record_json: joint.recordJson,
    recorded_at: successorAt,
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
      repositoryNodeId: original.evidence.repositoryNodeId,
      pullRequestNodeId: followup.id,
    },
    [repository],
  );
  const consumed = await consumeWorkUnitHistory(
    graph,
    [original, follow],
    new Map([
      [old.id, prepared.recordDigest],
      [followup.id, null],
    ]),
    [repository],
  );
  expect(consumed.status).toBe("assessed");
  const laterInput = input(at, followup);
  if (withinWindow) {
    laterInput.mergedPullRequests.push(structuredClone(old));
    laterInput.mergedPullRequestOutcomes.push(
      firstInput.mergedPullRequestOutcomes[0],
    );
    laterInput.source.counts.mergedPullRequests = 2;
    laterInput.source.counts.detailedMergedPullRequests = 2;
  } else laterInput.valueContextPullRequests = [structuredClone(old)];
  laterInput.valueActors = new Map([[actor.id, actor]]);
  laterInput.jointValueDecisions = new Map([
    [old.id, consumed],
    [followup.id, consumed],
  ]) as never;
  const later = createLeaderboardSnapshot(laterInput);
  assertLeaderboardSnapshot(initial);
  assertLeaderboardSnapshot(later);
  let journal = applyPointsSnapshot(
    emptyPointsJournal(initial.generatedAt),
    initial,
    hash(initial),
    initial.generatedAt,
  );
  journal = applyPointsSnapshot(journal, later, hash(later), later.generatedAt);
  return { initial, later, journal, consumed };
}

test("control: a joint reassessment retires the original credit while both sources are in the census", async () => {
  const { journal } = await pair(true);
  expect(
    pointMembers(journal).find((m) => m.actor.id === actor.id)?.total,
  ).toBe(90);
});

test("defect: the same joint reassessment counts 180 Points when the original becomes context outside the window", async () => {
  const { initial, later, journal } = await pair();
  const total = pointMembers(journal).find(
    (m) => m.actor.id === actor.id,
  )?.total;
  console.log(
    "JOINT_HISTORY",
    JSON.stringify({
      initialAward: initial.ledger
        .filter((e) => e.category === "merged-pull-request")
        .map((e) => [e.source.id, e.scoreThirds]),
      latestAward: later.ledger
        .filter((e) => e.category === "merged-pull-request")
        .map((e) => [e.source.id, e.scoreThirds]),
      journal: [...latestPoints(journal).values()].map((r) => [
        r.award.sourceId,
        r.award.amount,
      ]),
      total,
    }),
  );
  expect(total).toBe(90);
});

test("defect persists through real migrated SQLite, generated import SQL and the public journal handler", async () => {
  const { journal } = await pair();
  const { db, sqlite } = sqliteD1();
  try {
    sqlite.transaction(() => {
      for (const sql of pointsSql(journal).trim().split("\n")) sqlite.exec(sql);
    })();
    const response = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/journal"),
      {
        db,
        rateLimitSecret: "unused-public-read",
        identity: {
          async fetch() {
            throw new Error("No identity calls");
          },
        },
      },
    );
    expect(response.status).toBe(200);
    const value = await response.json();
    const { batch: _batch, total: _total, next: _next, ...readBack } = value;
    expect(value.batch).toBe(hash(readBack));
    expect(
      pointMembers(readBack).find((m) => m.actor.id === actor.id)?.total,
    ).toBe(90);
  } finally {
    sqlite.close();
  }
});
