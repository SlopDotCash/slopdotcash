import type {
  CompleteValueReferenceDiscussion,
  RelatedPullRequestTimelineNode,
} from "../workers/slopbot/value-evidence";
import type { Pull } from "../workers/slopbot/value-evidence-types";

const pageSize = 100;
const page = "totalCount pageInfo{hasNextPage} nodes{id body url}";
export const historicalDiscussionQuery = `query HistoricalValueDiscussion($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){id isPrivate nameWithOwner pullRequest(number:$number){id number url body state headRefOid mergedAt updatedAt comments(first:${pageSize}){${page}} reviewThreads(first:${pageSize}){totalCount pageInfo{hasNextPage} nodes{id comments(first:${pageSize}){${page}}}} timelineItems(first:${pageSize},itemTypes:[CROSS_REFERENCED_EVENT]){pageInfo{hasNextPage} nodes{... on CrossReferencedEvent{source{__typename ... on PullRequest{id number url repository{nameWithOwner isPrivate}}}}}}}} rateLimit{cost limit remaining resetAt}}`;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function historicalDiscussionHasRateLimit(value: unknown): boolean {
  const rateLimit = record(record(value)?.rateLimit);
  return (
    !!rateLimit &&
    [rateLimit.cost, rateLimit.limit, rateLimit.remaining].every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    ) &&
    typeof rateLimit.resetAt === "string" &&
    Number.isFinite(Date.parse(rateLimit.resetAt))
  );
}

function completePage(value: unknown, requireTotal = true): unknown[] | null {
  const data = record(value);
  if (
    !Array.isArray(data?.nodes) ||
    data.nodes.length >= pageSize ||
    (requireTotal && data.totalCount !== data.nodes.length) ||
    record(data.pageInfo)?.hasNextPage !== false
  )
    return null;
  return data.nodes;
}

function discussionBodies(
  values: unknown[],
  pullUrl: string,
  fragment: string,
) {
  const entries = new Map<number, string>();
  const identities = new Set<string>();
  const prefix = `${pullUrl}#${fragment}`;
  for (const value of values) {
    const node = record(value);
    if (
      typeof node?.id !== "string" ||
      !node.id ||
      identities.has(node.id) ||
      typeof node.body !== "string" ||
      typeof node.url !== "string" ||
      !node.url.startsWith(prefix)
    )
      return null;
    const suffix = node.url.slice(prefix.length);
    const number = Number(suffix);
    if (
      !/^[1-9]\d*$/u.test(suffix) ||
      !Number.isSafeInteger(number) ||
      entries.has(number)
    )
      return null;
    identities.add(node.id);
    entries.set(number, node.body);
  }
  // GitHub's REST issue and review-comment listings default to ascending ID.
  // GraphQL groups inline comments by thread, so restore the global order.
  return [...entries]
    .sort(([left], [right]) => left - right)
    .map((entry) => entry[1]);
}

function incomingReferences(
  values: unknown[],
): RelatedPullRequestTimelineNode[] | null {
  const timeline: RelatedPullRequestTimelineNode[] = [];
  const ids = new Map<string, string>();
  const urls = new Map<string, string>();
  for (const value of values) {
    const source = record(record(value)?.source);
    if (typeof source?.__typename !== "string") return null;
    if (source.__typename !== "PullRequest") {
      if (source.__typename !== "Issue") return null;
      timeline.push({ source: { __typename: "Issue" } });
      continue;
    }
    const repo = record(source.repository);
    if (
      repo?.isPrivate !== false ||
      typeof repo.nameWithOwner !== "string" ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo.nameWithOwner) ||
      typeof source.id !== "string" ||
      !source.id ||
      typeof source.number !== "number" ||
      !Number.isSafeInteger(source.number) ||
      source.number <= 0 ||
      source.url !==
        `https://github.com/${repo.nameWithOwner}/pull/${source.number}` ||
      (ids.has(source.id) && ids.get(source.id) !== source.url) ||
      (urls.has(source.url) && urls.get(source.url) !== source.id)
    )
      return null;
    ids.set(source.id, source.url);
    urls.set(source.url, source.id);
    timeline.push({
      source: {
        __typename: "PullRequest",
        id: source.id,
        number: source.number,
        url: source.url,
        repository: { nameWithOwner: repo.nameWithOwner, isPrivate: false },
      },
    });
  }
  return timeline;
}

export function validateHistoricalDiscussion(
  value: unknown,
  expected: {
    repository: string;
    repositoryNodeId: string;
    id: string;
    number: number;
    url: string;
    headSha: string;
    mergedAt: string;
  },
  pull: Pull,
): CompleteValueReferenceDiscussion | null {
  const repository = record(record(value)?.repository);
  const node = record(repository?.pullRequest);
  if (
    !node ||
    repository?.id !== expected.repositoryNodeId ||
    repository.isPrivate !== false ||
    typeof repository.nameWithOwner !== "string" ||
    repository.nameWithOwner.toLowerCase() !==
      expected.repository.toLowerCase() ||
    node.state !== "MERGED" ||
    pull.state !== "closed" ||
    node.id !== expected.id ||
    node.id !== pull.node_id ||
    node.number !== expected.number ||
    node.number !== pull.number ||
    node.url !== expected.url ||
    node.url !== pull.html_url ||
    node.headRefOid !== expected.headSha ||
    node.headRefOid !== pull.head?.sha ||
    typeof node.mergedAt !== "string" ||
    Date.parse(node.mergedAt) !== Date.parse(expected.mergedAt) ||
    node.mergedAt !== pull.merged_at ||
    typeof node.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(node.updatedAt)) ||
    node.updatedAt !== pull.updated_at ||
    (node.body !== null && typeof node.body !== "string") ||
    (node.body ?? "") !== (pull.body ?? "")
  )
    return null;
  const comments = completePage(node.comments);
  const threads = completePage(node.reviewThreads);
  // GitHub's timeline totalCount is unfiltered even for itemTypes queries.
  // Use the same filtered connection pageInfo as existing discovery.
  const events = completePage(node.timelineItems, false);
  if (!comments || !threads || !events || comments.length !== pull.comments)
    return null;
  const inline: unknown[] = [];
  const threadIds = new Set<string>();
  for (const value of threads) {
    const thread = record(value);
    if (
      typeof thread?.id !== "string" ||
      !thread.id ||
      threadIds.has(thread.id)
    )
      return null;
    const page = completePage(thread.comments);
    if (!page) return null;
    threadIds.add(thread.id);
    inline.push(...page);
  }
  if (inline.length !== pull.review_comments || inline.length >= pageSize)
    return null;
  const commentBodies = discussionBodies(
    comments,
    expected.url,
    "issuecomment-",
  );
  const inlineBodies = discussionBodies(inline, expected.url, "discussion_r");
  const timeline = incomingReferences(events);
  if (!commentBodies || !inlineBodies || !timeline) return null;
  return { commentBodies, inlineBodies, timeline };
}
