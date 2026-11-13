/** #1466: real collection, scoring, atomic output and Points replay over HTTP. */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  assertLeaderboardSnapshot,
  hasMaterialTestChange,
  type LeaderboardSnapshot,
} from "../src/lib/leaderboard";
import {
  appendPointAwards,
  applyPointsSnapshot,
  awardForScore,
  latestPoints,
  type PointsJournal,
} from "../src/lib/points";
import { findProject } from "../src/lib/projects.mjs";
import {
  REGISTERED_REPOSITORIES,
  TARGET_REPOSITORIES,
  type TargetRepository,
} from "../src/lib/repositories.mjs";
import {
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import {
  collectSearchReferences,
  GitHubGraphqlClient,
  generateLeaderboardFromGitHub,
  MAX_GRAPHQL_REQUEST_ATTEMPTS,
  MAX_TRANSIENT_ATTEMPTS,
  type OutcomeCommitIdentity,
  OutcomeCommitLineLoader,
  runGenerator,
  SourceNodeUnavailableError,
  writeLeaderboardAtomically,
} from "./generate-leaderboard";
import {
  type PullRequestGitFiles,
  type PullRequestGitFilesInput,
  readPullRequestGitFiles,
} from "./pull-request-git-files";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
});
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const connection = <T>(nodes: T[]) => ({
  totalCount: nodes.length,
  nodes,
  pageInfo: { hasNextPage: false, endCursor: null as string | null },
});

const lineIdentity = (index: number): OutcomeCommitIdentity => ({
  id: `C_${index.toString(16).padStart(40, "0")}`,
  oid: index.toString(16).padStart(40, "0"),
  parentCount: 1,
  author: penaltyScoreInput([]).mergedPullRequestOutcomes[0].author,
});

function lineCacheFixture(identities: OutcomeCommitIdentity[]) {
  const calls: string[][] = [];
  let transform: (nodes: unknown[], call: number) => unknown[] = (nodes) =>
    nodes;
  const client = {
    async execute(_document: string, variables: Record<string, unknown> = {}) {
      const ids = variables.ids as string[];
      calls.push([...ids]);
      const nodes = ids.map((id) => {
        const index = identities.findIndex((identity) => identity.id === id);
        const identity = required(identities[index]);
        return {
          __typename: "Commit",
          id,
          oid: identity.oid,
          repository: { id: "R_line_cache" },
          additions: index + 1,
          deletions: index % 3,
        };
      });
      return { nodes: transform(nodes, calls.length) };
    },
  };
  return {
    calls,
    client,
    loader: new OutcomeCommitLineLoader(client),
    transform(next: typeof transform) {
      transform = next;
    },
  };
}

test("immutable line cache batches unique commits and reuses only this run's successful statistics", async () => {
  const identities = Array.from({ length: 205 }, (_, index) =>
    lineIdentity(index + 1),
  );
  const f = lineCacheFixture(identities);
  await f.loader.hydrate("R_line_cache", identities.slice(0, 150));
  const hydrated = await f.loader.hydrate("R_line_cache", identities);
  await f.loader.hydrate("R_line_cache", identities.slice(10, 100));
  expect(f.calls.map((ids) => ids.length)).toEqual([100, 50, 55]);
  expect(new Set(f.calls.flat()).size).toBe(205);
  expect(hydrated[204]).toMatchObject({
    oid: identities[204].oid,
    additions: 205,
    deletions: 0,
  });
  expect(hydrated[0]).not.toHaveProperty("id");
  await new OutcomeCommitLineLoader(f.client).hydrate(
    "R_line_cache",
    identities.slice(0, 1),
  );
  expect(f.calls.map((ids) => ids.length)).toEqual([100, 50, 55, 1]);
});

test("a failed later statistics batch cannot warm an earlier partial load", async () => {
  const identities = Array.from({ length: 101 }, (_, index) =>
    lineIdentity(index + 1),
  );
  const f = lineCacheFixture(identities);
  f.transform((nodes, call) => (call === 2 ? [] : nodes));
  await expect(f.loader.hydrate("R_line_cache", identities)).rejects.toThrow(
    "statistics are incomplete",
  );
  f.transform((nodes) => nodes);
  await f.loader.hydrate("R_line_cache", identities);
  expect(f.calls.map((ids) => ids.length)).toEqual([100, 1, 100, 1]);
});

test("an unavailable commit cannot escape as a missing PR or warm the cache", async () => {
  const identities = [lineIdentity(1)];
  const f = lineCacheFixture(identities);
  f.transform(() => {
    throw new SourceNodeUnavailableError([
      { nodeId: identities[0].id, reason: "NOT_FOUND" },
    ]);
  });
  const failure = await f.loader
    .hydrate("R_line_cache", identities)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(SourceNodeUnavailableError);
  expect((failure as Error).cause).toBeInstanceOf(SourceNodeUnavailableError);
  f.transform((nodes) => nodes);
  await f.loader.hydrate("R_line_cache", identities);
  expect(f.calls).toHaveLength(2);
});

for (const invalid of [
  "missing",
  "null",
  "reordered",
  "duplicate",
  "wrong-id",
  "wrong-sha",
  "wrong-kind",
  "wrong-repository",
  "missing-count",
  "negative",
  "fractional",
  "overflow",
] as const) {
  test(`immutable line cache refuses ${invalid} statistics without caching them`, async () => {
    const identities = [lineIdentity(1), lineIdentity(2)];
    const f = lineCacheFixture(identities);
    f.transform((nodes) => {
      if (invalid === "missing") return nodes.slice(1);
      if (invalid === "null") return [null, nodes[1]];
      if (invalid === "reordered") return [...nodes].reverse();
      if (invalid === "duplicate") return [nodes[0], nodes[0]];
      const first = nodes[0] as Record<string, unknown>;
      if (invalid === "wrong-id") first.id = "C_wrong";
      if (invalid === "wrong-sha") first.oid = "f".repeat(40);
      if (invalid === "wrong-kind") first.__typename = "PullRequest";
      if (invalid === "wrong-repository") first.repository = { id: "R_wrong" };
      if (invalid === "missing-count") delete first.deletions;
      if (invalid === "negative") first.additions = -1;
      if (invalid === "fractional") first.additions = 0.5;
      if (invalid === "overflow") first.additions = Number.MAX_SAFE_INTEGER + 1;
      return nodes;
    });
    await expect(
      f.loader.hydrate("R_line_cache", identities),
    ).rejects.toThrow();
    f.transform((nodes) => nodes);
    await f.loader.hydrate("R_line_cache", identities);
    expect(f.calls).toEqual([
      identities.map((row) => row.id),
      identities.map((row) => row.id),
    ]);
  });
}

test("immutable line cache checks input identity and metadata before accepting a cache hit", async () => {
  const identity = lineIdentity(1);
  const f = lineCacheFixture([identity]);
  for (const changed of [
    { ...identity, oid: "f".repeat(40) },
    { ...identity, parentCount: 2 },
    { ...identity, author: null },
  ]) {
    await expect(
      f.loader.hydrate("R_line_cache", [identity, changed]),
    ).rejects.toThrow("immutable commit metadata");
  }
  expect(f.calls).toEqual([]);
  await f.loader.hydrate("R_line_cache", [identity]);
  await expect(f.loader.hydrate("R_other", [identity])).rejects.toThrow(
    "immutable commit metadata",
  );
  await expect(
    f.loader.hydrate("R_line_cache", [{ ...identity, parentCount: 2 }]),
  ).rejects.toThrow("immutable commit metadata");
  await expect(
    f.loader.hydrate("R_line_cache", [{ ...identity, id: "C_other" }]),
  ).rejects.toThrow("immutable SHA");
  const author = required(identity.author);
  const renamed = {
    ...identity,
    author: { ...author, login: "renamed", url: "https://github.com/renamed" },
  };
  expect(
    (await f.loader.hydrate("R_line_cache", [renamed]))[0].author?.login,
  ).toBe("renamed");
  expect(f.calls).toHaveLength(1);
});

test("ordinary commit pagination and PR search pages share one flat statistics cache", async () => {
  const identities = Array.from({ length: 151 }, (_, index) =>
    lineIdentity(index + 1),
  );
  const repositoryNodeId = required(repository.expectedNodeId);
  const statsCalls: string[][] = [];
  const commitNode = (row: OutcomeCommitIdentity) => ({
    commit: {
      id: row.id,
      oid: row.oid,
      parents: { totalCount: row.parentCount },
      author: {
        user: row.author
          ? { ...row.author, __typename: row.author.kind }
          : null,
      },
    },
  });
  const makePull = (number: number, rows: OutcomeCommitIdentity[]) => ({
    ...nodeFor(retained),
    id: `PR_line_${number}`,
    number,
    url: `${repository.githubUrl}/pull/${number}`,
    headRefOid: rows.at(-1)?.oid,
    commits: {
      ...connection(rows.slice(0, 100).map(commitNode)),
      totalCount: rows.length,
      pageInfo: {
        hasNextPage: rows.length > 100,
        endCursor: rows.length > 100 ? "commits-100" : null,
      },
    },
  });
  const first = makePull(1, identities);
  const second = makePull(2, [identities[150]]);
  const client = {
    async execute(document: string, variables: Record<string, unknown> = {}) {
      if (document.includes("query LeaderboardSearchReferences")) {
        expect(variables.withMergeCommits).toBe(true);
        expect(document).not.toContain("oid additions deletions");
        return {
          search: {
            issueCount: 2,
            nodes: [variables.after ? second : first],
            pageInfo: {
              hasNextPage: !variables.after,
              endCursor: variables.after ? null : "search-2",
            },
          },
        };
      }
      if (document.includes("query LeaderboardOutcomeCommits")) {
        expect(document).not.toContain("oid additions deletions");
        return {
          node: {
            ...first,
            commits: {
              ...connection(identities.slice(100).map(commitNode)),
              totalCount: identities.length,
            },
          },
        };
      }
      const ids = variables.ids as string[];
      statsCalls.push([...ids]);
      return {
        nodes: ids.map((id) => ({
          __typename: "Commit",
          id,
          oid: required(identities.find((row) => row.id === id)).oid,
          repository: { id: repositoryNodeId },
          additions: 1,
          deletions: 0,
        })),
      };
    },
  };
  const loader = new OutcomeCommitLineLoader(client);
  const collect = () =>
    collectSearchReferences(
      client as never,
      repository,
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-20T00:00:00Z"),
      "merged",
      "is:pr is:merged",
      "PullRequest",
      { searchSliceCount: 0 },
      loader,
      repositoryNodeId,
    );
  const references = await collect();
  expect(references.map((row) => row.outcome?.commits?.length)).toEqual([
    151, 1,
  ]);
  expect(statsCalls.map((ids) => ids.length)).toEqual([100, 51]);
  expect(new Set(statsCalls.flat()).size).toBe(151);
  expect(references[1].outcome?.commits?.[0]).toMatchObject({
    additions: 1,
    deletions: 0,
  });
  await collect();
  expect(statsCalls).toHaveLength(2);
});
function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Missing source-recovery fixture");
  return value;
}
const project = required(findProject("asi"));
const repository = required(
  TARGET_REPOSITORIES.find((row) => row.projectId === "asi"),
);
const template = penaltyScoreInput([]).mergedPullRequests;
const retained = required(template.find((pull) => pull.id === "PR_november"));
const unaffected = required(template.find((pull) => pull.id === "PR_owner"));
const removed = {
  ...retained,
  id: "PR_removed",
  number: 77,
  headRefOid: "f".repeat(40),
  url: `${repository.githubUrl}/pull/77`,
};
const pulls = [retained, unaffected, removed];
const nodeFor = (pull: (typeof pulls)[number]) => ({
  ...pull,
  __typename: "PullRequest",
  state: "MERGED",
  baseRefName: "main",
  baseRefOid: "a".repeat(40),
  author: { ...pull.author, __typename: "User" },
  reviewRequests: { totalCount: 0 },
  comments: connection([]),
  reviews: connection([]),
  files: connection(pull.files ?? []),
  assignees: connection([]),
  labels: connection([]),
  closingIssuesReferences: connection([]),
  commits: connection([
    {
      commit: {
        id: `C_${pull.headRefOid}`,
        oid: pull.headRefOid,
        additions: pull.additions,
        deletions: pull.deletions,
        parents: { totalCount: 1 },
        author: { user: { ...pull.author, __typename: "User" } },
      },
    },
  ]),
});
// Open work listed before detail hydration. One PR and one issue close
// between the open listing and their detail reads.
const openPull = (id: string, number: number) => ({
  ...unaffected,
  id,
  number,
  headRefOid: String(number % 10).repeat(40),
  url: `${repository.githubUrl}/pull/${number}`,
  mergedAt: null,
  closedAt: null,
});
const stillOpenPull = openPull("PR_still_open", 81);
const mergedAfterListing = openPull("PR_merged_after_listing", 82);
const updatedWhileListing = openPull("PR_updated_while_listing", 83);
const openIssueNode = (id: string, number: number, open: boolean) => ({
  __typename: "Issue",
  id,
  state: open ? "OPEN" : "CLOSED",
  number,
  title: "Open work item",
  url: `${repository.githubUrl}/issues/${number}`,
  body: "Describe the defect.",
  createdAt: unaffected.createdAt,
  updatedAt: unaffected.updatedAt,
  closedAt: open ? null : GENERATED_AT,
  stateReason: open ? null : "COMPLETED",
  author: { ...unaffected.author, __typename: "User" },
  labels: connection([]),
  assignees: connection([]),
  comments: connection([]),
  timelineItems: connection([]),
  closedByPullRequestsReferences: connection([]),
});
const record = {
  schemaVersion: "slop-work-unit-record:v1",
  projectId: project.id,
  sourceDigest: "d".repeat(64),
  producerRevision: "a".repeat(40),
  assessedAt: retained.updatedAt,
  sources: [retained, removed].map((pull) => ({
    repository: repository.id,
    repositoryNodeId: project.authority.repositoryNodeId,
    repositoryDatabaseId: 123,
    pullRequestNodeId: pull.id,
    pullRequestNumber: pull.number,
    headSha: pull.headRefOid,
    mergeSha: null,
    policySha: "a".repeat(40),
    sourceDigest: "b".repeat(64),
    occurredAt: pull.mergedAt,
  })),
  claims: [],
  units: [],
  supersedes: [],
  legacyPredecessors: [],
  revisionReason: null,
};
const recordJson = JSON.stringify(record);
const recordDigest = sha256(recordJson);
/** A registered project that only the staging registry lists. */
const STAGING_ONLY = "canonry";
type Failure =
  | "forbidden"
  | "mixed"
  | "partial"
  | "transport"
  | "unmatched-null";
type Comparison =
  | "complete"
  | "missing"
  | "duplicate"
  | "wrong-base"
  | "changed-count"
  | "unavailable"
  | "invalid-range"
  | "line-missing"
  | "line-null"
  | "line-unavailable"
  | "line-wrong-id"
  | "line-wrong-sha"
  | "line-wrong-kind"
  | "line-wrong-repository"
  | "line-negative"
  | "line-fractional"
  | "line-overflow"
  | "line-missing-count"
  | "overlap-parents"
  | "overlap-author"
  | "overlap-kind"
  | "overlap-login";

type NativeFileFixture = {
  directory: string;
  head: string;
  merge: PullRequestGitFilesInput["merge"];
  earlierParent: string;
  expected: PullRequestGitFiles;
  unavailable: boolean;
  invalid?: "missing-object" | "contradictory-parents";
  recoveryRepository?: TargetRepository;
};

/** A genuine accepted Git merge beyond GitHub's 3,000-file REST limit. */
async function nativeFileFixture(): Promise<NativeFileFixture> {
  const directory = await mkdtemp(join(tmpdir(), "slop-large-pr-source-"));
  const run = promisify(execFile);
  const git = async (...args: string[]) =>
    (
      await run(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgSign=false",
          ...args,
        ],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            HOME: directory,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_AUTHOR_NAME: "Source fixture",
            GIT_AUTHOR_EMAIL: "fixture@example.invalid",
            GIT_COMMITTER_NAME: "Source fixture",
            GIT_COMMITTER_EMAIL: "fixture@example.invalid",
            GIT_AUTHOR_DATE: "2026-11-05T00:00:00Z",
            GIT_COMMITTER_DATE: "2026-11-05T00:00:00Z",
          },
          maxBuffer: 1024 * 1024,
        },
      )
    ).stdout.trim();
  try {
    await git("init", "--quiet", "--initial-branch=main", "--template=");
    await writeFile(join(directory, "README.md"), "Initial source.\n");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "Initial source");
    const earlierParent = await git("rev-parse", "HEAD");
    await git("checkout", "--quiet", "-b", "contribution");
    await mkdir(join(directory, "src"));
    await mkdir(join(directory, "zz-tests"));
    const files = Array.from({ length: 3001 }, (_, index) => ({
      path: `src/source-${String(index).padStart(4, "0")}.txt`,
      additions: 1,
      deletions: 0,
    }));
    for (let start = 0; start < files.length; start += 100)
      await Promise.all(
        files
          .slice(start, start + 100)
          .map((file) =>
            writeFile(join(directory, file.path), "Accepted source.\n"),
          ),
      );
    // The qualifying test file sorts after every file a capped API would return.
    files.push({
      path: "zz-tests/recovery.test.ts",
      additions: 40,
      deletions: 0,
    });
    await writeFile(
      join(directory, "zz-tests/recovery.test.ts"),
      Array.from(
        { length: 40 },
        (_, index) => `assert(${index} === ${index});\n`,
      ).join(""),
    );
    await git("add", ".");
    await git(
      "commit",
      "--quiet",
      "-m",
      "Accept complete source and regression evidence",
    );
    const head = await git("rev-parse", "HEAD");
    await git("checkout", "--quiet", "main");
    await writeFile(
      join(directory, "main-only.txt"),
      "Independent accepted work.\n",
    );
    await git("add", ".");
    await git("commit", "--quiet", "-m", "Advance integration branch");
    const firstParent = await git("rev-parse", "HEAD");
    await git(
      "merge",
      "--quiet",
      "--no-ff",
      "contribution",
      "-m",
      "Accept contribution",
    );
    return {
      directory,
      head,
      merge: {
        sha: await git("rev-parse", "HEAD"),
        parents: [{ sha: firstParent }, { sha: head }],
      },
      earlierParent,
      expected: { files, additions: 3041, deletions: 0, changedFiles: 3002 },
      unavailable: false,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function fixture(
  mode:
    | "removed"
    | "persistent"
    | "joint"
    | "healthy"
    | "open-closure"
    | "open-files-missing"
    | "open-files-later-missing"
    | "open-files-later-changed"
    | "commit-lines-missing"
    | "commit-lines-negative"
    | "open-reorder"
    | "open-skip",
  failure?: Failure,
  productionProjects?: readonly string[],
  comparison?: Comparison,
  nativeFiles?: NativeFileFixture,
) {
  let missingSeen = false;
  let requests = 0;
  let attempts = 0;
  let repositoryReads = 0;
  let forbiddenSourceReads = 0;
  let openPullRequestListings = 0;
  const comparisonPages: number[] = [];
  const commitLineBatches: string[][] = [];
  const recoveredFiles: PullRequestGitFiles[] = [];
  const recoveryInputs: PullRequestGitFilesInput[] = [];
  const range = Array.from({ length: 251 }, (_, index) => ({
    commit: {
      id: `C_${index === 250 ? retained.headRefOid : (index + 1).toString(16).padStart(40, "0")}`,
      oid:
        index === 250
          ? retained.headRefOid
          : (index + 1).toString(16).padStart(40, "0"),
      additions: index + 1,
      deletions: index % 3,
      parents: { totalCount: 1 },
      author: { user: { ...retained.author, __typename: "User" } },
    },
  }));
  const sourceNodeFor = (pull: (typeof pulls)[number]) => {
    const node = nodeFor(pull);
    const firstCommit = node.commits.nodes[0] as {
      commit: { additions?: number; deletions: number };
    };
    if (pull.id === retained.id && mode === "commit-lines-missing")
      delete firstCommit.commit.additions;
    if (pull.id === retained.id && mode === "commit-lines-negative")
      firstCommit.commit.deletions = -1;
    if (
      comparison === "overlap-login" &&
      node.author.id === retained.author?.id
    ) {
      node.author.login = "renamed-contributor";
      node.author.url = "https://github.com/renamed-contributor";
    }
    if (comparison && pull.id === retained.id)
      node.commits = {
        totalCount: range.length,
        // Large PR connections can expose a later window than comparison
        // page one. The complete comparison must retain both sets of commits.
        nodes: range.slice(-100),
        pageInfo: { hasNextPage: true, endCursor: "known-late-window" },
      };
    if (nativeFiles && pull.id === retained.id)
      return {
        ...node,
        headRefOid: nativeFiles.head,
        additions: nativeFiles.unavailable ? 0 : nativeFiles.expected.additions,
        deletions: nativeFiles.unavailable ? 0 : nativeFiles.expected.deletions,
        changedFiles: nativeFiles.unavailable
          ? 0
          : nativeFiles.expected.changedFiles,
        files: nativeFiles.unavailable
          ? null
          : connection(nativeFiles.expected.files),
        commits: connection([
          {
            commit: {
              id: `C_${nativeFiles.head}`,
              oid: nativeFiles.head,
              additions: nativeFiles.expected.additions,
              deletions: nativeFiles.expected.deletions,
              parents: { totalCount: 1 },
              author: { user: { ...pull.author, __typename: "User" } },
            },
          },
        ]),
      };
    return node;
  };
  const nodeId = (owner: string, name: string) => {
    const row = required(
      TARGET_REPOSITORIES.find(
        (item) => item.owner === owner && item.name === name,
      ),
    );
    return row.expectedNodeId ?? `R_${row.name}`;
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/graphql") {
        const { query, variables: v } = (await request.json()) as {
          query: string;
          variables: {
            owner: string;
            name: string;
            searchQuery: string;
            ids: string[];
            id: string;
            after: string | null;
          };
        };
        requests++;
        const data: Record<string, unknown> = {};
        let errors: unknown[] | undefined;
        if (query.includes("query LeaderboardOutcomeCommitLines")) {
          commitLineBatches.push(v.ids);
          const lineSources = comparison
            ? [
                ...range,
                ...pulls.flatMap((pull) => sourceNodeFor(pull).commits.nodes),
              ]
            : pulls.flatMap((pull) => sourceNodeFor(pull).commits.nodes);
          const nodes: Array<Record<string, unknown> | null> = v.ids.map(
            (id) => {
              const commit = required(
                lineSources.find((row) => row.commit.id === id),
              ).commit;
              return {
                __typename: "Commit",
                id,
                oid: commit.oid,
                repository: { id: nodeId(repository.owner, repository.name) },
                additions: commit.additions,
                deletions: commit.deletions,
              };
            },
          );
          if (comparison === "line-missing") nodes.pop();
          if (comparison === "line-null") nodes[0] = null;
          if (comparison === "line-unavailable") {
            nodes[0] = null;
            errors = [{ type: "NOT_FOUND", path: ["nodes", 0] }];
          }
          const first = nodes[0];
          if (first) {
            if (comparison === "line-wrong-id") first.id = "C_wrong";
            if (comparison === "line-wrong-sha") first.oid = "0".repeat(40);
            if (comparison === "line-wrong-kind")
              first.__typename = "PullRequest";
            if (comparison === "line-wrong-repository")
              first.repository = { id: "R_other" };
            if (comparison === "line-negative") first.additions = -1;
            if (comparison === "line-fractional") first.deletions = 0.5;
            if (comparison === "line-overflow")
              first.additions = Number.MAX_SAFE_INTEGER + 1;
            if (comparison === "line-missing-count") delete first.deletions;
          }
          data.nodes = nodes;
        } else if (query.includes("query LeaderboardPreflight")) {
          if (
            v.owner === TARGET_REPOSITORIES[0].owner &&
            v.name === TARGET_REPOSITORIES[0].name
          )
            attempts++;
          data.repository = {
            id: nodeId(v.owner, v.name),
            isPrivate: false,
            updatedAt: retained.updatedAt,
          };
        } else if (query.includes("query LeaderboardMergedFileSource")) {
          const source = required(nativeFiles);
          const recoveryRepository = source.recoveryRepository ?? repository;
          const parents = source.merge.parents.map((parent) => ({
            oid: parent.sha,
          }));
          if (source.invalid === "contradictory-parents")
            parents[0] = { oid: source.earlierParent };
          data.node = {
            __typename: "PullRequest",
            id: v.id,
            state: "MERGED",
            mergedAt: retained.mergedAt,
            headRefOid: source.head,
            repository: {
              id:
                recoveryRepository.expectedNodeId ??
                `R_${recoveryRepository.name}`,
              databaseId: 123,
              isPrivate: false,
              nameWithOwner: `${recoveryRepository.owner}/${recoveryRepository.name}`,
            },
            mergeCommit: {
              oid:
                source.invalid === "missing-object"
                  ? "f".repeat(40)
                  : source.merge.sha,
              parents: { totalCount: 2, nodes: parents },
            },
          };
        } else if (query.includes("query LeaderboardSearchReferences")) {
          const isOurs = v.searchQuery.startsWith(
            `repo:${repository.owner}/${repository.name} `,
          );
          const merged = isOurs && v.searchQuery.includes("is:merged");
          const current =
            mode === "persistent" || (mode === "removed" && !missingSeen)
              ? pulls
              : [retained, unaffected];
          const nodes = merged ? current.map(sourceNodeFor) : [];
          data.search = {
            issueCount: nodes.length,
            nodes,
            pageInfo: { hasNextPage: false, endCursor: null },
          };
        } else if (
          (mode === "open-reorder" || mode === "open-skip") &&
          query.includes("query LeaderboardOpenPullRequest") &&
          v.owner === repository.owner &&
          v.name === repository.name
        ) {
          // GitHub lists open pull requests newest update first and pages them
          // with a keyset cursor (one per page here). In the first listing,
          // PR_updated_while_listing is on page two. It is updated after page
          // one is served, so it now sorts before the cursor: page two comes
          // back empty while totalCount stays 2. "open-skip" repeats that in
          // every listing.
          if (v.after === null) openPullRequestListings++;
          const first = mode === "open-skip" || openPullRequestListings === 1;
          const order = first
            ? [stillOpenPull, updatedWhileListing]
            : [updatedWhileListing, stillOpenPull];
          const page =
            v.after === null ? order.slice(0, 1) : first ? [] : order.slice(1);
          data.repository = {
            id: nodeId(v.owner, v.name),
            pullRequests: {
              totalCount: 2,
              nodes: page.map((pull) => ({
                id: pull.id,
                updatedAt: pull.updatedAt,
                headRefOid: pull.headRefOid,
              })),
              pageInfo:
                v.after === null
                  ? {
                      hasNextPage: true,
                      endCursor: `open-pulls-${openPullRequestListings}`,
                    }
                  : { hasNextPage: false, endCursor: null },
            },
          };
        } else if (query.includes("query LeaderboardOpen")) {
          const field = query.includes("query LeaderboardOpenIssue")
            ? "issues"
            : "pullRequests";
          const listed =
            (mode === "open-closure" || mode.startsWith("open-files-")) &&
            v.owner === repository.owner &&
            v.name === repository.name;
          data.repository = {
            id: nodeId(v.owner, v.name),
            [field]: connection(
              !listed
                ? []
                : field === "issues"
                  ? ["I_still_open", "I_closed_after_listing"].map((id) => ({
                      id,
                      updatedAt: unaffected.updatedAt,
                    }))
                  : [stillOpenPull, mergedAfterListing].map((pull) => ({
                      id: pull.id,
                      updatedAt: pull.updatedAt,
                      headRefOid: pull.headRefOid,
                    })),
            ),
          };
        } else if (query.includes("query LeaderboardIssueDetails")) {
          data.nodes = v.ids.map((id: string, index: number) =>
            openIssueNode(id, 90 + index, id === "I_still_open"),
          );
        } else if (query.includes("query LeaderboardMoreFiles")) {
          data.node = {
            state: "OPEN",
            isDraft: false,
            headRefOid:
              mode === "open-files-later-changed"
                ? "a".repeat(40)
                : stillOpenPull.headRefOid,
            files: null,
          };
        } else if (
          query.includes("query LeaderboardReviewedPullRequestReferences")
        ) {
          data.nodes = v.ids.map((id: string) => ({
            __typename: "PullRequest",
            id,
            updatedAt: required(pulls.find((p) => p.id === id)).updatedAt,
            reviews: { totalCount: 0 },
          }));
          const index =
            mode === "persistent" || (mode === "removed" && !missingSeen)
              ? v.ids.indexOf(removed.id)
              : -1;
          if (index >= 0 || (failure && mode !== "joint")) {
            const position = Math.max(index, 0);
            (data.nodes as unknown[])[position] = null;
            errors = [
              {
                type: "NOT_FOUND",
                path: ["nodes", position],
                message: "Could not resolve requested node",
              },
            ];
            if (failure === "forbidden")
              errors = [{ type: "FORBIDDEN", path: ["nodes", position] }];
            if (failure === "mixed")
              errors.push({ type: "INTERNAL", path: ["nodes", position] });
            if (failure === "partial") data.nodes = [];
            if (failure === "unmatched-null")
              (data.nodes as unknown[])[(position + 1) % v.ids.length] = null;
            missingSeen = true;
          }
        } else if (query.includes("query LeaderboardSourceAvailability")) {
          data.nodes = v.ids.map((id: string) =>
            id === removed.id ? null : { __typename: "PullRequest", id },
          );
          errors = v.ids.flatMap((id: string, index: number) =>
            id === removed.id
              ? [
                  {
                    type: "NOT_FOUND",
                    path: ["nodes", index],
                    message: "Could not resolve requested node",
                  },
                ]
              : [],
          );
          if (failure === "forbidden")
            errors = [{ type: "FORBIDDEN", path: ["nodes", 0] }];
          if (failure === "mixed")
            errors.push({ type: "INTERNAL", path: ["nodes", 0] });
          if (failure === "partial") data.nodes = [];
        } else if (
          query.includes("query LeaderboardPullRequestDetails") ||
          query.includes("query LeaderboardMergedPullRequestReviews")
        ) {
          data.nodes = v.ids.map((id: string) =>
            id === stillOpenPull.id
              ? {
                  ...nodeFor(stillOpenPull),
                  state: "OPEN",
                  files:
                    mode === "open-files-missing"
                      ? null
                      : mode.startsWith("open-files-later-")
                        ? {
                            ...connection(stillOpenPull.files ?? []),
                            pageInfo: {
                              hasNextPage: true,
                              endCursor: "first-file-page",
                            },
                          }
                        : nodeFor(stillOpenPull).files,
                }
              : id === updatedWhileListing.id
                ? { ...nodeFor(updatedWhileListing), state: "OPEN" }
                : id === mergedAfterListing.id
                  ? {
                      ...nodeFor(mergedAfterListing),
                      mergedAt: GENERATED_AT,
                      closedAt: GENERATED_AT,
                    }
                  : sourceNodeFor(required(pulls.find((p) => p.id === id))),
          );
        } else
          throw new Error(
            `Unexpected GraphQL operation ${query.slice(0, 100)}`,
          );
        data.rateLimit = {
          cost: 1,
          limit: 5000,
          remaining: 5000 - requests,
          resetAt: "2026-11-20T01:00:00.000Z",
        };
        return Response.json({ data, ...(errors ? { errors } : {}) });
      }
      if (comparison && url.pathname.includes("/compare/")) {
        const page = Number(url.searchParams.get("page"));
        comparisonPages.push(page);
        if (
          comparison === "invalid-range" ||
          comparison === "unavailable" ||
          (page === 1 && comparisonPages.length === 1)
        )
          return Response.json(
            {
              message:
                comparison === "invalid-range"
                  ? "Validation Failed"
                  : "Server Error: Sorry, this diff is taking too long to generate.",
            },
            { status: 422 },
          );
        let slice = range.slice((page - 1) * 100, page * 100);
        if (comparison === "missing" && page === 3) slice = slice.slice(1);
        if (comparison === "duplicate" && page === 3)
          slice = [range[0], ...slice.slice(1)];
        return Response.json({
          total_commits: comparison === "changed-count" ? 252 : 251,
          base_commit: {
            sha: comparison === "wrong-base" ? "b".repeat(40) : "a".repeat(40),
          },
          commits: slice.map(({ commit }) => ({
            node_id: `C_${commit.oid}`,
            sha: commit.oid,
            parents:
              comparison === "overlap-parents"
                ? [{ sha: "a".repeat(40) }, { sha: "b".repeat(40) }]
                : [{ sha: "a".repeat(40) }],
            author: {
              node_id:
                comparison === "overlap-author"
                  ? unaffected.author!.id
                  : commit.author.user.id,
              type: comparison === "overlap-kind" ? "Bot" : "User",
              login:
                comparison === "overlap-login"
                  ? "renamed-contributor"
                  : commit.author.user.login,
              avatar_url: commit.author.user.avatarUrl,
              html_url:
                comparison === "overlap-login"
                  ? "https://github.com/renamed-contributor"
                  : commit.author.user.url,
            },
          })),
        });
      }
      if (url.pathname === "/api/v1/project-account-bans")
        return Response.json({
          schemaVersion: "slop-account-bans:v1",
          bans: [],
        });
      if (productionProjects && url.pathname === "/api/v1/projects")
        return Response.json({
          schemaVersion: "1",
          projects: productionProjects.map((id) => ({ id })),
          restrictions: [],
        });
      if (productionProjects && url.pathname === "/api/v1/project-revisions")
        return Response.json({ schemaVersion: "1", revisions: [] });
      if (url.pathname === "/v1/penalties") {
        // The production feed rejects a project it does not know.
        if (
          productionProjects &&
          url.searchParams.get("project") === STAGING_ONLY
        )
          return Response.json(
            { error: "Invalid penalty query" },
            { status: 400 },
          );
        return Response.json({
          schemaVersion: "slop-penalty-history:v1",
          project: url.searchParams.get("project"),
          records: [],
          nextAfter: null,
        });
      }
      if (url.pathname === `/repos/${repository.owner}/${repository.name}`) {
        repositoryReads++;
        return Response.json({
          id: 123,
          node_id: project.authority.repositoryNodeId,
          private: false,
        });
      }
      if (url.pathname === "/v1/work-unit-assessments") {
        const joint =
          mode === "joint" &&
          Number(url.searchParams.get("pull")) === retained.number;
        return Response.json({
          schemaVersion: "slop-work-unit-history:v1",
          repository: repository.id,
          repositoryNodeId: project.authority.repositoryNodeId,
          pullRequestNumber: Number(url.searchParams.get("pull")),
          throughSequence: joint ? 1 : 0,
          totalRecords: joint ? 1 : 0,
          nextAfter: null,
          records: joint
            ? [
                {
                  sequence: 1,
                  record_digest: recordDigest,
                  record_json: recordJson,
                  recorded_at: retained.updatedAt,
                },
              ]
            : [],
        });
      }
      if (url.pathname === "/v1/value-assessments")
        return Response.json({
          schemaVersion: "slop-value-history:v1",
          repository: repository.id,
          repositoryNodeId: project.authority.repositoryNodeId,
          pullRequestNumber: Number(url.searchParams.get("pull")),
          records: [],
          nextAfter: null,
        });
      forbiddenSourceReads++;
      throw new Error(`Unexpected source request ${url.pathname}`);
    },
  });
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (
      failure === "transport" &&
      url.pathname === "/graphql" &&
      String(init?.body).includes("LeaderboardReviewedPullRequestReferences")
    )
      throw new TypeError("fixture connection reset");
    return originalFetch(new URL(url.pathname + url.search, server.url), init);
  }) as typeof fetch;
  globalThis.fetch = transport;
  const client = new GitHubGraphqlClient("fixture-token", transport, {
    retryBaseDelayMs: 0,
    ...(nativeFiles
      ? {
          recoverFiles: async (input: PullRequestGitFilesInput) => {
            recoveryInputs.push(input);
            const result = await readPullRequestGitFiles(
              nativeFiles.directory,
              input,
            );
            recoveredFiles.push(result);
            return result;
          },
        }
      : {}),
  });
  const directory = await mkdtemp(join(tmpdir(), "slop-source-recovery-"));
  const output = join(directory, "leaderboard.json");
  await writeFile(output, "last published bytes\n");
  return {
    client,
    output,
    stats: () => ({
      requests,
      attempts,
      repositoryReads,
      forbiddenSourceReads,
      openPullRequestListings,
      comparisonPages,
      commitLineBatches,
      recoveredFiles,
      recoveryInputs,
    }),
    generate: () =>
      runGenerator(
        output,
        {
          getToken: async () => "fixture-token",
          createClient: () => client,
          generate: generateLeaderboardFromGitHub,
          write: writeLeaderboardAtomically,
        },
        {
          now: new Date(GENERATED_AT),
          actualNow: new Date(GENERATED_AT),
          ...(productionProjects ? { deploymentTier: "staging" as const } : {}),
        },
      ),
    close: async () => {
      server.stop(true);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function journalFor(
  snapshot: LeaderboardSnapshot,
  joint = false,
  source = retained,
): PointsJournal {
  const journal: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [],
  };
  const event = required(
    snapshot.ledger.find(
      (event) =>
        event.source.id === retained.id &&
        event.category === "merged-pull-request",
    ),
  );
  const bound = {
    ...event,
    id: `${source.id}:merged`,
    source: {
      ...event.source,
      id: source.id,
      number: source.number,
      url: source.url,
    },
    workUnitId: `wu_asi_pr_${source.number}`,
  };
  return appendPointAwards(
    journal,
    [
      awardForScore(
        joint
          ? {
              ...bound,
              id: `${source.id}:joint:fixture`,
              workUnitId: `wu_${"c".repeat(64)}`,
              scoreDecisionSourceId: `value:${recordDigest}`,
            }
          : bound,
      ),
    ],
    "a".repeat(64),
    snapshot.ruleVersion,
    GENERATED_AT,
  );
}

test("removed node is recorded after a complete recollection and both valid outcomes reach atomic output", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("removed");
  try {
    const snapshot = await f.generate();
    const published = JSON.parse(await readFile(f.output, "utf8"));
    assertLeaderboardSnapshot(published);
    expect(published.source.unavailableSources).toEqual([
      { nodeId: removed.id, reason: "NOT_FOUND" },
    ]);
    expect(published.source.counts).toMatchObject({
      mergedPullRequests: 2,
      unavailableSources: 1,
      heldWorkUnits: 0,
    });
    expect(
      snapshot.ledger
        .filter((event) => event.category === "merged-pull-request")
        .map((event) => event.source.id)
        .sort(),
    ).toEqual([retained.id, unaffected.id].sort());
    expect(f.stats().attempts).toBe(2);
    expect(snapshot.source.rateLimit.consumedDuringRun).toBe(
      f.stats().requests,
    );
    expect(f.stats().forbiddenSourceReads).toBe(0);
    const previous = journalFor(snapshot, false, removed);
    const updated = applyPointsSnapshot(
      previous,
      snapshot,
      "b".repeat(64),
      GENERATED_AT,
    );
    expect(updated.revisions.slice(0, previous.revisions.length)).toEqual(
      previous.revisions,
    );
    expect(
      latestPoints(updated).get(previous.revisions[0].award.key)?.award,
    ).toEqual(previous.revisions[0].award);
    const corrupt = structuredClone(published);
    corrupt.source.counts.unavailableSources = 0;
    expect(() => assertLeaderboardSnapshot(corrupt)).toThrow(
      "Unavailable source count",
    );
  } finally {
    await f.close();
  }
});

test("unavailable joint context keeps the verified merge minimum without replacing prior Points", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const healthy = await fixture("healthy");
  let before: LeaderboardSnapshot;
  try {
    before = await healthy.generate();
  } finally {
    await healthy.close();
  }
  const journal = journalFor(before, true);
  const f = await fixture("joint");
  try {
    const snapshot = await f.generate();
    expect(snapshot.source.unavailableSources).toEqual([
      { nodeId: removed.id, reason: "NOT_FOUND" },
    ]);
    expect(snapshot.source.counts).toMatchObject({
      mergedPullRequests: 2,
      unavailableSources: 1,
      heldWorkUnits: 1,
    });
    expect(snapshot.source.heldWorkUnits).toEqual([
      {
        recordDigest,
        sourceNodeIds: [retained.id, removed.id].sort(),
        unavailableNodeIds: [removed.id],
      },
    ]);
    expect(
      snapshot.valueAssessmentCoverage?.find(
        (row) => row.pullRequestId === retained.id,
      ),
    ).toMatchObject({ status: "unresolved", recordDigest });
    const minimum = required(
      snapshot.ledger.find(
        (event) =>
          event.source.id === retained.id &&
          event.category === "merged-pull-request",
      ),
    );
    expect(minimum.scoreThirds).toBe(1);
    expect(minimum.scoreDecisionSourceId).toBeUndefined();
    expect(
      snapshot.ledger.some((event) => event.source.id === removed.id),
    ).toBe(false);
    expect(
      snapshot.ledger.some((event) => event.source.id === unaffected.id),
    ).toBe(true);
    const after = applyPointsSnapshot(
      journal,
      snapshot,
      "b".repeat(64),
      GENERATED_AT,
    );
    expect(after.revisions.slice(0, journal.revisions.length)).toEqual(
      journal.revisions,
    );
    const original = journal.revisions[0].award;
    expect(latestPoints(after).get(original.key)?.award).toEqual(original);
    expect(
      [...latestPoints(after).values()].filter(
        (row) => row.award.sourceId === retained.id && row.award.amount > 0,
      ),
    ).toHaveLength(1);

    const fresh = applyPointsSnapshot(
      { ...journal, revisions: [] },
      snapshot,
      "c".repeat(64),
      GENERATED_AT,
    );
    expect(
      [...latestPoints(fresh).values()].find(
        (row) => row.award.sourceId === retained.id,
      )?.award.amount,
    ).toBe(10);
    const repeated = applyPointsSnapshot(
      fresh,
      snapshot,
      "d".repeat(64),
      GENERATED_AT,
    );
    expect(repeated.revisions).toEqual(fresh.revisions);

    // A later complete joint decision uses a different award key. Exercise
    // the canonical projector's replacement and replay, not model quality.
    const jointEvent = {
      ...required(
        before.ledger.find(
          (event) =>
            event.source.id === retained.id &&
            event.category === "merged-pull-request",
        ),
      ),
      id: `${retained.id}:joint:restored`,
      workUnitId: `wu_${"c".repeat(64)}`,
      scoreThirds: 3,
      points: 1,
      scoreDecisionSourceId: `value:${recordDigest}`,
      scoreDecisionAt: GENERATED_AT,
    };
    const restored = {
      ...before,
      ledger: [
        ...before.ledger.filter((event) => event.source.id !== retained.id),
        jointEvent,
      ],
      valueAssessmentCoverage: before.valueAssessmentCoverage?.map((row) =>
        row.pullRequestId === retained.id
          ? { ...row, status: "assessed" as const, recordDigest }
          : row,
      ),
    };
    const completed = applyPointsSnapshot(
      fresh,
      restored,
      "e".repeat(64),
      GENERATED_AT,
    );
    expect(
      [...latestPoints(completed).values()]
        .filter((row) => row.award.sourceId === retained.id)
        .map((row) => row.award.amount)
        .sort((a, b) => a - b),
    ).toEqual([0, 30]);
    expect(
      applyPointsSnapshot(completed, restored, "f".repeat(64), GENERATED_AT)
        .revisions,
    ).toEqual(completed.revisions);
    expect(
      applyPointsSnapshot(completed, snapshot, "f".repeat(64), GENERATED_AT)
        .revisions,
    ).toEqual(completed.revisions);

    const own = journalFor(before);
    const prior = appendPointAwards(
      own,
      [{ ...own.revisions[0].award, amount: 90 }],
      "e".repeat(64),
      before.ruleVersion,
      GENERATED_AT,
    );
    const preserved = applyPointsSnapshot(
      prior,
      snapshot,
      "f".repeat(64),
      GENERATED_AT,
    );
    expect(
      latestPoints(preserved).get(own.revisions[0].award.key)?.award.amount,
    ).toBe(90);
    // A prior per-PR assessment can credit an implementation actor who is
    // different from the actor selected by the unassessed merge minimum.
    // Unavailability cannot add that fallback award or overturn a prior zero.
    for (const amount of [90, 0]) {
      const previousActorAward = {
        ...awardForScore({
          ...minimum,
          actor: required(unaffected.author),
          scoreThirds: 9,
          scoreDecisionSourceId: `value:${recordDigest}`,
        }),
        amount,
      };
      const previousActorJournal = appendPointAwards(
        { ...journal, revisions: [] },
        [previousActorAward],
        "a".repeat(64),
        before.ruleVersion,
        GENERATED_AT,
      );
      const actorChanged = applyPointsSnapshot(
        previousActorJournal,
        snapshot,
        "b".repeat(64),
        GENERATED_AT,
      );
      expect(
        [...latestPoints(actorChanged).values()]
          .filter((row) => row.award.sourceId === retained.id)
          .map((row) => row.award),
      ).toEqual([previousActorAward]);
    }
    expect(f.stats().attempts).toBe(2);
    expect(f.stats().forbiddenSourceReads).toBe(0);
    assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
  } finally {
    await f.close();
  }
});

for (const failure of [
  "forbidden",
  "mixed",
  "partial",
  "transport",
  "unmatched-null",
] as const) {
  test(`${failure} still fails closed and preserves the previous published bytes`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("removed", failure);
    try {
      await expect(f.generate()).rejects.toThrow();
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
      expect(f.stats().attempts).toBe(1);
    } finally {
      await f.close();
    }
  });
}

for (const failure of ["forbidden", "mixed", "partial", "transport"] as const) {
  test(`joint ${failure} never becomes a successful hold`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("joint", failure);
    try {
      await expect(f.generate()).rejects.toThrow();
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
      expect(f.stats().attempts).toBe(1);
    } finally {
      await f.close();
    }
  });
}

// A staging build syncs its registry from staging but reads the production
// penalty feed, which answers HTTP 400 for a project only staging lists.
test("staging skips only the penalty feed of a project production does not list", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const registered = [
    ...new Set(REGISTERED_REPOSITORIES.map((row) => row.projectId)),
  ];
  const staging = await fixture(
    "healthy",
    undefined,
    registered.filter((id) => id !== STAGING_ONLY),
  );
  try {
    await staging.generate();
    assertLeaderboardSnapshot(
      JSON.parse(await readFile(staging.output, "utf8")),
    );
  } finally {
    await staging.close();
  }
  const listed = await fixture("healthy", undefined, registered);
  try {
    await expect(listed.generate()).rejects.toThrow(
      "Authoritative penalty feed is unavailable",
    );
    expect(await readFile(listed.output, "utf8")).toBe(
      "last published bytes\n",
    );
  } finally {
    await listed.close();
  }
});

test("a persistently enumerated unavailable merge is counted explicitly and receives no fresh credit", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("persistent");
  try {
    const snapshot = await f.generate();
    expect(snapshot.source.unavailableSources).toEqual([
      {
        nodeId: removed.id,
        reason: "NOT_FOUND",
        unavailableInMergedCensus: true,
      },
    ]);
    expect(snapshot.source.counts).toMatchObject({
      mergedPullRequests: 2,
      unavailableSources: 1,
      unavailableMergedPullRequests: 1,
    });
    expect(
      snapshot.ledger.some((event) => event.source.id === removed.id),
    ).toBe(false);
    expect(
      snapshot.ledger.filter(
        (event) => event.category === "merged-pull-request",
      ),
    ).toHaveLength(2);
    expect(f.stats().attempts).toBe(2);
    assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
  } finally {
    await f.close();
  }
});

test("a server-side comparison timeout retries without losing complete merged attribution", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const baseline = await fixture("healthy");
  let before: LeaderboardSnapshot;
  try {
    before = await baseline.generate();
  } finally {
    await baseline.close();
  }
  const f = await fixture("healthy", undefined, undefined, "complete");
  try {
    const snapshot = await f.generate();
    expect(snapshot.ledger).toEqual(before.ledger);
    expect(snapshot.source.counts.mergedPullRequests).toBe(2);
    expect(f.stats().comparisonPages).toEqual([1, 1, 2, 3]);
    expect(f.stats().commitLineBatches.map((ids) => ids.length)).toEqual([
      100, 100, 52,
    ]);
    const requestedCommitIds = f.stats().commitLineBatches.flat();
    expect(new Set(requestedCommitIds).size).toBe(requestedCommitIds.length);
    expect(
      snapshot.valueAssessmentCoverage?.find(
        (row) => row.pullRequestId === retained.id,
      )?.implementationAllocation?.weights,
    ).toEqual([
      {
        actorNodeId: retained.author!.id,
        actorLogin: retained.author!.login,
        changedLines: "31876",
      },
    ]);
    assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
  } finally {
    await f.close();
  }
});

for (const comparison of ["unavailable", "invalid-range"] as const) {
  test(`an ${comparison} comparison fails closed within its request bound`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("healthy", undefined, undefined, comparison);
    try {
      await expect(f.generate()).rejects.toThrow("GitHub comparison HTTP 422");
      expect(f.stats().comparisonPages).toHaveLength(
        comparison === "unavailable" ? MAX_GRAPHQL_REQUEST_ATTEMPTS : 1,
      );
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
    } finally {
      await f.close();
    }
  });
}

for (const comparison of [
  "line-missing",
  "line-null",
  "line-unavailable",
  "line-wrong-id",
  "line-wrong-sha",
  "line-wrong-kind",
  "line-wrong-repository",
  "line-negative",
  "line-fractional",
  "line-overflow",
  "line-missing-count",
] as const) {
  test(`comparison ${comparison} statistics preserve the last published snapshot`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("healthy", undefined, undefined, comparison);
    try {
      const generation = f.generate();
      if (comparison === "line-unavailable")
        await expect(generation).rejects.not.toBeInstanceOf(
          SourceNodeUnavailableError,
        );
      await expect(generation).rejects.toThrow(
        comparison === "line-missing"
          ? "Commit statistics are incomplete"
          : comparison === "line-unavailable"
            ? "Commit statistics are unavailable"
            : comparison === "line-null"
              ? "must be an object"
              : [
                    "line-wrong-id",
                    "line-wrong-sha",
                    "line-wrong-kind",
                    "line-wrong-repository",
                  ].includes(comparison)
                ? "Commit statistics identity changed"
                : comparison === "line-missing-count"
                  ? "must be a finite number"
                  : "line counts must be non-negative integers",
      );
      expect(f.stats().commitLineBatches).toHaveLength(1);
      expect(f.stats().attempts).toBe(1);
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
    } finally {
      await f.close();
    }
  });
}

for (const comparison of [
  "overlap-parents",
  "overlap-author",
  "overlap-kind",
] as const) {
  test(`comparison ${comparison} cannot contradict an already collected immutable commit`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("healthy", undefined, undefined, comparison);
    try {
      await expect(f.generate()).rejects.toThrow(
        "comparison changed immutable commit metadata",
      );
      expect(f.stats().commitLineBatches).toEqual([]);
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
    } finally {
      await f.close();
    }
  });
}

test("comparison commit authors can retain identity after a login rename", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("healthy", undefined, undefined, "overlap-login");
  try {
    const snapshot = await f.generate();
    expect(
      snapshot.valueAssessmentCoverage?.find(
        (row) => row.pullRequestId === retained.id,
      )?.implementationAllocation?.weights[0],
    ).toMatchObject({
      actorNodeId: retained.author!.id,
      actorLogin: "renamed-contributor",
      changedLines: "31876",
    });
  } finally {
    await f.close();
  }
});

for (const mode of ["commit-lines-missing", "commit-lines-negative"] as const) {
  test(`ordinary PR ${mode} statistics fail before publication`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture(mode);
    try {
      await expect(f.generate()).rejects.toThrow();
      expect(f.stats().comparisonPages).toEqual([]);
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
    } finally {
      await f.close();
    }
  });
}

for (const comparison of [
  "missing",
  "duplicate",
  "wrong-base",
  "changed-count",
] as const) {
  test(`an invalid ${comparison} comparison preserves the last published snapshot`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("healthy", undefined, undefined, comparison);
    try {
      await expect(f.generate()).rejects.toThrow(
        comparison === "wrong-base" || comparison === "changed-count"
          ? "comparison does not match its commit range"
          : "comparison omitted known commits",
      );
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
    } finally {
      await f.close();
    }
  });
}

test("open work that closes after the listing leaves the queue instead of stopping the release", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("open-closure");
  try {
    const snapshot = await f.generate();
    expect(snapshot.workQueue.pullRequests.map((item) => item.id)).toEqual([
      stillOpenPull.id,
    ]);
    expect(snapshot.workQueue.issues.map((item) => item.id)).toEqual([
      "I_still_open",
    ]);
    expect(snapshot.source.counts).toMatchObject({
      openPullRequests: 1,
      openIssues: 1,
      mergedPullRequests: 2,
    });
    expect(f.stats().attempts).toBe(1);
    assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
    const historical = structuredClone(snapshot);
    delete historical.workQueue.pullRequests[0].filesAvailable;
    assertLeaderboardSnapshot(historical);
  } finally {
    await f.close();
  }
});

for (const mode of [
  "open-files-missing",
  "open-files-later-missing",
] as const) {
  test(`${mode}: retain the source and block review selection without inventing file evidence`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture(mode);
    try {
      const snapshot = await f.generate();
      expect(snapshot.source.counts).toMatchObject({
        openPullRequests: 1,
        mergedPullRequests: 2,
      });
      expect(snapshot.workQueue.pullRequests).toHaveLength(1);
      expect(snapshot.workQueue.pullRequests[0]).toMatchObject({
        id: stillOpenPull.id,
        isDraft: false,
        filesAvailable: false,
        actionability: "blocked",
        selection: { status: "excluded", reasons: ["blocked"] },
      });
      assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
      expect(
        snapshot.opportunities.filter(
          (opportunity) => opportunity.source.id === stillOpenPull.id,
        ),
      ).toEqual([]);
      const forged = structuredClone(snapshot);
      forged.workQueue.pullRequests[0].actionability = "actionable";
      forged.workQueue.pullRequests[0].selection = {
        status: "candidate",
        reasons: [],
      };
      expect(() => assertLeaderboardSnapshot(forged)).toThrow("actionability");
      expect(f.stats().recoveredFiles).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

test("an unavailable later file page at a different head still stops publication", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("open-files-later-changed");
  try {
    await expect(f.generate()).rejects.toThrow("files must be an object");
    expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
  } finally {
    await f.close();
  }
});

test("open work updated while the listing pages is listed again instead of stopping the release", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("open-reorder");
  try {
    const snapshot = await f.generate();
    expect(
      snapshot.workQueue.pullRequests.map((item) => item.id).sort(),
    ).toEqual([stillOpenPull.id, updatedWhileListing.id].sort());
    expect(snapshot.source.counts).toMatchObject({ openPullRequests: 2 });
    expect(f.stats().openPullRequestListings).toBe(2);
    expect(f.stats().attempts).toBe(1);
    assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
  } finally {
    await f.close();
  }
});

test("an open listing that stays short still fails closed after the bounded retry", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("open-skip");
  try {
    await expect(f.generate()).rejects.toThrow(
      `Open evidence changed during ${MAX_TRANSIENT_ATTEMPTS} consecutive verification attempts`,
    );
    expect(f.stats().openPullRequestListings).toBe(MAX_TRANSIENT_ATTEMPTS);
    expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
  } finally {
    await f.close();
  }
});

test("a merged null file connection recovers every native Git file without changing accepted credit", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const source = await nativeFileFixture();
  try {
    const baseline = await fixture(
      "healthy",
      undefined,
      undefined,
      undefined,
      source,
    );
    let before: LeaderboardSnapshot;
    try {
      before = await baseline.generate();
      expect(baseline.stats().recoveryInputs).toHaveLength(0);
    } finally {
      await baseline.close();
    }
    const recovered = await fixture(
      "healthy",
      undefined,
      undefined,
      undefined,
      {
        ...source,
        unavailable: true,
      },
    );
    try {
      const snapshot = await recovered.generate();
      const stats = recovered.stats();
      expect(stats.recoveredFiles).toHaveLength(1);
      const detail = required(stats.recoveredFiles[0]);
      expect(detail).toMatchObject({
        additions: 3041,
        deletions: 0,
        changedFiles: 3002,
      });
      expect(detail.files).toHaveLength(3002);
      expect(detail.files.at(-1)).toEqual({
        path: "zz-tests/recovery.test.ts",
        additions: 40,
        deletions: 0,
      });
      expect(hasMaterialTestChange(detail.files)).toBe(true);
      expect(stats.recoveryInputs).toEqual([
        {
          repository: {
            id: 123,
            node_id: project.authority.repositoryNodeId,
            private: false,
            full_name: `${repository.owner}/${repository.name}`,
          },
          head: source.head,
          merge: source.merge,
        },
      ]);
      expect(snapshot.ledger).toEqual(before.ledger);
      expect(snapshot.source.counts).toMatchObject({
        mergedPullRequests: 2,
        detailedMergedPullRequests: 2,
      });
      expect(snapshot.source.repositories).toEqual(before.source.repositories);
      expect(
        snapshot.ledger
          .filter((event) => event.category === "merged-pull-request")
          .map((event) => event.source.id)
          .sort(),
      ).toEqual([retained.id, unaffected.id].sort());
      const written = JSON.parse(await readFile(recovered.output, "utf8"));
      assertLeaderboardSnapshot(written);
      expect(written.ledger).toEqual(snapshot.ledger);
      expect(stats.forbiddenSourceReads).toBe(0);
    } finally {
      await recovered.close();
    }
  } finally {
    await rm(source.directory, { recursive: true, force: true });
  }
});

for (const invalid of ["missing-object", "contradictory-parents"] as const) {
  test(`native ${invalid} file recovery preserves the previous published bytes`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const source = await nativeFileFixture();
    const f = await fixture("healthy", undefined, undefined, undefined, {
      ...source,
      unavailable: true,
      invalid,
    });
    try {
      await expect(f.generate()).rejects.toThrow(
        invalid === "missing-object"
          ? "Native Git object read failed"
          : "Git merge parents differ from the accepted source",
      );
      expect(f.stats().recoveryInputs).toHaveLength(1);
      expect(f.stats().recoveredFiles).toHaveLength(0);
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
      expect(f.stats().forbiddenSourceReads).toBe(0);
    } finally {
      await f.close();
      await rm(source.directory, { recursive: true, force: true });
    }
  });
}

test("canonical merged file recovery binds to the census repository when no alias identity is configured", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const canonical = required(
    TARGET_REPOSITORIES.find((row) => row.expectedNodeId === null),
  );
  const source = await nativeFileFixture();
  const f = await fixture("healthy", undefined, undefined, undefined, {
    ...source,
    unavailable: true,
    recoveryRepository: canonical,
  });
  try {
    const censusRepositoryId = `R_${canonical.name}`;
    const original = {
      id: retained.id,
      state: "MERGED",
      mergedAt: retained.mergedAt,
      headRefOid: source.head,
    };
    const recovered = await f.client.recoverPullRequestFiles(
      canonical,
      censusRepositoryId,
      original,
    );
    expect(recovered.changedFiles).toBe(3002);
    expect(recovered.files.at(-1)).toEqual({
      path: "zz-tests/recovery.test.ts",
      additions: 40,
      deletions: 0,
    });
    expect(f.stats().recoveryInputs).toHaveLength(1);
    expect(f.stats().recoveryInputs[0].repository.node_id).toBe(
      censusRepositoryId,
    );
    await expect(
      f.client.recoverPullRequestFiles(
        canonical,
        "R_changed_repository",
        original,
      ),
    ).rejects.toThrow("Merged file source identity changed or is unavailable");
    expect(f.stats().recoveryInputs).toHaveLength(1);
    expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
    expect(f.stats().forbiddenSourceReads).toBe(0);
  } finally {
    await f.close();
    await rm(source.directory, { recursive: true, force: true });
  }
});

// The joint-hold probe re-checks the identities that failed the discarded first
// attempt, REVIEW_DETAIL_BATCH_SIZE at a time. A gateway that refuses that whole
// batch (502/503/504 with a non-JSON body) must split it like the other
// nodes(ids:) callers in the generator instead of failing the run.
test("a gateway failure on the joint-hold availability batch splits instead of failing the run", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("healthy");
  const fixtureFetch = globalThis.fetch;
  const availabilityBatchSizes: number[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes("LeaderboardSourceAvailability")) {
      const ids =
        (JSON.parse(body) as { variables?: { ids?: string[] } }).variables
          ?.ids ?? [];
      availabilityBatchSizes.push(ids.length);
      if (ids.length > 1)
        return new Response("<html>gateway unavailable</html>", {
          status: 504,
          headers: { "content-type": "text/html" },
        });
    }
    return fixtureFetch(input, init);
  }) as typeof fetch;
  const client = new GitHubGraphqlClient("fixture-token", transport, {
    retryBaseDelayMs: 0,
  });
  try {
    const snapshot = await generateLeaderboardFromGitHub(client, {
      now: new Date(GENERATED_AT),
      actualNow: new Date(GENERATED_AT),
      evidenceToken: "fixture-token",
      sourceRecovery: {
        unavailableSources: [retained.id, unaffected.id].map((nodeId) => ({
          nodeId,
          reason: "NOT_FOUND" as const,
        })),
        allowJointHolds: true,
      },
    });
    // The joint batch is refused, then re-requested one id at a time.
    expect(availabilityBatchSizes[0]).toBe(2);
    expect(availabilityBatchSizes.filter((size) => size === 1)).toHaveLength(2);
    expect(() => assertLeaderboardSnapshot(snapshot)).not.toThrow();
  } finally {
    await f.close();
  }
});
