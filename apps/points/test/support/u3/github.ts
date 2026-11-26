// spec/points/ingestion.md, "Story: Read GitHub without retrying writes or inventing success"
import type { Fetcher } from "@repo/platform/bindings";
import { type GitHubFake, type ScriptedFailure, githubFake } from "@repo/platform/testing/github";

export const start = Date.UTC(2026, 10, 16, 12, 0, 0);
export const owner = "ada";
export const repository = "ada/widgets";

export interface Seeded {
  readonly fake: GitHubFake;
  readonly token: string;
  readonly commit: string;
  readonly pull: number;
  readonly nodeId: string;
}

/** @throws {Error} */
export function seeded(now: () => number): Seeded {
  const fake = githubFake({ now });
  fake.world.addUser({ id: 101, login: owner });
  fake.world.addUser({ id: 102, login: "grace" });
  const created = fake.world.addRepo({ id: 7001, owner, name: "widgets" });
  const commit = fake.world.addCommit(repository, { message: "Second", author: owner, files: { "README.md": "two" } });
  const pull = fake.world.addPull({ repo: repository, author: "grace", title: "Fix", body: "Body" });
  return { fake, token: fake.tokens.user(owner), commit, pull, nodeId: created.nodeId };
}

/** @throws {never} */
export function fetcherOf(fake: GitHubFake): Fetcher {
  return { fetch: (request) => fake.fetch(request) };
}

/** @throws {never} */
export function answer(body: string | Uint8Array | null, init: ResponseInit = {}): Response {
  return new Response(typeof body === "string" || body === null ? body : body.slice(), init);
}

/** @throws {never} */
export function jsonAnswer(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, init);
}

/** @throws {never} */
export function withEtag(fake: GitHubFake, match: RegExp, etag: string): void {
  fake.alterNext(match, (response) => {
    const headers = new Headers(response.headers);
    headers.set("etag", etag);
    return new Response(response.body, { status: response.status, headers });
  });
}

/** @throws {never} */
export function notModified(fake: GitHubFake, match: RegExp, etag: string): void {
  fake.alterNext(match, () => new Response(null, { status: 304, headers: { etag } }));
}

/** @throws {never} */
export function statuses(fake: GitHubFake, from: number): ReadonlyArray<number | "disconnected"> {
  return fake.requests.slice(from).map((request) => request.status);
}

/** @throws {never} */
export function failNext(fake: GitHubFake, match: RegExp, failure: ScriptedFailure, times = 1): void {
  for (let index = 0; index < times; index += 1) fake.failNext(match, failure);
}

/** @throws {Error} */
export function pullNodeIds(fake: GitHubFake, count: number): ReadonlyArray<string> {
  return Array.from({ length: count }, (_, index) => {
    const number = fake.world.addPull({ repo: repository, author: "grace", title: `Batch ${index + 1}` });
    const pull = fake.represent.pull(repository, number) as { readonly node_id: string };
    return pull.node_id;
  });
}

/** @throws {never} */
export function gatewayText(fake: GitHubFake, times: number): void {
  for (let index = 0; index < times; index += 1) {
    fake.alterNext(/^POST \/graphql$/u, () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
  }
}

/** @throws {never} */
export function withRateLimit(fake: GitHubFake, remaining: number, resetAt: number): void {
  fake.alterNext(/^POST \/graphql$/u, async (response) => {
    const body = (await response.json()) as { readonly data?: Readonly<Record<string, unknown>> };
    const rateLimit = { cost: 1, limit: 5000, remaining, resetAt: new Date(resetAt).toISOString() };
    return new Response(JSON.stringify({ ...body, data: { ...body.data, rateLimit } }), { status: response.status, headers: response.headers });
  });
}
