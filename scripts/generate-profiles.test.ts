/** Exercises publication through the live census entrypoint without network or credentials. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";

const writes = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(),
  rename: vi.fn(async () => undefined),
  writeFile: vi.fn(async (_path: string, _data: string) => undefined),
}));
vi.mock("node:fs/promises", () => ({ ...writes, default: writes }));
vi.mock("node:child_process", () => {
  const mock = { execFileSync: vi.fn(() => "test-token") };
  return { ...mock, default: mock };
});

const originalArgv = process.argv;
afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

async function census(counts: number[], ids = ["PR_one", "PR_two"]) {
  process.argv = ["bun", "generate-profiles.ts", "--live"];
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { variables } = JSON.parse(String(init.body));
      const repo = TARGET_REPOSITORIES.find(
        (entry) =>
          entry.owner === variables.owner && entry.name === variables.name,
      );
      if (!repo) throw new Error("Unexpected repository");
      const first = repo.id === TARGET_REPOSITORIES[0].id;
      const index = variables.after === null ? 0 : 1;
      return new Response(
        JSON.stringify({
          data: {
            rateLimit: { remaining: 5000 },
            repository: {
              id: repo.expectedNodeId,
              pullRequests: {
                totalCount: first ? counts[index] : 0,
                pageInfo: {
                  hasNextPage: first && index === 0,
                  endCursor: first && index === 0 ? "next" : null,
                },
                nodes: first
                  ? [
                      {
                        id: ids[index],
                        state: "OPEN",
                        author: {
                          __typename: "User",
                          id: "U_fixture",
                          login: "octocat",
                          avatarUrl:
                            "https://avatars.githubusercontent.com/u/1",
                        },
                      },
                    ]
                  : [],
              },
            },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
  await import("./generate-profiles");
}

describe("live profile census", () => {
  it("publishes the complete final inventory when new PRs appear mid-crawl", async () => {
    await census([1, 2]);
    expect(writes.rename).toHaveBeenCalledWith(
      "public/data/profiles.json.tmp",
      "public/data/profiles.json",
    );
    const published = JSON.parse(String(writes.writeFile.mock.calls[0]?.[1]));
    expect(published.repositories[0].count).toBe(2);
    expect(published.people[0].repositories[0].open).toBe(2);
  });

  it.each([
    { counts: [2, 1], ids: ["PR_one", "PR_two"], error: /inventory shrank/u },
    {
      counts: [2, 3],
      ids: ["PR_one", "PR_two"],
      error: /count reconciliation failed/u,
    },
    { counts: [2, 2], ids: ["PR_one", "PR_one"], error: /duplicate PR/u },
  ])(
    "never publishes a partial census: $error",
    async ({ counts, ids, error }) => {
      await expect(census(counts, ids)).rejects.toThrow(error);
      expect(writes.writeFile).not.toHaveBeenCalled();
      expect(writes.rename).not.toHaveBeenCalled();
    },
  );
});
