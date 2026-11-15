/** Complete object closure for the fixed Git merge operation, without checkout. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  type ValueFileRequest,
  validValueFileRequest,
} from "../workers/slopbot/value-file-recovery";
import type { ValueMergeInput } from "../workers/slopbot/value-merge-profile";

const OID = /^[a-f0-9]{40}$/u;
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const ordered = (values: Iterable<string>) => [...new Set(values)].sort();

interface MergeObjectClosure {
  commits: string[];
  trees: string[];
  blobs: string[];
  snapshots: string[];
  expandedBytes: number;
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
  const text = (args: string[], input?: string) => {
    const bytes = git(args, input);
    const result = bytes.toString("utf8");
    if (!Buffer.from(result, "utf8").equals(bytes))
      throw new Error("Git merge metadata is not UTF-8");
    return result;
  };
  return { git, text };
}

function* treeEntries(bytes: Buffer) {
  let cursor = 0;
  while (cursor < bytes.length) {
    const space = bytes.indexOf(32, cursor);
    const nul = bytes.indexOf(0, space + 1);
    if (space < cursor || nul < space || nul + 21 > bytes.length)
      throw new Error("Incomplete Git snapshot entry");
    const mode = bytes.subarray(cursor, space).toString("ascii");
    const nameBytes = bytes.subarray(space + 1, nul);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    if (
      !["40000", "100644", "100755", "120000", "160000"].includes(mode) ||
      !name ||
      name.includes("/") ||
      name === "." ||
      name === ".."
    )
      throw new Error("Invalid Git snapshot entry");
    yield {
      mode,
      name,
      sha: bytes.subarray(nul + 1, nul + 21).toString("hex"),
    };
    cursor = nul + 21;
  }
}

/** Caller supplies server-derived inputs. Missing graph, tree, changed-file or
 * attribute objects always refuse; unrelated historical file bodies are unused. */
export function requiredMergeObjects(
  inputs: readonly ValueMergeInput[],
  repository: string,
  fileRequests: readonly ValueFileRequest[] = [],
): MergeObjectClosure {
  const { git, text } = gitReader(repository);
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
  for (const request of fileRequests) {
    if (
      !validValueFileRequest(request) ||
      !inputs.some(
        (input) =>
          input.repository === request.repository &&
          input.repositoryNodeId === request.repositoryNodeId,
      )
    )
      throw new Error("Invalid recovered file repository");
    addRoot(request.ref);
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
  const selectedPaths = new Map<string, Set<string>>();
  const regularPaths = new Map<string, Set<string>>();
  for (const input of inputs) {
    const paths = selectedPaths.get(input.pull.head.sha) ?? new Set<string>();
    for (const file of input.files) paths.add(file.filename);
    selectedPaths.set(input.pull.head.sha, paths);
  }
  for (const request of fileRequests) {
    const paths = regularPaths.get(request.ref) ?? new Set<string>();
    paths.add(request.path);
    regularPaths.set(request.ref, paths);
  }
  const rootTrees = text([
    "log",
    "--no-walk=unsorted",
    "--format=%H %T",
    ...snapshots,
    "--",
  ])
    .trim()
    .split("\n");
  const rootsByCommit = new Map<string, string>();
  for (const row of rootTrees) {
    const match = /^([a-f0-9]{40}) ([a-f0-9]{40})$/u.exec(row);
    if (!match || !snapshots.has(match[1]) || rootsByCommit.has(match[1]))
      throw new Error("Git snapshot tree is unavailable");
    rootsByCommit.set(match[1], match[2]);
  }
  if (rootsByCommit.size !== snapshots.size)
    throw new Error("Git snapshot tree is unavailable");
  const treeBytes = new Map<string, Buffer>();
  let pending = new Set(rootsByCommit.values());
  while (pending.size) {
    const batch = [...pending].filter((sha) => !treeBytes.has(sha));
    pending = new Set();
    if (!batch.length) break;
    // Git's batch framing includes the exact object size. Retain raw tree
    // bytes once; repeated snapshots share their immutable child objects.
    const bytes = git(["cat-file", "--batch"], `${batch.join("\n")}\n`);
    let cursor = 0;
    for (const sha of batch) {
      const newline = bytes.indexOf(10, cursor);
      const header = bytes.subarray(cursor, newline).toString("ascii");
      const match = /^([a-f0-9]{40}) tree (\d+)$/u.exec(header);
      if (newline < 0 || !match || match[1] !== sha)
        throw new Error("Git snapshot tree is unavailable");
      const size = Number(match[2]);
      const start = newline + 1;
      const end = start + size;
      if (
        !Number.isSafeInteger(size) ||
        end >= bytes.length ||
        bytes[end] !== 10
      )
        throw new Error("Incomplete Git snapshot tree");
      const body = Buffer.from(bytes.subarray(start, end));
      if (
        createHash("sha1")
          .update(`tree ${size}\0`)
          .update(body)
          .digest("hex") !== sha
      )
        throw new Error("Git snapshot tree hash differs");
      treeBytes.set(sha, body);
      trees.add(sha);
      const names = new Set<string>();
      for (const entry of treeEntries(body)) {
        if (names.has(entry.name))
          throw new Error("Invalid Git snapshot listing");
        names.add(entry.name);
        if (entry.mode === "40000") pending.add(entry.sha);
        else if (
          [".gitattributes", ".gitmodules"].includes(entry.name) &&
          entry.mode !== "160000"
        )
          blobs.add(entry.sha);
      }
      cursor = end + 1;
    }
    if (cursor !== bytes.length)
      throw new Error("Unexpected Git tree batch bytes");
  }
  const findPath = (ref: string, path: string) => {
    let tree = rootsByCommit.get(ref);
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index++) {
      const body = tree ? treeBytes.get(tree) : undefined;
      if (!body) throw new Error("Incomplete Git snapshot tree");
      const entry = [...treeEntries(body)].find(
        (item) => item.name === parts[index],
      );
      if (!entry) return null;
      if (index === parts.length - 1) return entry;
      if (entry.mode !== "40000") return null;
      tree = entry.sha;
    }
    return null;
  };
  for (const [ref, paths] of selectedPaths)
    for (const path of paths) {
      const entry = findPath(ref, path);
      if (entry && !["40000", "160000"].includes(entry.mode))
        blobs.add(entry.sha);
    }
  for (const [ref, paths] of regularPaths)
    for (const path of paths) {
      const entry = findPath(ref, path);
      if (entry && ["100644", "100755"].includes(entry.mode))
        blobs.add(entry.sha);
    }
  const addChangedObject = (mode: string, sha: string) => {
    if (mode === "000000" && sha === "0".repeat(40)) return;
    if (mode === "160000") return; // A gitlink never grants a submodule fetch.
    if (!["100644", "100755", "120000"].includes(mode) || !OID.test(sha))
      throw new Error("Unsupported changed Git object");
    blobs.add(sha);
  };
  const changedEdges = [...edges.values()];
  for (let offset = 0; offset < changedEdges.length; offset += 64) {
    const batch = changedEdges.slice(offset, offset + 64);
    const rows = text(
      [
        "diff-tree",
        "--stdin",
        "--root",
        "--no-commit-id",
        "-r",
        "--raw",
        "--no-abbrev",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
      ],
      `${batch.map(([before, after]) => (before ? `${before} ${after}` : after)).join("\n")}\n`,
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
  fileRequests: readonly ValueFileRequest[] = [],
): MergeObjectClosure {
  const { text } = gitReader(repository);
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
  return requiredMergeObjects(inputs, repository, fileRequests);
}
