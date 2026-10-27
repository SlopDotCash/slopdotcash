/** Complete object closure for the fixed Git merge operation, without checkout. */
import { execFileSync } from "node:child_process";
import type { ValueMergeInput } from "../workers/slopbot/value-merge-profile";

const OID = /^[a-f0-9]{40}$/u;
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const ordered = (values: Iterable<string>) => [...new Set(values)].sort();

export interface MergeObjectClosure {
  commits: string[];
  trees: string[];
  blobs: string[];
  snapshots: string[];
  expandedBytes: number;
}

interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
}

function gitReader(repository: string) {
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  };
  const git = (args: string[], input?: string) => {
    try {
      return execFileSync("git", ["--git-dir", repository, ...args], {
        env,
        input,
        maxBuffer: MAX_OUTPUT,
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      throw new Error("Required Git merge objects are unavailable");
    }
  };
  return (args: string[], input?: string) => {
    const bytes = git(args, input);
    const result = bytes.toString("utf8");
    if (!Buffer.from(result, "utf8").equals(bytes))
      throw new Error("Git merge metadata is not UTF-8");
    return result;
  };
}

/** Caller supplies server-derived inputs. Missing graph, tree, changed-file or
 * attribute objects always refuse; unrelated historical file bodies are unused. */
export function requiredMergeObjects(
  inputs: readonly ValueMergeInput[],
  repository: string,
): MergeObjectClosure {
  const text = gitReader(repository);
  if (
    !inputs.length ||
    text(["rev-parse", "--is-shallow-repository"]).trim() !== "false"
  )
    throw new Error("Complete Git merge ancestry is required");
  const roots = new Set<string>();
  const snapshots = new Set<string>();
  const commits = new Map<string, string[]>();
  const trees = new Set<string>();
  const blobs = new Set<string>();
  const edges = new Map<string, [string | null, string]>();
  const mergePairs: [string, string][] = [];
  const addRoot = (sha: string) => {
    if (!OID.test(sha)) throw new Error("Invalid Git merge object identity");
    roots.add(sha);
    snapshots.add(sha);
  };
  const addEdge = (before: string | null, after: string) =>
    edges.set(`${before ?? "root"}:${after}`, [before, after]);
  for (const input of inputs) {
    addRoot(input.pull.head.sha);
    for (const commit of input.commits) {
      addRoot(commit.sha);
      for (const parent of commit.parents) {
        addRoot(parent.sha);
        addEdge(parent.sha, commit.sha);
      }
      if (!commit.parents.length) addEdge(null, commit.sha);
      for (let left = 0; left < commit.parents.length; left++)
        for (let right = left + 1; right < commit.parents.length; right++)
          mergePairs.push([
            commit.parents[left].sha,
            commit.parents[right].sha,
          ]);
    }
  }
  for (const row of text(["rev-list", "--parents", ...ordered(roots), "--"])
    .trim()
    .split("\n")) {
    const [sha, ...parents] = row.split(" ");
    if (
      ![sha, ...parents].every((value) => OID.test(value)) ||
      commits.has(sha)
    )
      throw new Error("Invalid Git merge ancestry");
    commits.set(sha, parents);
  }
  for (const [sha, parents] of commits)
    if (parents.some((parent) => !commits.has(parent)))
      throw new Error(`Incomplete Git merge ancestry for ${sha}`);
  for (const input of inputs) {
    if (!commits.has(input.pull.head.sha))
      throw new Error("Git merge head is not a commit");
    for (const commit of input.commits)
      if (
        JSON.stringify(commits.get(commit.sha)) !==
        JSON.stringify(commit.parents.map(({ sha }) => sha))
      )
        throw new Error("Git merge parents differ from source");
  }
  const visited = new Set<string>();
  for (let index = 0; index < mergePairs.length; index++) {
    const pair = mergePairs[index];
    const key = [...pair].sort().join(":");
    if (visited.has(key)) continue;
    visited.add(key);
    const bases = text(["merge-base", "--all", ...pair])
      .trim()
      .split("\n");
    if (
      !bases.length ||
      bases.some((base) => !OID.test(base) || !commits.has(base))
    )
      throw new Error("Git merge base is unavailable");
    for (const base of bases) {
      snapshots.add(base);
      for (const side of pair) addEdge(base, side);
    }
    for (let left = 0; left < bases.length; left++)
      for (let right = left + 1; right < bases.length; right++)
        mergePairs.push([bases[left], bases[right]]);
  }
  const entries = new Map<string, Map<string, TreeEntry>>();
  for (const ref of snapshots) {
    const root = text(["rev-parse", `${ref}^{tree}`]).trim();
    if (!OID.test(root)) throw new Error("Git snapshot tree is unavailable");
    trees.add(root);
    const paths = new Map<string, TreeEntry>();
    const rows = text(["ls-tree", "-r", "-t", "-z", "--full-tree", ref]).split(
      "\0",
    );
    if (rows.pop() !== "") throw new Error("Incomplete Git snapshot listing");
    for (const row of rows) {
      const match =
        /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]{40})\t([\s\S]+)$/u.exec(row);
      if (!match || paths.has(match[4]))
        throw new Error("Invalid Git snapshot listing");
      const [, mode, type, sha, path] = match;
      paths.set(path, { mode, type, sha });
      if (type === "tree") trees.add(sha);
      if (
        type === "blob" &&
        [".gitattributes", ".gitmodules"].includes(path.split("/").at(-1) ?? "")
      )
        blobs.add(sha);
    }
    entries.set(ref, paths);
  }
  for (const input of inputs)
    for (const file of input.files) {
      const entry = entries.get(input.pull.head.sha)?.get(file.filename);
      if (entry?.type === "blob") blobs.add(entry.sha);
    }
  const addChangedObject = (mode: string, sha: string) => {
    if (mode === "000000" && sha === "0".repeat(40)) return;
    if (mode === "160000") return; // A gitlink never grants a submodule fetch.
    if (!["100644", "100755", "120000"].includes(mode) || !OID.test(sha))
      throw new Error("Unsupported changed Git object");
    blobs.add(sha);
  };
  for (const [before, after] of edges.values()) {
    const options = [
      "--raw",
      "--no-abbrev",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "-z",
    ];
    const rows = text(
      before
        ? ["diff", ...options, before, after, "--"]
        : [
            "diff-tree",
            "--root",
            "--no-commit-id",
            "-r",
            ...options,
            after,
            "--",
          ],
    ).split("\0");
    if (rows.pop() !== "" || rows.length % 2)
      throw new Error("Incomplete Git change listing");
    for (let index = 0; index < rows.length; index += 2) {
      const match =
        /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) [AMDTUX]$/u.exec(
          rows[index],
        );
      if (!match || !rows[index + 1])
        throw new Error("Invalid Git change listing");
      addChangedObject(match[1], match[3]);
      addChangedObject(match[2], match[4]);
    }
  }
  const expected = new Map<string, string>();
  for (const [type, values] of [
    ["commit", commits.keys()],
    ["tree", trees],
    ["blob", blobs],
  ] as const)
    for (const sha of values) {
      if (expected.has(sha) && expected.get(sha) !== type)
        throw new Error("Conflicting required Git object types");
      expected.set(sha, type);
    }
  const ids = ordered(expected.keys());
  const rows = text(
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    `${ids.join("\n")}\n`,
  )
    .trim()
    .split("\n");
  if (rows.length !== ids.length)
    throw new Error("Incomplete required Git objects");
  let expandedBytes = 0;
  for (let index = 0; index < rows.length; index++) {
    const match = /^([a-f0-9]{40}) (commit|tree|blob) (\d+)$/u.exec(
      rows[index],
    );
    if (
      !match ||
      match[1] !== ids[index] ||
      match[2] !== expected.get(ids[index])
    )
      throw new Error("Required Git merge object is missing");
    const size = Number(match[3]);
    expandedBytes += size;
    if (
      !Number.isSafeInteger(size) ||
      !Number.isSafeInteger(expandedBytes) ||
      expandedBytes > MAX_EXPANDED
    )
      throw new Error("Required Git object expansion exceeds limit");
  }
  return {
    commits: ordered(commits.keys()),
    trees: ordered(trees),
    blobs: ordered(blobs),
    snapshots: ordered(snapshots),
    expandedBytes,
  };
}

/** Validate every stored object's format and the global expansion bound before
 * checking completeness from the authoritative input roots. An unbundled bare
 * repository has no installed refs, so fsck alone cannot establish closure. */
export function verifyMergeObjectStore(
  inputs: readonly ValueMergeInput[],
  repository: string,
): MergeObjectClosure {
  const text = gitReader(repository);
  text(["fsck", "--full", "--strict", "--no-reflogs", "--no-dangling"]);
  let bytes = 0;
  for (const value of text([
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectsize)",
  ])
    .trim()
    .split("\n")) {
    if (!/^\d+$/u.test(value)) throw new Error("Invalid Git object inventory");
    const size = Number(value);
    bytes += size;
    if (
      !Number.isSafeInteger(size) ||
      !Number.isSafeInteger(bytes) ||
      bytes > MAX_EXPANDED
    )
      throw new Error("Expanded object limit");
  }
  return requiredMergeObjects(inputs, repository);
}
