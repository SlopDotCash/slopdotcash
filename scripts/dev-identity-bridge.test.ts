import { expect, test } from "bun:test";
import { onRequest } from "../functions/api/v1/[[path]]";
import { sqliteD1 } from "../tests/sqlite-d1";
import { randomToken } from "../workers/identity/crypto";
import { handleIdentityRequest } from "../workers/identity/handler";
import { D1IdentityPersistence } from "../workers/identity/persistence";
import { devIdentityBridge } from "./dev-identity-bridge";

const remote = "https://identity.slop.cash";
const local = "http://127.0.0.1:4467";
const post = (url: string, body: object) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
function fixture() {
  const production = sqliteD1();
  const development = sqliteD1();
  const persistence = new D1IdentityPersistence(production.db);
  const deps = {
    persistence,
    stateEncryptionSecret: Buffer.alloc(32, 1).toString("base64url"),
    assertionSecret: Buffer.alloc(32, 2).toString("base64url"),
    githubClientId: "Iv1.existing-slop-app",
    now: () => new Date(),
    randomToken,
    resolveGithubIdentity: async () => ({
      githubActorId: "42",
      githubLogin: "developer",
      githubNodeId: "U_developer",
    }),
  };
  const serve = (request: Request) => handleIdentityRequest(request, deps);
  const bridge = devIdentityBridge(
    local,
    new D1IdentityPersistence(development.db),
    ((input: string | URL | Request, init?: RequestInit) =>
      serve(new Request(input, init))) as typeof fetch,
  );
  return { serve, bridge, production, development };
}

test("existing GitHub App returns locally and exchanges identity only once", async () => {
  const { serve, bridge, production, development } = fixture();
  try {
    const started = await bridge(
      post(`${local}/v1/oauth/start`, { audience: "slop-points-web" }),
    );
    expect(started.status).toBe(201);
    const flow = await started.json();
    expect(new URL(flow.authorizationUrl).origin).toBe(local);
    const redirect = await bridge(new Request(flow.authorizationUrl));
    expect(new URL(redirect.headers.get("location") ?? "").origin).toBe(remote);
    const authorize = await serve(
      new Request(redirect.headers.get("location") ?? ""),
    );
    const github = new URL(authorize.headers.get("location") ?? "");
    expect(github.searchParams.get("client_id")).toBe("Iv1.existing-slop-app");
    expect(github.searchParams.get("redirect_uri")).toBe(
      `${remote}/v1/oauth/callback`,
    );
    const cookie = (authorize.headers.get("set-cookie") ?? "").split(";")[0];
    const state = github.searchParams.get("state");
    const callback = await serve(
      new Request(
        `${remote}/v1/oauth/callback?state=${state}&code=github-code-123`,
        { headers: { cookie } },
      ),
    );
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain(`${local}/login`);
    const poll = {
      flowId: flow.flowId,
      pollCapability: flow.pollCapability,
      audience: "slop-points-web",
    };
    expect((await serve(post(`${remote}/v1/oauth/poll`, poll))).status).toBe(
      403,
    );
    const completed = await bridge(post(`${local}/v1/oauth/poll`, poll));
    expect(completed.status).toBe(200);
    const { assertion } = await completed.json();
    const consume = () =>
      new Request("https://identity.internal/v1/assertions/consume", {
        method: "POST",
        headers: {
          authorization: `Bearer ${assertion}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ audience: "slop-points-web" }),
      });
    expect((await serve(consume())).status).toBe(401);
    const localApi = (request: Request) =>
      onRequest({
        request,
        env: {
          SLOP_DB: development.db,
          PAYMENTS_ALLOWED_ORIGIN: local,
          TRACE_AUTH_SECRET: "local-test-secret-0000000000000000000000",
          SLOP_IDENTITY: { fetch: bridge },
        },
        waitUntil: () => {},
      } as never);
    const join = post(`${local}/api/v1/points/join`, {
      assertion,
      public: true,
    });
    join.headers.set("origin", local);
    const joined = await localApi(join);
    expect(joined.status).toBe(200);
    const cookieHeader = joined.headers.get("set-cookie") ?? "";
    expect(cookieHeader).toContain("HttpOnly");
    const me = await localApi(
      new Request(`${local}/api/v1/points/me`, {
        headers: { cookie: cookieHeader.split(";")[0] },
      }),
    );
    expect(await me.json()).toMatchObject({
      actor: { id: "U_developer", login: "developer" },
    });
    expect((await bridge(consume())).status).toBe(401);
    expect((await bridge(post(`${local}/v1/oauth/poll`, poll))).status).toBe(
      410,
    );
  } finally {
    production.sqlite.close();
    development.sqlite.close();
  }
});

test("local handoff rejects non-loopback destinations and unbound authorization", async () => {
  const { serve, bridge, production, development } = fixture();
  try {
    for (const returnOrigin of [
      "https://evil.example",
      "http://127.0.0.1.evil.example:4467",
      `${local}/extra`,
      "http://localhost:4467@evil.example",
    ]) {
      expect(
        (
          await serve(
            post(`${remote}/v1/local/start`, {
              audience: "slop-points-web",
              returnOrigin,
            }),
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await bridge(
          new Request(
            `${local}/v1/oauth/authorize?flow_id=unknown&state=unknown`,
          ),
        )
      ).status,
    ).toBe(410);
    expect(
      (
        await bridge(
          new Request(`${local}/v1/oauth/start`, {
            method: "POST",
            headers: {
              origin: "https://evil.example",
              "content-type": "application/json",
            },
            body: JSON.stringify({ audience: "slop-points-web" }),
          }),
        )
      ).status,
    ).toBe(403);
  } finally {
    production.sqlite.close();
    development.sqlite.close();
  }
});

test("ordinary production sign-in cannot be consumed as a local handoff", async () => {
  const { serve, production, development } = fixture();
  try {
    const started = await serve(
      post(`${remote}/v1/oauth/start`, { audience: "slop-points-web" }),
    );
    const flow = await started.json();
    const poll = {
      flowId: flow.flowId,
      pollCapability: flow.pollCapability,
      audience: "slop-points-web",
    };
    expect((await serve(post(`${remote}/v1/local/poll`, poll))).status).toBe(
      403,
    );
    const authorize = await serve(new Request(flow.authorizationUrl));
    const github = new URL(authorize.headers.get("location") ?? "");
    const callback = await serve(
      new Request(
        `${remote}/v1/oauth/callback?state=${github.searchParams.get("state")}&code=github-code-123`,
        {
          headers: {
            cookie: (authorize.headers.get("set-cookie") ?? "").split(";")[0],
          },
        },
      ),
    );
    expect(callback.status).toBe(200);
    expect(await callback.text()).not.toContain(local);
    const result = await serve(post(`${remote}/v1/oauth/poll`, poll));
    expect(result.status).toBe(200);
    expect((await result.json()).assertion).toMatch(/^slop_assert_v1_/u);
  } finally {
    production.sqlite.close();
    development.sqlite.close();
  }
});
