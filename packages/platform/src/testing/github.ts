// spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"; spec/contributor/artifactTransport.md, "Each request carries a credential only at the GitHub authority"
import { Response as WorkerResponse } from "miniflare";
import { Disconnect, type Handler } from "../testing.ts";
import { graphql } from "./github/graphql.ts";
import { Credentials, type Credential, type TokenScope, label, signAppJwt } from "./github/oauth.ts";
import { failure, installationJson, issueJson, pullJson, raw, repositoryJson, reply, rest, userJson, visibleTo } from "./github/rest.ts";
import { type Delivery, signedDelivery } from "./github/webhooks.ts";
import { type App, GitHubWorld } from "./github/world.ts";

export { GitHubWorld } from "./github/world.ts";
export type { Access, Account, Advisory, App, ChangedFile, Deployment, DeploymentStatus, Installation, Item, Permission, Permissions, Pull, Repository, WorkflowRun } from "./github/world.ts";
export { signature256 } from "./github/webhooks.ts";
export { reply } from "./github/rest.ts";

export interface GitHubFakeOptions {
  readonly authority?: string;
  readonly webAuthority?: string;
  readonly rawAuthority?: string;
  readonly appId?: string;
  readonly appSlug?: string;
  readonly appBotId?: number;
  readonly appPrivateKeyPem?: string;
  readonly webhookSecret?: string;
  readonly now?: () => number;
}

export type ScriptedFailure =
  | { readonly status: number; readonly message?: string; readonly applied?: boolean }
  | { readonly rateLimit: { readonly secondary: boolean; readonly retryAfterSeconds: number } }
  | { readonly disconnect: true; readonly applied?: boolean };

export interface GitHubRequest {
  readonly method: string;
  readonly url: string;
  readonly credential: string;
  readonly status: number | "disconnected";
}

export interface GitHubFake {
  readonly handler: Handler;
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly world: GitHubWorld;
  readonly app: App;
  readonly authority: string;
  readonly webAuthority: string;
  readonly requests: ReadonlyArray<GitHubRequest>;
  readonly tokens: {
    /** @throws {Error} */
    user(login: string): string;
    /** @throws {Error} */
    installation(id: number, scope?: TokenScope): string;
    /** @throws {Error} */
    app(claims?: { readonly issuedAt?: number; readonly expiresAt?: number; readonly issuer?: string }): string;
  };
  readonly represent: {
    user(login: string): unknown;
    repository(fullName: string): unknown;
    issue(fullName: string, number: number): unknown;
    pull(fullName: string, number: number): unknown;
    installation(id: number): unknown;
  };
  failNext(match: string | RegExp, failure: ScriptedFailure): void;
  alterNext(match: string | RegExp, alter: (response: Response) => Response | Promise<Response>): void;
  deliver(event: string, payload: object, delivery?: Delivery): Request;
}

type Resource = "core" | "search" | "graphql";

interface Bucket { readonly limit: number; used: number; resetAt: number }

interface Incoming { readonly method: string; readonly url: URL; readonly headers: Headers; readonly bytes: Uint8Array }

class Disconnected extends Disconnect {}

const statusText: Readonly<Record<number, string>> = { 401: "Bad credentials", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 422: "Validation Failed", 500: "Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" };

function matches(match: string | RegExp, method: string, url: URL): boolean {
  const target = `${method} ${url.pathname}${url.search}`;
  return typeof match === "string" ? target.includes(match) : match.test(target);
}

function take<T extends { readonly match: string | RegExp }>(queue: T[], method: string, url: URL): T | undefined {
  const index = queue.findIndex((entry) => matches(entry.match, method, url));
  return index === -1 ? undefined : queue.splice(index, 1)[0];
}

function parsedBody(bytes: Uint8Array): unknown {
  if (bytes.length === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function trimmed(origin: string): string {
  return origin.replace(/\/+$/u, "");
}

/** @throws {Error} */
export function githubFake(options: GitHubFakeOptions = {}): GitHubFake {
  const now = options.now ?? Date.now;
  const authority = trimmed(options.authority ?? "https://api.github.com");
  const webAuthority = trimmed(options.webAuthority ?? "https://github.com");
  const rawAuthority = trimmed(options.rawAuthority ?? "https://raw.githubusercontent.com");
  const api = new URL(authority), web = new URL(webAuthority), rawHost = new URL(rawAuthority);
  const prefix = api.pathname.replace(/\/+$/u, "");
  const world = new GitHubWorld(now);
  const app = world.addApp({
    id: options.appId ?? "1001",
    slug: options.appSlug ?? "slop-fake",
    botId: options.appBotId ?? 41_000_001,
    ...(options.appPrivateKeyPem === undefined ? {} : { privateKeyPem: options.appPrivateKeyPem }),
    ...(options.webhookSecret === undefined ? {} : { webhookSecret: options.webhookSecret }),
  });
  const credentials = new Credentials(world);
  const requests: GitHubRequest[] = [];
  const failures: Array<{ readonly match: string | RegExp; readonly failure: ScriptedFailure }> = [];
  const alterations: Array<{ readonly match: string | RegExp; readonly alter: (response: Response) => Response | Promise<Response> }> = [];
  const buckets = new Map<string, Bucket>();

  const bucket = (resource: Resource, credential: Credential): Bucket => {
    const key = `${resource}:${label(credential)}`;
    const window = resource === "search" ? 60_000 : 3_600_000;
    const found = buckets.get(key);
    if (found !== undefined && found.resetAt > now()) return found;
    const anonymous = credential.kind === "anonymous";
    const made = { limit: resource === "search" ? (anonymous ? 10 : 30) : anonymous ? 60 : 5000, used: 0, resetAt: now() + window };
    buckets.set(key, made);
    return made;
  };

  const limitHeaders = (resource: Resource, state: Bucket): Record<string, string> => ({
    "x-ratelimit-limit": String(state.limit),
    "x-ratelimit-remaining": String(Math.max(0, state.limit - state.used)),
    "x-ratelimit-used": String(state.used),
    "x-ratelimit-reset": String(Math.ceil(state.resetAt / 1000)),
    "x-ratelimit-resource": resource,
  });

  const exhausted = (resource: Resource, credential: Credential, resetAt: number): Response => {
    const headers = { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "0", "x-ratelimit-used": "5000", "x-ratelimit-reset": String(Math.ceil(resetAt / 1000)), "x-ratelimit-resource": resource };
    const message = `API rate limit exceeded for ${label(credential)}.`;
    return resource === "graphql"
      ? reply(200, { errors: [{ type: "RATE_LIMITED", message: `API rate limit already exceeded for ${label(credential)}.` }] }, headers)
      : failure(403, message, headers);
  };

  const scripted = (scriptedFailure: ScriptedFailure, resource: Resource, credential: Credential): Response => {
    if ("rateLimit" in scriptedFailure) {
      const { secondary, retryAfterSeconds } = scriptedFailure.rateLimit;
      if (!secondary) return exhausted(resource, credential, now() + retryAfterSeconds * 1000);
      return failure(403, "You have exceeded a secondary rate limit and have been temporarily blocked from content creation. Please retry your request again later.", { "retry-after": String(retryAfterSeconds) });
    }
    if ("disconnect" in scriptedFailure) throw new Disconnected("fetch failed");
    return failure(scriptedFailure.status, scriptedFailure.message ?? statusText[scriptedFailure.status] ?? "Fake failure");
  };

  const apiAnswer = async (incoming: Incoming, credential: Credential, path: string): Promise<Response> => {
    const url = new URL(incoming.url);
    url.pathname = path;
    if (credential.kind === "installation" && credential.installation.suspendedAt !== null) return failure(403, "This installation has been suspended");
    if (incoming.method === "GET" && path === "/rate_limit") {
      const view = (resource: Resource) => {
        const state = bucket(resource, credential);
        return { limit: state.limit, used: state.used, remaining: state.limit - state.used, reset: Math.ceil(state.resetAt / 1000) };
      };
      return reply(200, { resources: { core: view("core"), search: view("search"), graphql: view("graphql") }, rate: view("core") });
    }
    const resource: Resource = path === "/graphql" ? "graphql" : path.startsWith("/search/") ? "search" : "core";
    if (resource === "graphql" && (credential.kind === "anonymous" || credential.kind === "app")) return failure(401, "This endpoint requires you to be authenticated.");
    const state = bucket(resource, credential);
    if (state.used >= state.limit) return exhausted(resource, credential, state.resetAt);
    state.used += 1;
    const headers = limitHeaders(resource, state);
    const answer = resource === "graphql" && incoming.method === "POST"
      ? reply(200, graphql(parsedBody(incoming.bytes), {
        world,
        viewer: credential.kind === "user" ? credential.account : undefined,
        visible: visibleTo(world, credential),
        rateLimit: { cost: 1, limit: state.limit, remaining: state.limit - state.used, used: state.used, resetAt: new Date(state.resetAt).toISOString().replace(/\.\d{3}Z$/u, "Z") },
      }))
      : await rest({ world, credentials, credential, method: incoming.method, url, accept: incoming.headers.get("accept") ?? "", authority, body: parsedBody(incoming.bytes) });
    for (const [name, value] of Object.entries(headers)) answer.headers.set(name, value);
    return answer;
  };

  const answer = async (incoming: Incoming): Promise<{ readonly response: Response; readonly credential: string }> => {
    const { url, method } = incoming;
    if (url.origin === web.origin && url.pathname.startsWith("/login/oauth/")) {
      if (method === "GET" && url.pathname === "/login/oauth/authorize") return { response: credentials.authorize(url), credential: "browser" };
      if (method === "POST" && url.pathname === "/login/oauth/access_token") {
        const json = parsedBody(incoming.bytes);
        const form = typeof json === "object" && json !== null ? new URLSearchParams(Object.entries(json).map(([key, value]) => [key, String(value)])) : new URLSearchParams(new TextDecoder().decode(incoming.bytes));
        return { response: credentials.exchange(form, (incoming.headers.get("accept") ?? "").includes("json")), credential: "oauth-client" };
      }
      return { response: failure(404, "Not Found"), credential: "browser" };
    }
    if (url.origin === rawHost.origin && url.origin !== api.origin) return { response: raw(world, url), credential: "anonymous" };
    if (url.origin !== api.origin || !url.pathname.startsWith(prefix)) return { response: new Response(`the GitHub fake does not answer ${url.origin}`, { status: 599 }), credential: "anonymous" };
    const authenticated = credentials.authenticate(incoming.headers.get("authorization"));
    if ("refused" in authenticated) return { response: failure(401, authenticated.refused), credential: "invalid" };
    return { response: await apiAnswer(incoming, authenticated.credential, url.pathname.slice(prefix.length) || "/"), credential: label(authenticated.credential) };
  };

  const refusedWith = (scriptedFailure: ScriptedFailure, incoming: Incoming) => {
    const authenticated = credentials.authenticate(incoming.headers.get("authorization"));
    const credential: Credential = "credential" in authenticated ? authenticated.credential : { kind: "anonymous" };
    const path = incoming.url.pathname;
    return { response: scripted(scriptedFailure, path.endsWith("/graphql") ? "graphql" : path.includes("/search/") ? "search" : "core", credential), credential: label(credential) };
  };

  const serve = async (incoming: Incoming): Promise<Response> => {
    const { method, url } = incoming;
    const entry = { method, url: url.href };
    const failed = take(failures, method, url);
    try {
      if (failed !== undefined && !("rateLimit" in failed.failure) && failed.failure.applied === true) await answer(incoming);
      const outcome = failed === undefined ? await answer(incoming) : refusedWith(failed.failure, incoming);
      const altered = take(alterations, method, url);
      const response = altered === undefined ? outcome.response : await altered.alter(outcome.response);
      requests.push({ ...entry, credential: outcome.credential, status: response.status });
      return response;
    } catch (error) {
      if (error instanceof Disconnected) requests.push({ ...entry, credential: "unknown", status: "disconnected" });
      throw error;
    }
  };

  const incoming = async (request: { readonly method: string; readonly url: string; readonly headers: Headers | Iterable<[string, string]>; arrayBuffer(): Promise<ArrayBuffer> }): Promise<Incoming> => ({
    method: request.method.toUpperCase(),
    url: new URL(request.url),
    headers: new Headers([...request.headers]),
    bytes: new Uint8Array(await request.arrayBuffer()),
  });

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    try {
      return await serve(await incoming(request));
    } catch (error) {
      if (error instanceof Disconnected) throw new TypeError("fetch failed", { cause: error });
      throw error;
    }
  };

  const handler: Handler = async (request) => {
    const response = await serve(await incoming({ method: request.method, url: request.url, headers: [...request.headers], arrayBuffer: () => request.arrayBuffer() }));
    const body = response.status === 204 || response.status === 304 || response.body === null ? null : new Uint8Array(await response.arrayBuffer());
    return new WorkerResponse(body, { status: response.status, headers: [...response.headers] });
  };

  const nowSeconds = () => Math.floor(now() / 1000);
  const required = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`the GitHub fake has no ${what}`);
    return value;
  };

  return {
    handler,
    fetch,
    world,
    app,
    authority,
    webAuthority,
    requests,
    tokens: {
      user: (login) => credentials.user(world.account(login)),
      installation: (id, scope = {}) => {
        const installation = required(world.installation(id), `installation ${id}`);
        const granted = credentials.scope(installation, scope);
        if (typeof granted === "string") throw new Error(granted);
        return credentials.installation(installation, granted).token;
      },
      app: (claims = {}) => signAppJwt(app, { issuedAt: claims.issuedAt ?? nowSeconds() - 60, expiresAt: claims.expiresAt ?? nowSeconds() + 540, ...(claims.issuer === undefined ? {} : { issuer: claims.issuer }) }),
    },
    represent: {
      user: (login) => userJson(authority, world.account(login), true),
      repository: (fullName) => repositoryJson(authority, world.repo(fullName)),
      issue: (fullName, number) => issueJson(authority, world, world.item(fullName, number)),
      pull: (fullName, number) => pullJson(authority, world, world.pull(fullName, number)),
      installation: (id) => installationJson(authority, required(world.installation(id), `installation ${id}`)),
    },
    failNext: (match, scriptedFailure) => {
      failures.push({ match, failure: scriptedFailure });
    },
    alterNext: (match, alter) => {
      alterations.push({ match, alter });
    },
    deliver: (event, payload, delivery = {}) => signedDelivery(app, event, payload, delivery),
  };
}
