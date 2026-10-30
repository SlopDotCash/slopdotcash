/**
 * Immutable public-source acquisition for VET-01; never checkout or execute
 * input. One shallow Git fetch of the exact commit replaces per-object API
 * reads, so a repository of any size is acquired (owner decision, 28 October
 * 2026: admission scans have no repository size limit).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { readLimitedBody } from "../../backend/trace/validation";

const SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
/** The only production source authority. */
const GITHUB_GIT_ORIGIN = "https://github.com";
/**
 * Operational guard for one whole acquisition, not a size policy. Git fetch
 * of a multi-gigabyte public repository completes well inside it; a stalled
 * transfer fails as an outage and is retried, never refused.
 */
export const ACQUISITION_TIMEOUT_MS = 45 * 60 * 1000;
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";
const hash = (bytes: Uint8Array, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");

/** The pinned input is outside the acquisition policy, so a retry of the
 * same pin cannot pass. Outages and changed bytes are not refusals. Size is
 * never a refusal reason for repository source. */
export type AcquisitionRefusalReason =
  | "An exact repository and commit SHA are required"
  | "Invalid source tree path or digest"
  | "Unsupported source tree entry"
  | "Unsupported repository inventory"
  | "Immutable repository identity mismatch"
  | "Template acquisition size limit"
  | "Input response size limit exceeded";

export class AcquisitionRefusal extends Error {
  override name = "AcquisitionRefusal";
  constructor(
    readonly reason: AcquisitionRefusalReason,
    readonly capacity?: {
      unit: "entries" | "bytes";
      observed?: number;
      maximum: number;
    },
  ) {
    super(reason);
  }
  /** Only fixed policy text and counters, never an upstream error message. */
  get summary(): string {
    if (!this.capacity) return this.reason;
    return this.capacity.observed === undefined
      ? `${this.reason}: maximum ${this.capacity.maximum} ${this.capacity.unit}; complete size unavailable`
      : `${this.reason}: observed ${this.capacity.observed} ${this.capacity.unit}, maximum ${this.capacity.maximum}`;
  }
}

/** Distinguish a pinned-input size policy from transient transport failures. */
export async function readAcquisitionBody(
  response: Response,
  maximum: number,
): Promise<Uint8Array> {
  try {
    return await readLimitedBody(response, maximum);
  } catch (error) {
    const failure = error as { status?: number; code?: string } | null;
    if (failure?.status === 413 && failure.code === "payload_too_large")
      throw new AcquisitionRefusal("Input response size limit exceeded", {
        unit: "bytes",
        maximum,
      });
    throw error;
  }
}

/**
 * The remote a fetch may use. Production is fixed to GitHub HTTPS. Tests may
 * inject a local `file://` repository or a loopback HTTP smart server; neither
 * is reachable from configuration or the environment.
 */
function remoteOf(
  repository: string,
  testRemote: string | undefined,
): { url: string; protocol: "https" | "file" | "http" } {
  if (testRemote === undefined)
    return { url: `${GITHUB_GIT_ORIGIN}/${repository}.git`, protocol: "https" };
  const url = new URL(testRemote);
  if (url.protocol === "file:" && url.host === "")
    return { url: url.href, protocol: "file" };
  if (url.protocol === "http:" && url.hostname === "127.0.0.1")
    return { url: url.href, protocol: "http" };
  throw new Error("A test remote must be file:// or loopback HTTP");
}

/**
 * Git with no user, system or repository configuration it did not set, no
 * hooks, credentials, prompts, submodules, LFS filters, redirects or
 * protocol other than the one the remote needs.
 */
function gitEnvironment(home: string, protocol: string) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: home,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    SSH_ASKPASS: "/bin/false",
    GIT_ALLOW_PROTOCOL: protocol,
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
}
function gitOptions(protocol: string): string[] {
  return [
    "core.hooksPath=/dev/null",
    "core.fsmonitor=false",
    "core.askPass=/bin/false",
    "credential.helper=",
    "protocol.allow=never",
    `protocol.${protocol}.allow=always`,
    "http.followRedirects=false",
    "submodule.recurse=false",
    "fetch.recurseSubmodules=false",
    "gc.auto=0",
    "maintenance.auto=false",
    "filter.lfs.process=",
    "filter.lfs.smudge=",
    "filter.lfs.required=false",
  ].flatMap((option) => ["-c", option]);
}

type Git = (
  args: string[],
  input?: string,
  onStdout?: (stream: NodeJS.ReadableStream) => Promise<void>,
) => Promise<Buffer>;

function gitRunner(
  gitDirectory: string,
  home: string,
  protocol: string,
  signal: AbortSignal,
): Git {
  const env = gitEnvironment(home, protocol);
  const options = gitOptions(protocol);
  return (args, input, onStdout) =>
    new Promise<Buffer>((done, fail) => {
      const child = spawn(
        "git",
        [...options, `--git-dir=${gitDirectory}`, ...args],
        { env, stdio: ["pipe", "pipe", "pipe"], signal },
      );
      const chunks: Buffer[] = [];
      let consumer: Promise<void> = Promise.resolve();
      if (onStdout)
        consumer = onStdout(child.stdout).then(
          // Drain to end of stream, or "close" never fires.
          () => {
            child.stdout.resume();
          },
          (error) => {
            child.kill("SIGKILL");
            child.stdout.resume();
            throw error;
          },
        );
      else child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      // Stderr can name URLs or upstream text; it is drained, never surfaced.
      child.stderr.resume();
      child.on("error", () => fail(new Error("Git is unavailable")));
      child.on("close", (code) => {
        consumer.then(
          () =>
            code === 0
              ? done(Buffer.concat(chunks))
              : fail(new Error(`Git ${args[0]} failed`)),
          fail,
        );
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input ?? "");
    });
}

/** Sequential reads over a byte stream, for `git cat-file --batch` output. */
class StreamReader {
  private buffer: Buffer = Buffer.alloc(0);
  private ended = false;
  private readonly iterator: AsyncIterator<Buffer>;
  constructor(stream: NodeJS.ReadableStream) {
    this.iterator = (stream as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  }
  private async more(): Promise<boolean> {
    if (this.ended) return false;
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return false;
    }
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, next.value])
      : next.value;
    return true;
  }
  async line(): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf(10);
      if (end !== -1) {
        const line = this.buffer.subarray(0, end).toString("latin1");
        this.buffer = this.buffer.subarray(end + 1);
        return line;
      }
      if (this.buffer.length > 4096 || !(await this.more()))
        throw new Error("Incomplete Git object stream");
    }
  }
  /** Passes exactly `size` bytes to `sink` in order, without buffering them all. */
  async exact(
    size: number,
    sink: (chunk: Buffer) => Promise<void>,
  ): Promise<void> {
    let remaining = size;
    while (remaining > 0) {
      if (this.buffer.length === 0 && !(await this.more()))
        throw new Error("Incomplete Git object stream");
      const take = Math.min(remaining, this.buffer.length);
      const chunk = this.buffer.subarray(0, take);
      this.buffer = this.buffer.subarray(take);
      remaining -= take;
      await sink(chunk);
    }
  }
}

export type TreeEntry = {
  path: string;
  gitSha: string;
  type: string;
  mode: string;
};

/** Resolve only entries in the verified commit tree, never filesystem paths. */
export async function resolveSymlinkTarget(
  entry: TreeEntry,
  entries: ReadonlyMap<string, TreeEntry>,
  readLink: (entry: TreeEntry) => Promise<Uint8Array>,
): Promise<string | null> {
  const seen = new Set<string>();
  let current = entry;
  while (current.type === "blob" && current.mode === "120000") {
    if (seen.has(current.path)) return null;
    seen.add(current.path);
    let target: string;
    try {
      target = new TextDecoder("utf-8", { fatal: true }).decode(
        await readLink(current),
      );
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
    const segments = target.split("/");
    if (
      !target ||
      target.startsWith("/") ||
      target.endsWith("/") ||
      target.includes("\\") ||
      [...target].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      segments.some((part) => /^[A-Za-z]:/u.test(part))
    )
      return null;
    const parts = current.path.split("/").slice(0, -1);
    for (const [index, part] of segments.entries()) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (parts.length === 0) return null;
        parts.pop();
      } else parts.push(part);
      const candidate = entries.get(parts.join("/"));
      // A non-final component must be a real directory in this tree. In
      // particular, do not follow directory links or normalize file/.. away.
      if (
        parts.length > 0 &&
        (!candidate ||
          (index < segments.length - 1 && candidate.type !== "tree"))
      )
        return null;
    }
    const next = entries.get(parts.join("/"));
    if (!next) return null;
    current = next;
  }
  return current.type === "blob" && ["100644", "100755"].includes(current.mode)
    ? current.path
    : null;
}

/** Parses `git ls-tree -r -t -z` and applies the source path policy. */
function treeEntries(output: Buffer): TreeEntry[] {
  const names = new Set<string>();
  const entries: TreeEntry[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let start = 0;
  while (start < output.length) {
    const end = output.indexOf(0, start);
    if (end === -1) throw new Error("Incomplete commit tree");
    const row = output.subarray(start, end);
    start = end + 1;
    const tab = row.indexOf(9);
    if (tab === -1) throw new Error("Incomplete commit tree");
    const [mode, type, gitSha, ...rest] = row
      .subarray(0, tab)
      .toString("latin1")
      .split(" ");
    let path: string;
    try {
      path = decoder.decode(row.subarray(tab + 1));
    } catch {
      throw new AcquisitionRefusal("Invalid source tree path or digest");
    }
    if (
      rest.length > 0 ||
      path.length > 1024 ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      [...path].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      names.has(path) ||
      !SHA.test(String(gitSha))
    )
      throw new AcquisitionRefusal("Invalid source tree path or digest");
    names.add(path);
    if (
      !(
        (type === "tree" && mode === "040000") ||
        (type === "commit" && mode === "160000") ||
        (type === "blob" && ["100644", "100755", "120000"].includes(mode))
      )
    )
      throw new AcquisitionRefusal("Unsupported source tree entry");
    entries.push({ path, gitSha, type, mode });
  }
  return entries;
}

/**
 * Rebuilds every Git tree object from the listed members and checks its
 * SHA-1, so an omitted or altered member cannot keep the assigned tree SHA.
 */
function verifyTrees(treeSha: string, entries: TreeEntry[]) {
  const children = new Map<string, TreeEntry[]>([["", []]]);
  const shas = new Map<string, string>([["", treeSha]]);
  for (const entry of entries)
    if (entry.type === "tree") {
      children.set(entry.path, []);
      shas.set(entry.path, entry.gitSha);
    }
  for (const entry of entries) {
    const separator = entry.path.lastIndexOf("/");
    const parent = separator === -1 ? "" : entry.path.slice(0, separator);
    const members = children.get(parent);
    if (!members)
      throw new Error("Source entry is disconnected from its Git tree");
    members.push(entry);
  }
  for (const [directory, members] of children) {
    const prefix = directory ? `${directory}/` : "";
    const named = members.map((entry) => ({
      entry,
      name: Buffer.from(entry.path.slice(prefix.length)),
    }));
    named.sort((a, b) =>
      Buffer.compare(
        a.entry.type === "tree"
          ? Buffer.concat([a.name, Buffer.from("/")])
          : a.name,
        b.entry.type === "tree"
          ? Buffer.concat([b.name, Buffer.from("/")])
          : b.name,
      ),
    );
    const body = Buffer.concat(
      named.flatMap(({ entry, name }) => [
        Buffer.from(`${entry.mode.replace(/^0+/u, "")} `),
        name,
        Buffer.from([0]),
        Buffer.from(entry.gitSha, "hex"),
      ]),
    );
    const expected = shas.get(directory);
    if (
      hash(
        Buffer.concat([Buffer.from(`tree ${body.length}\0`), body]),
        "sha1",
      ) !== expected
    )
      throw new Error("Tree bytes do not match the Git object");
  }
}

export async function acquireRepository(input: {
  repository: string;
  commitSha: string;
  directory: string;
  /** Test-only local or loopback remote; production always uses GitHub. */
  testRemote?: string;
  timeoutMs?: number;
}): Promise<{ directory: string; inventorySha256: string }> {
  if (
    !REPOSITORY.test(input.repository) ||
    input.repository.split("/").some((part) => part === "." || part === "..") ||
    !SHA.test(input.commitSha)
  )
    throw new AcquisitionRefusal(
      "An exact repository and commit SHA are required",
    );
  const remote = remoteOf(input.repository, input.testRemote);
  const parent = resolve(input.directory);
  const signal = AbortSignal.timeout(input.timeoutMs ?? ACQUISITION_TIMEOUT_MS);
  // The Git object store is private scratch, removed whatever happens. Only
  // inert SHA-256-named content and the inventory leave it.
  const scratch = await mkdtemp(join(parent, "slop-git-"));
  let directory: string | undefined;
  try {
    const gitDirectory = join(scratch, "objects.git");
    const git = gitRunner(gitDirectory, scratch, remote.protocol, signal);
    // A bare store with an empty template: no worktree, checkout or hooks.
    await git(["init", "--bare", "--quiet", "--template="]);
    await git([
      "fetch",
      "--quiet",
      "--depth=1",
      "--no-tags",
      "--no-recurse-submodules",
      "--no-write-fetch-head",
      remote.url,
      input.commitSha,
    ]);
    // `index-pack` names every received object by the hash of its bytes; the
    // checks below also rehash what Slop keeps.
    const commit = await git(["cat-file", "commit", input.commitSha]);
    if (
      hash(
        Buffer.concat([Buffer.from(`commit ${commit.length}\0`), commit]),
        "sha1",
      ) !== input.commitSha
    )
      throw new Error("Commit pin mismatch");
    const treeSha = /^tree ([0-9a-f]{40})\n/u.exec(
      commit.subarray(0, 64).toString("latin1"),
    )?.[1];
    if (!treeSha) throw new Error("Commit pin mismatch");
    const entries = treeEntries(
      await git(["ls-tree", "-r", "-t", "-z", "--full-tree", treeSha]),
    );
    verifyTrees(treeSha, entries);
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    // A unique private directory prevents a repository path from choosing a host path.
    directory = await mkdtemp(join(parent, "slop-source-"));
    const objects = join(directory, "objects");
    await mkdir(objects, { mode: 0o700 });
    const blobs = [
      ...new Set(
        entries.filter((entry) => entry.type === "blob").map((e) => e.gitSha),
      ),
    ];
    const stored = new Map<string, { sha256: string; bytes: number }>();
    const lfs = new Set<string>();
    let incoming = 0;
    await git(
      ["cat-file", "--batch"],
      blobs.map((sha) => `${sha}\n`).join(""),
      async (stream) => {
        const reader = new StreamReader(stream);
        for (const gitSha of blobs) {
          const header = (await reader.line()).split(" ");
          if (
            header.length !== 3 ||
            header[0] !== gitSha ||
            header[1] !== "blob" ||
            !/^(?:0|[1-9][0-9]{0,15})$/u.test(header[2])
          )
            throw new Error("Invalid immutable blob");
          const size = Number(header[2]);
          if (!Number.isSafeInteger(size))
            throw new Error("Invalid immutable blob");
          const sha1 = createHash("sha1").update(`blob ${size}\0`);
          const sha256 = createHash("sha256");
          const temporary = join(objects, `.incoming-${incoming++}`);
          const handle = await open(temporary, "wx", 0o600);
          let head = Buffer.alloc(0);
          try {
            await reader.exact(size, async (chunk) => {
              sha1.update(chunk);
              sha256.update(chunk);
              if (head.length < LFS_POINTER.length)
                head = Buffer.concat([head, chunk]).subarray(0, 80);
              await handle.write(chunk);
            });
          } finally {
            await handle.close();
          }
          await reader.exact(1, async (chunk) => {
            if (chunk[0] !== 10) throw new Error("Invalid immutable blob");
          });
          if (sha1.digest("hex") !== gitSha)
            throw new Error("Blob bytes do not match the Git object");
          const digest = sha256.digest("hex");
          const target = join(objects, digest);
          const existing = await stat(target).catch(() => null);
          if (existing) await unlink(temporary);
          else {
            await chmod(temporary, 0o400);
            await rename(temporary, target);
          }
          if (head.toString("latin1").startsWith(LFS_POINTER)) lfs.add(gitSha);
          stored.set(gitSha, { sha256: digest, bytes: size });
        }
      },
    );
    const records = [];
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    const gaps = new Set([
      "execution-dependencies-and-release-assets-not-acquired",
      "skill-template-inputs-not-acquired",
      "runtime-and-model-review-not-performed",
    ]);
    for (const entry of entries) {
      if (entry.type === "tree") continue;
      if (entry.type === "commit") {
        gaps.add("submodule-source-not-acquired");
        records.push({
          ...entry,
          sha256: null,
          bytes: null,
          state: "quarantined",
        });
        continue;
      }
      const object = stored.get(entry.gitSha);
      if (!object) throw new Error("Invalid immutable blob");
      let resolvedPath: string | null = null;
      if (entry.mode === "120000") {
        resolvedPath = await resolveSymlinkTarget(
          entry,
          byPath,
          async (link) => {
            const object = stored.get(link.gitSha);
            if (!object) throw new Error("Invalid immutable link blob");
            const bytes = await readFile(join(objects, object.sha256));
            if (hash(bytes) !== object.sha256)
              throw new Error("Acquired link bytes changed");
            return bytes;
          },
        );
        if (resolvedPath === null) gaps.add("symbolic-link-not-followed");
      }
      if (lfs.has(entry.gitSha)) gaps.add("lfs-object-not-acquired");
      records.push({
        ...entry,
        ...object,
        ...(resolvedPath === null ? {} : { resolvedPath }),
        state: "quarantined",
      });
    }
    const inventory = Buffer.from(
      JSON.stringify({
        schema: "slop-source-inventory-v1",
        repository: input.repository,
        commitSha: input.commitSha,
        treeSha,
        state: "quarantined",
        directories: entries.filter((entry) => entry.type === "tree"),
        records,
        visibilityGaps: [...gaps].sort(),
      }),
    );
    await writeFile(join(directory, "inventory.json"), inventory, {
      mode: 0o400,
      flag: "wx",
    });
    return { directory, inventorySha256: hash(inventory) };
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [repository, commitSha, directory] = process.argv.slice(2);
  if (!repository || !commitSha || !directory || process.argv.length !== 5)
    throw new Error(
      "Usage: bun workers/vetting/acquire.ts OWNER/REPO COMMIT PRIVATE_DIRECTORY",
    );
  try {
    console.log(
      JSON.stringify(
        await acquireRepository({ repository, commitSha, directory }),
      ),
    );
  } catch {
    console.error(
      "Source acquisition failed; no completed inventory was saved.",
    );
    process.exitCode = 1;
  }
}
