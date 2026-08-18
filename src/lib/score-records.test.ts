import { describe, expect, it } from "vitest";
import {
  assertScoreRatificationContext,
  parseScoreRatificationBlock,
} from "./score-records";

const record = {
  schemaVersion: "1",
  ruleVersion: "slop-score-v2",
  projectId: "eliza",
  pullRequestNodeId: "PR_kwDOMT5cIg123",
  headSha: "a".repeat(40),
  workUnitId: "wu_eliza_pr_123",
  tier: "large",
  scoreThirds: 24,
  proposalReviewNodeIds: ["IC_kwDOMT5cIg456"],
  coRatifierNodeIds: [],
  reason: "Large cross-package implementation with tests and migration risk.",
  supersedes: null,
};

const context = {
  projectId: "eliza" as const,
  pullRequestNodeId: record.pullRequestNodeId,
  headSha: record.headSha,
  sourceNodeId: "IC_kwDOMT5cIg789",
  authorAssociation: "MEMBER",
  createdAt: "2026-08-18T01:00:00.000Z",
  updatedAt: "2026-08-18T01:00:00.000Z",
};

describe("maintainer score ratification", () => {
  it("parses and binds an immutable maintainer decision to the exact head", () => {
    const parsed = parseScoreRatificationBlock(
      `\`\`\`slop-score\n${JSON.stringify(record)}\n\`\`\``,
    );
    expect(assertScoreRatificationContext(parsed, context)).toEqual(record);
  });

  it("rejects edits, outsiders, and tier inflation", () => {
    expect(() =>
      assertScoreRatificationContext(record, {
        ...context,
        updatedAt: "2026-08-18T01:01:00.000Z",
      }),
    ).toThrow(/edited/u);
    expect(() =>
      assertScoreRatificationContext(record, {
        ...context,
        authorAssociation: "CONTRIBUTOR",
      }),
    ).toThrow(/maintainer/u);
    expect(() =>
      assertScoreRatificationContext({ ...record, scoreThirds: 75 }, context),
    ).toThrow(/do not match/u);
  });
});
