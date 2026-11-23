// spec/backend/accounts.md, "A web sign-in consumes one web assertion and opens a public membership"; spec/backend/identity.md, "At most one poll receives the flow's identity"
import { Cause, Context, Effect, Exit, Layer, type ManagedRuntime, Schema } from "effect";
import { Miniflare, Request, type Response } from "miniflare";
import type { SqlValue } from "../bindings.ts";
import { type Applied, type Bindings, type ExtraWorker, type QueueOutcome, type ScheduledOutcome, type WorkerOptions, bundle, migrate, queue, scheduled, workerOptions } from "../testing.ts";
import type { Internet } from "./internet.ts";
import { migrationsDir } from "./paths.ts";

export type AreaSource =
  | { readonly root: string; readonly entry?: string; readonly config?: string }
  | { readonly script: string }
  | { readonly module: string };

export type AreaWorker = Bindings & { readonly name: string } & AreaSource;

export interface IdentityOptions {
  readonly binding?: string;
  readonly origin?: string;
  readonly browserOrigin?: string;
  readonly audience?: string;
}

export type AreaOptions = AreaSource & Bindings & {
  readonly workers?: Readonly<Record<string, AreaWorker>>;
  readonly internet?: Internet;
  readonly migrate?: boolean;
  readonly origin?: string;
  readonly identity?: IdentityOptions;
  readonly compatibilityDate?: string;
};

const bindingCookieName = "__Host-slop_oauth_bind_";

export interface Session {
  readonly cookie: string;
  readonly actorId: string;
  readonly githubId: string;
  readonly login: string;
}

export interface Answer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface Ask {
  readonly method?: string;
  readonly json?: unknown;
  readonly body?: string | Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
  readonly as?: Session;
  readonly origin?: string | null;
}

interface Fetching {
  fetch(url: string, init?: { readonly method?: string; readonly headers?: Readonly<Record<string, string>>; readonly body?: string; readonly redirect?: "manual" }): Promise<Response>;
}

export type Rows = ReadonlyArray<Readonly<Record<string, unknown>>>;

export interface AreaShape {
  readonly origin: string;
  readonly applied: ReadonlyArray<Applied>;
  readonly outboundErrors: ReadonlyArray<string>;
  request(path: string, ask?: Ask): Effect.Effect<Answer>;
  post(path: string, body: unknown, options?: { readonly as?: Session }): Effect.Effect<Answer>;
  get(path: string, options?: { readonly as?: Session }): Effect.Effect<Answer>;
  sql(text: string, ...params: ReadonlyArray<SqlValue>): Effect.Effect<Rows>;
  scheduled(cron: string): Effect.Effect<ScheduledOutcome>;
  queue(name: string, bodies: ReadonlyArray<unknown>): Effect.Effect<QueueOutcome>;
  redeploy(changes: { readonly vars: Readonly<Record<string, string>> }): Effect.Effect<void>;
  signIn(githubId: string, login: string): Effect.Effect<Session>;
}

export class Area extends Context.Service<Area, AreaShape>()("@repo/platform/testing/Area") {}

const Started = Schema.Struct({ flowId: Schema.String, authorizationUrl: Schema.String, pollCapability: Schema.String, expiresAt: Schema.String, pollAfterSeconds: Schema.Number });
const Completed = Schema.Struct({ status: Schema.Literal("complete"), assertion: Schema.String });
const Joined = Schema.Struct({ actor: Schema.Struct({ id: Schema.String, login: Schema.String }) });
const Member = Schema.Array(Schema.Struct({ github_id: Schema.String }));

async function scriptOf(source: AreaSource): Promise<{ readonly script: string } | { readonly module: string }> {
  if ("root" in source) return { script: await bundle(source.root, { ...source.entry === undefined ? {} : { entry: source.entry }, ...source.config === undefined ? {} : { config: source.config } }) };
  return source;
}

function bindingsOf(options: Bindings): Bindings {
  const { d1, r2, vars, services, queues, ratelimits, email, durableObjects, assets } = options;
  return { d1, r2, vars, services, queues, ratelimits, email, durableObjects, assets };
}

async function answerOf(response: Response): Promise<Answer> {
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  return { status: response.status, headers: Object.fromEntries(response.headers), body: type.includes("json") && text !== "" ? JSON.parse(text) : text };
}

async function expect(step: string, response: Response, status: number): Promise<Response> {
  if (response.status === status) return response;
  throw new Error(`signIn: ${step} answered ${response.status} (expected ${status}): ${(await response.text()).slice(0, 300)}`);
}

function cookieOf(step: string, response: Response, name: string): string {
  const value = new RegExp(`${name}=([^;,\\s]+)`, "u").exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (value === undefined) throw new Error(`signIn: ${step} set no ${name} cookie`);
  return value;
}

function locationOf(step: string, response: Response): string {
  const location = response.headers.get("location");
  if (location === null) throw new Error(`signIn: ${step} redirected nowhere`);
  return location;
}

/** @throws {never} */
export function areaLayer(options: AreaOptions): Layer.Layer<Area> {
  const origin = options.origin ?? "https://slop.test";
  const identity = { binding: "SLOP_IDENTITY", origin: "https://identity.slop.test", audience: "slop-points-web", ...options.identity };
  const browserOrigin = identity.browserOrigin ?? identity.origin;
  return Layer.effect(Area, Effect.gen(function* () {
    const main = yield* Effect.promise(() => scriptOf(options));
    const extras = yield* Effect.promise(async () => Object.fromEntries(await Promise.all(Object.entries(options.workers ?? {}).map(async ([binding, extra]) =>
      [binding, { ...bindingsOf(extra), name: extra.name, ...await scriptOf(extra) } satisfies ExtraWorker] as const))));
    let current: WorkerOptions = {
      ...bindingsOf(options),
      ...main,
      workers: extras,
      ...options.internet === undefined ? {} : { outbound: options.internet.handler },
      ...options.compatibilityDate === undefined ? {} : { compatibilityDate: options.compatibilityDate },
    };
    const outboundErrors: string[] = [];
    const mf = yield* Effect.acquireRelease(Effect.sync(() => new Miniflare(workerOptions(current, outboundErrors))), (started) => Effect.promise(() => started.dispose()));
    const databases = new Map<string, string>();
    for (const [binding, name] of Object.entries(options.d1 ?? {})) if (!databases.has(name)) databases.set(name, binding);
    const applied = options.migrate === false ? [] : yield* Effect.promise(async () => {
      const all: Applied[] = [];
      for (const binding of databases.values()) all.push(...await migrate(mf, binding, migrationsDir));
      return all;
    });
    const failed = applied.find((file) => file.error !== undefined);
    if (failed !== undefined) return yield* Effect.die(new Error(`migration ${failed.file} failed: ${failed.error}`));
    const primary = Object.keys(options.d1 ?? {})[0];

    const rows = async (text: string, params: ReadonlyArray<SqlValue>): Promise<Rows> => {
      if (primary === undefined) throw new Error("the area has no D1 binding");
      const db = await mf.getD1Database(primary, "worker");
      return (await db.prepare(text).bind(...params).all()).results;
    };

    const send = async (path: string, ask: Ask = {}): Promise<Response> => {
      const method = ask.method ?? (ask.json === undefined && ask.body === undefined ? "GET" : "POST");
      const sentOrigin = ask.origin === undefined ? (method === "GET" || method === "HEAD" ? null : origin) : ask.origin;
      const headers: Record<string, string> = {
        ...sentOrigin === null ? {} : { origin: sentOrigin },
        ...ask.json === undefined ? {} : { "content-type": "application/json" },
        ...ask.as === undefined ? {} : { cookie: ask.as.cookie, "x-slop-expected-github-id": ask.as.githubId },
        ...ask.headers,
      };
      const body = ask.json === undefined ? ask.body : JSON.stringify(ask.json);
      return mf.dispatchFetch(`${origin}${path}`, { method, headers, redirect: "manual", ...body === undefined ? {} : { body } });
    };

    const signIn = async (githubId: string, login: string): Promise<Session> => {
      const bound = extras[identity.binding];
      if (bound === undefined) throw new Error(`signIn needs the identity Worker bound as ${identity.binding} in workers`);
      if (options.internet === undefined) throw new Error("signIn needs internet() with the GitHub fake");
      const worker = (await mf.getWorker(bound.name)) as unknown as Fetching;
      const json = (body: unknown, cookie?: string) => ({ method: "POST", headers: { "content-type": "application/json", origin: browserOrigin, ...cookie === undefined ? {} : { cookie } }, body: JSON.stringify(body) });
      const start = await expect("start", await worker.fetch(`${identity.origin}/v1/oauth/start`, json({ audience: identity.audience })), 201);
      const started = Schema.decodeUnknownSync(Started)(await start.json());
      const binding = `${bindingCookieName}${started.flowId}`;
      const browser = `${binding}=${cookieOf("start", start, binding)}`;
      const authorized = await expect("authorize", await worker.fetch(started.authorizationUrl, { headers: { cookie: browser }, redirect: "manual" }), 302);
      const state = cookieOf("authorize", authorized, "__Host-slop_oauth_state");
      const github = new URL(locationOf("authorize", authorized));
      github.searchParams.set("login", login);
      const consented = await expect("GitHub authorize", await options.internet.handler(new Request(github.toString(), { redirect: "manual" })), 302);
      await expect("callback", await worker.fetch(locationOf("GitHub authorize", consented), { headers: { cookie: `__Host-slop_oauth_state=${state}; ${browser}` }, redirect: "manual" }), 200);
      const polled = await expect("poll", await worker.fetch(`${identity.origin}/v1/oauth/poll`, json({ flowId: started.flowId, pollCapability: started.pollCapability, audience: identity.audience }, browser)), 200);
      const { assertion } = Schema.decodeUnknownSync(Completed)(await polled.json());
      const joined = await expect("join", await send("/api/v1/points/join", { json: { assertion, public: true } }), 200);
      const token = cookieOf("join", joined, "__Host-slop_points");
      const { actor } = Schema.decodeUnknownSync(Joined)(await joined.json());
      const [member] = Schema.decodeUnknownSync(Member)(await rows("SELECT github_id FROM points_members WHERE actor_id = ?", [actor.id]));
      if (actor.login !== login || member?.github_id !== githubId) throw new Error(`signIn: joined as ${actor.login} (${member?.github_id ?? "no member"}), not ${login} (${githubId})`);
      return { cookie: `__Host-slop_points=${token}`, actorId: actor.id, githubId, login };
    };

    return {
      origin,
      applied,
      outboundErrors,
      request: (path, ask) => Effect.promise(async () => answerOf(await send(path, ask))),
      post: (path: string, body: unknown, { as }: { readonly as?: Session } = {}) => Effect.promise(async () => answerOf(await send(path, { json: body, ...as === undefined ? {} : { as } }))),
      get: (path: string, { as }: { readonly as?: Session } = {}) => Effect.promise(async () => answerOf(await send(path, as === undefined ? {} : { as }))),
      sql: (text, ...params) => Effect.promise(() => rows(text, params)),
      scheduled: (cron) => Effect.promise(() => scheduled(mf, cron)),
      queue: (name, bodies) => Effect.promise(() => queue(mf, name, bodies)),
      redeploy: ({ vars }) => Effect.promise(async () => {
        current = { ...current, vars: { ...current.vars, ...vars } };
        await mf.setOptions(workerOptions(current, outboundErrors));
        await mf.ready;
      }),
      signIn: (githubId, login) => Effect.promise(() => signIn(githubId, login)),
    } satisfies AreaShape;
  }));
}

const refusals = new Set(["Rejected", "NotAnEvent"]);

function isRefusal(error: unknown): boolean {
  return typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string" && refusals.has(error._tag);
}

export function outcome<A, E>(effect: Effect.Effect<A, E>): Promise<"accepted" | "refused">;
export function outcome<A, E, R>(effect: Effect.Effect<A, E, R>, runtime: ManagedRuntime.ManagedRuntime<R, never>): Promise<"accepted" | "refused">;
export async function outcome<A, E, R>(effect: Effect.Effect<A, E, R>, runtime?: ManagedRuntime.ManagedRuntime<R, never>): Promise<"accepted" | "refused"> {
  const exit = runtime === undefined ? await Effect.runPromiseExit(effect as Effect.Effect<A, E>) : await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return "accepted";
  const error = Cause.squash(exit.cause);
  if (isRefusal(error)) return "refused";
  throw error;
}
