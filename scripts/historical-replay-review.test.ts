import { expect, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import { sha256Hex } from "../src/lib/sha256";
import {
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import type { HistoricalReplayReceipt } from "./historical-replay-qualification";
import {
  readHistoricalReplayReview,
  stageHistoricalReplayReview,
} from "./historical-replay-review";
import { privatePacketStore } from "./private-payout-packet";

function fixture() {
  const objects = new Map<string, Uint8Array>();
  const store = privatePacketStore({
    async check() {},
    async get(_, key) {
      return objects.get(key) ?? null;
    },
    async putExact(_, key, bytes) {
      objects.set(key, bytes);
    },
  });
  const sourceAudit = {
    repository: "elizaOS/eliza",
    repositoryNodeId: "R_project",
    from: "2026-09-27T00:00:00.000Z",
    through: "2026-11-01T00:00:00.000Z",
    sources: [
      {
        id: "PR_source",
        number: 1,
        headSha: "a".repeat(40),
        mergedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
  };
  const valueSnapshot = createLeaderboardSnapshot(
    penaltyScoreInput([], GENERATED_AT),
  );
  const review = {
    sourceAudit,
    valueSnapshot,
    valueKeys: ["b".repeat(64)],
    qualificationSha256: "c".repeat(64),
  };
  const receipt: HistoricalReplayReceipt = {
    schemaVersion: "1",
    projectId: "eliza",
    mode: "assessment-replay",
    status: "requires-value-replay",
    sourceCommit: "d".repeat(40),
    sourceDigest: sha256Hex(JSON.stringify(sourceAudit)),
    sourceCount: 1,
    sourceRepositoryNodeId: sourceAudit.repositoryNodeId,
    sourceFrom: sourceAudit.from,
    sourceThrough: sourceAudit.through,
    expectedPointsDigest: "e".repeat(64),
    baselineRevisionCount: 3,
    registryRevision: 1,
    registryManifestSha256: "e".repeat(64),
    enforcementGeneration: 0,
    jointThrough: 0,
    legacyThrough: 0,
    jointRecords: 0,
    legacyRecords: 0,
    receiptDigest: "e".repeat(64),
    replay: {
      snapshotSha256: sha256Hex(JSON.stringify(valueSnapshot)),
      valueCoverageCount: 1,
      closedUnmergedCoverageCount: 0,
      valueEventCount: 1,
      qualificationSha256: review.qualificationSha256,
    },
  };
  return { objects, store, review, receipt };
}

test("the private replay review preserves exact census, value snapshot and award keys", async () => {
  const { store, review, receipt } = fixture();
  const manifest = await stageHistoricalReplayReview(review, store);
  expect(manifest).not.toContain("PR_source");
  expect(manifest).not.toContain("valueSnapshot");
  expect(await stageHistoricalReplayReview(review, store)).toBe(manifest);
  receipt.replay.privateReviewManifest = manifest;
  const bytes = await readHistoricalReplayReview(receipt, store);
  expect(bytes.toString()).toBe(
    JSON.stringify({
      schemaVersion: "slop-historical-replay-review-v1",
      ...review,
    }),
  );
});

test("absent, incomplete and differently scoped private replay reviews refuse", async () => {
  const { objects, store, review, receipt } = fixture();
  await expect(readHistoricalReplayReview(receipt, store)).rejects.toThrow(
    "no private review manifest",
  );
  receipt.replay.privateReviewManifest = await stageHistoricalReplayReview(
    review,
    store,
  );
  await expect(
    readHistoricalReplayReview({ ...receipt, sourceCount: 2 }, store),
  ).rejects.toThrow("differs");
  await expect(
    readHistoricalReplayReview(
      { ...receipt, replay: { ...receipt.replay, snapshotSha256: null } },
      store,
    ),
  ).rejects.toThrow("differs");
  await expect(
    stageHistoricalReplayReview(review, {
      ...store,
      read: async () => Buffer.alloc(0),
    }),
  ).rejects.toThrow("differs from producer");
  objects.delete("0.gzpart");
  await expect(readHistoricalReplayReview(receipt, store)).rejects.toThrow(
    "absent or changed",
  );
});

test("a qualified empty assessment replay retains the exact source census", async () => {
  const { store, review, receipt } = fixture();
  const emptyReview = { ...review, valueKeys: [], valueSnapshot: null };
  receipt.replay.privateReviewManifest = await stageHistoricalReplayReview(
    emptyReview,
    store,
  );
  receipt.status = "no-scoped-active-assessments";
  receipt.replay.snapshotSha256 = null;
  const bytes = await readHistoricalReplayReview(receipt, store);
  expect(JSON.parse(bytes.toString())).toMatchObject(emptyReview);
});
