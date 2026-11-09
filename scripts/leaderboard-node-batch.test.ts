import { expect, setSystemTime, spyOn, test } from "bun:test";
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

/** A GraphQL transport whose rate-limit answers follow `answers` in order. */
function rateLimitedTransport(
  answers: { remaining: number; resetAt: string }[],
) {
  const requests: number[] = [];
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(Date.now());
    const answer = answers[Math.min(requests.length, answers.length) - 1];
    const { variables } = JSON.parse(String(init?.body));
    return Response.json({
      data: {
        nodes: (variables.ids as string[]).map((id) => ({ id })),
        rateLimit: { cost: 1, limit: 5000, ...answer },
      },
    });
  };
  return { fetcher, requests };
}

test("a window drained by another consumer waits for the reported reset instead of failing", async () => {
  const resetAt = Date.now() + 200;
  const { fetcher, requests } = rateLimitedTransport([
    { remaining: 99, resetAt: new Date(resetAt).toISOString() },
    {
      remaining: 4999,
      resetAt: new Date(resetAt + 3_600_000).toISOString(),
    },
  ]);
  const client = new GitHubGraphqlClient("fixture-token", fetcher);
  await client.execute(QUERY, { ids: ["PR_1"] });
  await client.execute(QUERY, { ids: ["PR_2"] });
  expect(requests).toHaveLength(2);
  expect(requests[1]).toBeGreaterThanOrEqual(resetAt + 1_000);
  expect(client.getRateLimit().remaining).toBe(4999);
});

test("a window still exhausted after its reported reset fails closed", async () => {
  const resetAt = new Date(Date.now() + 200).toISOString();
  const still = rateLimitedTransport([{ remaining: 99, resetAt }]);
  const client = new GitHubGraphqlClient("fixture-token", still.fetcher);
  await client.execute(QUERY, { ids: ["PR_1"] });
  await client.execute(QUERY, { ids: ["PR_2"] });
  await expect(client.execute(QUERY, { ids: ["PR_3"] })).rejects.toThrow(
    `safety budget exceeded after waiting for the reset at ${resetAt}`,
  );
  expect(still.requests).toHaveLength(2);
});

test("a full window drained by another consumer during the run waits instead of failing", async () => {
  const resetAt = Date.now() + 200;
  const { fetcher, requests } = rateLimitedTransport([
    { remaining: 4999, resetAt: new Date(resetAt).toISOString() },
    { remaining: 50, resetAt: new Date(resetAt).toISOString() },
    {
      remaining: 4999,
      resetAt: new Date(resetAt + 3_600_000).toISOString(),
    },
  ]);
  const client = new GitHubGraphqlClient("fixture-token", fetcher);
  await client.execute(QUERY, { ids: ["PR_1"] });
  await client.execute(QUERY, { ids: ["PR_2"] });
  await client.execute(QUERY, { ids: ["PR_3"] });
  expect(requests).toHaveLength(3);
  expect(requests[2]).toBeGreaterThanOrEqual(resetAt + 1_000);
  expect(client.getRateLimit().remaining).toBe(4999);
});

test("multiple valid reset windows can exceed an hour of total waiting", async () => {
  const start = new Date("2026-11-09T00:00:00.000Z").getTime();
  const nativeSetTimeout = globalThis.setTimeout;
  const waits: number[] = [];
  setSystemTime(start);
  // Keep the native overloads and promisified entry point; only long delays
  // use the controlled clock, and every handler is delegated unchanged.
  const advanceTimeout = Object.assign(
    (
      ...[callback, delay, ...args]: Parameters<typeof globalThis.setTimeout>
    ) => {
      if (delay !== undefined && delay >= 60_000) {
        waits.push(delay);
        setSystemTime(Date.now() + delay);
        return nativeSetTimeout(callback, 0, ...args);
      }
      return nativeSetTimeout(callback, delay, ...args);
    },
    { __promisify__: nativeSetTimeout.__promisify__ },
  ) as typeof globalThis.setTimeout;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(
    advanceTimeout,
  );
  try {
    const resetAt = (minutes: number) =>
      new Date(start + minutes * 60_000).toISOString();
    const { fetcher, requests } = rateLimitedTransport([
      { remaining: 99, resetAt: resetAt(40) },
      { remaining: 99, resetAt: resetAt(80) },
      { remaining: 4999, resetAt: resetAt(120) },
    ]);
    const client = new GitHubGraphqlClient("fixture-token", fetcher, {
      requestTimeoutMs: 10_000,
    });
    await client.execute(QUERY, { ids: ["PR_1"] });
    await client.execute(QUERY, { ids: ["PR_2"] });
    await client.execute(QUERY, { ids: ["PR_3"] });
    expect(requests).toHaveLength(3);
    expect(waits).toHaveLength(2);
    expect(waits.reduce((total, wait) => total + wait, 0)).toBeGreaterThan(
      60 * 60_000,
    );
    expect(client.getRateLimit().remaining).toBe(4999);
  } finally {
    timers.mockRestore();
    setSystemTime();
  }
});

test("this run's own window overspend still fails immediately", async () => {
  const { fetcher } = rateLimitedTransport([
    {
      remaining: 4000,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  ]);
  const client = new GitHubGraphqlClient("fixture-token", fetcher, {
    maxGenerationCost: 0,
  });
  await expect(client.execute(QUERY, { ids: ["PR_1"] })).rejects.toThrow(
    "safety budget exceeded (1/0 points consumed",
  );
});
