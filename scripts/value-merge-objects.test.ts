import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ValueEvidence } from "../workers/slopbot/value-evidence";
import type { ValueMergeInput } from "../workers/slopbot/value-merge-profile";
import { createValueMergeBundle } from "./create-value-merge-bundle";
import {
  requiredMergeObjects,
  verifyMergeObjectStore,
} from "./value-merge-objects";
import { collectMergeResolutions } from "./value-merge-resolution";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-object-closure-"));
  const full = join(root, "full.git");
  const compact = join(root, "compact.git");
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Object closure fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Object closure fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  const git = (repo: string, args: string[], input?: string | Buffer) =>
    execFileSync("git", ["--git-dir", repo, ...args], {
      env,
      input,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20_000,
    });
  const text = (args: string[], input?: string) =>
    git(full, args, input).toString("utf8").trim();
  git(full, ["init", "--bare", "--template=", full]);
  const blob = (value: string) => text(["hash-object", "-w", "--stdin"], value);
  const tree = (files: [string, string][]) =>
    text(
      ["mktree"],
      files.map(([path, sha]) => `100644 blob ${sha}\t${path}\n`).join(""),
    );
  const commit = (tree: string, parents: string[]) =>
    text(
      ["commit-tree", tree, ...parents.flatMap((sha) => ["-p", sha])],
      "Fixture\n",
    );
  const obsoleteBlob = blob("unrelated historical contents\n");
  const ancestor = commit(tree([["obsolete.txt", obsoleteBlob]]), []);
  const attributes = blob("witness.txt text\n");
  const values = ["base\n", "left\n", "right\n", "resolved\n"].map(blob);
  const trees = values.map((value) =>
    tree([
      [".gitattributes", attributes],
      ["witness.txt", value],
    ]),
  );
  const base = commit(trees[0], [ancestor]);
  const left = commit(trees[1], [base]);
  const right = commit(trees[2], [base]);
  const merged = commit(trees[3], [left, right]);
  const input: ValueMergeInput = {
    repository: "fixture/closure",
    repositoryNodeId: "R_closure",
    repositoryDatabaseId: 1,
    pull: { head: { sha: merged } },
    files: [{ filename: "witness.txt" }],
    commits: [
      { sha: left, parents: [{ sha: base }] },
      { sha: right, parents: [{ sha: base }] },
      { sha: merged, parents: [{ sha: left }, { sha: right }] },
    ],
    commitAttribution: [left, right].map((sha) => ({
      sha,
      changedPaths: ["witness.txt"],
      limitations: [],
    })),
  };
  const selected = [
    ancestor,
    base,
    left,
    right,
    merged,
    ...trees,
    attributes,
    ...values,
  ];
  const pack = (omit?: string, extra: string[] = []) => {
    git(compact, ["init", "--bare", "--template=", compact]);
    const data = git(
      full,
      ["pack-objects", "--stdout"],
      `${[...selected.filter((id) => id !== omit), ...extra].join("\n")}\n`,
    );
    git(compact, ["index-pack", "--stdin"], data);
  };
  return {
    root,
    full,
    compact,
    input,
    pack,
    git,
    ancestor,
    base,
    trees,
    values,
    attributes,
    obsoleteBlob,
  };
}

test("the complete commit graph and required snapshots reproduce the merge without unrelated historical bodies", async () => {
  const f = fixture();
  try {
    f.pack();
    const expected = requiredMergeObjects([f.input], f.full);
    const actual = verifyMergeObjectStore([f.input], f.compact);
    expect(actual).toEqual(expected);
    expect(actual.commits).toContain(f.ancestor);
    expect(actual.blobs).not.toContain(f.obsoleteBlob);
    const full = await collectMergeResolutions(
      f.input as unknown as ValueEvidence,
      f.full,
    );
    const compact = await collectMergeResolutions(
      f.input as unknown as ValueEvidence,
      f.compact,
    );
    expect(compact.mergeResolutions).toEqual(full.mergeResolutions);
    expect(compact.mergeResolutions?.[0].paths).toEqual(["witness.txt"]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

for (const missing of [
  "ancestor",
  "snapshot-tree",
  "changed-blob",
  "attributes",
  "shallow",
  "ordered-parents",
] as const) {
  test(`object closure refuses ${missing} before admitting the merge`, () => {
    const f = fixture();
    try {
      const omit =
        missing === "ancestor"
          ? f.ancestor
          : missing === "snapshot-tree"
            ? f.trees[0]
            : missing === "changed-blob"
              ? f.values[2]
              : missing === "attributes"
                ? f.attributes
                : undefined;
      f.pack(omit);
      if (missing === "shallow")
        writeFileSync(join(f.compact, "shallow"), `${f.base}\n`);
      if (missing === "ordered-parents") f.input.commits[2].parents.reverse();
      expect(() => verifyMergeObjectStore([f.input], f.compact)).toThrow();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test("the builder produces a self-contained operation proof and preserves an existing output", async () => {
  const f = fixture();
  try {
    const output = join(f.root, "proof.bundle");
    await createValueMergeBundle([f.input], f.full, output);
    f.git(f.compact, ["init", "--bare", "--template=", f.compact]);
    f.git(f.compact, ["bundle", "verify", output]);
    f.git(f.compact, ["bundle", "unbundle", output]);
    expect(() =>
      f.git(f.compact, ["cat-file", "-e", f.ancestor]),
    ).not.toThrow();
    expect(() =>
      f.git(f.compact, ["cat-file", "-e", f.obsoleteBlob]),
    ).toThrow();
    expect(verifyMergeObjectStore([f.input], f.compact)).toEqual(
      requiredMergeObjects([f.input], f.full),
    );
    await expect(
      createValueMergeBundle([f.input], f.full, output),
    ).rejects.toThrow();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("raw merge evidence inside the checkout is refused before any write", async () => {
  const f = fixture();
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  // A subdirectory, not the workspace root: the root itself was already caught by
  // the `parent === workspace` half of the guard on every platform.
  const evidence = join(
    workspace,
    "docs",
    "merge-evidence-inside-checkout.bundle",
  );
  try {
    await expect(
      createValueMergeBundle([f.input], f.full, evidence),
    ).rejects.toThrow("Raw merge evidence must stay outside the workspace");
  } finally {
    rmSync(evidence, { force: true });
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a malformed extra object is refused even when reconstruction does not need it", () => {
  const f = fixture();
  try {
    const invalid = f
      .git(
        f.full,
        ["hash-object", "--literally", "-w", "-t", "tree", "--stdin"],
        "invalid tree",
      )
      .toString("utf8")
      .trim();
    f.pack(undefined, [invalid]);
    expect(() => verifyMergeObjectStore([f.input], f.compact)).toThrow();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
