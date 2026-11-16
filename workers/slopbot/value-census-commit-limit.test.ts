import { expect, test } from "bun:test";
import { collectAcceptedCommitCensus } from "./value-accepted-commit-census";
import type { ValueEvidence } from "./value-evidence-types";
import type { ValueClient } from "./value-publication";

const start = Date.parse("2026-11-01T00:00:00Z");
const evidence = {
  repository: "owner/repo",
  repositoryNodeId: "R_fixture",
  repositoryDatabaseId: 42,
} as ValueEvidence;
const sha = (value: number) => value.toString(16).padStart(40, "0");
const BASE = "b".repeat(40);
const HEAD = "c".repeat(40);
const TOTAL = 300;
// GitHub's pull request commit connection stops at 250 commits, even when
// totalCount is larger; the compare API pages through the whole range.
const LISTED = 250;

type Options = {
  compareTotal?: number;
  compareCommits?: string[];
  heads?: { base: string | null; head: string | null };
};

async function census(options: Options = {}) {
  const commits = Array.from({ length: TOTAL }, (_, index) => sha(index + 1));
  const compared = options.compareCommits ?? commits;
  const pull = {
    id: "PR_large",
    number: 7,
    url: "https://github.com/owner/repo/pull/7",
    mergedAt: "2026-11-02T00:00:00Z",
    baseRefOid: options.heads?.base === undefined ? BASE : options.heads.base,
    headRefOid: options.heads?.head === undefined ? HEAD : options.heads.head,
    repository: {
      id: "R_fixture",
      databaseId: 42,
      nameWithOwner: "owner/repo",
      isPrivate: false,
    },
    mergeCommit: { oid: sha(9999) },
  };
  const page = (offset: number) => ({
    totalCount: TOTAL,
    nodes: commits
      .slice(offset, Math.min(offset + 100, LISTED))
      .map((oid) => ({ commit: { oid } })),
    pageInfo: {
      hasNextPage: offset + 100 < LISTED,
      endCursor: String(offset + 100),
    },
  });
  const comparePaths: string[] = [];
  const client = {
    async graphql(_query: string, variables: Record<string, unknown>) {
      if ("q" in variables)
        return {
          search: {
            issueCount: 1,
            nodes: [{ ...pull, commits: page(0) }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        };
      return {
        repository: {
          id: "R_fixture",
          pullRequest: {
            id: "PR_large",
            commits: page(Number(variables.after)),
          },
        },
      };
    },
    async get(path: string) {
      comparePaths.push(path);
      const match =
        /^\/repos\/owner\/repo\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})\?per_page=100&page=(\d+)$/u.exec(
          path,
        );
      if (!match || match[1] !== BASE || match[2] !== HEAD) return null;
      const offset = (Number(match[3]) - 1) * 100;
      return {
        total_commits: options.compareTotal ?? compared.length,
        commits: compared.slice(offset, offset + 100).map((oid) => ({
          sha: oid,
        })),
      };
    },
  } as unknown as ValueClient;
  return {
    result: await collectAcceptedCommitCensus(client, evidence, start),
    commits,
    comparePaths,
  };
}

test("a merged PR above GitHub's 250-commit listing still completes the census", async () => {
  const { result, commits, comparePaths } = await census();
  expect(result?.ids.has("PR_large")).toBe(true);
  // Every commit, including those past the GraphQL listing, maps to its PR.
  for (const oid of [commits[0], commits[LISTED - 1], commits[TOTAL - 1]])
    expect(result?.carriers.get(oid)?.[0]?.number).toBe(7);
  expect(result?.carriers.get(sha(9999))?.[0]?.number).toBe(7);
  expect(result?.carriers.size).toBe(TOTAL + 1);
  expect(comparePaths).toHaveLength(3);
});

test("a compare range with a different commit count stays pending", async () => {
  expect((await census({ compareTotal: TOTAL + 1 })).result).toBeNull();
});

test("a compare range that omits a listed pull request commit stays pending", async () => {
  const commits = Array.from({ length: TOTAL }, (_, index) => sha(index + 1));
  const replaced = [sha(5000), ...commits.slice(1)];
  expect((await census({ compareCommits: replaced })).result).toBeNull();
});

test("a compare range that stops short of its reported total stays pending", async () => {
  const commits = Array.from({ length: TOTAL }, (_, index) => sha(index + 1));
  expect(
    (
      await census({
        compareTotal: TOTAL,
        compareCommits: commits.slice(0, TOTAL - 1),
      })
    ).result,
  ).toBeNull();
});

test("a large merged PR without both range heads stays pending", async () => {
  expect(
    (await census({ heads: { base: null, head: HEAD } })).result,
  ).toBeNull();
});
