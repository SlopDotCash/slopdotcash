import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { collectAcceptedValueRange } from "./value-accepted-range";
import type { FileChange } from "./value-evidence-types";

const sha = (type: string, bytes: Uint8Array) =>
  createHash("sha1")
    .update(`${type} ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
function fixture(
  options: {
    changedAccepted?: boolean;
    wrongMode?: boolean;
    missingPrior?: boolean;
  } = {},
) {
  const head = "a".repeat(40),
    parent = "b".repeat(40),
    merge = "c".repeat(40);
  const trees = new Map<string, unknown>();
  const roots = new Map<string, string>();
  function bind(ref: string, files: Record<string, string>, mode = "100644") {
    const entries = Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, text]) => ({
        path,
        mode,
        type: "blob",
        sha: sha("blob", Buffer.from(text)),
      }));
    const bytes = Buffer.concat(
      entries.flatMap((e) => [
        Buffer.from(`${e.mode} ${e.path}\0`),
        Buffer.from(e.sha, "hex"),
      ]),
    );
    const id = sha("tree", bytes);
    roots.set(ref, id);
    trees.set(id, { sha: id, truncated: false, tree: entries });
  }
  bind(head, { "dependency.ts": "retained\n", "test.ts": "fixed\n" });
  bind(
    merge,
    {
      "dependency.ts": "retained\n",
      "test.ts": options.changedAccepted ? "wrong\n" : "fixed\n",
    },
    options.wrongMode ? "100755" : "100644",
  );
  bind(parent, {
    "dependency.ts": "retained\n",
    ...(options.missingPrior ? {} : { "test.ts": "partial\n" }),
  });
  const source = (filename: string): FileChange => ({
    filename,
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+fixed",
    blob_url: null,
  });
  const files = [source("dependency.ts"), source("test.ts")];
  const accepted: FileChange = {
    ...source("test.ts"),
    status: "modified",
    deletions: 1,
    patch: "@@ -1 +1 @@\n-partial\n+fixed",
  };
  const client = {
    async get<T>(path: string): Promise<T | null> {
      const commit = /\/git\/commits\/([a-f0-9]{40})$/.exec(path);
      if (commit)
        return { sha: commit[1], tree: { sha: roots.get(commit[1]) } } as T;
      const tree = /\/git\/trees\/([a-f0-9]{40})\?recursive=1$/.exec(path);
      if (tree) return (trees.get(tree[1]) ?? null) as T | null;
      throw Error(path);
    },
  };
  return {
    client,
    head,
    files,
    merge: { sha: merge, parents: [{ sha: parent }], files: [accepted] },
  };
}

test("accepts a submitted added path finalized as modified after partial integration", async () => {
  const f = fixture();
  const result = await collectAcceptedValueRange(
    f.client,
    "example/project",
    f.head,
    f.files,
    f.merge,
  );
  expect(result?.files.map((x) => [x.path, x.alreadyPresent])).toEqual([
    ["dependency.ts", true],
    ["test.ts", false],
  ]);
});
for (const option of ["changedAccepted", "wrongMode", "missingPrior"] as const)
  test(`refuses status transition with ${option}`, async () => {
    const f = fixture({ [option]: true });
    expect(
      await collectAcceptedValueRange(
        f.client,
        "example/project",
        f.head,
        f.files,
        f.merge,
      ),
    ).toBeNull();
  });
