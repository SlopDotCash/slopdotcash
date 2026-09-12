import { describe, expect, it } from "vitest";
import { snapshotFixture } from "../../tests/fixtures";
import type {
  GitHubActor,
  ModelAttribution,
  ScoreEvent,
} from "./leaderboard-types";
import { modelIdentityKey, summarizeModelOutcomes } from "./model-outcomes";
import type { ProjectRunReceipt } from "./run-receipts";

const author: GitHubActor = {
  id: "U_author",
  login: "author",
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  url: "https://github.com/author",
  kind: "User",
};

const reviewer: GitHubActor = {
  id: "U_reviewer",
  login: "reviewer",
  avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
  url: "https://github.com/reviewer",
  kind: "User",
};

function mergedPullRequest(
  id: string,
  actor: GitHubActor,
  points: number,
): ScoreEvent {
  return {
    id: `${id}:merged`,
    actor,
    category: "merged-pull-request",
    points,
    occurredAt: "2026-08-20T12:00:00.000Z",
    repository: "elizaOS/eliza",
    source: {
      id,
      kind: "pull-request",
      number: 1,
      title: id,
      url: `https://github.com/elizaOS/eliza/pull/${id}`,
    },
    reason: "Pull request merged during the rolling window.",
  };
}

function acceptedReview(
  id: string,
  actor: GitHubActor,
  points: number,
): ScoreEvent {
  return {
    id: `${id}:review`,
    actor,
    category: "substantive-review",
    points,
    occurredAt: "2026-08-20T12:00:00.000Z",
    repository: "elizaOS/eliza",
    source: {
      id,
      kind: "review",
      number: 1,
      title: id,
      url: `https://github.com/elizaOS/eliza/pull/1#pullrequestreview-${id}`,
    },
    reason: "Substantive review accepted.",
  };
}

function declaration(
  overrides: Partial<ModelAttribution> & {
    sourceId: string;
    artifactId: string;
    actor: GitHubActor;
    provider: string;
    model: string;
  },
): ModelAttribution {
  return {
    id: `${overrides.sourceId}:${overrides.provider}/${overrides.model}`,
    sourceUrl: "https://github.com/elizaOS/eliza/pull/1",
    identifier: `${overrides.provider}/${overrides.model}`,
    client: null,
    skillRevision: null,
    run: null,
    format: "visible-declaration",
    status: "self-reported",
    ...overrides,
  };
}

function signedRun(client: string, outputTokens: number): ProjectRunReceipt {
  return {
    schemaVersion: "2",
    runId: `run_${client}_${outputTokens}`,
    projectId: "eliza",
    repositoryId: "elizaOS/eliza",
    startedAt: "2026-08-20T11:00:00.000Z",
    completedAt: "2026-08-20T11:30:00.000Z",
    provider: "anthropic",
    model: "claude-opus-5",
    client,
    skillRevision: `SlopDotCash/slopdotcash@${"a".repeat(40)}:skills/contribute-to-eliza`,
    skillSha256: "0".repeat(64),
    usage: {
      source: "ccusage-session-v20",
      confidence: "exact",
      inputTokens: 1,
      outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: outputTokens + 1,
      costMicroUsd: "0",
      sessionCount: 1,
    },
    trajectorySha256: null,
    traceUpload: null,
    signatureAlgorithm: "ed25519",
    devicePublicKey: "0".repeat(64),
    deviceKeyId: "0".repeat(64),
    deviceSignature: "0".repeat(128),
  };
}

describe("modelIdentityKey", () => {
  it("folds case, provider aliases, and repeated provider prefixes", () => {
    expect(modelIdentityKey("OpenAI", "GPT-5.6").key).toBe("openai/gpt-5.6");
    expect(modelIdentityKey("openai-codex", "gpt-5").key).toBe("openai/gpt-5");
    expect(modelIdentityKey("z.ai", "glm-5.3").key).toBe("zai/glm-5.3");
    expect(modelIdentityKey("zai", "z-ai/glm-5.3").key).toBe("zai/glm-5.3");
    expect(modelIdentityKey("anthropic", "anthropic/claude-opus-5").key).toBe(
      "anthropic/claude-opus-5",
    );
  });

  it("leaves unknown identifiers exactly as declared apart from case", () => {
    expect(modelIdentityKey("venice", "llama-4-maverick")).toEqual({
      provider: "venice",
      model: "llama-4-maverick",
      key: "venice/llama-4-maverick",
    });
  });
});

describe("summarizeModelOutcomes", () => {
  it("joins outcomes to same-actor declarations on the same source only", () => {
    const summary = summarizeModelOutcomes({
      ledger: [
        mergedPullRequest("PR_1", author, 3),
        mergedPullRequest("PR_2", author, 1),
        mergedPullRequest("PR_3", author, 8),
        acceptedReview("PRR_1", reviewer, 1),
      ],
      attributions: [
        declaration({
          sourceId: "PR_1:body",
          artifactId: "PR_1",
          actor: author,
          provider: "OpenAI",
          model: "gpt-5.6",
        }),
        declaration({
          sourceId: "PR_1:commit",
          artifactId: "PR_1",
          actor: author,
          provider: "openai",
          model: "GPT-5.6",
        }),
        // Declared on PR_2 by someone other than the author: never counts.
        declaration({
          sourceId: "PR_2:comment",
          artifactId: "PR_2",
          actor: reviewer,
          provider: "xai",
          model: "grok-4.6",
        }),
        // Declared on the review by the reviewer: counts for reviews.
        declaration({
          sourceId: "PRR_1",
          artifactId: "PR_3",
          actor: reviewer,
          provider: "xai",
          model: "grok-4.6",
        }),
      ],
    });

    expect(summary.totals).toMatchObject({
      declarations: 4,
      signedDeclarations: 0,
      declaringContributors: 2,
      distinctModels: 2,
      distinctDeclaredIdentifiers: 3,
      mergedPullRequests: 3,
      mergedPullRequestsWithModel: 1,
      mergedPullRequestsWithSignedRun: 0,
      pullRequestPoints: 12,
      pullRequestPointsWithModel: 3,
      acceptedReviews: 1,
      acceptedReviewsWithModel: 1,
    });

    const [gpt, grok] = summary.models;
    expect(gpt).toMatchObject({
      key: "openai/gpt-5.6",
      declarations: 2,
      contributors: 1,
      mergedPullRequests: 1,
      pullRequestPoints: 3,
      acceptedReviews: 0,
      topContributorShare: 1,
    });
    expect(gpt.declaredAs).toEqual([
      { identifier: "openai/GPT-5.6", count: 1 },
      { identifier: "OpenAI/gpt-5.6", count: 1 },
    ]);
    expect(grok).toMatchObject({
      key: "xai/grok-4.6",
      declarations: 2,
      mergedPullRequests: 0,
      acceptedReviews: 1,
      reviewPoints: 1,
    });
  });

  it("splits points evenly when one outcome names several models", () => {
    const summary = summarizeModelOutcomes({
      ledger: [mergedPullRequest("PR_1", author, 3)],
      attributions: [
        declaration({
          sourceId: "PR_1:body",
          artifactId: "PR_1",
          actor: author,
          provider: "openai",
          model: "gpt-5.6",
        }),
        declaration({
          sourceId: "PR_1:commit",
          artifactId: "PR_1",
          actor: author,
          provider: "anthropic",
          model: "claude-opus-5",
        }),
      ],
    });
    expect(summary.totals.mergedPullRequestsWithModel).toBe(1);
    expect(summary.totals.pullRequestPointsWithModel).toBe(3);
    expect(
      summary.models.map((row) => [row.key, row.pullRequestPoints]),
    ).toEqual([
      ["anthropic/claude-opus-5", 1.5],
      ["openai/gpt-5.6", 1.5],
    ]);
  });

  it("derives harness rows and token medians from signed receipts only", () => {
    const summary = summarizeModelOutcomes({
      ledger: [
        mergedPullRequest("PR_1", author, 3),
        mergedPullRequest("PR_2", author, 1),
      ],
      attributions: [
        declaration({
          sourceId: "PR_1:body",
          artifactId: "PR_1",
          actor: author,
          provider: "anthropic",
          model: "claude-opus-5",
          client: "claude-code",
          format: "machine-marker",
          run: signedRun("Claude-Code", 4_000),
        }),
        declaration({
          sourceId: "PR_2:body",
          artifactId: "PR_2",
          actor: author,
          provider: "anthropic",
          model: "claude-opus-5",
          client: "claude-code",
          format: "machine-marker",
          run: signedRun("claude-code", 10_000),
        }),
        declaration({
          sourceId: "PR_2:comment",
          artifactId: "PR_2",
          actor: author,
          provider: "openai",
          model: "gpt-5",
        }),
      ],
    });

    expect(summary.totals).toMatchObject({
      signedDeclarations: 2,
      signedContributors: 1,
      distinctClients: 1,
      mergedPullRequestsWithSignedRun: 2,
    });
    expect(summary.clients).toEqual([
      {
        client: "claude-code",
        signedRuns: 2,
        contributors: 1,
        mergedPullRequests: 2,
        pullRequestPoints: 4,
        models: [{ key: "anthropic/claude-opus-5", count: 2 }],
        medianOutputTokens: 7_000,
        runsWithExactUsage: 2,
      },
    ]);
    const opus = summary.models.find(
      (row) => row.key === "anthropic/claude-opus-5",
    );
    expect(opus).toMatchObject({
      signedDeclarations: 2,
      mergedPullRequests: 2,
      signedPullRequests: 2,
      pullRequestPoints: 3.5,
    });
  });

  it("summarizes the shared snapshot fixture without throwing", () => {
    const summary = summarizeModelOutcomes(snapshotFixture());
    expect(summary.totals.declarations).toBe(
      snapshotFixture().attributions.length,
    );
    expect(summary.models.length).toBeGreaterThan(0);
  });
});
