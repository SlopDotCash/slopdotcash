/** Generated Quint traces exercise the actual integer allocation implementation. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  allocateIntegerTotal,
  type ProjectContributor,
} from "../src/lib/project-view";
import { allocatePullRequestReviewCredit } from "../src/lib/scoring-policy";
import { consumeBuckets, sumBuckets } from "../src/lib/verified-aggregation";
import {
  type Disclosure,
  verifyDisclosure,
} from "./check-direct-payment-disclosures";
import { runE2ePhase } from "./run-e2e-phase.mjs";

function contributor(id: string, weight: number): ProjectContributor {
  return {
    rank: 0,
    actor: {
      id,
      login: id,
      avatarUrl: `https://github.com/${id}.png`,
      url: `https://github.com/${id}`,
      kind: "User",
    },
    score: weight,
    scoreThirds: weight * 3,
    adjustedWeight: weight,
    computeBonusBasisPoints: 0,
    simulatedMinor: null,
    simulatedDisplayMinor: null,
    points: {
      "merged-pull-request": weight,
      "resolved-issue": 0,
      "material-test-change": 0,
      evidence: 0,
      "substantive-review": 0,
      "evaluated-contribution": 0,
    },
    acceptedOutcomeCount: 1,
    evidenceEventIds: [],
    reportedModels: [],
    usage: {
      reportedTokens: 0,
      relevantTokens: 0,
      creditedTokens: 0,
      ambiguousTokens: 0,
      estimatedCostMicroUsd: "0",
      runCount: 0,
      relevantRunCount: 0,
      confidence: "none",
    },
    capUsage: {
      month: "2026-11",
      mergedPullRequests: { used: 0, cap: null },
      resolvedIssues: { used: 0, cap: 5 },
      materialTestChanges: { used: 0, cap: 5 },
      evidencePoints: { used: 0, cap: 30 },
      substantiveReviews: { used: 0, cap: 10 },
      evaluatedContributions: { used: 0, cap: 3 },
    },
    projectedMinor: null,
    projectedDisplayMinor: null,
    projectedSharePartsPerMillion: null,
    penaltyThirds: 0,
    payoutExclusion: null,
  };
}

test("seeded Quint allocation traces agree with production allocation in either input order", () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-money-model-"));
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "run",
        "formal/models/rewards/monthly_allocation.qnt",
        "--backend=typescript",
        "--seed=20261107",
        "--max-samples=100",
        "--step=allocate",
        "--max-steps=1",
        "--n-traces=100",
        `--out-itf=${join(directory, "allocation-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const paths = readdirSync(directory);
    expect(paths.length).toBe(100);
    for (const file of paths) {
      const trace = JSON.parse(
        readFileSync(join(directory, file), "utf8"),
        (_key, value) =>
          value && typeof value === "object" && "#bigint" in value
            ? BigInt(value["#bigint"])
            : value,
      ) as {
        states: {
          s: {
            total: bigint;
            aWeight: bigint;
            bWeight: bigint;
            a: bigint;
            b: bigint;
          };
        }[];
      };
      const final = trace.states.at(-1)?.s;
      if (!final) throw new Error("Quint omitted final allocation state");
      const input = [
        contributor("a", Number(final.aWeight)),
        contributor("b", Number(final.bWeight)),
      ];
      for (const ordered of [input, [...input].reverse()]) {
        const actual = allocateIntegerTotal(final.total, ordered);
        expect(actual.get("a")).toBe(final.a);
        expect(actual.get("b")).toBe(final.b);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Quint shuffled review traces preserve first-review order, highest band and five-reviewer cap", () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-review-model-"));
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "run",
        "formal/models/rewards/review_credit.qnt",
        "--backend=typescript",
        "--seed=20261107",
        "--max-samples=100",
        "--step=produce",
        "--max-steps=1",
        "--n-traces=100",
        `--out-itf=${join(directory, "review-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const reviews = [
      ["a", 1],
      ["b", 2],
      ["a", 3],
      ["c", 1],
      ["d", 1],
      ["e", 1],
      ["f", 3],
    ].map(([id, thirds], i) => ({
      actor: { id: String(id) },
      reviewId: `review-${i + 1}`,
      submittedAt: `2026-11-01T00:00:0${i + 1}.000Z`,
      thirds: Number(thirds),
    }));
    const paths = readdirSync(directory);
    expect(paths.length).toBe(100);
    for (const file of paths) {
      const trace = JSON.parse(
        readFileSync(join(directory, file), "utf8"),
        (_key, value) =>
          value && typeof value === "object" && "#bigint" in value
            ? Number(value["#bigint"])
            : value,
      ) as {
        states: { s: { order: number[]; pool: number; size: number } }[];
      };
      const final = trace.states.at(-1)?.s;
      if (!final) throw new Error("Quint omitted final review state");
      const input = final.order.map((id) => reviews[id - 1]);
      const result = allocatePullRequestReviewCredit(input, final.size);
      expect(result.credited.map((entry) => entry.actor.id)).toEqual([
        "a",
        "b",
        "c",
        "d",
        "e",
      ]);
      expect(result.poolThirds).toBe(final.pool);
      expect(result.credited[0].source.reviewId).toBe("review-3");
      expect(result.credited[0].repeatedReviewIds).toEqual(["review-1"]);
      expect(result.beyondLimitReviewIds).toEqual(["review-7"]);
      expect(
        result.credited.reduce((sum, row) => sum + row.shareThirds, 0),
      ).toBe(result.poolThirds);
      expect(() =>
        allocatePullRequestReviewCredit([...input, input[0]], final.size),
      ).toThrow("repeated review source");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Quint historical disclosure trace reproduces legacy rounding without asserting verified payment", () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-disclosure-model-"));
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "test",
        "formal/models/payments/historical_disclosure.qnt",
        "--backend=typescript",
        "--seed=20261107",
        "--match=^legacyRoundingDisclosedTest$",
        `--out-itf=${join(directory, "disclosure-{test}-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const trace = JSON.parse(
      readFileSync(join(directory, readdirSync(directory)[0]), "utf8"),
      (_key, value) =>
        value && typeof value === "object" && "#bigint" in value
          ? Number(value["#bigint"])
          : value,
    ) as {
      states: {
        s: { allocated: number; observed: number; verifiedPaid: boolean };
      }[];
    };
    const final = trace.states.at(-1)?.s;
    if (!final) throw new Error("Quint omitted disclosure state");
    const preparation = new TextEncoder().encode(
      JSON.stringify({
        projectId: "fixture",
        cycleId: "2026-10",
        counts: { weight: "2" },
        contributors: [1, 2].map((id) => ({
          actor: { id: `actor-${id}`, login: `actor-${id}` },
          weight: "1",
          wallet: { address: `wallet-${id}` },
        })),
      }),
    );
    const disclosure: Disclosure = {
      schemaVersion: "1",
      kind: "direct-payment-disclosure",
      projectId: "fixture",
      contributionMonth: "2026-10",
      preparation: {
        path: "fixture.json",
        sha256: createHash("sha256").update(preparation).digest("hex"),
        totalWeight: "2",
      },
      reconstructedBasis: {
        capMinor: "3",
        denominatorWeight: "2",
        rounding: "half-up",
        allocatedMinor: String(final.allocated),
        overCapMinor: String(final.allocated - 3),
      },
      totals: {
        rows: 2,
        observedTransfers: 2,
        observedAmountMinor: String(final.observed),
        allocatedMinor: String(final.allocated),
        byState: { "paid-direct": { rows: 2, amountMinor: "4" } },
      },
      rows: [1, 2].map((id) => ({
        actorId: `actor-${id}`,
        login: `actor-${id}`,
        publishedWeight: "1",
        effectiveWeight: "1",
        entitlementMinor: "2",
        wallet: `wallet-${id}`,
        state: "paid-direct",
        observed: {
          signature: `fixture-signature-${id}`,
          slot: id,
          blockTime: "2026-11-01T00:00:00.000Z",
          recipient: `wallet-${id}`,
          amountMinor: "2",
        },
        deltaMinor: "0",
      })),
    };
    expect(final.verifiedPaid).toBe(false);
    expect(verifyDisclosure(disclosure, preparation)).toEqual([]);
    const wrongCap = structuredClone(disclosure);
    wrongCap.reconstructedBasis.overCapMinor = "0";
    expect(verifyDisclosure(wrongCap, preparation)).toContain(
      "reconstructedBasis.overCapMinor does not equal allocated minus the cap",
    );
    const duplicate = structuredClone(disclosure);
    if (!duplicate.rows[1].observed || !duplicate.rows[0].observed)
      throw new Error("Missing fixture transfer");
    duplicate.rows[1].observed.signature = duplicate.rows[0].observed.signature;
    expect(verifyDisclosure(duplicate, preparation)).toContain(
      "signature fixture-signature-1 is used twice",
    );
    const anomaly = structuredClone(disclosure);
    if (!anomaly.rows[0].observed) throw new Error("Missing fixture transfer");
    anomaly.rows[0].observed.recipient = "different-wallet";
    expect(verifyDisclosure(anomaly, preparation).length).toBe(1);
    anomaly.rows[0].walletAnomaly = "Observed external transfer discrepancy";
    expect(verifyDisclosure(anomaly, preparation)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Quint signed bucket traces agree with production sums and ordered consumption", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-bucket-model-"));
  let diagnostic = "";
  try {
    const status = await runE2ePhase({
      label: "bucket-traces",
      command: "node",
      args: [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "run",
        "formal/models/rewards/bucket_aggregation.qnt",
        "--backend=typescript",
        "--seed=20261108",
        "--max-samples=100",
        "--step=produce",
        "--max-steps=1",
        "--n-traces=100",
        `--out-itf=${join(directory, "bucket-{seq}.json")}`,
      ],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 20_000,
      onStdout: () => {},
      onStderr: (text) => {
        diagnostic += text;
      },
    });
    if (status !== 0)
      throw new Error(`Bucket trace generation failed: ${diagnostic}`);
    const paths = readdirSync(directory);
    expect(paths).toHaveLength(100);
    for (const path of paths) {
      const trace = JSON.parse(
        readFileSync(join(directory, path), "utf8"),
        (_key, value) =>
          value && typeof value === "object" && "#bigint" in value
            ? BigInt(value["#bigint"])
            : value,
      ) as { states: { s: Record<string, bigint> }[] };
      const state = trace.states.at(-1)?.s;
      if (!state) throw new Error("Quint omitted final bucket state");
      expect(
        sumBuckets(2, [
          { bucket: Number(state.bucketA), amount: state.entryA },
          { bucket: Number(state.bucketB), amount: state.entryB },
        ]),
      ).toEqual([state.sum0, state.sum1]);
      const consumed = consumeBuckets(
        [state.initial0, state.initial1],
        [
          { bucket: Number(state.requestBucketA), amount: state.requestA },
          { bucket: Number(state.requestBucketB), amount: state.requestB },
        ],
      );
      expect(consumed.applied).toEqual([state.appliedA, state.appliedB]);
      expect(consumed.remaining).toEqual([state.remaining0, state.remaining1]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
