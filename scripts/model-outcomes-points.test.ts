import { describe, expect, test } from "bun:test";
import { pointsForScoreEvent, summarizeModelOutcomes } from "../src/lib/model-outcomes";

const actor = {
  id: "MDQ6VXNlcjE=",
  login: "reviewer",
  avatarUrl: "https://example.invalid/avatar",
  url: "https://example.invalid/reviewer",
  kind: "User",
} as const;

function attribution(model: string, sourceId: string, artifactId: string) {
  return {
    id: `attribution-${model}-${sourceId}`,
    sourceId,
    sourceUrl: "https://example.invalid/pr/1",
    artifactId,
    actor,
    provider: model.split("/")[0],
    model: model.split("/")[1],
    identifier: model,
    client: null,
    skillRevision: null,
    run: null,
    format: "visible-declaration",
    status: "self-reported",
  } as const;
}

function mergedEvent(sourceId: string, points: number, scoreThirds?: number) {
  return {
    id: `event-${sourceId}`,
    actor,
    category: "merged-pull-request",
    points,
    ...(scoreThirds === undefined ? {} : { scoreThirds }),
    occurredAt: "2026-10-27T00:00:00.000Z",
    repository: "SlopDotCash/slopdotcash",
    source: {
      id: sourceId,
      kind: "pull-request",
      number: 1,
      title: "Example",
      url: "https://example.invalid/pr/1",
    },
  } as const;
}

describe("pointsForScoreEvent", () => {
  test("a scored event converts at 30 Points per score", () => {
    expect(pointsForScoreEvent({ points: 1, scoreThirds: 3 })).toBe(30);
  });

  test("a legacy event without scoreThirds triples its whole scores", () => {
    expect(pointsForScoreEvent({ points: 2 })).toBe(60);
  });
});

describe("summarizeModelOutcomes points unit", () => {
  test("a merged PR reports Points, not raw score units", () => {
    const summary = summarizeModelOutcomes({
      attributions: [attribution("anthropic/claude-opus-5.5", "PR_1", "PR_1")],
      ledger: [mergedEvent("PR_1", 1, 3)],
    } as never);
    expect(summary.models[0].pullRequestPoints).toBe(30);
    expect(summary.totals.pullRequestPoints).toBe(30);
    expect(summary.totals.pullRequestPointsWithModel).toBe(30);
  });

  test("one outcome shared by two models splits the Points evenly", () => {
    const summary = summarizeModelOutcomes({
      attributions: [
        attribution("anthropic/claude-opus-5.5", "PR_1", "PR_1"),
        attribution("openai/gpt-5", "PR_1", "PR_1"),
      ],
      ledger: [mergedEvent("PR_1", 1, 3)],
    } as never);
    expect(summary.models.map((row) => row.pullRequestPoints).sort()).toEqual([
      15, 15,
    ]);
  });

  test("a review outcome reports its Points too", () => {
    const summary = summarizeModelOutcomes({
      attributions: [attribution("anthropic/claude-opus-5.5", "RV_1", "RV_1")],
      ledger: [
        {
          id: "event-RV_1",
          actor,
          category: "substantive-review",
          points: 1,
          scoreThirds: 3,
          occurredAt: "2026-10-27T00:00:00.000Z",
          repository: "SlopDotCash/slopdotcash",
          source: {
            id: "RV_1",
            kind: "review",
            number: 1,
            title: "Example",
            url: "https://example.invalid/pr/1",
          },
        },
      ],
    } as never);
    expect(summary.models[0].reviewPoints).toBe(30);
  });
});
