import { expect, test } from "bun:test";
import { collectValueReferenceEvidence } from "../workers/slopbot/value-evidence";
import type {
  EvidenceClient,
  Pull,
} from "../workers/slopbot/value-evidence-types";
import { validateHistoricalDiscussion } from "./historical-discussion-evidence";

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

test("complete provider discussion reproduces legacy ordered outgoing resolution", async () => {
  const envelope = fixture();
  const read = () =>
    Promise.resolve(validateHistoricalDiscussion(envelope, expected, pull));
  const statuses: (string | number)[] = [];
  const client = {
    get<T>(path: string) {
      statuses.push(path);
      if (path.endsWith("/42")) return Promise.resolve(pull as T);
      if (path.includes("/reviews?"))
        return Promise.resolve([
          { body: "Refs #4", state: "PENDING" },
          { body: "Refs #3" },
        ] as T);
      throw new Error("Discussion lists already verified");
    },
    graphql<T>(query: string, args: Record<string, unknown>) {
      expect(query).toContain("issueOrPullRequest");
      statuses.push(args.number as number);
      return Promise.resolve({
        repository: {
          isPrivate: false,
          nameWithOwner: expected.repository,
          issueOrPullRequest: source(args.number as number),
        },
      } as T);
    },
  } satisfies EvidenceClient;
  const result = await collectValueReferenceEvidence(
    client,
    expected.repository,
    expected.number,
    read,
  );
  expect(statuses).toEqual([
    "/repos/elizaOS/eliza/pulls/42",
    "/repos/elizaOS/eliza/pulls/42/reviews?per_page=100&page=1",
    4,
    3,
    5,
    6,
    7,
  ]);
  expect(result.references.map((r) => r.number)).toEqual([2, 3, 4, 5, 6, 7]);
  expect(result.limitations).toEqual([]);
});

const invalid: {
  label: string;
  change: (
    node: ReturnType<typeof fixture>["repository"]["pullRequest"],
  ) => void;
}[] = [
  {
    label: "null inline body",
    change: (node) =>
      Object.assign(node.reviewThreads.nodes[0].comments.nodes[0], {
        body: null,
      }),
  },
  {
    label: "pending nested thread comment page",
    change: (node) => {
      node.reviewThreads.nodes[0].comments.pageInfo.hasNextPage = true;
    },
  },
  {
    label: "missing nested thread comment",
    change: (node) => {
      node.reviewThreads.nodes[0].comments.totalCount += 1;
    },
  },
  {
    label: "REST inline count mismatch",
    change: (node) => {
      node.reviewThreads = page(node.reviewThreads.nodes.slice(1));
    },
  },
  {
    label: "timeline overflow",
    change: (node) => {
      node.timelineItems.pageInfo.hasNextPage = true;
    },
  },
  {
    label: "private source",
    change: (node) => {
      node.timelineItems.nodes[0].source.repository.isPrivate = true;
    },
  },
  {
    label: "missing timeline source",
    change: (node) => {
      Object.assign(node.timelineItems.nodes[0], { source: null });
    },
  },
  {
    label: "conflicting source ID",
    change: (node) => {
      node.timelineItems.nodes.push({ source: { ...source(8), id: "PR_2" } });
    },
  },
  {
    label: "wrong immutable head",
    change: (node) => {
      node.headRefOid = "b".repeat(40);
    },
  },
  {
    label: "stale source read",
    change: (node) => {
      node.updatedAt = "2026-11-13T20:00:00Z";
    },
  },
  {
    label: "incomplete REST comment count",
    change: (node) => {
      node.comments = page([]);
    },
  },
];
for (const { label, change } of invalid)
  test(`inconclusive historical discussion falls back for ${label}`, () => {
    const value = fixture();
    change(value.repository.pullRequest);
    expect(validateHistoricalDiscussion(value, expected, pull)).toBeNull();
  });
