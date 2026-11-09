import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { ME, OTHER, seedAccountClosure } from "../../tests/account-closure-fixture";
import { handlePointsApi, sessionGithubActor } from "./handler";

// Source-authored tests of actual handlers and migrated persistence. The small
// jar applies the shared-cookie replacement rule in deliberately reordered
// response delivery. Browser/runtime execution remains an acceptance gate.
const NOW = "2026-11-09T12:00:00.000Z";
const ORIGIN = "https://slop.cash";
const NAME = "__Host-slop_points";
const ASSERTION = `slop_assert_v1_${"a".repeat(48)}`;
async function fixture() {
  const { db, sqlite, tokens } = await seedAccountClosure(NOW, false);
  let now = NOW;
  let identity: typeof ME | typeof OTHER = OTHER;
  let cookie: string | null = tokens.me;
  const deps = {
    db, now: () => new Date(now), rateLimitSecret: "cookie-order-fixture-secret".repeat(3),
    identity: { fetch: async () => Response.json({
      audience: "slop-points-web", githubActorId: identity.github,
      githubNodeId: identity.actor, githubLogin: identity.login,
    }) },
  };
  const request = (token: string | null, path = "me", body?: unknown) => new Request(`${ORIGIN}/api/v1/points/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token === null ? {} : { cookie: `${NAME}=${token}` }),
      ...(body === undefined ? {} : { origin: ORIGIN, "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const call = (path: string, token: string | null = cookie, body?: unknown) => handlePointsApi(request(token, path, body), deps);
  async function issueJoin(actor: typeof ME | typeof OTHER = OTHER, reopen = false) {
    identity = actor;
    return call("join", null, { assertion: ASSERTION, public: true, ...(reopen ? { reopen: true } : {}) });
  }
  async function join(actor: typeof ME | typeof OTHER = OTHER, reopen = false) {
    const response = await issueJoin(actor, reopen);
    expect(response.status).toBe(200);
    return response;
  }
  function deliver(response: Response) {
    const header = response.headers.get("set-cookie");
    if (header === null) return;
    const [pair, ...attributes] = header.split(";");
    expect(pair!.startsWith(`${NAME}=`)).toBe(true);
    cookie = attributes.some((part) => part.trim() === "Max-Age=0") ? null : pair!.slice(NAME.length + 1);
  }
  const actor = (token = cookie) => sessionGithubActor(request(token), db, now);
  return { db, sqlite, tokens, call, issueJoin, join, deliver, actor, cookie: () => cookie,
    setNow: (value: string) => { now = value; }, close: () => sqlite.close() };
}

async function deliverAfterNewLogin(f: Awaited<ReturnType<typeof fixture>>, old: Response, target: typeof ME | typeof OTHER = OTHER, reopen = false) {
  const joined = await f.join(target, reopen);
  expect(joined.headers.get("set-cookie")).toContain("Max-Age=3600; Secure; HttpOnly; SameSite=Strict");
  f.deliver(joined);
  const freshCookie = f.cookie();
  expect(freshCookie).not.toBeNull();
  expect(old.headers.get("set-cookie")).toBeNull();
  f.deliver(old);
  expect(f.cookie()).toBe(freshCookie);
  expect(await f.actor()).toEqual({ githubId: target.github, githubLogin: target.login });
}

test("a delayed signout response cannot erase another account's newer sign-in", async () => {
  const f = await fixture();
  try {
    const old = await f.call("signout", f.tokens.me, {});
    expect(old.status).toBe(200);
    expect(await f.actor(f.tokens.me)).toBeNull();
    expect(await f.actor(f.tokens.meOther)).toEqual({ githubId: ME.github, githubLogin: ME.login });
    await deliverAfterNewLogin(f, old);
  } finally { f.close(); }
});

test("a delayed signout response cannot erase a newer sign-in by the same actor", async () => {
  const f = await fixture();
  try {
    const old = await f.call("signout", f.tokens.me, {});
    await deliverAfterNewLogin(f, old, ME);
    expect(await f.actor(f.tokens.me)).toBeNull();
  } finally { f.close(); }
});

test("an expired me response cannot erase a later valid login", async () => {
  const f = await fixture();
  try {
    f.setNow("2026-11-09T15:00:00.000Z");
    const old = await f.call("me", f.tokens.me);
    expect(old.status).toBe(200);
    expect(await old.json()).toBeNull();
    expect(await f.actor(f.tokens.me)).toBeNull();
    await deliverAfterNewLogin(f, old);
  } finally { f.close(); }
});

test("an invalid-session write cannot erase a newer login", async () => {
  const f = await fixture();
  try {
    const old = await f.call("signout", "x".repeat(48), {});
    expect(old.status).toBe(401);
    expect(await old.json()).toEqual({ error: "session_expired" });
    await deliverAfterNewLogin(f, old);
  } finally { f.close(); }
});

for (const token of [null, "invalid/format"]) {
  test(`a ${token === null ? "missing" : "malformed"} session read changes no cookie`, async () => {
    const f = await fixture();
    try {
      const old = await f.call("me", token);
      expect(old.status).toBe(200);
      expect(await old.json()).toBeNull();
      await deliverAfterNewLogin(f, old);
    } finally { f.close(); }
  });
}

test("self-revocation keeps its database effect without clearing a newer cookie", async () => {
  const f = await fixture();
  try {
    const old = await f.call("sessions/revoke", f.tokens.me, { id: (await sha256Hex(f.tokens.me)).slice(0, 24) });
    expect(old.status).toBe(200);
    expect(await f.actor(f.tokens.me)).toBeNull();
    expect(await f.actor(f.tokens.meOther)).not.toBeNull();
    await deliverAfterNewLogin(f, old);
  } finally { f.close(); }
});

test("revoking a sibling session does not clear the caller or a newer login", async () => {
  const f = await fixture();
  try {
    const old = await f.call("sessions/revoke", f.tokens.me, { id: (await sha256Hex(f.tokens.meOther)).slice(0, 24) });
    expect(old.status).toBe(200);
    expect(await f.actor(f.tokens.meOther)).toBeNull();
    expect(await f.actor(f.tokens.me)).not.toBeNull();
    await deliverAfterNewLogin(f, old);
  } finally { f.close(); }
});

test("a delayed closure response cannot clear another account's cookie", async () => {
  const f = await fixture();
  try {
    const old = await f.call("account/close", f.tokens.me, { login: ME.login });
    expect(old.status).toBe(200);
    expect(await f.actor(f.tokens.me)).toBeNull();
    expect(await f.actor(f.tokens.meOther)).toBeNull();
    expect(await f.actor(f.tokens.other)).not.toBeNull();
    await deliverAfterNewLogin(f, old);
  } finally { f.close(); }
});

test("a delayed closure response cannot clear an explicitly reopened account", async () => {
  const f = await fixture();
  try {
    const old = await f.call("account/close", f.tokens.me, { login: ME.login });
    expect(old.status).toBe(200);
    await deliverAfterNewLogin(f, old, ME, true);
    expect(await f.actor(f.tokens.me)).toBeNull();
    expect(await f.actor(f.tokens.meOther)).toBeNull();
  } finally { f.close(); }
});

test("retaining a revoked cookie cannot authenticate or reactivate its session", async () => {
  const f = await fixture();
  try {
    const oldCookie = f.cookie();
    const signedOut = await f.call("signout", undefined, {});
    expect(signedOut.status).toBe(200);
    f.deliver(signedOut);
    expect(f.cookie()).toBe(oldCookie);
    expect(await f.actor()).toBeNull();
    expect(await (await f.call("me")).json()).toBeNull();
    expect((await f.call("visibility", undefined, { public: true })).status).toBe(401);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM points_sessions WHERE token_hash=?").get(await sha256Hex(f.tokens.me))).toEqual({ n: 0 });
  } finally { f.close(); }
});

test("a refused reopen emits no cookie and preserves a newer account", async () => {
  const f = await fixture();
  try {
    await f.call("account/close", f.tokens.me, { login: ME.login });
    const refused = await f.issueJoin(ME);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "account_closed" });
    await deliverAfterNewLogin(f, refused);
  } finally { f.close(); }
});
