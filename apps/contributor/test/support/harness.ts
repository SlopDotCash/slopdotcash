// spec/contributor/sessionExchange.md, "Assertion consumption survives signing errors and a lost session reply"; spec/contributor/traceServer.md, "The clock, private-intake observation and ban state come from their owning services"
import { Schema } from "effect";
import { Request, type Response } from "miniflare";
import { type StartedWorker, type WorkerOptions, bundle, database, migrate, startWorker, storage, workerOptions } from "@repo/platform/testing";
import { githubFake } from "@repo/platform/testing/github";
import { internet } from "@repo/platform/testing/internet";
import { migrationsDir } from "@repo/platform/testing/paths";

export const origin = "https://slop.test";
export const author = { githubId: "7101", login: "trace-author" } as const;
export const other = { githubId: "7102", login: "trace-other" } as const;

const identityOrigin = "https://identity.slop.test";
const root = new URL("../..", import.meta.url).pathname;
const backendRoot = new URL("../../../backend", import.meta.url).pathname;

export interface Answer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface Call {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly body?: string | Uint8Array;
}

export type Rows = ReadonlyArray<Readonly<Record<string, unknown>>>;

export interface Site {
  call(path: string, call?: Call): Promise<Answer>;
  assertion(login: string, audience?: string): Promise<string>;
  rows(text: string, ...params: ReadonlyArray<string | number | null>): Promise<Rows>;
  stored(key: string): Promise<boolean>;
  place(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  redeploy(vars: Readonly<Record<string, string>>): Promise<void>;
  dispose(): Promise<void>;
}

interface Fetching {
  fetch(url: string, init?: { readonly method?: string; readonly headers?: Readonly<Record<string, string>>; readonly body?: string; readonly redirect?: "manual" }): Promise<Response>;
}

interface Removing {
  delete(key: string): Promise<void>;
}

const Flow = Schema.Struct({ flowId: Schema.String, authorizationUrl: Schema.String, pollCapability: Schema.String });
const Issued = Schema.Struct({ status: Schema.Literal("complete"), assertion: Schema.String });

async function expected(step: string, response: Response, status: number): Promise<Response> {
  if (response.status === status) return response;
  throw new Error(`identity ${step} answered ${response.status} (expected ${status}): ${(await response.text()).slice(0, 300)}`);
}

function located(step: string, response: Response): string {
  const location = response.headers.get("location");
  if (location === null) throw new Error(`identity ${step} redirected nowhere`);
  return location;
}

async function answerOf(response: Response): Promise<Answer> {
  const text = await response.text();
  const json = (response.headers.get("content-type") ?? "").includes("json") && text !== "";
  return { status: response.status, headers: Object.fromEntries(response.headers), body: json ? JSON.parse(text) : text };
}

/** @throws {never} */
export async function startSite(assets: string): Promise<Site> {
  const github = githubFake();
  github.world.addUser({ id: Number(author.githubId), login: author.login, nodeId: "U_trace_author" });
  github.world.addUser({ id: Number(other.githubId), login: other.login, nodeId: "U_trace_other" });
  const net = internet({ github: github.handler });
  let options: WorkerOptions = {
    script: await bundle(root, { config: "test/support/vite.config.ts", entry: "contributor" }),
    d1: { SLOP_DB: "slop-private" },
    r2: ["PRIVATE_TRACES"],
    assets,
    vars: {
      SLOP_ENVIRONMENT: "local",
      TRACE_AUTH_SECRET: "trace-auth-secret-for-the-trace-journey-0001",
      ADMIN_GITHUB_IDS: "",
      PROJECT_MODERATOR_GITHUB_IDS: "",
      OPERATOR_GITHUB_IDS: "",
    },
    outbound: net.handler,
    workers: {
      SLOP_IDENTITY: {
        name: "identity",
        script: await bundle(backendRoot, { entry: "identity" }),
        d1: { IDENTITY_DB: "slop-private" },
        ratelimits: { IDENTITY_START_LIMITER: { limit: 60, period: 60 }, IDENTITY_POLL_LIMITER: { limit: 600, period: 60 } },
        vars: {
          SLOP_ENVIRONMENT: "local",
          GITHUB_APP_CLIENT_ID: github.app.clientId,
          GITHUB_APP_CLIENT_SECRET: github.app.clientSecret,
          IDENTITY_STATE_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
          IDENTITY_ASSERTION_KEY: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
        },
      },
    },
  };
  const mf: StartedWorker = startWorker(options);
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);

  const assertion = async (login: string, audience = "private-trace-api") => {
    const identity = (await mf.getWorker("identity")) as unknown as Fetching;
    const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const flow = Schema.decodeUnknownSync(Flow)(await (await expected("start", await identity.fetch(`${identityOrigin}/v1/oauth/start`, post({ audience })), 201)).json());
    const authorized = await expected("authorize", await identity.fetch(flow.authorizationUrl, { redirect: "manual" }), 302);
    const state = /__Host-slop_oauth_state=([^;,\s]+)/u.exec(authorized.headers.get("set-cookie") ?? "")?.[1];
    if (state === undefined) throw new Error("identity authorize set no state cookie");
    const consent = new URL(located("authorize", authorized));
    consent.searchParams.set("login", login);
    const consented = await expected("GitHub authorize", await net.handler(new Request(consent.toString(), { redirect: "manual" })), 302);
    await expected("callback", await identity.fetch(located("GitHub authorize", consented), { headers: { cookie: `__Host-slop_oauth_state=${state}` }, redirect: "manual" }), 200);
    const polled = await expected("poll", await identity.fetch(`${identityOrigin}/v1/oauth/poll`, post({ flowId: flow.flowId, pollCapability: flow.pollCapability, audience })), 200);
    return Schema.decodeUnknownSync(Issued)(await polled.json()).assertion;
  };

  return {
    call: async (path, call = {}) => {
      const method = call.method ?? (call.json === undefined && call.body === undefined ? "GET" : "POST");
      const headers = { ...call.json === undefined ? {} : { "content-type": "application/json" }, ...call.headers };
      const body = call.json === undefined ? call.body : JSON.stringify(call.json);
      return answerOf(await mf.dispatchFetch(`${origin}${path}`, { method, headers, redirect: "manual", ...body === undefined ? {} : { body } }));
    },
    assertion,
    rows: async (text, ...params) => (await (await database(mf, "SLOP_DB")).prepare(text).bind(...params).all()).results,
    stored: async (key) => (await (await storage(mf, "PRIVATE_TRACES")).head(key)) !== null,
    place: async (key, bytes) => {
      await (await storage(mf, "PRIVATE_TRACES")).put(key, bytes);
    },
    remove: async (key) => {
      await ((await mf.getR2Bucket("PRIVATE_TRACES")) as unknown as Removing).delete(key);
    },
    redeploy: async (vars) => {
      options = { ...options, vars: { ...options.vars, ...vars } };
      await mf.setOptions(workerOptions(options, []));
      await mf.ready;
    },
    dispose: () => mf.dispose(),
  };
}
