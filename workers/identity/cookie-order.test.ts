import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { randomToken } from "./crypto";
import { handleIdentityRequest, type IdentityWorkerDependencies } from "./handler";
import { D1IdentityPersistence } from "./persistence";

// Real handler, crypto and migrated persistence definitions; not executed in
// this audit. The jar applies returned headers in controlled orders, not a
// native browser. Provider results are fixtures, not provider acceptance.
const ORIGIN = "https://identity.slop.cash";
const LEGACY = "__Host-slop_oauth_state";
const AUDIENCE = "slop-points-web";
type Flow = { flowId: string; pollCapability: string; authorizationUrl: string; state: string; name: string };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => { resolve = ready; });
  return { promise, resolve };
}
async function fixture() {
  const { db, sqlite } = sqliteD1();
  const persistence = new D1IdentityPersistence(db as never);
  const jar = new Map<string, string>();
  let now = new Date("2026-11-09T12:00:00.000Z"), providerCalls = 0;
  const deps: IdentityWorkerDependencies = {
    persistence, stateEncryptionSecret: Buffer.alloc(32, 1).toString("base64url"),
    assertionSecret: Buffer.alloc(32, 2).toString("base64url"), githubClientId: "Iv1.cookiefixture",
    randomToken, now: () => now,
    resolveGithubIdentity: async () => {
      providerCalls++;
      return { githubActorId: "123", githubLogin: "cookie-fixture", githubNodeId: "U_cookie_fixture" };
    },
  };
  const post = (path: string, body: unknown, internal = false, authorization?: string) => handleIdentityRequest(
    new Request(`${internal ? "https://identity.internal" : ORIGIN}${path}`, {
      method: "POST", headers: { "content-type": "application/json", ...(internal ? {} : { origin: "https://slop.cash" }),
        ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body),
    }), deps,
  );
  async function start(): Promise<Flow> {
    const response = await post("/v1/oauth/start", { audience: AUDIENCE });
    expect(response.status).toBe(201);
    const flow = await response.json() as Omit<Flow, "state" | "name">;
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    if (!state) throw new Error("Missing fixture state");
    return { ...flow, state, name: `${LEGACY}_${await sha256Hex(state)}` };
  }
  const authorize = (flow: Flow) => handleIdentityRequest(new Request(flow.authorizationUrl), deps);
  function deliver(response: Response) {
    const header = response.headers.get("set-cookie");
    if (header === null) return;
    const [pair, ...attributes] = header.split(";");
    const separator = pair!.indexOf("=");
    const name = pair!.slice(0, separator), value = pair!.slice(separator + 1);
    if (attributes.some((attribute) => attribute.trim() === "Max-Age=0")) jar.delete(name);
    else jar.set(name, value);
  }
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const callbackRequest = (flow: Flow, captured = cookie(), query = "code=fixturecode1") => new Request(
    `${ORIGIN}/v1/oauth/callback?state=${encodeURIComponent(flow.state)}&${query}`, { headers: { cookie: captured } },
  );
  const callback = (flow: Flow, captured?: string, query?: string) => handleIdentityRequest(callbackRequest(flow, captured, query), deps);
  const poll = (flow: Flow) => post("/v1/oauth/poll", { flowId: flow.flowId, pollCapability: flow.pollCapability, audience: AUDIENCE });
  const status = (flow: Flow) => (sqlite.query("SELECT status FROM identity_oauth_flows WHERE id=?").get(flow.flowId) as { status: string }).status;
  return { deps, sqlite, jar, start, authorize, deliver, cookie, callback, callbackRequest, poll, post, status,
    providerCalls: () => providerCalls, expire: () => { now = new Date("2026-11-09T12:05:01.000Z"); }, close: () => sqlite.close() };
}

test("authorization sets a deterministic flow-scoped cookie with the existing security attributes", async () => {
  const f = await fixture();
  try {
    const a = await f.start(), b = await f.start();
    expect(a.name).not.toBe(b.name);
    const response = await f.authorize(a);
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toBe(`${a.name}=${a.state}; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Lax`);
    expect(new URL(response.headers.get("location")!).searchParams.get("state")).toBe(a.state);
    f.deliver(response);
    expect(f.jar.get(a.name)).toBe(a.state);
    expect(f.jar.has(LEGACY)).toBe(false);
  } finally { f.close(); }
});

test("two authorization responses can arrive in reverse order and both callbacks complete", async () => {
  const f = await fixture();
  try {
    const a = await f.start(), b = await f.start();
    const first = await f.authorize(a), second = await f.authorize(b);
    f.deliver(second); f.deliver(first);
    expect(f.jar.size).toBe(2);
    const completedA = await f.callback(a);
    expect(completedA.status).toBe(200); f.deliver(completedA);
    expect(f.jar.get(b.name)).toBe(b.state);
    const completedB = await f.callback(b);
    expect(completedB.status).toBe(200); f.deliver(completedB);
    expect(f.jar.size).toBe(0);
    expect(f.status(a)).toBe("callback_complete");
    expect(f.status(b)).toBe("callback_complete");
  } finally { f.close(); }
});

test("an earlier callback waiting on GitHub cannot clear a later authorization", async () => {
  const f = await fixture(); const entered = deferred(), release = deferred();
  let pending: Promise<Response> | undefined;
  try {
    const a = await f.start(); f.deliver(await f.authorize(a));
    const resolve = f.deps.resolveGithubIdentity;
    f.deps.resolveGithubIdentity = async (...args) => { entered.resolve(); await release.promise; return resolve(...args); };
    pending = f.callback(a);
    await entered.promise;
    const b = await f.start(); f.deliver(await f.authorize(b));
    release.resolve();
    const completed = await pending;
    expect(completed.status).toBe(200); f.deliver(completed);
    expect(f.jar.has(a.name)).toBe(false);
    expect(f.jar.get(b.name)).toBe(b.state);
    expect((await f.callback(b)).status).toBe(200);
  } finally { release.resolve(); await pending?.catch(() => undefined); f.close(); }
});

for (const scoped of ["", "wrong-state"]) {
  test(`a present ${scoped ? "wrong" : "empty"} scoped cookie cannot fall back to a matching legacy cookie`, async () => {
    const f = await fixture();
    try {
      const flow = await f.start();
      f.jar.set(flow.name, scoped); f.jar.set(LEGACY, flow.state);
      const response = await f.callback(flow);
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(f.providerCalls()).toBe(0);
      expect(f.status(flow)).toBe("pending");
    } finally { f.close(); }
  });
}

test("a matching scoped cookie takes precedence over an unrelated legacy cookie", async () => {
  const f = await fixture();
  try {
    const flow = await f.start(); f.deliver(await f.authorize(flow));
    f.jar.set(LEGACY, "unrelated-legacy-state");
    const response = await f.callback(flow);
    expect(response.status).toBe(200); f.deliver(response);
    expect(f.jar.get(LEGACY)).toBe("unrelated-legacy-state");
    expect(f.jar.has(flow.name)).toBe(false);
  } finally { f.close(); }
});

test("an in-flight legacy flow completes without deleting a newer legacy or scoped cookie", async () => {
  const f = await fixture(); const entered = deferred(), release = deferred();
  let pending: Promise<Response> | undefined;
  try {
    const a = await f.start(); f.jar.set(LEGACY, a.state);
    const resolve = f.deps.resolveGithubIdentity;
    f.deps.resolveGithubIdentity = async (...args) => { entered.resolve(); await release.promise; return resolve(...args); };
    pending = f.callback(a);
    await entered.promise;
    const b = await f.start();
    f.jar.set(LEGACY, b.state); f.deliver(await f.authorize(b));
    release.resolve();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toStartWith(`${a.name}=`);
    f.deliver(response);
    expect(f.jar.get(LEGACY)).toBe(b.state);
    expect(f.jar.get(b.name)).toBe(b.state);
  } finally { release.resolve(); await pending?.catch(() => undefined); f.close(); }
});

test("another flow's cookie cannot authorize this callback", async () => {
  const f = await fixture();
  try {
    const a = await f.start(), b = await f.start();
    f.deliver(await f.authorize(b));
    expect((await f.callback(a)).status).toBe(400);
    expect(f.providerCalls()).toBe(0);
    expect(f.status(a)).toBe("pending");
  } finally { f.close(); }
});

test("retained legacy state cannot replay a completed callback or consume its assertion twice", async () => {
  const f = await fixture();
  try {
    const flow = await f.start(); f.jar.set(LEGACY, flow.state);
    expect((await f.callback(flow)).status).toBe(200);
    const poll = await f.poll(flow);
    expect(poll.status).toBe(200);
    const { assertion } = await poll.json() as { assertion: string };
    expect((await f.callback(flow)).status).toBe(410);
    expect(f.providerCalls()).toBe(1);
    const consume = () => f.post("/v1/assertions/consume", { audience: AUDIENCE }, true, `Bearer ${assertion}`);
    expect((await consume()).status).toBe(200);
    expect((await consume()).status).toBe(401);
  } finally { f.close(); }
});

test("a bound authorization denial ends only its flow", async () => {
  const f = await fixture();
  try {
    const a = await f.start(), b = await f.start();
    f.deliver(await f.authorize(a)); f.deliver(await f.authorize(b));
    const response = await f.callback(a, undefined, "error=access_denied");
    expect(response.status).toBe(400);
    expect(f.status(a)).toBe("callback_failed");
    f.deliver(response);
    expect(f.jar.get(b.name)).toBe(b.state);
    expect(f.status(b)).toBe("pending");
    expect(f.providerCalls()).toBe(0);
  } finally { f.close(); }
});

test("an expired callback cannot clear other retained authorization cookies", async () => {
  const f = await fixture();
  try {
    const a = await f.start(), b = await f.start();
    f.deliver(await f.authorize(a)); f.deliver(await f.authorize(b));
    f.expire();
    const response = await f.callback(a);
    expect(response.status).toBe(410);
    expect(response.headers.get("set-cookie")).toBeNull();
    f.deliver(response);
    expect(f.jar.get(b.name)).toBe(b.state);
    expect(f.providerCalls()).toBe(0);
  } finally { f.close(); }
});

test("refused completion still returns expired when failCallback finds cleanup already removed the flow", async () => {
  const f = await fixture();
  try {
    const flow = await f.start(); f.deliver(await f.authorize(flow));
    const resolve = f.deps.resolveGithubIdentity;
    f.deps.resolveGithubIdentity = async (...args) => { f.expire(); return resolve(...args); };
    const fail = f.deps.persistence.failCallback.bind(f.deps.persistence);
    let calls = 0;
    f.deps.persistence.failCallback = async (id) => {
      calls++;
      f.sqlite.query("DELETE FROM identity_oauth_flows WHERE id=?").run(id);
      expect(await fail(id)).toBe(false);
      return false;
    };
    const response = await f.callback(flow);
    expect(response.status).toBe(410);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(calls).toBe(1);
    expect(f.sqlite.query("SELECT id FROM identity_oauth_flows WHERE id=?").get(flow.flowId)).toBeNull();
  } finally { f.close(); }
});

test("refused completion reports a failure-store outage without claiming the flow ended", async () => {
  const f = await fixture();
  try {
    const flow = await f.start(); f.deliver(await f.authorize(flow));
    const resolve = f.deps.resolveGithubIdentity;
    f.deps.resolveGithubIdentity = async (...args) => { f.expire(); return resolve(...args); };
    f.deps.persistence.failCallback = async () => { throw new Error("private failure-store diagnostic"); };
    const response = await f.callback(flow);
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ error: "internal_error", message: "Internal error" });
    expect(f.status(flow)).toBe("callback_processing");
  } finally { f.close(); }
});
