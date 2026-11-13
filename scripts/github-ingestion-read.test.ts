import { expect, test } from "bun:test";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { GitHubClient } from "../workers/slopbot/github";
import { GitHubGraphqlClient } from "./generate-leaderboard";
import { githubIngestionReadTransport } from "./github-ingestion-read";

function fixture(responses: (() => Response)[]) {
  let calls = 0;
  const waits: number[] = [];
  const transport = Object.assign(
    async () => responses[Math.min(calls++, responses.length - 1)](),
    {
      preconnect: fetch.preconnect,
    },
  );
  const client = GitHubClient.forToken(
    "test-token",
    githubIngestionReadTransport(
      transport,
      () => 1_000_000,
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    ),
  );
  return { client, waits, calls: () => calls };
}

test("source reads wait for the reported exhausted REST window and retain the complete answer", async () => {
  const f = fixture([
    () =>
      new Response("limited", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1030" },
      }),
    () =>
      Response.json({
        sha: "a".repeat(40),
        files: [{ filename: "source.ts" }],
      }),
  ]);
  expect(
    await f.client.get<{ sha: string; files: { filename: string }[] }>(
      "/repos/owner/repo/commits/sha",
    ),
  ).toEqual({
    sha: "a".repeat(40),
    files: [{ filename: "source.ts" }],
  });
  expect(f.waits).toEqual([31_000]);
  expect(f.calls()).toBe(2);
});

test("read retries honor Retry-After and remain bounded", async () => {
  const f = fixture([
    () =>
      new Response("limited", { status: 429, headers: { "retry-after": "2" } }),
  ]);
  await expect(f.client.get("/repos/owner/repo")).rejects.toMatchObject({
    status: 429,
  });
  expect(f.calls()).toBe(5);
  expect(f.waits).toEqual([2_000, 2_000, 2_000, 2_000]);
});

const forbiddenHeaders: Record<string, string>[] = [
  {},
  { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "invalid" },
  { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" },
];
for (const headers of forbiddenHeaders) {
  test(`authorization failures are not retried: ${JSON.stringify(headers)}`, async () => {
    const f = fixture([
      () => new Response("forbidden", { status: 403, headers }),
    ]);
    await expect(f.client.get("/repos/owner/repo")).rejects.toMatchObject({
      status: 403,
    });
    expect(f.calls()).toBe(1);
    expect(f.waits).toEqual([]);
  });
}

test("even a configured client never retries GitHub mutations", async () => {
  const f = fixture([
    () =>
      new Response("limited", { status: 429, headers: { "retry-after": "2" } }),
  ]);
  await expect(
    f.client.request("POST", "/repos/owner/repo/issues", {
      title: "not sent again",
    }),
  ).rejects.toMatchObject({ status: 429 });
  expect(f.calls()).toBe(1);
  expect(f.waits).toEqual([]);
});

test("comparison quota waits outlive a request timeout without reusing its aborted signal", async () => {
  let calls = 0;
  const transport = async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    expect(init?.signal?.aborted).toBe(false);
    if (++calls === 1)
      return new Response("limited", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.ceil(Date.now() / 1_000)),
        },
      });
    return Response.json({
      total_commits: 1,
      commits: [{ sha: "a".repeat(40) }],
    });
  };
  const client = new GitHubGraphqlClient("test-token", transport, {
    requestTimeoutMs: 50,
  });
  expect(
    await client.compareCommitPage(
      TARGET_REPOSITORIES[0],
      "a".repeat(40),
      "b".repeat(40),
      1,
    ),
  ).toMatchObject({ total_commits: 1 });
  expect(calls).toBe(2);
});
