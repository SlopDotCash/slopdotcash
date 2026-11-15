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
