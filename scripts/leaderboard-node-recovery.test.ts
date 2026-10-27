import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { LeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  GitHubGraphqlClient,
  runGenerator,
  SourceNodeUnavailableError,
} from "./generate-leaderboard";

// Publication is the boundary under test; use the retained complete snapshot,
// never an empty substitute for an unsuccessful collection.
const snapshot = JSON.parse(
  gunzipSync(
    readFileSync("tests/fixtures/leaderboard-2026-10-16.json.gz"),
  ).toString(),
) as LeaderboardSnapshot;

function missing(index: number) {
  return {
    type: "NOT_FOUND",
    path: ["nodes", index],
    message: "Could not resolve the requested node",
  };
}

function harness(
  pages: Array<{ data: Record<string, unknown>; errors?: unknown[] }>,
  maxGenerationCost = 100,
) {
  const requests: Array<{ query: string; variables: Record<string, unknown> }> =
    [];
  const client = new GitHubGraphqlClient(
    "fixture-token",
    async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const page = pages[requests.length - 1];
      if (!page) throw new Error("Unexpected extra request");
      return Response.json({
        ...page,
        data: {
          ...page.data,
          rateLimit: {
            cost: 1,
            limit: 5000,
            remaining: 5000 - requests.length,
            resetAt: "2099-01-01T01:00:00Z",
          },
        },
      });
    },
    { maxGenerationCost, retryBaseDelayMs: 0 },
  );
  return { client, requests };
}

describe("leaderboard source-node recovery", () => {
  test("recollects every source after a disappeared node and publishes only the complete new attempt", async () => {
    const { client, requests } = harness([
      { data: { ids: ["retained", "disappeared"] } },
      { data: { nodes: [{ id: "retained" }, null] }, errors: [missing(1)] },
      { data: { ids: ["retained", "replacement"] } },
      { data: { nodes: [{ id: "retained" }, { id: "replacement" }] } },
    ]);
    const completeAttempts: string[][] = [];
    let clients = 0;
    let retries = 0;
    let publications = 0;
    const result = await runGenerator("unused", {
      getToken: async () => "fixture-token",
      createClient: () => {
        clients++;
        return client;
      },
      generate: async (sameClient) => {
        expect(sameClient).toBe(client);
        const census = await sameClient.execute("query Census { ids }");
        const details = await sameClient.execute(
          "query Details($ids:[ID!]!) { nodes(ids:$ids) { id } }",
          { ids: census.ids as string[] },
        );
        completeAttempts.push(
          (details.nodes as Array<{ id: string }>).map((node) => node.id),
        );
        return snapshot;
      },
      write: async () => {
        expect(completeAttempts).toEqual([["retained", "replacement"]]);
        publications++;
      },
      onCensusRetry: () => retries++,
    });
    expect(result).toBe(snapshot);
    expect([clients, retries, publications]).toEqual([1, 1, 1]);
    expect(requests.map(({ variables }) => variables.ids ?? null)).toEqual([
      null,
      ["retained", "disappeared"],
      null,
      ["retained", "replacement"],
    ]);
    expect(client.getRateLimit().consumedDuringRun).toBe(4);
  });

  test("a persistently unavailable source fails after one retry without publishing partial data", async () => {
    const { client } = harness([
      { data: { nodes: [null] }, errors: [missing(0)] },
      { data: { nodes: [null] }, errors: [missing(0)] },
    ]);
    let attempts = 0;
    let publications = 0;
    await expect(
      runGenerator("unused", {
        getToken: async () => "fixture-token",
        createClient: () => client,
        generate: async (sameClient) => {
          attempts++;
          await sameClient.execute(
            "query Details($ids:[ID!]!) { nodes(ids:$ids) { id } }",
            {
              ids: ["inaccessible-or-deleted"],
            },
          );
          return snapshot;
        },
        write: async () => {
          publications++;
        },
      }),
    ).rejects.toBeInstanceOf(SourceNodeUnavailableError);
    expect([attempts, publications]).toEqual([2, 0]);
    expect(client.getRateLimit().consumedDuringRun).toBe(2);
  });

  test("an unavailable-node response cannot bypass the existing rate budget", async () => {
    const { client } = harness(
      [{ data: { nodes: [null] }, errors: [missing(0)] }],
      0,
    );
    let publications = 0;
    await expect(
      runGenerator("unused", {
        getToken: async () => "fixture-token",
        createClient: () => client,
        generate: async (sameClient) => {
          await sameClient.execute(
            "query Details($ids:[ID!]!) { nodes(ids:$ids) { id } }",
            {
              ids: ["missing"],
            },
          );
          return snapshot;
        },
        write: async () => {
          publications++;
        },
      }),
    ).rejects.toThrow("safety budget exceeded");
    expect(client.getRequestCount()).toBe(1);
    expect(client.getRateLimit().consumedDuringRun).toBe(1);
    expect(publications).toBe(0);
  });

  for (const [name, errors, nodes] of [
    ["permission failure", [{ type: "FORBIDDEN", path: ["nodes", 0] }], [null]],
    [
      "mixed errors",
      [missing(0), { type: "INTERNAL", path: ["nodes", 0] }],
      [null],
    ],
    ["unrelated error path", [{ ...missing(0), path: ["repository"] }], [null]],
    ["non-null error position", [missing(0)], [{ id: "requested" }]],
    ["incomplete response", [missing(0)], []],
  ] as const) {
    test(`${name} never becomes a successful census retry`, async () => {
      const { client } = harness([{ data: { nodes }, errors: [...errors] }]);
      let publications = 0;
      await expect(
        runGenerator("unused", {
          getToken: async () => "fixture-token",
          createClient: () => client,
          generate: async (sameClient) => {
            await sameClient.execute(
              "query Details($ids:[ID!]!) { nodes(ids:$ids) { id } }",
              {
                ids: ["requested"],
              },
            );
            return snapshot;
          },
          write: async () => {
            publications++;
          },
        }),
      ).rejects.toThrow("rejected the leaderboard query");
      expect(client.getRequestCount()).toBe(1);
      expect(publications).toBe(0);
    });
  }
});
