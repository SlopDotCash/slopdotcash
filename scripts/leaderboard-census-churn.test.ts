import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { LeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  collectPullRequestReviewCounts,
  GitHubGraphqlClient,
  ReviewCensusChangedError,
  runGenerator,
} from "./generate-leaderboard";

const OLD = "PR_kwDOTqq9Pc8AAAABK8yypA";
const CURRENT = "PR_current_fixture";
const updatedAt = "2026-10-27T07:00:00Z";

function response(id: string, missing: boolean, request: number) {
  return {
    data: {
      nodes: [
        missing
          ? null
          : {
              __typename: "PullRequest",
              id,
              updatedAt,
              reviews: { totalCount: 2 },
            },
      ],
      rateLimit: {
        cost: 1,
        limit: 5000,
        remaining: 5000 - request,
        resetAt: "2099-01-01T00:00:00Z",
      },
    },
    ...(missing
      ? {
          errors: [
            {
              type: "NOT_FOUND",
              path: ["nodes", 0],
              message: `Could not resolve to a node with the global id of '${id}'.`,
            },
          ],
        }
      : {}),
  };
}

async function harness(
  answer: (request: number, ids: string[]) => unknown,
  run: (input: {
    client: GitHubGraphqlClient;
    output: string;
    snapshot: LeaderboardSnapshot;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "slop-census-churn-"));
  const output = join(root, "leaderboard.json");
  const prior = "retained published bytes\n";
  await writeFile(output, prior);
  const snapshot = JSON.parse(
    gunzipSync(
      await readFile(
        new URL(
          "../tests/fixtures/leaderboard-2026-10-16.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  ) as LeaderboardSnapshot;
  let requests = 0;
  let censusRequests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { variables: { ids: string[] } };
      requests += 1;
      if (!body.variables.ids)
        return Response.json({
          data: {
            rateLimit: {
              cost: 0,
              limit: 5000,
              remaining: 5000,
              resetAt: "2099-01-01T00:00:00Z",
            },
          },
        });
      censusRequests += 1;
      return Response.json(answer(censusRequests, body.variables.ids));
    },
  });
  const client = new GitHubGraphqlClient(
    "disposable-fixture-token",
    async (_, init) => fetch(`http://127.0.0.1:${server.port}/graphql`, init),
    { retryBaseDelayMs: 0 },
  );
  try {
    await client.execute(
      "query CensusBudget { rateLimit { cost limit remaining resetAt } }",
    );
    await run({ client, output, snapshot });
    expect(client.getRequestCount()).toBe(requests);
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}

test("a vanished census PR discards the collection and publishes only a complete fresh collection", async () => {
  await harness(
    (request, ids) => {
      const body = response(ids[0], request === 2, request);
      body.data.nodes.push({
        __typename: "PullRequest",
        id: ids[1],
        updatedAt,
        reviews: { totalCount: request <= 2 ? 1 : 3 },
      });
      return body;
    },
    async ({ client, output, snapshot }) => {
      let collections = 0;
      let writes = 0;
      const collected: string[][] = [];
      await runGenerator(output, {
        getToken: async () => "disposable-fixture-token",
        createClient: () => client,
        generate: async (currentClient) => {
          collections += 1;
          const refs = [
            { id: collections === 1 ? OLD : CURRENT },
            { id: "PR_surviving_fixture" },
          ];
          const initial = await collectPullRequestReviewCounts(
            currentClient,
            refs,
          );
          collected.push([...initial.keys()]);
          const final = await collectPullRequestReviewCounts(
            currentClient,
            refs,
          );
          expect([...final]).toEqual([...initial]);
          expect(final.get("PR_surviving_fixture")?.reviewCount).toBe(3);
          return snapshot;
        },
        write: async (complete, path) => {
          expect(collections).toBe(2);
          expect(await readFile(path, "utf8")).toBe(
            "retained published bytes\n",
          );
          writes += 1;
          await writeFile(path, JSON.stringify(complete));
        },
      });
      expect(collections).toBe(2);
      expect(collected).toEqual([
        [OLD, "PR_surviving_fixture"],
        [CURRENT, "PR_surviving_fixture"],
      ]);
      expect(writes).toBe(1);
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(snapshot);
      expect(client.getRateLimit().consumedDuringRun).toBe(4);
    },
  );
});

test("persistent missing census evidence leaves the published snapshot untouched after one recollection", async () => {
  await harness(
    (request, ids) => response(ids[0], true, request),
    async ({ client, output, snapshot }) => {
      let collections = 0;
      let writes = 0;
      await expect(
        runGenerator(output, {
          getToken: async () => "disposable-fixture-token",
          createClient: () => client,
          generate: async (currentClient) => {
            collections += 1;
            await collectPullRequestReviewCounts(currentClient, [{ id: OLD }]);
            return snapshot;
          },
          write: async () => {
            writes += 1;
          },
        }),
      ).rejects.toBeInstanceOf(ReviewCensusChangedError);
      expect(collections).toBe(2);
      expect(writes).toBe(0);
      expect(await readFile(output, "utf8")).toBe("retained published bytes\n");
      expect(client.getRateLimit().consumedDuringRun).toBe(2);
    },
  );
});

test.each(["authorization failure", "different missing identity"])(
  "%s cannot be reclassified as a changed census",
  async (kind) => {
    await harness(
      (request, ids) => {
        const body = response(ids[0], true, request);
        if (kind === "authorization failure")
          body.errors?.push({
            type: "FORBIDDEN",
            path: ["nodes", 0],
            message: "Access denied",
          });
        else if (body.errors)
          body.errors[0].message = `Could not resolve to a node with the global id of '${CURRENT}'.`;
        return body;
      },
      async ({ client, output, snapshot }) => {
        let collections = 0;
        await expect(
          runGenerator(output, {
            getToken: async () => "disposable-fixture-token",
            createClient: () => client,
            generate: async (currentClient) => {
              collections += 1;
              await collectPullRequestReviewCounts(currentClient, [
                { id: OLD },
              ]);
              return snapshot;
            },
            write: async () => {
              throw new Error("Must not publish missing evidence");
            },
          }),
        ).rejects.toThrow("rejected the leaderboard query");
        expect(collections).toBe(1);
        expect(await readFile(output, "utf8")).toBe(
          "retained published bytes\n",
        );
      },
    );
  },
);
