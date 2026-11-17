// spec/points/authorship.md, "Commit identity, observations and line evidence remain bound together"
import type { Fetcher } from "@repo/platform/bindings";
import { type GitHubFake, githubFake } from "@repo/platform/testing/github";

export const start = Date.UTC(2026, 10, 16, 12, 0, 0);
export const day = 86_400_000;
export const repository = "ada/widgets";
export const bulkCommits = 101;

export interface Seeded {
  readonly fake: GitHubFake;
  readonly token: string;
  readonly repositoryNodeId: string;
  readonly pulls: { readonly paired: number; readonly stacked: number; readonly bulk: number; readonly old: number; readonly closed: number };
  readonly commits: { readonly grace: string; readonly shared: string; readonly linus: string };
  readonly ids: { readonly paired: string; readonly stacked: string; readonly bulk: string; readonly closed: string };
  readonly sharedCommitNodeId: string;
  readonly operations: string[];
}

const iso = (millis: number) => new Date(millis).toISOString();
export const closedAt = iso(start - day);

/** @throws {Error} */
export function seeded(): Seeded {
  const fake = githubFake({ now: () => start - 50 * day });
  fake.world.addUser({ id: 101, login: "ada" });
  fake.world.addUser({ id: 102, login: "grace" });
  fake.world.addUser({ id: 103, login: "linus" });
  const created = fake.world.addRepo({ id: 7001, owner: "ada", name: "widgets" });
  const base = created.branches.get(created.defaultBranch) ?? "";
  const grace = fake.world.addCommit(repository, { branch: "paired", parents: [base], author: "grace", files: { "src/a.ts": "one\ntwo\nthree\n" } });
  const shared = fake.world.addCommit(repository, { branch: "paired", parents: [grace], author: "linus", files: { "src/b.ts": "four\n" } });
  const linus = fake.world.addCommit(repository, { branch: "stacked", parents: [shared], author: "linus", files: { "src/c.ts": "five\nsix\n" } });
  const bulk: string[] = [];
  let parent = base;
  for (let index = 0; index < bulkCommits; index += 1) {
    parent = fake.world.addCommit(repository, { branch: "bulk", parents: [parent], author: "grace", files: { [`bulk/${index}.txt`]: `${index}\n` } });
    bulk.push(parent);
  }
  const paired = fake.world.addPull({ repo: repository, author: "grace", title: "Paired change", mergedAt: iso(start - 2 * day), commits: [grace, shared], headSha: shared, headRef: "paired", files: [{ path: "src/a.ts", additions: 3, deletions: 0, status: "added" }, { path: "src/b.ts", additions: 1, deletions: 0, status: "added" }] });
  const stacked = fake.world.addPull({ repo: repository, author: "linus", title: "Stacked change", mergedAt: iso(start - day), commits: [shared, linus], headSha: linus, headRef: "stacked", files: [{ path: "src/c.ts", additions: 2, deletions: 0, status: "added" }] });
  const bulkPull = fake.world.addPull({ repo: repository, author: "grace", title: "Bulk change", mergedAt: iso(start - 3 * day), commits: bulk, headSha: parent, headRef: "bulk", files: [{ path: "bulk/0.txt", additions: 1, deletions: 0, status: "added" }] });
  const old = fake.world.addPull({ repo: repository, author: "grace", title: "Before the window", mergedAt: iso(start - 40 * day), commits: [grace], headSha: grace, headRef: "old" });
  const closed = fake.world.addPull({ repo: repository, author: "linus", title: "Closed without merging", state: "closed", closedAt, commits: [linus], headSha: linus, headRef: "closed" });
  const nodeIdOf = (number: number) => fake.world.pull(repository, number).nodeId;
  return {
    fake,
    token: fake.tokens.user("ada"),
    repositoryNodeId: created.nodeId,
    pulls: { paired, stacked, bulk: bulkPull, old, closed },
    commits: { grace, shared, linus },
    ids: { paired: nodeIdOf(paired), stacked: nodeIdOf(stacked), bulk: nodeIdOf(bulkPull), closed: nodeIdOf(closed) },
    sharedCommitNodeId: created.commits.get(shared)?.nodeId ?? "",
    operations: [],
  };
}

interface GraphqlRequest { readonly query: string; readonly variables?: Readonly<Record<string, unknown>> }

const rateLimitQuery = "query { rateLimit { cost limit remaining resetAt } }";

async function forward(fake: GitHubFake, request: Request, body: GraphqlRequest): Promise<Response> {
  return fake.fetch(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }));
}

async function answered(response: Response, data: unknown): Promise<Response> {
  return new Response(JSON.stringify({ data }), { status: response.status, headers: response.headers });
}

/** The fake has no Commit.repository field and does not resolve review nodes; this boundary fills both from its world. @throws {never} */
export function fetcherOf(world: Seeded): Fetcher {
  return {
    fetch: async (request) => {
      if (request.method !== "POST" || !request.url.endsWith("/graphql")) return world.fake.fetch(request);
      const body = (await request.clone().json()) as GraphqlRequest;
      world.operations.push(/query\s+(\w+)/u.exec(body.query)?.[1] ?? "anonymous");
      if (body.query.includes("LeaderboardOutcomeCommitLines")) {
        const response = await forward(world.fake, request, { ...body, query: body.query.replace("repository { id }", "") });
        const payload = (await response.json()) as { data: { nodes: Array<Record<string, unknown> | null>; rateLimit: unknown } };
        return answered(response, { ...payload.data, nodes: payload.data.nodes.map((node) => (node === null ? null : { ...node, repository: { id: world.repositoryNodeId } })) });
      }
      if (body.query.includes("LeaderboardReviewInlineComments")) {
        const response = await forward(world.fake, request, { query: rateLimitQuery });
        const payload = (await response.json()) as { data: { rateLimit: unknown } };
        const ids = (body.variables?.ids ?? []) as string[];
        const empty = { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] };
        return answered(response, { nodes: ids.map((id) => ({ __typename: "PullRequestReview", id, comments: empty })), rateLimit: payload.data.rateLimit });
      }
      return world.fake.fetch(request);
    },
  };
}

type SearchAlteration = (nodes: unknown[]) => unknown[];

/** @throws {never} */
export function alterNextSearch(fake: GitHubFake, alter: SearchAlteration): void {
  fake.alterNext(/^POST \/graphql$/u, async (response) => {
    const payload = (await response.json()) as { data: { search: { nodes: unknown[] } } & Record<string, unknown> };
    const search = { ...payload.data.search, nodes: alter(payload.data.search.nodes) };
    return answered(response, { ...payload.data, search });
  });
}

/** @throws {never} */
export const dropLast: SearchAlteration = (nodes) => nodes.slice(0, -1);

/** @throws {never} */
export const repeatFirst: SearchAlteration = (nodes) => (nodes.length === 0 ? nodes : [nodes[0], ...nodes]);

/** @throws {never} */
export function requestsMatching(world: Seeded, name: string): number {
  return world.operations.filter((operation) => operation === name).length;
}
