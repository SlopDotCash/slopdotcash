/// The generation budget must bound every GitHub request the collector makes.
///
/// `#executeRequest` sends two kinds of request: GraphQL POSTs and REST
/// `GET /repos/:owner/:name/compare/:base...:head` pages (`compareCommitPage`).
/// The REST pages are how SCR-04 collects every commit above GitHub's
/// 250-commit pull-request listing limit.
///
/// Regression: only the GraphQL branch was admitted through `ensureBudget` and
/// only the GraphQL branch recorded `cost`, so REST comparisons consumed quota
/// that no cost counter and no guard could observe. A snapshot could then spend
/// far more than `MAX_GENERATION_COST` while every recorded value stayed inside
/// it.
import { expect, test } from "bun:test";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { GitHubGraphqlClient } from "./generate-leaderboard";

const TOKEN = "test-only-github-token-value";
const BASE = "a".repeat(40);
const HEAD = "c".repeat(40);
/** The real registry entry the collector uses for comparison pagination. */
const REPOSITORY = TARGET_REPOSITORIES[0] as NonNullable<
  (typeof TARGET_REPOSITORIES)[number]
>;

/** Answers GraphQL with a fixed rateLimit snapshot and REST comparison pages. */
function stubFetch(options: { cost: number; remaining: number }) {
  const calls: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const isRest = !url.endsWith("/graphql");
    calls.push(isRest ? "rest" : "graphql");
    if (isRest) {
      return new Response(
        JSON.stringify({
          total_commits: 1,
          base_commit: { sha: BASE },
          commits: [{ sha: HEAD, author: null }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          rateLimit: {
            cost: options.cost,
            limit: 5_000,
            remaining: options.remaining,
            resetAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
          node: null,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

/** Establishes a rateLimit snapshot, then reports the consumed baseline. */
async function primedClient(options: {
  cost: number;
  remaining: number;
  maxGenerationCost?: number;
}) {
  const stub = stubFetch({ cost: options.cost, remaining: options.remaining });
  const client = new GitHubGraphqlClient(TOKEN, stub.fetch, {
    retryBaseDelayMs: 0,
    ...(options.maxGenerationCost === undefined
      ? {}
      : { maxGenerationCost: options.maxGenerationCost }),
  });
  await client.execute('query { node(id: "x") { id } }');
  return { client, calls: stub.calls };
}

/** Issues REST comparison pages until one throws, returning what happened. */
async function pageUntilFailure(
  client: GitHubGraphqlClient,
  limit: number,
): Promise<{ admitted: number; error: Error | null }> {
  let admitted = 0;
  for (let page = 1; page <= limit; page += 1) {
    try {
      await client.compareCommitPage(REPOSITORY, BASE, HEAD, page);
    } catch (error) {
      return { admitted, error: error as Error };
    }
    admitted += 1;
  }
  return { admitted, error: null };
}

test("a REST comparison page consumes the generation budget", async () => {
  const { client } = await primedClient({ cost: 1, remaining: 4_999 });
  const baseline = client.getRateLimit().consumedDuringRun;

  await client.compareCommitPage(REPOSITORY, BASE, HEAD, 1);

  expect(client.getRateLimit().consumedDuringRun).toBe(baseline + 1);
});

test("every REST page of one comparison is counted", async () => {
  const { client, calls } = await primedClient({ cost: 1, remaining: 4_999 });
  const baseline = client.getRateLimit().consumedDuringRun;

  // A 1000-commit pull request needs ten comparison pages.
  for (let page = 1; page <= 10; page += 1) {
    await client.compareCommitPage(REPOSITORY, BASE, HEAD, page);
  }

  expect(client.getRateLimit().consumedDuringRun).toBe(baseline + 10);
  expect(calls.filter((call) => call === "rest")).toHaveLength(10);
});

test("REST pages alone stop a runaway comparison at the budget", async () => {
  // No GraphQL response ever arrives, so there is no rateLimit snapshot and
  // `ensureBudget` cannot pre-admit from one. The only remaining bound is the
  // recorded cost, which is exactly what the fix adds for REST. The comparison
  // must therefore fail closed once the page count passes the budget.
  const budget = 3;
  const stub = stubFetch({ cost: 1, remaining: 4_999 });
  const client = new GitHubGraphqlClient(TOKEN, stub.fetch, {
    retryBaseDelayMs: 0,
    maxGenerationCost: budget,
  });

  const { admitted, error } = await pageUntilFailure(client, 50);

  expect(error).not.toBeNull();
  expect(error?.message).toContain("safety budget exceeded");
  // The page that crosses the limit is the one that throws, so three pages are
  // admitted and the fourth is refused. Before the fix REST pages recorded
  // nothing, so this loop ran to completion however small the budget was.
  expect(admitted).toBe(budget);
  expect(stub.calls.filter((call) => call === "rest")).toHaveLength(budget + 1);
});

test("GraphQL and REST share one budget rather than separate ones", async () => {
  const { client } = await primedClient({ cost: 3, remaining: 4_997 });
  const afterGraphql = client.getRateLimit().consumedDuringRun;
  expect(afterGraphql).toBe(3);

  await client.compareCommitPage(REPOSITORY, BASE, HEAD, 1);
  await client.execute('query { node(id: "x") { id } }');

  // One REST page plus one GraphQL request, each billed to the same budget.
  expect(client.getRateLimit().consumedDuringRun).toBe(3 + 1 + 3);
});

test("a comparison that never sees a snapshot is still admitted and counted", async () => {
  // Before any GraphQL response there is no rateLimit snapshot, so ensureBudget
  // cannot pre-admit from one and `getRateLimit` is not yet available. The
  // request must still be admitted, and the budget it consumes is what bounds
  // the run once the recorded cost passes `maxGenerationCost` — the pair of
  // behaviours this test and the runaway test above pin down.
  const stub = stubFetch({ cost: 1, remaining: 4_999 });
  const client = new GitHubGraphqlClient(TOKEN, stub.fetch, {
    retryBaseDelayMs: 0,
    maxGenerationCost: 2,
  });

  await client.compareCommitPage(REPOSITORY, BASE, HEAD, 1);
  await client.compareCommitPage(REPOSITORY, BASE, HEAD, 2);

  // No snapshot is loadable, so the cost is only observable through the guard.
  expect(() => client.getRateLimit()).toThrow(
    /rate-limit metadata was not loaded/,
  );
  // The third page pushes the recorded cost past the budget of two and fails
  // closed, which is only possible because REST pages are now counted.
  await expect(
    client.compareCommitPage(REPOSITORY, BASE, HEAD, 3),
  ).rejects.toThrow(/safety budget exceeded/);
  expect(client.getRequestCount()).toBe(3);
});

test("a REST page never waits for a quota reset", async () => {
  // Adopting the GraphQL pre-check on the REST path would make a page wait in
  // `ensureBudget` for up to an hour per page once the window is spent. REST
  // pages are admitted straight away and refused after the response instead, so
  // a spent window fails fast rather than parking the collector.
  //
  // The snapshot reports the reserve as the only remaining quota, which is
  // exactly the condition that drives `ensureBudget` into its wait branch.
  const stub = stubFetch({ cost: 1, remaining: 100 });
  const client = new GitHubGraphqlClient(TOKEN, stub.fetch, {
    retryBaseDelayMs: 0,
    // The default budget, so the wait branch is reached only through the
    // remaining-quota side of the pre-check rather than through the budget.
    maxGenerationCost: 4_900,
  });
  // A GraphQL request first, so the snapshot exists and a reset wait is
  // possible at all.
  await client.execute('query { node(id: "x") { id } }');
  expect(client.getRateLimit().remaining).toBe(100);

  // Ten pages that would each sleep for about an hour if REST were admitted
  // through `ensureBudget`. The test timeout is the assertion: a wait cannot
  // complete inside it.
  for (let page = 1; page <= 10; page += 1) {
    await client.compareCommitPage(REPOSITORY, BASE, HEAD, page);
  }

  expect(stub.calls.filter((call) => call === "rest")).toHaveLength(10);
  expect(client.getRateLimit().consumedDuringRun).toBe(11);
});
