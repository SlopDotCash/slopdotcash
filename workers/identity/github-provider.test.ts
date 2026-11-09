// Source-authored resolver regressions, unexecuted in this audit. Synthetic
// provider responses exercise the real form/header/reader logic; they do not
// prove GitHub uptime, native redirect behavior, or callback persistence.
import { expect, test } from "bun:test";
import { resolveGithubIdentity } from "./index";

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const ACCESS = "synthetic_github_access_token";
const CODE = "synthetic-authorization-code";
const VERIFIER = "synthetic-pkce-verifier";
const env = () => ({
  GITHUB_APP_CLIENT_ID: "synthetic-client-id",
  GITHUB_APP_CLIENT_SECRET: "synthetic-client-secret",
});
const token = () => Response.json({ access_token: ACCESS, token_type: "bearer" });
const profile = () => ({ id: 123, login: "test-user", type: "User", node_id: "MDQ6VXNlcjEyMw==" });
type ProviderFetch = NonNullable<Parameters<typeof resolveGithubIdentity>[3]>;

function rejection(status: number, failCancel = false) {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    cancel() {
      cancelled = true;
      if (failCancel) throw new Error("Synthetic cancellation failure");
    },
  }), { status, headers: { location: "https://untrusted.example/redirect" } });
  return { response, cancelled: () => cancelled };
}

test("resolver binds the code, PKCE verifier, callback and credentials to the fixed token endpoint", async () => {
  const calls: string[] = [];
  const fetcher: ProviderFetch = async (url, init) => {
    calls.push(url);
    expect(init?.redirect).toBe("manual");
    if (url === TOKEN_URL) {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      const form = new URLSearchParams(String(init?.body));
      expect(Object.fromEntries(form)).toEqual({
        client_id: "synthetic-client-id",
        client_secret: "synthetic-client-secret",
        code: CODE,
        code_verifier: VERIFIER,
        redirect_uri: "https://identity.slop.cash/v1/oauth/callback",
      });
      return token();
    }
    expect(url).toBe(USER_URL);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${ACCESS}`);
    return Response.json({ ...profile(), access_token: "must-not-be-returned", email: "private@example.invalid" });
  };
  expect(await resolveGithubIdentity(CODE, VERIFIER, env(), fetcher)).toEqual({
    githubActorId: "123",
    githubLogin: "test-user",
    githubNodeId: "MDQ6VXNlcjEyMw==",
  });
  expect(calls).toEqual([TOKEN_URL, USER_URL]);
});

test("token callback uses the configured staging identity origin", async () => {
  let callback = "";
  const result = await resolveGithubIdentity(CODE, VERIFIER, {
    ...env(), SLOP_ENVIRONMENT: "staging",
  }, async (url, init) => {
    if (url === TOKEN_URL) {
      callback = new URLSearchParams(String(init?.body)).get("redirect_uri") ?? "";
      return token();
    }
    return Response.json(profile());
  });
  expect(callback).toBe("https://identity-staging.slop.cash/v1/oauth/callback");
  expect(result?.githubActorId).toBe("123");
});

test("every token redirect is refused without a second request or credential forwarding", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const refused = rejection(status);
    let calls = 0;
    const result = await resolveGithubIdentity(CODE, VERIFIER, env(), async (url, init) => {
      calls++;
      expect(url).toBe(TOKEN_URL);
      expect(init?.redirect).toBe("manual");
      return refused.response;
    });
    expect(result).toBeNull();
    expect(calls).toBe(1);
    expect(refused.cancelled()).toBe(true);
  }
});

test("authenticated profile redirects are refused without following their location", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const refused = rejection(status);
    const calls: string[] = [];
    const result = await resolveGithubIdentity(CODE, VERIFIER, env(), async (url, init) => {
      calls.push(url);
      expect(init?.redirect).toBe("manual");
      return url === TOKEN_URL ? token() : refused.response;
    });
    expect(result).toBeNull();
    expect(calls).toEqual([TOKEN_URL, USER_URL]);
    expect(refused.cancelled()).toBe(true);
  }
});

test("token HTTP refusals stay null even when response cancellation fails", async () => {
  for (const failCancel of [false, true]) {
    const refused = rejection(503, failCancel);
    let calls = 0;
    expect(await resolveGithubIdentity(CODE, VERIFIER, env(), async () => {
      calls++;
      return refused.response;
    })).toBeNull();
    expect(refused.cancelled()).toBe(true);
    expect(calls).toBe(1);
  }
});

test("profile HTTP refusals stay null even when response cancellation fails", async () => {
  for (const failCancel of [false, true]) {
    const refused = rejection(401, failCancel);
    let calls = 0;
    expect(await resolveGithubIdentity(CODE, VERIFIER, env(), async (url) => {
      calls++;
      return url === TOKEN_URL ? token() : refused.response;
    })).toBeNull();
    expect(refused.cancelled()).toBe(true);
    expect(calls).toBe(2);
  }
});

test("invalid token shapes stop before the profile request", async () => {
  for (const body of [
    null, [], {}, { access_token: 3, token_type: "bearer" },
    { access_token: "short", token_type: "bearer" },
    { access_token: "x".repeat(513), token_type: "bearer" },
    { access_token: ACCESS, token_type: "BEARER" },
    { access_token: ACCESS, token_type: "basic" },
  ]) {
    let calls = 0;
    expect(await resolveGithubIdentity(CODE, VERIFIER, env(), async (url) => {
      calls++;
      expect(url).toBe(TOKEN_URL);
      return Response.json(body);
    })).toBeNull();
    expect(calls).toBe(1);
  }
});

test("capitalized Bearer is supported without returning token response fields", async () => {
  expect(await resolveGithubIdentity(CODE, VERIFIER, env(), async (url) =>
    url === TOKEN_URL
      ? Response.json({ access_token: ACCESS, token_type: "Bearer", scope: "private" })
      : Response.json(profile()),
  )).toEqual({ githubActorId: "123", githubLogin: "test-user", githubNodeId: "MDQ6VXNlcjEyMw==" });
});

test("profile IDs and login syntax must validate before any identity is returned", async () => {
  for (const user of [
    null, [], {}, { ...profile(), id: 0 }, { ...profile(), id: -1 },
    { ...profile(), id: "123" }, { ...profile(), id: 1.5 },
    { ...profile(), id: Number.MAX_SAFE_INTEGER + 1 },
    { ...profile(), login: "bad name" }, { ...profile(), login: "x".repeat(40) },
  ]) {
    expect(await resolveGithubIdentity(CODE, VERIFIER, env(), async (url) =>
      url === TOKEN_URL ? token() : Response.json(user),
    )).toBeNull();
  }
});

test("optional node identity requires both a User profile and valid node syntax", async () => {
  for (const user of [
    { ...profile(), type: "Organization" },
    { ...profile(), node_id: undefined },
    { ...profile(), node_id: "invalid/node" },
  ]) {
    expect(await resolveGithubIdentity(CODE, VERIFIER, env(), async (url) =>
      url === TOKEN_URL ? token() : Response.json(user),
    )).toEqual({ githubActorId: "123", githubLogin: "test-user" });
  }
});

test("token and profile response size refusals cancel the oversized body", async () => {
  for (const oversizedAt of [TOKEN_URL, USER_URL]) {
    let cancelled = false;
    const oversized = new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { headers: { "content-length": String(64 * 1024 + 1) } });
    let calls = 0;
    await expect(resolveGithubIdentity(CODE, VERIFIER, env(), async (url) => {
      calls++;
      return url === oversizedAt ? oversized : token();
    })).rejects.toBeInstanceOf(RangeError);
    expect(cancelled).toBe(true);
    expect(calls).toBe(oversizedAt === TOKEN_URL ? 1 : 2);
  }
});

test("provider transport failures propagate without retrying or fabricating identity", async () => {
  for (const failedAt of [TOKEN_URL, USER_URL]) {
    const failure = new Error("Synthetic provider failure");
    let calls = 0;
    await expect(resolveGithubIdentity(CODE, VERIFIER, env(), async (url) => {
      calls++;
      if (url === failedAt) throw failure;
      return token();
    })).rejects.toBe(failure);
    expect(calls).toBe(failedAt === TOKEN_URL ? 1 : 2);
  }
});

test("malformed provider JSON propagates a reader failure rather than accepting identity", async () => {
  for (const failedAt of [TOKEN_URL, USER_URL]) {
    await expect(resolveGithubIdentity(CODE, VERIFIER, env(), async (url) =>
      url === failedAt ? new Response("not-json") : token(),
    )).rejects.toThrow("invalid JSON");
  }
});
