import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubClient } from "../workers/slopbot/github";
import { MAX_DISCUSSION_CACHE_AGE_MS } from "./github-discussion-cache";
import {
  GitHubIngestionCheckpointError,
  githubIngestionReadTransport,
} from "./github-ingestion-read";

const pullPath = "/repos/owner/repo/pulls/42";
const reviewsPath = `${pullPath}/reviews?per_page=100&page=1`;
const issueCommentsPath =
  "/repos/owner/repo/issues/42/comments?per_page=100&page=1";
const inlineCommentsPath = `${pullPath}/comments?per_page=100&page=1`;
const pullUrl = "https://github.com/owner/repo/pull/42";
const pull = {
  node_id: "PR_42",
  number: 42,
  html_url: pullUrl,
  body: "public description",
  updated_at: "2026-11-14T00:00:00Z",
  state: "closed",
  base: { repo: { node_id: "R_abc", private: false, full_name: "owner/repo" } },
  head: { repo: { private: false } },
};
const publicPaths = new Map<string, unknown>([
  [pullPath, pull],
  [
    reviewsPath,
    [
      {
        node_id: "PRR_1",
        html_url: `${pullUrl}#pullrequestreview-1`,
        body: "review",
        state: "APPROVED",
        submitted_at: "2026-11-14T00:00:00Z",
      },
    ],
  ],
  [
    issueCommentsPath,
    [
      {
        node_id: "IC_1",
        html_url: `${pullUrl}#issuecomment-1`,
        body: "thread",
      },
    ],
  ],
  [
    inlineCommentsPath,
    [
      {
        node_id: "PRRC_1",
        html_url: `${pullUrl}#discussion_r1`,
        body: "inline",
      },
    ],
  ],
]);
const etag = 'W/"123"';

async function withCache(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "slop-discussion-cache-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function client(
  directory: string,
  respond: (path: string, validator: string | null) => Response,
  options: {
    nodeId?: string;
    now?: number;
    token?: string;
    quotaDeadlineMs?: number;
    wait?: (milliseconds: number) => Promise<void>;
    onRead?: (read: ReturnType<typeof githubIngestionReadTransport>) => void;
  } = {},
) {
  const transport = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      return respond(
        url.pathname + url.search,
        new Headers(init?.headers).get("if-none-match"),
      );
    },
    { preconnect: fetch.preconnect },
  );
  const read = githubIngestionReadTransport(
    transport,
    () => options.now ?? 1_000_000,
    options.wait,
    undefined,
    {
      discussionCache: {
        directory,
        repositories: [
          { name: "owner/repo", nodeId: options.nodeId ?? "R_abc" },
        ],
      },
      quotaDeadlineMs: options.quotaDeadlineMs,
    },
  );
  options.onRead?.(read);
  return GitHubClient.forToken(options.token ?? "first-test-token", read);
}

test("a new authenticated run revalidates each canonical discussion before replay", async () => {
  await withCache(async (directory) => {
    const first = client(directory, (path, validator) => {
      expect(validator).toBeNull();
      return Response.json(publicPaths.get(path), { headers: { etag } });
    });
    for (const [path, expected] of publicPaths)
      expect(await first.get<unknown>(path)).toEqual(expected);
    const names = await readdir(directory);
    expect(names).toHaveLength(publicPaths.size);
    for (const name of names) {
      expect(name).toMatch(/^[a-f0-9]{64}\.bin$/u);
      const contents = await readFile(join(directory, name), "utf8");
      expect(contents).not.toContain("first-test-token");
    }
    const calls: string[] = [];
    const resumed = client(
      directory,
      (path, validator) => {
        calls.push(path);
        expect(validator).toBe(etag);
        return new Response(null, {
          status: 304,
          headers: { etag: etag.slice(2) },
        });
      },
      { token: "rotated-test-token" },
    );
    for (const [path, expected] of publicPaths)
      expect(await resumed.get<unknown>(path)).toEqual(expected);
    expect(calls).toEqual([...publicPaths.keys()]);
  });
});

test("changed bytes replace the validator and a mismatched 304 requires fresh bytes", async () => {
  await withCache(async (directory) => {
    const first = client(directory, () =>
      Response.json(pull, { headers: { etag } }),
    );
    await first.get<unknown>(pullPath);
    const edited = { ...pull, body: "Edited discussion" };
    const second = client(directory, (_path, validator) => {
      expect(validator).toBe(etag);
      return Response.json(edited, { headers: { etag: '"edited"' } });
    });
    expect(await second.get<unknown>(pullPath)).toEqual(edited);
    const seen: (string | null)[] = [];
    const third = client(directory, (_path, validator) => {
      seen.push(validator);
      if (validator)
        return new Response(null, {
          status: 304,
          headers: { etag: '"unrelated"' },
        });
      return Response.json(pull);
    });
    expect(await third.get<unknown>(pullPath)).toEqual(pull);
    expect(seen).toEqual(['"edited"', null]);
  });
});

test("cache miss reads live after corruption, expiry or a different immutable repository", async () => {
  await withCache(async (directory) => {
    const first = client(directory, () =>
      Response.json(pull, { headers: { etag } }),
    );
    await first.get<unknown>(pullPath);
    const [name] = await readdir(directory);
    const path = join(directory, name);
    const noValidator = (_path: string, validator: string | null) => {
      expect(validator).toBeNull();
      return Response.json(pull);
    };
    expect(
      await client(directory, noValidator, {
        nodeId: "R_changed",
      }).get<unknown>(pullPath),
    ).toEqual(pull);
    expect(
      await client(directory, noValidator, {
        now: 1_000_001 + MAX_DISCUSSION_CACHE_AGE_MS,
      }).get<unknown>(pullPath),
    ).toEqual(pull);
    const data = await readFile(path, "utf8");
    await writeFile(path, data.replace("public description", "changed bytes"));
    expect(await client(directory, noValidator).get<unknown>(pullPath)).toEqual(
      pull,
    );
  });
});

test("unapproved methods, paths, payloads and HTTP results never warm the checkpoint", async () => {
  await withCache(async (directory) => {
    const forbiddenPaths = [
      "/repos/owner/other/pulls/42",
      "/repositories/100/pulls/42",
      "/repos/owner/repo/issues/42",
      "/repos/owner/repo/pulls/42/files?per_page=100&page=1",
      "/repos/owner/repo/pulls/42?per_page=100&page=1",
      "/repos/owner/repo/pulls/42/reviews?page=1&per_page=100",
    ];
    const wrongPaths = client(directory, () =>
      Response.json(pull, { headers: { etag } }),
    );
    for (const path of forbiddenPaths) await wrongPaths.get<unknown>(path);
    await wrongPaths.request("POST", pullPath);
    for (const value of [
      { ...pull, number: 43 },
      { ...pull, base: { repo: { ...pull.base.repo, private: true } } },
      { ...pull, head: { repo: { private: true } } },
    ]) {
      await client(directory, () =>
        Response.json(value, { headers: { etag } }),
      ).get<unknown>(pullPath);
    }
    await client(directory, () =>
      Response.json(
        [
          {
            node_id: "IC_1",
            html_url: "https://github.com/other/repo/pull/42#issuecomment-1",
            body: "Other repo",
          },
        ],
        { headers: { etag } },
      ),
    ).get<unknown>(issueCommentsPath);
    await client(directory, () =>
      Response.json(pull, { headers: { etag: "not quoted" } }),
    ).get<unknown>(pullPath);
    await client(directory, () =>
      Response.json(pull, { headers: { etag }, status: 404 }),
    ).get<unknown>(pullPath);
    expect(await readdir(directory)).toEqual([]);
  });
});

test("discussion pages require an observed public PR in this transport", async () => {
  await withCache(async (directory) => {
    const expected = publicPaths.get(issueCommentsPath);
    const first = client(directory, (path) =>
      Response.json(publicPaths.get(path), { headers: { etag } }),
    );
    expect(await first.get<unknown>(issueCommentsPath)).toEqual(expected);
    expect(await readdir(directory)).toEqual([]);
    await first.get<unknown>(pullPath);
    await first.get<unknown>(issueCommentsPath);
    expect(await readdir(directory)).toHaveLength(2);

    const second = client(directory, (path, validator) => {
      if (path === pullPath) return new Response(null, { status: 404 });
      expect(validator).toBeNull();
      return Response.json(expected, { headers: { etag } });
    });
    expect(await second.get<unknown>(pullPath)).toBeNull();
    expect(await second.get<unknown>(issueCommentsPath)).toEqual(expected);
  });
});

test("unsubmitted reviews do not enter an otherwise public checkpoint", async () => {
  await withCache(async (directory) => {
    const pending = [
      {
        node_id: "PRR_2",
        html_url: `${pullUrl}#pullrequestreview-2`,
        body: "draft",
        state: "PENDING",
        submitted_at: null,
      },
    ];
    const collector = client(directory, (path) =>
      Response.json(path === pullPath ? pull : pending, { headers: { etag } }),
    );
    await collector.get<unknown>(pullPath);
    expect(await collector.get<unknown>(reviewsPath)).toEqual(pending);
    expect(await readdir(directory)).toHaveLength(1);
  });
});

test("an out-of-window REST reset yields a distinct checkpoint and retains successful work", async () => {
  await withCache(async (directory) => {
    let assertNoCheckpoint = (): void => {
      throw new Error("Expected transport");
    };
    const limited = client(
      directory,
      (path) =>
        path === pullPath
          ? Response.json(pull, { headers: { etag } })
          : new Response(null, {
              status: 403,
              headers: {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": "1030",
              },
            }),
      {
        quotaDeadlineMs: 1_020_000,
        onRead: (read) => {
          assertNoCheckpoint = read.assertNoCheckpoint;
        },
        wait: async () => {
          throw new Error("The reset is beyond this run");
        },
      },
    );
    expect(await limited.get<unknown>(pullPath)).toEqual(pull);
    expect(assertNoCheckpoint).not.toThrow();
    await expect(limited.get<unknown>(reviewsPath)).rejects.toBeInstanceOf(
      GitHubIngestionCheckpointError,
    );
    expect(assertNoCheckpoint).toThrow(GitHubIngestionCheckpointError);
    await expect(limited.get<unknown>(pullPath)).rejects.toBeInstanceOf(
      GitHubIngestionCheckpointError,
    );
    expect(await readdir(directory)).toHaveLength(1);
    const expired = client(
      directory,
      () => {
        throw new Error("No request should run after the checkpoint deadline");
      },
      { quotaDeadlineMs: 999_999 },
    );
    await expect(expired.get<unknown>(pullPath)).rejects.toBeInstanceOf(
      GitHubIngestionCheckpointError,
    );
  });
});
