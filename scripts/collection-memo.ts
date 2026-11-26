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
 *   values and every recorded dependency still match (see attribution-memo.ts),
 *   the memo was written under the same ATTRIBUTION_RULES_VERSION, and the
 *   answer is younger than its refresh age. Everything else is collected live.
 *
 * Operator decision, 24 November 2026: saved answers survive code changes that
 * leave the attribution rules alone. A change to how an answer is reached must
 * raise ATTRIBUTION_RULES_VERSION; a test pins the rule sources so such a
 * change cannot land unnoticed. When any other code changed, more reused
 * answers are recomputed as an audit, and each answer is recomputed at the
 * latest a week after it was computed, on a spread of days.
 *
 * Census searches, hydration, review censuses and every consistency guard
 * still read GitHub live. The memo never changes what a collection publishes;
 * it only lets an identical answer be reached with fewer reads.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const COLLECTION_MEMO_FORMAT = "slop-collection-memo-v2";
const COLLECTION_MEMO_FORMAT_V1 = "slop-collection-memo-v1";
/** Retained private evidence older than this is not reused (accepted-implementation-memo.ts). */
export const COLLECTION_MEMO_FULL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** A saved attribution is recomputed at the latest this long after it was computed. */
export const ATTRIBUTION_REFRESH_MS = COLLECTION_MEMO_FULL_INTERVAL_MS;
/** About one reusable attribution in this many is also computed live. */
export const ATTRIBUTION_AUDIT_ONE_IN = 50;
/** The audit sample when code changed since the memo but the rules did not. */
export const ATTRIBUTION_CHANGED_CODE_AUDIT_ONE_IN = 10;
/**
 * Raise this whenever a change could make a saved attribution answer come out
 * differently: which commits are eligible, how earlier pull requests are found
 * or judged original, how a retained copy is proved, or what is recorded and
 * fenced. A raised version makes the next collection recompute every answer.
 */
export const ATTRIBUTION_RULES_VERSION = 1;
/**
 * The sources that hold the attribution rules. A `region` names the
 * `// attribution-rules: begin <region>` and `// attribution-rules: end
 * <region>` markers that bound the rules inside a larger file.
 */
export const ATTRIBUTION_RULES_SOURCES: readonly {
  path: string;
  region?: string;
}[] = [
  { path: "scripts/attribution-memo.ts" },
  { path: "scripts/retained-commit-credit.ts" },
  { path: "scripts/value-ingestion.ts", region: "retained-authors" },
  { path: "workers/slopbot/value-evidence.ts", region: "reference-discovery" },
];
/**
 * Digest of ATTRIBUTION_RULES_SOURCES when ATTRIBUTION_RULES_VERSION was last
 * reviewed. A test fails when they differ: decide whether the change needs a
 * new version, then update this value.
 */
export const ATTRIBUTION_RULES_DIGEST =
  "0446736c656f090c26112c3098bcb2fc9d9bc5fea09085788bfbb31fac105e53";
/** About one reused accepted-implementation entry in this many is also read live. */
export const IMPLEMENTATION_MEMO_AUDIT_ONE_IN = 50;
/** The audit sample when code changed since the memo but its rules did not. */
export const IMPLEMENTATION_MEMO_CHANGED_CODE_AUDIT_ONE_IN = 10;
/**
 * Raise this whenever a change could make a saved accepted-implementation
 * entry come out differently: how a native change digest is computed or
 * proved, how an earlier pull request is observed (query, acceptance, shape),
 * or what the memo keys and keeps. A raised version makes the next collection
 * read all of that evidence live.
 */
export const IMPLEMENTATION_MEMO_RULES_VERSION = 1;
/**
 * The sources that hold those rules. A `region` names the
 * `// implementation-memo-rules: begin <region>` and `// implementation-memo-rules:
 * end <region>` markers that bound the rules inside a larger file.
 */
export const IMPLEMENTATION_MEMO_RULES_SOURCES: readonly {
  path: string;
  region?: string;
}[] = [
  { path: "scripts/accepted-implementation-memo.ts" },
  { path: "scripts/accepted-implementation-digests.ts" },
  { path: "scripts/pull-request-git-files.ts" },
  { path: "scripts/value-merge-ingestion.ts", region: "public-git" },
  { path: "scripts/generate-leaderboard.ts", region: "previous-query" },
  { path: "scripts/generate-leaderboard.ts", region: "acceptance" },
  { path: "scripts/generate-leaderboard.ts", region: "shape" },
  { path: "scripts/generate-leaderboard.ts", region: "observation" },
];
/**
 * Digest of IMPLEMENTATION_MEMO_RULES_SOURCES when
 * IMPLEMENTATION_MEMO_RULES_VERSION was last reviewed. A test fails when they
 * differ: decide whether the change needs a new version, then update this.
 */
export const IMPLEMENTATION_MEMO_RULES_DIGEST =
  "e3a417a95448a7b23554c80adb9336b4db8f69d79108525fd4a431a7112beb4c";
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
  /** When the answer was computed live; null until this run's memo is written. */
  computedAt: string | null;
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
  attributionRulesVersion: number;
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

function parseEntry(
  value: unknown,
  index: number,
  v1ComputedAt: string | null,
): AttributionMemoEntry {
  const path = `attributions[${index}]`;
  const entry = record(value, path);
  exactKeys(
    entry,
    [
      "outcomeId",
      ...(v1ComputedAt ? [] : ["computedAt"]),
      "fence",
      "pulls",
      "references",
      "incoming",
      "result",
    ],
    path,
  );
  const computedAt = v1ComputedAt ?? entry.computedAt;
  if (!isoInstant(computedAt)) fail(`${path}.computedAt`);
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
    computedAt,
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
  // A version 1 memo predates the rules version and per-answer dates. It was
  // written under rules version 1; its answers are dated at its last full run,
  // the earliest any of them could have been computed.
  const v1 = value.format === COLLECTION_MEMO_FORMAT_V1;
  if (!v1 && value.format !== COLLECTION_MEMO_FORMAT)
    fail("unsupported format");
  exactKeys(
    value,
    [
      "format",
      "producedAt",
      "cutoffAt",
      "lastFullAt",
      "attributionCodeDigest",
      ...(v1 ? [] : ["attributionRulesVersion"]),
      "commitLines",
      "attributions",
    ],
    "memo",
  );
  const attributionRulesVersion = v1 ? 1 : value.attributionRulesVersion;
  if (
    !Number.isSafeInteger(attributionRulesVersion) ||
    (attributionRulesVersion as number) < 1
  )
    fail("attribution rules version");
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
  const attributions = value.attributions.map((entry, index) =>
    parseEntry(entry, index, v1 ? (value.lastFullAt as string) : null),
  );
  for (const entry of attributions)
    if (
      Date.parse(entry.computedAt as string) >
      Date.parse(value.producedAt as string)
    )
      fail("an attribution was computed after the memo");
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
    attributionRulesVersion: attributionRulesVersion as number,
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

/**
 * Digest of the attribution rule sources (ATTRIBUTION_RULES_SOURCES): whole
 * files, or the text between a region's begin and end markers.
 */
export function attributionRulesDigest(
  root = resolve(dirname(new URL(import.meta.url).pathname), ".."),
  sources = ATTRIBUTION_RULES_SOURCES,
): string {
  return rulesDigest(root, sources, "attribution-rules");
}

/** The same digest for any pinned rule set; `marker` names its region comments. */
export function rulesDigest(
  root = resolve(dirname(new URL(import.meta.url).pathname), ".."),
  sources: readonly { path: string; region?: string }[],
  marker: string,
): string {
  const parts = sources.map(({ path, region }) => {
    const source = readFileSync(join(root, path), "utf8");
    if (!region) return [path, source];
    const begin = `// ${marker}: begin ${region}\n`;
    const end = `// ${marker}: end ${region}\n`;
    const start = source.indexOf(begin);
    const stop = source.indexOf(end);
    if (
      start < 0 ||
      stop < start ||
      source.indexOf(begin, start + 1) >= 0 ||
      source.indexOf(end, stop + 1) >= 0
    )
      fail(`${marker} region ${region} in ${path} is not marked once`);
    return [path, region, source.slice(start, stop + end.length)];
  });
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * How long one saved answer may be reused, between half and all of
 * ATTRIBUTION_REFRESH_MS, fixed per outcome. Answers recomputed together
 * therefore come due on different days, and once recomputed they stay spread.
 */
export function attributionRefreshAge(outcomeId: string): number {
  const fraction =
    createHash("sha256")
      .update(`slop-attribution-refresh\0${outcomeId}`)
      .digest()
      .readUInt32BE(0) / 0x1_0000_0000;
  return Math.floor((ATTRIBUTION_REFRESH_MS * (1 + fraction)) / 2);
}

/** An attribution that takes at least this long is named in the log. */
export const SLOW_ATTRIBUTION_MS = 3 * 60 * 1000;

/** Where slow-attribution and reuse-count lines go. Diagnostic only. */
export interface AttributionLog {
  thresholdMs?: number;
  write?: (line: string) => void;
}

/**
 * Time one pull request's attribution. `pull` is its public `owner/repo#N`.
 * A line is written if it is still running at the threshold, so a run that
 * dies inside it has named it, and another when it ends at or past the
 * threshold, with the minutes taken and how it was answered. Nothing else is
 * logged and no result depends on it.
 */
export function watchAttribution(
  pull: string,
  log: AttributionLog = {},
): (how: string) => void {
  const thresholdMs = log.thresholdMs ?? SLOW_ATTRIBUTION_MS;
  const write =
    log.write ?? ((line: string) => void process.stderr.write(line));
  const minutes = (ms: number) => (ms / 60_000).toFixed(1);
  const startedAt = Date.now();
  const timer =
    thresholdMs > 0
      ? setTimeout(
          () =>
            write(
              `[slop.cash] slow attribution still running: ${pull}, over ${minutes(thresholdMs)} minutes\n`,
            ),
          thresholdMs,
        )
      : null;
  timer?.unref();
  return (how) => {
    if (timer) clearTimeout(timer);
    const elapsed = Date.now() - startedAt;
    if (elapsed >= thresholdMs)
      write(
        `[slop.cash] slow attribution: ${pull} took ${minutes(elapsed)} minutes, ${how}\n`,
      );
  };
}

/** The reuse counts of one pass, and why live answers were not recorded. */
export function collectionMemoStatsLines(
  session: CollectionMemoSession,
): string {
  const lines = session.commitLines;
  const counts = `[slop.cash] collection memo: commit statistics ${lines.reused} reused, ${lines.read} read; attributions ${session.stats.reused} reused, ${session.stats.live} computed live, ${session.expired} past their refresh age, ${session.stats.audited} audited (1 in ${session.auditOneIn}), ${session.stats.auditMismatches} audit mismatches, ${session.stats.fenceMisses} changed since the last collection\n`;
  if (!session.notReusable.size) return counts;
  return `${counts}[slop.cash] attributions not recorded for reuse: ${[
    ...session.notReusable,
  ]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([reason, count]) => `${count} x ${reason}`)
    .join("; ")}\n`;
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
  /** Saved answers left out because they reached their refresh age. */
  expired = 0;

  constructor(
    readonly mode: CollectionMode,
    readonly codeDigest: string,
    readonly lastFullAt: string,
    readonly reason: string,
    commitLines: readonly CommitLineRow[] = [],
    prior: readonly AttributionMemoEntry[] = [],
    readonly auditOneIn: number = ATTRIBUTION_AUDIT_ONE_IN,
  ) {
    if (!Number.isSafeInteger(auditOneIn) || auditOneIn < 1)
      throw new Error("Invalid attribution audit rate");
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
    return digest.readUInt32BE(0) % this.auditOneIn === 0;
  }

  serialize(cutoffAt: string, producedAt: string): string {
    const file: CollectionMemoFile = {
      format: COLLECTION_MEMO_FORMAT,
      producedAt,
      cutoffAt,
      lastFullAt: this.mode === "full" ? producedAt : this.lastFullAt,
      attributionCodeDigest: this.codeDigest,
      attributionRulesVersion: ATTRIBUTION_RULES_VERSION,
      commitLines: this.commitLines.rows(),
      attributions: [...this.next.values()]
        // A live answer is dated by the run that computed it.
        .map((entry) => ({
          ...entry,
          computedAt: entry.computedAt ?? producedAt,
        }))
        .sort((a, b) =>
          a.outcomeId < b.outcomeId ? -1 : a.outcomeId > b.outcomeId ? 1 : 0,
        ),
    };
    return `${JSON.stringify(file)}\n`;
  }
}

/**
 * Decide the mode for this run. No memo, a forced full run, or a memo written
 * under other attribution rules recomputes every attribution live. Otherwise
 * the run is incremental: answers past their refresh age are left out, and if
 * any other code changed since the memo the audit sample grows. Commit
 * statistics are immutable, so a readable memo always supplies them.
 */
export function openCollectionMemo(options: {
  memo: CollectionMemoFile | null;
  forceFull: boolean;
  now: Date;
  codeDigest: string;
  rulesVersion?: number;
}): CollectionMemoSession {
  const {
    memo,
    forceFull,
    now,
    codeDigest,
    rulesVersion = ATTRIBUTION_RULES_VERSION,
  } = options;
  if (!memo)
    return new CollectionMemoSession(
      "full",
      codeDigest,
      now.toISOString(),
      "no previous memo",
    );
  if (Date.parse(memo.producedAt) > now.getTime())
    fail("memo was produced in the future");
  const fullReason = forceFull
    ? "full collection requested"
    : memo.attributionRulesVersion !== rulesVersion
      ? "attribution rules changed"
      : null;
  if (fullReason)
    return new CollectionMemoSession(
      "full",
      codeDigest,
      memo.lastFullAt,
      fullReason,
      memo.commitLines,
    );
  const codeChanged = memo.attributionCodeDigest !== codeDigest;
  const current = memo.attributions.filter(
    (entry) =>
      now.getTime() - Date.parse(entry.computedAt as string) <
      attributionRefreshAge(entry.outcomeId),
  );
  const session = new CollectionMemoSession(
    "incremental",
    codeDigest,
    memo.lastFullAt,
    codeChanged
      ? `code changed since the previous memo; auditing 1 in ${ATTRIBUTION_CHANGED_CODE_AUDIT_ONE_IN}`
      : "previous memo matches",
    memo.commitLines,
    current,
    codeChanged
      ? ATTRIBUTION_CHANGED_CODE_AUDIT_ONE_IN
      : ATTRIBUTION_AUDIT_ONE_IN,
  );
  session.expired = memo.attributions.length - current.length;
  return session;
}
