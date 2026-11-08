import { expect, test } from "bun:test";
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
    expect((await callback()).status).toBe(409);
    expect(
      ctx.sqlite
        .query("SELECT status FROM identity_oauth_flows WHERE id=?")
        .get(flow.flowId),
    ).toEqual({ status: "callback_processing" });
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
    ctx.persistence.createAssertion = async (assertion) => {
      const result = await create(assertion);
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
