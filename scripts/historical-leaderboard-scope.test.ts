import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  assertHistoricalLeaderboardSnapshot,
  assertLeaderboardSnapshot,
  assertPublishableLeaderboardSnapshot,
  createHistoricalLeaderboardSnapshot,
  createLeaderboardSnapshot,
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
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import {
  assertHistoricalMergedCensus,
  generateHistoricalLeaderboardFromGitHub,
} from "./generate-leaderboard";
import { HISTORICAL_POINTS_AUDIT_WINDOW } from "./reviewed-historical-points";

afterEach(() => setSystemTime());

const repository = "elizaOS/eliza";
const project = findIngestedProjectByRepositoryId(repository);
if (!project) throw Error("Eliza is missing from the fixture registry");
const identity = repositoryIdentity(project, repository);
if (!identity) throw Error("Eliza has no pinned fixture repository");
const scope = {
  projectId: project.id,
  repository,
  repositoryNodeId: identity.nodeId,
  manifestSha256: sha256Hex(JSON.stringify(project)),
};

const auditedSource = {
  id: "PR_audited",
  number: 7,
  headSha: "a".repeat(40),
  mergedAt: "2026-10-15T12:34:56.000Z",
};
const observedSource = {
  id: auditedSource.id,
  number: auditedSource.number,
  headRefOid: auditedSource.headSha,
  mergedAt: "2026-10-15T12:34:56Z",
};

test("historical collection checks merge identity, head, and time before replay", () => {
  assertHistoricalMergedCensus([auditedSource], [observedSource]);
  for (const changed of [
    { id: "PR_different" },
    { number: 8 },
    { headRefOid: "b".repeat(40) },
    { mergedAt: "2026-10-15T12:34:57Z" },
  ])
    expect(() =>
      assertHistoricalMergedCensus(
        [auditedSource],
        [{ ...observedSource, ...changed }],
      ),
    ).toThrow("differ from the source audit");
  expect(() => assertHistoricalMergedCensus([auditedSource], [])).toThrow();
});

test("historical replay refuses a changed Points checkpoint before collection", async () => {
  await expect(
    generateHistoricalLeaderboardFromGitHub({} as never, {
      scope,
      audit: {
        repository,
        repositoryNodeId: scope.repositoryNodeId,
        ...HISTORICAL_POINTS_AUDIT_WINDOW,
        sources: [auditedSource],
      },
      catalog: {
        heads: {
          jointThrough: 0,
          legacyThrough: 0,
          jointScopedCount: 0,
          legacyRepoCount: 0,
          d1PointsDigest: "0".repeat(64),
          d1PointsCount: 0,
          enforcementGeneration: 0,
          registryRevision: 1,
          registryManifestSha256: scope.manifestSha256,
        },
        legacy: [],
        joint: [],
      },
      baseline: emptyPointsJournal(GENERATED_AT),
    }),
  ).rejects.toThrow("verified checkpoint");
});

function fixture() {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const ordinary = penaltyScoreInput([], GENERATED_AT);
  const url = `https://github.com/${repository}/pull/7`;
  const outcome = { ...ordinary.mergedPullRequestOutcomes[0], url };
  const pull = { ...ordinary.mergedPullRequests[0], url };
  const { from, through } = HISTORICAL_POINTS_AUDIT_WINDOW;
  return {
    ordinary,
    historical: {
      ...ordinary,
      generatedAt: GENERATED_AT,
      windowFrom: from,
      windowTo: through,
      verificationWindowFrom: from,
      sourceUpdatedAt: outcome.updatedAt,
      source: {
        ...ordinary.source,
        repositoryId: scope.repositoryNodeId,
        repositories: [
          { id: repository, repositoryId: scope.repositoryNodeId },
        ],
        cutoffAt: through,
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
      closedUnmergedPullRequests: [],
    },
  };
}

test("a pinned repository uses the real historical scoring and snapshot validator", () => {
  const { historical } = fixture();
  const snapshot = createHistoricalLeaderboardSnapshot(historical, scope);
  assertLeaderboardSnapshot(snapshot);
  assertHistoricalLeaderboardSnapshot(snapshot, scope);
  expect(snapshot.repository).toBe(repository);
  expect(snapshot.repositories.map(({ id, role }) => ({ id, role }))).toEqual([
    { id: repository, role: "primary" },
  ]);
  expect(
    snapshot.valueAssessmentCoverage?.map(({ pullRequestId, status }) => ({
      pullRequestId,
      status,
    })),
  ).toEqual([{ pullRequestId: "PR_october", status: "missing" }]);
  expect(
    snapshot.ledger.map((event) => [
      event.repository,
      event.category,
      event.scoreThirds,
    ]),
  ).toEqual([[repository, "merged-pull-request", 1]]);
});

test("ordinary publication still requires the complete target inventory", () => {
  const { ordinary, historical } = fixture();
  const ordinarySnapshot = createLeaderboardSnapshot(ordinary);
  assertPublishableLeaderboardSnapshot(ordinarySnapshot);
  expect(() => createLeaderboardSnapshot(historical)).toThrow(
    "node ID for every registry repository",
  );
  const historicalSnapshot = createHistoricalLeaderboardSnapshot(
    historical,
    scope,
  );
  expect(() =>
    assertPublishableLeaderboardSnapshot(historicalSnapshot),
  ).toThrow("complete target repository registry for publication");
});

test("a mismatched registry manifest or repository node ID fails closed", () => {
  const { historical } = fixture();
  expect(() =>
    createHistoricalLeaderboardSnapshot(historical, {
      ...scope,
      manifestSha256: "a".repeat(64),
    }),
  ).toThrow("pinned active project and repository");
  const snapshot = createHistoricalLeaderboardSnapshot(historical, scope);
  snapshot.source.repositoryId = "R_wrong";
  snapshot.source.repositories[0].repositoryId = "R_wrong";
  assertLeaderboardSnapshot(snapshot);
  expect(() => assertHistoricalLeaderboardSnapshot(snapshot, scope)).toThrow(
    "differs from the pinned repository",
  );
});

test("foreign outcome, review context and source metadata are refused before scoring", () => {
  const { ordinary, historical } = fixture();
  expect(() =>
    createHistoricalLeaderboardSnapshot(
      {
        ...historical,
        mergedPullRequestOutcomes: [
          ...historical.mergedPullRequestOutcomes,
          ordinary.mergedPullRequestOutcomes[1],
        ],
      },
      scope,
    ),
  ).toThrow("input is outside the pinned repository");
  expect(() =>
    createHistoricalLeaderboardSnapshot(
      {
        ...historical,
        valueContextPullRequests: [ordinary.mergedPullRequests[1]],
      },
      scope,
    ),
  ).toThrow("input is outside the pinned repository");
  expect(() =>
    createHistoricalLeaderboardSnapshot(
      {
        ...historical,
        source: {
          ...historical.source,
          repositories: ordinary.source.repositories,
        },
      },
      scope,
    ),
  ).toThrow("input is outside the pinned repository");
});
