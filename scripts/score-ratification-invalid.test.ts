/**
 * An invalid `slop-score` record must not abort whole snapshot generation
 * (PRD section 7: the rolling ledger publishes exact bounds and counts).
 * The bad comment is skipped, recorded on the snapshot, and the pull
 * request keeps its provisional credit; a valid ratification still applies.
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type { GitHubTextSource } from "../src/lib/leaderboard-types";
import {
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

function withComment(body: string) {
  const input = penaltyScoreInput([]);
  setSystemTime(new Date(input.generatedAt));
  const pull = input.mergedPullRequests.find((row) => row.id === "PR_november");
  if (!pull) throw new Error("missing fixture pull request");
  const comment: GitHubTextSource = {
    id: "IC_invalid_ratification",
    artifactId: pull.id,
    kind: "comment",
    body,
    url: `${pull.url}#issuecomment-1`,
    createdAt: "2026-11-06T10:00:00.000Z",
    updatedAt: "2026-11-06T10:00:00.000Z",
    author: PROJECT_OWNER,
    authorAssociation: "MEMBER",
  };
  pull.comments = [comment];
  return input;
}

function ratificationRecord(overrides: Record<string, unknown>) {
  return {
    schemaVersion: "1",
    ruleVersion: "slop-score-v2",
    projectId: "asi",
    pullRequestNodeId: "PR_november",
    headSha: "8".repeat(40),
    workUnitId: "wu_invalid_ratification",
    tier: "micro",
    scoreThirds: 1,
    proposalReviewNodeIds: [],
    coRatifierNodeIds: [],
    reason: "Synthetic ratification for the invalid-record check.",
    supersedes: null,
    ...overrides,
  };
}

function fenced(record: unknown) {
  return `Ratifying.\n\`\`\`slop-score\n${JSON.stringify(record)}\n\`\`\``;
}

test("a malformed slop-score record is skipped, not fatal", () => {
  const snapshot = createLeaderboardSnapshot(
    withComment("Ratifying.\n```slop-score\n{not json\n```"),
  );
  expect(snapshot.invalidScoreRatifications).toEqual([
    {
      sourceId: "IC_invalid_ratification",
      sourceUrl: expect.stringContaining("#issuecomment-1"),
      reason: "slop-score record JSON is malformed",
    },
  ]);
  const event = snapshot.ledger.find(
    (entry) =>
      entry.category === "merged-pull-request" &&
      entry.source.id === "PR_november",
  );
  expect(event?.scoreThirds).toBe(1);
});

test("a tier/scoreThirds mismatch is skipped, not fatal", () => {
  const snapshot = createLeaderboardSnapshot(
    withComment(fenced(ratificationRecord({ tier: "small", scoreThirds: 9 }))),
  );
  expect(snapshot.invalidScoreRatifications).toEqual([
    {
      sourceId: "IC_invalid_ratification",
      sourceUrl: expect.stringContaining("#issuecomment-1"),
      reason: "score record tier and scoreThirds do not match",
    },
  ]);
});

test("a valid micro ratification still applies", () => {
  const snapshot = createLeaderboardSnapshot(
    withComment(fenced(ratificationRecord({}))),
  );
  expect(snapshot.invalidScoreRatifications).toBeUndefined();
  const event = snapshot.ledger.find(
    (entry) =>
      entry.category === "merged-pull-request" &&
      entry.source.id === "PR_november",
  );
  expect(event?.scoreThirds).toBe(1);
  expect(event?.reason).toContain("Maintainer-ratified micro");
});
