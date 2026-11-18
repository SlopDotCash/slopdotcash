// spec/security/enforcement.md, "Flagger standing is read at filing time and bound to the current revision"; spec/security/enforcement.md, "Story: Two eligible contributors pause a project and a fresh clean scan resumes it"
import type { ExecutionContext, Fetcher } from "@repo/platform/bindings";

export interface FixtureActor {
  readonly id: string;
  readonly login: string;
}

export interface GitHubFixture {
  readonly fetcher: Fetcher;
  readonly repositories: Set<string>;
  readonly counts: { calls: number; publicBranchReads: number; unexpectedRequests: number };
}

export interface FixtureKeys {
  readonly jwk: string;
  readonly publicKey: string;
}

const headSha = "a".repeat(40);
const branchPath = /^\/repos\/(example\/qual-[a-z-]+)\/branches\/main$/u;
const userPath = /^\/user\/([0-9]+)$/u;
const issuesPath = /^\/repos\/(example\/qual-[a-z-]+)\/issues$/u;

/** @throws {never} */
export function githubFixture(actors: ReadonlyArray<FixtureActor>, token: string): GitHubFixture {
  const repositories = new Set<string>();
  const counts = { calls: 0, publicBranchReads: 0, unexpectedRequests: 0 };
  const refuse = (): Promise<Response> => {
    counts.unexpectedRequests += 1;
    return Promise.reject(new TypeError("Unexpected outbound request"));
  };
  const answer = (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin !== "https://api.github.com" || request.method !== "GET" || request.headers.get("authorization") !== `Bearer ${token}`) return refuse();
    counts.calls += 1;
    const branch = branchPath.exec(url.pathname);
    if (branch !== null && url.search === "") {
      if (!repositories.has(branch[1] ?? "")) return refuse();
      counts.publicBranchReads += 1;
      return Promise.resolve(Response.json({ commit: { sha: headSha } }));
    }
    const user = userPath.exec(url.pathname);
    if (user !== null && url.search === "") {
      const actor = actors.find((candidate) => candidate.id === user[1]);
      if (actor === undefined) return refuse();
      return Promise.resolve(Response.json({ id: Number(actor.id), login: actor.login, type: "User", created_at: "2020-01-01T00:00:00Z" }));
    }
    const issues = issuesPath.exec(url.pathname);
    const creator = actors.find((candidate) => candidate.login === url.searchParams.get("creator"));
    const exact = url.searchParams.get("state") === "closed" && url.searchParams.get("per_page") === "100" && url.searchParams.get("page") === "1" && [...url.searchParams].length === 4;
    if (issues === null || !repositories.has(issues[1] ?? "") || creator === undefined || !exact) return refuse();
    return Promise.resolve(Response.json([{ user: { id: Number(creator.id) }, pull_request: { merged_at: "2026-01-01T00:00:00Z" } }]));
  };
  return { fetcher: { fetch: answer }, repositories, counts };
}

/** @throws {never} */
export function templateAssets(templateSha256: string): Fetcher {
  return {
    fetch: (request) => Promise.resolve(new URL(request.url).pathname === "/skill-templates/index.json"
      ? Response.json({ templateSha256 })
      : Response.json({ error: "not_found" }, { status: 404 })),
  };
}

/** @throws {never} */
export function inProcess<Env>(site: { fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> }, env: Env): Fetcher {
  const context: ExecutionContext = { waitUntil: () => undefined };
  return { fetch: (request) => site.fetch(request, env, context) };
}

/** @throws {Error} */
export async function fixtureKeys(): Promise<FixtureKeys> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  if (!("privateKey" in pair)) throw new Error("Ed25519 generated no key pair");
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return { jwk: JSON.stringify({ kty: "OKP", crv: "Ed25519", d: jwk.d, x: jwk.x }), publicKey: btoa(String.fromCharCode(...raw)) };
}
