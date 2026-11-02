// A callback whose GitHub exchange fails ends its flow, so the original tab or
// terminal stops polling instead of hearing "pending" until expiry.
import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { randomToken } from "./crypto";
import { handleIdentityRequest } from "./handler";
import { D1IdentityPersistence } from "./persistence";

const LOCAL = "http://localhost:4466";
type Resolve = () => Promise<{
  githubActorId: string;
  githubLogin: string;
  githubNodeId?: string;
} | null>;

async function signIn(
  resolveGithubIdentity: Resolve,
  callbackQuery = "code=fixturecode1",
  bindStateCookie = true,
) {
  const persistence = new D1IdentityPersistence(sqliteD1().db as never);
  const deps = {
    persistence,
    stateEncryptionSecret: Buffer.alloc(32, 1).toString("base64url"),
    assertionSecret: Buffer.alloc(32, 2).toString("base64url"),
    githubClientId: "Iv1.localfixture",
    publicOrigin: LOCAL,
    allowLoopback: true,
    now: () => new Date(),
    randomToken,
    resolveGithubIdentity,
  };
  const post = (path: string, body: unknown) =>
    handleIdentityRequest(
      new Request(`${LOCAL}${path}`, {
        method: "POST",
        headers: { origin: LOCAL, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      deps,
    );
  const flow = (await (
    await post("/v1/oauth/start", { audience: "slop-points-web" })
  ).json()) as {
    flowId: string;
    pollCapability: string;
    authorizationUrl: string;
  };
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  const callback = await handleIdentityRequest(
    new Request(`${LOCAL}/v1/oauth/callback?state=${state}&${callbackQuery}`, {
      headers: bindStateCookie
        ? { cookie: `__Host-slop_oauth_state=${state}` }
        : {},
    }),
    deps,
  ).then((response) => response.status);
  const poll = await post("/v1/oauth/poll", {
    flowId: flow.flowId,
    pollCapability: flow.pollCapability,
    audience: "slop-points-web",
  });
  return { callback, poll, persistence, flowId: flow.flowId };
}

for (const [name, resolve] of [
  ["an unverified GitHub identity", async () => null],
  [
    "a GitHub identity without a node ID",
    async () => ({ githubActorId: "1", githubLogin: "octo" }),
  ],
  [
    "a failed GitHub exchange",
    async () => {
      throw new Error("exchange failed");
    },
  ],
] as [string, Resolve][])
  test(`${name} ends the flow instead of polling as pending`, async () => {
    const { callback, poll, persistence, flowId } = await signIn(resolve);
    // The browser response is unchanged: 502, or 500 for an exchange error.
    expect(callback).toBe(name === "a failed GitHub exchange" ? 500 : 502);
    expect(poll.status).toBe(410);
    expect(await poll.json()).toMatchObject({ error: "callback_failed" });
    // A failed flow cannot be completed afterwards.
    expect(
      await persistence.completeCallback(
        flowId,
        "1",
        "octo",
        new Date().toISOString(),
        "U_x",
      ),
    ).toBe(false);
    expect(await persistence.failCallback(flowId)).toBe(false);
  });

test("a verified GitHub identity still completes the flow", async () => {
  const { callback, poll } = await signIn(async () => ({
    githubActorId: "1",
    githubLogin: "octo",
    githubNodeId: "MDQ6VXNlcjE=",
  }));
  expect(callback).toBe(200);
  expect(poll.status).toBe(200);
  expect(await poll.json()).toMatchObject({ status: "complete" });
});

for (const error of [
  "access_denied",
  "application_suspended",
  "redirect_uri_mismatch",
])
  test(`GitHub authorization error ${error} ends the flow instead of polling as pending`, async () => {
    const { callback, poll } = await signIn(async () => {
      throw new Error("A rejected authorization has no code to exchange");
    }, `error=${error}`);
    expect(callback).toBe(400);
    expect(poll.status).toBe(410);
    expect(await poll.json()).toMatchObject({ error: "callback_failed" });
  });

test("an authorization error without the state cookie cannot end the flow", async () => {
  const { callback, poll } = await signIn(
    async () => {
      throw new Error("An unbound callback cannot exchange a code");
    },
    "error=access_denied",
    false,
  );
  expect(callback).toBe(400);
  expect(poll.status).toBe(202);
  expect(await poll.json()).toMatchObject({ status: "pending" });
});
