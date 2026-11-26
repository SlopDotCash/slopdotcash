import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Serves GitHub REST reads of immutable Git objects from local bare clones,
 * so a collection does not spend its hourly GitHub allowance walking trees
 * that one `git clone` already holds (operator decision, 20 November 2026).
 *
 * Only two reads are answered locally, and only when the local answer is the
 * one GitHub gives:
 * - `GET /repos/{owner}/{repo}/git/trees/{sha}` and `?recursive=1`: the whole
 *   body, byte for byte (entry order, `mode`, `size`, `url`, `truncated`).
 * - `GET /repos/{owner}/{repo}/git/commits/{sha}`: every field GitHub derives
 *   from the commit object. `node_id` and `verification` are GitHub's own
 *   records and are left out; no collector caller reads either.
 *
 * Anything else, and any object this reader is not certain about, returns
 * null so the caller makes the normal API read: an unknown repository, a
 * missing object, an object of another type, a submodule entry or unusual
 * mode, a non-UTF-8 name or message, an `encoding` header, an ambiguous
 * message ending, or a tree larger than every caller accepts.
 */
export interface LocalGitObjects {
  read(url: URL): Promise<Uint8Array<ArrayBuffer> | null>;
  readonly stats: { served: number; declined: number };
  close(): void;
}

const API = "https://api.github.com";
const OID = /^[a-f0-9]{40}$/u;
/** Every collector caller refuses a tree with more entries than this, and
 * GitHub truncates only far above it, so a served tree is never truncated. */
const MAX_TREE_ENTRIES = 20_000;
/** GitHub truncates a recursive tree response above 7 MB. Stay well below. */
const MAX_TREE_BYTES = 5 * 1024 * 1024;
const BLOB_MODES = new Set(["100644", "100755", "120000"]);

export type GitObject = { type: string; size: number; content: Buffer | null };

/** One long-lived `git cat-file --batch` (or `--batch-check`) process.
 * Requests are pipelined and answered in order; a dead process answers null. */
class CatFile {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private readonly pending: ((value: GitObject | null) => void)[] = [];

  constructor(
    private readonly gitDir: string,
    private readonly mode: "--batch" | "--batch-check",
  ) {}

  private start() {
    if (this.child) return this.child;
    const child = spawn(
      "git",
      ["--git-dir", this.gitDir, "cat-file", this.mode],
      {
        // Never let a missing object reach the network.
        env: {
          ...process.env,
          GIT_NO_LAZY_FETCH: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    child.stderr.resume();
    const fail = () => {
      if (this.child !== child) return;
      this.child = null;
      this.buffer = Buffer.alloc(0);
      for (const resolve of this.pending.splice(0)) resolve(null);
    };
    child.on("error", fail);
    child.on("exit", fail);
    child.stdin.on("error", fail);
    child.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr])
      (stream as unknown as { unref?: () => void }).unref?.();
    this.child = child;
    return child;
  }

  private drain() {
    while (this.pending.length) {
      const newline = this.buffer.indexOf(10);
      if (newline < 0) return;
      const header = this.buffer.subarray(0, newline).toString("latin1");
      const match = /^([a-f0-9]{40}) (blob|tree|commit|tag) (\d+)$/u.exec(
        header,
      );
      if (!match) {
        // "<sha> missing", "<sha> ambiguous" or anything unexpected.
        this.buffer = this.buffer.subarray(newline + 1);
        this.pending.shift()?.(null);
        continue;
      }
      const size = Number(match[3]);
      if (this.mode === "--batch-check") {
        this.buffer = this.buffer.subarray(newline + 1);
        this.pending.shift()?.({ type: match[2], size, content: null });
        continue;
      }
      const end = newline + 1 + size;
      if (this.buffer.length < end + 1) return;
      const content = Buffer.from(this.buffer.subarray(newline + 1, end));
      this.buffer = this.buffer.subarray(end + 1);
      this.pending.shift()?.({ type: match[2], size, content });
    }
  }

  read(sha: string): Promise<GitObject | null> {
    if (!OID.test(sha)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const child = this.start();
      this.pending.push(resolve);
      child.stdin.write(`${sha}\n`);
    });
  }

  close() {
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
  }
}

type Repository = {
  fullName: string;
  object(sha: string): Promise<GitObject | null>;
  info(sha: string): Promise<GitObject | null>;
  close(): void;
};

export function gitRepository(fullName: string, gitDir: string): Repository {
  const batch = new CatFile(gitDir, "--batch");
  const check = new CatFile(gitDir, "--batch-check");
  return {
    fullName,
    object: (sha) => batch.read(sha),
    info: (sha) => check.read(sha),
    close() {
      batch.close();
      check.close();
    },
  };
}

/** Bare clones live at `<root>/<owner>/<repo>.git`; the directory names are
 * GitHub's canonical owner and repository names, which GitHub writes into
 * every `url` field whatever casing the request used. */
export function localGitObjectsFromDirectory(root: string): LocalGitObjects {
  const repositories = new Map<string, Repository>();
  for (const owner of readdirSync(root)) {
    const ownerDir = join(root, owner);
    if (!statSync(ownerDir).isDirectory()) continue;
    for (const entry of readdirSync(ownerDir)) {
      if (!entry.endsWith(".git")) continue;
      const gitDir = join(ownerDir, entry);
      if (!statSync(gitDir).isDirectory()) continue;
      const fullName = `${owner}/${entry.slice(0, -".git".length)}`;
      repositories.set(fullName.toLowerCase(), gitRepository(fullName, gitDir));
    }
  }
  return localGitObjects(repositories);
}

export function localGitObjects(
  repositories: ReadonlyMap<string, Repository>,
): LocalGitObjects {
  const stats = { served: 0, declined: 0 };
  const encoder = new TextEncoder();
  return {
    stats,
    close() {
      for (const repository of repositories.values()) repository.close();
    },
    async read(url) {
      if (url.origin !== API || url.username || url.password || url.hash)
        return null;
      const match =
        /^\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/git\/(commits|trees)\/([a-f0-9]{40})$/u.exec(
          url.pathname,
        );
      if (!match) return null;
      const [, owner, name, kind, sha] = match;
      const recursive = kind === "trees" && url.search === "?recursive=1";
      if (url.search !== "" && !recursive) return null;
      const repository = repositories.get(`${owner}/${name}`.toLowerCase());
      if (!repository) return null;
      let body: unknown = null;
      try {
        body =
          kind === "commits"
            ? await commitBody(repository, sha)
            : await treeBody(repository, sha, recursive);
      } catch {
        body = null;
      }
      const bytes = body === null ? null : encoder.encode(JSON.stringify(body));
      if (!bytes || bytes.length > MAX_TREE_BYTES) {
        stats.declined += 1;
        return null;
      }
      stats.served += 1;
      return bytes;
    },
  };
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function utf8(bytes: Uint8Array): string | null {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return null;
  }
}

type RawEntry = { mode: string; name: string; sha: string };

/** Parse a raw tree object: `<mode> <name>\0<20-byte id>` repeated. */
function rawEntries(content: Buffer): RawEntry[] | null {
  const entries: RawEntry[] = [];
  let at = 0;
  while (at < content.length) {
    const space = content.indexOf(32, at);
    const nul = content.indexOf(0, space + 1);
    if (space < 0 || nul < 0 || nul + 21 > content.length) return null;
    const mode = content.subarray(at, space).toString("latin1");
    const name = utf8(content.subarray(space + 1, nul));
    if (name === null || !name) return null;
    entries.push({
      mode,
      name,
      sha: content.subarray(nul + 1, nul + 21).toString("hex"),
    });
    at = nul + 21;
  }
  return entries;
}

/** GitHub lists a tree as `git ls-tree -r -t` does: each entry in stored
 * order, a subtree's entries right after the subtree. */
async function treeBody(
  repository: Repository,
  sha: string,
  recursive: boolean,
) {
  const base = `${API}/repos/${repository.fullName}`;
  const tree: Record<string, unknown>[] = [];
  const walk = async (treeSha: string, prefix: string): Promise<boolean> => {
    // GitHub also accepts a commit here and answers with its tree; callers
    // then see a different sha. Serve only an exact tree.
    const object = await repository.object(treeSha);
    if (object?.type !== "tree" || !object.content) return false;
    const entries = rawEntries(object.content);
    if (!entries) return false;
    // Pipelined: one batch-check round trip per tree, not per blob.
    const sizes = await Promise.all(
      entries.map((entry) =>
        BLOB_MODES.has(entry.mode) ? repository.info(entry.sha) : null,
      ),
    );
    for (const [index, entry] of entries.entries()) {
      const path = `${prefix}${entry.name}`;
      if (entry.mode === "40000") {
        tree.push({
          path,
          mode: "040000",
          type: "tree",
          sha: entry.sha,
          url: `${base}/git/trees/${entry.sha}`,
        });
        if (tree.length > MAX_TREE_ENTRIES) return false;
        if (recursive && !(await walk(entry.sha, `${path}/`))) return false;
      } else if (BLOB_MODES.has(entry.mode)) {
        const blob = sizes[index];
        if (blob?.type !== "blob") return false;
        tree.push({
          path,
          mode: entry.mode,
          type: "blob",
          sha: entry.sha,
          size: blob.size,
          url: `${base}/git/blobs/${entry.sha}`,
        });
        if (tree.length > MAX_TREE_ENTRIES) return false;
      }
      // Submodules and unusual modes: GitHub's exact shape is unverified.
      else return false;
    }
    return true;
  };
  if (!(await walk(sha, ""))) return null;
  return { sha, url: `${base}/git/trees/${sha}`, tree, truncated: false };
}

function identity(line: string) {
  const match = /^(.*) <([^<>]*)> (\d{1,12}) [+-]\d{4}$/u.exec(line);
  if (!match) return null;
  const [, name, email, seconds] = match;
  // GitHub may normalize unusual names; serve only plain ones.
  if (!name || name !== name.trim() || /[<>]/u.test(name)) return null;
  const date = new Date(Number(seconds) * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return {
    name,
    email,
    date: date.toISOString().replace(/\.\d{3}Z$/u, "Z"),
  };
}

async function commitBody(repository: Repository, sha: string) {
  const object = await repository.object(sha);
  if (object?.type !== "commit" || !object.content) return null;
  const text = utf8(object.content);
  if (text === null || text.includes("\r")) return null;
  const split = text.indexOf("\n\n");
  if (split < 0) return null;
  const header = text.slice(0, split).split("\n");
  let message = text.slice(split + 2);
  // GitHub drops one trailing newline. More than one is not verified.
  if (message.endsWith("\n\n")) return null;
  if (message.endsWith("\n")) message = message.slice(0, -1);
  let tree: string | null = null;
  const parents: string[] = [];
  let author: ReturnType<typeof identity> = null;
  let committer: ReturnType<typeof identity> = null;
  let signature = false;
  for (const line of header) {
    if (line.startsWith(" ")) {
      // Only a signature or merge tag header continues on further lines.
      if (!signature) return null;
      continue;
    }
    signature = false;
    const space = line.indexOf(" ");
    const key = space < 0 ? line : line.slice(0, space);
    const value = space < 0 ? "" : line.slice(space + 1);
    if (key === "tree" && tree === null && OID.test(value)) tree = value;
    else if (key === "parent" && OID.test(value)) parents.push(value);
    else if (key === "author" && author === null) {
      author = identity(value);
      if (!author) return null;
    } else if (key === "committer" && committer === null) {
      committer = identity(value);
      if (!committer) return null;
    } else if (["gpgsig", "gpgsig-sha256", "mergetag"].includes(key))
      signature = true;
    else return null; // encoding, a repeated header, or anything unexpected
  }
  if (!tree || !author || !committer) return null;
  const api = `${API}/repos/${repository.fullName}`;
  const web = `https://github.com/${repository.fullName}`;
  return {
    sha,
    url: `${api}/git/commits/${sha}`,
    html_url: `${web}/commit/${sha}`,
    author,
    committer,
    tree: { sha: tree, url: `${api}/git/trees/${tree}` },
    message,
    parents: parents.map((parent) => ({
      sha: parent,
      url: `${api}/git/commits/${parent}`,
      html_url: `${web}/commit/${parent}`,
    })),
  };
}
