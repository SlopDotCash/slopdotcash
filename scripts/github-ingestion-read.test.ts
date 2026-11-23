import { expect, spyOn, test } from "bun:test";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { GitHubClient } from "../workers/slopbot/github";
import { GitHubGraphqlClient } from "./generate-leaderboard";
import { githubIngestionReadTransport } from "./github-ingestion-read";

function fixture(
  responses: (() => Response)[],
  options: { quotaDeadlineMs?: number; wait?: () => Promise<void> } = {},
) {
  let calls = 0;
  const waits: number[] = [];
  const urls: string[] = [];
  const transport = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return responses[Math.min(calls++, responses.length - 1)]();
    },
    {
      preconnect: fetch.preconnect,
    },
  );
  const read = githubIngestionReadTransport(
    transport,
    () => 1_000_000,
    async (milliseconds) => {
      waits.push(milliseconds);
      await options.wait?.();
    },
    undefined,
    { quotaDeadlineMs: options.quotaDeadlineMs },
  );
  const client = GitHubClient.forToken("test-token", read);
  return { client, read, urls, waits, calls: () => calls };
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

test("quota diagnostics contain only bounded attempt, delay and timestamp fields", async () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const f = fixture([
      () =>
        new Response("private response body", {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1030",
            "x-github-request-id": "private-request-id",
          },
        }),
      () => Response.json({ ok: true }),
    ]);
    await f.client.get("/repos/private-owner/private-source");
    expect(warning.mock.calls).toEqual([
      [
        JSON.stringify({
          event: "github_ingestion_quota_wait",
          attempt: 1,
          maximumAttempts: 5,
          delayMs: 31_000,
          at: "1970-01-01T00:16:40.000Z",
        }),
      ],
    ]);
  } finally {
    warning.mockRestore();
  }
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

const pullFilesPath = "/repos/owner/repo/pulls/7/files?per_page=100&page=1";
const fileReadError = () => new Response("internal error", { status: 500 });

for (const path of [
  pullFilesPath,
  "/repositories/42/pulls/7/files?per_page=100&page=2",
]) {
  test(`PR file reads recover from two HTTP 500 responses at ${path}`, async () => {
    const files = [
      { filename: "source.ts", additions: 9, deletions: 2 },
      { filename: "tests.ts", additions: 5, deletions: 0 },
    ];
    const f = fixture([
      fileReadError,
      fileReadError,
      () => Response.json(files),
    ]);
    expect(await f.client.get<typeof files>(path)).toEqual(files);
    expect(f.calls()).toBe(3);
    expect(f.waits).toEqual([1_000, 2_000]);
  });
}

for (const path of [
  "/repos/owner/repo/pulls/7/reviews?per_page=100&page=1",
  "/repos/owner/repo/pulls/7/comments?per_page=100&page=2",
  "/repos/owner/repo/pulls/7/commits?per_page=100",
  "/repos/owner/repo/issues/7/comments?per_page=100&page=1",
  "/repos/owner/repo/issues/7/events?per_page=100",
  "/repositories/42/issues/7/timeline?per_page=100&page=3",
]) {
  test(`PR and issue list pages recover from two HTTP 500 responses at ${path}`, async () => {
    const page = [{ id: 1 }];
    const f = fixture([
      fileReadError,
      fileReadError,
      () => Response.json(page),
    ]);
    expect(await f.client.get<typeof page>(path)).toEqual(page);
    expect(f.calls()).toBe(3);
    expect(f.waits).toEqual([1_000, 2_000]);
  });
}

for (const path of [
  "/repos/owner/repo/pulls/7",
  "/repos/owner/repo/pulls/7/reviews/9",
  "/repos/owner/repo/issues/7",
  "/repos/owner/repo/issues/comments?per_page=100",
]) {
  test(`other HTTP 500 responses return immediately at ${path}`, async () => {
    const f = fixture([fileReadError]);
    await expect(f.client.get(path)).rejects.toMatchObject({ status: 500 });
    expect(f.calls()).toBe(1);
    expect(f.waits).toEqual([]);
  });
}

test("persistent PR file failures return the complete third HTTP 500 response", async () => {
  const finalBody = { message: "still unavailable", documentation_url: "help" };
  const f = fixture([
    fileReadError,
    fileReadError,
    () => Response.json(finalBody, { status: 500 }),
  ]);
  const response = await f.read(`https://api.github.com${pullFilesPath}`);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual(finalBody);
  expect(f.calls()).toBe(3);
  expect(f.waits).toEqual([1_000, 2_000]);
});

const commitSha = "a".repeat(40);
const commitPath = `/repos/owner/repo/commits/${commitSha}`;
const commitFilesPath = `${commitPath}?per_page=100&page=1`;
const commitReadError = () =>
  Response.json({ message: "Validation Failed" }, { status: 422 });
const commitGatewayError = () => new Response("Bad Gateway", { status: 502 });

for (const path of [
  commitFilesPath,
  `/repositories/42/commits/${commitSha}?per_page=100&page=2`,
]) {
  test(`commit file reads retry HTTP 422 on the same page at ${path}`, async () => {
    const commit = { sha: commitSha, files: [{ filename: "source.ts" }] };
    const f = fixture([commitReadError, () => Response.json(commit)]);
    expect(await f.client.get<typeof commit>(path)).toEqual(commit);
    expect(f.urls).toEqual(Array(2).fill(`https://api.github.com${path}`));
    expect(f.waits).toEqual([1_000]);
  });
}

test("persistent commit file failures return the complete second HTTP 422 response", async () => {
  const finalBody = { message: "Still unavailable", errors: ["commit"] };
  const f = fixture([
    commitReadError,
    () => Response.json(finalBody, { status: 422 }),
  ]);
  const response = await f.read(`https://api.github.com${commitFilesPath}`);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual(finalBody);
  expect(f.calls()).toBe(2);
  expect(f.waits).toEqual([1_000]);
});

for (const path of [
  commitPath,
  "/repos/owner/repo/commits/abcdef0?per_page=100&page=1",
  pullFilesPath,
]) {
  test(`other HTTP 422 responses return immediately at ${path}`, async () => {
    const f = fixture([commitReadError]);
    await expect(f.client.get(path)).rejects.toMatchObject({ status: 422 });
    expect(f.calls()).toBe(1);
    expect(f.waits).toEqual([]);
  });
}

const commitPullsPath = `${commitPath}/pulls?per_page=100`;

test("commit file gateway and validation retries keep their separate budgets on the same page", async () => {
  const commit = { sha: commitSha, files: [{ filename: "source.ts" }] };
  for (const [path, failures, waits] of [
    [
      commitFilesPath,
      [commitGatewayError, commitReadError, commitGatewayError],
      [1_000, 1_000, 2_000],
    ],
    [
      `/repositories/42/commits/${commitSha}?per_page=100&page=2`,
      [commitReadError, commitGatewayError, commitGatewayError],
      [1_000, 1_000, 2_000],
    ],
  ] as const) {
    const f = fixture([...failures, () => Response.json(commit)]);
    expect(await f.client.get<typeof commit>(path)).toEqual(commit);
    expect(f.urls).toEqual(Array(4).fill(`https://api.github.com${path}`));
    expect(f.waits).toEqual([...waits]);
  }
});

test("persistent commit file gateway failures return the complete third response", async () => {
  const body = "GitHub still cannot serve the commit file page";
  const f = fixture([
    commitGatewayError,
    commitGatewayError,
    () => new Response(body, { status: 502, statusText: "Still unavailable" }),
  ]);
  const response = await f.read(`https://api.github.com${commitFilesPath}`);
  expect(response.status).toBe(502);
  expect(response.statusText).toBe("Still unavailable");
  expect(await response.text()).toBe(body);
  expect(f.urls).toEqual(
    Array(3).fill(`https://api.github.com${commitFilesPath}`),
  );
  expect(f.waits).toEqual([1_000, 2_000]);
});

test("commit file gateway and validation retries preserve the quota retry budget", async () => {
  const limited = () =>
    new Response("limited", { status: 429, headers: { "retry-after": "3" } });
  const f = fixture([
    commitGatewayError,
    limited,
    commitReadError,
    commitGatewayError,
    limited,
  ]);
  await expect(f.client.get(commitFilesPath)).rejects.toMatchObject({
    status: 429,
  });
  expect(f.urls).toEqual(
    Array(8).fill(`https://api.github.com${commitFilesPath}`),
  );
  expect(f.waits).toEqual([1_000, 3_000, 1_000, 2_000, 3_000, 3_000, 3_000]);
});

test("HTTP 502 retries need an exact GitHub GET", async () => {
  const url = `https://api.github.com${commitFilesPath}`;
  for (const [input, init] of [
    [`${url}#fragment`, undefined],
    [url.replace("api.github.com", "user:pass@api.github.com"), undefined],
    [url.replace("api.github.com", "example.com"), undefined],
    [url, { method: "POST" }],
  ] as const) {
    const f = fixture([commitGatewayError]);
    expect((await f.read(input, init)).status).toBe(502);
    expect(f.calls()).toBe(1);
    expect(f.waits).toEqual([]);
  }
});

for (const path of [
  "/repos/owner/repo/pulls/2321/commits?per_page=100&page=1",
  "/repos/owner/repo/pulls/7",
  `/repos/owner/repo/commits/${"a".repeat(40)}`,
  "/repositories/42/issues/7/timeline?per_page=100&page=3",
]) {
  for (const status of [502, 503, 504]) {
    test(`GitHub reads recover from two HTTP ${status} responses at ${path}`, async () => {
      const page = [{ id: 1 }];
      const f = fixture([
        () => new Response("gateway", { status }),
        () => new Response("gateway", { status }),
        () => Response.json(page),
      ]);
      expect(await f.client.get<typeof page>(path)).toEqual(page);
      expect(f.calls()).toBe(3);
      expect(f.waits).toEqual([1_000, 2_000]);
    });
  }
}

test("commit file gateway backoff respects the collection checkpoint", async () => {
  const f = fixture([commitGatewayError], { quotaDeadlineMs: 1_001_000 });
  await expect(f.client.get(commitFilesPath)).rejects.toMatchObject({
    name: "GitHubIngestionCheckpointError",
  });
  expect(f.calls()).toBe(1);
  expect(f.waits).toEqual([]);
});

test("caller cancellation during commit file gateway backoff prevents another read", async () => {
  const controller = new AbortController();
  const reason = new Error("caller stopped commit file collection");
  const f = fixture([commitGatewayError], {
    wait: () => {
      queueMicrotask(() => controller.abort(reason));
      return new Promise(() => {});
    },
  });
  await expect(
    f.read(`https://api.github.com${commitFilesPath}`, {
      signal: controller.signal,
    }),
  ).rejects.toBe(reason);
  expect(f.calls()).toBe(1);
  expect(f.waits).toEqual([1_000]);
});

for (const path of [
  commitPullsPath,
  `${commitPullsPath}&page=2`,
  `/repositories/42/commits/${commitSha}/pulls?per_page=100`,
  `/repositories/42/commits/${commitSha}/pulls?per_page=100&page=3`,
]) {
  test(`commit-associated PR reads recover HTTP 500 on the exact URL at ${path}`, async () => {
    const pulls = [
      { node_id: "PR_accepted", number: 7, merged_at: "2026-10-01" },
    ];
    const f = fixture([
      fileReadError,
      fileReadError,
      () => Response.json(pulls),
    ]);
    expect(await f.client.get<typeof pulls>(path)).toEqual(pulls);
    expect(f.urls).toEqual(Array(3).fill(`https://api.github.com${path}`));
    expect(f.waits).toEqual([1_000, 2_000]);
  });
}

test("persistent commit-associated PR failures retain the complete last response", async () => {
  const body = "{incomplete upstream failure";
  const f = fixture([
    fileReadError,
    fileReadError,
    () => new Response(body, { status: 500, statusText: "Still unavailable" }),
  ]);
  const response = await f.read(`https://api.github.com${commitPullsPath}`);
  expect(response.status).toBe(500);
  expect(response.statusText).toBe("Still unavailable");
  expect(await response.text()).toBe(body);
  expect(f.calls()).toBe(3);
  expect(f.waits).toEqual([1_000, 2_000]);
});

test("commit-associated PR retry scope excludes mutable refs and noncanonical queries", async () => {
  const paths = [
    commitPullsPath.replace(commitSha, "main"),
    commitPullsPath.replace(commitSha, commitSha.slice(1)),
    commitPullsPath.replace(commitSha, commitSha.toUpperCase()),
    `${commitPullsPath}&page=0`,
    `${commitPullsPath}&page=01`,
    `${commitPullsPath}&page=1&extra=1`,
    commitPullsPath.replace("per_page=100", "per_page=99"),
    commitPullsPath.replace("?per_page=100", "?page=1&per_page=100"),
    `/repositories/0/commits/${commitSha}/pulls?per_page=100`,
    commitFilesPath,
  ];
  for (const path of paths) {
    const f = fixture([fileReadError]);
    await expect(f.client.get(path)).rejects.toMatchObject({ status: 500 });
    expect(f.calls()).toBe(1);
    expect(f.waits).toEqual([]);
  }
  for (const [url, init] of [
    [`https://example.com${commitPullsPath}`, undefined],
    [`http://api.github.com${commitPullsPath}`, undefined],
    [`https://api.github.com${commitPullsPath}#fragment`, undefined],
    [`https://user:pass@api.github.com${commitPullsPath}`, undefined],
    [`https://api.github.com${commitPullsPath}`, { method: "POST" }],
    [`https://api.github.com${commitPullsPath}`, { method: "PUT" }],
  ] as const) {
    const f = fixture([fileReadError]);
    const response = await f.read(url, init);
    expect(response.status).toBe(500);
    expect(f.calls()).toBe(1);
    expect(f.waits).toEqual([]);
  }
  for (const status of [403, 404, 422]) {
    const f = fixture([
      () => Response.json({ message: "unavailable" }, { status }),
    ]);
    expect(
      (await f.read(`https://api.github.com${commitPullsPath}`)).status,
    ).toBe(status);
    expect(f.calls()).toBe(1);
    expect(f.waits).toEqual([]);
  }
});

test("commit-associated PR pages and later independent reads stay live", async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
  const second = [{ number: 101 }];
  const updated = [{ number: 102 }];
  const f = fixture([
    fileReadError,
    () => Response.json(first),
    fileReadError,
    () => Response.json(second),
    () => Response.json(updated),
  ]);
  const page1 = `${commitPullsPath}&page=1`,
    page2 = `${commitPullsPath}&page=2`;
  expect(await f.client.get<{ number: number }[]>(page1)).toEqual(first);
  expect(await f.client.get<{ number: number }[]>(page2)).toEqual(second);
  expect(await f.client.get<{ number: number }[]>(page1)).toEqual(updated);
  expect(f.urls).toEqual(
    [page1, page1, page2, page2, page1].map(
      (path) => `https://api.github.com${path}`,
    ),
  );
  expect(f.waits).toEqual([1_000, 1_000]);
});

test("commit-associated PR server retries do not reset the quota retry budget", async () => {
  const limited = () =>
    new Response("limited", { status: 429, headers: { "retry-after": "3" } });
  const f = fixture([fileReadError, limited, fileReadError, limited]);
  await expect(f.client.get(commitPullsPath)).rejects.toMatchObject({
    status: 429,
  });
  expect(f.calls()).toBe(7);
  expect(f.waits).toEqual([1_000, 3_000, 2_000, 3_000, 3_000, 3_000]);
  expect(f.urls).toEqual(
    Array(7).fill(`https://api.github.com${commitPullsPath}`),
  );
});

test("commit-associated PR backoff respects the collection deadline on either wait", async () => {
  for (const [deadline, calls, waits] of [
    [1_001_000, 1, []],
    [1_002_000, 2, [1_000]],
  ] as const) {
    const f = fixture([fileReadError], { quotaDeadlineMs: deadline });
    await expect(f.client.get(commitPullsPath)).rejects.toMatchObject({
      name: "GitHubIngestionCheckpointError",
    });
    expect(f.calls()).toBe(calls);
    expect(f.waits).toEqual([...waits]);
    expect(f.read.assertNoCheckpoint).toThrow("checkpoint deadline");
  }
});

test("caller cancellation during commit-associated PR backoff stops the exact read", async () => {
  const controller = new AbortController();
  const reason = new Error("caller stopped association collection");
  const f = fixture([fileReadError], {
    wait: () => {
      queueMicrotask(() => controller.abort(reason));
      return new Promise(() => {});
    },
  });
  await expect(
    f.read(`https://api.github.com${commitPullsPath}`, {
      signal: controller.signal,
    }),
  ).rejects.toBe(reason);
  expect(f.calls()).toBe(1);
  expect(f.waits).toEqual([1_000]);
});

test("an incomplete commit-associated PR error body times out without another attempt", async () => {
  let calls = 0,
    waits = 0;
  const read = githubIngestionReadTransport(
    Object.assign(
      async () => {
        calls++;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial"));
            },
          }),
          { status: 500 },
        );
      },
      { preconnect: fetch.preconnect },
    ),
    Date.now,
    async () => {
      waits++;
    },
    10,
  );
  await expect(
    read(`https://api.github.com${commitPullsPath}`),
  ).rejects.toMatchObject({ name: "TimeoutError" });
  expect(calls).toBe(1);
  expect(waits).toBe(0);
});

test("PR file backoff checkpoints when its first wait would reach the collection deadline", async () => {
  const f = fixture([fileReadError], { quotaDeadlineMs: 1_001_000 });
  await expect(f.client.get(pullFilesPath)).rejects.toMatchObject({
    name: "GitHubIngestionCheckpointError",
  });
  expect(f.calls()).toBe(1);
  expect(f.waits).toEqual([]);
});

test("caller cancellation during PR file backoff prevents another read", async () => {
  const controller = new AbortController();
  const reason = new Error("caller stopped file collection");
  const f = fixture([fileReadError], {
    wait: () => {
      queueMicrotask(() => controller.abort(reason));
      return new Promise(() => {});
    },
  });
  await expect(
    f.read(`https://api.github.com${pullFilesPath}`, {
      signal: controller.signal,
    }),
  ).rejects.toBe(reason);
  expect(f.calls()).toBe(1);
  expect(f.waits).toEqual([1_000]);
});

test("a missing PR file listing returns null without backoff", async () => {
  const f = fixture([() => new Response("missing", { status: 404 })]);
  expect(await f.client.get(pullFilesPath)).toBeNull();
  expect(f.calls()).toBe(1);
  expect(f.waits).toEqual([]);
});

test("GitHub GraphQL POST failures bypass the REST file retry", async () => {
  const f = fixture([fileReadError]);
  await expect(
    f.client.graphql("query { viewer { id } }", {}),
  ).rejects.toMatchObject({
    status: 500,
  });
  expect(f.calls()).toBe(1);
  expect(f.waits).toEqual([]);
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

// GitHub serves a secondary limit as 403 with remaining primary quota; without
// Retry-After its documented guidance is to wait at least one minute.
const secondaryLimitMessages = [
  "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
  "You have triggered an abuse detection mechanism. Please wait a few minutes before you try again.",
];
const remainingQuota = {
  "x-ratelimit-limit": "5000",
  "x-ratelimit-remaining": "4321",
  "x-ratelimit-reset": "4600",
};
for (const message of secondaryLimitMessages) {
  test(`a 403 secondary limit without Retry-After waits one minute: ${message.slice(0, 40)}`, async () => {
    const f = fixture([
      () =>
        Response.json({ message }, { status: 403, headers: remainingQuota }),
      () => Response.json([{ filename: "source.ts" }]),
    ]);
    expect(
      await f.client.get<{ filename: string }[]>(
        "/repos/owner/repo/pulls/7/files?per_page=100&page=1",
      ),
    ).toEqual([{ filename: "source.ts" }]);
    expect(f.waits).toEqual([60_000]);
    expect(f.calls()).toBe(2);
  });
}

test("repeated secondary-limit 403 answers stay bounded and keep the GitHub status", async () => {
  const f = fixture([
    () =>
      Response.json(
        { message: secondaryLimitMessages[0] },
        { status: 403, headers: remainingQuota },
      ),
  ]);
  await expect(f.client.get("/repos/owner/repo")).rejects.toMatchObject({
    status: 403,
  });
  expect(f.calls()).toBe(5);
  expect(f.waits).toEqual([60_000, 60_000, 60_000, 60_000]);
});

test("a JSON 403 that names no rate limit is still an authorization failure", async () => {
  const f = fixture([
    () =>
      Response.json(
        { message: "Resource not accessible by integration" },
        { status: 403, headers: remainingQuota },
      ),
  ]);
  await expect(f.client.get("/repos/owner/repo")).rejects.toMatchObject({
    status: 403,
  });
  expect(f.calls()).toBe(1);
  expect(f.waits).toEqual([]);
});

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

const oid = "a".repeat(40);
const immutablePaths = [
  `/repos/owner/repo/git/commits/${oid}`,
  `/repos/owner/repo/git/trees/${oid}`,
  `/repos/owner/repo/git/trees/${oid}?recursive=1`,
  `/repos/owner/repo/git/blobs/${oid}`,
  `/repos/owner/repo/contents/src/file.ts?ref=${oid}`,
];

test("one collection reuses exact Git identities with independently readable responses", async () => {
  let calls = 0;
  const transport = Object.assign(
    async () => {
      calls++;
      return Response.json({ sha: oid, type: "file", content: "eA==" });
    },
    { preconnect: fetch.preconnect },
  );
  const read = githubIngestionReadTransport(transport);
  for (const path of immutablePaths) {
    const url = `https://api.github.com${path}`;
    const first = await read(url);
    const second = await read(url);
    const firstValue = await first.json();
    firstValue.content = "changed by caller";
    expect(await second.json()).toEqual({
      sha: oid,
      type: "file",
      content: "eA==",
    });
  }
  expect(calls).toBe(immutablePaths.length);
  await githubIngestionReadTransport(transport)(
    `https://api.github.com${immutablePaths[0]}`,
  );
  expect(calls).toBe(immutablePaths.length + 1);
});

test("mutable, ambiguous, conditional and differently authenticated requests stay independent", async () => {
  let calls = 0;
  const read = githubIngestionReadTransport(
    Object.assign(
      async () => {
        calls++;
        return Response.json({ sha: oid, type: "file" });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const paths = [
    "/repos/owner/repo/pulls/1",
    "/repos/owner/repo/pulls/1/reviews",
    "/repos/owner/repo/issues/1/comments",
    "/repos/owner/repo/issues/1/timeline",
    `/repos/owner/repo/commits/${oid}`,
    "/repos/owner/repo/git/trees/main",
    `/repos/owner/repo/git/trees/${oid}?recursive=1&recursive=1`,
    `/repos/owner/repo/git/trees/${oid}?extra=1`,
    `/repos/owner/repo/git/trees/${oid}?recursive=true`,
    `/repos/owner/repo/git/commits/${oid}?ref=${oid}`,
    `/repos/owner/repo/contents/file?ref=${oid}&ref=${oid}`,
    `/repos/owner/repo/contents/file?ref=main`,
    `/repos/owner/repo/contents/file?ref=${oid}&other=1`,
    `/repos/owner/repo/contents/file?other=1&ref=${oid}`,
    `/repos/owner/repo/git/trees/${oid}#fragment`,
  ];
  for (const path of paths) {
    await read(`https://api.github.com${path}`);
    await read(`https://api.github.com${path}`);
  }
  const url = `https://api.github.com${immutablePaths[0]}`;
  const independent: RequestInit[] = [
    { method: "POST" },
    { headers: { Range: "bytes=0-5" } },
    { headers: { "If-None-Match": "old" } },
    { headers: { "If-Modified-Since": "yesterday" } },
    { headers: { "If-Match": "current" } },
    { headers: { "Cache-Control": "no-cache" } },
    { headers: { Pragma: "no-cache" } },
    { integrity: "sha256-alternative" },
    { cache: "no-cache" },
    { cache: "no-store" as const },
    { cache: "reload" as const },
  ];
  for (const init of independent) {
    await read(url, init);
    await read(url, init);
  }
  await read(url.replace("api.github.com", "example.com"));
  await read(url.replace("api.github.com", "example.com"));
  expect(calls).toBe(paths.length * 2 + independent.length * 2 + 2);
  const before = calls;
  for (const authorization of ["Bearer first", "Bearer second"]) {
    await read(url, { headers: { Authorization: authorization } });
    await read(url, { headers: { Authorization: authorization } });
  }
  expect(calls - before).toBe(2);
});

test("missing, failed, malformed and wrong-identity answers never enter the cache", async () => {
  for (const response of [
    () => Response.json({ message: "missing" }, { status: 404 }),
    () => Response.json({ message: "failed" }, { status: 500 }),
    () => new Response("{incomplete", { status: 200 }),
    () => Response.json({ sha: "b".repeat(40) }),
  ]) {
    let calls = 0;
    const read = githubIngestionReadTransport(
      Object.assign(
        async () => {
          calls++;
          return response();
        },
        { preconnect: fetch.preconnect },
      ),
    );
    await read(`https://api.github.com${immutablePaths[0]}`);
    await read(`https://api.github.com${immutablePaths[0]}`);
    expect(calls).toBe(2);
  }
});

test("immutable response retention evicts old bodies within its collection memory budget", async () => {
  let calls = 0;
  const read = githubIngestionReadTransport(
    Object.assign(
      async (input: RequestInfo | URL) => {
        calls++;
        return Response.json({
          sha: String(input).slice(-40),
          content: "x".repeat(9 * 1024 * 1024),
        });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const first = `https://api.github.com/repos/owner/repo/git/blobs/${oid}`;
  const second = first.replace(oid, "b".repeat(40));
  await read(first);
  await read(second);
  await read(first);
  expect(calls).toBe(3);
});

test("REST deadlines cover connection and body waits without retrying a partial response", async () => {
  for (const bodyStalls of [false, true]) {
    let signal: AbortSignal | null | undefined;
    let calls = 0;
    const read = githubIngestionReadTransport(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          calls++;
          signal = init?.signal;
          if (!bodyStalls) return new Promise<Response>(() => {});
          return new Response(new ReadableStream({ start() {} }));
        },
        { preconnect: fetch.preconnect },
      ),
      Date.now,
      async () => {},
      10,
    );
    await expect(
      read(`https://api.github.com${immutablePaths[0]}`),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(signal?.aborted).toBe(true);
    expect(calls).toBe(1);
  }
});

test("quota waits outlive each request deadline and caller cancellation still stops recovery", async () => {
  let calls = 0;
  const controller = new AbortController();
  const reason = new Error("caller stopped collection");
  const transport = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(false);
      if (++calls === 1)
        return new Response("limited", {
          status: 429,
          headers: { "retry-after": "1" },
        });
      return Response.json({ sha: oid });
    },
    { preconnect: fetch.preconnect },
  );
  const read = githubIngestionReadTransport(
    transport,
    Date.now,
    () => new Promise((resolve) => setTimeout(resolve, 30)),
    10,
  );
  expect(
    await (await read(`https://api.github.com${immutablePaths[0]}`)).json(),
  ).toEqual({ sha: oid });
  calls = 0;
  const canceled = githubIngestionReadTransport(
    transport,
    Date.now,
    () => new Promise(() => {}),
    10,
  );
  const result = canceled(`https://api.github.com${immutablePaths[0]}`, {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(reason), 5);
  await expect(result).rejects.toBe(reason);
  expect(calls).toBe(1);
});

test("caller aborts and bodyless responses retain their fetch behavior", async () => {
  const controller = new AbortController();
  const reason = new Error("pre-aborted");
  controller.abort(reason);
  const read = githubIngestionReadTransport(
    Object.assign(async () => new Response(null, { status: 204 }), {
      preconnect: fetch.preconnect,
    }),
  );
  await expect(
    read("https://api.github.com/repos/owner/repo", {
      signal: controller.signal,
    }),
  ).rejects.toBe(reason);
  expect((await read("https://api.github.com/repos/owner/repo")).status).toBe(
    204,
  );
});
