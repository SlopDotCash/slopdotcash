import { expect, test } from "bun:test";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import {
  collectSearchReferences,
  GitHubGraphqlClient,
  SEARCH_SAFE_RESULT_LIMIT,
} from "./generate-leaderboard";

const repository = TARGET_REPOSITORIES[0];
if (!repository) throw new Error("Expected a fixture repository");

/**
 * GitHub Search over closed issues, honoring second-precision inclusive
 * ranges and capping a query at 1,000 reachable results.
 */
function searchExecutor(closedAt: Date[]) {
  const queries: string[] = [];
  return {
    queries,
    execute: async (
      _document: string,
      variables: Record<string, unknown> = {},
    ) => {
      const query = String(variables.searchQuery);
      queries.push(query);
      const match = /closed:(\S+)\.\.(\S+)$/u.exec(query);
      if (!match) throw new Error(`Unexpected search ${query}`);
      const from = Date.parse(match[1]);
      const through = Date.parse(match[2]);
      const ids = closedAt
        .map((at, index) => ({ at: at.getTime(), id: `I_${index}` }))
        .filter(({ at }) => at >= from && at <= through + 999)
        .map(({ id }) => id);
      const offset = Number(variables.after ?? 0);
      const size = Number(variables.pageSize);
      const reachable = ids.slice(0, 1000);
      const nodes = reachable
        .slice(offset, offset + size)
        .map((id) => ({ __typename: "Issue", id }));
      const end = offset + nodes.length;
      return {
        search: {
          issueCount: ids.length,
          pageInfo: {
            hasNextPage: end < reachable.length,
            endCursor: end < reachable.length ? String(end) : null,
          },
          nodes,
        },
      };
    },
  };
}

test("a burst of more results than Search returns in one minute is split down to seconds", async () => {
  // 1,072 items closed in 45 seconds, as a bulk merge produced on 6 November 2026.
  const start = Date.parse("2026-11-06T22:53:44Z");
  const closedAt = Array.from(
    { length: 1072 },
    (_, index) => new Date(start + Math.floor((index * 45) / 1072) * 1000),
  );
  const client = searchExecutor(closedAt);
  // The 45-second slice the production collector refused.
  const references = await collectSearchReferences(
    client as never,
    repository,
    new Date("2026-11-06T22:53:44Z"),
    new Date("2026-11-06T22:54:30Z"),
    "closed",
    "is:issue is:closed",
    "Issue",
    { searchSliceCount: 0 },
  );
  expect(new Set(references.map((reference) => reference.id)).size).toBe(1072);
  expect(references).toHaveLength(1072);
});

test("more results than Search returns within one second still refuse the snapshot", async () => {
  const at = new Date("2026-11-06T22:54:00Z");
  const client = searchExecutor(
    Array.from({ length: SEARCH_SAFE_RESULT_LIMIT + 1 }, () => at),
  );
  await expect(
    collectSearchReferences(
      client as never,
      repository,
      new Date("2026-11-06T22:00:00Z"),
      new Date("2026-11-06T23:00:00Z"),
      "closed",
      "is:issue is:closed",
      "Issue",
      { searchSliceCount: 0 },
    ),
  ).rejects.toThrow("minimum-size range");
});

test("a repeated Search cursor refuses the crawl before another billed request", async () => {
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = await request.json();
      expect(body.query).toContain("search(");
      requests++;
      if (requests > 2)
        return Response.json(
          { message: "Unexpected third request" },
          { status: 400 },
        );
      return Response.json({
        data: {
          search: {
            issueCount: 3,
            pageInfo: { hasNextPage: true, endCursor: "stalled" },
            nodes: [{ __typename: "Issue", id: "I_1" }],
          },
          rateLimit: {
            cost: 1,
            limit: 5000,
            remaining: 5000 - requests,
            resetAt: "2027-01-01T00:00:00.000Z",
          },
        },
      });
    },
  });
  try {
    const client = new GitHubGraphqlClient("fixture-only", (_url, init) =>
      fetch(server.url, init),
    );
    await expect(
      collectSearchReferences(
        client,
        repository,
        new Date("2026-11-06T22:00:00Z"),
        new Date("2026-11-06T23:00:00Z"),
        "closed",
        "is:issue is:closed",
        "Issue",
        { searchSliceCount: 0 },
      ),
    ).rejects.toThrow("cursor did not advance");
    expect(requests).toBe(2);
    expect(client.getRequestCount()).toBe(2);
    expect(client.getRateLimit().consumedDuringRun).toBe(2);
  } finally {
    server.stop(true);
  }
});
