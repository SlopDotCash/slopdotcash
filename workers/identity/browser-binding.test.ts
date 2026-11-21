// A website sign-in flow belongs to the browser that started it. A sign-in
// link completed by any other browser must never produce a website session
// for whoever started the flow.
import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { randomToken } from "./crypto";
import {
  handleIdentityRequest,
  type IdentityWorkerDependencies,
} from "./handler";
import { D1IdentityPersistence } from "./persistence";

const IDENTITY = "https://identity.slop.cash";
const SITE = "https://slop.cash";

function worker() {
  const { db, sqlite } = sqliteD1();
  const deps: IdentityWorkerDependencies = {
    persistence: new D1IdentityPersistence(db as never),
    stateEncryptionSecret: Buffer.alloc(32, 1).toString("base64url"),
    assertionSecret: Buffer.alloc(32, 2).toString("base64url"),
    githubClientId: "Iv1.bindingfixture",
    now: () => new Date(),
    randomToken,
    resolveGithubIdentity: async () => ({
      githubActorId: "42",
      githubLogin: "victim",
      githubNodeId: "U_victim",
    }),
  };
  const request = (path: string, init: RequestInit = {}) =>
    handleIdentityRequest(new Request(`${IDENTITY}${path}`, init), deps);
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { deps, sqlite, request, post };
}

type Started = {
  flowId: string;
  pollCapability: string;
  authorizationUrl: string;
};

/** The `name=value` pair of the binding cookie a start response set. */
function bindingCookie(response: Response, flowId: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0] ?? "";
    if (pair.startsWith(`__Host-slop_oauth_bind_${flowId}=`)) return pair;
  }
  return null;
}

async function startWeb(w: ReturnType<typeof worker>) {
  const response = await w.post(
    "/v1/oauth/start",
    { audience: "slop-points-web" },
    { origin: SITE },
  );
  expect(response.status).toBe(201);
  const flow = (await response.json()) as Started;
  const state = new URL(flow.authorizationUrl).searchParams.get("state") ?? "";
  return {
    response,
    flow,
    state,
    cookie: bindingCookie(response, flow.flowId),
  };
}

function poll(
  w: ReturnType<typeof worker>,
  flow: Started,
  headers: Record<string, string>,
  audience = "slop-points-web",
) {
  return w.post(
    "/v1/oauth/poll",
    { flowId: flow.flowId, pollCapability: flow.pollCapability, audience },
    headers,
  );
}

test("a website sign-in cannot start without a browser origin", async () => {
  const w = worker();
  const response = await w.post("/v1/oauth/start", {
    audience: "slop-points-web",
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "origin_required" });
});

test("a website start binds the flow to the starting browser with a credentialed cookie", async () => {
  const w = worker();
  const { response, flow, cookie } = await startWeb(w);
  expect(cookie).not.toBeNull();
  const header = response.headers
    .getSetCookie()
    .find((value) =>
      value.startsWith(`__Host-slop_oauth_bind_${flow.flowId}=`),
    );
  expect(header).toContain("Secure");
  expect(header).toContain("HttpOnly");
  expect(header).toContain("Path=/");
  expect(header).toContain("Max-Age=300");
  expect(response.headers.get("access-control-allow-origin")).toBe(SITE);
  expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  // The response body never carries the binding secret.
  expect(JSON.stringify(flow)).not.toContain(
    (cookie ?? "").split("=")[1] ?? "unreachable",
  );
});

test("another browser cannot open the sign-in link of a website flow", async () => {
  const w = worker();
  const { flow } = await startWeb(w);
  // The other browser holds no binding cookie.
  const refused = await w.request(
    new URL(flow.authorizationUrl).pathname +
      new URL(flow.authorizationUrl).search,
  );
  expect(refused.status).toBe(403);
  expect(refused.headers.get("location")).toBeNull();
  expect(refused.headers.getSetCookie().join()).not.toContain(
    "__Host-slop_oauth_state=",
  );
  expect(await refused.text()).toContain("started in a different browser");
  // A cookie bound to another flow does not count either.
  const other = await startWeb(w);
  const wrong = await w.request(
    new URL(flow.authorizationUrl).pathname +
      new URL(flow.authorizationUrl).search,
    {
      headers: {
        cookie: (other.cookie ?? "").replace(other.flow.flowId, flow.flowId),
      },
    },
  );
  expect(wrong.status).toBe(403);
});

test("a callback in another browser cannot complete a website flow for its starter", async () => {
  const w = worker();
  const { flow, state, cookie } = await startWeb(w);
  // Even with the state cookie, a callback without the binding is refused and
  // the flow ends, so the starter's poll never receives an assertion.
  const callback = await w.request(
    `/v1/oauth/callback?state=${state}&code=fixturecode1`,
    { headers: { cookie: `__Host-slop_oauth_state=${state}` } },
  );
  expect(callback.status).toBe(403);
  const starterPoll = await poll(w, flow, {
    origin: SITE,
    cookie: cookie ?? "",
  });
  expect(starterPoll.status).toBe(410);
  expect(await starterPoll.json()).toMatchObject({ error: "callback_failed" });
});

test("a poll without the starting browser's cookie receives nothing", async () => {
  const w = worker();
  const { flow, state, cookie } = await startWeb(w);
  const callback = await w.request(
    `/v1/oauth/callback?state=${state}&code=fixturecode1`,
    { headers: { cookie: `__Host-slop_oauth_state=${state}; ${cookie}` } },
  );
  expect(callback.status).toBe(200);
  for (const headers of [{}, { origin: SITE }] as Record<string, string>[]) {
    const refused = await poll(w, flow, headers);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "browser_mismatch" });
  }
  // The refused polls did not consume the flow for its own browser.
  const own = await poll(w, flow, { origin: SITE, cookie: cookie ?? "" });
  expect(own.status).toBe(200);
});

test("the starting browser completes its own website sign-in", async () => {
  const w = worker();
  const { flow, state, cookie } = await startWeb(w);
  expect(cookie).not.toBeNull();
  const pending = await poll(w, flow, { origin: SITE, cookie: cookie ?? "" });
  expect(pending.status).toBe(202);
  const authorizeUrl = new URL(flow.authorizationUrl);
  const authorized = await w.request(
    `${authorizeUrl.pathname}${authorizeUrl.search}`,
    { headers: { cookie: cookie ?? "" } },
  );
  expect(authorized.status).toBe(302);
  expect(new URL(authorized.headers.get("location") ?? "").origin).toBe(
    "https://github.com",
  );
  const callback = await w.request(
    `/v1/oauth/callback?state=${state}&code=fixturecode1`,
    { headers: { cookie: `${cookie}; __Host-slop_oauth_state=${state}` } },
  );
  expect(callback.status).toBe(200);
  const completed = await poll(w, flow, {
    origin: SITE,
    cookie: cookie ?? "",
  });
  expect(completed.status).toBe(200);
  expect(completed.headers.get("access-control-allow-credentials")).toBe(
    "true",
  );
  expect(await completed.json()).toMatchObject({
    status: "complete",
    assertionType: "SlopIdentity",
  });
  // The binding cookie is cleared once the assertion is issued.
  expect(
    completed.headers
      .getSetCookie()
      .some(
        (value) =>
          value.startsWith(`__Host-slop_oauth_bind_${flow.flowId}=;`) &&
          value.includes("Max-Age=0"),
      ),
  ).toBe(true);
});

test("a website flow stored without a binding cannot be authorized", async () => {
  const w = worker();
  const { flow, cookie } = await startWeb(w);
  w.sqlite
    .prepare(
      "UPDATE identity_oauth_flows SET browser_binding_hash = NULL WHERE id = ?",
    )
    .run(flow.flowId);
  const authorizeUrl = new URL(flow.authorizationUrl);
  const refused = await w.request(
    `${authorizeUrl.pathname}${authorizeUrl.search}`,
    { headers: { cookie: cookie ?? "" } },
  );
  expect(refused.status).toBe(403);
});

test("the terminal (CLI) audience keeps its unbound protocol", async () => {
  const w = worker();
  const started = await w.post("/v1/oauth/start", {
    audience: "private-trace-api",
  });
  expect(started.status).toBe(201);
  expect(
    started.headers
      .getSetCookie()
      .some((value) => value.startsWith("__Host-slop_oauth_bind_")),
  ).toBe(false);
  const flow = (await started.json()) as Started;
  const authorizeUrl = new URL(flow.authorizationUrl);
  const authorized = await w.request(
    `${authorizeUrl.pathname}${authorizeUrl.search}`,
  );
  expect(authorized.status).toBe(302);
  const pending = await poll(w, flow, {}, "private-trace-api");
  expect(pending.status).toBe(202);
});

test("browser preflight allows credentialed start and poll from the site only", async () => {
  const w = worker();
  const preflight = await w.request("/v1/oauth/start", {
    method: "OPTIONS",
    headers: {
      origin: SITE,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe(SITE);
  expect(preflight.headers.get("access-control-allow-credentials")).toBe(
    "true",
  );
  const foreign = await w.post(
    "/v1/oauth/start",
    { audience: "slop-points-web" },
    { origin: "https://attacker.example" },
  );
  expect(foreign.status).toBe(403);
  expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
});
