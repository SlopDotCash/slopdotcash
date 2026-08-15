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
import { SCORE_CAPS } from "./leaderboard";
import {
  createProjectView,
  formatCapUsageLine,
  projectCycleHasOpened,
} from "./project-view";
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
    skillRevision: `elizaOS/slopdotcash@${"a".repeat(40)}:skills/contribute-to-eliza`,
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
      projectedDisplayMinor: "10000000000",
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
      projectedDisplayMinor: null,
      projectedSharePartsPerMillion: 1_000_000,
    });
    expect(delta.reward).toMatchObject({
      kind: "external-prize-share",
      totalSharePartsPerMillion: 1_000_000,
    });
  });

  it("keeps still-open opportunities across cycle bounds and reports cap fill", () => {
    const snapshot = snapshotFixture();
    snapshot.opportunities = [
      {
        id: "PR_old_open:opportunity:missing-evidence",
        actor: snapshot.leaders[0].actor,
        kind: "missing-evidence",
        category: "evidence",
        potentialPoints: 6,
        occurredAt: "2026-06-20T12:00:00.000Z",
        repository: "elizaOS/eliza",
        source: {
          id: "PR_old_open",
          kind: "pull-request",
          number: 17000,
          title: "Older open checklist",
          url: "https://github.com/elizaOS/eliza/pull/17000",
        },
        reason:
          "Open pull request evidence is missing with 0 of 6 points verified.",
        hint: "Add verified screenshot, video, or log evidence before merge.",
      },
      {
        id: "PR_arklib_open:opportunity:partial-evidence",
        actor: snapshot.leaders[0].actor,
        kind: "partial-evidence",
        category: "evidence",
        potentialPoints: 4,
        occurredAt: "2026-07-29T12:00:00.000Z",
        repository: "lalalune/arklib",
        source: {
          id: "PR_arklib_open",
          kind: "pull-request",
          number: 99,
          title: "Ark open checklist",
          url: "https://github.com/lalalune/arklib/pull/99",
        },
        reason:
          "Open pull request evidence is partial with 2 of 6 points verified.",
        hint: "Finish verified evidence categories before merge.",
      },
    ];

    const eliza = createProjectView(snapshot, "eliza", "2026-07");
    expect(eliza.opportunities).toHaveLength(1);
    expect(eliza.opportunities[0].source.id).toBe("PR_old_open");
    expect(eliza.leaders[0].capUsage).toMatchObject({
      month: "2026-07",
      mergedPullRequests: { used: 1, cap: null },
      resolvedIssues: { used: 1, cap: SCORE_CAPS.resolvedIssues },
      materialTestChanges: { used: 1, cap: SCORE_CAPS.materialTestChanges },
      evidencePoints: { used: 3, cap: SCORE_CAPS.evidencePoints },
      substantiveReviews: { used: 1, cap: SCORE_CAPS.substantiveReviews },
      evaluatedContributions: {
        used: 0,
        cap: SCORE_CAPS.evaluatedContributions,
      },
    });
    expect(formatCapUsageLine(eliza.leaders[0].capUsage)).toBe(
      "2026-07 scoring · merges 1 uncapped · issues 1/5 · tests 1/5 · evidence 3/30 · reviews 1/10",
    );

    const delta = createProjectView(snapshot, "delta-star", "2026-07");
    expect(delta.opportunities.map((row) => row.source.id)).toEqual([
      "PR_arklib_open",
    ]);
  });

  it("does not advertise points after the contributor has filled that cap", () => {
    const snapshot = snapshotFixture();
    const evidenceTemplate = snapshot.ledger.find(
      (event) => event.category === "evidence",
    );
    if (!evidenceTemplate) throw new Error("fixture needs an evidence event");
    snapshot.ledger.push(
      ...Array.from({ length: 9 }, (_, index) => ({
        ...evidenceTemplate,
        id: `PR_cap_${index}:evidence`,
        points: 3,
        occurredAt: `2026-07-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`,
        source: {
          ...evidenceTemplate.source,
          id: `PR_cap_${index}`,
          number: 18000 + index,
          url: `https://github.com/elizaOS/eliza/pull/${18000 + index}`,
        },
      })),
    );

    expect(
      createProjectView(snapshot, "eliza", "2026-07").opportunities,
    ).toEqual([]);
  });

  it("reports receipt evidence without changing rank or simulated allocation", () => {
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
    expect(view.leaders[0].computeBonusBasisPoints).toBe(0);
    expect(view.leaders[0].adjustedWeight).toBe(240_000);
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
      skillRevision: `elizaOS/slopdotcash@${"a".repeat(40)}:skills/contribute-to-delta-star`,
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
    expect(
      view.leaders.reduce(
        (total, entry) => total + BigInt(entry.projectedDisplayMinor ?? "0"),
        0n,
      ),
    ).toBe(10_000_000_000n);
    expect(
      view.leaders.every(
        (entry) => BigInt(entry.projectedDisplayMinor ?? "0") % 10_000n === 0n,
      ),
    ).toBe(true);
    expect(view.leaders.map((entry) => entry.actor.login)).toEqual([
      "finish-line",
      "second-place",
    ]);
  });
});

describe("prelaunch projects", () => {
  it("reports a project whose pool starts after the snapshot as not opened", () => {
    const snapshot = snapshotFixture();

    // asi pledged its pool on 2026-08-12, after this snapshot's window ends,
    // so it has no cycle to show yet while eliza does.
    expect(projectCycleHasOpened(snapshot, "eliza")).toBe(true);
    expect(projectCycleHasOpened(snapshot, "asi")).toBe(false);
    expect(() => createProjectView(snapshot, "asi")).toThrow(
      "does not overlap the available snapshot",
    );
  });
});
