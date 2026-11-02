import { describe, expect, test } from "bun:test";

import type {
  LeaderboardSnapshot,
  ModelAttribution,
  ScoreEvent,
} from "../src/lib/leaderboard-types";
import { summarizeModelOutcomes } from "../src/lib/model-outcomes";

function actor(id: string): ScoreEvent["actor"] {
  return {
    id,
    login: `user-${id}`,
    avatarUrl: "https://example.test/a.png",
    url: `https://github.com/user-${id}`,
    kind: "User",
  };
}

function mergedPullRequestEvent(id: string, sourceId: string, actorId: string) {
  return {
    id,
    actor: actor(actorId),
    category: "merged-pull-request",
    points: 1,
    scoreThirds: 3,
    occurredAt: "2026-10-01T00:00:00.000Z",
    repository: "repo-1",
    source: {
      id: sourceId,
      kind: "pull-request",
      number: 1,
      title: "Joint change",
      url: `https://github.com/org/repo/pull/${sourceId}`,
    },
    reason: "merged",
  } as unknown as ScoreEvent;
}

function attribution(
  id: string,
  artifactId: string,
  actorId: string,
): ModelAttribution {
  return {
    id,
    sourceId: artifactId,
    sourceUrl: `https://github.com/org/repo/pull/${artifactId}`,
    artifactId,
    actor: actor(actorId),
    provider: "openai",
    model: "gpt-5.6",
    identifier: "openai/gpt-5.6",
    client: null,
    skillRevision: null,
    run: null,
    format: "visible-declaration",
    status: "self-reported",
  };
}

describe("summarizeModelOutcomes top-contributor share with joint pull requests", () => {
  // A joint merge emits one merged-pull-request event per commit author, all
  // sharing the same source id. The published outcome count dedupes them to one
  // merged PR, so the busiest contributor contributed to 100% of the model's
  // one and only accepted outcome.
  test("a single joint PR is one accepted outcome, not two", () => {
    const snapshot: Pick<LeaderboardSnapshot, "attributions" | "ledger"> = {
      attributions: [
        attribution("att-alice", "PR1", "alice"),
        attribution("att-bob", "PR1", "bob"),
      ],
      ledger: [
        mergedPullRequestEvent("ev-alice", "PR1", "alice"),
        mergedPullRequestEvent("ev-bob", "PR1", "bob"),
      ],
    };

    const summary = summarizeModelOutcomes(snapshot);
    const row = summary.models.find((model) => model.key === "openai/gpt-5.6");
    expect(row).toBeDefined();
    expect(row?.mergedPullRequests).toBe(1);
    expect(row?.topContributorOutcomes).toBe(1);
    // One outcome, one busiest contributor who touched it: the share is 100%.
    expect(row?.topContributorShare).toBe(1);
  });

  test("distinct solo PRs still divide the share across contributors", () => {
    const snapshot: Pick<LeaderboardSnapshot, "attributions" | "ledger"> = {
      attributions: [
        attribution("att-1", "PR1", "alice"),
        attribution("att-2", "PR2", "alice"),
        attribution("att-3", "PR3", "bob"),
      ],
      ledger: [
        mergedPullRequestEvent("ev-1", "PR1", "alice"),
        mergedPullRequestEvent("ev-2", "PR2", "alice"),
        mergedPullRequestEvent("ev-3", "PR3", "bob"),
      ],
    };

    const row = summarizeModelOutcomes(snapshot).models.find(
      (model) => model.key === "openai/gpt-5.6",
    );
    expect(row?.mergedPullRequests).toBe(3);
    expect(row?.topContributorOutcomes).toBe(2);
    // Alice holds two of the model's three outcomes.
    expect(row?.topContributorShare).toBe(2 / 3);
  });
});
