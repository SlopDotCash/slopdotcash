/**
 * Proves the operator payout planner splits a pool exactly, orders and rounds
 * deterministically, never overpays a contributor, and refuses stale, invalid,
 * or empty inputs instead of emitting a plan nobody can audit.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  GitHubActorKind,
  LeaderboardEntry,
  LeaderboardSnapshot,
  ScoreEvent,
} from "../src/lib/leaderboard";
import {
  mergedPullRequestPoints,
  SCORE_RULE_VERSION,
} from "../src/lib/leaderboard";
import { snapshotFixture } from "../tests/fixtures";
import {
  ACCOUNT_LINKAGE_STATUS,
  allocateByWeight,
  assertOperatorOutputPath,
  createPayoutPlan,
  type DistributionModelId,
  ELIGIBLE_ACTOR_REQUIREMENT,
  formatMinorUnits,
  formatPayoutPlanSummary,
  MAX_SNAPSHOT_AGE_HOURS,
  OPERATOR_PLAN_DIRECTORY,
  type PayoutCurrencyCode,
  type PayoutPlan,
  PUBLISHED_SITE_DIRECTORY,
  parseDecimalToMinorUnits,
  parsePayoutPlanArguments,
  REPOSITORY_ROOT,
  runPayoutPlanner,
  type SnapshotSource,
  writePlanAtomically,
} from "./plan-payouts";

const SNAPSHOT_DIGEST = `sha256:${"a".repeat(64)}`;
const HOUR_MS = 60 * 60 * 1000;

interface ContributorSpec {
  login: string;
  kind?: GitHubActorKind;
  mergedPullRequests?: number;
  substantiveReviews?: number;
}

function compareFixtureEntries(
  left: LeaderboardEntry,
  right: LeaderboardEntry,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  const leftLower = left.actor.login.toLowerCase();
  const rightLower = right.actor.login.toLowerCase();
  if (leftLower !== rightLower) {
    return leftLower < rightLower ? -1 : 1;
  }
  if (left.actor.login !== right.actor.login) {
    return left.actor.login < right.actor.login ? -1 : 1;
  }
  return left.actor.id < right.actor.id ? -1 : 1;
}

/**
 * Builds a contract-valid snapshot whose leaders and ledger reconcile exactly,
 * so the planner is exercised against the same shape the site publishes.
 */
function planningSnapshot(
  specs: readonly ContributorSpec[],
): LeaderboardSnapshot {
  const snapshot = snapshotFixture();
  const ledger: ScoreEvent[] = [];
  const entries: LeaderboardEntry[] = [];
  let pullRequestNumber = 20_000;

  specs.forEach((spec, index) => {
    const mergedPullRequests = spec.mergedPullRequests ?? 0;
    const substantiveReviews = spec.substantiveReviews ?? 0;
    const actor = {
      id: `U_plan_${index}`,
      login: spec.login,
      avatarUrl: `https://avatars.githubusercontent.com/u/${900 + index}?v=4`,
      url: `https://github.com/${spec.login}`,
      kind: spec.kind ?? ("User" as GitHubActorKind),
    };
    for (let merged = 0; merged < mergedPullRequests; merged += 1) {
      pullRequestNumber += 1;
      const sourceId = `PR_plan_${index}_${merged}`;
      ledger.push({
        id: `${sourceId}:merged`,
        actor,
        category: "merged-pull-request",
        points: mergedPullRequestPoints(mergedPullRequests - merged),
        occurredAt: "2026-07-29T12:00:00.000Z",
        repository: "elizaOS/eliza",
        source: {
          id: sourceId,
          kind: "pull-request",
          number: pullRequestNumber,
          title: `Merged work ${merged} by ${spec.login}`,
          url: `https://github.com/elizaOS/eliza/pull/${pullRequestNumber}`,
        },
        reason:
          "Pull request merged during the rolling window; uncapped diminishing credit applies within its project and UTC month.",
      });
    }
    for (let review = 0; review < substantiveReviews; review += 1) {
      pullRequestNumber += 1;
      ledger.push({
        id: `PR_review_${index}_${review}:reviewer:${actor.id}`,
        actor,
        category: "substantive-review",
        points: 3,
        occurredAt: "2026-07-29T12:00:00.000Z",
        repository: "elizaOS/eliza",
        source: {
          id: `REVIEW_plan_${index}_${review}`,
          kind: "review",
          number: pullRequestNumber,
          title: `Reviewed work ${review} by ${spec.login}`,
          url: `https://github.com/elizaOS/eliza/pull/${pullRequestNumber}#pullrequestreview-${pullRequestNumber}`,
        },
        reason: "Substantive review completed before merge.",
      });
    }
    const mergedPoints = Array.from(
      { length: mergedPullRequests },
      (_, merged) => mergedPullRequestPoints(merged + 1),
    ).reduce((total, points) => total + points, 0);
    entries.push({
      rank: 1,
      actor,
      score: mergedPoints + substantiveReviews * 3,
      points: {
        mergedPullRequests: mergedPoints,
        resolvedIssues: 0,
        materialTestChanges: 0,
        evidence: 0,
        substantiveReviews: substantiveReviews * 3,
        evaluatedContributions: 0,
      },
      acceptedOutcomes: {
        mergedPullRequests,
        resolvedIssues: 0,
        materialTestChanges: 0,
        evidenceCategories: 0,
        substantiveReviews,
        evaluatedContributions: 0,
      },
      rawActivity: {
        comments: 0,
        reviews: substantiveReviews,
        commits: mergedPullRequests,
        additions: 0,
        deletions: 0,
      },
      reportedModels: [],
    });
  });

  snapshot.leaders = entries
    .sort(compareFixtureEntries)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  snapshot.ledger = ledger;
  snapshot.attributions = [];
  snapshot.invalidAttributionMarkers = [];
  snapshot.attributionCoverage = {
    status: "missing",
    eligibleSourceCount: 0,
    validSourceCount: 0,
    missingSourceCount: 0,
    invalidSourceCount: 0,
    humanOnlySourceCount: 0,
  };
  const mergedEventCount = ledger.filter(
    (event) => event.category === "merged-pull-request",
  ).length;
  const reviewedPullRequestCount = ledger.filter(
    (event) => event.category === "substantive-review",
  ).length;
  snapshot.source.counts.mergedPullRequests = Math.max(
    mergedEventCount,
    reviewedPullRequestCount,
  );
  snapshot.source.counts.detailedMergedPullRequests = reviewedPullRequestCount;
  return snapshot;
}

function planTime(snapshot: LeaderboardSnapshot, offsetMs = 60_000): number {
  return Date.parse(snapshot.generatedAt) + offsetMs;
}

function plan(
  snapshot: LeaderboardSnapshot,
  rule: Partial<Parameters<typeof createPayoutPlan>[0]["rule"]> = {},
  now = planTime(snapshot),
): PayoutPlan {
  return createPayoutPlan({
    snapshot,
    source: { path: "public/data/leaderboard.json", digest: SNAPSHOT_DIGEST },
    rule: {
      model: "proportional-by-points-v1",
      pool: "1000",
      currency: "USD",
      minimumPoints: 0,
      ...rule,
    },
    now,
  });
}

function totalAllocated(payoutPlan: PayoutPlan): bigint {
  return payoutPlan.allocations.reduce(
    (total, allocation) =>
      total + BigInt(allocation.allocation.amountMinorUnits),
    0n,
  );
}

function candidatesFor(specs: readonly ContributorSpec[]) {
  return planningSnapshot(specs).leaders.map((entry) => ({
    entry,
    weight: BigInt(entry.score),
  }));
}

describe("decimal money parsing", () => {
  it("parses decimal amounts into exact minor units", () => {
    expect(parseDecimalToMinorUnits("10000", 2)).toBe(1_000_000n);
    expect(parseDecimalToMinorUnits("10000.00", 2)).toBe(1_000_000n);
    expect(parseDecimalToMinorUnits("0.07", 2)).toBe(7n);
    expect(parseDecimalToMinorUnits("10.005", 6)).toBe(10_005_000n);
  });

  it("rejects amounts a currency cannot express exactly", () => {
    expect(() => parseDecimalToMinorUnits("10.005", 2)).toThrow(
      /more than the 2 decimal places/,
    );
    expect(() => parseDecimalToMinorUnits("-5", 2)).toThrow(/plain positive/);
    expect(() => parseDecimalToMinorUnits("1e3", 2)).toThrow(/plain positive/);
    expect(() => parseDecimalToMinorUnits("1,000", 2)).toThrow(
      /plain positive/,
    );
  });

  it("renders minor units back without floating point", () => {
    expect(formatMinorUnits(1_000_000n, 2)).toBe("10000.00");
    expect(formatMinorUnits(7n, 2)).toBe("0.07");
    expect(formatMinorUnits(0n, 6)).toBe("0.000000");
  });
});

describe("weighted allocation", () => {
  it("splits a pool in proportion to weights", () => {
    const allocations = allocateByWeight(
      100_000n,
      candidatesFor([
        { login: "ada", mergedPullRequests: 5 },
        { login: "bo", mergedPullRequests: 3 },
        { login: "cy", mergedPullRequests: 2 },
      ]),
    );
    expect(
      allocations.map((allocation) => [
        allocation.candidate.entry.actor.login,
        allocation.amountMinorUnits,
      ]),
    ).toEqual([
      ["ada", 44_737n],
      ["bo", 31_579n],
      ["cy", 23_684n],
    ]);
  });

  it("settles the remainder by largest remainder, then canonical order", () => {
    const allocations = allocateByWeight(
      100n,
      candidatesFor([
        { login: "ada", mergedPullRequests: 1 },
        { login: "bo", mergedPullRequests: 1 },
        { login: "cy", mergedPullRequests: 4 },
      ]),
    );
    expect(
      allocations.map((allocation) => [
        allocation.candidate.entry.actor.login,
        allocation.amountMinorUnits,
        allocation.remainderUnitAwarded,
      ]),
    ).toEqual([
      ["cy", 59n, false],
      ["ada", 21n, true],
      ["bo", 20n, false],
    ]);
    expect(
      allocations.reduce(
        (total, allocation) => total + allocation.amountMinorUnits,
        0n,
      ),
    ).toBe(100n);
  });

  it("sums to the pool exactly for indivisible splits", () => {
    for (const pool of [1n, 2n, 7n, 100n, 999_983n, 1_000_000n]) {
      const allocations = allocateByWeight(
        pool,
        candidatesFor([
          { login: "ada", mergedPullRequests: 5, substantiveReviews: 1 },
          { login: "bo", mergedPullRequests: 3 },
          { login: "cy", mergedPullRequests: 2, substantiveReviews: 7 },
          { login: "dee", substantiveReviews: 1 },
        ]),
      );
      expect(
        allocations.reduce(
          (total, allocation) => total + allocation.amountMinorUnits,
          0n,
        ),
      ).toBe(pool);
    }
  });

  it("never awards a contributor more than one minor unit above their exact share", () => {
    const candidates = candidatesFor([
      { login: "ada", mergedPullRequests: 5, substantiveReviews: 3 },
      { login: "bo", mergedPullRequests: 1 },
      { login: "cy", mergedPullRequests: 2, substantiveReviews: 10 },
      { login: "dee", substantiveReviews: 1 },
      { login: "eve", mergedPullRequests: 4 },
    ]);
    const totalWeight = candidates.reduce(
      (total, candidate) => total + candidate.weight,
      0n,
    );
    for (const pool of [3n, 97n, 1_000n, 1_000_000n, 999_999_937n]) {
      for (const allocation of allocateByWeight(pool, candidates)) {
        const exact = pool * allocation.candidate.weight;
        expect(
          allocation.amountMinorUnits * totalWeight <= exact + totalWeight,
        ).toBe(true);
        expect(allocation.amountMinorUnits >= allocation.floorMinorUnits).toBe(
          true,
        );
      }
    }
  });

  it("refuses a pool or candidate set it cannot split", () => {
    const candidates = candidatesFor([{ login: "ada", mergedPullRequests: 1 }]);
    expect(() => allocateByWeight(0n, candidates)).toThrow(/greater than zero/);
    expect(() => allocateByWeight(-1n, candidates)).toThrow(
      /greater than zero/,
    );
    expect(() => allocateByWeight(100n, [])).toThrow(
      /at least one eligible contributor/,
    );
    expect(() =>
      allocateByWeight(100n, [{ entry: candidates[0].entry, weight: 0n }]),
    ).toThrow(/no distribution weight/);
  });
});

describe("payout plan", () => {
  it("allocates proportionally and records every input", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 5 },
      { login: "bo", mergedPullRequests: 3 },
      { login: "cy", mergedPullRequests: 2 },
    ]);
    const payoutPlan = plan(snapshot, { pool: "10000" });

    expect(payoutPlan.status).toBe("dry-run");
    expect(payoutPlan.movesMoney).toBe(false);
    expect(payoutPlan.determinesPayouts).toBe(false);
    expect(payoutPlan.rule.model).toBe("proportional-by-points-v1");
    expect(payoutPlan.rule.status).toBe("unapproved-planning-parameter");
    expect(payoutPlan.rule.inputs).toMatchObject({
      pool: "10000.00",
      poolMinorUnits: "1000000",
      currency: "USD",
      minorUnitScale: 2,
      minimumPoints: 0,
    });
    expect(payoutPlan.rule.rounding.mode).toBe("floor-then-largest-remainder");
    expect(payoutPlan.snapshot.digest).toBe(SNAPSHOT_DIGEST);
    expect(payoutPlan.snapshot.ruleVersion).toBe(SCORE_RULE_VERSION);
    expect(payoutPlan.snapshot.ledgerPointTotal).toBe(76);
    expect(
      payoutPlan.allocations.map((allocation) => [
        allocation.contributor.githubLogin,
        allocation.allocation.amount,
      ]),
    ).toEqual([
      ["ada", "4473.68"],
      ["bo", "3157.90"],
      ["cy", "2368.42"],
    ]);
    expect(payoutPlan.totals.allocated).toBe("10000.00");
    expect(payoutPlan.totals.unallocatedMinorUnits).toBe("0");
    expect(totalAllocated(payoutPlan)).toBe(1_000_000n);
  });

  it("keeps per-repository ledger provenance for each allocation", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 2, substantiveReviews: 4 },
    ]);
    const [allocation] = plan(snapshot).allocations;
    expect(allocation.points).toMatchObject({
      total: 30,
      mergedPullRequests: 18,
      substantiveReviews: 12,
    });
    expect(allocation.ledger.eventCount).toBe(6);
    expect(allocation.ledger.byRepository).toEqual([
      { repository: "elizaOS/eliza", points: 30, events: 6 },
    ]);
  });

  it("leaves every Eliza Cloud account linkage explicitly unresolved", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 2 },
      { login: "bo", mergedPullRequests: 1 },
    ]);
    const payoutPlan = plan(snapshot);
    expect(payoutPlan.accountLinkage).toMatchObject({
      provider: "eliza-cloud",
      status: ACCOUNT_LINKAGE_STATUS,
      mappingSource: "none",
      linkedAccounts: 0,
      unlinkedAccounts: 2,
    });
    expect(payoutPlan.executionBlockers).toContain(
      "eliza-cloud-account-linkage-unresolved",
    );
    for (const allocation of payoutPlan.allocations) {
      expect(allocation.payee).toEqual({
        provider: "eliza-cloud",
        accountId: null,
        linkageStatus: "unresolved",
        linkedAt: null,
      });
      expect(allocation.contributor.githubActorId).toMatch(/^U_plan_/);
      expect(allocation.contributor.githubLogin.length).toBeGreaterThan(0);
    }
  });

  it("distributes the remainder so allocations sum to the pool exactly", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 1 },
      { login: "bo", mergedPullRequests: 1 },
      { login: "cy", mergedPullRequests: 1 },
    ]);
    const payoutPlan = plan(snapshot, { pool: "1.00" });
    expect(
      payoutPlan.allocations.map((allocation) => [
        allocation.contributor.githubLogin,
        allocation.allocation.amount,
        allocation.allocation.remainderUnitAwarded,
      ]),
    ).toEqual([
      ["ada", "0.34", true],
      ["bo", "0.33", false],
      ["cy", "0.33", false],
    ]);
    expect(payoutPlan.totals.remainderUnitsDistributed).toBe(1);
    expect(totalAllocated(payoutPlan)).toBe(100n);
  });

  it("reports contributors a small pool rounds down to nothing", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 1 },
      { login: "bo", mergedPullRequests: 1 },
      { login: "cy", mergedPullRequests: 4 },
    ]);
    const payoutPlan = plan(snapshot, { pool: "0.02" });
    expect(
      payoutPlan.allocations.map(
        (allocation) => allocation.allocation.amountMinorUnits,
      ),
    ).toEqual(["1", "1", "0"]);
    expect(payoutPlan.totals.zeroAllocationContributors).toBe(1);
    expect(totalAllocated(payoutPlan)).toBe(2n);
    expect(formatPayoutPlanSummary(payoutPlan)).toContain(
      "1 eligible contributor(s) allocate zero cents",
    );
  });

  it("orders allocations canonically rather than by published rank", () => {
    const snapshot = planningSnapshot([
      { login: "zeta", mergedPullRequests: 5 },
      { login: "ada", mergedPullRequests: 1 },
    ]);
    const proportional = plan(snapshot);
    expect(
      proportional.allocations.map(
        (allocation) => allocation.contributor.githubLogin,
      ),
    ).toEqual(["zeta", "ada"]);

    const equal = plan(snapshot, { model: "equal-share-v1", pool: "10" });
    expect(
      equal.allocations.map((allocation) => [
        allocation.contributor.githubLogin,
        allocation.contributor.snapshotRank,
        allocation.allocation.amount,
      ]),
    ).toEqual([
      ["ada", 2, "5.00"],
      ["zeta", 1, "5.00"],
    ]);
  });

  it("produces byte-identical plans regardless of ledger input order", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 5, substantiveReviews: 2 },
      { login: "bo", mergedPullRequests: 3 },
      { login: "cy", mergedPullRequests: 2, substantiveReviews: 9 },
    ]);
    const shuffled = structuredClone(snapshot);
    shuffled.ledger = [...shuffled.ledger].reverse();

    const first = plan(snapshot, { pool: "10000" });
    const second = plan(shuffled, { pool: "10000" });
    expect(second.planId).toBe(first.planId);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.planId).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes the plan identity when a recorded input changes", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 5 },
      { login: "bo", mergedPullRequests: 1 },
    ]);
    const base = plan(snapshot, { pool: "10000" });
    expect(plan(snapshot, { pool: "9000" }).planId).not.toBe(base.planId);
    expect(
      plan(snapshot, { pool: "10000", model: "equal-share-v1" }).planId,
    ).not.toBe(base.planId);
  });

  it("applies the eligibility minimum recorded in the plan", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 5 },
      { login: "bo", substantiveReviews: 1 },
    ]);
    const payoutPlan = plan(snapshot, { minimumPoints: 10 });
    expect(payoutPlan.eligibility).toMatchObject({
      actorRequirement: ELIGIBLE_ACTOR_REQUIREMENT,
      minimumPoints: 10,
      snapshotLeaders: 2,
      eligibleContributors: 1,
      excludedContributors: 1,
    });
    expect(payoutPlan.allocations).toHaveLength(1);
    expect(payoutPlan.allocations[0].contributor.githubLogin).toBe("ada");
    expect(totalAllocated(payoutPlan)).toBe(100_000n);
  });

  it("plans in the minor units of the selected currency", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 2 },
      { login: "bo", mergedPullRequests: 1 },
    ]);
    const payoutPlan = plan(snapshot, { currency: "USDC", pool: "10000" });
    expect(payoutPlan.rule.inputs.poolMinorUnits).toBe("10000000000");
    expect(payoutPlan.allocations[0].allocation.amount).toBe("6428.571429");
    expect(totalAllocated(payoutPlan)).toBe(10_000_000_000n);
  });
});

describe("refusals", () => {
  it("refuses a stale snapshot", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 1 },
    ]);
    expect(() =>
      plan(
        snapshot,
        {},
        planTime(snapshot, (MAX_SNAPSHOT_AGE_HOURS + 1) * HOUR_MS),
      ),
    ).toThrow(/stale snapshot/);
    expect(() =>
      plan(snapshot, {}, planTime(snapshot, MAX_SNAPSHOT_AGE_HOURS * HOUR_MS)),
    ).not.toThrow();
  });

  it("refuses a wrong-schema or malformed snapshot", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 1 },
    ]);
    const wrongSchema = structuredClone(snapshot);
    (wrongSchema as { schemaVersion: string }).schemaVersion = "1";
    expect(() => plan(wrongSchema)).toThrow(/published leaderboard contract/);

    const brokenLedger = structuredClone(snapshot);
    brokenLedger.leaders[0].score = 99;
    expect(() => plan(brokenLedger)).toThrow(/published leaderboard contract/);

    expect(() =>
      createPayoutPlan({
        snapshot: { leaders: [] },
        source: { path: "x.json", digest: SNAPSHOT_DIGEST },
        rule: {
          model: "proportional-by-points-v1",
          pool: "100",
          currency: "USD",
          minimumPoints: 0,
        },
        now: Date.now(),
      }),
    ).toThrow(/published leaderboard contract/);
  });

  it("refuses an empty eligible set instead of emitting a zero plan", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 1 },
      { login: "bo", substantiveReviews: 1 },
    ]);
    expect(() => plan(snapshot, { minimumPoints: 500 })).toThrow(
      /refusing to emit an empty plan/,
    );
  });

  it("refuses a snapshot whose leaders include a bot", () => {
    const snapshot = planningSnapshot([
      { login: "dependabot[bot]", kind: "Bot", mergedPullRequests: 4 },
      { login: "ada", mergedPullRequests: 1 },
    ]);
    expect(() => plan(snapshot, { pool: "10000" })).toThrow(
      /include the bot dependabot\[bot\] \(actor kind Bot, rank 1, 29 points\)/,
    );

    const disguised = planningSnapshot([
      { login: "release-bot", kind: "User", mergedPullRequests: 4 },
      { login: "ada", mergedPullRequests: 1 },
    ]);
    expect(() => plan(disguised, { pool: "10000" })).toThrow(
      /include the bot release-bot/,
    );
  });

  it("refuses a snapshot whose leaders include a non-user actor", () => {
    for (const kind of ["Organization", "Mannequin", "Unknown"] as const) {
      const snapshot = planningSnapshot([
        { login: "ada", mergedPullRequests: 5 },
        { login: "acme-labs", kind, mergedPullRequests: 1 },
      ]);
      expect(() => plan(snapshot, { pool: "10000" })).toThrow(
        new RegExp(
          `acme-labs with GitHub actor kind ${kind} \\(rank 2, 10 points\\): only a User account can hold a pool share`,
        ),
      );
    }
  });

  it("refuses a zero pool, an unknown model, and an unknown currency", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 1 },
    ]);
    expect(() => plan(snapshot, { pool: "0" })).toThrow(/zero pool/);
    expect(() =>
      plan(snapshot, {
        model: "whatever-v9" as unknown as DistributionModelId,
      }),
    ).toThrow(/unknown distribution model/);
    expect(() =>
      plan(snapshot, { currency: "GBP" as unknown as PayoutCurrencyCode }),
    ).toThrow(/unknown payout currency/);
    expect(() => plan(snapshot, { minimumPoints: -1 })).toThrow(
      /non-negative integer/,
    );
  });

  it("refuses a plan that cannot cite its source", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 1 },
    ]);
    expect(() =>
      createPayoutPlan({
        snapshot,
        source: {
          path: "public/data/leaderboard.json",
          digest: "not-a-digest",
        },
        rule: {
          model: "proportional-by-points-v1",
          pool: "100",
          currency: "USD",
          minimumPoints: 0,
        },
        now: planTime(snapshot),
      }),
    ).toThrow(/sha256 digest/);
  });
});

describe("command line", () => {
  it("parses options and defaults", () => {
    expect(
      parsePayoutPlanArguments([
        "--pool",
        "10000",
        "--model",
        "proportional-by-points-v1",
      ]),
    ).toMatchObject({
      pool: "10000",
      currency: "USD",
      model: "proportional-by-points-v1",
      minimumPoints: 0,
      outputPath: null,
    });
    expect(
      parsePayoutPlanArguments([
        "--pool",
        "10000",
        "--currency",
        "USDC",
        "--model",
        "equal-share-v1",
        "--minimum-points",
        "10",
      ]),
    ).toMatchObject({
      currency: "USDC",
      model: "equal-share-v1",
      minimumPoints: 10,
    });
  });

  it("never assumes a pool or a distribution model", () => {
    expect(() => parsePayoutPlanArguments([])).toThrow(/--pool <amount>/);
    expect(() => parsePayoutPlanArguments(["--pool", "10000"])).toThrow(
      /--model <id> is required; the planner never assumes a distribution model/,
    );
    expect(() => parsePayoutPlanArguments(["--pool", "10000"])).toThrow(
      /no model is an approved payout rule/,
    );
  });

  it("rejects missing, unknown, and malformed arguments", () => {
    expect(() => parsePayoutPlanArguments(["--pool"])).toThrow(
      /--pool requires a value/,
    );
    expect(() =>
      parsePayoutPlanArguments([
        "--pool",
        "1",
        "--model",
        "equal-share-v1",
        "--nope",
      ]),
    ).toThrow(/unknown argument --nope/);
    expect(() => parsePayoutPlanArguments(["--pool", "1", "--model"])).toThrow(
      /--model requires a value/,
    );
    expect(() =>
      parsePayoutPlanArguments([
        "--pool",
        "1",
        "--model",
        "equal-share-v1",
        "--minimum-points",
        "-3",
      ]),
    ).toThrow(/non-negative integer/);
    expect(() =>
      parsePayoutPlanArguments(["--pool", "1", "--model", "nope"]),
    ).toThrow(/unknown distribution model/);
  });

  it("never writes a plan into the published site directory", () => {
    expect(() =>
      assertOperatorOutputPath(
        join(PUBLISHED_SITE_DIRECTORY, "data/plan.json"),
      ),
    ).toThrow(/never be written into the published site directory/);
    expect(() => assertOperatorOutputPath(PUBLISHED_SITE_DIRECTORY)).toThrow(
      /never be written into the published site directory/,
    );
  });

  it("never writes a plan anywhere this public repository tracks", () => {
    for (const trackedPath of [
      join(REPOSITORY_ROOT, "draft.json"),
      join(REPOSITORY_ROOT, "scripts/draft.json"),
      join(OPERATOR_PLAN_DIRECTORY, "..", "planned.json"),
      REPOSITORY_ROOT,
    ]) {
      expect(() => assertOperatorOutputPath(trackedPath)).toThrow(
        /write it outside the working tree, or under the Git-ignored plans\/ directory/,
      );
    }
    expect(
      assertOperatorOutputPath(join(OPERATOR_PLAN_DIRECTORY, "d.json")),
    ).toBe(join(OPERATOR_PLAN_DIRECTORY, "d.json"));
    expect(assertOperatorOutputPath(join(tmpdir(), "d.json"))).toBe(
      resolve(join(tmpdir(), "d.json")),
    );
  });

  it("runs end to end through injected dependencies and writes the plan", async () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 5 },
      { login: "bo", mergedPullRequests: 3 },
    ]);
    const directory = await mkdtemp(join(tmpdir(), "gitarmy-payout-"));
    const outputPath = join(directory, "nested", "plan.json");
    try {
      const source: SnapshotSource = {
        path: "public/data/leaderboard.json",
        digest: SNAPSHOT_DIGEST,
        snapshot,
      };
      const payoutPlan = await runPayoutPlanner(
        [
          "--pool",
          "10000",
          "--model",
          "proportional-by-points-v1",
          "--out",
          outputPath,
        ],
        {
          readSource: async () => source,
          write: writePlanAtomically,
          now: () => planTime(snapshot),
        },
      );
      expect(payoutPlan.allocations).toHaveLength(2);
      expect(totalAllocated(payoutPlan)).toBe(1_000_000n);

      const written = JSON.parse(
        await readFile(outputPath, "utf8"),
      ) as PayoutPlan;
      expect(written.planId).toBe(payoutPlan.planId);
      expect(written.movesMoney).toBe(false);
      expect((await readFile(outputPath, "utf8")).endsWith("}\n")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails the run rather than planning from a stale snapshot", async () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 1 },
    ]);
    await expect(
      runPayoutPlanner(["--pool", "10000", "--model", "equal-share-v1"], {
        readSource: async () => ({
          path: "public/data/leaderboard.json",
          digest: SNAPSHOT_DIGEST,
          snapshot,
        }),
        write: async () => {
          throw new Error("a refused plan must never be written");
        },
        now: () => planTime(snapshot, 9 * HOUR_MS),
      }),
    ).rejects.toThrow(/stale snapshot/);
  });
});

describe("readable summary", () => {
  it("states the dry run, the pool, and the unresolved payees", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 5 },
      { login: "bo", mergedPullRequests: 3 },
      { login: "cy", mergedPullRequests: 2 },
    ]);
    const summary = formatPayoutPlanSummary(plan(snapshot, { pool: "10000" }));
    expect(summary).toContain("DRY RUN, moves no money");
    expect(summary).toContain("does not determine payouts");
    expect(summary).toContain("proportional-by-points-v1");
    expect(summary).toContain("10000.00 USD");
    expect(summary).toContain("0 linked Eliza Cloud accounts, 3 unresolved");
    expect(summary).toContain(ELIGIBLE_ACTOR_REQUIREMENT);
    expect(summary).toContain("eliza-cloud-account-linkage-unresolved");
    expect(summary).toMatch(/ada .* 44\.73% .*4473\.68/);
    expect(summary).toMatch(/eligible total .*76 .*100\.00% .*10000\.00/);
  });

  it("totals only the contributors the plan allocates to", () => {
    const snapshot = planningSnapshot([
      { login: "ada", mergedPullRequests: 5 },
      { login: "bo", substantiveReviews: 1 },
    ]);
    const summary = formatPayoutPlanSummary(
      plan(snapshot, { pool: "10000", minimumPoints: 10 }),
    );
    expect(summary).toContain(
      "1 of 2 scoring contributors (minimum 10 points)",
    );
    expect(summary).toMatch(/eligible total .*34 .*100\.00% .*10000\.00/);
    expect(summary).not.toContain("bo ");
  });
});
