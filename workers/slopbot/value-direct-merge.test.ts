import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { collectAcceptedDirectMerge } from "./value-direct-merge";
import type { EvidenceClient, FileChange } from "./value-evidence";

const HEAD = "1".repeat(40);
const BASE = "2".repeat(40);
const MERGE = "3".repeat(40);
const REPO = "example/repo";

function blob(n: string): string {
  return n.repeat(40);
}

function gitTreeSha(
  entries: { mode: string; name: string; sha: string }[],
): string {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const chunks: Buffer[] = [];
  for (const e of sorted) {
    const head = Buffer.from(`${e.mode} ${e.name}\0`, "utf8");
    chunks.push(head, Buffer.from(e.sha, "hex"));
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.from(`tree ${body.length}\0`, "utf8");
  return createHash("sha1")
    .update(Buffer.concat([header, body]))
    .digest("hex");
}

function tree(files: { name: string; sha: string; mode?: string }[]): {
  treeSha: string;
  entries: unknown[];
} {
  const entries = files.map((f) => ({
    path: f.name,
    mode: f.mode ?? "100644",
    type: "blob",
    sha: f.sha,
  }));
  return {
    treeSha: gitTreeSha(
      entries.map((e) => ({ mode: e.mode, name: e.path, sha: e.sha })),
    ),
    entries,
  };
}

function clientFor(
  headTree: ReturnType<typeof tree>,
  mergeTree: ReturnType<typeof tree>,
): EvidenceClient {
  const commits = new Map([
    [HEAD, headTree.treeSha],
    [MERGE, mergeTree.treeSha],
  ]);
  const trees = new Map([
    [headTree.treeSha, headTree],
    [mergeTree.treeSha, mergeTree],
  ]);
  return {
    async get<T>(path: string): Promise<T | null> {
      const commit = path.match(/\/git\/commits\/([a-f0-9]{40})$/);
      if (commit) {
        const treeSha = commits.get(commit[1]);
        return treeSha
          ? ({ sha: commit[1], tree: { sha: treeSha } } as T)
          : null;
      }
      const treeMatch = path.match(/\/git\/trees\/([a-f0-9]{40})/);
      if (treeMatch) {
        const t = trees.get(treeMatch[1]);
        return t
          ? ({ sha: t.treeSha, truncated: false, tree: t.entries } as T)
          : null;
      }
      return null;
    },
  };
}

function file(filename: string, status = "added"): FileChange {
  return {
    filename,
    status,
    additions: 1,
    deletions: 0,
    blob_url: null,
  };
}

const merge = { sha: MERGE, parents: [{ sha: BASE }, { sha: HEAD }] };
const a = blob("a");
const b = blob("b");
const c = blob("c");

test("identical merge tree proves every submitted file", async () => {
  const head = tree([
    { name: "a.ts", sha: a },
    { name: "b.ts", sha: b },
    { name: "c.ts", sha: c },
  ]);
  const proof = await collectAcceptedDirectMerge(
    clientFor(head, head),
    REPO,
    HEAD,
    [file("a.ts"), file("b.ts"), file("c.ts")],
    merge,
  );
  expect(proof).toEqual({
    headSha: HEAD,
    mergeSha: MERGE,
    parentSha: BASE,
    files: [
      { path: "a.ts", blobSha: a, mode: "100644" },
      { path: "b.ts", blobSha: b, mode: "100644" },
      { path: "c.ts", blobSha: c, mode: "100644" },
    ],
  });
});

test("dropped file fails the proof", async () => {
  const head = tree([
    { name: "a.ts", sha: a },
    { name: "b.ts", sha: b },
    { name: "c.ts", sha: c },
  ]);
  const merged = tree([
    { name: "a.ts", sha: a },
    { name: "b.ts", sha: b },
  ]);
  expect(
    await collectAcceptedDirectMerge(
      clientFor(head, merged),
      REPO,
      HEAD,
      [file("a.ts"), file("b.ts"), file("c.ts")],
      merge,
    ),
  ).toBeNull();
});

test("rewritten file and mode flip fail the proof", async () => {
  const head = tree([
    { name: "a.ts", sha: a },
    { name: "c.ts", sha: c },
  ]);
  const rewritten = tree([
    { name: "a.ts", sha: a },
    { name: "c.ts", sha: blob("d") },
  ]);
  const flipped = tree([
    { name: "a.ts", sha: a },
    { name: "c.ts", sha: c, mode: "100755" },
  ]);
  const files = [file("a.ts"), file("c.ts")];
  expect(
    await collectAcceptedDirectMerge(
      clientFor(head, rewritten),
      REPO,
      HEAD,
      files,
      merge,
    ),
  ).toBeNull();
  expect(
    await collectAcceptedDirectMerge(
      clientFor(head, flipped),
      REPO,
      HEAD,
      files,
      merge,
    ),
  ).toBeNull();
});

test("removed file present in either tree fails, absent in both proves", async () => {
  const head = tree([
    { name: "a.ts", sha: a },
    { name: "old.ts", sha: blob("f") },
  ]);
  const merged = tree([
    { name: "a.ts", sha: a },
    { name: "old.ts", sha: blob("f") },
  ]);
  expect(
    await collectAcceptedDirectMerge(
      clientFor(head, merged),
      REPO,
      HEAD,
      [file("old.ts", "removed")],
      merge,
    ),
  ).toBeNull();
  const empty = tree([]);
  expect(
    await collectAcceptedDirectMerge(
      clientFor(empty, empty),
      REPO,
      HEAD,
      [file("old.ts", "removed")],
      merge,
    ),
  ).toEqual({
    headSha: HEAD,
    mergeSha: MERGE,
    parentSha: BASE,
    files: [{ path: "old.ts", blobSha: null }],
  });
});

test("merge without the head as a parent fails closed", async () => {
  const head = tree([{ name: "a.ts", sha: a }]);
  const badMerge = { sha: MERGE, parents: [{ sha: BASE }, { sha: blob("e") }] };
  expect(
    await collectAcceptedDirectMerge(
      clientFor(head, head),
      REPO,
      HEAD,
      [file("a.ts")],
      badMerge,
    ),
  ).toBeNull();
});
