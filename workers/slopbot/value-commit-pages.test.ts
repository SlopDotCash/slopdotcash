import { expect, test } from "bun:test";
import { publicationCommitPages } from "./value-commit-pages";

const repository = "/repos/example/project";
const sha = "a".repeat(40);
const path = `${repository}/commits/${sha}?per_page=100&page=1`;
const identity = { id: 42, node_id: "R_example", private: false };
const page = () => ({
  sha,
  html_url: `https://github.com/example/project/commit/${sha}`,
  parents: [{ sha: "b".repeat(40) }],
  stats: { additions: 1, deletions: 0, total: 1 },
  files: [
    {
      filename: "fix.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      patch: "@@ -0,0 +1 @@\n+fixed",
      blob_url: null,
    },
  ],
});

function fixture() {
  const calls: string[] = [];
  const responses = new Map<string, unknown>([
    [repository, identity],
    [path, page()],
  ]);
  const client = {
    async get<T>(key: string): Promise<T | null> {
      calls.push(key);
      const value = responses.get(key);
      if (value instanceof Error) throw value;
      return (value === undefined ? null : structuredClone(value)) as T | null;
    },
  };
  return { calls, responses, client };
}

test("publication shares exact commit pages across independently authorized clients", async () => {
  const f = fixture(),
    cache = publicationCommitPages();
  const first = cache(f.client);
  await first.get(repository);
  const original = await first.get<ReturnType<typeof page>>(path);
  if (!original) throw Error("Missing fixture page");
  original.files[0].patch = "mutated by consumer";
  const second = cache(f.client);
  // A new client must establish its own current public identity first.
  await second.get(repository);
  expect(await second.get<ReturnType<typeof page>>(path)).toEqual(page());
  expect(f.calls.filter((key) => key === path)).toHaveLength(1);
  expect(f.calls.filter((key) => key === repository)).toHaveLength(2);
});

for (const change of [
  null,
  { ...identity, private: true },
  { ...identity, id: 43 },
  { ...identity, node_id: "R_foreign" },
])
  test(`a missing, private or changed repository cannot reuse earlier pages ${JSON.stringify(change)}`, async () => {
    const f = fixture(),
      cache = publicationCommitPages(),
      first = cache(f.client);
    await first.get(repository);
    await first.get(path);
    f.responses.set(repository, change);
    const second = cache(f.client);
    await second.get(repository);
    await second.get(path);
    expect(f.calls.filter((key) => key === path)).toHaveLength(2);
  });

test("PR state, discussions, policy and installation reads remain fresh", async () => {
  const f = fixture(),
    client = publicationCommitPages()(f.client);
  await client.get(repository);
  for (const key of [
    `${repository}/pulls/1`,
    `${repository}/issues/1/comments?per_page=100&page=1`,
    `${repository}/contents/AGENTS.md?ref=${sha}`,
    "/installation/repositories?per_page=100&page=1",
  ]) {
    f.responses.set(key, { version: 1 });
    expect(await client.get<{ version: number }>(key)).toEqual({ version: 1 });
    f.responses.set(key, { version: 2 });
    expect(await client.get<{ version: number }>(key)).toEqual({ version: 2 });
    expect(f.calls.filter((call) => call === key)).toHaveLength(2);
  }
});

for (const value of [
  null,
  new Error("transient"),
  { ...page(), sha: "b".repeat(40) },
  { ...page(), stats: { additions: -1, deletions: 0, total: -1 } },
])
  test(`missing, failed and invalid commit pages are fetched again ${value instanceof Error ? "error" : JSON.stringify(value?.stats)}`, async () => {
    const f = fixture(),
      client = publicationCommitPages()(f.client);
    await client.get(repository);
    f.responses.set(path, value);
    try {
      await client.get(path);
    } catch {}
    f.responses.set(path, page());
    expect(await client.get<ReturnType<typeof page>>(path)).toEqual(page());
    expect(f.calls.filter((key) => key === path)).toHaveLength(2);
  });

test("only full-SHA paginated pages in the verified repository are reused", async () => {
  const f = fixture(),
    client = publicationCommitPages()(f.client);
  await client.get(repository);
  for (const key of [
    `${repository}/commits/main?per_page=100&page=1`,
    `${repository}/commits/${sha}`,
    `${repository}/commits/${sha}?per_page=100&page=0`,
    `/repos/foreign/project/commits/${sha}?per_page=100&page=1`,
  ]) {
    f.responses.set(key, page());
    await client.get(key);
    await client.get(key);
    expect(f.calls.filter((call) => call === key)).toHaveLength(2);
  }
});

test("the page bound retains earlier entries and leaves overflow uncached", async () => {
  const f = fixture(),
    client = publicationCommitPages()(f.client);
  await client.get(repository);
  for (let index = 1; index <= 2049; index++) {
    const key = `${repository}/commits/${sha}?per_page=100&page=${index}`;
    f.responses.set(key, page());
    await client.get(key);
  }
  await client.get(path);
  const overflow = `${repository}/commits/${sha}?per_page=100&page=2049`;
  await client.get(overflow);
  expect(f.calls.filter((key) => key === path)).toHaveLength(1);
  expect(f.calls.filter((key) => key === overflow)).toHaveLength(2);
});

test("complete full-SHA policy bytes are shared while each caller enforces its limit", async () => {
  const f = fixture();
  let reads = 0;
  const base = {
    ...f.client,
    async fileText(
      _owner: string,
      _repo: string,
      _path: string,
      _ref: string,
      maxBytes: number,
    ) {
      reads++;
      return { text: "policy".slice(0, maxBytes), truncated: maxBytes < 6 };
    },
  };
  const cache = publicationCommitPages(),
    first = cache(base);
  await first.get(repository);
  expect(
    await first.fileText("example", "project", "AGENTS.md", sha, 20),
  ).toEqual({ text: "policy", truncated: false });
  const second = cache(base);
  await second.get(repository);
  expect(
    await second.fileText("example", "project", "AGENTS.md", sha, 20),
  ).toEqual({ text: "policy", truncated: false });
  expect(reads).toBe(1);
  expect(
    await second.fileText("example", "project", "AGENTS.md", sha, 2),
  ).toEqual({ text: "po", truncated: true });
  await second.fileText("example", "project", "AGENTS.md", sha, 2);
  expect(reads).toBe(3);
});

for (const value of [
  null,
  { text: "partial", truncated: true },
  new Error("unavailable"),
])
  test(`missing, truncated or failed policy bytes stay fresh ${value instanceof Error ? "failure" : value?.truncated}`, async () => {
    const f = fixture();
    let reads = 0;
    const client = publicationCommitPages()({
      ...f.client,
      async fileText(
        _owner: string,
        _repo: string,
        _path: string,
        _ref: string,
        _maxBytes: number,
      ) {
        reads++;
        if (value instanceof Error) throw value;
        return value;
      },
    });
    await client.get(repository);
    for (let i = 0; i < 2; i++)
      try {
        await client.fileText("example", "project", "AGENTS.md", sha, 20);
      } catch {}
    expect(reads).toBe(2);
  });

test("policy reuse refuses mutable refs and current visibility changes", async () => {
  const f = fixture();
  let reads = 0;
  const client = publicationCommitPages()({
    ...f.client,
    async fileText(
      _owner: string,
      _repo: string,
      _path: string,
      _ref: string,
      _maxBytes: number,
    ) {
      reads++;
      return { text: "policy", truncated: false };
    },
  });
  await client.get(repository);
  for (let i = 0; i < 2; i++)
    await client.fileText("example", "project", "AGENTS.md", "main", 20);
  expect(reads).toBe(2);
  await client.fileText("example", "project", "AGENTS.md", sha, 20);
  f.responses.set(repository, { ...identity, private: true });
  await client.get(repository);
  await client.fileText("example", "project", "AGENTS.md", sha, 20);
  expect(reads).toBe(4);
});

test("the byte bound leaves an oversized complete policy response uncached", async () => {
  const f = fixture();
  let reads = 0;
  const text = "x".repeat(32 * 1024 * 1024);
  const client = publicationCommitPages()({
    ...f.client,
    async fileText(
      _owner: string,
      _repo: string,
      _path: string,
      _ref: string,
      _maxBytes: number,
    ) {
      reads++;
      return { text, truncated: false };
    },
  });
  await client.get(repository);
  for (let i = 0; i < 2; i++)
    await client.fileText("example", "project", "AGENTS.md", sha, text.length);
  expect(reads).toBe(2);
});
