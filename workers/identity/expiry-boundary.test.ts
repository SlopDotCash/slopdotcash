import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { randomToken } from "./crypto";
import {
  handleIdentityRequest,
  type IdentityWorkerDependencies,
} from "./handler";
import { D1IdentityPersistence } from "./persistence";

function context() {
  const { db, sqlite } = sqliteD1();
  let now = new Date("2026-11-07T12:00:00.000Z");
  const persistence = new D1IdentityPersistence(db as never);
  const deps: IdentityWorkerDependencies = {
    persistence,
    stateEncryptionSecret: Buffer.alloc(32, 1).toString("base64url"),
    assertionSecret: Buffer.alloc(32, 2).toString("base64url"),
    githubClientId: "Iv1.expiryfixture",
    now: () => now,
    randomToken,
    resolveGithubIdentity: async () => ({
      githubActorId: "1",
      githubLogin: "tester",
      githubNodeId: "U_tester",
    }),
  };
  const post = (path: string, body: unknown) =>
    handleIdentityRequest(
      new Request(`https://identity.slop.cash${path}`, {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      deps,
    );
  return {
    deps,
    post,
    persistence,
    sqlite,
    expire: () => {
      now = new Date("2026-11-07T12:05:01.000Z");
    },
    advance: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

async function start(ctx: ReturnType<typeof context>) {
  const response = await ctx.post("/v1/oauth/start", {
    audience: "slop-points-web",
  });
  expect(response.status).toBe(201);
  const flow = (await response.json()) as {
    flowId: string;
    pollCapability: string;
    authorizationUrl: string;
  };
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  const callback = () =>
    handleIdentityRequest(
      new Request(
        `https://identity.slop.cash/v1/oauth/callback?state=${state}&code=fixturecode1`,
        {
          headers: { cookie: `__Host-slop_oauth_state=${state}` },
        },
      ),
      ctx.deps,
    );
  const poll = () =>
    ctx.post("/v1/oauth/poll", {
      flowId: flow.flowId,
      pollCapability: flow.pollCapability,
      audience: "slop-points-web",
    });
  return { flow, callback, poll };
}

test("callback cannot report success if the flow expires during GitHub exchange", async () => {
  const ctx = context();
  try {
    const { flow, callback, poll } = await start(ctx);
    ctx.deps.resolveGithubIdentity = async () => {
      ctx.expire();
      return {
        githubActorId: "1",
        githubLogin: "tester",
        githubNodeId: "U_tester",
      };
    };
    // An expired claim is terminal: the callback says so and ends the flow.
    const expired = await callback();
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain("Sign-in expired");
    expect(
      ctx.sqlite
        .query("SELECT status FROM identity_oauth_flows WHERE id=?")
        .get(flow.flowId),
    ).toEqual({ status: "callback_failed" });
    expect((await poll()).status).toBe(410);
  } finally {
    ctx.sqlite.close();
  }
});

test("poll cannot issue after expiry during assertion persistence", async () => {
  const ctx = context();
  try {
    const { flow, callback, poll } = await start(ctx);
    expect((await callback()).status).toBe(200);
    const create = ctx.persistence.createAssertion.bind(ctx.persistence);
    ctx.persistence.createAssertion = async (assertion, flowId) => {
      const result = await create(assertion, flowId);
      ctx.expire();
      return result;
    };
    expect((await poll()).status).toBe(410);
    expect(
      ctx.sqlite
        .query("SELECT status FROM identity_oauth_flows WHERE id=?")
        .get(flow.flowId),
    ).toEqual({ status: "callback_complete" });
  } finally {
    ctx.sqlite.close();
  }
});

test("a delayed poll cannot recreate a consumed assertion after expiry cleanup", async () => {
  const ctx = context();
  let releaseFirstMark!: () => void;
  let firstMarkReached!: () => void;
  let releaseSecondCreate!: () => void;
  let secondCreateReached!: () => void;
  const holdFirstMark = new Promise<void>((resolve) => {
    releaseFirstMark = resolve;
  });
  const atFirstMark = new Promise<void>((resolve) => {
    firstMarkReached = resolve;
  });
  const holdSecondCreate = new Promise<void>((resolve) => {
    releaseSecondCreate = resolve;
  });
  const atSecondCreate = new Promise<void>((resolve) => {
    secondCreateReached = resolve;
  });
  let firstPoll: Promise<Response> | null = null;
  let secondPoll: Promise<Response> | null = null;
  try {
    const { callback, poll } = await start(ctx);
    expect((await callback()).status).toBe(200);
    const create = ctx.persistence.createAssertion.bind(ctx.persistence);
    const mark = ctx.persistence.markAssertionIssued.bind(ctx.persistence);
    let creates = 0;
    let marks = 0;
    ctx.persistence.createAssertion = async (assertion, flowId) => {
      if (++creates === 2) {
        secondCreateReached();
        await holdSecondCreate;
      }
      return create(assertion, flowId);
    };
    ctx.persistence.markAssertionIssued = async (flowId, issuedAt) => {
      if (++marks === 1) {
        firstMarkReached();
        await holdFirstMark;
      }
      return mark(flowId, issuedAt);
    };

    firstPoll = poll();
    await atFirstMark;
    // Both polls read callback_complete. The second captures a later expiry,
    // then waits before the actual INSERT while the first issues its token.
    ctx.advance(30_000);
    secondPoll = poll();
    await atSecondCreate;
    releaseFirstMark();
    const issued = await firstPoll;
    expect(issued.status).toBe(200);
    const { assertion } = (await issued.json()) as { assertion: string };
    const consume = () =>
      handleIdentityRequest(
        new Request("https://identity.internal/v1/assertions/consume", {
          method: "POST",
          headers: {
            authorization: `Bearer ${assertion}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ audience: "slop-points-web" }),
        }),
        ctx.deps,
      );
    expect((await consume()).status).toBe(200);

    ctx.advance(61_000);
    await ctx.persistence.deleteExpired("2026-11-07T12:01:31.000Z");
    const tokenHash = await sha256Hex(assertion);
    expect(
      ctx.sqlite
        .query("SELECT token_hash FROM identity_assertions WHERE token_hash=?")
        .get(tokenHash),
    ).toBeNull();
    releaseSecondCreate();
    const refused = await secondPoll;
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({
      error: "assertion_unavailable",
    });
    // Without the parent-state fence, the later INSERT could restore this
    // exact token with an unconsumed row that remains valid until 12:02.
    expect((await consume()).status).toBe(401);
    expect(
      ctx.sqlite
        .query("SELECT token_hash FROM identity_assertions WHERE token_hash=?")
        .get(tokenHash),
    ).toBeNull();
  } finally {
    releaseFirstMark();
    releaseSecondCreate();
    await Promise.allSettled([firstPoll, secondPoll]);
    ctx.sqlite.close();
  }
});
