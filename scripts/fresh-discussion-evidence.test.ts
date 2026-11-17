import { expect, test } from "bun:test";
import { collectValueReferenceEvidence } from "../workers/slopbot/value-evidence";
import type {
  EvidenceClient,
  Pull,
} from "../workers/slopbot/value-evidence-types";
import { GitHubGraphqlClient } from "./generate-leaderboard";
import {
  historicalDiscussionQuery,
  validateHistoricalDiscussion,
} from "./historical-discussion-evidence";

const expected = {
  repository: "elizaOS/eliza",
  repositoryNodeId: "R_repo",
  number: 42,
  id: "PR_carrier",
  url: "https://github.com/elizaOS/eliza/pull/42",
  mergedAt: "2026-11-14T00:00:00.000Z",
  headSha: "a".repeat(40),
};
const when = "2026-11-14T00:00:00Z";
const pull = {
  node_id: expected.id,
  number: expected.number,
  html_url: expected.url,
  body: null,
  state: "closed",
  merged_at: when,
  updated_at: when,
  head: { sha: expected.headSha },
  comments: 1,
  review_comments: 2,
} as Pull;
const source = (number: number) => ({
  __typename: "PullRequest",
  id: `PR_${number}`,
  number,
  url: `https://github.com/elizaOS/eliza/pull/${number}`,
  repository: { nameWithOwner: expected.repository, isPrivate: false },
});
const page = <T>(nodes: T[]) => ({
  totalCount: nodes.length,
  nodes,
  pageInfo: { hasNextPage: false },
});
const row = (fragment: string, n: number) => ({
  id: `row-${n}`,
  url: `${expected.url}#${fragment}${n}`,
  body: `Refs #${n}`,
});
function fixture() {
  return {
    repository: {
      id: expected.repositoryNodeId,
      isPrivate: false,
      nameWithOwner: expected.repository,
      pullRequest: {
        id: expected.id,
        number: expected.number,
        url: expected.url,
        state: "MERGED",
        headRefOid: expected.headSha,
        mergedAt: when,
        updatedAt: when,
        body: null,
        comments: page([row("issuecomment-", 5)]),
        reviewThreads: page([
          { id: "PRRT_10", comments: page([row("discussion_r", 7)]) },
          { id: "PRRT_9", comments: page([row("discussion_r", 6)]) },
        ]),
        timelineItems: { ...page([{ source: source(2) }]), totalCount: 36 },
      },
    },
  };
}

const variables = { owner: "elizaOS", name: "eliza", number: 42 };
const resetAt = "2099-01-01T00:00:00Z";
const rateLimit = (remaining: number) => ({
  cost: 1,
  limit: 5_000,
  remaining,
  resetAt,
});

async function discovery(
  firstReply: Response | null,
  remaining = 400,
  deadlineMs = Date.now() + 60_000,
) {
  const reads: string[] = [];
  const graph = new GitHubGraphqlClient(
    "fixture-token",
    async (_url, options) => {
      const { query, variables: args } = JSON.parse(String(options?.body));
      if (query === historicalDiscussionQuery) {
        expect(args).toEqual(variables);
        reads.push("counted discussion");
        if (firstReply) return firstReply;
        throw new Error("GraphQL discussion disabled for this request");
      }
      if (query.includes("timelineItems")) {
        reads.push("cursor timeline");
        return Response.json({
          data: {
            rateLimit: rateLimit(390),
            repository: {
              pullRequest: {
                id: pull.node_id,
                timelineItems: page([{ source: source(2) }]),
              },
            },
          },
        });
      }
      if (query.includes("issueOrPullRequest")) {
        reads.push(`reference ${args.number}`);
        return Response.json({
          data: {
            rateLimit: rateLimit(390),
            repository: {
              isPrivate: false,
              nameWithOwner: expected.repository,
              issueOrPullRequest: source(args.number),
            },
          },
        });
      }
      return Response.json({ data: { rateLimit: rateLimit(remaining) } });
    },
    { retryBaseDelayMs: 0 },
  );
  await graph.execute("query { rateLimit { cost limit remaining resetAt } }");
  const client = {
    async get<T>(path: string) {
      reads.push(path);
      if (path.endsWith("/42")) return pull as T;
      if (path.includes("/reviews?"))
        return [{ body: "Refs #4" }, { body: "Refs #3" }] as T;
      if (path.includes("/issues/42/comments?"))
        return [{ body: "Refs #5" }] as T;
      if (path.includes("/pulls/42/comments?"))
        return [{ body: "Refs #6" }, { body: "Refs #7" }] as T;
      throw new Error("Unexpected REST discovery request");
    },
    async graphql<T>(query: string, args: Record<string, unknown>) {
      return (await graph.execute(
        query,
        args as Parameters<typeof graph.execute>[1],
      )) as T;
    },
  } satisfies EvidenceClient;
  const result = () =>
    collectValueReferenceEvidence(
      client,
      expected.repository,
      expected.number,
      firstReply
        ? async (restPull) => {
            const data = await graph.tryReferenceDiscussion(
              variables,
              deadlineMs,
            );
            return data
              ? validateHistoricalDiscussion(data, expected, restPull)
              : null;
          }
        : undefined,
    );
  return { result, reads, graph };
}

test("counted fresh discovery saves two REST reads and resolves the same ordered evidence", async () => {
  const rest = await discovery(null);
  const optimized = await discovery(
    Response.json({
      data: { ...fixture(), rateLimit: rateLimit(399) },
    }),
  );
  expect(await optimized.result()).toEqual(await rest.result());
  expect(optimized.reads).toEqual([
    "/repos/elizaOS/eliza/pulls/42",
    "/repos/elizaOS/eliza/pulls/42/reviews?per_page=100&page=1",
    "counted discussion",
    "reference 4",
    "reference 3",
    "reference 5",
    "reference 6",
    "reference 7",
  ]);
  expect(rest.reads.filter((read) => read.startsWith("/repos"))).toHaveLength(
    4,
  );
  expect(optimized.graph.getRequestCount()).toBe(rest.graph.getRequestCount());
});

test("partial or stale GraphQL discussion returns to the complete REST and cursor path", async () => {
  const previous = await discovery(null);
  const expectedResult = await previous.result();
  for (const change of [
    (node: ReturnType<typeof fixture>["repository"]["pullRequest"]) => {
      node.reviewThreads.nodes[0].comments.pageInfo.hasNextPage = true;
    },
    (node: ReturnType<typeof fixture>["repository"]["pullRequest"]) => {
      node.updatedAt = "2026-11-13T20:00:00Z";
    },
  ]) {
    const incomplete = fixture();
    change(incomplete.repository.pullRequest);
    const candidate = await discovery(
      Response.json({
        data: { ...incomplete, rateLimit: rateLimit(399) },
      }),
    );
    expect(await candidate.result()).toEqual(expectedResult);
    expect(
      candidate.reads.filter((read) => read !== "counted discussion"),
    ).toEqual(previous.reads);
  }
  const rejected = await discovery(
    Response.json({ errors: [{ message: "Unsupported discussion field" }] }),
  );
  expect(await rejected.result()).toEqual(expectedResult);
  expect(
    rejected.reads.filter((read) => read !== "counted discussion"),
  ).toEqual(previous.reads);
  const malformed = await discovery(
    Response.json({
      data: { ...fixture(), rateLimit: rateLimit(399) },
      errors: {},
    }),
  );
  expect(await malformed.result()).toEqual(expectedResult);
  expect(malformed.reads).toContain("cursor timeline");
});

test("optional discussion does not spend the GraphQL reserve or start past the deadline", async () => {
  const response = new Response(null, { status: 501 });
  const low = await discovery(response, 101);
  // One available point belongs to the mandatory timeline fallback.
  await low.result();
  expect(low.reads).not.toContain("counted discussion");
  expect(low.reads).toContain("cursor timeline");
  const expired = await discovery(response, 400, Date.now() - 1);
  await expired.result();
  expect(expired.reads).not.toContain("counted discussion");
  expect(expired.reads).toContain("cursor timeline");
});

test("a GraphQL quota wait beyond the preparation deadline yields a checkpoint", async () => {
  const candidate = await discovery(Response.json({}, { status: 429 }));
  await expect(candidate.result()).rejects.toThrow(
    "GitHub source collection reached its checkpoint deadline",
  );
  expect(candidate.reads).toEqual([
    "/repos/elizaOS/eliza/pulls/42",
    "/repos/elizaOS/eliza/pulls/42/reviews?per_page=100&page=1",
    "counted discussion",
  ]);
});

test("ambiguous GraphQL denial leaves fallback untouched", async () => {
  for (const [response, reason] of [
    [Response.json({}, { status: 403 }), "reference discovery is forbidden"],
    [
      Response.json({ errors: [{ type: "RATE_LIMITED" }] }),
      "quota reset is unavailable",
    ],
  ] as const) {
    const candidate = await discovery(response);
    await expect(candidate.result()).rejects.toThrow(reason);
    expect(candidate.reads).not.toContain("cursor timeline");
    expect(
      candidate.reads.filter((read) => read.startsWith("/repos")),
    ).toHaveLength(2);
  }
});

test("a usable GraphQL Retry-After defers once and resumes the ordinary reads", async () => {
  const baseline = await discovery(null);
  const candidate = await discovery(
    Response.json({}, { status: 429, headers: { "retry-after": "1" } }),
  );
  const started = Date.now();
  expect(await candidate.result()).toEqual(await baseline.result());
  expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  expect(
    candidate.reads.filter((read) => read === "counted discussion"),
  ).toHaveLength(1);
  expect(candidate.reads).toContain("cursor timeline");
});
