import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHistoricalLeaderboardSnapshot } from "../src/lib/leaderboard";
import type { LeaderboardInput } from "../src/lib/leaderboard-types";
import {
  appendPointAwards,
  emptyPointsJournal,
  type PointAward,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import { repositoryIdentity } from "../src/lib/project-repositories.mjs";
import { findIngestedProjectByRepositoryId } from "../src/lib/projects.mjs";
import {
  VALUE_SCORING_APPROVED_HISTORY_FROM,
  valueScoringPolicy,
} from "../src/lib/scoring-policy";
import { sha256Hex } from "../src/lib/sha256";
import { VALUE_RUBRIC_VERSION } from "../src/lib/value-assessment";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import type { LegacyAssessmentCatalogRow } from "./historical-assessment-catalog";
import { classifyHistoricalAssessmentScope } from "./historical-assessment-reconciliation";
import {
  projectHistoricalValueChanges,
  verifyHistoricalValueReplay,
} from "./historical-value-replay";
import { HISTORICAL_POINTS_AUDIT_WINDOW } from "./reviewed-historical-points";

afterEach(() => setSystemTime());

const repository = "elizaOS/eliza";
const project = findIngestedProjectByRepositoryId(repository);
if (!project) throw Error("Eliza is missing from the registry fixture");
const identity = repositoryIdentity(project, repository);
if (!identity) throw Error("Eliza has no fixture repository identity");
const scope = {
  projectId: project.id,
  repository,
  repositoryNodeId: identity.nodeId,
  manifestSha256: sha256Hex(JSON.stringify(project)),
};
const assessedAt = "2026-11-16T01:00:00.000Z";
const empty = () => emptyPointsJournal("2026-11-18T01:00:00.000Z");

function fixture({
  status = "assessed",
  tier = "small",
  assessedAt: decisionTime = assessedAt,
}: {
  status?: "assessed" | "missing" | "stale";
  tier?: "small" | "medium";
  assessedAt?: string;
} = {}) {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const ordinary = penaltyScoreInput([], GENERATED_AT);
  const url = `https://github.com/${repository}/pull/7`;
  const outcome = { ...ordinary.mergedPullRequestOutcomes[0], url };
  const pull = { ...ordinary.mergedPullRequests[0], url };
  const { from, through } = HISTORICAL_POINTS_AUDIT_WINDOW;
  const audit = {
    repository,
    repositoryNodeId: scope.repositoryNodeId,
    from,
    through,
    sources: [
      {
        id: pull.id,
        number: pull.number,
        headSha: pull.headRefOid,
        mergedAt: outcome.mergedAt,
      },
    ],
  };
  const sourceDigest = "c".repeat(64);
  const record = {
    schemaVersion: "slop-value-record:v1",
    ...scope,
    repositoryDatabaseId: 1,
    pullRequestNodeId: pull.id,
    pullRequestNumber: pull.number,
    headSha: status === "stale" ? "a".repeat(40) : pull.headRefOid,
    mergeSha: "b".repeat(40),
    policySha: "d".repeat(40),
    sourceDigest,
    occurredAt: outcome.mergedAt,
    model: {
      provider: "surplus",
      reported: "gpt-6.1-sol",
      requested: "gpt-6.1-sol",
    },
    producerRevision: "e".repeat(40),
    assessedAt: decisionTime,
    rubricVersion: VALUE_RUBRIC_VERSION,
    assessment: {
      status: "assessed",
      tier,
      rationale: "Verified fixture value.",
      reviews: [],
    },
    supersedes: null,
    revisionReason: null,
  };
  const record_json = JSON.stringify(record);
  const digest = sha256Hex(record_json);
  const row: LegacyAssessmentCatalogRow = {
    sequence: 1,
    recorded_at: decisionTime,
    record_digest: digest,
    record_json,
    repository_node_id: scope.repositoryNodeId,
    pull_request_node_id: pull.id,
    head_sha: record.headSha,
    source_digest: sourceDigest,
    supersedes: null,
  };
  const legacyDecision = {
    status,
    latestDigest: digest,
    history: [row],
    record,
    assessment: record.assessment,
    implementationActorNodeIds: [pull.author?.id],
  };
  const input: LeaderboardInput = {
    ...ordinary,
    generatedAt: GENERATED_AT,
    windowFrom: from,
    windowTo: through,
    verificationWindowFrom: from,
    sourceUpdatedAt: outcome.updatedAt,
    source: {
      ...ordinary.source,
      repositoryId: scope.repositoryNodeId,
      cutoffAt: through,
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
    closedUnmergedPullRequests: [],
    valueDecisions:
      status === "missing"
        ? new Map()
        : new Map([[pull.id, legacyDecision as never]]),
  };
  const snapshot = createHistoricalLeaderboardSnapshot(input, scope);
  const revision = 5;
  async function review(
    baseline: PointsJournal,
    active = true,
    deriveKeys = true,
  ) {
    const baselineDigest = sha256Hex(JSON.stringify(baseline));
    const baselineRevisionCount = baseline.revisions.length;
    const receipt = await classifyHistoricalAssessmentScope(
      {
        heads: {
          jointThrough: 0,
          jointScopedCount: 0,
          legacyThrough: active ? 1 : 0,
          legacyRepoCount: active ? 1 : 0,
          d1PointsDigest: baselineDigest,
          d1PointsCount: baselineRevisionCount,
          enforcementGeneration: 0,
          registryRevision: revision,
          registryManifestSha256: scope.manifestSha256,
        },
        joint: [],
        legacy: active ? [row] : [],
      },
      audit,
      scope.projectId,
    );
    const packet = {
      projectId: scope.projectId,
      sourceAudit: audit,
      revision,
      manifestSha256: scope.manifestSha256,
      baselineDigest,
      baselineRevisionCount,
      valueSnapshot: active ? snapshot : null,
      valueKeys: [] as string[],
    };
    if (active && deriveKeys)
      packet.valueKeys = projectHistoricalValueChanges(
        packet,
        baseline,
        snapshot,
      ).rows.map(({ award }) => award.key);
    return { packet, receipt };
  }
  return { snapshot, review };
}

test("identical canonical awards survive changes to collector telemetry and recording time", async () => {
  const f = fixture();
  const baseline = empty();
  const { packet, receipt } = await f.review(baseline);
  expect(receipt.status).toBe("requires-value-replay");
  expect(packet.valueKeys).toHaveLength(1);
  const trusted = structuredClone(f.snapshot);
  trusted.generatedAt = "2026-11-22T00:00:00.000Z";
  trusted.source.fetchedAt = trusted.generatedAt;
  trusted.source.requestCount += 10;
  trusted.source.searchSliceCount += 1;
  trusted.source.rateLimit.remaining -= 20;
  const compared = projectHistoricalValueChanges(packet, baseline, trusted);
  expect(compared.rows[0].decision?.effectiveAt).toBe(assessedAt);
  expect(compared.rows[0].recordedAt).toBe(trusted.generatedAt);
  expect(compared.rows[0].award.amount).toBe(30);
  const qualification = verifyHistoricalValueReplay(
    packet,
    baseline,
    receipt,
    trusted,
  );
  expect(qualification).toMatch(/^[0-9a-f]{64}$/u);
  expect(qualification).toBe(
    verifyHistoricalValueReplay(packet, baseline, receipt, f.snapshot),
  );
});

test("refuses changes to economics, frozen assessment timestamp, and selected keys", async () => {
  const f = fixture();
  const baseline = empty();
  const { packet, receipt } = await f.review(baseline);
  const changedAward = fixture({ tier: "medium" }).snapshot;
  const assessedCoverage = changedAward.valueAssessmentCoverage?.[0];
  if (!assessedCoverage) throw Error("Fixture lacks assessed value coverage");
  assessedCoverage.recordDigest = receipt.records[0].digest;
  changedAward.ledger[0].scoreDecisionSourceId = `value:${receipt.records[0].digest}`;
  const changedDecisionTime = structuredClone(f.snapshot);
  changedDecisionTime.ledger[0].scoreDecisionAt = "2026-11-16T02:00:00.000Z";
  const changedLink = structuredClone(f.snapshot);
  changedLink.ledger[0].workUnitId = "wu_fixture_different";
  expect(() =>
    verifyHistoricalValueReplay(
      { ...packet, valueSnapshot: changedAward },
      baseline,
      receipt,
      f.snapshot,
    ),
  ).toThrow("differ from the trusted replay");
  expect(() =>
    verifyHistoricalValueReplay(
      { ...packet, valueSnapshot: changedDecisionTime },
      baseline,
      receipt,
      f.snapshot,
    ),
  ).toThrow("differ from the trusted replay");
  expect(() =>
    verifyHistoricalValueReplay(
      { ...packet, valueSnapshot: changedLink },
      baseline,
      receipt,
      f.snapshot,
    ),
  ).toThrow("differ from the trusted replay");
  for (const valueKeys of [[], [...packet.valueKeys, ...packet.valueKeys]])
    expect(() =>
      verifyHistoricalValueReplay(
        { ...packet, valueKeys },
        baseline,
        receipt,
        f.snapshot,
      ),
    ).toThrow("omit or add a trusted assessed change");
});

test("an active assessment can't disappear from both snapshots or be replaced with a null snapshot", async () => {
  const f = fixture();
  const baseline = empty();
  const { packet, receipt } = await f.review(baseline);
  const missing = fixture({ status: "missing" }).snapshot;
  expect(() =>
    verifyHistoricalValueReplay(
      { ...packet, valueSnapshot: missing, valueKeys: [] },
      baseline,
      receipt,
      missing,
    ),
  ).toThrow("omits or misstates an active assessment");
  expect(() =>
    verifyHistoricalValueReplay(
      { ...packet, valueSnapshot: null, valueKeys: [] },
      baseline,
      receipt,
      null,
    ),
  ).toThrow("Complete historical value replay is required");
  const noRecords = await f.review(baseline, false);
  expect(noRecords.receipt.status).toBe("no-scoped-active-assessments");
  expect(() =>
    verifyHistoricalValueReplay(
      noRecords.packet,
      baseline,
      noRecords.receipt,
      null,
    ),
  ).not.toThrow();
  expect(() =>
    verifyHistoricalValueReplay(
      noRecords.packet,
      baseline,
      noRecords.receipt,
      f.snapshot,
    ),
  ).toThrow("Empty assessment scope");
});

test("a source whose active assessment is stale holds old awards and has no replay keys", async () => {
  const f = fixture({ status: "stale" });
  const current = fixture();
  const seed = await current.review(empty());
  const { award } = projectHistoricalValueChanges(
    seed.packet,
    empty(),
    current.snapshot,
  ).rows[0];
  const baseline = appendPointAwards(
    empty(),
    [{ ...award, amount: 90 }],
    "1".repeat(64),
    "slop-score-v2",
    empty().generatedAt,
  );
  const { packet, receipt } = await f.review(baseline);
  expect(receipt.records[0]?.sources[0]?.finding).toBe("stale-head");
  expect(f.snapshot.valueAssessmentCoverage?.[0]?.status).toBe("stale");
  expect(packet.valueKeys).toEqual([]);
  // The rolling projection still emits a fallback minimum. Historical replay
  // must not apply it as an authoritative value change.
  const projection = projectHistoricalValueChanges(
    packet,
    baseline,
    f.snapshot,
  );
  expect(projection.changed[0]?.award.amount).toBe(10);
  expect(projection.rows).toEqual([]);
  expect(() =>
    verifyHistoricalValueReplay(packet, baseline, receipt, f.snapshot),
  ).not.toThrow();
});

test("refuses to add a linked in-window pool while an earlier out-of-window pool still stands", async () => {
  const f = fixture();
  const prepared = await f.review(empty());
  const inScope = projectHistoricalValueChanges(
    prepared.packet,
    empty(),
    f.snapshot,
  ).rows[0].award;
  const outside: PointAward = {
    ...inScope,
    sourceId: "PR_prior",
    sourceUrl: `https://github.com/${repository}/pull/5`,
    occurredAt: "2026-09-15T00:00:00.000Z",
    provisional: false,
    key: pointKey(
      scope.projectId,
      inScope.actor.id,
      "merged-pull-request",
      "PR_prior",
    ),
  };
  for (const linked of [false, true]) {
    const baseline = appendPointAwards(
      empty(),
      [
        {
          ...outside,
          workUnitId: linked ? outside.workUnitId : "wu_fixture_unrelated",
        },
      ],
      "1".repeat(64),
      "slop-score-v2",
      empty().generatedAt,
    );
    const { packet, receipt } = await f.review(baseline);
    const compare = () =>
      verifyHistoricalValueReplay(packet, baseline, receipt, f.snapshot);
    if (linked) expect(compare).toThrow("split a linked implementation change");
    else expect(compare).not.toThrow();
  }
});

test("the canonical checkpoint and implementation occurrence cannot drift", async () => {
  const f = fixture();
  const baseline = empty();
  const { packet, receipt } = await f.review(baseline);
  const alteredAudit = structuredClone(packet.sourceAudit);
  alteredAudit.sources[0].headSha = "f".repeat(40);
  expect(() =>
    verifyHistoricalValueReplay(
      { ...packet, sourceAudit: alteredAudit },
      baseline,
      receipt,
      f.snapshot,
    ),
  ).toThrow("differs from the reconciled audit or Points baseline");
  expect(() =>
    verifyHistoricalValueReplay(
      packet,
      { ...baseline, generatedAt: GENERATED_AT },
      receipt,
      f.snapshot,
    ),
  ).toThrow("differs from the reconciled audit or Points baseline");
  const { award } = projectHistoricalValueChanges(packet, baseline, f.snapshot)
    .rows[0];
  const old = appendPointAwards(
    baseline,
    [{ ...award, occurredAt: "2026-10-18T12:00:00.000Z" }],
    "1".repeat(64),
    "slop-score-v2",
    baseline.generatedAt,
  );
  const changed = await f.review(old, true, false);
  expect(() =>
    verifyHistoricalValueReplay(
      changed.packet,
      old,
      changed.receipt,
      f.snapshot,
    ),
  ).toThrow("Point history moved");
});
