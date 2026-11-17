// spec/points/profiles.md, "Story: Publish a profile census that never loses counts"
import type { Fetcher } from "@repo/platform/bindings";

export const start = Date.UTC(2026, 10, 17, 12, 0, 0);
export const startIso = new Date(start).toISOString();

export interface FakeAuthor { readonly kind: "User" | "Bot"; readonly id: string; readonly login: string; readonly avatar: number }
export interface FakePull { readonly id: string; readonly state: "OPEN" | "CLOSED" | "MERGED"; readonly author: FakeAuthor | null }
export interface FakeEvent { readonly type: "ClosedEvent" | "ReopenedEvent"; readonly id: string; readonly createdAt: string; readonly stateReason: string | null }
export interface FakeIssue {
  readonly id: string;
  readonly number: number;
  readonly createdAt: string;
  readonly state: "OPEN" | "CLOSED";
  readonly stateReason: string | null;
  readonly author: FakeAuthor | null;
  readonly events: readonly FakeEvent[];
}
export interface FakeRepository { readonly id: string; readonly pulls: FakePull[]; readonly issues: FakeIssue[] }
export interface RegistryEntry { readonly projectId: string; readonly repository: string; readonly status: "active" | "paused" }

export interface ProfileWorld {
  readonly repositories: Map<string, FakeRepository>;
  readonly registry: RegistryEntry[];
  readonly requests: string[];
}

export const ada: FakeAuthor = { kind: "User", id: "U_ada", login: "ada", avatar: 101 };
export const grace: FakeAuthor = { kind: "User", id: "U_grace", login: "grace", avatar: 102 };
export const linus: FakeAuthor = { kind: "User", id: "U_linus", login: "linus", avatar: 103 };
const renovate: FakeAuthor = { kind: "Bot", id: "BOT_renovate", login: "renovate[bot]", avatar: 900 };

/** @throws {never} */
export function avatarOf(author: FakeAuthor): string {
  return `https://avatars.githubusercontent.com/u/${author.avatar}?v=4`;
}

function cycle(prefix: string, rounds: number): FakeEvent[] {
  return Array.from({ length: rounds }, (_, round) => [
    { type: "ClosedEvent" as const, id: `${prefix}_closed_${round}`, createdAt: `2026-11-0${round + 1}T10:00:00Z`, stateReason: "COMPLETED" },
    { type: "ReopenedEvent" as const, id: `${prefix}_reopened_${round}`, createdAt: `2026-11-0${round + 1}T11:00:00Z`, stateReason: null },
  ]).flat();
}

/** The current GitHub state after elizaOS/asi became SlopDotCash/asi. @throws {never} */
export function seeded(): ProfileWorld {
  const asi: FakeRepository = {
    id: "R_asi",
    pulls: [
      { id: "PR_1", state: "MERGED", author: ada },
      { id: "PR_2", state: "MERGED", author: ada },
      { id: "PR_3", state: "OPEN", author: ada },
      { id: "PR_4", state: "CLOSED", author: renovate },
      { id: "PR_5", state: "CLOSED", author: null },
    ],
    issues: [
      { id: "I_one", number: 1, createdAt: "2026-10-02T00:00:00Z", state: "CLOSED", stateReason: "NOT_PLANNED", author: ada, events: [{ type: "ClosedEvent", id: "E_one_closed", createdAt: "2026-10-03T00:00:00Z", stateReason: "NOT_PLANNED" }] },
      { id: "I_six", number: 6, createdAt: "2026-10-20T00:00:00Z", state: "OPEN", stateReason: null, author: grace, events: cycle("E_six", 3) },
      { id: "I_seven", number: 7, createdAt: "2026-10-21T00:00:00Z", state: "CLOSED", stateReason: "COMPLETED", author: linus, events: [] },
    ],
  };
  const widgets: FakeRepository = {
    id: "R_widgets",
    pulls: Array.from({ length: 101 }, (_, index) => ({ id: `PR_w${String(index).padStart(3, "0")}`, state: "MERGED" as const, author: grace })),
    issues: [],
  };
  return {
    repositories: new Map([["SlopDotCash/asi", asi], ["ada/widgets", widgets]]),
    registry: [
      { projectId: "asi-network", repository: "SlopDotCash/asi", status: "active" },
      { projectId: "gadgets", repository: "ada/gadgets", status: "paused" },
      { projectId: "widgets", repository: "ada/widgets", status: "active" },
    ],
    requests: [],
  };
}

const closedOn = (id: string, at: string, reason: string) => ({ id, kind: "closed", occurredAt: at, reason, relatedIssueId: null });

/** The census published the day before, when the repository was still collected as elizaOS/asi. @throws {never} */
export function previousCensus() {
  const issue = (id: string, repository: string, number: number, authorId: string | null) => ({
    id, repository, number, authorId, createdAt: "2026-10-02T00:00:00.000Z", observedAt: "2026-11-16T05:55:00.000Z",
    state: "OPEN", reason: null, unavailableSince: null, correctedAt: null, historyIncompleteSince: null, events: [] as unknown[],
  });
  return {
    schemaVersion: "2",
    startedAt: "2026-11-16T05:50:00.000Z",
    generatedAt: "2026-11-16T06:00:00.000Z",
    repositories: [
      { repository: "elizaOS/asi", count: 2, excluded: 0 },
      { repository: "Canonry/canonry", count: 3, excluded: 1 },
      { repository: "ada/widgets", count: 1, excluded: 0 },
      { repository: "ada/gadgets", count: 1, excluded: 0 },
    ],
    people: [
      { id: ada.id, login: ada.login, avatarUrl: avatarOf(ada), repositories: [
        { repository: "elizaOS/asi", merged: 2, open: 0, closed: 0 },
        { repository: "Canonry/canonry", merged: 1, open: 1, closed: 0 },
        { repository: "ada/gadgets", merged: 1, open: 0, closed: 0 },
      ] },
      { id: grace.id, login: grace.login, avatarUrl: avatarOf(grace), repositories: [{ repository: "ada/widgets", merged: 0, open: 1, closed: 0 }] },
      { id: linus.id, login: linus.login, avatarUrl: avatarOf(linus), repositories: [] },
    ],
    issues: {
      firstObservedAt: "2026-10-01T00:00:00.000Z",
      repositories: [
        { repository: "elizaOS/asi", count: 2 },
        { repository: "Canonry/canonry", count: 1 },
        { repository: "ada/widgets", count: 1 },
        { repository: "ada/gadgets", count: 0 },
      ],
      items: [
        { ...issue("I_one", "elizaOS/asi", 1, ada.id), state: "CLOSED", reason: "COMPLETED", events: [closedOn("E_one_closed", "2026-10-03T00:00:00.000Z", "COMPLETED")] },
        issue("I_two", "elizaOS/asi", 2, linus.id),
        issue("I_three", "ada/widgets", 3, null),
        { ...issue("I_four", "Canonry/canonry", 4, ada.id), state: "CLOSED", reason: "COMPLETED", events: [closedOn("E_four_closed", "2026-10-04T00:00:00.000Z", "COMPLETED")] },
      ],
    },
  };
}

function registryAnswer(world: ProfileWorld) {
  return {
    schemaVersion: "1",
    projects: world.registry.map((entry) => ({
      id: entry.projectId,
      status: entry.status,
      listingTier: "listed",
      authority: {},
      reward: { committedMinor: "0", monthlyCapMinor: "0" },
      skill: {},
      repositories: [{ id: entry.repository, githubUrl: `https://github.com/${entry.repository}`, displayName: entry.repository, description: "", integrationBranch: "main" }],
    })),
  };
}

function connection<T, N>(items: readonly T[], first: number, after: unknown, node: (item: T) => N) {
  const offset = typeof after === "string" ? Number(after) : 0;
  const end = Math.min(items.length, offset + first);
  return {
    totalCount: items.length,
    pageInfo: { hasNextPage: end < items.length, endCursor: end === offset ? null : String(end) },
    nodes: items.slice(offset, end).map(node),
  };
}

function author(value: FakeAuthor | null) {
  if (value === null) return null;
  const shown = { __typename: value.kind, login: value.login, avatarUrl: avatarOf(value) };
  return value.kind === "User" ? { ...shown, id: value.id } : shown;
}

function event(value: FakeEvent) {
  return value.type === "ClosedEvent"
    ? { __typename: value.type, id: value.id, createdAt: value.createdAt, stateReason: value.stateReason, duplicateOf: null }
    : { __typename: value.type, id: value.id, createdAt: value.createdAt, stateReason: value.stateReason };
}

function issue(value: FakeIssue) {
  return {
    id: value.id,
    number: value.number,
    createdAt: value.createdAt,
    state: value.state,
    stateReason: value.stateReason,
    author: author(value.author),
    timelineItems: connection(value.events, 5, null, event),
  };
}

function answer(requests: number, data: Record<string, unknown>): Response {
  const rateLimit = { cost: 1, limit: 5000, remaining: 5000 - requests, resetAt: "2026-11-17T13:00:00Z" };
  return Response.json({ data: { ...data, rateLimit } });
}

interface GraphqlBody { readonly query: string; readonly variables: Readonly<Record<string, unknown>> }

function graphql(world: ProfileWorld, body: GraphqlBody): Response {
  const { query, variables } = body;
  const count = world.requests.length;
  if (query.includes("node(id:$id)")) {
    world.requests.push(`timeline ${String(variables.id)} after ${String(variables.after)}`);
    const found = [...world.repositories.values()].flatMap((repository) => repository.issues).find((item) => item.id === variables.id);
    return answer(count, { node: found === undefined ? null : { timelineItems: connection(found.events, 100, variables.after, event) } });
  }
  const name = `${String(variables.owner)}/${String(variables.name)}`;
  const repository = world.repositories.get(name);
  const pulls = query.includes("pullRequests(");
  world.requests.push(`${pulls ? "pull requests" : "issues"} ${name} after ${String(variables.after)}`);
  if (repository === undefined) return answer(count, { repository: null });
  return answer(count, {
    repository: pulls
      ? { id: repository.id, pullRequests: connection(repository.pulls, 100, variables.after, (pull) => ({ id: pull.id, state: pull.state, author: author(pull.author) })) }
      : { id: repository.id, issues: connection(repository.issues, 100, variables.after, issue) },
  });
}

/** Slop's project registry and GitHub's GraphQL API, the two services a profile census reads. @throws {never} */
export function fetcherOf(world: ProfileWorld): Fetcher {
  return {
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.origin === "https://slop.cash" && url.pathname === "/api/v1/projects") {
        world.requests.push("registry");
        return Response.json(registryAnswer(world));
      }
      if (request.method === "POST" && url.origin === "https://api.github.com" && url.pathname === "/graphql") {
        return graphql(world, (await request.json()) as GraphqlBody);
      }
      return new Response("not found", { status: 404 });
    },
  };
}
