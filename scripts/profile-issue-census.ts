import type {
  ProfileIndex,
  ProfileIssue,
  ProfileIssueEvent,
  ProfileIssueHistory,
  ProfileRecord,
} from "../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";

type Page<T> = {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
};
type Event = {
  __typename: string;
  id: string;
  createdAt: string;
  stateReason?: string | null;
  canonical?: { id: string } | null;
  duplicateOf?: { id: string } | null;
};
type Issue = {
  id: string;
  number: number;
  createdAt: string;
  state: "OPEN" | "CLOSED";
  stateReason: string | null;
  author: {
    __typename: string;
    id?: string;
    login: string;
    avatarUrl: string;
  } | null;
  timelineItems: Page<Event>;
};
type RepositoryIssues = {
  repository: { id: string; issues: Page<Issue> } | null;
};

export type CensusRequest = <T>(
  query: string,
  variables: Record<string, string | null>,
) => Promise<T>;
const kinds = {
  ClosedEvent: "closed",
  ReopenedEvent: "reopened",
  MarkedAsDuplicateEvent: "duplicate",
  UnmarkedAsDuplicateEvent: "unmarked-duplicate",
  TransferredEvent: "transferred",
} as const;
const itemTypes =
  "[CLOSED_EVENT,REOPENED_EVENT,MARKED_AS_DUPLICATE_EVENT,UNMARKED_AS_DUPLICATE_EVENT,TRANSFERRED_EVENT]";
const events = `totalCount pageInfo{hasNextPage endCursor} nodes{__typename ... on ClosedEvent{id createdAt stateReason duplicateOf{... on Issue{id}}} ... on ReopenedEvent{id createdAt stateReason} ... on MarkedAsDuplicateEvent{id createdAt canonical{... on Issue{id}}} ... on UnmarkedAsDuplicateEvent{id createdAt canonical{... on Issue{id}}} ... on TransferredEvent{id createdAt}}`;
const query = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){id issues(first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id number createdAt state stateReason author{__typename login avatarUrl ... on User{id}} timelineItems(first:5,itemTypes:${itemTypes}){${events}}}}}rateLimit{cost limit remaining resetAt}}`;

/** Collect public outcome facts; preserve inaccessible prior records as coverage gaps. */
export async function collectProfileIssues(
  request: CensusRequest,
  people: Map<string, ProfileRecord>,
  previous: ProfileIndex,
  startedAt: string,
): Promise<ProfileIssueHistory> {
  const prior = new Map(
    (previous.issues?.items ?? []).map((issue) => [issue.id, issue]),
  );
  const result: ProfileIssueHistory = {
    firstObservedAt: previous.issues?.firstObservedAt ?? startedAt,
    repositories: [],
    items: [],
  };
  const seen = new Set<string>();
  for (const repository of TARGET_REPOSITORIES) {
    let after: string | null = null;
    let repositoryId: string | null = repository.expectedNodeId;
    let reported = 0;
    let count = 0;
    do {
      const data: RepositoryIssues = await request<RepositoryIssues>(query, {
        owner: repository.owner,
        name: repository.name,
        after,
      });
      if (
        !data.repository ||
        (repositoryId && data.repository.id !== repositoryId)
      )
        throw Error("Issue repository identity changed");
      repositoryId = data.repository.id;
      const page = data.repository.issues;
      if (page.totalCount < reported)
        throw Error("Issue inventory shrank during census");
      reported = page.totalCount;
      for (const source of page.nodes) {
        if (!source.id || seen.has(source.id))
          throw Error(
            "Duplicate issue in census; retry after any transfer completes",
          );
        seen.add(source.id);
        count++;
        let timeline = source.timelineItems;
        const history = [...timeline.nodes];
        let cursor = timeline.pageInfo.endCursor;
        while (timeline.pageInfo.hasNextPage) {
          if (!cursor) throw Error("Missing issue history cursor");
          const continuation = await request<{
            node: { timelineItems: Page<Event> } | null;
          }>(
            `query($id:ID!,$after:String){node(id:$id){... on Issue{timelineItems(first:100,after:$after,itemTypes:${itemTypes}){${events}}}}rateLimit{cost limit remaining resetAt}}`,
            { id: source.id, after: cursor },
          );
          if (!continuation.node)
            throw Error("Issue became inaccessible during census");
          timeline = continuation.node.timelineItems;
          history.push(...timeline.nodes);
          if (
            timeline.pageInfo.hasNextPage &&
            timeline.pageInfo.endCursor === cursor
          )
            throw Error("Issue history pagination did not advance");
          cursor = timeline.pageInfo.endCursor;
        }
        if (
          history.length !== timeline.totalCount ||
          new Set(history.map((event) => event.id)).size !== history.length
        )
          throw Error("Issue event count reconciliation failed");
        const normalized: ProfileIssueEvent[] = history.map((event) => {
          const kind = kinds[event.__typename as keyof typeof kinds];
          if (!kind) throw Error("Unknown issue event kind");
          return {
            id: event.id,
            kind,
            occurredAt: event.createdAt,
            reason: event.stateReason ?? null,
            relatedIssueId:
              event.canonical?.id ?? event.duplicateOf?.id ?? null,
          };
        });
        const observedAt = new Date().toISOString();
        const before = prior.get(source.id);
        // A source correction is distinct from a newly appended transition.
        const changed = before?.events.some(
          (old) =>
            JSON.stringify(normalized.find((event) => event.id === old.id)) !==
            JSON.stringify(old),
        );
        const author = source.author;
        const authorId =
          author?.__typename === "User" && author.id ? author.id : null;
        if (authorId && author) {
          const person: ProfileRecord = people.get(authorId) ?? {
            id: authorId,
            login: author.login,
            avatarUrl: author.avatarUrl,
            repositories: [],
          };
          person.login = author.login;
          person.avatarUrl = author.avatarUrl;
          people.set(authorId, person);
        }
        result.items.push({
          id: source.id,
          repository: repository.id,
          number: source.number,
          authorId,
          createdAt: source.createdAt,
          observedAt,
          state: source.state,
          reason: source.stateReason,
          unavailableSince: null,
          correctedAt: changed ? observedAt : (before?.correctedAt ?? null),
          events: normalized,
        });
      }
      if (
        page.pageInfo.hasNextPage &&
        (!page.pageInfo.endCursor || page.pageInfo.endCursor === after)
      )
        throw Error("Issue pagination did not advance");
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
    if (count !== reported) throw Error("Issue count reconciliation failed");
    result.repositories.push({ repository: repository.id, count });
    console.log(
      `${repository.id}: ${count} issues and their event histories reconciled`,
    );
  }
  const previousPeople = new Map(
    previous.people.map((person) => [person.id, person]),
  );
  for (const old of prior.values()) {
    if (seen.has(old.id)) continue;
    const retained: ProfileIssue = {
      ...old,
      unavailableSince: old.unavailableSince ?? new Date().toISOString(),
    };
    result.items.push(retained);
    if (old.authorId && !people.has(old.authorId)) {
      const identity = previousPeople.get(old.authorId);
      if (!identity)
        throw Error("Retained issue author is missing from prior census");
      // Prior PR counts must not be copied into a new PR inventory.
      people.set(identity.id, { ...identity, repositories: [] });
    }
  }
  result.items.sort((left, right) => left.id.localeCompare(right.id));
  return result;
}
