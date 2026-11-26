import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ValueEvidence } from "../workers/slopbot/value-evidence-types";
import type { ValueMergeInput } from "../workers/slopbot/value-merge-profile";
import { createValueMergeBundle } from "./create-value-merge-bundle";
import {
  requiredMergeObjects,
  verifyMergeObjectStore,
} from "./value-merge-objects";
import {
  collectMergeResolutions,
  collectVerifiedMergeResolutionBatch,
  collectVerifiedMergeResolutions,
} from "./value-merge-resolution";

function fixture(
  obsoleteContents: string | Buffer = "unrelated historical contents\n",
) {
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
  const obsoleteBlob = git(
    full,
    ["hash-object", "-w", "--stdin"],
    obsoleteContents,
  )
    .toString("utf8")
    .trim();
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

test("a dot-prefixed child cannot receive raw merge evidence", async () => {
  const f = fixture();
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const directory = mkdtempSync(join(workspace, "..merge-evidence-"));
  try {
    await expect(
      createValueMergeBundle(
        [f.input],
        f.full,
        join(directory, "proof.bundle"),
      ),
    ).rejects.toThrow("Raw merge evidence must stay outside the workspace");
  } finally {
    rmSync(directory, { recursive: true, force: true });
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

for (const binary of [false, true]) {
  test(`selected file recovery preserves immutable requested ${binary ? "binary" : "text"} snapshots`, async () => {
    const expectedBytes = binary
      ? Buffer.from([0x1f, 0x8b, 0, 0xff, 0x80])
      : Buffer.from("unrelated historical contents\n");
    const f = fixture(expectedBytes);
    try {
      const request = {
        repository: f.input.repository,
        repositoryNodeId: f.input.repositoryNodeId,
        ref: f.ancestor,
        path: "obsolete.txt",
      };
      const output = join(f.root, "recovery.bundle");
      await createValueMergeBundle([f.input], f.full, output, [request]);
      f.git(f.compact, ["init", "--bare", "--template=", f.compact]);
      f.git(f.compact, ["bundle", "unbundle", output]);
      expect(
        verifyMergeObjectStore([f.input], f.compact, [request]).blobs,
      ).toContain(f.obsoleteBlob);
      const { recoverValueFiles } = await import("./value-file-recovery");
      const { verifiedValueFileClient } = await import(
        "../workers/slopbot/value-file-recovery"
      );
      const proof = recoverValueFiles(f.compact, [request]);
      const client = await verifiedValueFileClient<{
        get<T>(path: string): Promise<T | null>;
        verifiedFile?: import("../workers/slopbot/value-evidence-types").EvidenceClient["verifiedFile"];
      }>({ get: async () => null }, [request], proof);
      const bytes = await client.verifiedFile?.(
        request.repository,
        request.ref,
        request.path,
      );
      expect(bytes?.bytes).toEqual(new Uint8Array(expectedBytes));
      expect(
        await client.verifiedFile?.(
          request.repository,
          request.ref,
          "witness.txt",
        ),
      ).toBeNull();
      expect(() =>
        requiredMergeObjects([f.input], f.full, [
          { ...request, repositoryNodeId: "R_wrong" },
        ]),
      ).toThrow();
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test("shared nested trees retain each requested path and merge attributes without following gitlinks", () => {
  const f = fixture();
  try {
    const write = (type: string, bytes: string | Buffer) =>
      f
        .git(f.full, ["hash-object", "-w", "-t", type, "--stdin"], bytes)
        .toString("utf8")
        .trim();
    const selected = write("blob", "selected nested bytes\n");
    const attributes = write("blob", "*.txt text\n");
    const symlink = write("blob", "../selected.txt");
    const subtree = f
      .git(
        f.full,
        ["mktree"],
        `100644 blob ${attributes}\t.gitattributes\n` +
          `120000 blob ${symlink}\tlink\n` +
          `100755 blob ${selected}\tselected.txt\n` +
          `160000 commit ${f.ancestor}\tsubmodule\n`,
      )
      .toString("utf8")
      .trim();
    const root = f
      .git(
        f.full,
        ["mktree"],
        `040000 tree ${subtree}\tfirst\n040000 tree ${subtree}\tsecond\n`,
      )
      .toString("utf8")
      .trim();
    const head = f
      .git(
        f.full,
        ["commit-tree", root, "-p", f.input.pull.head.sha],
        "Nested\n",
      )
      .toString("utf8")
      .trim();
    const input = {
      ...f.input,
      pull: { head: { sha: head } },
      files: [],
      commits: [],
      commitAttribution: [],
    };
    const request = {
      repository: input.repository,
      repositoryNodeId: input.repositoryNodeId,
      ref: head,
      path: "second/selected.txt",
    };
    const closure = requiredMergeObjects([input], f.full, [request]);
    expect(closure.trees.filter((sha) => sha === subtree)).toHaveLength(1);
    expect(closure.blobs).toContain(selected);
    expect(closure.blobs).toContain(attributes);
    expect(closure.blobs).not.toContain(symlink);
    expect(closure.blobs).not.toContain(f.ancestor);
    expect(
      requiredMergeObjects([input], f.full, [
        { ...request, path: "first/link" },
      ]).blobs,
    ).not.toContain(symlink);
    expect(
      requiredMergeObjects([input], f.full, [
        { ...request, path: "first/submodule/file.txt" },
      ]).blobs,
    ).not.toContain(selected);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("snapshot parsing refuses invalid UTF-8 paths", () => {
  const f = fixture();
  try {
    const tree = Buffer.concat([
      Buffer.from("100644 "),
      Buffer.from([0xff]),
      Buffer.from([0]),
      Buffer.from(f.values[0], "hex"),
    ]);
    const root = f
      .git(
        f.full,
        ["hash-object", "--literally", "-w", "-t", "tree", "--stdin"],
        tree,
      )
      .toString("utf8")
      .trim();
    const head = f
      .git(f.full, ["commit-tree", root], "Invalid UTF-8 path\n")
      .toString("utf8")
      .trim();
    expect(() =>
      requiredMergeObjects(
        [{ ...f.input, pull: { head: { sha: head } }, commits: [], files: [] }],
        f.full,
      ),
    ).toThrow();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("batch reconstruction preserves repeated source results and rechecks each source inventory", async () => {
  const f = fixture();
  try {
    const expected = await collectVerifiedMergeResolutions(f.input, f.full);
    const results = await collectVerifiedMergeResolutionBatch(
      [f.input, { ...f.input, files: [] }],
      f.full,
    );
    expect(results).toEqual([expected, expected]);
    const changedPaths = structuredClone(f.input);
    changedPaths.commitAttribution[0].changedPaths = [];
    await expect(
      collectVerifiedMergeResolutionBatch([f.input, changedPaths], f.full),
    ).rejects.toThrow("Git paths differ");
    const changedParents = structuredClone(f.input);
    changedParents.commits[2].parents.reverse();
    await expect(
      collectVerifiedMergeResolutionBatch([f.input, changedParents], f.full),
    ).rejects.toThrow("ordered source parents");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("batch inventories retain empty root and ordinary commits", async () => {
  const f = fixture();
  try {
    const tree = f.git(f.full, ["mktree"], "").toString("utf8").trim();
    const root = f
      .git(f.full, ["commit-tree", tree], "Empty root\n")
      .toString("utf8")
      .trim();
    const next = f
      .git(f.full, ["commit-tree", tree, "-p", root], "Empty child\n")
      .toString("utf8")
      .trim();
    const input = {
      ...f.input,
      pull: { head: { sha: next } },
      files: [],
      commits: [
        { sha: root, parents: [] },
        { sha: next, parents: [{ sha: root }] },
      ],
      commitAttribution: [root, next].map((sha) => ({
        sha,
        changedPaths: [],
        limitations: [],
      })),
    };
    expect(
      await collectVerifiedMergeResolutionBatch([f.input, input], f.full),
    ).toEqual([await collectVerifiedMergeResolutions(f.input, f.full), []]);
    await expect(
      collectVerifiedMergeResolutionBatch([], f.full),
    ).rejects.toThrow("Complete merge inputs");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
