import { expect, test } from "bun:test";
import {
  appendPointAwards,
  emptyPointsJournal,
  pointKey,
} from "../src/lib/points";
import type { PointsImplementationCorrectionManifest } from "../src/lib/points-implementation-corrections";
import {
  assertCorrectionPublication,
  correctionBatchRecorded,
  correctionEligibility,
  correctionScopes,
  readCorrectionEligibility,
  recordCorrection,
} from "./prepare-implementation-corrections";

function manifest(
  periods = ["2026-09", "2026-10", "2026-10"],
): PointsImplementationCorrectionManifest {
  return {
    schemaVersion: "1",
    rule: "historical-implementation-allocation-v1",
    generatedAt: "2026-11-13T00:00:00.000Z",
    baseline: { revisionCount: 0, revisionIdsDigest: "a".repeat(64) },
    candidates: periods.map((period, index) => ({
      id: `candidate_${index}`,
      projectId: "eliza",
      kind: "pull-request",
      occurredAt: `${period}-01T00:00:00.000Z`,
      sourceId: `source_${index}`,
      sourceUrl: `https://github.com/elizaOS/eliza/pull/${index + 1}`,
      workUnitId: `work_${index}`,
      sourceIds: [`source_${index}`],
      expectedPredecessors: [],
      proof: { status: "held" },
    })),
  };
}
const row = (period: string, protectedValue: number | boolean = 0) => ({
  project_id: "eliza",
  period,
  protected: protectedValue,
});
const response = (rows: unknown[]) => [{ success: true, results: rows }];

test("private preflight maps each pool from an exact project-period row", () => {
  const input = manifest();
  expect(correctionScopes(input)).toEqual([
    { projectId: "eliza", period: "2026-09" },
    { projectId: "eliza", period: "2026-10" },
  ]);
  expect(
    correctionEligibility(input, response([row("2026-10", 1), row("2026-09")])),
  ).toEqual([
    { candidateId: "candidate_0", eligible: true },
    { candidateId: "candidate_1", eligible: false },
    { candidateId: "candidate_2", eligible: false },
  ]);
});

test("missing, duplicate, extra, failed and malformed private rows refuse", () => {
  const input = manifest();
  for (const invalid of [
    null,
    [],
    response([row("2026-09")]),
    response([row("2026-09"), row("2026-10"), row("2026-10")]),
    response([row("2026-09"), row("2026-10"), row("2026-11")]),
    response([row("2026-09"), row("2026-10", true)]),
    response([row("2026-09"), row("2026-10", 2)]),
    [{ success: false, results: [row("2026-09"), row("2026-10")] }],
    [{ results: [row("2026-09"), row("2026-10")] }],
  ])
    expect(() => correctionEligibility(input, invalid)).toThrow();
});

test("batched preflight retains complete coverage and propagates failures", async () => {
  const periods = Array.from(
    { length: 201 },
    (_, index) =>
      `${2000 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
  );
  const input = manifest(periods);
  let calls = 0;
  const eligibility = await readCorrectionEligibility(input, async (sql) => {
    const batch = periods.slice(calls * 100, (calls + 1) * 100);
    calls++;
    for (const period of batch) expect(sql).toContain(`'${period}'`);
    return response(batch.map((period) => row(period)));
  });
  expect(calls).toBe(3);
  expect(eligibility).toHaveLength(201);
  expect(eligibility.every((entry) => entry.eligible)).toBe(true);
  await expect(
    readCorrectionEligibility(input, async () => {
      throw new Error("unavailable");
    }),
  ).rejects.toThrow("unavailable");
  await expect(
    readCorrectionEligibility(input, async () => response([])),
  ).rejects.toThrow("Missing");
});

test("public verification requires every exact correction and retained coverage", () => {
  const at = "2026-11-13T00:00:00.000Z";
  const before = emptyPointsJournal(at);
  const expected = appendPointAwards(
    before,
    [
      {
        key: pointKey(
          "eliza",
          "actor_1234",
          "merged-pull-request",
          "source_1234",
        ),
        actor: { id: "actor_1234", login: "contributor" },
        projectId: "eliza",
        category: "merged-pull-request",
        amount: 10,
        occurredAt: "2026-01-01T00:00:00.000Z",
        sourceId: "source_1234",
        sourceUrl: "https://github.com/elizaOS/eliza/pull/1",
        workUnitId: "wu_eliza_pr_1",
        provisional: false,
      },
    ],
    "a".repeat(64),
    "slop-score-v2",
    at,
  );
  expect(() => assertCorrectionPublication(expected, before)).toThrow("prefix");
  expect(() =>
    assertCorrectionPublication(expected, structuredClone(expected)),
  ).not.toThrow();
  const diverged = structuredClone(expected);
  diverged.revisions[0].award.amount++;
  expect(() => assertCorrectionPublication(expected, diverged)).toThrow();
  const newer = { ...expected, generatedAt: "2026-11-14T00:00:00.000Z" };
  expect(() => assertCorrectionPublication(expected, newer)).not.toThrow();
});

test("a D1 receipt must bind the exact digest, revision count and emptied staging", () => {
  const batch = "a".repeat(64);
  const receipt = { digest: batch, revision_count: 123, staged: 0 };
  expect(correctionBatchRecorded(response([]), batch, 123)).toBe(false);
  expect(correctionBatchRecorded(response([receipt]), batch, 123)).toBe(true);
  for (const invalid of [
    response([{ ...receipt, digest: "b".repeat(64) }]),
    response([{ ...receipt, revision_count: 122 }]),
    response([{ ...receipt, staged: 1 }]),
    response([receipt, receipt]),
    [{ success: false, results: [] }],
  ])
    expect(() => correctionBatchRecorded(invalid, batch, 123)).toThrow();
});

test("an import timeout after commit is reconciled without a second mutation", async () => {
  const expected = emptyPointsJournal("2026-11-13T00:00:00.000Z");
  let committed = false;
  let writes = 0;
  await recordCorrection(expected, {
    verifyMain: async () => {},
    importBatch: async () => {
      writes++;
      committed = true;
      throw new Error("timeout");
    },
    batchRecorded: async () => committed,
    loadPublic: async () => expected,
    wait: async () => {},
  });
  expect(writes).toBe(1);
});

test("Pages-only matching data never establishes a D1 import", async () => {
  const expected = emptyPointsJournal("2026-11-13T00:00:00.000Z");
  let writes = 0;
  let publicReads = 0;
  await expect(
    recordCorrection(expected, {
      verifyMain: async () => {},
      importBatch: async () => {
        writes++;
        throw new Error("financial guard refused");
      },
      batchRecorded: async () => false,
      loadPublic: async () => {
        publicReads++;
        return expected;
      },
      wait: async () => {},
    }),
  ).rejects.toThrow("not verified");
  expect(writes).toBe(3);
  expect(publicReads).toBe(0);
});

test("a changed main head refuses the next write but permits recorded reconciliation", async () => {
  const expected = emptyPointsJournal("2026-11-13T00:00:00.000Z");
  let writes = 0;
  const io = {
    verifyMain: async () => {
      throw new Error("superseded");
    },
    importBatch: async () => {
      writes++;
    },
    batchRecorded: async () => false,
    loadPublic: async () => expected,
    wait: async () => {},
  };
  await expect(recordCorrection(expected, io)).rejects.toThrow("superseded");
  expect(writes).toBe(0);
  await expect(
    recordCorrection(expected, { ...io, batchRecorded: async () => true }),
  ).resolves.toBeUndefined();
  expect(writes).toBe(0);
});
