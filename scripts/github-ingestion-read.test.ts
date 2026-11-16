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
  const transport = Object.assign(
    async () => responses[Math.min(calls++, responses.length - 1)](),
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
  return { client, read, waits, calls: () => calls };
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
