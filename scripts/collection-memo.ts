/**
 * Incremental collection memo (PRD section 9, operator decision,
 * 19 November 2026).
 *
 * A trusted main collection writes what it learned that cannot change, or
 * that GitHub versions for us, so the next collection reads only what moved:
 *
 * - Commit line statistics by repository node, commit node and object ID.
 *   Git objects never change, so these are reused exactly.
 * - Commit attribution results per merged pull request, with every fence the
 *   computation depended on. A result is reused only when the live census
 *   values, the attribution code digest and every recorded dependency still
 *   match (see attribution-memo.ts). Everything else is collected live.
 *
 * Census searches, hydration, review censuses and every consistency guard
 * still read GitHub live. The memo never changes what a collection publishes;
 * it only lets an identical answer be reached with fewer reads.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const COLLECTION_MEMO_FORMAT = "slop-collection-memo-v1";
/** A run whose memo line has not been fully recollected for this long is full. */
export const COLLECTION_MEMO_FULL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** About one reusable attribution in this many is also computed live. */
export const ATTRIBUTION_AUDIT_ONE_IN = 50;
const MAX_MEMO_BYTES = 512 * 1024 * 1024;
const MAX_COMMIT_LINES = 2_000_000;
const MAX_ATTRIBUTIONS = 200_000;
const nodeId = /^[A-Za-z0-9_=+/-]{1,128}$/u;
const sha = /^[a-f0-9]{40}$/u;
const isoInstant = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

export type CommitLineRow = [
  repositoryNodeId: string,
  commitNodeId: string,
  oid: string,
  additions: number,
  deletions: number,
];

/** A pull request the attribution read, with the version that fenced it. */
export interface AttributionPullDependency {
  id: string;
  updatedAt: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  url: string;
}

/** One text reference lookup and the exact repository object GitHub returned. */
export interface AttributionReferenceDependency {
  owner: string;
  name: string;
  number: number;
  repository: unknown;
}

export type AttributionMemoResult =
  | { kind: "none" }
  | {
      kind: "authors";
      authors: [
        sha: string,
        actorNodeId: string,
        originalPullRequestId: string,
        originalPullRequestUrl: string,
        originalCommitSha: string,
      ][];
    };

export interface AttributionMemoFence {
  number: number;
  url: string;
  headRefOid: string;
  mergedAt: string;
  updatedAt: string;
  repositoryNodeId: string;
  eligibleCommitShas: string[];
}

export interface AttributionMemoEntry {
  outcomeId: string;
  fence: AttributionMemoFence;
  pulls: AttributionPullDependency[];
  references: AttributionReferenceDependency[];
  /** Normalized incoming cross-reference sources, sorted. */
  incoming: string[];
  result: AttributionMemoResult;
}

export interface CollectionMemoFile {
  format: typeof COLLECTION_MEMO_FORMAT;
  producedAt: string;
  cutoffAt: string;
  lastFullAt: string;
  attributionCodeDigest: string;
  commitLines: CommitLineRow[];
  attributions: AttributionMemoEntry[];
}

function fail(message: string): never {
  throw new Error(`Invalid collection memo: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  path: string,
) {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort()))
    fail(`${path} has unexpected fields`);
}

function text(value: unknown, path: string, max = 2048): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    fail(`${path} must be a bounded string`);
  return value;
}

function count(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    fail(`${path} must be a non-negative integer`);
  return value as number;
}

function parseCommitLine(value: unknown, index: number): CommitLineRow {
  const path = `commitLines[${index}]`;
  if (!Array.isArray(value) || value.length !== 5) fail(`${path} shape`);
  const [repository, commit, oid, additions, deletions] = value;
  if (
    typeof repository !== "string" ||
    !nodeId.test(repository) ||
    typeof commit !== "string" ||
    !nodeId.test(commit) ||
    typeof oid !== "string" ||
    !sha.test(oid)
  )
    fail(`${path} identity`);
  return [
    repository,
    commit,
    oid,
    count(additions, path),
    count(deletions, path),
  ];
}

function parseEntry(value: unknown, index: number): AttributionMemoEntry {
  const path = `attributions[${index}]`;
  const entry = record(value, path);
  exactKeys(
    entry,
    ["outcomeId", "fence", "pulls", "references", "incoming", "result"],
    path,
  );
  const fence = record(entry.fence, `${path}.fence`);
  exactKeys(
    fence,
    [
      "number",
      "url",
      "headRefOid",
      "mergedAt",
      "updatedAt",
      "repositoryNodeId",
      "eligibleCommitShas",
    ],
    `${path}.fence`,
  );
  if (
    !Array.isArray(fence.eligibleCommitShas) ||
    fence.eligibleCommitShas.length === 0 ||
    fence.eligibleCommitShas.some(
      (value) => typeof value !== "string" || !sha.test(value),
    )
  )
    fail(`${path}.fence.eligibleCommitShas`);
  if (
    typeof fence.headRefOid !== "string" ||
    !sha.test(fence.headRefOid) ||
    !isoInstant(fence.mergedAt) ||
    !isoInstant(fence.updatedAt) ||
    typeof fence.repositoryNodeId !== "string" ||
    !nodeId.test(fence.repositoryNodeId)
  )
    fail(`${path}.fence values`);
  if (!Array.isArray(entry.pulls)) fail(`${path}.pulls`);
  const pulls = entry.pulls.map((pull, pullIndex) => {
    const item = record(pull, `${path}.pulls[${pullIndex}]`);
    exactKeys(item, ["id", "updatedAt", "state", "url"], `${path}.pulls`);
    if (
      typeof item.id !== "string" ||
      !nodeId.test(item.id) ||
      !isoInstant(item.updatedAt) ||
      !["OPEN", "CLOSED", "MERGED"].includes(item.state as string)
    )
      fail(`${path}.pulls[${pullIndex}]`);
    return {
      id: item.id,
      updatedAt: item.updatedAt as string,
      state: item.state as AttributionPullDependency["state"],
      url: text(item.url, `${path}.pulls[${pullIndex}].url`),
    };
  });
  if (!Array.isArray(entry.references)) fail(`${path}.references`);
  const references = entry.references.map((reference, referenceIndex) => {
    const item = record(reference, `${path}.references[${referenceIndex}]`);
    exactKeys(
      item,
      ["owner", "name", "number", "repository"],
      `${path}.references`,
    );
    return {
      owner: text(item.owner, `${path}.references.owner`, 100),
      name: text(item.name, `${path}.references.name`, 100),
      number: count(item.number, `${path}.references.number`),
      repository: record(item.repository, `${path}.references.repository`),
    };
  });
  if (
    !Array.isArray(entry.incoming) ||
    entry.incoming.some((value) => typeof value !== "string")
  )
    fail(`${path}.incoming`);
  const result = record(entry.result, `${path}.result`);
  let parsedResult: AttributionMemoResult;
  if (result.kind === "none") {
    exactKeys(result, ["kind"], `${path}.result`);
    parsedResult = { kind: "none" };
  } else if (result.kind === "authors") {
    exactKeys(result, ["kind", "authors"], `${path}.result`);
    if (!Array.isArray(result.authors) || result.authors.length === 0)
      fail(`${path}.result.authors`);
    parsedResult = {
      kind: "authors",
      authors: result.authors.map((author, authorIndex) => {
        if (!Array.isArray(author) || author.length !== 5)
          fail(`${path}.result.authors[${authorIndex}]`);
        const [commit, actor, original, originalUrl, originalCommit] = author;
        if (
          typeof commit !== "string" ||
          !sha.test(commit) ||
          typeof actor !== "string" ||
          !nodeId.test(actor) ||
          typeof original !== "string" ||
          !nodeId.test(original) ||
          typeof originalCommit !== "string" ||
          !sha.test(originalCommit)
        )
          fail(`${path}.result.authors[${authorIndex}]`);
        return [
          commit,
          actor,
          original,
          text(originalUrl, `${path}.result.authors[${authorIndex}]`),
          originalCommit,
        ];
      }),
    };
  } else fail(`${path}.result.kind`);
  return {
    outcomeId: text(entry.outcomeId, `${path}.outcomeId`, 128),
    fence: {
      number: count(fence.number, `${path}.fence.number`),
      url: text(fence.url, `${path}.fence.url`),
      headRefOid: fence.headRefOid as string,
      mergedAt: fence.mergedAt as string,
      updatedAt: fence.updatedAt as string,
      repositoryNodeId: fence.repositoryNodeId as string,
      eligibleCommitShas: [...(fence.eligibleCommitShas as string[])],
    },
    pulls,
    references,
    incoming: [...(entry.incoming as string[])],
    result: parsedResult,
  };
}

/** Strictly parse a memo. Any deviation rejects the whole file. */
export function parseCollectionMemo(bytes: string): CollectionMemoFile {
  if (bytes.length > MAX_MEMO_BYTES) fail("file is too large");
  const value = record(JSON.parse(bytes), "memo");
  exactKeys(
    value,
    [
      "format",
      "producedAt",
      "cutoffAt",
      "lastFullAt",
      "attributionCodeDigest",
      "commitLines",
      "attributions",
    ],
    "memo",
  );
  if (value.format !== COLLECTION_MEMO_FORMAT) fail("unsupported format");
  if (
    !isoInstant(value.producedAt) ||
    !isoInstant(value.cutoffAt) ||
    !isoInstant(value.lastFullAt) ||
    Date.parse(value.lastFullAt) > Date.parse(value.producedAt)
  )
    fail("timestamps");
  if (
    typeof value.attributionCodeDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.attributionCodeDigest)
  )
    fail("attribution code digest");
  if (
    !Array.isArray(value.commitLines) ||
    value.commitLines.length > MAX_COMMIT_LINES ||
    !Array.isArray(value.attributions) ||
    value.attributions.length > MAX_ATTRIBUTIONS
  )
    fail("collections");
  const commitLines = value.commitLines.map(parseCommitLine);
  const attributions = value.attributions.map(parseEntry);
  const commitIds = new Set<string>();
  for (const [repository, commit] of commitLines) {
    const key = `${repository}\0${commit}`;
    if (commitIds.has(key)) fail("commit statistics repeat a commit");
    commitIds.add(key);
  }
  const outcomes = new Set<string>();
  for (const entry of attributions) {
    if (outcomes.has(entry.outcomeId)) fail("attributions repeat an outcome");
    outcomes.add(entry.outcomeId);
  }
  return {
    format: COLLECTION_MEMO_FORMAT,
    producedAt: value.producedAt as string,
    cutoffAt: value.cutoffAt as string,
    lastFullAt: value.lastFullAt as string,
    attributionCodeDigest: value.attributionCodeDigest,
    commitLines,
    attributions,
  };
}

const importSpecifier =
  /(?:^|[\s;])(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gmu;
const sourceExtensions = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".js",
  "/index.ts",
];

/**
 * Digest of the attribution code: the transitive relative-import closure of
 * value-ingestion.ts plus the dependency lockfile. Any change to code that
 * can reach an attribution answer invalidates every reused attribution.
 */
export function attributionCodeDigest(
  root = resolve(dirname(new URL(import.meta.url).pathname), ".."),
  entry = "scripts/value-ingestion.ts",
): string {
  const pending = [resolve(root, entry)];
  const files = new Map<string, string>();
  while (pending.length) {
    const file = pending.pop() as string;
    if (files.has(file)) continue;
    const source = readFileSync(file, "utf8");
    files.set(file, createHash("sha256").update(source).digest("hex"));
    for (const match of source.matchAll(importSpecifier)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier?.startsWith(".")) continue;
      const base = resolve(dirname(file), specifier);
      const found = sourceExtensions
        .map((extension) => `${base}${extension}`)
        .find(
          (candidate) =>
            statSync(candidate, { throwIfNoEntry: false })?.isFile() === true,
        );
      if (!found)
        fail(
          `unresolved attribution import ${specifier} in ${relative(root, file)}`,
        );
      pending.push(found);
    }
  }
  const lock = join(root, "bun.lock");
  const entries = [...files]
    .map(([file, digest]) => [relative(root, file), digest])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256")
    .update(
      JSON.stringify([
        COLLECTION_MEMO_FORMAT,
        entries,
        existsSync(lock)
          ? createHash("sha256").update(readFileSync(lock)).digest("hex")
          : null,
      ]),
    )
    .digest("hex");
}

/** Immutable commit line statistics, read from and written to the memo. */
export class CommitLineMemo {
  private readonly known = new Map<string, CommitLineRow>();
  private readonly seen = new Map<string, CommitLineRow>();
  reused = 0;
  read = 0;

  constructor(rows: readonly CommitLineRow[] = []) {
    for (const row of rows) this.known.set(`${row[0]}\0${row[1]}`, row);
  }

  lookup(repositoryNodeId: string, commitNodeId: string, oid: string) {
    const row = this.known.get(`${repositoryNodeId}\0${commitNodeId}`);
    // A different object ID under the same node is not this commit.
    if (!row || row[2] !== oid) return undefined;
    this.reused += 1;
    this.seen.set(`${repositoryNodeId}\0${commitNodeId}`, row);
    return { additions: row[3], deletions: row[4] };
  }

  record(row: CommitLineRow) {
    const key = `${row[0]}\0${row[1]}`;
    this.read += 1;
    this.known.set(key, row);
    this.seen.set(key, row);
  }

  beginPass() {
    this.seen.clear();
    this.reused = 0;
    this.read = 0;
  }

  rows(): CommitLineRow[] {
    return [...this.seen.values()].sort((a, b) => {
      const left = `${a[0]}\0${a[1]}`;
      const right = `${b[0]}\0${b[1]}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
}

export type CollectionMode = "incremental" | "full";

/**
 * One generator process's view of the memo. `prior` is what the previous
 * trusted collection recorded; `next` is written for the following one.
 */
export class CollectionMemoSession {
  readonly commitLines: CommitLineMemo;
  readonly prior: ReadonlyMap<string, AttributionMemoEntry>;
  readonly next = new Map<string, AttributionMemoEntry>();
  readonly stats = {
    reused: 0,
    live: 0,
    audited: 0,
    auditMismatches: 0,
    fenceMisses: 0,
  };
  /** Why live attributions could not be recorded for reuse, by reason. */
  readonly notReusable = new Map<string, number>();

  constructor(
    readonly mode: CollectionMode,
    readonly codeDigest: string,
    readonly lastFullAt: string,
    readonly reason: string,
    commitLines: readonly CommitLineRow[] = [],
    prior: readonly AttributionMemoEntry[] = [],
  ) {
    this.commitLines = new CommitLineMemo(commitLines);
    this.prior = new Map(
      mode === "incremental"
        ? prior.map((entry) => [entry.outcomeId, entry])
        : [],
    );
  }

  beginPass() {
    this.commitLines.beginPass();
    this.next.clear();
    for (const key of Object.keys(this.stats) as (keyof typeof this.stats)[])
      this.stats[key] = 0;
    this.notReusable.clear();
  }

  /**
   * Counts why one live attribution was not recorded for reuse. Diagnostic
   * only: numbers, hashes and paths are masked so reasons group by kind.
   */
  noteNotReusable(reasons: readonly string[]) {
    const kinds = new Set(
      (reasons.length ? reasons : ["no reason recorded"]).map((reason) =>
        reason
          .replace(/[a-f0-9]{40}/gu, "SHA")
          .replace(/\d+/gu, "N")
          .slice(0, 80),
      ),
    );
    for (const kind of kinds)
      this.notReusable.set(kind, (this.notReusable.get(kind) ?? 0) + 1);
  }

  /** Deterministic audit sample, stable for one cutoff. */
  audits(outcomeId: string, cutoffAt: string): boolean {
    const digest = createHash("sha256")
      .update(`${cutoffAt}\0${outcomeId}`)
      .digest();
    return digest.readUInt32BE(0) % ATTRIBUTION_AUDIT_ONE_IN === 0;
  }

  serialize(cutoffAt: string, producedAt: string): string {
    const file: CollectionMemoFile = {
      format: COLLECTION_MEMO_FORMAT,
      producedAt,
      cutoffAt,
      lastFullAt: this.mode === "full" ? producedAt : this.lastFullAt,
      attributionCodeDigest: this.codeDigest,
      commitLines: this.commitLines.rows(),
      attributions: [...this.next.values()].sort((a, b) =>
        a.outcomeId < b.outcomeId ? -1 : a.outcomeId > b.outcomeId ? 1 : 0,
      ),
    };
    return `${JSON.stringify(file)}\n`;
  }
}

/**
 * Decide the mode for this run. No memo, a forced full run, a memo line whose
 * last full collection is older than a week, or a memo from different
 * attribution code all recompute attributions live. Commit statistics are
 * immutable, so a readable memo always supplies them.
 */
export function openCollectionMemo(options: {
  memo: CollectionMemoFile | null;
  forceFull: boolean;
  now: Date;
  codeDigest: string;
}): CollectionMemoSession {
  const { memo, forceFull, now, codeDigest } = options;
  if (!memo)
    return new CollectionMemoSession(
      "full",
      codeDigest,
      now.toISOString(),
      "no previous memo",
    );
  if (Date.parse(memo.producedAt) > now.getTime())
    fail("memo was produced in the future");
  const reason = forceFull
    ? "full collection requested"
    : now.getTime() - Date.parse(memo.lastFullAt) >
        COLLECTION_MEMO_FULL_INTERVAL_MS
      ? "weekly full collection"
      : memo.attributionCodeDigest !== codeDigest
        ? "attribution code changed"
        : null;
  return new CollectionMemoSession(
    reason ? "full" : "incremental",
    codeDigest,
    memo.lastFullAt,
    reason ?? "previous memo matches",
    memo.commitLines,
    memo.attributions,
  );
}
