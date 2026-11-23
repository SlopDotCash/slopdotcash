import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  createHistoricalLeaderboardSnapshot,
  type LeaderboardInput,
} from "../src/lib/leaderboard";
import { emptyPointsJournal } from "../src/lib/points";
import { repositoryIdentity } from "../src/lib/project-repositories.mjs";
import { findIngestedProjectByRepositoryId } from "../src/lib/projects.mjs";
import {
  VALUE_SCORING_APPROVED_HISTORY_FROM,
  valueScoringPolicy,
} from "../src/lib/scoring-policy";
import { sha256Hex } from "../src/lib/sha256";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { createMergedHistoricalReplaySnapshot } from "./historical-merged-replay";
import { HISTORICAL_POINTS_AUDIT_WINDOW } from "./reviewed-historical-points";

afterEach(() => setSystemTime());

const repository = "elizaOS/eliza";
const project = findIngestedProjectByRepositoryId(repository);
if (!project) throw Error("Eliza missing from the fixture registry");
const identity = repositoryIdentity(project, repository);
if (!identity) throw Error("Eliza has no fixture repository identity");
const scope = {
  projectId: project.id,
  repository,
  repositoryNodeId: identity.nodeId,
  manifestSha256: sha256Hex(JSON.stringify(project)),
};
const reviewedAt = "2026-10-20T12:00:00.000Z";
const closedAt = "2026-10-28T12:00:00.000Z";

function fixture() {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const ordinary = penaltyScoreInput([], GENERATED_AT);
  const closedSource = ordinary.closedUnmergedPullRequests?.[0];
  if (!closedSource) throw Error("Fixture lacks closed source");
  const url = (pull: { number: number }) =>
    `https://github.com/${repository}/pull/${pull.number}`;
  const outcome = {
    ...ordinary.mergedPullRequestOutcomes[0],
    url: url(ordinary.mergedPullRequestOutcomes[0]),
  };
  const pull = { ...ordinary.mergedPullRequests[0], url: outcome.url };
  const review = {
    id: "PRR_closed_review",
    author: PROJECT_OWNER,
    body: "Validates the submitted change.",
    state: "APPROVED",
    inlineCommentCount: 0,
    submittedAt: reviewedAt,
    url: `${url(closedSource)}#pullrequestreview-123`,
  };
  const closed = {
    ...closedSource,
    url: url(closedSource),
    createdAt: "2026-10-15T12:00:00.000Z",
    updatedAt: closedAt,
    closedAt,
    reviews: [review],
  };
  const { from, through } = HISTORICAL_POINTS_AUDIT_WINDOW;
  const input: LeaderboardInput = {
    ...ordinary,
    windowFrom: from,
    windowTo: through,
    verificationWindowFrom: from,
    sourceUpdatedAt: outcome.updatedAt,
    source: {
      ...ordinary.source,
      cutoffAt: through,
      repositoryId: scope.repositoryNodeId,
      repositories: [{ id: repository, repositoryId: scope.repositoryNodeId }],
      verificationWindow: { days: 35, from, to: through },
      counts: {
        ...ordinary.source.counts,
        mergedPullRequests: 1,
        detailedMergedPullRequests: 1,
      },
    },
    valuePolicy: {
      ...valueScoringPolicy(),
      effectiveAt: VALUE_SCORING_APPROVED_HISTORY_FROM,
    },
    mergedPullRequestOutcomes: [outcome],
    mergedPullRequests: [pull],
    detailEligibleMergedPullRequestIds: [pull.id],
    closedUnmergedPullRequests: [closed],
  };
  return {
    input,
    closed,
    review,
    pull,
    baseline: emptyPointsJournal("2026-11-19T00:00:00.000Z"),
  };
}

test("omits an audited ordinary unassessed closure with no Points or linkage effect", () => {
  const { input, closed, pull, baseline } = fixture();
  const full = createHistoricalLeaderboardSnapshot(input, scope);
  expect(
    full.valueAssessmentCoverage?.find(
      (row) => row.pullRequestId === closed.id,
    ),
  ).toMatchObject({
    status: "missing",
    recordDigest: null,
  });
  const result = createMergedHistoricalReplaySnapshot(input, scope, baseline);
  expect(result.source.counts.closedUnmergedPullRequests).toBe(0);
  expect(
    result.valueAssessmentCoverage?.map((row) => row.pullRequestId),
  ).toEqual([pull.id]);
  expect(result.ledger).toEqual(full.ledger);
  expect(input.closedUnmergedPullRequests?.map((row) => row.id)).toEqual([
    closed.id,
  ]);
});

test("a scored closed-unmerged review requires expanded lifecycle authority", () => {
  const { input, closed, review, baseline } = fixture();
  const assessment = {
    status: "assessed",
    tier: "small",
    reviews: [
      {
        sourceId: review.id,
        tier: "standard",
        finding: "Checks the integration behavior.",
        outcome: "Reviewed",
      },
    ],
  };
  input.valueDecisions = new Map([
    [
      closed.id,
      {
        status: "assessed",
        latestDigest: "a".repeat(64),
        history: [{ recorded_at: GENERATED_AT }],
        implementationActorNodeIds: [],
        record: { headSha: closed.headRefOid, assessment },
        assessment,
      } as never,
    ],
  ]);
  const full = createHistoricalLeaderboardSnapshot(input, scope);
  expect(full.ledger).toContainEqual(
    expect.objectContaining({
      category: "substantive-review",
      source: expect.objectContaining({ id: review.id }),
    }),
  );
  expect(() =>
    createMergedHistoricalReplaySnapshot(input, scope, baseline),
  ).toThrow("expanded lifecycle source contract");
});

test("a recorded closed-PR penalty cannot be omitted with its scope", () => {
  const { input, closed, baseline } = fixture();
  input.penalties = [
    {
      itemNodeId: closed.id,
      authorGithubId: "42",
      category: "spam",
      tableVersion: "slopbot-penalties-v1",
      debitThirds: 1,
      period: "2026-10",
      recordedAt: closedAt,
    },
  ];
  const full = createHistoricalLeaderboardSnapshot(input, scope);
  expect(full.penalties?.map((row) => row.source.id)).toEqual([closed.id]);
  expect(() =>
    createMergedHistoricalReplaySnapshot(input, scope, baseline),
  ).toThrow("closed-unmerged scored-work");
});

test("omitting a closure cannot restore accepted review credit from a retained source", () => {
  const { input, closed, review, baseline } = fixture();
  input.retainedReviewEvents = [
    {
      id: `${closed.id}:reviewer:${review.author.id}`,
      actor: review.author,
      category: "substantive-review",
      occurredAt: reviewedAt,
      points: 1 / 3,
      scoreThirds: 1,
      workUnitId: "wu_retained_closed_review",
      repository,
      source: {
        id: review.id,
        kind: "review",
        number: closed.number,
        title: closed.title,
        url: review.url,
      },
      reason: "Retained qualifying review from the prior accepted snapshot.",
    },
  ];
  const full = createHistoricalLeaderboardSnapshot(input, scope);
  const withoutClosed = createHistoricalLeaderboardSnapshot(
    { ...input, closedUnmergedPullRequests: [] },
    scope,
  );
  expect(
    full.ledger.some((event) => event.category === "substantive-review"),
  ).toBe(false);
  expect(
    withoutClosed.ledger.some(
      (event) => event.category === "substantive-review",
    ),
  ).toBe(true);
  expect(() =>
    createMergedHistoricalReplaySnapshot(input, scope, baseline),
  ).toThrow("closed-unmerged projection");
});

test("a jointly held closure is not equivalent to an unassessed ordinary closure", () => {
  const { input, closed, pull, baseline } = fixture();
  const digest = "a".repeat(64);
  const unresolved = {
    status: "unresolved" as const,
    sourceUnavailable: true as const,
    history: [],
    throughSequence: 1,
    latestDigest: digest,
  };
  input.jointValueDecisions = new Map([
    [closed.id, unresolved],
    [pull.id, unresolved],
  ]);
  input.source.heldWorkUnits = [
    {
      recordDigest: digest,
      sourceNodeIds: [closed.id, pull.id, "PR_unavailable"].sort(),
      unavailableNodeIds: ["PR_unavailable"],
    },
  ];
  input.source.unavailableSources = [
    { nodeId: "PR_unavailable", reason: "NOT_FOUND" },
  ];
  input.jointValueDecisions = new Map([
    ...input.jointValueDecisions,
    ["PR_unavailable", unresolved],
  ]);
  const full = createHistoricalLeaderboardSnapshot(input, scope);
  expect(
    full.valueAssessmentCoverage?.find((row) => row.pullRequestId === closed.id)
      ?.recordDigest,
  ).toBe(digest);
  expect(() =>
    createMergedHistoricalReplaySnapshot(input, scope, baseline),
  ).toThrow("closed-unmerged assessment");
  const context = {
    digest,
    number: closed.number,
    headSha: closed.headRefOid,
    occurredAt: closed.closedAt,
  };
  expect(() =>
    createMergedHistoricalReplaySnapshot(
      input,
      scope,
      baseline,
      new Map([[closed.id, context]]),
    ),
  ).toThrow("closed-unmerged assessment");
  const retained = createMergedHistoricalReplaySnapshot(
    input,
    scope,
    baseline,
    new Map([[closed.id, { ...context, retainedMergeHold: true }]]),
  );
  expect(retained.source.heldWorkUnits).toEqual(input.source.heldWorkUnits);
  expect(retained.ledger).toEqual(full.ledger);
});
