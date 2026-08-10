/**
 * Exercises project isolation, cycle filtering, bounded token weighting, replay
 * rejection, and exact largest-remainder reward projections with real snapshot
 * contracts and deterministic fixtures.
 */

import { describe, expect, it } from "vitest";
import { snapshotFixture } from "../../tests/fixtures";
import type {
  GitHubActor,
  LeaderboardSnapshot,
  ModelAttribution,
} from "./leaderboard";
import { createProjectView } from "./project-view";
import type { ProjectRunReceipt } from "./run-receipts";

const SECOND_ACTOR: GitHubActor = {
  id: "U_second",
  login: "second-place",
  avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
  url: "https://github.com/second-place",
  kind: "User",
};

function receipt(
  overrides: Partial<ProjectRunReceipt> = {},
): ProjectRunReceipt {
  return {
    schemaVersion: "1",
    runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    projectId: "eliza",
    repositoryId: "elizaOS/eliza",
    startedAt: "2026-07-29T10:00:00.000Z",
    completedAt: "2026-07-29T11:00:00.000Z",
    provider: "openai",
    model: "gpt-5.6-sol",
    client: "codex",
    skillRevision: `elizaOS/army@${"a".repeat(40)}:skills/contribute-to-eliza`,
    skillSha256: "b".repeat(64),
    usage: {
      source: "ccusage-session-v20",
      confidence: "exact",
      inputTokens: 300_000,
      outputTokens: 200_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 500_000,
      costMicroUsd: "2500000",
      sessionCount: 1,
    },
    trajectorySha256: "c".repeat(64),
    signatureAlgorithm: "ed25519",
    devicePublicKey: "d".repeat(43),
    deviceKeyId: "e".repeat(64),
    deviceSignature: "f".repeat(86),
    ...overrides,
  };
}

function attribution(
  snapshot: LeaderboardSnapshot,
  run: ProjectRunReceipt,
  overrides: Partial<ModelAttribution> = {},
): ModelAttribution {
  return {
    id: `${run.runId}:marker`,
    sourceId: "COMMENT_RUN_fixture",
    sourceUrl: "https://github.com/elizaOS/eliza/pull/17327#issuecomment-2",
    artifactId: "PR_fixture",
    actor: snapshot.leaders[0].actor,
    provider: run.provider,
    model: run.model,
    identifier: `${run.provider}/${run.model}`,
    client: run.client,
    skillRevision: run.skillRevision,
    run,
    format: "machine-marker",
    status: "self-reported",
    ...overrides,
  };
}

describe("project views", () => {
  it("isolates project score, queue, and reward semantics", () => {
    const snapshot = snapshotFixture();
    const eliza = createProjectView(snapshot, "eliza", "2026-07");
    const delta = createProjectView(snapshot, "delta-star", "2026-07");

    expect(eliza.leaders[0]).toMatchObject({
      score: 24,
      projectedMinor: "10000000000",
      projectedSharePartsPerMillion: null,
    });
    expect(eliza.ledger).toHaveLength(6);
    expect(
      eliza.ledger.every((event) => event.repository === "elizaOS/eliza"),
    ).toBe(true);
    expect(eliza.reward).toMatchObject({
      kind: "monthly-pool",
      projectedPrincipalMinor: "10000000000",
      platformFeeMinor: "100000000",
    });

    expect(delta.leaders[0]).toMatchObject({
      score: 10,
      projectedMinor: null,
      projectedSharePartsPerMillion: 1_000_000,
    });
    expect(delta.reward).toMatchObject({
      kind: "external-prize-share",
      totalSharePartsPerMillion: 1_000_000,
    });
  });

  it("counts project receipts publicly but only weights runs tied to accepted outcomes", () => {
    const snapshot = snapshotFixture();
    const relevant = receipt();
    const ambiguous = receipt({
      runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAW",
      usage: {
        ...receipt().usage,
        totalTokens: 100_000,
        inputTokens: 60_000,
        outputTokens: 40_000,
        costMicroUsd: "500000",
      },
    });
    snapshot.attributions.push(
      attribution(snapshot, relevant),
      attribution(snapshot, ambiguous, {
        id: `${ambiguous.runId}:marker`,
        artifactId: "PR_not_scored",
        sourceId: "COMMENT_AMBIGUOUS_fixture",
      }),
    );

    const view = createProjectView(snapshot, "eliza", "2026-07");
    expect(view.leaders[0].usage).toEqual({
      reportedTokens: 600_000,
      relevantTokens: 500_000,
      creditedTokens: 500_000,
      ambiguousTokens: 100_000,
      estimatedCostMicroUsd: "3000000",
      runCount: 2,
      relevantRunCount: 1,
      confidence: "verified-device",
    });
    expect(view.leaders[0].computeBonusBasisPoints).toBe(1_333);
    expect(view.leaders[0].adjustedWeight).toBe(271_992);
  });

  it("drops copied run receipts instead of crediting either identity", () => {
    const snapshot = snapshotFixture();
    const shared = receipt();
    snapshot.attributions.push(
      attribution(snapshot, shared),
      attribution(snapshot, shared, {
        id: `${shared.runId}:copied-marker`,
        actor: SECOND_ACTOR,
      }),
    );

    const view = createProjectView(snapshot, "eliza", "2026-07");
    expect(view.usage.runCount).toBe(0);
    expect(view.receiptConflicts).toEqual([
      {
        runId: shared.runId,
        reason: "marker-copied-between-actors",
      },
    ]);
  });

  it("drops distinct runs when one device key spans multiple identities", () => {
    const snapshot = snapshotFixture();
    const first = receipt();
    const second = receipt({
      runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAW",
      deviceSignature: "g".repeat(86),
    });
    snapshot.attributions.push(
      attribution(snapshot, first),
      attribution(snapshot, second, {
        id: `${second.runId}:second-identity`,
        actor: SECOND_ACTOR,
      }),
    );

    const view = createProjectView(snapshot, "eliza", "2026-07");
    expect(view.usage.runCount).toBe(0);
    expect(view.receiptConflicts).toEqual([
      {
        runId: first.runId,
        reason: "device-key-shared-between-actors",
      },
      {
        runId: second.runId,
        reason: "device-key-shared-between-actors",
      },
    ]);
  });

  it("treats a cross-project device key shared by identities as suspicious", () => {
    const snapshot = snapshotFixture();
    const elizaRun = receipt();
    const deltaRun = receipt({
      runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAW",
      projectId: "delta-star",
      repositoryId: "lalalune/arklib",
      skillRevision: `elizaOS/army@${"a".repeat(40)}:skills/contribute-to-delta-star`,
      deviceSignature: "g".repeat(86),
    });
    snapshot.attributions.push(
      attribution(snapshot, elizaRun),
      attribution(snapshot, deltaRun, {
        id: `${deltaRun.runId}:other-project`,
        actor: SECOND_ACTOR,
        artifactId: "PR_arklib_fixture",
        sourceId: "PR_arklib_fixture",
      }),
    );

    const view = createProjectView(snapshot, "eliza", "2026-07");
    expect(view.usage.runCount).toBe(0);
    expect(view.receiptConflicts).toEqual([
      {
        runId: elizaRun.runId,
        reason: "device-key-shared-between-actors",
      },
    ]);
  });

  it("splits every integer exactly and deterministically", () => {
    const snapshot = snapshotFixture();
    snapshot.ledger.push({
      id: "PR_second:merged",
      actor: SECOND_ACTOR,
      category: "merged-pull-request",
      points: 10,
      occurredAt: "2026-07-29T10:00:00.000Z",
      repository: "elizaOS/eliza",
      source: {
        id: "PR_second",
        kind: "pull-request",
        number: 17328,
        title: "A second accepted outcome",
        url: "https://github.com/elizaOS/eliza/pull/17328",
      },
      reason: "Pull request merged during the rolling window.",
    });

    const view = createProjectView(snapshot, "eliza", "2026-07");
    expect(
      view.leaders.reduce(
        (total, entry) => total + BigInt(entry.projectedMinor ?? "0"),
        0n,
      ),
    ).toBe(10_000_000_000n);
    expect(view.leaders.map((entry) => entry.actor.login)).toEqual([
      "finish-line",
      "second-place",
    ]);
  });
});
