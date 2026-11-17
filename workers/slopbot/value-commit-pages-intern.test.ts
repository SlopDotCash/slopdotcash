import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  fixture as valueFixture,
  repository as valueRepository,
} from "../../tests/value-binary-fixture";
import { publicationCommitPages } from "./value-commit-pages";
import { collectValueContext } from "./value-context";
import { collectValueEvidence } from "./value-evidence";
import type { CommitChangeEvidence, FileChange } from "./value-evidence-types";
import {
  valueFileRecoveryCapture,
  verifiedValueFileClient,
} from "./value-file-recovery";
import { valueJsonDigest } from "./value-json-digest";
import { addedValuePatchRecovery } from "./value-patch";

const repository = "/repos/example/project";
const sha = "a".repeat(40);
const path = `${repository}/commits/${sha}?per_page=100&page=1`;
const identity = { id: 42, node_id: "R_example", private: false };
const text = `${"unchanged 😀 e\u0301\r\n".repeat(128)}\ud800\udfff`;
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
      patch: text,
      blob_url: null,
      unknown: { exact: ["\ud800", "😀", null] },
    },
  ],
  unknown: { order: [3, 1, 2] },
});

test("discarded unique text has bounded retained heap and overflow stays intact", () => {
  const module = new URL("./value-commit-pages.ts", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--eval",
      `
    import { heapStats } from "bun:jsc";
    const { publicationCommitPages } = await import(${JSON.stringify(module)});
    const client = publicationCommitPages()({ async get() { return null; } });
    Bun.gc(true);
    const before = heapStats().heapSize;
    for (let index = 0; index < 64; index++) {
      const text = index.toString().padStart(6, "0") + "x".repeat(1024 * 1024);
      if (client.internText(text) !== text) throw new Error("Overflow changed");
    }
    Bun.gc(true);
    console.log(JSON.stringify({ retained: heapStats().heapSize - before }));
  `,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  // The old unbounded pool retains about 64 MiB here; the shared cache budget
  // admits about 16 MiB of ASCII backing strings, including hash-table overhead.
  expect(JSON.parse(result.stdout).retained).toBeLessThan(32 * 1024 * 1024);
});

test("rejected recovery does not intern a patch before its line count agrees", async () => {
  const bytes = new TextEncoder().encode("verified source\n".repeat(256));
  const blob = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  const calls: string[] = [];
  const recover = addedValuePatchRecovery(
    {
      async get<T>(): Promise<T | null> {
        return null;
      },
      async verifiedFile() {
        return { sha: blob, bytes };
      },
      internText(value) {
        calls.push(value);
        return value;
      },
    },
    "example/project",
  );
  const rejected: FileChange = {
    ...page().files[0],
    additions: 255,
    patch: undefined,
  };
  await recover([rejected], sha);
  expect(rejected.patch).toBeUndefined();
  expect(calls).toEqual([]);
  const accepted: FileChange = { ...rejected, additions: 256 };
  await recover([accepted], sha);
  if (typeof accepted.patch !== "string")
    throw new Error("Missing accepted patch");
  expect(accepted.patch).toBe(
    `@@ -0,0 +1,256 @@\n+${"verified source\n+".repeat(255)}verified source`,
  );
  expect(calls).toHaveLength(1);
  expect(calls).toEqual([accepted.patch]);
});

test("raw capture and parsed cache hits intern exact text without losing unknown fields or mutation isolation", async () => {
  const expected = page();
  Object.freeze(expected.files[0]);
  Object.freeze(expected.files);
  Object.freeze(expected);
  const calls: string[] = [];
  let reads = 0;
  const base = {
    internText(value: string) {
      expect(this).toBe(base);
      calls.push(value);
      return value;
    },
    async get<T>(key: string): Promise<T | null> {
      if (key === repository) return identity as T;
      reads++;
      return expected as T;
    },
  };
  const publication = publicationCommitPages();
  const first = valueFileRecoveryCapture(publication(base));
  await first.client.get(repository);
  const original = await first.client.get<ReturnType<typeof page>>(path);
  expect(original).toEqual(expected);
  expect(JSON.stringify(original)).toBe(JSON.stringify(expected));
  expect(valueJsonDigest(original)).toBe(valueJsonDigest(expected));
  expect(calls).toEqual([text]);
  if (!original) throw Error("Missing page");
  original.files[0].patch = "consumer mutation";
  original.unknown.order.reverse();
  const second = valueFileRecoveryCapture(publication(base));
  await second.client.get(repository);
  const saved = await second.client.get<ReturnType<typeof page>>(path);
  expect(saved).toEqual(page());
  expect(valueJsonDigest(saved)).toBe(valueJsonDigest(page()));
  expect(calls).toEqual([text, text]);
  expect(reads).toBe(1);
});

test("an oversized valid page remains fresh while every raw patch reaches the hook", async () => {
  const oversized = "x".repeat(32 * 1024 * 1024);
  let reads = 0;
  let interned = 0;
  const base = {
    internText(value: string) {
      expect(this).toBe(base);
      expect(value.length).toBe(oversized.length);
      interned++;
      return value;
    },
    async get<T>(key: string): Promise<T | null> {
      if (key === repository) return identity as T;
      reads++;
      return {
        ...page(),
        files: [{ ...page().files[0], patch: oversized }],
      } as T;
    },
  };
  const client = publicationCommitPages()(base);
  await client.get(repository);
  for (let i = 0; i < 2; i++)
    expect((await client.get<CommitChangeEvidence>(path))?.files[0].patch).toBe(
      oversized,
    );
  expect(reads).toBe(2);
  expect(interned).toBe(2);
});

test("invalid commit pages and mutable commit paths do not enter raw text interning", async () => {
  const calls: string[] = [];
  const invalid = {
    ...page(),
    stats: { additions: -1, deletions: 0, total: -1 },
  };
  const client = publicationCommitPages()({
    internText(value: string) {
      calls.push(value);
      return value;
    },
    async get<T>(key: string): Promise<T | null> {
      return (key === repository ? identity : invalid) as T;
    },
  });
  await client.get(repository);
  expect(await client.get<typeof invalid>(path)).toEqual(invalid);
  expect(
    await client.get<typeof invalid>(`${repository}/commits/main`),
  ).toEqual(invalid);
  expect(calls).toEqual([]);
});

test("complete pinned file text is interned on fresh reads and cache hits with exact extra fields", async () => {
  const calls: string[] = [];
  let reads = 0;
  const original = { text, truncated: false, unknown: { retained: true } };
  const base = {
    internText(value: string) {
      expect(this).toBe(base);
      calls.push(value);
      return value;
    },
    async get<T>(_key: string): Promise<T | null> {
      return identity as T;
    },
    async fileText(
      _owner: string,
      _repo: string,
      _path: string,
      _ref: string,
      _maxBytes: number,
    ) {
      reads++;
      return Object.freeze(original);
    },
  };
  const client = publicationCommitPages()(base);
  await client.get(repository);
  const first = await client.fileText(
    "example",
    "project",
    "AGENTS.md",
    sha,
    9999,
  );
  expect(first).toEqual(original);
  first.unknown.retained = false;
  const second = await client.fileText(
    "example",
    "project",
    "AGENTS.md",
    sha,
    9999,
  );
  expect(second).toEqual({
    text,
    truncated: false,
    unknown: { retained: true },
  });
  expect(valueJsonDigest(second)).toBe(
    valueJsonDigest({ text, truncated: false, unknown: { retained: true } }),
  );
  expect(reads).toBe(1);
  expect(calls).toEqual([text, text]);
});

test("mutable and truncated policy reads stay fresh and do not enter text interning", async () => {
  let reads = 0;
  let interned = 0;
  const client = publicationCommitPages()({
    internText(value: string) {
      interned++;
      return value;
    },
    async get<T>(_key: string): Promise<T | null> {
      return identity as T;
    },
    async fileText(
      _owner: string,
      _repo: string,
      _path: string,
      ref: string,
      _maxBytes: number,
    ) {
      reads++;
      return { text, truncated: ref === sha };
    },
  });
  await client.get(repository);
  for (const ref of ["main", sha])
    for (let i = 0; i < 2; i++)
      await client.fileText("example", "project", "AGENTS.md", ref, 9999);
  expect(reads).toBe(4);
  expect(interned).toBe(0);
});

test("the same detached hook survives verified recovery, normalized collection and context", async () => {
  const fixture = valueFixture({ direct: true, textOnly: true });
  const calls: string[] = [];
  const base = {
    ...fixture.client,
    internText(value: string) {
      expect(this).toBe(base);
      calls.push(value);
      return value;
    },
  };
  const client = publicationCommitPages()(base);
  const initial = await collectValueEvidence(
    valueFileRecoveryCapture(client).client,
    valueRepository.id,
    1,
    valueRepository,
  );
  expect(initial.limitations).toEqual([]);
  const patch = fixture.files[0].patch;
  expect(calls.filter((value) => value === patch).length).toBeGreaterThan(1);
  const bytes = new TextEncoder().encode("verified context\n".repeat(128));
  const blob = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  const requests = [
    {
      repository: valueRepository.id,
      repositoryNodeId: valueRepository.expectedNodeId ?? "",
      ref: initial.pull.head.sha,
      path: "context.txt",
    },
  ];
  const verified = await verifiedValueFileClient(
    client,
    requests,
    {
      inputSha256: createHash("sha256")
        .update(JSON.stringify(requests))
        .digest("hex"),
      entries: requests.map((request) => ({
        ...request,
        treeSha: "d".repeat(40),
        mode: "100644",
        blobSha: blob,
      })),
      blobs: [
        {
          sha: blob,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
          gzipBase64: gzipSync(bytes).toString("base64"),
        },
      ],
    },
    client.internText,
  );
  expect(verified.internText).toBe(client.internText);
  const detached = verified.internText;
  expect(detached?.(text)).toBe(text);
  const withContext = await collectValueContext(verified, initial, [
    "context.txt",
  ]);
  expect(withContext.contextFiles?.[0].text).toBe(
    new TextDecoder().decode(bytes),
  );
  expect(
    calls.filter((value) => value === new TextDecoder().decode(bytes)),
  ).toHaveLength(2);
});
