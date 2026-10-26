/**
 * PRD section 7 (SCR-05, SCR-06; MVP-09): one versioned producer for new work.
 * Work accepted before the value policy keeps the historical rules; work from
 * its effective instant is scored from source-bound value assessments, and
 * each pull request's review credit is one explicit allocation among its first
 * five distinct qualifying reviewers.
 */
import { afterAll, expect, setSystemTime, test } from "bun:test";
import type {
  GitHubActor,
  LeaderboardInput,
  MergedPullRequestOutcome,
  MergedPullRequestReviewRecord,
  PullRequestReview,
} from "../src/lib/leaderboard";
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
import {
  allocatePullRequestReviewCredit,
  allocateReviewCredit,
  assertValueScoringPolicy,
  type ValueScoringPolicy,
  valueScoringPolicy,
} from "../src/lib/scoring-policy";
import { VALUE_RUBRIC_VERSION } from "../src/lib/value-assessment";
import { parseGenerationArguments } from "./generate-leaderboard";
import {
  fetchValueHistoryPage,
  loadParticipationBans,
  ValueFeedUnavailableError,
} from "./value-ingestion";

const REPO = "SlopDotCash/slopdotcash";
const REPO_URL = `https://github.com/${REPO}`;
const AT = "2026-10-23T12:00:00.000Z";
const FROM = "2026-09-18T12:00:00.000Z";
const HEAD = "a".repeat(40);
// A later test-only policy boundary keeps both legacy and value paths in the
// same October fixture.
const POLICY: ValueScoringPolicy = {
  id: "slop-value-v1",
  rubricVersion: VALUE_RUBRIC_VERSION,
  effectiveAt: "2026-10-15T00:00:00.000Z",
  reviewCredit: { maxReviewers: 5, pool: "credited-bands-capped-at-size" },
};

setSystemTime(new Date(AT));
afterAll(() => setSystemTime());

function actor(login: string): GitHubActor {
  return {
    id: `U_${login}`,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/u/${login.length}?v=4`,
    url: `https://github.com/${login}`,
    kind: "User",
  };
}
const [alice, bob, carol, dave, erin, frank, grace] = [
  "alice",
  "bob",
  "carol",
  "dave",
  "erin",
  "frank",
  "grace",
].map(actor) as GitHubActor[];

function outcome(number: number, mergedAt: string): MergedPullRequestOutcome {
  return {
    id: `PR_${number}`,
    headRefOid: HEAD,
    number,
    title: `PR ${number}`,
    url: `${REPO_URL}/pull/${number}`,
    body: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: mergedAt,
    mergedAt,
    author: alice as GitHubActor,
    additions: 1,
    deletions: 1,
    baseRefName: "development",
    commits: [{ oid: String(number).repeat(40), author: alice as GitHubActor }],
  };
}

function review(
  pull: number,
  index: number,
  author: GitHubActor,
  state: string,
  submittedAt: string,
  commitId = HEAD,
): PullRequestReview {
  return {
    id: `PRR_${pull}_${index}`,
    body: "Reproduced the failure locally and confirmed the fix resolves it.",
    state,
    submittedAt,
    url: `${REPO_URL}/pull/${pull}#pullrequestreview-${pull}${index}`,
    author,
    inlineCommentCount: 0,
    commitId,
  };
}

function reviewed(
  merged: MergedPullRequestOutcome,
  reviews: PullRequestReview[],
): MergedPullRequestReviewRecord {
  return {
    id: merged.id,
    number: merged.number,
    title: merged.title,
    url: merged.url,
    body: merged.body,
    createdAt: merged.createdAt,
    updatedAt: merged.updatedAt,
    lastEditedAt: null,
    editor: null,
    mergedAt: merged.mergedAt,
    headRefOid: HEAD,
    author: merged.author,
    comments: [],
    reviews,
  };
}

function assessed(
  merged: MergedPullRequestOutcome,
  digest: string,
  tier: string,
  reviews: { sourceId: string; tier: string }[],
) {
  return {
    status: "assessed",
    history: [{ recorded_at: "2026-10-22T00:00:00.000Z" }],
    latestDigest: digest.repeat(64),
    implementationActorNodeIds: [alice?.id],
    record: {
      pullRequestNodeId: merged.id,
      repository: REPO,
      headSha: HEAD,
      occurredAt: merged.mergedAt,
      assessment: { tier, rationale: "Repairs the reported workflow." },
    },
    assessment: {
      tier,
      rationale: "Repairs the reported workflow.",
      reviews: reviews.map((item) => ({
        ...item,
        duplicateOf: null,
        finding: "Identified the failing path.",
        outcome: "The accepted head retains the fix.",
        evidenceUrls: [],
      })),
    },
  };
}

function input(partial: Partial<LeaderboardInput>): LeaderboardInput {
  return {
    generatedAt: AT,
    windowFrom: FROM,
    windowTo: AT,
    sourceUpdatedAt: AT,
    source: {
      provider: "github-graphql",
      fetchedAt: AT,
      cutoffAt: AT,
      repositoryId: "R_fixture",
      repositories: TARGET_REPOSITORIES.map((target) => ({
        id: target.id,
        repositoryId:
          target.role === "primary"
            ? "R_fixture"
            : `R_fixture_${target.name.replaceAll("-", "_")}`,
      })),
      requestCount: 1,
      searchSliceCount: 1,
      rateLimit: { cost: 1, limit: 5000, remaining: 4999, resetAt: AT },
      counts: {
        mergedPullRequests: 0,
        detailedMergedPullRequests: 0,
        closedIssues: 0,
        detailedClosedIssues: 0,
        resolvedIssues: 0,
        openIssues: 0,
        openPullRequests: 0,
      },
      verificationWindow: { days: 35, from: FROM, to: AT },
      evidenceVerification: {
        status: "complete",
        sourceCount: 0,
        artifactCount: 0,
        maxSources: 64,
        maxArtifacts: 64,
      },
    },
    mergedPullRequestOutcomes: [],
    mergedPullRequests: [],
    reviewedMergedPullRequests: [],
    detailEligibleMergedPullRequestIds: [],
    closedIssueCount: 0,
    resolvedIssues: [],
    openIssues: [],
    openPullRequests: [],
    verificationWindowFrom: FROM,
    verifiedEvidence: [],
    evaluatedContributions: [],
    ...partial,
  };
}

// PR 1 predates the policy; PR 2 is assessed; PR 3 awaits its assessment.
const legacy = outcome(1, "2026-10-12T10:00:00.000Z");
const valued = outcome(2, "2026-10-20T10:00:00.000Z");
const pending = outcome(3, "2026-10-21T10:00:00.000Z");
const legacyReviews = [
  review(1, 1, bob as GitHubActor, "APPROVED", "2026-10-12T08:00:00.000Z"),
  review(
    1,
    2,
    carol as GitHubActor,
    "CHANGES_REQUESTED",
    "2026-10-12T07:00:00.000Z",
    "b".repeat(40),
  ),
];
const valueReviews = [
  review(2, 1, bob as GitHubActor, "APPROVED", "2026-10-19T01:00:00.000Z"),
  review(
    2,
    2,
    carol as GitHubActor,
    "CHANGES_REQUESTED",
    "2026-10-19T02:00:00.000Z",
  ),
  review(2, 3, dave as GitHubActor, "COMMENTED", "2026-10-19T03:00:00.000Z"),
  review(2, 4, bob as GitHubActor, "COMMENTED", "2026-10-19T04:00:00.000Z"),
  review(2, 5, erin as GitHubActor, "APPROVED", "2026-10-19T05:00:00.000Z"),
  review(2, 6, frank as GitHubActor, "APPROVED", "2026-10-19T05:00:00.000Z"),
  review(2, 7, grace as GitHubActor, "APPROVED", "2026-10-19T06:00:00.000Z"),
  review(2, 8, alice as GitHubActor, "APPROVED", "2026-10-19T07:00:00.000Z"),
];

function snapshot(
  policy: ValueScoringPolicy | null = POLICY,
  participationBans?: ReadonlyMap<string, string>,
) {
  return createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [legacy, valued, pending],
      reviewedMergedPullRequests: [
        reviewed(legacy, legacyReviews),
        reviewed(valued, valueReviews),
        reviewed(pending, []),
      ],
      valuePolicy: policy ?? undefined,
      participationBans,
      valueDecisions: new Map<string, unknown>([
        [
          valued.id,
          assessed(valued, "d", "medium", [
            { sourceId: "PRR_2_1", tier: "standard" },
            { sourceId: "PRR_2_2", tier: "deep" },
            { sourceId: "PRR_2_3", tier: "triage" },
            { sourceId: "PRR_2_4", tier: "deep" },
            { sourceId: "PRR_2_5", tier: "standard" },
            { sourceId: "PRR_2_6", tier: "triage" },
            { sourceId: "PRR_2_7", tier: "standard" },
            { sourceId: "PRR_2_8", tier: "none" },
          ]),
        ],
        [
          pending.id,
          {
            status: "missing",
            history: [],
            latestDigest: null,
            implementationActorNodeIds: [],
          },
        ],
      ]) as unknown as LeaderboardInput["valueDecisions"],
    }),
  );
}

test("banned reviews do not consume another reviewer's slot or credit", () => {
  const result = snapshot(
    POLICY,
    new Map([["U_bob", "2026-10-19T01:00:00.000Z"]]),
  );
  const credits = result.ledger.filter((event) =>
    event.id.startsWith("PR_2:value-review:"),
  );
  expect(credits.map((event) => [event.actor.id, event.scoreThirds])).toEqual([
    ["U_carol", 5],
    ["U_erin", 2],
    ["U_grace", 2],
  ]);
  expect(
    credits.reduce((sum, event) => sum + (event.scoreThirds ?? 0), 0),
  ).toBe(9);
  expect(
    snapshot(POLICY, new Map([["U_bob", "2026-10-19T01:00:00.000Z"]])),
  ).toEqual(result);
  const exclusions = new Map(
    (result.reviewExclusions ?? []).map((item) => [item.reviewId, item.reason]),
  );
  expect(exclusions.get("PRR_2_1")).toBe("review-credit-account-banned");
  expect(exclusions.get("PRR_2_4")).toBe("review-credit-account-banned");
  expect(exclusions.get("PRR_2_7")).toBeUndefined();
  // A later ban must preserve all credit earned before it, including legacy credit.
  expect(
    snapshot(POLICY, new Map([["U_bob", "2026-10-21T00:00:00.000Z"]])).ledger,
  ).toEqual(snapshot().ledger);
});

test("normal publication holds historical changes without a runtime flag", () => {
  expect(parseGenerationArguments([])).toEqual({});
  expect(() => parseGenerationArguments(["--value-assessments"])).toThrow(
    "Usage: generate-leaderboard.ts [--cutoff YYYY-MM-DDTHH:mm:ss.sssZ]",
  );
  expect(valueScoringPolicy()).toEqual({
    ...POLICY,
    effectiveAt: "2026-11-01T00:00:00.000Z",
  });
  expect(() =>
    assertValueScoringPolicy({ ...POLICY, effectiveAt: "2026-10-15" }),
  ).toThrow("exact UTC timestamp");
});

test("largest remainder conserves the pool and breaks equal remainders by order", () => {
  expect(allocateReviewCredit(10, [3, 3, 3])).toEqual([4, 3, 3]);
  expect(allocateReviewCredit(5, [1, 9])).toEqual([1, 4]);
  expect(allocateReviewCredit(24, [9, 9, 1, 3, 1])).toEqual([10, 9, 1, 3, 1]);
  expect(allocateReviewCredit(2, [1, 1, 1])).toEqual([1, 1, 0]);
  expect(() => allocateReviewCredit(3, [1, 1, 1, 1, 1, 1])).toThrow();
  expect(() => allocateReviewCredit(0, [1])).toThrow();
});

test("review credit dedupes reviewers, orders by verified time, and credits five", () => {
  const allocation = allocatePullRequestReviewCredit(
    [
      {
        reviewId: "R7",
        actor: { id: "g" },
        submittedAt: "2026-10-19T06:00:00.000Z",
        thirds: 3,
      },
      {
        reviewId: "R4",
        actor: { id: "b" },
        submittedAt: "2026-10-19T04:00:00.000Z",
        thirds: 9,
      },
      {
        reviewId: "R1",
        actor: { id: "b" },
        submittedAt: "2026-10-19T01:00:00.000Z",
        thirds: 3,
      },
      {
        reviewId: "R2",
        actor: { id: "c" },
        submittedAt: "2026-10-19T02:00:00.000Z",
        thirds: 9,
      },
      {
        reviewId: "R6",
        actor: { id: "f" },
        submittedAt: "2026-10-19T05:00:00.000Z",
        thirds: 1,
      },
      {
        reviewId: "R5",
        actor: { id: "e" },
        submittedAt: "2026-10-19T05:00:00.000Z",
        thirds: 3,
      },
      {
        reviewId: "R3",
        actor: { id: "d" },
        submittedAt: "2026-10-19T03:00:00.000Z",
        thirds: 1,
      },
    ],
    24,
  );
  // The five credited bands (23 thirds) fit under the 24-third size cap.
  expect(allocation.poolThirds).toBe(23);
  expect(
    allocation.credited.map((item) => [
      item.actor.id,
      item.source.reviewId,
      item.shareThirds,
      item.repeatedReviewIds,
    ]),
  ).toEqual([
    ["b", "R4", 9, ["R1"]],
    ["c", "R2", 9, []],
    ["d", "R3", 1, []],
    ["e", "R5", 3, []],
    ["f", "R6", 1, []],
  ]);
  expect(allocation.beyondLimitReviewIds).toEqual(["R7"]);
});

test("the review pool is capped at the assessed size and is at least one third", () => {
  const reviews = [
    { reviewId: "R1", actor: { id: "a" }, thirds: 24 },
    { reviewId: "R2", actor: { id: "b" }, thirds: 3 },
  ].map((item, index) => ({
    ...item,
    submittedAt: `2026-11-02T0${index}:00:00.000Z`,
  }));
  const capped = allocatePullRequestReviewCredit(reviews, 9);
  expect(capped.poolThirds).toBe(9);
  expect(capped.credited.map((item) => item.shareThirds)).toEqual([8, 1]);
  const floor = allocatePullRequestReviewCredit(reviews.slice(0, 1), 0);
  expect(floor.poolThirds).toBe(1);
  expect(floor.credited.map((item) => item.shareThirds)).toEqual([1]);
  expect(allocatePullRequestReviewCredit([], 9).poolThirds).toBe(0);
});

test("new work uses value assessments while earlier work keeps its historical rules", () => {
  const result = snapshot();
  const byId = new Map(result.ledger.map((event) => [event.id, event]));

  // Historical: provisional small merge and the SCR-05 single review award.
  expect(byId.get("PR_1:merged")?.scoreThirds).toBe(3);
  expect(byId.get("PR_1:merged")?.scoreDecisionSourceId).toBeUndefined();
  expect(byId.get("PR_1:reviewer:U_carol")?.scoreThirds).toBe(1);
  expect(byId.has("PR_1:reviewer:U_bob")).toBe(false);

  // Value policy: the assessed tier, and one explicit review allocation.
  expect(byId.get("PR_2:merged")?.scoreThirds).toBe(9);
  expect(byId.get("PR_2:merged")?.scoreDecisionSourceId).toBe(
    `value:${"d".repeat(64)}`,
  );
  const reviewCredit = result.ledger
    .filter((event) => event.id.startsWith("PR_2:value-review:"))
    .map((event) => [event.actor.id, event.source.id, event.scoreThirds]);
  // The bands sum to 23 thirds; the medium merge caps the pool at 9.
  expect(reviewCredit.sort()).toEqual(
    [
      ["U_bob", "PRR_2_4", 4],
      ["U_carol", "PRR_2_2", 4],
      ["U_erin", "PRR_2_5", 1],
    ].sort(),
  );
  // A useful approval earns credit without requesting changes.
  expect(byId.get("PR_2:value-review:PRR_2_5")?.scoreThirds).toBe(1);
  const exclusions = new Map(
    (result.reviewExclusions ?? [])
      .filter((exclusion) => exclusion.pullRequestId === "PR_2")
      .map((exclusion) => [exclusion.reviewId, exclusion.reason]),
  );
  expect(exclusions.get("PRR_2_1")).toBe("already-awarded-reviewer");
  expect(exclusions.get("PRR_2_7")).toBe("review-credit-reviewer-limit");
  expect(exclusions.get("PRR_2_3")).toBe("review-credit-zero-share");
  expect(exclusions.get("PRR_2_6")).toBe("review-credit-zero-share");

  // An accepted merge awaiting assessment keeps the one-third minimum.
  expect(byId.get("PR_3:merged")?.scoreThirds).toBe(1);

  expect(
    Object.fromEntries(
      (result.valueAssessmentCoverage ?? []).map((row) => [
        row.pullRequestId,
        row.status,
      ]),
    ),
  ).toEqual({ PR_1: "legacy-policy", PR_2: "assessed", PR_3: "missing" });
  expect(result.methodology.summary).toContain(
    "From 2026-10-15T00:00:00.000Z (slop-value-v1)",
  );
});

test("value decisions require a policy that cannot reach earlier policy periods", () => {
  expect(() => snapshot(null)).toThrow(
    "Value decisions require their versioned scoring policy",
  );
  expect(() =>
    snapshot({ ...POLICY, effectiveAt: "2026-08-31T00:00:00.000Z" }),
  ).toThrow("The value policy cannot reinterpret earlier policy periods");
});

test("a maintainer correction overrides only the implementation score", () => {
  const ratified = outcome(4, "2026-10-21T10:00:00.000Z");
  const maintainer = actor("maintainer");
  const projectId = TARGET_REPOSITORIES.find(
    (target) => target.id === REPO,
  )?.projectId;
  const record = {
    schemaVersion: "1",
    ruleVersion: "slop-score-v2",
    projectId,
    pullRequestNodeId: ratified.id,
    headSha: HEAD,
    workUnitId: "wu_slopdotcash_pr_4",
    tier: "micro",
    scoreThirds: 1,
    proposalReviewNodeIds: [],
    coRatifierNodeIds: [],
    reason: "Narrow mechanical correction.",
    supersedes: null,
  };
  const createdAt = "2026-10-22T10:00:00.000Z";
  const source = {
    ...reviewed(ratified, [
      review(4, 1, bob as GitHubActor, "APPROVED", "2026-10-21T09:00:00.000Z"),
    ]),
    comments: [
      {
        id: "IC_ratify",
        artifactId: ratified.id,
        kind: "comment" as const,
        body: `\`\`\`slop-score\n${JSON.stringify(record)}\n\`\`\`\n`,
        url: `${REPO_URL}/pull/4#issuecomment-4`,
        createdAt,
        updatedAt: createdAt,
        author: maintainer,
        authorAssociation: "OWNER",
      },
    ],
  };
  const result = createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [ratified],
      reviewedMergedPullRequests: [source],
      valuePolicy: POLICY,
      valueDecisions: new Map<string, unknown>([
        [
          ratified.id,
          assessed(ratified, "e", "small", [
            { sourceId: "PRR_4_1", tier: "standard" },
          ]),
        ],
      ]) as unknown as LeaderboardInput["valueDecisions"],
    }),
  );
  const byId = new Map(result.ledger.map((event) => [event.id, event]));
  expect(byId.get("PR_4:merged")?.scoreThirds).toBe(1);
  expect(byId.get("PR_4:merged")?.scoreDecisionSourceId).toBe("IC_ratify");
  // The approval keeps its value allocation instead of the SCR-05 rule.
  // The small assessed size caps the standard review's pool at 3 thirds.
  expect(byId.get("PR_4:value-review:PRR_4_1")?.scoreThirds).toBe(3);
  expect(byId.get("PR_4:ratifier:IC_ratify")?.scoreThirds).toBe(1);
  expect(result.valueAssessmentCoverage?.[0]?.status).toBe("human-ratified");
});

test("a zero-share value reviewer is not treated as already awarded", () => {
  const ratified = outcome(16, "2026-10-21T10:00:00.000Z");
  const maintainer = actor("maintainer");
  const projectId = TARGET_REPOSITORIES.find(
    (target) => target.id === REPO,
  )?.projectId;
  const record = {
    schemaVersion: "1",
    ruleVersion: "slop-score-v2",
    projectId,
    pullRequestNodeId: ratified.id,
    headSha: HEAD,
    workUnitId: "wu_slopdotcash_pr_16",
    tier: "micro",
    scoreThirds: 1,
    proposalReviewNodeIds: [],
    coRatifierNodeIds: [],
    reason: "Narrow mechanical correction.",
    supersedes: null,
  };
  const createdAt = "2026-10-22T10:00:00.000Z";
  const source = {
    ...reviewed(ratified, [
      review(16, 1, bob as GitHubActor, "APPROVED", "2026-10-21T07:00:00.000Z"),
      review(16, 2, maintainer, "COMMENTED", "2026-10-21T08:00:00.000Z"),
      review(16, 3, maintainer, "APPROVED", "2026-10-21T09:00:00.000Z"),
    ]),
    comments: [
      {
        id: "IC_ratify_16",
        artifactId: ratified.id,
        kind: "comment" as const,
        body: `\`\`\`slop-score\n${JSON.stringify(record)}\n\`\`\`\n`,
        url: `${REPO_URL}/pull/16#issuecomment-16`,
        createdAt,
        updatedAt: createdAt,
        author: maintainer,
        authorAssociation: "OWNER",
      },
    ],
  };
  const result = createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [ratified],
      reviewedMergedPullRequests: [source],
      valuePolicy: POLICY,
      valueDecisions: new Map<string, unknown>([
        [
          ratified.id,
          assessed(ratified, "7", "micro", [
            { sourceId: "PRR_16_1", tier: "deep" },
            { sourceId: "PRR_16_2", tier: "triage" },
            { sourceId: "PRR_16_3", tier: "triage" },
          ]),
        ],
      ]) as unknown as LeaderboardInput["valueDecisions"],
    }),
  );
  const byId = new Map(result.ledger.map((event) => [event.id, event]));
  expect(byId.get("PR_16:value-review:PRR_16_1")?.scoreThirds).toBe(1);
  expect(byId.get("PR_16:ratifier:IC_ratify_16")?.scoreThirds).toBe(1);
  const exclusions = new Map(
    (result.reviewExclusions ?? [])
      .filter((exclusion) => exclusion.pullRequestId === "PR_16")
      .map((exclusion) => [exclusion.reviewId, exclusion.reason]),
  );
  expect(exclusions.get("PRR_16_2")).toBe("review-credit-zero-share");
  expect(exclusions.get("PRR_16_3")).toBe("review-credit-zero-share");
});

test("a maintainer ratification of a carrier keeps joint review credit", () => {
  const joint = outcome(12, "2026-10-20T10:00:00.000Z");
  const maintainer = actor("maintainer");
  const jointReviews = [
    review(12, 1, bob as GitHubActor, "APPROVED", "2026-10-19T00:00:00.000Z"),
    review(12, 2, carol as GitHubActor, "APPROVED", "2026-10-19T01:00:00.000Z"),
  ];
  const projectId = TARGET_REPOSITORIES.find(
    (target) => target.id === REPO,
  )?.projectId;
  const record = {
    schemaVersion: "1",
    ruleVersion: "slop-score-v2",
    projectId,
    pullRequestNodeId: joint.id,
    headSha: HEAD,
    workUnitId: "wu_slopdotcash_pr_12",
    tier: "micro",
    scoreThirds: 1,
    proposalReviewNodeIds: [],
    coRatifierNodeIds: [],
    reason: "Narrow mechanical correction.",
    supersedes: null,
  };
  const createdAt = "2026-10-22T10:00:00.000Z";
  const jointDecision = {
    status: "assessed",
    latestDigest: "c".repeat(64),
    history: [{ recorded_at: "2026-10-22T00:00:00.000Z" }],
    record: {
      sources: [{ pullRequestNodeId: joint.id, headSha: HEAD }],
      units: jointReviews.map((item, index) => ({
        workUnitId: `wu_unit-${index}`,
        claimIds: [`claim-${index}`],
        assessment: {
          tier: index === 0 ? "medium" : "micro",
          rationale: "An independently accepted part of the pull request.",
          reviews: [
            {
              sourceId: item.id,
              tier: "standard",
              finding: "Verified the fix.",
              outcome: "The accepted head retains it.",
            },
          ],
        },
      })),
    },
    evidence: {
      claims: jointReviews.map((_, index) => ({
        id: `claim-${index}`,
        carrierPullRequestIds: [joint.id],
        creditPullRequestId: joint.id,
        implementationActorNodeIds: [(alice as GitHubActor).id],
      })),
      sources: [
        {
          evidence: {
            repository: REPO,
            pull: {
              node_id: joint.id,
              head: { sha: HEAD },
              updated_at: joint.updatedAt,
              merged_at: joint.mergedAt,
              user: { node_id: (alice as GitHubActor).id },
              html_url: joint.url,
              number: joint.number,
              title: joint.title,
            },
            comments: [],
            reviews: jointReviews.map((item) => ({
              node_id: item.id,
              body: item.body,
              user: { node_id: item.author?.id },
              submitted_at: item.submittedAt,
            })),
          },
        },
      ],
    },
  };
  const jointSnapshot = (ratify: boolean) =>
    createLeaderboardSnapshot(
      input({
        mergedPullRequestOutcomes: [joint],
        reviewedMergedPullRequests: [
          {
            ...reviewed(joint, jointReviews),
            comments: ratify
              ? [
                  {
                    id: "IC_ratify",
                    artifactId: joint.id,
                    kind: "comment" as const,
                    body: `\`\`\`slop-score\n${JSON.stringify(record)}\n\`\`\`\n`,
                    url: `${REPO_URL}/pull/12#issuecomment-12`,
                    createdAt,
                    updatedAt: createdAt,
                    author: maintainer,
                    authorAssociation: "OWNER",
                  },
                ]
              : [],
          },
        ],
        valuePolicy: POLICY,
        valueDecisions: new Map(),
        valueActors: new Map([
          [(alice as GitHubActor).id, alice as GitHubActor],
        ]),
        jointValueDecisions: new Map([
          [joint.id, jointDecision],
        ]) as unknown as LeaderboardInput["jointValueDecisions"],
      }),
    );

  const baseline = new Map(
    jointSnapshot(false).ledger.map((event) => [event.id, event]),
  );
  expect(baseline.get("PR_12:value-review:PRR_12_1")?.scoreThirds).toBe(3);
  expect(baseline.get("PR_12:value-review:PRR_12_2")?.scoreThirds).toBe(3);

  // PRD section 7: the ratification corrects only the implementation
  // score, so both reviewers keep their joint value allocation and the
  // ratifier earns the one-third ratification credit alongside them.
  const ratified = new Map(
    jointSnapshot(true).ledger.map((event) => [event.id, event]),
  );
  expect(ratified.get("PR_12:value-review:PRR_12_1")?.scoreThirds).toBe(3);
  expect(ratified.get("PR_12:value-review:PRR_12_2")?.scoreThirds).toBe(3);
  expect(ratified.get("PR_12:ratifier:IC_ratify")?.scoreThirds).toBe(1);
});

test("a tier-none correction publishes the exclusion that zeroes pre-window review points", () => {
  const merged = outcome(21, "2026-10-20T10:00:00.000Z");
  const carolReview = review(
    21,
    1,
    carol as GitHubActor,
    "APPROVED",
    "2026-10-19T02:00:00.000Z",
  );
  const snapshotAt = (
    at: string,
    from: string,
    tier: string,
    digest: string,
  ) => {
    setSystemTime(new Date(at));
    return createLeaderboardSnapshot(
      input({
        generatedAt: at,
        windowFrom: from,
        windowTo: at,
        sourceUpdatedAt: at,
        verificationWindowFrom: from,
        source: {
          provider: "github-graphql",
          fetchedAt: at,
          cutoffAt: at,
          repositoryId: "R_fixture",
          repositories: TARGET_REPOSITORIES.map((target) => ({
            id: target.id,
            repositoryId:
              target.role === "primary"
                ? "R_fixture"
                : `R_fixture_${target.name.replaceAll("-", "_")}`,
          })),
          requestCount: 1,
          searchSliceCount: 1,
          rateLimit: { cost: 1, limit: 5000, remaining: 4999, resetAt: at },
          counts: {
            mergedPullRequests: 0,
            detailedMergedPullRequests: 0,
            closedIssues: 0,
            detailedClosedIssues: 0,
            resolvedIssues: 0,
            openIssues: 0,
            openPullRequests: 0,
          },
          verificationWindow: { days: 35, from, to: at },
          evidenceVerification: {
            status: "complete",
            sourceCount: 0,
            artifactCount: 0,
            maxSources: 64,
            maxArtifacts: 64,
          },
        },
        mergedPullRequestOutcomes: [merged],
        reviewedMergedPullRequests: [reviewed(merged, [carolReview])],
        valuePolicy: POLICY,
        valueDecisions: new Map<string, unknown>([
          [
            merged.id,
            assessed(merged, digest, "medium", [
              { sourceId: carolReview.id, tier },
            ]),
          ],
        ]) as unknown as LeaderboardInput["valueDecisions"],
      }),
    );
  };
  try {
    // Carol's standard review earns 3 thirds = 30 points.
    const first = snapshotAt(
      "2026-10-23T12:00:00.000Z",
      "2026-09-18T12:00:00.000Z",
      "standard",
      "d",
    );
    let journal = applyPointsSnapshot(
      emptyPointsJournal("2026-10-23T12:00:00.000Z"),
      first,
      "a".repeat(64),
      "2026-10-23T12:00:00.000Z",
    );
    const award = () =>
      [...latestPoints(journal).values()].find(
        (revision) => revision.award.actor.id === "U_carol",
      );
    expect(award()?.award.amount).toBe(30);
    expect(award()?.award.occurredAt).toBe("2026-10-19T02:00:00.000Z");

    // The rolling window moves past Carol's submission time and a corrected
    // assessment rates her review tier none. The scorer credits nothing,
    // and PRD section 7's ruling reaches Slop Points only through the
    // published exclusion (#848): without it the old award can never be
    // zeroed once its submission predates the window.
    const second = snapshotAt(
      "2026-11-24T10:00:00.000Z",
      "2026-10-20T10:00:00.000Z",
      "none",
      "e",
    );
    expect(
      second.ledger.some(
        (event) =>
          event.category === "substantive-review" &&
          event.actor.id === "U_carol",
      ),
    ).toBe(false);
    expect(
      second.valueAssessmentCoverage?.find(
        (row) => row.pullRequestId === "PR_21",
      )?.status,
    ).toBe("assessed");
    expect(
      (second.reviewExclusions ?? []).find(
        (entry) => entry.reviewId === carolReview.id,
      )?.reason,
    ).toBe("review-credit-zero-share");
    journal = applyPointsSnapshot(
      journal,
      second,
      "b".repeat(64),
      "2026-11-24T10:00:00.000Z",
    );
    expect(award()?.award.amount).toBe(0);
    expect(
      pointMembers(journal).find((member) => member.actor.id === "U_carol")
        ?.total,
    ).toBe(0);

    // The closed-unmerged caller loop publishes the same exclusion for an
    // assessed tier-none review, so that path's rulings can correct points
    // the same way.
    const closedOutcome = outcome(22, "2026-10-20T11:00:00.000Z");
    const closedReview = review(
      22,
      1,
      carol as GitHubActor,
      "APPROVED",
      "2026-10-19T03:00:00.000Z",
    );
    const closedPull = {
      ...closedOutcome,
      ...reviewed(closedOutcome, [closedReview]),
      mergedAt: null,
      closedAt: "2026-10-20T11:00:00.000Z",
      isDraft: false,
      reviewDecision: null,
      activeReviewRequestCount: 0,
      assignees: [],
      labels: [],
      files: [],
      closingIssueIds: [],
      changedFiles: 1,
      commitCount: 1,
    };
    const closedSnapshot = createLeaderboardSnapshot(
      input({
        closedUnmergedPullRequests: [
          closedPull,
        ] as unknown as LeaderboardInput["closedUnmergedPullRequests"],
        valuePolicy: POLICY,
        valueDecisions: new Map<string, unknown>([
          [
            closedOutcome.id,
            assessed(closedOutcome, "9", "medium", [
              { sourceId: closedReview.id, tier: "none" },
            ]),
          ],
        ]) as unknown as LeaderboardInput["valueDecisions"],
      }),
    );
    expect(
      (closedSnapshot.reviewExclusions ?? []).find(
        (entry) => entry.reviewId === closedReview.id,
      )?.reason,
    ).toBe("review-credit-zero-share");
  } finally {
    setSystemTime(new Date(AT));
  }
});

test("review policy and window omissions preserve earned Points without blocking in-scope corrections", () => {
  const merged = {
    ...outcome(23, "2026-09-05T13:37:34.000Z"),
    createdAt: "2026-08-27T00:00:00.000Z",
  };
  const august = review(
    23,
    1,
    bob as GitHubActor,
    "APPROVED",
    "2026-08-29T11:58:00.000Z",
  );
  const september = review(
    23,
    2,
    carol as GitHubActor,
    "APPROVED",
    "2026-09-04T11:58:00.000Z",
  );
  const snapshotAt = (
    from: string,
    to: string,
    tier: "none" | "standard" | null,
  ) => {
    const base = input({
      windowFrom: from,
      windowTo: to,
      verificationWindowFrom: from,
      mergedPullRequestOutcomes: [merged],
      reviewedMergedPullRequests: [reviewed(merged, [august, september])],
      ...(tier === null
        ? {}
        : {
            valuePolicy: { ...POLICY, effectiveAt: "2026-09-01T00:00:00.000Z" },
            valueDecisions: new Map([
              [
                merged.id,
                assessed(merged, "a", "medium", [
                  { sourceId: august.id, tier },
                  { sourceId: september.id, tier },
                ]),
              ],
            ]) as unknown as LeaderboardInput["valueDecisions"],
          }),
    });
    return createLeaderboardSnapshot({
      ...base,
      source: {
        ...base.source,
        cutoffAt: to,
        verificationWindow: { days: 35, from, to },
      },
    });
  };
  const first = snapshotAt(
    "2026-08-06T00:00:00.000Z",
    "2026-09-10T00:00:00.000Z",
    null,
  );
  const journal = applyPointsSnapshot(
    emptyPointsJournal(AT),
    first,
    "a".repeat(64),
    AT,
  );
  const original = JSON.stringify(journal);
  const prior = [...latestPoints(journal).values()].find(
    (r) => r.award.sourceId === august.id,
  );
  const inScope = [...latestPoints(journal).values()].find(
    (r) => r.award.sourceId === september.id,
  );
  expect(prior?.award.amount).toBe(30);
  expect(inScope?.award.amount).toBe(30);
  if (!prior || !inScope) throw new Error("Missing original review awards");

  // The same August record must survive both a disjoint September window
  // and a rolling window that still contains its actual submission date.
  for (const [from, to] of [
    ["2026-09-01T00:00:00.000Z", "2026-10-06T00:00:00.000Z"],
    ["2026-08-06T00:00:00.000Z", "2026-09-10T00:00:00.000Z"],
  ]) {
    for (const tier of ["none", "standard"] as const) {
      const next = snapshotAt(from as string, to as string, tier);
      // The August review predates the policy, so it keeps its original
      // rules and recomputes to the same award; no omission is published.
      expect(
        next.reviewExclusions?.find((r) => r.reviewId === august.id),
      ).toBeUndefined();
      expect(
        next.ledger
          .filter((event) => event.source.id === august.id)
          .map((event) => [event.id, event.scoreThirds]),
      ).toEqual([[`${merged.id}:reviewer:${bob?.id}`, 3]]);
      const updated = applyPointsSnapshot(journal, next, "b".repeat(64), AT);
      expect(latestPoints(updated).get(prior.award.key)).toEqual(prior);
      expect(latestPoints(updated).get(inScope.award.key)?.award.amount).toBe(
        tier === "none" ? 0 : 30,
      );
      expect(updated.revisions.slice(0, journal.revisions.length)).toEqual(
        journal.revisions,
      );
      expect(applyPointsSnapshot(updated, next, "b".repeat(64), AT)).toEqual(
        updated,
      );
    }
  }
  // A still-positive in-scope review falling out of a later window is not a
  // revocation. A real tier-none ruling still corrects that same old review.
  for (const tier of ["standard", "none"] as const) {
    const next = snapshotAt(
      "2026-09-05T00:00:00.000Z",
      "2026-10-10T00:00:00.000Z",
      tier,
    );
    expect(
      next.reviewExclusions?.find((r) => r.reviewId === september.id)?.reason,
    ).toBe(
      tier === "standard"
        ? "review-credit-outside-window"
        : "review-credit-zero-share",
    );
    const updated = applyPointsSnapshot(journal, next, "c".repeat(64), AT);
    expect(latestPoints(updated).get(prior.award.key)).toEqual(prior);
    expect(latestPoints(updated).get(inScope.award.key)?.award.amount).toBe(
      tier === "standard" ? 30 : 0,
    );
  }
  const correction = snapshotAt(
    "2026-09-01T00:00:00.000Z",
    "2026-10-06T00:00:00.000Z",
    "none",
  );
  // An omission string cannot overrule the known original occurrence time.
  for (const reason of [
    "review-credit-outside-window",
    "review-credit-before-policy",
  ] as const) {
    const forged = structuredClone(correction);
    const row = forged.reviewExclusions?.find(
      (r) => r.reviewId === september.id,
    );
    if (!row) throw new Error("Missing current review ruling");
    row.reason = reason;
    expect(() =>
      applyPointsSnapshot(journal, forged, "d".repeat(64), AT),
    ).toThrow("Review omission contradicts");
  }
  const missingBoundary = structuredClone(correction);
  const omitted = missingBoundary.reviewExclusions?.find(
    (r) => r.reviewId === september.id,
  );
  if (!omitted) throw new Error("Missing current review ruling");
  omitted.reason = "review-credit-before-policy";
  delete missingBoundary.valuePolicyEffectiveAt;
  expect(() => assertLeaderboardSnapshot(missingBoundary)).toThrow(
    "Review policy omissions require",
  );
  expect(() =>
    applyPointsSnapshot(journal, missingBoundary, "d".repeat(64), AT),
  ).toThrow("Review omission contradicts");
  expect(JSON.stringify(journal)).toBe(original);
});

test("a joint award gives way to the minimum when its decision is no longer assessed", () => {
  const merged = outcome(14, "2026-10-20T10:00:00.000Z");
  const workUnitId = `wu_${"1".repeat(64)}`;
  const history = [{ recorded_at: "2026-10-22T00:00:00.000Z" }];
  const assessedJoint = {
    status: "assessed",
    latestDigest: "c".repeat(64),
    history,
    record: {
      sources: [{ pullRequestNodeId: merged.id, headSha: HEAD }],
      units: [
        {
          workUnitId,
          claimIds: ["claim-0"],
          assessment: {
            tier: "medium",
            rationale: "Repairs the reported workflow.",
            reviews: [],
          },
        },
      ],
    },
    evidence: {
      claims: [
        {
          id: "claim-0",
          carrierPullRequestIds: [merged.id],
          creditPullRequestId: merged.id,
          implementationActorNodeIds: [(alice as GitHubActor).id],
        },
      ],
      sources: [
        {
          evidence: {
            repository: REPO,
            pull: {
              node_id: merged.id,
              head: { sha: HEAD },
              updated_at: merged.updatedAt,
              merged_at: merged.mergedAt,
              user: { node_id: (alice as GitHubActor).id },
              html_url: merged.url,
              number: merged.number,
              title: merged.title,
            },
            comments: [],
            reviews: [],
          },
        },
      ],
    },
  };
  const notAssessed = (status: string) => ({
    status,
    latestDigest: "c".repeat(64),
    history,
    throughSequence: 1,
  });
  const jointSnapshot = (decision: unknown, census = [merged]) =>
    createLeaderboardSnapshot(
      input({
        mergedPullRequestOutcomes: census,
        reviewedMergedPullRequests: census.map((pull) => reviewed(pull, [])),
        valuePolicy: POLICY,
        valueDecisions: new Map(),
        valueActors: new Map([
          [(alice as GitHubActor).id, alice as GitHubActor],
        ]),
        jointValueDecisions: new Map([
          [merged.id, decision],
        ]) as unknown as LeaderboardInput["jointValueDecisions"],
      }),
    );
  const assessedJournal = applyPointsSnapshot(
    emptyPointsJournal(AT),
    jointSnapshot(assessedJoint),
    "1".repeat(64),
    AT,
  );
  expect(pointMembers(assessedJournal)[0]?.total).toBe(90);

  for (const status of ["stale", "incomplete"]) {
    // A changed source or rubric makes the unit stale and missing evidence
    // makes it incomplete; the producer then scores the merge by its own
    // record at the one-third minimum.
    const current = jointSnapshot(notAssessed(status));
    expect(
      current.ledger.map((event) => [event.id, event.scoreThirds]),
    ).toEqual([["PR_14:merged", 1]]);
    const journal = applyPointsSnapshot(
      assessedJournal,
      current,
      "2".repeat(64),
      AT,
    );
    // PRD section 7: one accepted merge is credited once, as a single-source
    // decision that turns stale is corrected to the minimum in place.
    expect(pointMembers(journal)[0]?.total).toBe(10);
    expect(
      [...latestPoints(journal).values()]
        .filter((revision) => revision.award.amount > 0)
        .map((revision) => revision.award.workUnitId),
    ).toEqual(["wu_slopdotcash_slopdotcash_pr_14"]);

    // The exact completion source can invalidate a unit without generating
    // a new award, for example when no eligible author remains.
    const noCredit = jointSnapshot(notAssessed(status), [
      { ...merged, author: null, commits: [] },
    ]);
    expect(noCredit.ledger).toEqual([]);
    const removed = applyPointsSnapshot(
      assessedJournal,
      noCredit,
      "4".repeat(64),
      AT,
    );
    expect(pointMembers(removed)[0]?.total ?? 0).toBe(0);

    // A different record does not invalidate the earlier unit by inference.
    const unrelated = {
      ...noCredit,
      valueAssessmentCoverage: noCredit.valueAssessmentCoverage?.map((row) => ({
        ...row,
        recordDigest: "d".repeat(64),
      })),
    };
    const retained = applyPointsSnapshot(
      assessedJournal,
      unrelated,
      "5".repeat(64),
      AT,
    );
    expect(pointMembers(retained)[0]?.total).toBe(90);
  }

  // A snapshot that does not score the merge is not evidence that the unit
  // award was wrong, so the award stays.
  const elsewhere = outcome(15, "2026-10-21T10:00:00.000Z");
  const omitted = applyPointsSnapshot(
    assessedJournal,
    jointSnapshot(notAssessed("stale"), [elsewhere]),
    "3".repeat(64),
    AT,
  );
  expect(
    [...latestPoints(omitted).values()].find(
      (revision) => revision.award.workUnitId === workUnitId,
    )?.award.amount,
  ).toBe(90);
});

test("a merge assessed at zero keeps the minimum and a one-third review pool", () => {
  const zero = outcome(5, "2026-10-21T10:00:00.000Z");
  const result = createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [zero],
      reviewedMergedPullRequests: [
        reviewed(zero, [
          review(
            5,
            1,
            bob as GitHubActor,
            "APPROVED",
            "2026-10-21T09:00:00.000Z",
          ),
        ]),
      ],
      valuePolicy: POLICY,
      valueDecisions: new Map<string, unknown>([
        [
          zero.id,
          assessed(zero, "f", "none", [{ sourceId: "PRR_5_1", tier: "deep" }]),
        ],
      ]) as unknown as LeaderboardInput["valueDecisions"],
    }),
  );
  const byId = new Map(result.ledger.map((event) => [event.id, event]));
  expect(byId.get("PR_5:merged")?.scoreThirds).toBe(1);
  expect(byId.get("PR_5:merged")?.scoreDecisionSourceId).toBe(
    `value:${"f".repeat(64)}`,
  );
  expect(byId.get("PR_5:value-review:PRR_5_1")?.scoreThirds).toBe(1);
});

test("value feed transport distinguishes redirects from an interrupted download", async () => {
  let mode = "redirect";
  let followed = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/unexpected") {
        followed = true;
        return new Response("unexpected");
      }
      if (mode === "redirect")
        return new Response(null, {
          status: 302,
          headers: { location: "/unexpected" },
        });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"schemaVersion":'));
          },
        }),
      );
    },
  });
  const transport = (async (_: unknown, init: RequestInit) => {
    const interrupted = new AbortController();
    const response = await fetch(server.url, {
      ...init,
      signal: AbortSignal.any([interrupted.signal, init.signal as AbortSignal]),
    });
    if (mode === "interrupted") setTimeout(() => interrupted.abort(), 20);
    return response;
  }) as typeof fetch;
  try {
    const redirect = await fetchValueHistoryPage(REPO, 1, 0, transport).catch(
      (error) => error,
    );
    expect(redirect).toBeInstanceOf(Error);
    expect(redirect).not.toBeInstanceOf(ValueFeedUnavailableError);
    expect(followed).toBe(false);
    mode = "interrupted";
    const interrupted = await fetchValueHistoryPage(
      REPO,
      1,
      0,
      transport,
    ).catch((error) => error);
    expect(interrupted).toBeInstanceOf(ValueFeedUnavailableError);
  } finally {
    server.stop(true);
  }
});

test("reviews outside the scoring window do not consume review credit", () => {
  // The rolling window starts on 18 September. These reviews qualify the
  // accepted head, but their submission times are already outside that window.
  const outside = "2026-09-01T00:00:00.000Z";
  const blocked = outcome(8, "2026-10-20T10:00:00.000Z");
  const split = outcome(9, "2026-10-20T11:00:00.000Z");
  const outsideReviewers = [bob, dave, erin, frank, grace] as GitHubActor[];
  const blockedReviews = [
    ...outsideReviewers.map((reviewer, index) =>
      review(
        8,
        index + 1,
        reviewer,
        "APPROVED",
        `2026-09-0${index + 1}T00:00:00.000Z`,
      ),
    ),
    review(8, 6, carol as GitHubActor, "APPROVED", "2026-10-19T06:00:00.000Z"),
  ];
  const splitReviews = [
    review(9, 1, bob as GitHubActor, "APPROVED", outside),
    review(9, 2, bob as GitHubActor, "APPROVED", "2026-10-19T01:00:00.000Z"),
    review(9, 3, carol as GitHubActor, "APPROVED", "2026-10-19T02:00:00.000Z"),
  ];
  const result = createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [blocked, split],
      reviewedMergedPullRequests: [
        reviewed(blocked, blockedReviews),
        reviewed(split, splitReviews),
      ],
      valuePolicy: { ...POLICY, effectiveAt: "2026-09-01T00:00:00.000Z" },
      valueDecisions: new Map<string, unknown>([
        [
          blocked.id,
          assessed(
            blocked,
            "a",
            "medium",
            blockedReviews.map((item) => ({
              sourceId: item.id,
              tier: "standard",
            })),
          ),
        ],
        [
          split.id,
          assessed(split, "b", "medium", [
            { sourceId: "PRR_9_1", tier: "deep" },
            { sourceId: "PRR_9_2", tier: "standard" },
            { sourceId: "PRR_9_3", tier: "standard" },
          ]),
        ],
      ]) as unknown as LeaderboardInput["valueDecisions"],
    }),
  );
  const reviewCredit = result.ledger
    .filter((event) => event.category === "substantive-review")
    .map((event) => [event.id, event.actor.id, event.scoreThirds]);
  // Carol is the only in-window reviewer. Her standard band is the whole pool.
  // Five earlier reviewers must not fill the five-reviewer cap.
  expect(
    reviewCredit.filter((row) => String(row[0]).startsWith("PR_8:")),
  ).toEqual([["PR_8:value-review:PRR_8_6", "U_carol", 3]]);
  // Bob's in-window standard review is his weight. The older deep review is
  // not moved into this window and does not shrink Carol's share.
  expect(
    reviewCredit.filter((row) => String(row[0]).startsWith("PR_9:")),
  ).toEqual([
    ["PR_9:value-review:PRR_9_2", "U_bob", 3],
    ["PR_9:value-review:PRR_9_3", "U_carol", 3],
  ]);
  const exclusions = new Map(
    (result.reviewExclusions ?? []).map((exclusion) => [
      exclusion.reviewId,
      exclusion.reason,
    ]),
  );
  for (const reviewId of [
    "PRR_8_1",
    "PRR_8_2",
    "PRR_8_3",
    "PRR_8_4",
    "PRR_8_5",
  ])
    expect(exclusions.get(reviewId)).toBe("review-credit-outside-window");
  expect(exclusions.get("PRR_8_6")).toBeUndefined();
  expect(exclusions.get("PRR_9_1")).toBe("review-credit-outside-window");
  expect(exclusions.get("PRR_9_2")).toBeUndefined();
  expect(exclusions.get("PRR_9_3")).toBeUndefined();
});

test("a review before the policy keeps its rules when the pull request merges after it", () => {
  // SCR-05 applied when these reviews were submitted. The merge falls under
  // the value policy, but neither review had scored yet: a review scores only
  // at merge. Bob's request for changes on an earlier commit is credited at
  // triage; Carol's approval of the merged head did not change the outcome.
  const pull = outcome(12, "2026-10-20T10:00:00.000Z");
  const reviews = [
    review(
      12,
      1,
      bob as GitHubActor,
      "CHANGES_REQUESTED",
      "2026-10-10T00:00:00.000Z",
      "b".repeat(40),
    ),
    review(12, 2, carol as GitHubActor, "APPROVED", "2026-10-12T00:00:00.000Z"),
  ];
  const result = createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [pull],
      reviewedMergedPullRequests: [reviewed(pull, reviews)],
      valuePolicy: POLICY,
      valueDecisions: new Map(),
    }),
  );
  expect(
    result.ledger
      .filter((event) => event.category === "substantive-review")
      .map((event) => [event.actor.id, event.scoreThirds, event.occurredAt]),
  ).toEqual([[bob?.id, 1, "2026-10-10T00:00:00.000Z"]]);
  expect(
    (result.reviewExclusions ?? []).map((item) => [item.reviewId, item.reason]),
  ).toEqual([["PRR_12_2", "unchanged-outcome"]]);
});

test("excluding an old joint review does not shrink the pull request size", () => {
  const pull = outcome(10, "2026-10-20T10:00:00.000Z");
  const reviews = [
    review(10, 1, bob as GitHubActor, "APPROVED", "2026-09-01T00:00:00.000Z"),
    review(10, 2, carol as GitHubActor, "APPROVED", "2026-10-19T00:00:00.000Z"),
  ];
  const decision = {
    status: "assessed",
    latestDigest: "c".repeat(64),
    history: [{ recorded_at: "2026-10-22T00:00:00.000Z" }],
    record: {
      sources: [{ pullRequestNodeId: pull.id, headSha: HEAD }],
      units: reviews.map((item, index) => ({
        workUnitId: `wu_unit-${index}`,
        claimIds: [`claim-${index}`],
        assessment: {
          tier: index === 0 ? "medium" : "micro",
          rationale: "An independently accepted part of the pull request.",
          reviews: [
            {
              sourceId: item.id,
              tier: "standard",
              finding: "Verified the fix.",
              outcome: "The accepted head retains it.",
            },
          ],
        },
      })),
    },
    evidence: {
      claims: reviews.map((_, index) => ({
        id: `claim-${index}`,
        carrierPullRequestIds: [pull.id],
        creditPullRequestId: pull.id,
        implementationActorNodeIds: [alice?.id],
      })),
      sources: [
        {
          evidence: {
            repository: REPO,
            pull: {
              node_id: pull.id,
              head: { sha: HEAD },
              updated_at: pull.updatedAt,
              merged_at: pull.mergedAt,
              user: { node_id: alice?.id },
              html_url: pull.url,
              number: pull.number,
              title: pull.title,
            },
            comments: [],
            reviews: reviews.map((item) => ({
              node_id: item.id,
              body: item.body,
              user: { node_id: item.author?.id },
              submitted_at: item.submittedAt,
            })),
          },
        },
      ],
    },
  };
  const result = createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [pull],
      reviewedMergedPullRequests: [reviewed(pull, reviews)],
      valuePolicy: POLICY,
      valueDecisions: new Map(),
      valueActors: new Map([[(alice as GitHubActor).id, alice as GitHubActor]]),
      jointValueDecisions: new Map([
        [pull.id, decision],
      ]) as unknown as LeaderboardInput["jointValueDecisions"],
    }),
  );
  expect(
    result.ledger
      .filter((event) => event.category === "substantive-review")
      .map((event) => [event.actor.id, event.scoreThirds]),
  ).toEqual([
    // Bob's September approval predates the policy and keeps that period's
    // standard credit even though the pull request merged later.
    [bob?.id, 3],
    [carol?.id, 3],
  ]);
});

test("an evaluated review award does not shrink the pull request size", () => {
  // Bob already received an evaluated award for the medium unit. That award
  // takes his pool share. Carol's standard review is on the micro unit, and
  // the pull request size stays the larger unit (PRD section 7).
  const pull = outcome(11, "2026-10-20T10:00:00.000Z");
  const reviews = [
    review(11, 1, bob as GitHubActor, "APPROVED", "2026-10-19T00:00:00.000Z"),
    review(11, 2, carol as GitHubActor, "APPROVED", "2026-10-19T01:00:00.000Z"),
  ];
  const bobReview = reviews[0] as PullRequestReview;
  const decision = {
    status: "assessed",
    latestDigest: "d".repeat(64),
    history: [{ recorded_at: "2026-10-22T00:00:00.000Z" }],
    record: {
      sources: [{ pullRequestNodeId: pull.id, headSha: HEAD }],
      units: reviews.map((item, index) => ({
        workUnitId: `wu_unit-${index}`,
        claimIds: [`claim-${index}`],
        assessment: {
          tier: index === 0 ? "medium" : "micro",
          rationale: "An independently accepted part of the pull request.",
          reviews: [
            {
              sourceId: item.id,
              tier: "standard",
              finding: "Verified the fix.",
              outcome: "The accepted head retains it.",
            },
          ],
        },
      })),
    },
    evidence: {
      claims: reviews.map((_, index) => ({
        id: `claim-${index}`,
        carrierPullRequestIds: [pull.id],
        creditPullRequestId: pull.id,
        implementationActorNodeIds: [alice?.id],
      })),
      sources: [
        {
          evidence: {
            repository: REPO,
            pull: {
              node_id: pull.id,
              head: { sha: HEAD },
              updated_at: pull.updatedAt,
              merged_at: pull.mergedAt,
              user: { node_id: alice?.id },
              html_url: pull.url,
              number: pull.number,
              title: pull.title,
            },
            comments: [],
            reviews: reviews.map((item) => ({
              node_id: item.id,
              body: item.body,
              user: { node_id: item.author?.id },
              submitted_at: item.submittedAt,
            })),
          },
        },
      ],
    },
  };
  const result = createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [pull],
      reviewedMergedPullRequests: [reviewed(pull, reviews)],
      valuePolicy: POLICY,
      valueDecisions: new Map(),
      valueActors: new Map([[(alice as GitHubActor).id, alice as GitHubActor]]),
      jointValueDecisions: new Map([
        [pull.id, decision],
      ]) as unknown as LeaderboardInput["jointValueDecisions"],
      evaluatedContributions: [
        {
          id: "award_joint_medium_review",
          actor: bob as GitHubActor,
          category: "evaluated-contribution",
          points: 2,
          occurredAt: bobReview.submittedAt as string,
          repository: REPO,
          source: {
            id: bobReview.id,
            kind: "review",
            number: pull.number,
            title: pull.title,
            url: bobReview.url,
          },
          reason:
            "The maintainer awarded this review directly, so it must not also take a share of the review pool.",
          evaluation: {
            decisionUrl: "https://github.com/SlopDotCash/slopdotcash/pull/900",
            reviewedAt: "2026-10-19T12:00:00.000Z",
            reviewer: "lalalune",
            manifestPath:
              "evaluations/slopdotcash/award-joint-medium-review.json",
            manifestSha256: "e".repeat(64),
          },
        },
      ],
    }),
  );
  expect(
    result.ledger
      .filter((event) => event.category === "substantive-review")
      .map((event) => [event.actor.id, event.scoreThirds]),
  ).toEqual([[carol?.id, 3]]);
  expect(
    result.ledger.some(
      (event) =>
        event.category === "evaluated-contribution" &&
        event.actor.id === bob?.id &&
        event.source.id === bobReview.id,
    ),
  ).toBe(true);
  expect(
    result.ledger.some(
      (event) =>
        event.category === "substantive-review" && event.actor.id === bob?.id,
    ),
  ).toBe(false);
});

test("published account bans remove new merge and review credit but retain earlier work", async () => {
  const bannedAt = "2026-10-19T04:00:00.000Z";
  const bans = await loadParticipationBans(
    {
      get: async <T>(path: string) =>
        ({
          id: path === "/user/11" ? 11 : 12,
          node_id: path === "/user/11" ? "U_alice" : "U_bob",
        }) as T,
    },
    (async () =>
      Response.json({
        schemaVersion: "slop-account-bans:v1",
        bans: [
          { githubId: "11", bannedAt },
          { githubId: "12", bannedAt },
        ],
      })) as unknown as typeof fetch,
  );
  const before = snapshot().ledger;
  const after = snapshot(POLICY, bans).ledger;
  const blocked = before.filter(
    (event) => bans.has(event.actor.id) && event.occurredAt >= bannedAt,
  );
  expect(
    blocked.some((event) => event.category === "merged-pull-request"),
  ).toBe(true);
  expect(blocked.some((event) => event.category === "substantive-review")).toBe(
    true,
  );
  expect(
    after.filter(
      (event) => bans.has(event.actor.id) && event.occurredAt >= bannedAt,
    ),
  ).toEqual([]);
  // Removing Bob's post-ban deep review must retain his earlier standard
  // review and reallocate the pool using only eligible bands.
  expect(
    after
      .filter((event) => event.id.startsWith("PR_2:value-review:"))
      .map((event) => [event.source.id, event.scoreThirds]),
  ).toEqual([
    ["PRR_2_2", 5],
    ["PRR_2_1", 2],
    ["PRR_2_5", 2],
  ]);
  expect(after.filter((event) => event.source.number === 1)).toEqual(
    before.filter((event) => event.source.number === 1),
  );
  expect(
    after.some(
      (event) => event.actor.id === "U_alice" && event.occurredAt < bannedAt,
    ),
  ).toBe(true);
  await expect(
    loadParticipationBans(
      { get: async () => null },
      (async () =>
        new Response(null, { status: 503 })) as unknown as typeof fetch,
    ),
  ).rejects.toBeInstanceOf(ValueFeedUnavailableError);
});

test("banned formal reviews do not take the SCR-05 review slot or erase pre-ban credit", () => {
  const bannedAt = "2026-10-12T07:30:00.000Z";
  const shared = outcome(24, "2026-10-12T10:00:00.000Z");
  const selfReplaced = outcome(25, "2026-10-12T10:00:00.000Z");
  const priorCommit = "b".repeat(40);
  const laterPriorCommit = "c".repeat(40);
  const result = createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [shared, selfReplaced],
      reviewedMergedPullRequests: [
        reviewed(shared, [
          review(
            24,
            1,
            carol as GitHubActor,
            "CHANGES_REQUESTED",
            "2026-10-12T07:00:00.000Z",
            priorCommit,
          ),
          review(
            24,
            2,
            bob as GitHubActor,
            "CHANGES_REQUESTED",
            "2026-10-12T08:00:00.000Z",
            priorCommit,
          ),
        ]),
        reviewed(selfReplaced, [
          review(
            25,
            1,
            bob as GitHubActor,
            "CHANGES_REQUESTED",
            "2026-10-12T07:00:00.000Z",
            priorCommit,
          ),
          review(
            25,
            2,
            bob as GitHubActor,
            "CHANGES_REQUESTED",
            "2026-10-12T08:00:00.000Z",
            laterPriorCommit,
          ),
        ]),
      ],
      valuePolicy: POLICY,
      valueDecisions: new Map(),
      participationBans: new Map([["U_bob", bannedAt]]),
    }),
  );
  const byId = new Map(result.ledger.map((event) => [event.id, event]));
  expect(byId.get("PR_24:reviewer:U_carol")?.scoreThirds).toBe(1);
  expect(byId.has("PR_24:reviewer:U_bob")).toBe(false);
  expect(byId.get("PR_25:reviewer:U_bob")?.source.id).toBe("PRR_25_1");
  expect(byId.get("PR_25:reviewer:U_bob")?.scoreThirds).toBe(1);
  expect(byId.get("PR_25:reviewer:U_bob")?.reviewHistory).toBeUndefined();
  expect(result.paymentReviewBasis?.removedEventIds).toEqual([]);
  const exclusions = new Map(
    (result.reviewExclusions ?? []).map((item) => [item.reviewId, item.reason]),
  );
  expect(exclusions.get("PRR_24_1")).toBeUndefined();
  expect(exclusions.get("PRR_24_2")).toBe("review-credit-account-banned");
  expect(exclusions.get("PRR_25_1")).toBeUndefined();
  expect(exclusions.get("PRR_25_2")).toBe("review-credit-account-banned");
  const journal = applyPointsSnapshot(
    emptyPointsJournal(AT),
    result,
    "f".repeat(64),
    AT,
  );
  const totals = new Map(
    pointMembers(journal).map((member) => [member.actor.id, member.total]),
  );
  expect(totals.get("U_carol")).toBe(10);
  expect(totals.get("U_bob")).toBe(10);
});
