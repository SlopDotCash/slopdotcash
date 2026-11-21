import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export const MAX_DISCUSSION_CACHE_ENTRIES = 100_000;
export const MAX_DISCUSSION_CACHE_BYTES = 1024 * 1024 * 1024;
export const MAX_DISCUSSION_CACHE_AGE_MS = 48 * 60 * 60 * 1_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// Commit-addressed reads never change, so a resumed collection can revalidate
// them with a conditional request (a 304 costs no GitHub quota) instead of
// downloading every large commit page again. Discussions keep a reserve so
// these pages can never crowd them out of the checkpoint.
export const MAX_IMMUTABLE_BODY_BYTES = 8 * 1024 * 1024;
const DISCUSSION_RESERVE_BYTES = 256 * 1024 * 1024;
const MAX_METADATA_BYTES = 2_048;
const ENTRY_NAME = /^[a-f0-9]{64}\.bin$/u;
const canonicalRepo = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const etagPattern = /^(?:W\/)?"[!#-~]{1,256}"$/u;
const accept = "application/vnd.github+json";
const apiVersion = "2022-11-28";
const submittedReviewStates = new Set<unknown>([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
]);
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

export interface DiscussionCacheOptions {
  directory: string;
  repositories: readonly { name: string; nodeId: string }[];
}

type CachedDiscussion = {
  etag: string;
  bytes: Uint8Array<ArrayBuffer>;
};
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function matchesDiscussion(
  value: unknown,
  number: number,
  pullUrl: string,
  repository: string,
  nodeId: string,
  fragment: string | undefined,
): boolean {
  if (fragment !== undefined) {
    return (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every((item) => {
        const data = object(item);
        return (
          typeof data?.node_id === "string" &&
          !!data.node_id &&
          typeof data.body === "string" &&
          (fragment !== "pullrequestreview-" ||
            (typeof data.submitted_at === "string" &&
              Number.isFinite(Date.parse(data.submitted_at)) &&
              submittedReviewStates.has(data.state))) &&
          typeof data.html_url === "string" &&
          data.html_url.toLowerCase().startsWith(`${pullUrl}#${fragment}`) &&
          /^[1-9]\d*$/u.test(
            data.html_url.slice(pullUrl.length + 1 + fragment.length),
          )
        );
      })
    );
  }
  const pull = object(value);
  if (!pull) return false;
  const base = object(object(pull.base)?.repo);
  const head = object(pull.head);
  return (
    pull.number === number &&
    typeof pull.node_id === "string" &&
    !!pull.node_id &&
    typeof pull.html_url === "string" &&
    pull.html_url.toLowerCase() === pullUrl &&
    (typeof pull.body === "string" || pull.body === null) &&
    typeof pull.updated_at === "string" &&
    (pull.state === "open" || pull.state === "closed") &&
    base?.node_id === nodeId &&
    base.private === false &&
    typeof base.full_name === "string" &&
    base.full_name.toLowerCase() === repository &&
    head !== null &&
    (head.repo === null || object(head.repo)?.private === false)
  );
}

/** A read whose bytes are fixed by the commit object ids in its URL. */
function immutableValidator(
  path: string,
  search: string,
): ((value: unknown) => boolean) | null {
  const page = /^\?per_page=100&page=[1-9]\d{0,5}$/u;
  const commit = /^commits\/([a-f0-9]{40})$/u.exec(path);
  if (commit)
    return page.test(search)
      ? (value) => {
          const data = object(value);
          return (
            data?.sha === commit[1] &&
            Array.isArray(data.files) &&
            data.files.length <= 100
          );
        }
      : null;
  const compare = /^compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})$/u.exec(path);
  if (compare)
    return search === "" || page.test(search)
      ? (value) => {
          const data = object(value);
          return (
            object(data?.base_commit)?.sha === compare[1] &&
            typeof data?.status === "string" &&
            Array.isArray(data.commits)
          );
        }
      : null;
  const object_ = /^git\/(commits|trees|blobs)\/([a-f0-9]{40})$/u.exec(path);
  if (object_)
    return search === "" ||
      (object_[1] === "trees" && search === "?recursive=1")
      ? (value) => object(value)?.sha === object_[2]
      : null;
  return null;
}

export function githubDiscussionCache(
  options: DiscussionCacheOptions,
  now: () => number,
) {
  const repositories = new Map<string, string>();
  for (const { name, nodeId } of options.repositories) {
    if (!canonicalRepo.test(name) || !/^[A-Za-z0-9_=-]{1,128}$/u.test(nodeId))
      throw new Error("Invalid GitHub discussion cache repository identity");
    const key = name.toLowerCase();
    if (repositories.has(key))
      throw new Error("Duplicate GitHub discussion cache repository");
    repositories.set(key, nodeId);
  }
  const sizes = new Map<string, number>();
  const writing = new Set<string>();
  const publicPulls = new Set<string>();
  let totalBytes = 0;
  let loading: Promise<void> | undefined;
  async function initialize() {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const root = await lstat(options.directory);
    if (!root.isDirectory())
      throw new Error("Invalid GitHub discussion cache directory");
    for await (const entry of await opendir(options.directory)) {
      if (!entry.isFile() || !ENTRY_NAME.test(entry.name))
        throw new Error("Invalid GitHub discussion cache entry");
      const size = (await lstat(join(options.directory, entry.name))).size;
      totalBytes += size;
      sizes.set(entry.name, size);
      if (
        sizes.size > MAX_DISCUSSION_CACHE_ENTRIES ||
        totalBytes > MAX_DISCUSSION_CACHE_BYTES
      )
        throw new Error("GitHub discussion cache exceeds its retention bounds");
    }
  }
  function entry(
    nodeId: string,
    url: URL,
    maxBody: number,
    valid: (value: unknown) => boolean,
    admitted: () => boolean,
    observe: () => void,
    immutable: boolean,
  ) {
    const name = `${hash(JSON.stringify(["1", nodeId, url.href, accept, apiVersion]))}.bin`;
    const path = join(options.directory, name);
    const validBody = (bytes: Uint8Array) => {
      if (bytes.length === 0 || bytes.length > maxBody) return false;
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      return valid(value);
    };
    return {
      async read(): Promise<CachedDiscussion | null> {
        loading ??= initialize();
        await loading;
        if (!sizes.has(name)) return null;
        try {
          const handle = await open(
            path,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > maxBody + MAX_METADATA_BYTES)
              return null;
            const raw = await handle.readFile();
            const line = raw.indexOf(10);
            if (line < 1 || line >= MAX_METADATA_BYTES) return null;
            const metadata = object(
              JSON.parse(raw.subarray(0, line).toString("utf8")),
            );
            const bytes = raw.subarray(line + 1);
            if (
              metadata?.version !== 1 ||
              metadata.key !== name ||
              typeof metadata.etag !== "string" ||
              !etagPattern.test(metadata.etag) ||
              typeof metadata.observedAt !== "number" ||
              !Number.isSafeInteger(metadata.observedAt) ||
              metadata.observedAt > now() ||
              now() - metadata.observedAt > MAX_DISCUSSION_CACHE_AGE_MS ||
              metadata.digest !== hash(bytes) ||
              !validBody(bytes)
            )
              return null;
            return { etag: metadata.etag, bytes };
          } finally {
            await handle.close();
          }
        } catch {
          // An unreadable or corrupt entry never substitutes for GitHub.
          return null;
        }
      },
      async save(etag: string, bytes: Uint8Array): Promise<void> {
        if (!admitted()) return;
        try {
          if (!validBody(bytes)) return;
        } catch {
          return;
        }
        observe();
        if (!etagPattern.test(etag)) return;
        const metadata = `${JSON.stringify({ version: 1, key: name, etag, observedAt: now(), digest: hash(bytes) })}\n`;
        const size = Buffer.byteLength(metadata) + bytes.length;
        const previous = sizes.get(name) ?? 0;
        if (
          (!previous && sizes.size >= MAX_DISCUSSION_CACHE_ENTRIES) ||
          totalBytes + size - previous >
            MAX_DISCUSSION_CACHE_BYTES -
              (immutable ? DISCUSSION_RESERVE_BYTES : 0) ||
          writing.has(name)
        )
          return;
        const temporary = join(
          options.directory,
          `${name}.${randomUUID()}.tmp`,
        );
        writing.add(name);
        sizes.set(name, size);
        totalBytes += size - previous;
        try {
          await writeFile(
            temporary,
            Buffer.concat([Buffer.from(metadata), bytes]),
            { flag: "wx", mode: 0o600 },
          );
          await rename(temporary, path);
        } catch {
          // Checkpoint storage is optional. The live response is authoritative.
          totalBytes -= size - previous;
          if (previous) sizes.set(name, previous);
          else sizes.delete(name);
          await rm(temporary, { force: true }).catch(() => undefined);
        } finally {
          writing.delete(name);
        }
      },
    };
  }
  const headersMatch = (headers: Headers) =>
    headers.get("accept") === accept &&
    headers.get("x-github-api-version") === apiVersion &&
    headers.get("user-agent") === "slopbot" &&
    /^Bearer \S+$/u.test(headers.get("authorization") ?? "") &&
    [...headers.keys()].every((name) =>
      [
        "accept",
        "authorization",
        "user-agent",
        "x-github-api-version",
      ].includes(name),
    );
  return (url: URL, headers: Headers, redirect: RequestRedirect) => {
    const immutable =
      /^\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(.+)$/u.exec(url.pathname);
    const validator = immutable && immutableValidator(immutable[2], url.search);
    if (
      immutable &&
      validator &&
      url.origin === "https://api.github.com" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      redirect === "manual" &&
      headersMatch(headers)
    ) {
      const nodeId = repositories.get(immutable[1].toLowerCase());
      if (!nodeId) return null;
      return entry(
        nodeId,
        url,
        MAX_IMMUTABLE_BODY_BYTES,
        (value) => validator(value),
        () => true,
        () => undefined,
        true,
      );
    }
    const match =
      /^\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(pulls|issues)\/([1-9]\d*)(?:\/(comments|reviews))?$/u.exec(
        url.pathname,
      );
    if (
      !match ||
      url.origin !== "https://api.github.com" ||
      url.username ||
      url.password ||
      url.hash ||
      redirect !== "manual"
    )
      return null;
    const [, rawRepo, section, rawNumber, collection] = match;
    const repository = rawRepo.toLowerCase();
    const nodeId = repositories.get(repository);
    const number = Number(rawNumber);
    if (
      !nodeId ||
      !Number.isSafeInteger(number) ||
      (section === "issues" && collection !== "comments") ||
      (collection
        ? !/^\?per_page=100&page=[1-9]\d{0,5}$/u.test(url.search)
        : url.search !== "") ||
      !headersMatch(headers)
    )
      return null;
    const fragment =
      collection === "reviews"
        ? "pullrequestreview-"
        : collection === "comments"
          ? section === "issues"
            ? "issuecomment-"
            : "discussion_r"
          : undefined;
    const pullUrl = `https://github.com/${repository}/pull/${number}`;
    if (fragment !== undefined && !publicPulls.has(pullUrl)) return null;
    // Match the current observation. A failed or inaccessible PR response
    // must not leave an earlier success fencing later discussion reads.
    if (fragment === undefined) publicPulls.delete(pullUrl);
    return entry(
      nodeId,
      url,
      MAX_BODY_BYTES,
      (value) =>
        matchesDiscussion(value, number, pullUrl, repository, nodeId, fragment),
      () => fragment === undefined || publicPulls.has(pullUrl),
      () => {
        if (
          fragment === undefined &&
          publicPulls.size < MAX_DISCUSSION_CACHE_ENTRIES
        )
          publicPulls.add(pullUrl);
      },
      false,
    );
  };
}
