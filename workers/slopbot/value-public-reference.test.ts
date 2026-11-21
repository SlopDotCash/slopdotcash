import { expect, test } from "bun:test";
import { fixture, repository } from "../../tests/value-binary-fixture";
import { GitHubClient } from "./github";
import { collectValueReferenceEvidence } from "./value-evidence";

for (const outcome of [
  "absent-public",
  "private",
  "wrong-repository",
  "unavailable",
  "wrong-error-path",
  "missing-id",
  "multiple-errors",
  "malformed-error",
] as const) {
  test(`outgoing reference ${outcome} retains its proper disposition`, async () => {
    const source = fixture({ direct: true, textOnly: true });
    source.pull.body = "Negative result #23";
    const github = GitHubClient.forToken(
      "synthetic-read-token",
      Object.assign(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          const { query } = JSON.parse(String(init?.body));
          if (query.includes("timelineItems"))
            return Response.json({
              data: {
                repository: {
                  pullRequest: {
                    id: source.pull.node_id,
                    timelineItems: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                },
              },
            });
          if (outcome === "unavailable")
            return new Response(null, { status: 503 });
          return Response.json({
            data: {
              rateLimit: {
                cost: 1,
                limit: 5000,
                remaining: 4999,
                resetAt: "2026-11-15T08:00:00Z",
              },
              repository: {
                id: outcome === "missing-id" ? undefined : "R_fixture",
                isPrivate: outcome === "private",
                nameWithOwner:
                  outcome === "wrong-repository"
                    ? "other/project"
                    : repository.id,
                issueOrPullRequest: null,
              },
            },
            errors: [
              ...(outcome === "multiple-errors"
                ? [{ type: "FORBIDDEN", path: ["repository"] }]
                : []),
              outcome === "malformed-error"
                ? null
                : {
                    type: "NOT_FOUND",
                    path:
                      outcome === "wrong-error-path"
                        ? ["repository"]
                        : ["repository", "issueOrPullRequest"],
                  },
            ],
          });
        },
        { preconnect: fetch.preconnect },
      ),
    );
    const result = await collectValueReferenceEvidence(
      { ...source.client, graphql: github.graphql.bind(github) },
      repository.id,
      1,
    );
    expect(result.references).toEqual([]);
    if (outcome === "absent-public") {
      expect(result.limitations).toEqual([]);
      expect(result.unavailablePublicReferences).toEqual([
        {
          repository: repository.id,
          repositoryNodeId: "R_fixture",
          number: 23,
        },
      ]);
    } else {
      expect(result.limitations).toEqual([
        "Outgoing reference is unavailable or private",
      ]);
      expect(result.unavailablePublicReferences).toEqual([]);
    }
  });
}

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorrectionEvidenceCache } from "../../scripts/collect-implementation-corrections";
import { VALUE_REFERENCE_QUERY } from "./value-reference-query";

test("the exact public missing-item response replays from the immutable evidence cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slop-public-reference-"));
  let reads = 0;
  const variables = { owner: "example", name: "binary-proof", number: 23 };
  const transport = Object.assign(
    async () => {
      reads++;
      return Response.json({
        data: {
          rateLimit: {
            cost: 1,
            limit: 5000,
            remaining: 4999,
            resetAt: "2026-11-15T08:00:00Z",
          },
          repository: {
            id: "R_fixture",
            isPrivate: false,
            nameWithOwner: "example/binary-proof",
            issueOrPullRequest: null,
          },
        },
        errors: [
          { type: "NOT_FOUND", path: ["repository", "issueOrPullRequest"] },
        ],
      });
    },
    { preconnect: fetch.preconnect },
  );
  try {
    const cache = new CorrectionEvidenceCache(directory, transport);
    const client = GitHubClient.forToken("synthetic-read-token", cache.fetch);
    expect(
      await client.graphql(VALUE_REFERENCE_QUERY, variables),
    ).toHaveProperty("repository.issueOrPullRequest", null);
    expect(
      await client.graphql(VALUE_REFERENCE_QUERY, variables),
    ).toHaveProperty("repository.id", "R_fixture");
    expect(reads).toBe(1);
    expect(cache.cacheHits).toBe(1);
    const differentQuery = VALUE_REFERENCE_QUERY.replace(
      "SlopValuePublicReference",
      "OtherReference",
    );
    await expect(client.graphql(differentQuery, variables)).rejects.toThrow(
      "incomplete",
    );
    await expect(client.graphql(differentQuery, variables)).rejects.toThrow(
      "incomplete",
    );
    expect(reads).toBe(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const mode of [
  "renamed",
  "renamed-existing",
  "different-id",
  "canonical-name-mismatch",
  "private",
  "missing",
  "same-name",
] as const)
  test(`renamed public reference ${mode} preserves immutable repository identity`, async () => {
    const source = fixture({ direct: true, textOnly: true });
    source.pull.body = "See old-owner/old-name#23";
    const client = GitHubClient.forToken(
      "synthetic-read-token",
      Object.assign(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          const { query, variables } = JSON.parse(String(init?.body));
          if (query.includes("timelineItems"))
            return Response.json({
              data: {
                repository: {
                  pullRequest: {
                    id: source.pull.node_id,
                    timelineItems: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                },
              },
            });
          if (query.includes("SlopValueReferenceRepository"))
            return Response.json({
              data: {
                repository:
                  mode === "missing"
                    ? null
                    : {
                        id: "R_original",
                        isPrivate: mode === "private",
                        nameWithOwner:
                          mode === "same-name"
                            ? "old-owner/old-name"
                            : "new-owner/new-name",
                      },
              },
            });
          if (variables.owner === "old-owner")
            return Response.json({
              data: { repository: null },
              errors: [{ type: "NOT_FOUND", path: ["repository"] }],
            });
          return Response.json({
            data: {
              rateLimit: {
                cost: 1,
                limit: 5000,
                remaining: 4999,
                resetAt: "2026-11-15T09:00:00Z",
              },
              repository: {
                id: mode === "different-id" ? "R_different" : "R_original",
                isPrivate: false,
                nameWithOwner:
                  mode === "canonical-name-mismatch"
                    ? "other-owner/other-name"
                    : "new-owner/new-name",
                issueOrPullRequest:
                  mode === "renamed-existing"
                    ? {
                        __typename: "PullRequest",
                        id: "PR_renamed",
                        number: 23,
                        url: "https://github.com/new-owner/new-name/pull/23",
                      }
                    : null,
              },
            },
            ...(mode === "renamed-existing"
              ? {}
              : {
                  errors: [
                    {
                      type: "NOT_FOUND",
                      path: ["repository", "issueOrPullRequest"],
                    },
                  ],
                }),
          });
        },
        { preconnect: fetch.preconnect },
      ),
    );
    const result = await collectValueReferenceEvidence(
      { ...source.client, graphql: client.graphql.bind(client) },
      repository.id,
      1,
    );
    if (mode === "renamed-existing") {
      expect(result.references).toEqual([
        {
          id: "PR_renamed",
          number: 23,
          url: "https://github.com/new-owner/new-name/pull/23",
          repository: "new-owner/new-name",
        },
      ]);
      expect(result.limitations).toEqual([]);
      expect(result.unavailablePublicReferences).toEqual([]);
    } else if (mode === "renamed") {
      expect(result.references).toEqual([]);
      expect(result.limitations).toEqual([]);
      expect(result.unavailablePublicReferences).toEqual([
        {
          repository: "new-owner/new-name",
          repositoryNodeId: "R_original",
          number: 23,
        },
      ]);
    } else {
      expect(result.limitations).toEqual([
        "Outgoing reference is unavailable or private",
      ]);
      expect(result.unavailablePublicReferences).toEqual([]);
    }
  });
