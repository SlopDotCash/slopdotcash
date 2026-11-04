import { expect, test } from "bun:test";
import {
  executeNodeBatch,
  GitHubGraphqlClient,
  GraphqlUpstreamError,
  MAX_GRAPHQL_REQUEST_ATTEMPTS,
} from "./generate-leaderboard";

const QUERY = "query Batch($ids: [ID!]!) { nodes(ids: $ids) { id } }";

function fakeExecutor(limit: number) {
  const calls: string[][] = [];
  return {
    calls,
    execute: async (
      _document: string,
      variables: Record<string, unknown> = {},
    ) => {
      const ids = variables.ids as string[];
      calls.push(ids);
      if (ids.length > limit) {
        throw new GraphqlUpstreamError("GitHub GraphQL HTTP 504", 504);
      }
      return {
        nodes: ids.map((id) => ({
          id,
          states: variables.reviewStates ?? null,
        })),
        rateLimit: { cost: ids.length, limit: 5000, remaining: 4000 },
      };
    },
  };
}

test("a gateway failure splits the id batch until every half fits, in request order", async () => {
  const ids = Array.from({ length: 25 }, (_, index) => `PR_${index}`);
  const client = fakeExecutor(6);
  const data = await executeNodeBatch(client, QUERY, ids, {
    reviewStates: ["APPROVED"],
  });
  expect((data.nodes as { id: string }[]).map((node) => node.id)).toEqual(ids);
  // 25 -> 13 + 12 -> 7 + 6 + 6 + 6 -> 4 + 3: eight requests answered, four
  // refused, every id fetched exactly once and the extra variables kept.
  expect(client.calls.map((call) => call.length)).toEqual([
    25, 13, 7, 4, 3, 6, 12, 6, 6,
  ]);
  const served = client.calls.filter((call) => call.length <= 6).flat();
  expect([...served].sort()).toEqual([...ids].sort());
  expect(
    (data.nodes as { states: unknown }[]).every(
      (node) => Array.isArray(node.states) && node.states[0] === "APPROVED",
    ),
  ).toBe(true);
});

test("a single id that still fails upstream rethrows, and other errors never split", async () => {
  const single = fakeExecutor(0);
  await expect(
    executeNodeBatch(single, QUERY, ["PR_1"]),
  ).rejects.toBeInstanceOf(GraphqlUpstreamError);
  expect(single.calls).toEqual([["PR_1"]]);
  const calls: string[][] = [];
  const other = {
    execute: async (
      _document: string,
      variables: Record<string, unknown> = {},
    ) => {
      calls.push(variables.ids as string[]);
      throw new Error("GitHub GraphQL rejected the leaderboard query");
    },
  };
  await expect(
    executeNodeBatch(other, QUERY, ["PR_1", "PR_2", "PR_3"]),
  ).rejects.toThrow("rejected the leaderboard query");
  expect(calls).toEqual([["PR_1", "PR_2", "PR_3"]]);
});

test("the client reports an exhausted 502/504 gateway answer as an upstream error with its status", async () => {
  let attempts = 0;
  const gateway = async (_input: RequestInfo | URL, _init?: RequestInit) => {
    attempts += 1;
    return new Response("<html><body>504 Gateway Time-out</body></html>", {
      status: 504,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  const client = new GitHubGraphqlClient("fixture-token", gateway, {
    retryBaseDelayMs: 0,
  });
  const failure = await client.execute(QUERY, { ids: ["PR_1"] }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(GraphqlUpstreamError);
  expect((failure as GraphqlUpstreamError).status).toBe(504);
  expect(attempts).toBe(MAX_GRAPHQL_REQUEST_ATTEMPTS);

  // A non-gateway HTML answer stays an ordinary failure, so nothing splits.
  const forbidden = async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response("<html>403</html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    });
  const strict = new GitHubGraphqlClient("fixture-token", forbidden, {
    retryBaseDelayMs: 0,
  });
  const plain = await strict.execute(QUERY, { ids: ["PR_1"] }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(plain).toBeInstanceOf(Error);
  expect(plain).not.toBeInstanceOf(GraphqlUpstreamError);
});
