import { createHash } from "node:crypto";
import { Cause, type Effect, Exit, Layer, ManagedRuntime, Redacted } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/backend__identity.conformance.ts";
import type { Assertion, Audience, Event, Flow, FlowMode, FlowStatus, Identity, RateScope, RateWindow } from "../../gen/backend__identity.ts";
import { identitySettings } from "../../src/identity/config.vibe";
import type { FlowSecrets } from "../../src/identity/pkce.vibe";
import { windowKey } from "../../src/identity/rateWindow.vibe";
import { type PollFacts, type PollStep, claimCallback, completeCallback, consume, failCallback, issueAssertion, pollAs, purge, refuseOriginRequired, refuseRateLimited, start } from "../../src/identity/store.vibe";

type View = Pick<Identity, "now" | "flows" | "assertions" | "windows">;

const base = 1_800_000_000;
const workerClock = -2;
const stateKey = Buffer.alloc(32, 1).toString("base64url");
const sentinelId = "flow_sentinel_conformance_0000";
const sentinelState = "sentinel".padEnd(43, "S");
const unknownToken = `slop_assert_v1_${"U".repeat(43)}`;
const scopes: ReadonlyArray<[RateScope, string]> = [["StartScope", "oauth-start"], ["PollScope", "oauth-poll"]];
const clients = [1, 2];

const mf = startWorker({ d1: { IDENTITY_DB: "identity-conformance" } });
const failed = (await migrate(mf, "IDENTITY_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "IDENTITY_DB");
const clock = settableClock(base * 1000);
const settings = Layer.orDie(identitySettings({
  SLOP_ENVIRONMENT: "local",
  GITHUB_APP_CLIENT_ID: "Iv1.conformance",
  GITHUB_APP_CLIENT_SECRET: "conformance-client-secret",
  IDENTITY_STATE_KEY: stateKey,
  IDENTITY_ASSERTION_KEY: Buffer.alloc(32, 2).toString("base64url"),
}));
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, settings, clock.layer));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const principal = (client: number) => `conformance-client-${client}`;
const windowOf = new Map<string, { readonly client: number; readonly scope: RateScope }>();
const keyOf = new Map<string, string>();
for (const client of clients) {
  for (const [scope, name] of scopes) {
    const key = await runtime.runPromise(windowKey(Redacted.make(stateKey), name, principal(client)));
    windowOf.set(key, { client, scope });
    keyOf.set(`${client}:${scope}`, key);
  }
}

let generation = 0;
let now = 0;
let lastFlow = 0;
let storageFailures = 0;
let windowOrder: string[] = [];
const realFlow = new Map<number, string>();
const modelFlow = new Map<string, number>();
const tokens = new Map<number, string>();
const pendingTokens = new Map<number, string>();
const modelToken = new Map<string, number>();

const text = (prefix: string, length: number) => `g${generation}${prefix}`.padEnd(length, "A");
const stateOf = (id: number) => text(`s${id}`, 43);
const capabilityOf = (id: number) => text(`c${id}`, 43);
const flowIdOf = (id: number, mode: FlowMode) => mode === "LocalHandoff" ? `flow_local_i_4466_${text(`n${id}`, 32)}` : `flow_${text(`n${id}`, 30)}`;
const bindingOf = (id: number) => text(`b${id}`, 43);
const website = (audience: Audience, mode: FlowMode) => audience === "PointsWeb" && mode === "Production";
const secretsOf = (flowId: string, id: number): FlowSecrets => ({ flowId, state: stateOf(id), capability: capabilityOf(id), verifier: text(`v${id}`, 86) });
const knownFlow = (id: number) => realFlow.get(id) ?? flowIdOf(id, "Production");
const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000) - base;
const nodeOf = (nodeId: unknown) => typeof nodeId === "string" ? Number(nodeId.replace("U_node", "")) : 0;
const audienceOf = (wire: unknown): Audience => wire === "slop-points-web" ? "PointsWeb" : "PrivateTrace";
const statuses: Readonly<Record<string, FlowStatus>> = {
  pending: "Pending",
  callback_processing: "CallbackProcessing",
  callback_complete: "CallbackComplete",
  assertion_issued: "AssertionIssued",
  callback_failed: "CallbackFailed",
};

function statusOf(wire: unknown): FlowStatus {
  const status = statuses[String(wire)];
  if (status === undefined) throw new Error(`flow status ${String(wire)} is not one the spec has`);
  return status;
}

function counted(client: number, scope: RateScope) {
  const key = keyOf.get(`${client}:${scope}`);
  if (key === undefined) throw new Error(`no rate window key for client ${client}`);
  windowOrder = [...windowOrder.filter((found) => found !== key), key];
}

async function settle<A>(effect: Effect.Effect<A, unknown, Services>, refusals: ReadonlyArray<string>): Promise<{ readonly outcome: "accepted"; readonly value: A } | { readonly outcome: "refused"; readonly tag: string }> {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return { outcome: "accepted", value: exit.value };
  const error = Cause.squash(exit.cause);
  const tag = typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string" ? error._tag : "";
  if (refusals.includes(tag)) return { outcome: "refused", tag };
  throw error;
}

const modelRefusals = ["Rejected", "OverLimit"];

async function accepted<A>(effect: Effect.Effect<A, unknown, Services>) {
  return (await settle(effect, modelRefusals)).outcome;
}

function pollFacts(flowId: number, capability: number, audience: Audience, localRoute: boolean, binding: boolean): PollFacts {
  return { flowId: knownFlow(flowId), capability: capabilityOf(capability), audience, localRoute, binding };
}

async function polled(step: PollStep, client: number, facts: PollFacts, flowId: number) {
  const result = await settle(pollAs(step, principal(client), facts), modelRefusals);
  if (result.outcome === "refused") return result.outcome;
  counted(client, "PollScope");
  if (result.value.kind === "storeAssertion") {
    modelToken.set(digest(result.value.token), flowId);
    pendingTokens.set(flowId, result.value.token);
  }
  return result.outcome;
}

async function dispatch(event: Event, by: number) {
  switch (event.type) {
    case "start": {
      const id = lastFlow + 1;
      const flowId = flowIdOf(id, event.mode);
      const binding = website(event.audience, event.mode) ? bindingOf(id) : undefined;
      const outcome = await accepted(start(principal(event.client), { audience: event.audience, mode: event.mode, origin: event.origin, binding }, secretsOf(flowId, id)));
      if (outcome === "accepted") {
        lastFlow = id;
        realFlow.set(id, flowId);
        modelFlow.set(flowId, id);
        counted(event.client, "StartScope");
      }
      return outcome;
    }
    case "startStorageFailed": {
      storageFailures += 1;
      const flowId = `flow_${text(`f${storageFailures}`, 30)}`;
      const result = await settle(start(principal(event.client), { audience: "PointsWeb", mode: "Production", origin: true, binding: bindingOf(0) }, { ...secretsOf(flowId, 0), state: sentinelState }), [...modelRefusals, "FlowNotStored"]);
      if (result.outcome === "accepted") throw new Error("a start whose state collides with a stored flow was stored");
      if (result.tag !== "FlowNotStored") return "refused";
      counted(event.client, "StartScope");
      return "accepted";
    }
    case "refuseOriginRequired": {
      const outcome = await accepted(refuseOriginRequired(principal(event.client)));
      if (outcome === "accepted") counted(event.client, "StartScope");
      return outcome;
    }
    case "refuseRateLimited": {
      const outcome = await accepted(refuseRateLimited(event.scope, principal(event.client)));
      if (outcome === "accepted") counted(event.client, event.scope);
      return outcome;
    }
    case "claimCallback":
      return accepted(claimCallback(stateOf(event.oauthState), stateOf(event.cookie)));
    case "completeCallback":
      return accepted(completeCallback(by, knownFlow(event.flowId), { actorId: String(event.github.actor), login: event.github.login, nodeId: event.github.nodeId > 0 ? `U_node${event.github.nodeId}` : undefined }));
    case "failCallback":
      return accepted(failCallback(by, knownFlow(event.flowId)));
    case "issueAssertion": {
      const outcome = await accepted(issueAssertion(pollFacts(event.flowId, event.capability, event.audience, false, event.binding)));
      const token = pendingTokens.get(event.flowId);
      if (outcome === "accepted" && token !== undefined) tokens.set(event.flowId, token);
      return outcome;
    }
    case "pollAnswered":
      return polled("pollAnswered", event.client, pollFacts(event.flowId, event.capability, event.audience, event.localRoute, event.binding), event.flowId);
    case "storeAssertion":
      return polled("storeAssertion", event.client, pollFacts(event.flowId, event.capability, event.audience, false, event.binding), event.flowId);
    case "pollLocal":
      return polled("pollLocal", event.client, pollFacts(event.flowId, event.capability, "PointsWeb", true, false), event.flowId);
    case "consume":
      return accepted(consume(tokens.get(event.token) ?? unknownToken, event.audience));
    case "advanceTime": {
      if (by !== workerClock || event.now < now) return "refused";
      now = event.now;
      clock.set((base + now) * 1000);
      return "accepted";
    }
    case "purgeExpired":
      return accepted(purge(by));
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

async function rows(query: string) {
  return (await db.prepare(query).all()).results;
}

async function observe(): Promise<View> {
  const flows = (await rows("SELECT * FROM identity_oauth_flows ORDER BY rowid")).filter((row) => row.id !== sentinelId).map((row): Flow => {
    const id = modelFlow.get(String(row.id));
    if (id === undefined) throw new Error(`flow ${String(row.id)} was not started by this walk`);
    return {
      id,
      oauthState: id,
      capability: id,
      audience: audienceOf(row.audience),
      mode: String(row.id).startsWith("flow_local_") ? "LocalHandoff" : "Production",
      status: statusOf(row.status),
      pkceStored: row.encrypted_pkce_verifier !== null,
      github: { actor: Number(row.github_actor_id ?? 0), login: typeof row.github_login === "string" ? row.github_login : "", nodeId: nodeOf(row.github_node_id) },
      createdAt: seconds(String(row.created_at)),
      expiresAt: seconds(String(row.expires_at)),
      bound: row.browser_binding_hash === digest(bindingOf(id)),
    };
  });
  const assertions = (await rows("SELECT * FROM identity_assertions ORDER BY rowid")).map((row): Assertion => {
    const token = modelToken.get(String(row.token_hash));
    if (token === undefined) throw new Error("an assertion was stored that this walk did not ask for");
    return {
      token,
      audience: audienceOf(row.audience),
      github: { actor: Number(row.github_actor_id), login: String(row.github_login), nodeId: nodeOf(row.github_node_id) },
      createdAt: seconds(String(row.created_at)),
      expiresAt: seconds(String(row.expires_at)),
      consumed: row.consumed_at !== null,
      consumedAt: typeof row.consumed_at === "string" ? seconds(row.consumed_at) : 0,
    };
  });
  const windows = (await rows("SELECT key_hash, request_count, expires_at FROM identity_rate_limits")).flatMap((row): RateWindow[] => {
    const owner = windowOf.get(String(row.key_hash));
    return owner === undefined ? [] : [{ client: owner.client, scope: owner.scope, count: Number(row.request_count), expiresAt: Number(row.expires_at) - base }];
  }).sort((left, right) => windowOrder.indexOf(keyOf.get(`${left.client}:${left.scope}`) ?? "") - windowOrder.indexOf(keyOf.get(`${right.client}:${right.scope}`) ?? ""));
  return { now, flows, assertions, windows };
}

async function reset() {
  generation += 1;
  now = 0;
  lastFlow = 0;
  storageFailures = 0;
  realFlow.clear();
  modelFlow.clear();
  tokens.clear();
  pendingTokens.clear();
  modelToken.clear();
  clock.set(base * 1000);
  const start = keyOf.get("2:StartScope") ?? "";
  const poll = keyOf.get("2:PollScope") ?? "";
  windowOrder = [start, poll];
  await db.batch([
    db.prepare("DELETE FROM identity_oauth_flows"),
    db.prepare("DELETE FROM identity_assertions"),
    db.prepare("DELETE FROM identity_rate_limits"),
    db.prepare("INSERT INTO identity_oauth_flows (id, state_hash, poll_capability_hash, audience, status, created_at, expires_at) VALUES (?, ?, ?, 'slop-points-web', 'callback_failed', '9999-12-31T23:55:00.000Z', '9999-12-31T23:59:59.000Z')").bind(sentinelId, digest(sentinelState), digest(`${sentinelState}-capability`)),
    db.prepare("INSERT INTO identity_rate_limits (key_hash, request_count, window_started_at, expires_at) VALUES (?, 12, ?, ?), (?, 120, ?, ?)").bind(start, base, base + 60, poll, base, base + 60),
  ]);
}

export const driver: Driver<View> & AsyncDisposable = {
  reset,
  dispatch: (_key, event, by) => dispatch(event, Number(by)),
  observe: () => observe(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<View> = {
  keys: ["identity"],
  view: (state) => ({ now: state.now, flows: state.flows, assertions: state.assertions, windows: state.windows }),
  walks: 3,
  steps: 10,
};
