// spec/backend/accounts.md, "Every account outcome is reachable from the launch state"
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Redacted } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/backend__accounts.conformance.ts";
import type { Accounts, Event } from "../../gen/backend__accounts.ts";
import type { Audience } from "../../gen/backend__identity.ts";
import type { Facts } from "../../src/accounts/store/codec.vibe";
import { type Intent, type Sender, type Settled, everyAccount, send } from "../../src/accounts/store/store.vibe";
import { identitySettings } from "../../src/identity/config.vibe";
import { assertionToken } from "../../src/identity/pkce.vibe";
import { type PollFacts, claimCallback, completeCallback, consume, failCallback, issueAssertion, pollAs, purge, start } from "../../src/identity/store.vibe";

const launchClock = 1794614400;
const participationPointsEnd = 1792800000;
const flowLifetime = 300;
const assertionLifetime = 90;
const workerClock = -2;
const assertionKey = Buffer.alloc(32, 2).toString("base64url");
const unknownToken = `slop_assert_v1_${"U".repeat(43)}`;
const refusals = ["Rejected", "OverLimit", "EmailUnavailable"];
const wireAudience: Readonly<Record<Audience, string>> = { PointsWeb: "slop-points-web", PrivateTrace: "private-trace-api" };
const audienceOf: Readonly<Record<string, string>> = { "slop-points-web": "PointsWeb", "private-trace-api": "PrivateTrace" };
const statusOf: Readonly<Record<string, string>> = {
  pending: "Pending",
  callback_processing: "CallbackProcessing",
  callback_complete: "CallbackComplete",
  assertion_issued: "AssertionIssued",
  callback_failed: "CallbackFailed",
};
const launchFlows: ReadonlyArray<{ readonly github: number; readonly login: string; readonly node: number; readonly audience: Audience }> = [
  { github: 11, login: "octo", node: 1102, audience: "PointsWeb" },
  { github: 22, login: "newcomer", node: 2201, audience: "PointsWeb" },
  { github: 11, login: "octo", node: 1102, audience: "PointsWeb" },
  { github: 22, login: "newcomer", node: 2201, audience: "PrivateTrace" },
];

const mf = startWorker({ d1: { SLOP_DB: "accounts-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const clock = settableClock(launchClock * 1000);
const settings = Layer.orDie(identitySettings({
  SLOP_ENVIRONMENT: "local",
  GITHUB_APP_CLIENT_ID: "Iv1.conformance",
  GITHUB_APP_CLIENT_SECRET: "conformance-client-secret",
  IDENTITY_STATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
  IDENTITY_ASSERTION_KEY: assertionKey,
}));
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, settings, clock.layer));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

let generation = 0;
let world = fresh();

function fresh() {
  return {
    sessions: new Map<number, string>(),
    flows: new Map<number, { state: string; browser: string }>(),
    verifications: new Map<number, { id: string; token: string }>(),
    versions: new Map<number, string>([[900, hex()]]),
    unsubscribes: new Map<number, string>(),
    identityFlows: new Map<number, string>(),
    assertions: new Map<number, string>(),
    lastSession: 0,
    lastFlow: 0,
    lastEmailId: 0,
    lastVersion: 1000,
    lastUnsubscribe: 0,
    lastIdentityFlow: launchFlows.length,
  };
}

function hex() {
  return randomBytes(32).toString("hex");
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const suffix = () => `-g${generation}`;
const githubOf = (model: number) => model > 0 ? String(1_000_000_000 + generation * 1000 + model) : String(model);
const actorOf = (model: number) => `n${model}${suffix()}`;
const loginOf = (model: string) => model === "" ? "" : `${model}${suffix()}`;
const xIdOf = (model: string) => model === "" ? "" : `${generation}x${model}`;
const plainLogin = (real: string) => real.endsWith(suffix()) ? real.slice(0, -suffix().length) : real;
const plainXId = (real: string) => real.startsWith(`${generation}x`) ? real.slice(`${generation}x`.length) : real;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const text = (prefix: string, length: number) => `g${generation}${prefix}`.padEnd(length, "A");
const stateOf = (id: number) => text(`s${id}`, 43);
const capabilityOf = (id: number) => text(`c${id}`, 43);
const flowIdOf = (id: number) => `flow_${text(`n${id}`, 30)}`;
const knownFlow = (id: number) => world.identityFlows.get(id) ?? flowIdOf(id);
const principal = (client: number) => `accounts-conformance-client-${client}`;
const senderNumber = (by: unknown) => typeof by === "number" ? by : 0;
const session = (by: unknown): Sender => ({ kind: "session", hash: typeof by === "number" && by > 0 ? world.sessions.get(by) ?? hex() : "" });
const service = (by: unknown): Sender => ({ kind: "service", id: senderNumber(by) });

const facts = (): Facts => ({ xConfigured: true, mailAvailable: true, pilot: { githubId: githubOf(11), version: world.versions.get(900) ?? "" }, assertion: undefined, ownerSession: githubOf(22) });

async function seed() {
  const legacy = actorOf(1101);
  const xId = xIdOf("123456789012345678901234567890");
  const at = iso(participationPointsEnd - 900);
  const launched = iso(launchClock);
  const flows = await Promise.all(launchFlows.map(async (flow, index) => {
    const id = index + 1;
    const flowId = flowIdOf(id);
    const token = await runtime.runPromise(assertionToken(Redacted.make(assertionKey), flowId, capabilityOf(id), githubOf(flow.github)));
    world.identityFlows.set(id, flowId);
    world.assertions.set(id, token);
    return [
      db.prepare("INSERT INTO identity_oauth_flows (id, state_hash, poll_capability_hash, audience, status, github_actor_id, github_login, github_node_id, created_at, expires_at, callback_completed_at, assertion_issued_at) VALUES (?, ?, ?, ?, 'assertion_issued', ?, ?, ?, ?, ?, ?, ?)")
        .bind(flowId, digest(stateOf(id)), digest(capabilityOf(id)), wireAudience[flow.audience], githubOf(flow.github), loginOf(flow.login), actorOf(flow.node), launched, iso(launchClock + flowLifetime), launched, launched),
      db.prepare("INSERT INTO identity_assertions (token_hash, github_actor_id, github_login, audience, created_at, expires_at, consumed_at, github_node_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
        .bind(digest(token), githubOf(flow.github), loginOf(flow.login), wireAudience[flow.audience], launched, iso(launchClock + assertionLifetime), actorOf(flow.node)),
    ];
  }));
  await db.batch([
    db.prepare("DELETE FROM points_sessions"),
    db.prepare("DELETE FROM points_x_flows"),
    db.prepare("DELETE FROM points_telegram_flows"),
    db.prepare("DELETE FROM identity_oauth_flows"),
    db.prepare("DELETE FROM identity_assertions"),
    db.prepare("DELETE FROM identity_rate_limits"),
    db.prepare("INSERT INTO points_members (actor_id, github_id, login, joined_at, public, welcome) VALUES (?, ?, ?, ?, 0, 5)").bind(legacy, githubOf(11), loginOf("octo"), iso(participationPointsEnd - 1000)),
    db.prepare("INSERT INTO points_x_claims (x_id, actor_id, claimed_at) VALUES (?, ?, ?)").bind(xId, legacy, at),
    db.prepare("INSERT INTO points_x_links (actor_id, x_id, username, verified_at, public) VALUES (?, ?, ?, ?, 0)").bind(legacy, xId, "octo_x", at),
    db.prepare("INSERT INTO points_x_awards (actor_id, x_id, awarded_at, points) VALUES (?, ?, ?, 10)").bind(legacy, xId, at),
    db.prepare("INSERT INTO points_telegram_claims (telegram_id, actor_id, claimed_at) VALUES (?, ?, ?)").bind(`tg-legacy${suffix()}`, legacy, at),
    db.prepare("INSERT INTO points_telegram_links (actor_id, telegram_id, username, verified_at, public) VALUES (?, ?, NULL, ?, 0)").bind(legacy, `tg-legacy${suffix()}`, at),
    ...flows.flat(),
  ]);
}

async function run<A>(effect: Effect.Effect<A, unknown, Services>): Promise<{ readonly outcome: "accepted"; readonly value: A } | { readonly outcome: "refused" }> {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return { outcome: "accepted", value: exit.value };
  const error = Cause.squash(exit.cause);
  const tag = typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string" ? error._tag : "";
  if (refusals.includes(tag)) return { outcome: "refused" };
  throw error;
}

async function outcome<A>(effect: Effect.Effect<A, unknown, Services>) {
  return (await run(effect)).outcome;
}

async function settle(intent: Intent, sender: Sender, then: (settled: Settled) => void = () => undefined) {
  const result = await run(send(intent, sender, facts()));
  if (result.outcome === "accepted") then(result.value);
  return result.outcome;
}

async function closedGithub(token: number) {
  const tokenHash = digest(world.assertions.get(token) ?? unknownToken);
  const [row] = (await db.prepare("SELECT m.closed_at FROM points_members m JOIN identity_assertions a ON a.github_actor_id = m.github_id WHERE a.token_hash = ?").bind(tokenHash).all()).results;
  return typeof row?.closed_at === "string";
}

async function signIn(event: Extract<Event, { token: number }>): Promise<"accepted" | "refused"> {
  if (event.type !== "signInStorageFailed" && (event.type === "signIn") === await closedGithub(event.token)) return "refused";
  const consumed = await run(consume(world.assertions.get(event.token) ?? unknownToken, "PointsWeb"));
  if (consumed.outcome === "refused" || event.type === "signInStorageFailed") return consumed.outcome;
  const token = hex();
  const asserted = { githubId: consumed.value.github_actor_id, login: consumed.value.github_login, nodeId: consumed.value.github_node_id ?? "" };
  return settle({ kind: "signIn", assertion: asserted, reopen: event.type === "reopen", sessionHash: token }, session(0), (settled) => {
    if (settled.event.type !== event.type) throw new Error(`a ${event.type} request settled as ${settled.event.type}`);
    if (event.type !== "refuseClosedSignIn") world.sessions.set(++world.lastSession, token);
  });
}

function pollFacts(flowId: number, capability: number, audience: Audience): PollFacts {
  return { flowId: knownFlow(flowId), capability: capabilityOf(capability), audience, localRoute: false };
}

async function identityPoll(event: Extract<Event, { type: "identityPoll" }>) {
  const facts = pollFacts(event.flowId, event.capability, event.audience);
  const stored = await run(pollAs("storeAssertion", principal(event.client), facts));
  if (stored.outcome === "refused") return stored.outcome;
  const issued = await outcome(issueAssertion(facts));
  if (issued === "accepted" && stored.value.kind === "storeAssertion") world.assertions.set(event.flowId, stored.value.token);
  return issued;
}

async function dispatch(event: Event, by: unknown): Promise<"accepted" | "refused"> {
  switch (event.type) {
    case "signIn":
    case "reopen":
    case "refuseClosedSignIn":
    case "signInStorageFailed": return signIn(event);
    case "advanceTime": {
      if (by !== workerClock || event.now * 1000 < clock.now()) return "refused";
      clock.set(event.now * 1000);
      return "accepted";
    }
    case "purgeExpired": {
      const identity = await outcome(purge(senderNumber(by)));
      const accounts = await settle({ kind: "purgeExpired" }, service(by));
      return identity === "accepted" || accounts === "accepted" ? "accepted" : "refused";
    }
    case "signOut": return settle({ kind: "signOut" }, session(by));
    case "revokeSession": return settle({ kind: "revokeSession", prefix: (world.sessions.get(event.target) ?? hex()).slice(0, 24) }, session(by));
    case "publishMembership": return settle({ kind: "publishMembership", requestPublic: event.requestPublic }, session(by));
    case "close": {
      const confirmation = ["octo", "newcomer", "third", "nobody"].includes(event.confirmation) ? loginOf(event.confirmation) : event.confirmation;
      return settle({ kind: "close", confirmation }, session(by));
    }
    case "startX": {
      const flow = { state: hex(), browser: hex() };
      return settle({ kind: "startX", stateHash: flow.state, browserHash: flow.browser, verifier: "sealed", iv: "iv" }, session(by), () => world.flows.set(++world.lastFlow, flow));
    }
    case "claimXCallback": {
      const flow = world.flows.get(event.flowId) ?? { state: hex(), browser: hex() };
      return settle({ kind: "claimXCallback", stateHash: flow.state, browserHash: event.browserCap === event.flowId ? flow.browser : hex() }, session(0));
    }
    case "commitX": {
      const flow = world.flows.get(event.flowId) ?? { state: hex(), browser: hex() };
      return settle({ kind: "commitX", stateHash: flow.state, xId: xIdOf(event.xIdentity.xId), username: event.xIdentity.username, wellFormed: event.xIdentity.wellFormed }, service(by));
    }
    case "failX": return settle({ kind: "failX", stateHash: (world.flows.get(event.flowId) ?? { state: hex() }).state }, service(by));
    case "disconnectX": return settle({ kind: "disconnectX" }, session(by));
    case "publishX": return settle({ kind: "publishX" }, session(by));
    case "requestEmail": {
      const made = { id: randomUUID(), token: hex() };
      return settle({ kind: "requestEmail", requestKey: event.requestKey > 0 ? String(event.requestKey) : "", address: event.address, addressKey: event.addressKey, activity: event.activity, security: event.security, verificationId: made.id, tokenHash: made.token }, session(by), () => world.verifications.set(++world.lastEmailId, made));
    }
    case "markEmailDelivery":
      return settle({ kind: "markEmailDelivery", githubId: githubOf(event.githubId), verificationId: world.verifications.get(event.id)?.id ?? randomUUID(), nextState: event.nextState }, service(by));
    case "verifyEmail": {
      const version = hex();
      return settle({ kind: "verifyEmail", tokenHash: world.verifications.get(event.token)?.token ?? hex(), checkedRevision: event.checkedRevision, destinationVersion: version }, session(by), () => world.versions.set(++world.lastVersion, version));
    }
    case "setEmailConsent": {
      const supplied = event.suppliedVersion === 0 ? "" : world.versions.get(event.suppliedVersion) ?? hex();
      return settle({ kind: "setEmailConsent", activity: event.activity, choice: event.choice, suppliedVersion: supplied, checkedRevision: event.checkedRevision }, session(by));
    }
    case "issueUnsubscribe": {
      const token = hex();
      return settle({ kind: "issueUnsubscribe", githubId: githubOf(event.githubId), tokenHash: token }, service(by), () => world.unsubscribes.set(++world.lastUnsubscribe, token));
    }
    case "unsubscribe": return settle({ kind: "unsubscribe", tokenHash: world.unsubscribes.get(event.token) ?? hex() }, session(0));
    case "identityStart": {
      const id = world.lastIdentityFlow + 1;
      const flowId = flowIdOf(id);
      const started = await outcome(start(principal(event.client), event.audience, "Production", { flowId, state: stateOf(id), capability: capabilityOf(id), verifier: text(`v${id}`, 86) }));
      if (started === "accepted") {
        world.lastIdentityFlow = id;
        world.identityFlows.set(id, flowId);
      }
      return started;
    }
    case "identityClaimCallback": return outcome(claimCallback(stateOf(event.oauthState), stateOf(event.cookie)));
    case "identityFailCallback": return outcome(failCallback(senderNumber(by), knownFlow(event.flowId)));
    case "identityCompleteCallback":
      return outcome(completeCallback(senderNumber(by), knownFlow(event.flowId), { actorId: githubOf(event.github.actor), login: loginOf(event.github.login), nodeId: event.github.nodeId > 0 ? actorOf(event.github.nodeId) : undefined }));
    case "identityPoll": return identityPoll(event);
    case "saveNotice": throw new Error("saveNotice adds an operations notice: the accounts store neither loads nor writes notification rows, which operations' Notices port owns");
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

interface View {
  readonly members: ReadonlyArray<string>;
  readonly sessions: ReadonlyArray<string>;
  readonly claims: ReadonlyArray<string>;
  readonly flows: ReadonlyArray<string>;
  readonly telegramClaims: number;
  readonly identityFlows: ReadonlyArray<string>;
  readonly assertions: ReadonlyArray<string>;
}

interface IdentityView {
  readonly flows: ReadonlyArray<{ readonly audience: string; readonly status: string }>;
  readonly assertions: ReadonlyArray<{ readonly audience: string; readonly consumed: boolean }>;
}

function project(state: Accounts, identity: IdentityView = state.identity, login: (text: string) => string = (text) => text, xId: (text: string) => string = (text) => text): View {
  const memberLogin = (actor: number) => login(state.members.find((member) => member.actor === actor)?.login ?? "");
  return {
    members: state.members.map((member) => JSON.stringify([
      login(member.login), member.membership, member.public, member.closedAt > 0, xId(member.xLink.xId), member.xLink.username, member.xLink.public, member.telegramLinked,
      member.email.preference.activity, member.email.preference.security, member.email.preference.stored, member.email.destination.address,
      member.email.verifications.map((verification) => [verification.address, verification.delivery, verification.cancelled, verification.consumed]),
      member.email.unsubscribeTokens.length,
    ])).sort(),
    sessions: state.sessions.map((session) => `${memberLogin(session.actor)} ${session.expiresAt > state.now}`).sort(),
    claims: state.xRegistry.claims.map((claim) => `${xId(claim.xId)} ${memberLogin(claim.actor)}`).sort(),
    flows: state.xRegistry.flows.map((flow) => `${memberLogin(flow.actor)} ${flow.status}`).sort(),
    telegramClaims: state.telegramClaims.length,
    identityFlows: identity.flows.map((flow) => `${flow.audience} ${flow.status}`).sort(),
    assertions: identity.assertions.map((assertion) => `${assertion.audience} ${assertion.consumed}`).sort(),
  };
}

async function rows(query: string) {
  return (await db.prepare(query).all()).results;
}

async function observe(): Promise<View> {
  const state = await runtime.runPromise(everyAccount(facts()));
  const actors = new Set(state.members.filter((member) => member.login.endsWith(suffix())).map((member) => member.actor));
  const mine: Accounts = {
    ...state,
    members: state.members.filter((member) => actors.has(member.actor)),
    sessions: state.sessions.filter((session) => actors.has(session.actor)),
    xRegistry: { ...state.xRegistry, flows: state.xRegistry.flows.filter((flow) => actors.has(flow.actor)), claims: state.xRegistry.claims.filter((claim) => actors.has(claim.actor)) },
    telegramClaims: state.telegramClaims.filter((claim) => claim.endsWith(suffix())),
  };
  const flows = (await rows("SELECT audience, status FROM identity_oauth_flows")).map((row) => ({ audience: audienceOf[String(row.audience)] ?? String(row.audience), status: statusOf[String(row.status)] ?? String(row.status) }));
  const assertions = (await rows("SELECT audience, consumed_at FROM identity_assertions")).map((row) => ({ audience: audienceOf[String(row.audience)] ?? String(row.audience), consumed: row.consumed_at !== null }));
  return project(mine, { flows, assertions }, plainLogin, plainXId);
}

export const driver: Driver<View> & AsyncDisposable = {
  reset: async () => {
    generation++;
    world = fresh();
    clock.set(launchClock * 1000);
    await seed();
  },
  dispatch: (_key, event, by) => dispatch(event, by),
  observe: () => observe(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<View> = { keys: ["accounts"], walks: 4, steps: 10, view: (state) => project(state) };
