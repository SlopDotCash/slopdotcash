/**
 * Exercises fail-closed GitHub boundaries, low-cost query shapes, adaptive
 * search primitives, and atomic write gating before live data is published.
 */

import { parse } from "graphql";
import { describe, expect, it, vi } from "vitest";
import type {
  GitHubActor,
  LeaderboardSnapshot,
  MergedPullRequestOutcome,
  PullRequestRecord,
} from "../src/lib/leaderboard";
import {
  PRIMARY_REPOSITORY,
  TARGET_REPOSITORIES,
} from "../src/lib/repositories.mjs";
import {
  assertOpenEvidenceReferencesCurrent,
  assertReviewCensusStable,
  collectReviewedPullRequestIds,
  collectSearchReferences,
  deriveCurrentHeadReviewDecision,
  deriveSourceUpdatedAt,
  estimateFirstPageDetailCost,
  estimateReviewFirstPageDetailCost,
  GitHubGraphqlClient,
  type GraphqlExecutor,
  generateLeaderboardFromGitHub,
  LEADERBOARD_QUERY_DOCUMENTS,
  OpenSetChangedError,
  parseGenerationArguments,
  planMergedPullRequestHydration,
  resolveGitHubToken,
  retryOpenBatch,
  retryOpenReferenceListing,
  retrySlopSnapshot,
  runGenerator,
  SEARCH_SAFE_RESULT_LIMIT,
  sameReferenceSet,
  selectDetailedMergedPullRequestIds,
  selectEvaluatedContributionsForWindow,
  verifyPullRequestEvidence,
} from "./generate-leaderboard";

describe("generation arguments", () => {
  it("pins delayed monthly retries to their historical cutoff", () => {
    expect(
      parseGenerationArguments(
        ["--cutoff", "2026-08-01T00:00:00.000Z"],
        new Date("2026-08-20T12:00:00.000Z"),
      ).now?.toISOString(),
    ).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rejects malformed and future cutoffs", () => {
    expect(() => parseGenerationArguments(["--cutoff", "2026-08-01"])).toThrow(
      /exact UTC timestamp/u,
    );
    expect(() =>
      parseGenerationArguments(
        ["--cutoff", "2026-09-01T00:00:00.000Z"],
        new Date("2026-08-20T12:00:00.000Z"),
      ),
    ).toThrow(/future/u);
  });
});

describe("historical evaluator awards", () => {
  it("selects only awards in the cutoff's rolling window", () => {
    const events = [
      {
        category: "evaluated-contribution" as const,
        occurredAt: "2026-06-26T00:00:00.000Z",
        id: "before",
      },
      {
        category: "evaluated-contribution" as const,
        occurredAt: "2026-06-27T00:00:00.000Z",
        id: "first",
      },
      {
        category: "evaluated-contribution" as const,
        occurredAt: "2026-07-31T23:59:59.999Z",
        id: "last",
      },
      {
        category: "evaluated-contribution" as const,
        occurredAt: "2026-08-01T00:00:00.000Z",
        id: "after",
      },
    ];

    expect(
      selectEvaluatedContributionsForWindow(
        events,
        new Date("2026-06-27T00:00:00.000Z"),
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2026-08-20T00:00:00.000Z"),
      ).map((event) => event.id),
    ).toEqual(["first", "last"]);
  });

  it("rejects malformed evaluator timestamps instead of silently dropping them", () => {
    expect(() =>
      selectEvaluatedContributionsForWindow(
        [
          {
            category: "evaluated-contribution" as const,
            occurredAt: "not-a-time",
          },
        ],
        new Date("2026-06-27T00:00:00.000Z"),
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2026-08-20T00:00:00.000Z"),
      ),
    ).toThrow(/exact UTC timestamp/u);
  });

  it("rejects awards beyond actual time instead of hiding them behind a historical cutoff", () => {
    expect(() =>
      selectEvaluatedContributionsForWindow(
        [
          {
            category: "evaluated-contribution" as const,
            occurredAt: "2026-09-01T00:00:00.000Z",
          },
        ],
        new Date("2026-06-27T00:00:00.000Z"),
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2026-08-20T00:00:00.000Z"),
      ),
    ).toThrow(/cannot be in the future/u);
  });
});

function actor(login: string, kind: GitHubActor["kind"] = "User"): GitHubActor {
  return {
    id: `ACTOR_${login}`,
    login,
    avatarUrl: `https://avatars.example/${login}`,
    url: `https://github.com/${login}`,
    kind,
  };
}

function mergedPullRequestWithEvidence(
  body: string,
  overrides: Partial<PullRequestRecord> = {},
): PullRequestRecord {
  const headRefOid = overrides.headRefOid ?? "a".repeat(40);
  return {
    id: "PR_REMOTE_EVIDENCE",
    number: 314,
    title: "Verify remote evidence",
    url: "https://github.com/elizaOS/eliza/pull/314",
    body: `<!-- evidence-head:${headRefOid} -->\n${body}`,
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-30T11:00:00.000Z",
    lastEditedAt: null,
    editor: null,
    mergedAt: "2026-07-30T11:00:00.000Z",
    headRefOid,
    isDraft: false,
    reviewDecision: "APPROVED",
    activeReviewRequestCount: 0,
    author: actor("evidence-author"),
    assignees: [],
    labels: [],
    files: [],
    comments: [],
    reviews: [],
    closingIssueIds: [],
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commitCount: 1,
    ...overrides,
  };
}

function successResponse(
  data: Record<string, unknown> = { viewer: { login: "eliza" } },
  rateLimit: {
    cost: number;
    limit: number;
    remaining: number;
    resetAt: string;
  } = {
    cost: 1,
    limit: 5_000,
    remaining: 4_999,
    resetAt: "2026-07-30T13:00:00.000Z",
  },
): Response {
  return new Response(JSON.stringify({ data: { ...data, rateLimit } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function unusedClient(): GraphqlExecutor {
  return {
    execute: async () => {
      throw new Error("not used");
    },
    getRequestCount: () => 0,
    getRateLimit: () => ({
      cost: 0,
      consumedDuringRun: 0,
      limit: 5_000,
      remaining: 5_000,
      resetAt: "2026-07-30T13:00:00.000Z",
    }),
  };
}

describe("GitHub authentication", () => {
  it("uses GITHUB_TOKEN without invoking the gh fallback", async () => {
    const fallback = vi.fn(async () => "fallback-token");

    await expect(
      resolveGitHubToken({ GITHUB_TOKEN: " environment-token " }, fallback),
    ).resolves.toBe("environment-token");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("fails when the authenticated gh fallback fails", async () => {
    await expect(
      resolveGitHubToken({}, async () => {
        throw new Error("gh is not authenticated");
      }),
    ).rejects.toThrow("gh is not authenticated");
  });
});

describe("remote leaderboard evidence", () => {
  const validLogUrl =
    "https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000001";
  const missingLogUrl =
    "https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000002";
  const logDocument = [
    "2026-07-30T10:00:00.000Z INFO request started method=GET url=/health",
    "2026-07-30T10:00:00.010Z INFO response status=200 duration_ms=10",
    "2026-07-30T10:00:00.020Z INFO request complete request_id=abc123",
  ].join("\n");

  it("accepts a fetched, structurally valid artifact from a stable row", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(logDocument, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    );
    const pullRequest = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nBackend logs: ${validLogUrl}`,
    );

    await expect(
      verifyPullRequestEvidence([pullRequest], {
        evidenceFetch: fetcher,
        evidenceTimeoutMs: 100,
        evidenceToken: "test-token",
      }),
    ).resolves.toMatchObject({
      status: "complete",
      artifacts: [
        expect.objectContaining({
          pullRequestId: pullRequest.id,
          pullRequestHeadOid: pullRequest.headRefOid,
          sourceId: `${pullRequest.id}:body`,
          category: "logs",
          artifactIdentity: validLogUrl,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not verify a valid-shaped URL that returns not found", async () => {
    const fetcher = vi.fn(
      async () => new Response("not found", { status: 404 }),
    );
    const pullRequest = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nBackend logs: ${missingLogUrl}`,
    );

    await expect(
      verifyPullRequestEvidence([pullRequest], {
        evidenceFetch: fetcher,
        evidenceTimeoutMs: 100,
      }),
    ).resolves.toMatchObject({ status: "complete", artifacts: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not fetch or verify forty characters of fenced text", async () => {
    const fetcher = vi.fn(async () => new Response(logDocument));
    const pullRequest = mergedPullRequestWithEvidence(
      [
        "<!-- evidence-row:backend-logs -->",
        "```text",
        "x".repeat(40),
        "```",
      ].join("\n"),
    );

    await expect(
      verifyPullRequestEvidence([pullRequest], {
        evidenceFetch: fetcher,
        evidenceTimeoutMs: 100,
      }),
    ).resolves.toMatchObject({ status: "complete", artifacts: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects the category when one of its artifacts fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === validLogUrl
        ? new Response(logDocument, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          })
        : new Response("not found", { status: 404 }),
    );
    const pullRequest = mergedPullRequestWithEvidence(
      [
        "<!-- evidence-row:backend-logs -->",
        `Backend logs: [primary](${validLogUrl}) [missing](${missingLogUrl})`,
      ].join("\n"),
    );

    await expect(
      verifyPullRequestEvidence([pullRequest], {
        evidenceFetch: fetcher,
        evidenceTimeoutMs: 100,
      }),
    ).resolves.toMatchObject({ status: "complete", artifacts: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("ignores untrusted row URLs without suppressing valid evidence", async () => {
    const abusive = mergedPullRequestWithEvidence(
      [
        "<!-- evidence-row:backend-logs -->",
        Array.from(
          { length: 65 },
          (_, index) => `https://example.com/not-evidence-${index}.log`,
        ).join(" "),
      ].join("\n"),
      { id: "PR_UNTRUSTED_URLS", number: 315 },
    );
    const valid = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nBackend logs: ${validLogUrl}`,
      { id: "PR_VALID_AFTER_ABUSE", number: 316 },
    );
    const fetcher = vi.fn(
      async () =>
        new Response(logDocument, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    );

    await expect(
      verifyPullRequestEvidence([abusive, valid], {
        evidenceFetch: fetcher,
        evidenceTimeoutMs: 100,
      }),
    ).resolves.toMatchObject({
      status: "complete",
      sourceCount: 1,
      artifactCount: 1,
      artifacts: [expect.objectContaining({ pullRequestId: valid.id })],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("suppresses all evidence without fetching when trusted references exceed the snapshot cap", async () => {
    const body = [
      "<!-- evidence-row:backend-logs -->",
      Array.from(
        { length: 65 },
        (_, index) =>
          `https://github.com/user-attachments/assets/00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
      ).join(" "),
    ].join("\n");
    const fetcher = vi.fn(async () => new Response(logDocument));

    await expect(
      verifyPullRequestEvidence([mergedPullRequestWithEvidence(body)], {
        evidenceFetch: fetcher,
      }),
    ).resolves.toMatchObject({
      status: "suppressed-limit",
      sourceCount: 1,
      artifactCount: 65,
      artifacts: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("isolates an over-limit open draft without erasing merged evidence", async () => {
    const abusiveBody = [
      "<!-- evidence-row:backend-logs -->",
      Array.from(
        { length: 65 },
        (_, index) =>
          `https://github.com/user-attachments/assets/10000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
      ).join(" "),
    ].join("\n");
    const abusiveOpenDraft = mergedPullRequestWithEvidence(abusiveBody, {
      id: "PR_ABUSIVE_OPEN_DRAFT",
      number: 317,
      isDraft: true,
      mergedAt: null,
    });
    const validMerged = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nBackend logs: ${validLogUrl}`,
      { id: "PR_VALID_MERGED", number: 318 },
    );
    const fetcher = vi.fn(
      async () =>
        new Response(logDocument, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    );

    await expect(
      verifyPullRequestEvidence([abusiveOpenDraft, validMerged], {
        evidenceFetch: fetcher,
      }),
    ).resolves.toMatchObject({
      status: "suppressed-limit",
      sourceCount: 2,
      artifactCount: 66,
      artifacts: [expect.objectContaining({ pullRequestId: validMerged.id })],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps failures attached to their source after merged-first selection", async () => {
    const invalidOpenUrl =
      "https://github.com/user-attachments/assets/20000000-0000-0000-0000-000000000404";
    const invalidOpen = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nBackend logs: ${invalidOpenUrl}`,
      {
        id: "A_OPEN",
        number: 319,
        isDraft: true,
        mergedAt: null,
      },
    );
    const validMerged = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nBackend logs: ${validLogUrl}`,
      { id: "Z_MERGED", number: 320 },
    );
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input) === validLogUrl
        ? new Response(logDocument, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          })
        : new Response("not found", { status: 404 }),
    );

    await expect(
      verifyPullRequestEvidence([invalidOpen, validMerged], {
        evidenceFetch: fetcher,
      }),
    ).resolves.toMatchObject({
      status: "complete",
      sourceCount: 2,
      artifactCount: 2,
      artifacts: [expect.objectContaining({ pullRequestId: validMerged.id })],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      validLogUrl,
      invalidOpenUrl,
    ]);
  });

  it("allows identical bytes to own only one evidence category", async () => {
    const sharedDocument = JSON.stringify({
      provider: "openai",
      model: "gpt-5",
      input: "Review the contribution evidence for the current pull request.",
      output: "The end-to-end request completed with verified status 200.",
      events: [{ level: "INFO", status: 200 }],
      method: "GET",
      status: 200,
      url: "/health",
    });
    const pullRequest = mergedPullRequestWithEvidence(
      [
        "<!-- evidence-row:backend-logs -->",
        "Logs: https://github.com/user-attachments/assets/10000000-0000-0000-0000-000000000001",
        "<!-- evidence-row:llm-trajectory -->",
        "Trajectory: https://github.com/user-attachments/assets/10000000-0000-0000-0000-000000000002",
        "<!-- evidence-row:domain-artifacts -->",
        "Artifact: https://github.com/user-attachments/assets/10000000-0000-0000-0000-000000000003",
      ].join("\n"),
    );
    const fetcher = vi.fn(
      async () =>
        new Response(sharedDocument, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const result = await verifyPullRequestEvidence([pullRequest], {
      evidenceFetch: fetcher,
      evidenceTimeoutMs: 100,
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].category).toBe("logs");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not reuse one canonical artifact across pull requests", async () => {
    const first = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nLogs: ${validLogUrl}`,
      {
        id: "PR_FIRST_EVIDENCE_OWNER",
        number: 10,
        mergedAt: "2026-07-29T11:00:00.000Z",
      },
    );
    const later = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nLogs: ${validLogUrl}`,
      {
        id: "PR_LATER_EVIDENCE_COPY",
        number: 20,
        mergedAt: "2026-07-30T11:00:00.000Z",
      },
    );
    const fetcher = vi.fn(
      async () =>
        new Response(logDocument, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    );

    const result = await verifyPullRequestEvidence([later, first], {
      evidenceFetch: fetcher,
      evidenceTimeoutMs: 100,
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].pullRequestId).toBe(first.id);
  });

  it("rejects evidence whose marker names an earlier head", async () => {
    const pullRequest = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nLogs: ${validLogUrl}`,
    );
    pullRequest.headRefOid = "b".repeat(40);
    const fetcher = vi.fn(async () => new Response(logDocument));

    await expect(
      verifyPullRequestEvidence([pullRequest], {
        evidenceFetch: fetcher,
      }),
    ).resolves.toMatchObject({
      status: "complete",
      sourceCount: 0,
      artifactCount: 0,
      artifacts: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects padded trajectory fields and a non-concrete model", async () => {
    const trajectoryUrl =
      "https://github.com/user-attachments/assets/20000000-0000-0000-0000-000000000001";
    const pullRequest = mergedPullRequestWithEvidence(
      `<!-- evidence-row:llm-trajectory -->\nTrajectory: ${trajectoryUrl}`,
    );
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            provider: "openai",
            model: "xx",
            input: "a".repeat(80),
            output: "b".repeat(80),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    await expect(
      verifyPullRequestEvidence([pullRequest], {
        evidenceFetch: fetcher,
        evidenceTimeoutMs: 100,
      }),
    ).resolves.toMatchObject({ artifacts: [] });
  });

  it("does not score a mutable release asset uploaded after merge", async () => {
    const mutableUrl =
      "https://github.com/elizaOS/eliza/releases/download/pr-evidence/replaced.log";
    const pullRequest = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nLogs: ${mutableUrl}`,
      { mergedAt: "2026-07-29T11:00:00.000Z" },
    );
    const fetcher = vi.fn(
      async () =>
        new Response(logDocument, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    );

    await expect(
      verifyPullRequestEvidence([pullRequest], {
        evidenceFetch: fetcher,
      }),
    ).resolves.toMatchObject({
      status: "complete",
      sourceCount: 0,
      artifactCount: 0,
      artifacts: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("still verifies head-pinned body after non-author post-merge edit (#17606)", async () => {
    const head = "a".repeat(40);
    const pullRequest = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nBackend logs: ${validLogUrl}`,
      {
        id: "PR_17606",
        number: 17606,
        author: actor("ss251"),
        editor: actor("lalalune"),
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-30T10:30:00.000Z",
        lastEditedAt: "2026-07-30T10:30:00.000Z",
        mergedAt: "2026-07-30T09:00:00.000Z",
        headRefOid: head,
      },
    );
    const authorEdited = mergedPullRequestWithEvidence(
      `<!-- evidence-row:backend-logs -->\nBackend logs: ${validLogUrl}`,
      {
        id: "PR_AUTHOR_FARM",
        number: 17607,
        author: actor("ss251"),
        editor: actor("ss251"),
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-30T10:30:00.000Z",
        lastEditedAt: "2026-07-30T10:30:00.000Z",
        mergedAt: "2026-07-30T09:00:00.000Z",
        headRefOid: head,
      },
    );
    const fetcher = vi.fn(
      async () =>
        new Response(logDocument, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    );

    const kept = await verifyPullRequestEvidence([pullRequest], {
      evidenceFetch: fetcher,
      evidenceTimeoutMs: 100,
      evidenceToken: "test-token",
    });
    const voided = await verifyPullRequestEvidence([authorEdited], {
      evidenceFetch: fetcher,
      evidenceTimeoutMs: 100,
      evidenceToken: "test-token",
    });

    expect(kept).toMatchObject({
      status: "complete",
      sourceCount: 1,
      artifactCount: 1,
      artifacts: [
        expect.objectContaining({
          pullRequestId: "PR_17606",
          category: "logs",
          artifactIdentity: validLogUrl,
        }),
      ],
    });
    expect(voided).toMatchObject({
      status: "complete",
      sourceCount: 0,
      artifactCount: 0,
      artifacts: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("post-evidence open-PR revalidation", () => {
  it("fails when a PR head changes while artifacts are being fetched", async () => {
    const pullRequest = mergedPullRequestWithEvidence("", {
      id: "PR_HEAD_RACE",
      number: 500,
      mergedAt: null,
      updatedAt: "2026-07-30T10:00:00.000Z",
      headRefOid: "a".repeat(40),
    });
    let liveHead = pullRequest.headRefOid;
    const client: GraphqlExecutor = {
      execute: async () => ({
        repository: {
          id: "REPOSITORY_ELIZA",
          pullRequests: {
            totalCount: 1,
            nodes: [
              {
                id: pullRequest.id,
                updatedAt: pullRequest.updatedAt,
                headRefOid: liveHead,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
      getRequestCount: () => 1,
      getRateLimit: () => ({
        cost: 1,
        consumedDuringRun: 1,
        limit: 5_000,
        remaining: 4_999,
        resetAt: "2026-07-30T13:00:00.000Z",
      }),
    };

    liveHead = "b".repeat(40);
    await expect(
      assertOpenEvidenceReferencesCurrent(
        client,
        PRIMARY_REPOSITORY,
        "REPOSITORY_ELIZA",
        [pullRequest],
      ),
    ).rejects.toThrow("An open pull request with evidence changed");
  });

  it("ignores unrelated open work while protecting evidence-bound versions", async () => {
    const pullRequest = mergedPullRequestWithEvidence("", {
      id: "PR_EVIDENCE_STABLE",
      number: 501,
      mergedAt: null,
      updatedAt: "2026-07-30T10:00:00.000Z",
      headRefOid: "a".repeat(40),
    });
    const client: GraphqlExecutor = {
      execute: async (document) => {
        if (document.includes("query LeaderboardOpenPullRequestReferences")) {
          return {
            repository: {
              id: "REPOSITORY_ELIZA",
              pullRequests: {
                totalCount: 2,
                nodes: [
                  {
                    id: pullRequest.id,
                    updatedAt: pullRequest.updatedAt,
                    headRefOid: pullRequest.headRefOid,
                  },
                  {
                    id: "PR_UNRELATED_NEW_WORK",
                    updatedAt: "2026-07-30T10:01:00.000Z",
                    headRefOid: "b".repeat(40),
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          };
        }
        throw new Error("Unexpected query");
      },
      getRequestCount: () => 1,
      getRateLimit: () => ({
        cost: 1,
        consumedDuringRun: 1,
        limit: 5_000,
        remaining: 4_999,
        resetAt: "2026-07-30T13:00:00.000Z",
      }),
    };

    await expect(
      assertOpenEvidenceReferencesCurrent(
        client,
        PRIMARY_REPOSITORY,
        "REPOSITORY_ELIZA",
        [pullRequest],
      ),
    ).resolves.toBeUndefined();
  });
});

describe("GitHub GraphQL boundary", () => {
  it("propagates GraphQL errors instead of returning empty data", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          data: null,
          errors: [{ message: "API rate limit exceeded" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    const client = new GitHubGraphqlClient("secret-token", fetcher);

    await expect(client.execute("query { viewer { login } }")).rejects.toThrow(
      "GitHub GraphQL rejected the leaderboard query: API rate limit exceeded",
    );
  });

  it("retries transient gateway failures and records actual API cost", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("<html>bad gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        });
      }
      return successResponse();
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(
      client.execute("query { viewer { login } }"),
    ).resolves.toMatchObject({ viewer: { login: "eliza" } });
    expect(client.getRequestCount()).toBe(2);
    expect(client.getRateLimit().consumedDuringRun).toBe(1);
  });

  it("honors GitHub secondary-limit retry guidance before returning data", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(
          JSON.stringify({
            message: "You have exceeded a secondary rate limit.",
          }),
          {
            status: 403,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "0",
            },
          },
        );
      }
      return successResponse();
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(
      client.execute("query { viewer { login } }"),
    ).resolves.toMatchObject({ viewer: { login: "eliza" } });
    expect(attempts).toBe(2);
    expect(client.getRequestCount()).toBe(2);
  });

  it("retries transient network failures before returning validated data", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new TypeError("socket disconnected");
      }
      return successResponse();
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(
      client.execute("query { viewer { login } }"),
    ).resolves.toMatchObject({ viewer: { login: "eliza" } });
    expect(attempts).toBe(3);
    expect(client.getRequestCount()).toBe(3);
  });

  it("retries a truncated successful JSON response before returning validated data", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response('{"data":{"viewer":', {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      return successResponse();
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(
      client.execute("query { viewer { login } }"),
    ).resolves.toMatchObject({ viewer: { login: "eliza" } });
    expect(attempts).toBe(2);
    expect(client.getRequestCount()).toBe(2);
  });

  it("fails closed after exhausting malformed successful JSON responses", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return new Response('{"data":', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(client.execute("query { viewer { login } }")).rejects.toThrow(
      "GitHub GraphQL HTTP 200 returned malformed JSON (5/5; application/json)",
    );
    expect(attempts).toBe(5);
    expect(client.getRequestCount()).toBe(5);
  });

  it("does not retry a malformed body with a non-JSON content type", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return new Response("<html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(client.execute("query { viewer { login } }")).rejects.toThrow(
      "GitHub GraphQL HTTP 200 returned a non-JSON response (text/html)",
    );
    expect(attempts).toBe(1);
    expect(client.getRequestCount()).toBe(1);
  });

  it("does not retry malformed JSON from a non-success status", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return new Response('{"message":', {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(client.execute("query { viewer { login } }")).rejects.toThrow(
      "GitHub GraphQL HTTP 401 returned a non-JSON response (application/json)",
    );
    expect(attempts).toBe(1);
    expect(client.getRequestCount()).toBe(1);
  });

  it("rejects an oversized GraphQL body before reading it", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return new Response("{}", {
        headers: {
          "content-length": String(64 * 1024 * 1024 + 1),
          "content-type": "application/json",
        },
      });
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(client.execute("query { viewer { login } }")).rejects.toThrow(
      "GitHub GraphQL response exceeds 67108864 bytes",
    );
    expect(attempts).toBe(1);
  });

  it("aborts, retries, and fails closed when every request times out", async () => {
    let attempts = 0;
    const fetcher = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      attempts += 1;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      requestTimeoutMs: 5,
      retryBaseDelayMs: 0,
    });

    await expect(client.execute("query { viewer { login } }")).rejects.toThrow(
      "timed out after 5ms (5/5)",
    );
    expect(attempts).toBe(5);
    expect(client.getRequestCount()).toBe(5);
  });

  it("retries Bun connection-refused transport failures", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("connection refused"), {
          code: "ConnectionRefused",
        });
      }
      return successResponse();
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(
      client.execute("query { viewer { login } }"),
    ).resolves.toMatchObject({ viewer: { login: "eliza" } });
    expect(attempts).toBe(2);
  });

  it("stops before returning data that exceeds the run cost budget", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return successResponse(
        { viewer: { login: "eliza" } },
        {
          cost: 400,
          limit: 5_000,
          remaining: 5_000 - attempts * 400,
          resetAt: "2026-07-30T13:00:00.000Z",
        },
      );
    };
    const client = new GitHubGraphqlClient("secret-token", fetcher, {
      maxGenerationCost: 750,
      minimumRateLimitReserve: 0,
    });

    await expect(
      client.execute("query { viewer { login } }"),
    ).resolves.toBeDefined();
    await expect(client.execute("query { viewer { login } }")).rejects.toThrow(
      "safety budget exceeded (800/750 points consumed in the current window",
    );
  });

  it("resumes a 1,000-point Actions token after its rate window resets", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return successResponse(
        { viewer: { login: "eliza" } },
        {
          cost: 450,
          limit: 1_000,
          remaining: attempts <= 2 ? 1_000 - attempts * 450 : 550,
          resetAt: "2026-07-30T13:00:00.000Z",
        },
      );
    };
    const client = new GitHubGraphqlClient("actions-token", fetcher, {
      retryBaseDelayMs: 0,
    });

    await expect(
      client.execute("query { viewer { login } }"),
    ).resolves.toBeDefined();
    await expect(
      client.execute("query { viewer { login } }"),
    ).resolves.toBeDefined();
    await expect(
      client.execute("query { viewer { login } }"),
    ).resolves.toBeDefined();
    expect(attempts).toBe(3);
    expect(client.getRateLimit().consumedDuringRun).toBe(1_350);
  });

  it("does not call the writer after live generation fails", async () => {
    const write = vi.fn(async (_snapshot: LeaderboardSnapshot) => undefined);
    const generate = vi.fn(async () => {
      throw new Error("GitHub connection failed");
    });

    await expect(
      runGenerator("/tmp/should-not-exist.json", {
        getToken: async () => "token",
        createClient: unusedClient,
        generate,
        write,
      }),
    ).rejects.toThrow("GitHub connection failed");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("rate-efficient query plan", () => {
  it("finds every reviewed merged pull request without hydrating unrelated detail", async () => {
    const seenDocuments: string[] = [];
    const client: GraphqlExecutor = {
      execute: async (document, variables) => {
        seenDocuments.push(document);
        const ids = variables?.ids;
        if (!Array.isArray(ids)) throw new Error("missing review census IDs");
        return {
          nodes: ids.map((id) => ({
            __typename: "PullRequest",
            id,
            updatedAt: "2026-08-25T18:00:00.000Z",
            reviews: { totalCount: id === "PR_REVIEWED" ? 2 : 0 },
          })),
        };
      },
      getRequestCount: () => seenDocuments.length,
      getRateLimit: () => ({
        cost: 1,
        consumedDuringRun: seenDocuments.length,
        limit: 5_000,
        remaining: 4_999,
        resetAt: "2026-08-25T18:00:00.000Z",
      }),
    };

    await expect(
      collectReviewedPullRequestIds(client, [
        { id: "PR_UNREVIEWED" },
        { id: "PR_REVIEWED" },
      ]),
    ).resolves.toEqual(new Set(["PR_REVIEWED"]));
    expect(seenDocuments).toHaveLength(1);
    expect(seenDocuments[0]).toContain(
      "reviews(states: [APPROVED, CHANGES_REQUESTED]) { totalCount }",
    );
    expect(seenDocuments[0]).not.toContain("reviews(first:");
  });

  it("fails closed when the review census is incomplete", async () => {
    const client: GraphqlExecutor = {
      execute: async () => ({ nodes: [] }),
      getRequestCount: () => 1,
      getRateLimit: () => ({
        cost: 1,
        consumedDuringRun: 1,
        limit: 5_000,
        remaining: 4_999,
        resetAt: "2026-08-25T18:00:00.000Z",
      }),
    };

    await expect(
      collectReviewedPullRequestIds(client, [{ id: "PR_MISSING" }]),
    ).rejects.toThrow(
      "GitHub returned 0 review census nodes for 1 requested IDs",
    );
  });

  it("fails closed when review counts change before snapshot assembly", () => {
    expect(() =>
      assertReviewCensusStable(
        new Map([
          [
            "PR_STABLE",
            { reviewCount: 1, updatedAt: "2026-08-25T18:00:00.000Z" },
          ],
          [
            "PR_CHANGED",
            { reviewCount: 0, updatedAt: "2026-08-25T18:00:00.000Z" },
          ],
        ]),
        new Map([
          [
            "PR_STABLE",
            { reviewCount: 1, updatedAt: "2026-08-25T18:00:00.000Z" },
          ],
          [
            "PR_CHANGED",
            { reviewCount: 1, updatedAt: "2026-08-25T18:01:00.000Z" },
          ],
        ]),
      ),
    ).toThrow("Review census changed for PR_CHANGED");
  });

  it("parses every production GraphQL document", () => {
    for (const [name, document] of Object.entries(
      LEADERBOARD_QUERY_DOCUMENTS,
    )) {
      expect(() => parse(document), name).not.toThrow();
    }
  });

  it("keeps search and open listings free of nested item connections", () => {
    for (const document of [
      LEADERBOARD_QUERY_DOCUMENTS.searchReferences,
      LEADERBOARD_QUERY_DOCUMENTS.openIssueReferences,
      LEADERBOARD_QUERY_DOCUMENTS.openPullRequestReferences,
    ]) {
      for (const forbiddenConnection of [
        "assignees(",
        "comments(",
        "files(",
        "labels(",
        "reviews(",
        "closingIssuesReferences(",
        "closedByPullRequestsReferences(",
      ]) {
        expect(document).not.toContain(forbiddenConnection);
      }
    }
  });

  it("loads bounded detail batches and review comments in separate queries", () => {
    expect(LEADERBOARD_QUERY_DOCUMENTS.searchReferences).toContain("mergedAt");
    expect(LEADERBOARD_QUERY_DOCUMENTS.searchReferences).toContain("additions");
    for (const forbiddenConnection of [
      "assignees(",
      "comments(",
      "files(",
      "labels(",
      "reviews(",
    ]) {
      expect(LEADERBOARD_QUERY_DOCUMENTS.searchReferences).not.toContain(
        forbiddenConnection,
      );
    }
    expect(LEADERBOARD_QUERY_DOCUMENTS.pullRequestDetails).toContain(
      "nodes(ids: $ids)",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.issueDetails).toContain(
      "nodes(ids: $ids)",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.pullRequestDetails).toContain(
      "reviews(first: 100)",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.pullRequestDetails).toContain(
      "headRefOid",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.pullRequestDetails).toContain(
      "lastEditedAt",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.pullRequestDetails).toContain(
      "editor { ...LeaderboardActor }",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.pullRequestDetails).toContain(
      "commit { oid }",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.moreReviews).toContain("headRefOid");
    expect(LEADERBOARD_QUERY_DOCUMENTS.openPullRequestReferences).toContain(
      "nodes { id updatedAt headRefOid }",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.pullRequestDetails).not.toMatch(
      /author\s*\{[^}]+}\s*comments\s*\{/,
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.mergedPullRequestReviews).toContain(
      "reviews(states: [APPROVED, CHANGES_REQUESTED], first: 100)",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.mergedPullRequestReviews).toContain(
      "comments(first: 100)",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.mergedPullRequestReviews).not.toContain(
      "files(first:",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.mergedPullRequestReviews).not.toContain(
      "closingIssuesReferences",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.moreFormalReviews).toContain(
      "states: [APPROVED, CHANGES_REQUESTED]",
    );
    expect(LEADERBOARD_QUERY_DOCUMENTS.reviewInlineComments).toContain(
      "comments(first: 100)",
    );
  });

  it("estimates normalized first-page connection costs by detail batch", () => {
    expect(estimateFirstPageDetailCost(0, 0)).toBe(0);
    expect(estimateFirstPageDetailCost(25, 25)).toBe(3);
    expect(estimateFirstPageDetailCost(26, 0)).toBe(3);
    expect(estimateReviewFirstPageDetailCost(25)).toBe(1);
    expect(estimateReviewFirstPageDetailCost(26)).toBe(2);
    expect(() => estimateFirstPageDetailCost(-1, 0)).toThrow(
      "non-negative integers",
    );
    expect(() => estimateReviewFirstPageDetailCost(-1)).toThrow(
      "non-negative integer",
    );
  });

  it("invalidates an open snapshot when a node changes version", () => {
    const before = [
      {
        id: "PR_1",
        kind: "PullRequest" as const,
        outcome: null,
        openVersion: `2026-07-30T10:00:00.000Z:${"a".repeat(40)}`,
      },
    ];
    expect(sameReferenceSet(before, structuredClone(before))).toBe(true);
    expect(
      sameReferenceSet(before, [
        {
          ...before[0],
          openVersion: `2026-07-30T10:01:00.000Z:${"b".repeat(40)}`,
        },
      ]),
    ).toBe(false);
  });

  it("deep-inspects only newest cap-relevant outcomes per actor, project, and month", () => {
    const outcome = (
      id: string,
      mergedAt: string,
      author: GitHubActor = actor("alice"),
    ): MergedPullRequestOutcome => ({
      id,
      number: Number(id.replace(/\D/gu, "")) || 1,
      title: id,
      url: `https://github.com/elizaOS/eliza/pull/${id}`,
      body: "",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: mergedAt,
      mergedAt,
      author,
      additions: 1,
      deletions: 0,
    });
    const candidates = Array.from({ length: 7 }, (_, index) => ({
      outcome: outcome(
        `PR_${index + 1}`,
        `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
      ),
      projectId: "eliza",
    }));
    candidates.push(
      {
        outcome: outcome("PR_JUNE", "2026-06-30T12:00:00.000Z"),
        projectId: "eliza",
      },
      {
        outcome: outcome("PR_OTHER_PROJECT", "2026-07-01T13:00:00.000Z"),
        projectId: "delta-star",
      },
      {
        outcome: outcome(
          "PR_BOT",
          "2026-07-08T12:00:00.000Z",
          actor("review-bot", "Bot"),
        ),
        projectId: "eliza",
      },
    );

    expect(
      [
        ...selectDetailedMergedPullRequestIds(
          candidates,
          new Date("2026-06-01T00:00:00.000Z"),
        ),
      ].sort(),
    ).toEqual(
      [
        "PR_3",
        "PR_4",
        "PR_5",
        "PR_6",
        "PR_7",
        "PR_JUNE",
        "PR_OTHER_PROJECT",
      ].sort(),
    );
    expect(() =>
      selectDetailedMergedPullRequestIds(candidates, new Date("invalid")),
    ).toThrow("verificationWindowFrom must be a valid date");
  });

  it("hydrates reviewed outcomes independently of the author detail cap", async () => {
    const mergedAt = "2026-07-15T12:00:00.000Z";
    const outcome = (id: string): MergedPullRequestOutcome => ({
      id,
      number: Number(id.replace(/\D/gu, "")) || 1,
      title: id,
      url: `https://github.com/elizaOS/eliza/pull/${id}`,
      body: "",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: mergedAt,
      mergedAt,
      author: actor("alice"),
      additions: 1,
      deletions: 0,
    });
    // Six PRs by the same author, project, and month merged in the same second
    // (batch merge / merge queue produce identical second-precision timestamps).
    // Batch merges can share a second-precision timestamp. Number provides the
    // stable tie-break for the separate five-outcome hydration budget; all six
    // still receive base merge credit.
    const candidates = [
      "PR_101",
      "PR_102",
      "PR_103",
      "PR_104",
      "PR_105",
      "PR_106",
    ].map((id) => ({ outcome: outcome(id), projectId: "eliza" }));

    const client: GraphqlExecutor = {
      execute: async (_document, variables) => ({
        nodes: ((variables?.ids ?? []) as string[]).map((id) => ({
          __typename: "PullRequest",
          id,
          updatedAt: mergedAt,
          reviews: { totalCount: id === "PR_101" ? 1 : 0 },
        })),
      }),
      getRequestCount: () => 0,
      getRateLimit: () => ({
        cost: 0,
        consumedDuringRun: 0,
        limit: 5_000,
        remaining: 5_000,
        resetAt: "2026-08-25T18:00:00.000Z",
      }),
    };

    const plan = await planMergedPullRequestHydration(
      client,
      candidates,
      new Date("2026-06-01T00:00:00.000Z"),
    );

    expect([...plan.hydratedIds].sort()).toEqual(
      ["PR_101", "PR_102", "PR_103", "PR_104", "PR_105", "PR_106"].sort(),
    );
    expect([...plan.detailEligibleIds].sort()).toEqual(
      ["PR_102", "PR_103", "PR_104", "PR_105", "PR_106"].sort(),
    );
  });

  it("recollects only typed concurrent changes to the non-scoring queue", async () => {
    let attempts = 0;
    await expect(
      retrySlopSnapshot(async (attempt) => {
        attempts = attempt;
        if (attempt < 3) {
          throw new OpenSetChangedError("open pull request moved");
        }
        return "stable";
      }),
    ).resolves.toBe("stable");
    expect(attempts).toBe(3);

    await expect(
      retrySlopSnapshot(async () => {
        throw new Error("evidence verifier failed");
      }),
    ).rejects.toThrow("evidence verifier failed");
  });

  it("retries only the changing open-work hydration batch", async () => {
    let attempts = 0;
    await expect(
      retryOpenBatch("open", async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new OpenSetChangedError("open work moved");
        }
        return ["stable-pr"];
      }),
    ).resolves.toEqual(["stable-pr"]);
    expect(attempts).toBe(2);

    await expect(
      retryOpenBatch("merged", async () => {
        throw new OpenSetChangedError("merged outcome changed");
      }),
    ).rejects.toThrow("merged outcome changed");
  });

  it("retries a paginated open-work listing when its live count changes", async () => {
    let attempts = 0;
    await expect(
      retryOpenReferenceListing(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new OpenSetChangedError("open queue count moved");
        }
        return ["stable-reference"];
      }),
    ).resolves.toEqual(["stable-reference"]);
    expect(attempts).toBe(2);
  });

  it("fails when the non-scoring queue never stabilizes", async () => {
    let attempts = 0;
    await expect(
      retrySlopSnapshot(async (attempt) => {
        attempts = attempt;
        throw new OpenSetChangedError("open issue moved");
      }),
    ).rejects.toThrow(
      "Open evidence changed during 3 consecutive verification attempts",
    );
    expect(attempts).toBe(3);
  });
});

describe("current-head review selection", () => {
  it("ignores stale-head, bot, and self reviews while honoring each reviewer's latest state", () => {
    const head = "a".repeat(40);
    const previousHead = "b".repeat(40);
    const author = actor("author");
    const reviewer = actor("reviewer");
    const secondReviewer = actor("second-reviewer");
    const reviews = [
      {
        id: "REVIEW_STALE_CHANGES",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-07-30T10:00:00.000Z",
        commitId: previousHead,
        author: reviewer,
      },
      {
        id: "REVIEW_CURRENT_APPROVAL",
        state: "APPROVED",
        submittedAt: "2026-07-30T11:00:00.000Z",
        commitId: head,
        author: secondReviewer,
      },
      {
        id: "REVIEW_BOT_CHANGES",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-07-30T12:00:00.000Z",
        commitId: head,
        author: actor("review-bot", "Bot"),
      },
      {
        id: "REVIEW_SELF_CHANGES",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-07-30T12:30:00.000Z",
        commitId: head,
        author,
      },
    ];

    expect(deriveCurrentHeadReviewDecision(head, author, reviews)).toBe(
      "APPROVED",
    );
    expect(
      deriveCurrentHeadReviewDecision(head, author, [
        ...reviews,
        {
          id: "REVIEW_CURRENT_CHANGES",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-07-30T13:00:00.000Z",
          commitId: head,
          author: reviewer,
        },
      ]),
    ).toBe("CHANGES_REQUESTED");
    expect(
      deriveCurrentHeadReviewDecision(head, author, [
        ...reviews,
        {
          id: "REVIEW_APPROVAL_SUPERSEDED",
          state: "COMMENTED",
          submittedAt: "2026-07-30T14:00:00.000Z",
          commitId: head,
          author: secondReviewer,
        },
      ]),
    ).toBe("APPROVED");
    expect(
      deriveCurrentHeadReviewDecision(head, author, [
        {
          id: "REVIEW_CHANGES_BEFORE_DISMISSAL",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-07-30T13:00:00.000Z",
          commitId: head,
          author: reviewer,
        },
        {
          id: "REVIEW_DISMISSED",
          state: "DISMISSED",
          submittedAt: "2026-07-30T14:00:00.000Z",
          commitId: head,
          author: reviewer,
        },
      ]),
    ).toBeNull();
  });

  it("rejects a malformed head revision", () => {
    expect(() =>
      deriveCurrentHeadReviewDecision("not-a-full-sha", actor("author"), []),
    ).toThrow("full commit SHA");
  });

  it("fails closed for deleted reviewers and same-timestamp decisions", () => {
    const head = "a".repeat(40);
    const submittedAt = "2026-07-30T10:00:00.000Z";
    const reviewer = actor("reviewer");
    expect(
      deriveCurrentHeadReviewDecision(head, actor("author"), [
        {
          id: "REVIEW_GHOST_APPROVAL",
          state: "APPROVED",
          submittedAt,
          commitId: head,
          author: null,
        },
      ]),
    ).toBe("APPROVED");
    expect(
      deriveCurrentHeadReviewDecision(head, actor("author"), [
        {
          id: "REVIEW_GHOST_CHANGES",
          state: "CHANGES_REQUESTED",
          submittedAt,
          commitId: head,
          author: null,
        },
        {
          id: "REVIEW_OTHER_GHOST_APPROVAL",
          state: "APPROVED",
          submittedAt: "2026-07-30T11:00:00.000Z",
          commitId: head,
          author: null,
        },
      ]),
    ).toBe("CHANGES_REQUESTED");
    const tiedReviews = [
      {
        id: "REVIEW_TIED_APPROVAL",
        state: "APPROVED",
        submittedAt,
        commitId: head,
        author: reviewer,
      },
      {
        id: "REVIEW_TIED_CHANGES",
        state: "CHANGES_REQUESTED",
        submittedAt,
        commitId: head,
        author: reviewer,
      },
    ];
    expect(
      deriveCurrentHeadReviewDecision(head, actor("author"), tiedReviews),
    ).toBe("CHANGES_REQUESTED");
    expect(
      deriveCurrentHeadReviewDecision(
        head,
        actor("author"),
        tiedReviews.toReversed(),
      ),
    ).toBe("CHANGES_REQUESTED");
  });

  it("rejects malformed non-null review commit revisions", () => {
    expect(() =>
      deriveCurrentHeadReviewDecision("a".repeat(40), actor("author"), [
        {
          id: "REVIEW_MALFORMED_COMMIT",
          state: "APPROVED",
          submittedAt: "2026-07-30T10:00:00.000Z",
          commitId: "short-sha",
          author: actor("reviewer"),
        },
      ]),
    ).toThrow(
      "Review REVIEW_MALFORMED_COMMIT commitId must be a full commit SHA",
    );
  });

  it("ignores unreachable reviewed commits and rejects missing timestamps", () => {
    const head = "a".repeat(40);
    const base = {
      id: "REVIEW_INCOMPLETE",
      state: "CHANGES_REQUESTED",
      submittedAt: "2026-07-30T10:00:00.000Z" as string | null,
      commitId: head as string | null,
      author: actor("reviewer"),
    };
    expect(
      deriveCurrentHeadReviewDecision(head, actor("author"), [
        { ...base, commitId: null },
      ]),
    ).toBeNull();
    expect(() =>
      deriveCurrentHeadReviewDecision(head, actor("author"), [
        { ...base, submittedAt: null },
      ]),
    ).toThrow("cannot prove a timestamped CHANGES_REQUESTED decision");
  });

  it("derives the published queue from paginated GraphQL review commits", async () => {
    const currentHead = "a".repeat(40);
    const previousHead = "b".repeat(40);
    const now = new Date(Date.now() - 60_000);
    const updatedAt = new Date(now.getTime() - 60_000).toISOString();
    const createdAt = new Date(now.getTime() - 120_000).toISOString();
    const reviewer = {
      __typename: "User",
      id: "ACTOR_REVIEWER",
      login: "reviewer",
      avatarUrl: "https://avatars.githubusercontent.com/u/100",
      url: "https://github.com/reviewer",
    };
    const author = (login: string) => ({
      __typename: "User",
      id: `ACTOR_${login}`,
      login,
      avatarUrl: "https://avatars.githubusercontent.com/u/200",
      url: `https://github.com/${login}`,
    });
    const emptyConnection = () => ({
      totalCount: 0,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [],
    });
    const review = (
      id: string,
      databaseId: number,
      state: string,
      commitId: string,
      reviewAuthor: typeof reviewer | null,
    ) => ({
      id,
      body: "",
      state,
      submittedAt: updatedAt,
      url: `https://github.com/elizaOS/eliza/pull/1#pullrequestreview-${databaseId}`,
      commit: { oid: commitId },
      author: reviewAuthor,
    });
    const staleReview = review(
      "REVIEW_STALE",
      101,
      "CHANGES_REQUESTED",
      previousHead,
      reviewer,
    );
    const ghostApproval = review(
      "REVIEW_GHOST",
      102,
      "APPROVED",
      currentHead,
      null,
    );
    const pullRequest = (
      id: string,
      number: number,
      reviewDecision: string,
      reviews: ReturnType<typeof review>[],
      hasNextReviewPage = false,
    ) => ({
      __typename: "PullRequest",
      id,
      state: "OPEN",
      number,
      title: `Pull request ${number}`,
      url: `https://github.com/elizaOS/eliza/pull/${number}`,
      body: "",
      createdAt,
      updatedAt,
      lastEditedAt: null,
      editor: null,
      mergedAt: null,
      isDraft: false,
      headRefOid: currentHead,
      reviewDecision,
      reviewRequests: { totalCount: 0 },
      author: author(`author-${number}`),
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      commits: { totalCount: 1 },
      labels: { totalCount: 0, nodes: [] },
      assignees: { totalCount: 0, nodes: [] },
      comments: emptyConnection(),
      reviews: {
        totalCount: reviews.length + (hasNextReviewPage ? 1 : 0),
        pageInfo: {
          hasNextPage: hasNextReviewPage,
          endCursor: hasNextReviewPage ? "REVIEW_CURSOR" : null,
        },
        nodes: reviews,
      },
      files: emptyConnection(),
      closingIssuesReferences: emptyConnection(),
    });
    const details = new Map([
      ["PR_STALE", pullRequest("PR_STALE", 1, "CHANGES_REQUESTED", [], true)],
      [
        "PR_GHOST",
        pullRequest("PR_GHOST", 2, "REVIEW_REQUIRED", [ghostApproval]),
      ],
    ]);
    let requestCount = 0;
    let openPullReferenceRequests = 0;
    let paginatedHead = currentHead;
    const client: GraphqlExecutor = {
      execute: async (document, variables) => {
        requestCount += 1;
        const repositoryName =
          typeof variables?.name === "string" ? variables.name : null;
        const repositoryNodeId =
          repositoryName === "proximityprize"
            ? "R_kgDOT48hJQ"
            : repositoryName === "asi"
              ? "R_kgDOT23CXA"
              : repositoryName === "element-sdk"
                ? "REPOSITORY_ELEMENT_SDK"
                : "REPOSITORY_ELIZA";
        if (document.includes("query LeaderboardPreflight")) {
          return {
            repository: { id: repositoryNodeId, updatedAt },
          };
        }
        if (document.includes("query LeaderboardSearchReferences")) {
          return {
            search: {
              issueCount: 0,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [],
            },
          };
        }
        if (document.includes("query LeaderboardOpenIssueReferences")) {
          return {
            repository: {
              id: repositoryNodeId,
              issues: emptyConnection(),
            },
          };
        }
        if (document.includes("query LeaderboardOpenPullRequestReferences")) {
          openPullReferenceRequests += 1;
          if (repositoryName === "proximityprize" || repositoryName === "asi") {
            return {
              repository: {
                id: repositoryNodeId,
                pullRequests: emptyConnection(),
              },
            };
          }
          return {
            repository: {
              id: repositoryNodeId,
              pullRequests: {
                totalCount: 2,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [...details.values()].map((item) => ({
                  id: item.id,
                  updatedAt: item.updatedAt,
                  headRefOid: item.headRefOid,
                })),
              },
            },
          };
        }
        if (document.includes("query LeaderboardPullRequestDetails")) {
          const ids = variables?.ids;
          if (!Array.isArray(ids)) {
            throw new Error("pull-request detail IDs are missing");
          }
          return {
            nodes: ids.map((id) => {
              if (typeof id !== "string") {
                throw new Error("pull-request detail ID must be a string");
              }
              const detail = details.get(id);
              if (!detail) {
                throw new Error(`unexpected pull-request detail ID: ${id}`);
              }
              return detail;
            }),
          };
        }
        if (document.includes("query LeaderboardMoreReviews")) {
          if (variables?.id !== "PR_STALE") {
            throw new Error("unexpected paginated review owner");
          }
          return {
            node: {
              id: "PR_STALE",
              headRefOid: paginatedHead,
              reviews: {
                totalCount: 1,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [staleReview],
              },
            },
          };
        }
        if (document.includes("query LeaderboardReviewInlineComments")) {
          const ids = variables?.ids;
          if (!Array.isArray(ids)) {
            throw new Error("review detail IDs are missing");
          }
          return {
            nodes: ids.map((id) => ({
              __typename: "PullRequestReview",
              id,
              comments: emptyConnection(),
            })),
          };
        }
        throw new Error("unexpected GraphQL operation");
      },
      getRequestCount: () => requestCount,
      getRateLimit: () => ({
        cost: 0,
        consumedDuringRun: 0,
        limit: 5_000,
        remaining: 5_000,
        resetAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      }),
    };

    const snapshot = await generateLeaderboardFromGitHub(client, { now });
    expect(snapshot.source.repositories).toEqual([
      { id: "elizaOS/eliza", repositoryId: "REPOSITORY_ELIZA" },
      { id: "elizaOS/asi", repositoryId: "R_kgDOT23CXA" },
      {
        id: "heirlabs/element-sdk",
        repositoryId: "REPOSITORY_ELEMENT_SDK",
      },
      {
        id: "elizaOS/proximityprize",
        repositoryId: "R_kgDOT48hJQ",
      },
    ]);
    expect(snapshot.repositories).toEqual(
      TARGET_REPOSITORIES.map(
        ({
          aliases: _aliases,
          expectedNodeId: _expectedNodeId,
          ...repository
        }) => repository,
      ),
    );
    const staleItem = snapshot.workQueue.pullRequests.find(
      (item) => item.id === "PR_STALE",
    );
    const ghostItem = snapshot.workQueue.pullRequests.find(
      (item) => item.id === "PR_GHOST",
    );

    expect(staleItem).toMatchObject({
      reviewDecision: null,
      selection: { status: "candidate", reasons: [] },
    });
    expect(ghostItem).toMatchObject({
      reviewDecision: "APPROVED",
      selection: { status: "excluded", reasons: ["already-approved"] },
    });
    expect(JSON.stringify(snapshot)).not.toContain("headRefOid");
    expect(JSON.stringify(snapshot)).not.toContain("commitId");
    expect(openPullReferenceRequests).toBe(4);

    paginatedHead = previousHead;
    await expect(
      generateLeaderboardFromGitHub(client, { now }),
    ).rejects.toThrow(
      "Open work batch changed during 3 consecutive hydration attempts",
    );
  });
});

describe("rolling-window slicing", () => {
  it("splits saturated search ranges without gaps and deduplicates boundaries", async () => {
    const queries: string[] = [];
    const client: GraphqlExecutor = {
      execute: async (_document, variables) => {
        const searchQuery = String(variables?.searchQuery);
        queries.push(searchQuery);
        const saturated = queries.length === 1;
        return {
          search: {
            issueCount: saturated ? SEARCH_SAFE_RESULT_LIMIT : 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: saturated
              ? []
              : [{ __typename: "Issue", id: "ISSUE_BOUNDARY" }],
          },
        };
      },
      getRequestCount: () => queries.length,
      getRateLimit: () => ({
        cost: 1,
        consumedDuringRun: queries.length,
        limit: 5_000,
        remaining: 5_000 - queries.length,
        resetAt: "2026-07-30T01:00:00.000Z",
      }),
    };
    const stats = { searchSliceCount: 0 };

    const references = await collectSearchReferences(
      client,
      PRIMARY_REPOSITORY,
      new Date("2026-07-30T00:00:00.000Z"),
      new Date("2026-07-30T00:02:00.000Z"),
      "closed",
      "is:issue is:closed",
      "Issue",
      stats,
    );

    expect(references.map(({ id }) => id)).toEqual(["ISSUE_BOUNDARY"]);
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain(`repo:${PRIMARY_REPOSITORY.id} `);
    expect(queries[1]).toContain(
      "closed:2026-07-30T00:00:00.000Z..2026-07-30T00:00:59.000Z",
    );
    expect(queries[2]).toContain(
      "closed:2026-07-30T00:01:00.000Z..2026-07-30T00:01:59.000Z",
    );
    expect(stats.searchSliceCount).toBe(3);
  });

  it("fails closed when a one-minute search range reaches the result cap", async () => {
    const client: GraphqlExecutor = {
      execute: async () => ({
        search: {
          issueCount: SEARCH_SAFE_RESULT_LIMIT,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      }),
      getRequestCount: () => 1,
      getRateLimit: () => ({
        cost: 1,
        consumedDuringRun: 1,
        limit: 5_000,
        remaining: 4_999,
        resetAt: "2026-07-30T01:00:00.000Z",
      }),
    };

    await expect(
      collectSearchReferences(
        client,
        PRIMARY_REPOSITORY,
        new Date("2026-07-30T00:00:00.000Z"),
        new Date("2026-07-30T00:01:00.000Z"),
        "closed",
        "is:issue is:closed",
        "Issue",
        { searchSliceCount: 0 },
      ),
    ).rejects.toThrow(
      "refusing a snapshot that could hit the 1,000-result cap",
    );
  });

  it("uses the latest record update instead of the collection cutoff", () => {
    expect(
      deriveSourceUpdatedAt(
        [
          { updatedAt: "2026-07-20T00:00:00.000Z" },
          { updatedAt: "2026-07-29T10:00:00.000Z" },
          { updatedAt: "2026-07-25T00:00:00.000Z" },
        ],
        "2026-07-30T00:00:00.000Z",
      ),
    ).toBe("2026-07-29T10:00:00.000Z");
    expect(deriveSourceUpdatedAt([], "2026-07-28T00:00:00.000Z")).toBe(
      "2026-07-28T00:00:00.000Z",
    );
  });
});
