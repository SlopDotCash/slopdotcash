import { expect, test } from "bun:test";
import { collect, fixture, repository } from "../tests/value-binary-fixture";
import { collectAcceptedCommitCensus } from "../workers/slopbot/value-accepted-commit-census";
import { collectValueReferenceEvidence } from "../workers/slopbot/value-evidence";
import { GitHubGraphqlClient } from "./generate-leaderboard";

function budgetedClient(answer: (query: string) => object) {
  const client = new GitHubGraphqlClient("test-token", async (_input, init) => {
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    return Response.json({
      data: {
        ...answer(query),
        // GitHub returns only selected fields. An unconditional fixture
        // rateLimit object would hide the ingestion adapter's requirement.
        ...(query.includes("rateLimit{")
          ? {
              rateLimit: {
                cost: 1,
                limit: 5000,
                remaining: 4999,
                resetAt: new Date(Date.now() + 3_600_000).toISOString(),
              },
            }
          : {}),
      },
    });
  });
  return {
    client,
    graphql: async <T>(
      query: string,
      variables: Record<string, unknown>,
    ): Promise<T> =>
      (await client.execute(
        query,
        variables as Parameters<GitHubGraphqlClient["execute"]>[1],
      )) as T,
  };
}

test("an outgoing original PR reference survives the real budgeted ingestion adapter", async () => {
  const f = fixture({ textOnly: true, direct: true });
  f.pull.body = "Retains #2";
  const budget = budgetedClient((query) =>
    query.includes("timelineItems")
      ? {
          repository: {
            pullRequest: {
              id: f.pull.node_id,
              timelineItems: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }
      : {
          repository: {
            isPrivate: false,
            nameWithOwner: repository.id,
            issueOrPullRequest: {
              __typename: "PullRequest",
              id: "PR_original",
              number: 2,
              url: `${repository.githubUrl}/pull/2`,
            },
          },
        },
  );
  const result = await collectValueReferenceEvidence(
    { ...f.client, graphql: budget.graphql },
    repository.id,
    1,
  );
  expect(result.limitations).toEqual([]);
  expect(result.references.map((reference) => reference.id)).toEqual([
    "PR_original",
  ]);
  expect(budget.client.getRateLimit().consumedDuringRun).toBe(2);
});

test("accepted commit search and continuation both retain their budget evidence", async () => {
  const f = fixture({ textOnly: true, direct: true });
  const evidence = await collect(f);
  if (!f.pull.merged_at) throw new Error("Missing fixture merge time");
  const commits = Array.from({ length: 101 }, (_, index) => ({
    commit: { oid: (index + 1).toString(16).padStart(40, "0") },
  }));
  const budget = budgetedClient((query) =>
    query.includes("search(")
      ? {
          search: {
            issueCount: 1,
            nodes: [
              {
                id: "PR_census",
                number: 2,
                url: `${repository.githubUrl}/pull/2`,
                mergedAt: f.pull.merged_at,
                baseRefOid: f.pull.base.sha,
                headRefOid: f.pull.head.sha,
                repository: {
                  id: evidence.repositoryNodeId,
                  databaseId: evidence.repositoryDatabaseId,
                  nameWithOwner: repository.id,
                  isPrivate: false,
                },
                mergeCommit: null,
                commits: {
                  totalCount: 101,
                  nodes: commits.slice(0, 100),
                  pageInfo: { hasNextPage: true, endCursor: "commit-100" },
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        }
      : {
          repository: {
            id: evidence.repositoryNodeId,
            pullRequest: {
              id: "PR_census",
              commits: {
                totalCount: 101,
                nodes: commits.slice(100),
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
  );
  const census = await collectAcceptedCommitCensus(
    { ...f.client, graphql: budget.graphql },
    evidence,
    Date.parse(f.pull.merged_at),
  );
  expect(census?.ids).toEqual(new Set(["PR_census"]));
  expect(census?.carriers.size).toBe(101);
  expect(budget.client.getRateLimit().consumedDuringRun).toBe(2);
});
