// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const author = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Merge fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Merge fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  LC_ALL: "C",
};

export interface Repository {
  readonly root: string;
  readonly path: string;
  /** @throws {Error} */
  git(args: ReadonlyArray<string>, input?: string | Uint8Array, extra?: Readonly<Record<string, string>>): string;
  /** @throws {Error} */
  blob(content: string | Uint8Array): string;
  /** @throws {Error} */
  tree(files: Readonly<Record<string, string | Uint8Array>>): string;
  /** @throws {Error} */
  commit(tree: string, parents: ReadonlyArray<string>, message: string): string;
  /** @throws {never} */
  close(): void;
}

/** @throws {Error} */
export function bareRepository(name: string, binary = "git"): Repository {
  const root = mkdtempSync(join(tmpdir(), `slop-git-${name}-`));
  const path = join(root, `${name}.git`);
  const git = (args: ReadonlyArray<string>, input?: string | Uint8Array, extra: Readonly<Record<string, string>> = {}) =>
    execFileSync(binary, ["--git-dir", path, ...args], { env: { PATH: process.env.PATH ?? "", ...author, ...extra }, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }).trim();
  git(["init", "--bare", "--template=", path]);
  const writtenBlobs = new Map<string, string>();
  const blob = (content: string | Uint8Array) => {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    const key = bytes.toString("base64");
    const previous = writtenBlobs.get(key);
    if (previous !== undefined) return previous;
    const sha = git(["hash-object", "-w", "--stdin"], bytes);
    writtenBlobs.set(key, sha);
    return sha;
  };
  return {
    root,
    path,
    git,
    blob,
    tree: (files) => git(["mktree"], Object.entries(files).map(([name, content]) => `100644 blob ${blob(content)}\t${name}\n`).join("")),
    commit: (tree, parents, message) => git(["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])], `${message}\n`),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** @throws {Error} */
export function twoParentMerge(repository: Repository) {
  const base = repository.commit(repository.tree({ "witness.txt": "base\n" }), [], "base");
  const left = repository.commit(repository.tree({ "witness.txt": "left\n" }), [base], "left");
  const right = repository.commit(repository.tree({ "witness.txt": "right\n" }), [base], "right");
  const merged = repository.commit(repository.tree({ "witness.txt": "resolved\n" }), [left, right], "merge");
  return { left, right, merged };
}

/** @throws {Error} */
export function octopusMerge(repository: Repository) {
  const baseTree = repository.tree({ "fix.ts": "common\n" });
  const base = repository.commit(baseTree, [], "base");
  const parents = Array.from({ length: 9 }, (_, index) => repository.commit(baseTree, [base], `branch ${index}`));
  const head = repository.commit(repository.tree({ "fix.ts": "common\naccepted repair\n" }), parents, "octopus");
  const addedTree = repository.git(["mktree"], `${repository.git(["ls-tree", head, "--", "fix.ts"])}\n100644 blob ${repository.blob("new path\n")}\tnew.ts\n`);
  return { parents, head, added: repository.commit(addedTree, parents, "New path merge") };
}

/** @throws {Error} */
export function acceptedMerges(repository: Repository) {
  const binary = (seed: number) => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, seed, 0xff, 9, 0, seed]);
  const snapshot = (a: string, b: number, x: string, y: string, added: boolean) =>
    repository.tree({ "a.txt": `one\n${a}\nthree\n`, "b.bin": binary(b), ...(added ? { "c.txt": "added while resolving\n" } : {}), "x.txt": `${x}\n`, "y.txt": `${y}\n` });
  const base = repository.commit(snapshot("two", 1, "x", "y", false), [], "base");
  const left = repository.commit(snapshot("left", 2, "x", "y", false), [base], "left");
  const right = repository.commit(snapshot("right", 3, "x", "y", false), [base], "right");
  const merged = repository.commit(snapshot("accepted", 4, "x", "y", true), [left, right], "resolve");
  const cleanLeft = repository.commit(snapshot("accepted", 4, "x changed", "y", true), [merged], "x");
  const cleanRight = repository.commit(snapshot("accepted", 4, "x", "y changed", true), [merged], "y");
  const clean = repository.commit(snapshot("accepted", 4, "x changed", "y changed", true), [cleanLeft, cleanRight], "clean");
  return { left, right, merged, cleanLeft, cleanRight, clean };
}

/** @throws {Error} */
export function borrowObjects(repository: Repository, from: Repository): void {
  writeFileSync(join(repository.path, "objects/info/alternates"), `${from.path}/objects\n`);
}

/** @throws {Error} */
export function addUnrelatedObjects(repository: Repository, count: number): void {
  const entries = Array.from({ length: count }, (_, index) => {
    const content = `unrelated fixture object ${index}\n`;
    return `blob\ndata ${Buffer.byteLength(content)}\n${content}\n`;
  });
  repository.git(["fast-import", "--quiet", "--done"], `${entries.join("")}done\n`);
}

/** @throws {Error} */
export function replayedTree(repository: Repository, binary: string, left: string, right: string, patch: string): { readonly automaticTree: string; readonly replayed: string } {
  const run = (args: ReadonlyArray<string>, input?: string, extra: Readonly<Record<string, string>> = {}, accept: ReadonlyArray<number> = [0]) => {
    try {
      return execFileSync(binary, ["--git-dir", repository.path, ...args], { env: { PATH: process.env.PATH ?? "", ...author, ...extra }, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 }).trim();
    } catch (error) {
      const failed = error as { status?: number; stdout?: string };
      if (failed.status !== undefined && accept.includes(failed.status)) return (failed.stdout ?? "").trim();
      throw error;
    }
  };
  const automaticTree = run(["merge-tree", "--write-tree", "--no-messages", left, right], undefined, {}, [0, 1]).split("\n")[0] ?? "";
  const index = { GIT_INDEX_FILE: join(repository.root, "replay.index") };
  run(["read-tree", automaticTree], undefined, index);
  if (patch !== "") run(["apply", "--cached", "--binary", "-"], patch, index);
  const replayed = run(["write-tree"], undefined, index);
  rmSync(index.GIT_INDEX_FILE, { force: true });
  return { automaticTree, replayed };
}

/** @throws {Error} */
export function gunzipBase64(text: string): string {
  return gunzipSync(Buffer.from(text, "base64")).toString("hex");
}

/** @throws {never} */
export function hexOfBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
