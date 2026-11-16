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

async function census(options: { moving?: boolean; outside?: boolean } = {}) {
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    id: `PR_${index + 1}`,
    number: index + 1,
    url: `https://github.com/owner/repo/pull/${index + 1}`,
    mergedAt: new Date(start + index * 1000).toISOString(),
    repository: {
      id: "R_fixture",
      databaseId: 42,
      nameWithOwner: "owner/repo",
      isPrivate: false,
    },
    mergeCommit: null,
    commits: {
      totalCount: 1,
      nodes: [{ commit: { oid: (index + 1).toString(16).padStart(40, "0") } }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  }));
  let queries = 0;
  const client = {
    async graphql(
      _query: string,
      variables: { q: string; cursor: string | null },
    ) {
      queries++;
      const period = variables.q.split("merged:")[1] ?? "";
      const [from, to] = period.replace(/^>=/u, "").split("..");
      let selected = rows.filter(
        (row) =>
          Date.parse(row.mergedAt) >= Date.parse(from ?? "") &&
          (!to || Date.parse(row.mergedAt) <= Date.parse(to)),
      );
      if (to && options.moving)
        selected = selected.filter((row) => row.number !== 1);
      const offset = Number(variables.cursor ?? "0");
      const nodes = selected.slice(offset, offset + 100);
      if (to && options.outside && nodes.length > 0)
        nodes[0] = { ...nodes[0], mergedAt: "2000-01-01T00:00:00Z" };
      return {
        search: {
          issueCount: selected.length,
          nodes,
          pageInfo: {
            hasNextPage: offset + 100 < selected.length,
            endCursor: String(offset + 100),
          },
        },
      };
    },
  } as unknown as ValueClient;
  return {
    result: await collectAcceptedCommitCensus(client, evidence, start),
    queries,
  };
}

test("a complete accepted census above the search limit retains every source", async () => {
  const { result, queries } = await census();
  expect(result?.ids.size).toBe(1001);
  expect(result?.carriers.size).toBe(1001);
  expect(result?.ids.has("PR_1")).toBe(true);
  expect(result?.ids.has("PR_1001")).toBe(true);
  expect(queries).toBeGreaterThan(11);
});

test("a census that changes while its ranges are read stays pending", async () => {
  expect((await census({ moving: true })).result).toBeNull();
});

test("a search result outside its requested merge range stays pending", async () => {
  expect((await census({ outside: true })).result).toBeNull();
});
