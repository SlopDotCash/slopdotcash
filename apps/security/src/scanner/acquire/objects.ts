// spec/security/admission.md, "Acquisition binds one shallow fetch of the exact commit"
import { createHash, type Hash } from "node:crypto";

const SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GITHUB_GIT_ORIGIN = "https://github.com";
const LFS_POINTER = new TextEncoder().encode("version https://git-lfs.github.com/spec/v1");
const strict = new TextDecoder("utf-8", { fatal: true });

export type AcquisitionRefusalReason = "An exact repository and commit SHA are required" | "Invalid source tree path or digest" | "Unsupported source tree entry";

export type TreeEntryType = "tree" | "commit" | "blob";

export interface TreeEntry {
  readonly path: string;
  readonly gitSha: string;
  readonly type: TreeEntryType;
  readonly mode: string;
}

export interface Remote {
  readonly url: string;
  readonly protocol: "https" | "file" | "http";
}

export type Listed = { readonly kind: "entries"; readonly entries: ReadonlyArray<TreeEntry> } | { readonly kind: "refused"; readonly reason: AcquisitionRefusalReason } | { readonly kind: "failed"; readonly reason: string };

export interface StoredBlob {
  readonly sha256: string;
  readonly bytes: number;
  readonly lfs: boolean;
}

export type BatchPiece =
  | { readonly kind: "object"; readonly gitSha: string }
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  | { readonly kind: "stored"; readonly gitSha: string; readonly matches: boolean; readonly blob: StoredBlob };

export type BatchStep = { readonly kind: "pieces"; readonly pieces: ReadonlyArray<BatchPiece> } | { readonly kind: "failed"; readonly reason: string };

export interface BatchReader {
  /** @throws {never} */
  push(chunk: Uint8Array): BatchStep;
  /** @throws {never} */
  end(): string | undefined;
}

export interface SourceRecord extends TreeEntry {
  readonly sha256: string | null;
  readonly bytes: number | null;
  readonly resolvedPath?: string;
  readonly state: "quarantined";
}

/** @throws {never} */
export function exactPin(repository: string, commitSha: string): boolean {
  return REPOSITORY.test(repository) && !repository.split("/").some((part) => part === "." || part === "..") && SHA.test(commitSha);
}

/** @throws {never} */
export function remoteOf(repository: string, testRemote: string | undefined): Remote | undefined {
  if (testRemote === undefined) return { url: `${GITHUB_GIT_ORIGIN}/${repository}.git`, protocol: "https" };
  if (!URL.canParse(testRemote)) return undefined;
  const url = new URL(testRemote);
  if (url.protocol === "file:" && url.host === "") return { url: url.href, protocol: "file" };
  if (url.protocol === "http:" && url.hostname === "127.0.0.1") return { url: url.href, protocol: "http" };
  return undefined;
}

/** @throws {never} */
export function gitEnvironment(home: string, protocol: string, searchPath: string): Readonly<Record<string, string>> {
  return {
    PATH: searchPath,
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

/** @throws {never} */
export function gitOptions(protocol: string): ReadonlyArray<string> {
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

/** @throws {never} */
function digestOf(algorithm: "sha1" | "sha256", ...parts: ReadonlyArray<Uint8Array>): string {
  const hash = createHash(algorithm);
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

/** @throws {never} */
export function sha256Hex(bytes: Uint8Array): string {
  return digestOf("sha256", bytes);
}

/** @throws {never} */
function ascii(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** @throws {never} */
export function commitTree(commit: Uint8Array, commitSha: string): string | undefined {
  if (digestOf("sha1", new TextEncoder().encode(`commit ${commit.length}\0`), commit) !== commitSha) return undefined;
  return /^tree ([0-9a-f]{40})\n/u.exec(ascii(commit.subarray(0, 64)))?.[1];
}

/** @throws {never} */
function controlFree(text: string): boolean {
  return ![...text].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

/** @throws {never} */
function entryType(type: string | undefined, mode: string | undefined): TreeEntryType | undefined {
  if (type === "tree" && mode === "040000") return "tree";
  if (type === "commit" && mode === "160000") return "commit";
  if (type === "blob" && (mode === "100644" || mode === "100755" || mode === "120000")) return "blob";
  return undefined;
}

/** @throws {never} */
export function treeEntries(output: Uint8Array): Listed {
  const names = new Set<string>();
  const entries: TreeEntry[] = [];
  let start = 0;
  while (start < output.length) {
    const end = output.indexOf(0, start);
    if (end === -1) return { kind: "failed", reason: "Incomplete commit tree" };
    const row = output.subarray(start, end);
    start = end + 1;
    const tab = row.indexOf(9);
    if (tab === -1) return { kind: "failed", reason: "Incomplete commit tree" };
    const [mode, type, gitSha, ...rest] = ascii(row.subarray(0, tab)).split(" ");
    let path: string;
    try {
      path = strict.decode(row.subarray(tab + 1));
    } catch {
      return { kind: "refused", reason: "Invalid source tree path or digest" };
    }
    if (
      rest.length > 0 ||
      path.length > 1024 ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      !controlFree(path) ||
      names.has(path) ||
      !SHA.test(String(gitSha))
    )
      return { kind: "refused", reason: "Invalid source tree path or digest" };
    names.add(path);
    const kind = entryType(type, mode);
    if (kind === undefined || mode === undefined || gitSha === undefined) return { kind: "refused", reason: "Unsupported source tree entry" };
    entries.push({ path, gitSha, type: kind, mode });
  }
  return { kind: "entries", entries };
}

/** @throws {never} */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/** @throws {never} */
function hexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** @throws {never} */
export function treeMismatch(treeSha: string, entries: ReadonlyArray<TreeEntry>): string | undefined {
  const encoder = new TextEncoder();
  const children = new Map<string, TreeEntry[]>([["", []]]);
  const shas = new Map<string, string>([["", treeSha]]);
  for (const entry of entries)
    if (entry.type === "tree") {
      children.set(entry.path, []);
      shas.set(entry.path, entry.gitSha);
    }
  for (const entry of entries) {
    const separator = entry.path.lastIndexOf("/");
    const members = children.get(separator === -1 ? "" : entry.path.slice(0, separator));
    if (!members) return "Source entry is disconnected from its Git tree";
    members.push(entry);
  }
  for (const [directory, members] of children) {
    const prefix = directory ? `${directory}/` : "";
    const named = members.map((entry) => ({ entry, name: encoder.encode(entry.path.slice(prefix.length)) }));
    const sortKey = (item: { entry: TreeEntry; name: Uint8Array }) => (item.entry.type === "tree" ? encoder.encode(`${item.entry.path.slice(prefix.length)}/`) : item.name);
    named.sort((a, b) => compareBytes(sortKey(a), sortKey(b)));
    const body = named.flatMap(({ entry, name }) => [encoder.encode(`${entry.mode.replace(/^0+/u, "")} `), name, new Uint8Array([0]), hexBytes(entry.gitSha)]);
    const length = body.reduce((total, part) => total + part.length, 0);
    if (digestOf("sha1", encoder.encode(`tree ${length}\0`), ...body) !== shas.get(directory)) return "Tree bytes do not match the Git object";
  }
  return undefined;
}

/** @throws {never} */
export function byEntryPath(a: TreeEntry, b: TreeEntry): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** @throws {never} */
export function batchReader(blobs: ReadonlyArray<string>): BatchReader {
  const prefix = (size: number) => new TextEncoder().encode(`blob ${size}\0`);
  let buffered = new Uint8Array(0);
  let next = 0;
  let phase: "header" | "body" | "terminator" = "header";
  let remaining = 0;
  let current = { gitSha: "", size: 0 };
  let sha1: Hash = createHash("sha1");
  let sha256: Hash = createHash("sha256");
  let head = new Uint8Array(0);
  const append = (chunk: Uint8Array) => {
    const joined = new Uint8Array(buffered.length + chunk.length);
    joined.set(buffered, 0);
    joined.set(chunk, buffered.length);
    buffered = joined;
  };
  const lfs = () => head.length >= LFS_POINTER.length && LFS_POINTER.every((byte, index) => head[index] === byte);
  return {
    push(chunk) {
      append(chunk);
      const pieces: BatchPiece[] = [];
      for (;;) {
        if (phase === "header") {
          if (buffered.length === 0) break;
          if (next >= blobs.length) return { kind: "failed", reason: "Unexpected Git object data" };
          const end = buffered.indexOf(10);
          if (end === -1) {
            if (buffered.length > 4096) return { kind: "failed", reason: "Incomplete Git object stream" };
            break;
          }
          const header = ascii(buffered.subarray(0, end)).split(" ");
          buffered = buffered.subarray(end + 1);
          const gitSha = blobs[next] ?? "";
          const sizeText = header[2] ?? "";
          if (header.length !== 3 || header[0] !== gitSha || header[1] !== "blob" || !/^(?:0|[1-9][0-9]{0,15})$/u.test(sizeText)) return { kind: "failed", reason: "Invalid immutable blob" };
          const size = Number(sizeText);
          if (!Number.isSafeInteger(size)) return { kind: "failed", reason: "Invalid immutable blob" };
          current = { gitSha, size };
          sha1 = createHash("sha1").update(prefix(size));
          sha256 = createHash("sha256");
          head = new Uint8Array(0);
          remaining = size;
          phase = "body";
          pieces.push({ kind: "object", gitSha });
          continue;
        }
        if (phase === "body") {
          if (remaining > 0) {
            if (buffered.length === 0) break;
            const take = Math.min(remaining, buffered.length);
            const bytes = buffered.slice(0, take);
            buffered = buffered.subarray(take);
            remaining -= take;
            sha1.update(bytes);
            sha256.update(bytes);
            if (head.length < LFS_POINTER.length) {
              const joined = new Uint8Array(Math.min(80, head.length + bytes.length));
              joined.set(head.subarray(0, joined.length), 0);
              if (joined.length > head.length) joined.set(bytes.subarray(0, joined.length - head.length), head.length);
              head = joined;
            }
            pieces.push({ kind: "bytes", bytes });
            continue;
          }
          phase = "terminator";
          continue;
        }
        if (buffered.length === 0) break;
        if (buffered[0] !== 10) return { kind: "failed", reason: "Invalid immutable blob" };
        buffered = buffered.subarray(1);
        pieces.push({ kind: "stored", gitSha: current.gitSha, matches: sha1.digest("hex") === current.gitSha, blob: { sha256: sha256.digest("hex"), bytes: current.size, lfs: lfs() } });
        next += 1;
        phase = "header";
      }
      return { kind: "pieces", pieces };
    },
    end() {
      if (buffered.length > 0) return next >= blobs.length ? "Unexpected Git object data" : "Incomplete Git object stream";
      return next === blobs.length && phase === "header" ? undefined : "Incomplete Git object stream";
    },
  };
}

/** @throws {never} */
export function linkText(bytes: Uint8Array): string | null {
  try {
    return strict.decode(bytes);
  } catch {
    return null;
  }
}

/** @throws {never} */
export function resolveSymlinkTarget(entry: TreeEntry, entries: ReadonlyMap<string, TreeEntry>, linkOf: (link: TreeEntry) => string | null): string | null {
  const seen = new Set<string>();
  let current = entry;
  while (current.type === "blob" && current.mode === "120000") {
    if (seen.has(current.path)) return null;
    seen.add(current.path);
    const target = linkOf(current);
    if (target === null) return null;
    const segments = target.split("/");
    if (
      !target ||
      target.startsWith("/") ||
      target.endsWith("/") ||
      target.includes("\\") ||
      !controlFree(target) ||
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
      if (parts.length > 0 && (!candidate || (index < segments.length - 1 && candidate.type !== "tree"))) return null;
    }
    const next = entries.get(parts.join("/"));
    if (!next) return null;
    current = next;
  }
  return current.type === "blob" && (current.mode === "100644" || current.mode === "100755") ? current.path : null;
}

/** @throws {never} */
export function sourceInventory(input: {
  readonly repository: string;
  readonly commitSha: string;
  readonly treeSha: string;
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly stored: ReadonlyMap<string, StoredBlob>;
  readonly links: ReadonlyMap<string, string | null>;
}): { readonly bytes: Uint8Array; readonly records: number } | undefined {
  const records: SourceRecord[] = [];
  const byPath = new Map(input.entries.map((entry) => [entry.path, entry]));
  const gaps = new Set(["execution-dependencies-and-release-assets-not-acquired", "skill-template-inputs-not-acquired", "runtime-and-model-review-not-performed"]);
  for (const entry of input.entries) {
    if (entry.type === "tree") continue;
    if (entry.type === "commit") {
      gaps.add("submodule-source-not-acquired");
      records.push({ ...entry, sha256: null, bytes: null, state: "quarantined" });
      continue;
    }
    const object = input.stored.get(entry.gitSha);
    if (!object) return undefined;
    let resolvedPath: string | null = null;
    if (entry.mode === "120000") {
      resolvedPath = resolveSymlinkTarget(entry, byPath, (link) => input.links.get(link.gitSha) ?? null);
      if (resolvedPath === null) gaps.add("symbolic-link-not-followed");
    }
    if (object.lfs) gaps.add("lfs-object-not-acquired");
    records.push({ ...entry, sha256: object.sha256, bytes: object.bytes, ...(resolvedPath === null ? {} : { resolvedPath }), state: "quarantined" });
  }
  const json = JSON.stringify({
    schema: "slop-source-inventory-v1",
    repository: input.repository,
    commitSha: input.commitSha,
    treeSha: input.treeSha,
    state: "quarantined",
    directories: input.entries.filter((entry) => entry.type === "tree"),
    records,
    visibilityGaps: [...gaps].sort(),
  });
  return { bytes: new TextEncoder().encode(json), records: records.length };
}
