// spec/points/census.md, "Story: Collect a complete inventory and a decision for every item"
import type { Fetcher } from "@repo/platform/bindings";
import { type Account, type GitHubFake, type Item, githubFake } from "@repo/platform/testing/github";
import type { Hydrated } from "../../../src/census/collect.vibe";

export const start = Date.UTC(2026, 10, 16, 12, 0, 0);
export const owner = "ada";
export const repository = "ada/widgets";

export interface Seeded {
  readonly fake: GitHubFake;
  readonly token: string;
  readonly repositoryNodeId: string;
}

/** @throws {Error} */
export function seeded(now: () => number): Seeded {
  const fake = githubFake({ now });
  fake.world.addUser({ id: 101, login: owner });
  fake.world.addUser({ id: 102, login: "grace" });
  fake.world.addUser({ id: 103, login: "linus" });
  fake.world.addUser({ id: 104, login: "helper[bot]", type: "Bot" });
  const created = fake.world.addRepo({ id: 7001, owner, name: "widgets" });
  fake.world.addIssue({ repo: repository, author: "grace", title: "Fix the broken thing", labels: ["mission-ready"] });
  fake.world.addIssue({ repo: repository, author: "linus", title: "Untriaged report", labels: ["website"] });
  fake.world.addIssue({ repo: repository, author: "grace", title: "Sensitive", labels: ["mission-ready", "security"] });
  fake.world.addPull({ repo: repository, author: "linus", title: "Ready change", files: [{ path: "src/a.ts", additions: 3, deletions: 1, status: "modified" }] });
  fake.world.addPull({ repo: repository, author: "helper[bot]", title: "Bump", draft: true, files: [{ path: "package.json", additions: 1, deletions: 1, status: "modified" }] });
  return { fake, token: fake.tokens.user(owner), repositoryNodeId: created.nodeId };
}

/** @throws {never} */
export function fetcherOf(fake: GitHubFake): Fetcher {
  return { fetch: (request) => fake.fetch(request) };
}

/** @throws {never} */
export function openedDuringPage(fake: GitHubFake, title: string): void {
  fake.alterNext(/^POST \/graphql$/u, (response) => {
    fake.world.addIssue({ repo: repository, author: "linus", title, labels: ["mission-ready"] });
    return response;
  });
}

/** @throws {never} */
export function unchangedPage(fake: GitHubFake): void {
  fake.alterNext(/^POST \/graphql$/u, (response) => response);
}

function actorOf(account: Account) {
  return { id: account.nodeId, login: account.login, kind: account.kind === "Bot" ? "Bot" : "User" };
}

function factsOf(item: Item) {
  const pull = item.kind === "pull" ? item : undefined;
  return {
    kind: pull === undefined ? "IssueItem" as const : "PullRequestItem" as const,
    open: item.state === "open" && (pull === undefined || pull.mergedAt === null),
    author: actorOf(item.author),
    slopbot: false,
    title: item.title,
    body: item.body,
    labels: item.labels.map((label) => label.name),
    assignees: item.assignees.map(actorOf),
    comments: item.comments.map((comment) => ({
      id: comment.nodeId,
      author: actorOf(comment.author),
      association: comment.author.id === item.repository.owner.id ? "OWNER" : "NONE",
      createdAt: Date.parse(comment.createdAt),
      body: comment.body,
    })),
    linkedPullRequests: 0,
    draft: pull?.draft ?? false,
    filesAvailable: pull === undefined || pull.files.length > 0,
    reviewDecision: "",
    activeReviewRequests: pull === undefined ? -1 : pull.requestedReviewers.length,
  };
}

/** @throws {Error} */
export function hydratedFromWorld(fake: GitHubFake, nodeIds: ReadonlyArray<string>): ReadonlyArray<Hydrated> {
  return nodeIds.map((nodeId) => {
    const found = fake.world.node(nodeId);
    if (found === undefined) throw new Error(`${nodeId} is not in the GitHub world`);
    return { nodeId, facts: factsOf(found.value as Item) };
  });
}

/** @throws {never} */
export function nodeIdOf(fake: GitHubFake, number: number): string {
  return fake.world.item(repository, number).nodeId;
}

const manifest = (id: string, repositoryPath: string, nodeId: string, committedMinor: string, extra: Readonly<Record<string, unknown>> = {}) => ({
  id,
  name: id,
  status: "active",
  listingTier: "community",
  authority: { repositoryId: repositoryPath, repositoryNodeId: nodeId, role: "admin", state: "verified", proof: "github-admin", reason: "fixture" },
  reward: { committedMinor, monthlyCapMinor: "100000000", fundingState: "committed" },
  skill: { publishAtRoot: false },
  repositories: [{ id: repositoryPath, displayName: repositoryPath, githubUrl: `https://github.com/${repositoryPath}`, description: `The ${id} source repository.`, integrationBranch: "main", aliases: [] }],
  ...extra,
});

export const registrySnapshot = {
  schemaVersion: "1",
  projects: [
    manifest("widgets", repository, "R_widgets", "500000000"),
    manifest("paused-gadgets", "ada/gadgets", "R_gadgets", "900000000", { status: "paused" }),
    manifest("asi", "elizaOS/asi", "R_asi", "800000000"),
    manifest("delisted", "ada/delisted", "R_delisted", "700000000", { listingTier: "retired" }),
    manifest("held", "ada/held", "R_held", "600000000"),
  ],
  restrictions: [{ projectId: "held", state: "quarantined" }],
};

export interface Served {
  readonly fetcher: Fetcher;
  readonly paths: ReadonlyArray<string>;
}

/** @throws {never} */
export function servedRegistry(body: unknown): Served {
  const paths: string[] = [];
  return {
    paths,
    fetcher: {
      fetch: (request) => {
        const url = new URL(request.url);
        paths.push(`${request.method} ${url.origin}${url.pathname}`);
        return Promise.resolve(url.pathname === "/api/v1/projects"
          ? new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-slop-project-api-contract": "1" } })
          : new Response("{}", { status: 404, headers: { "content-type": "application/json" } }));
      },
    },
  };
}
