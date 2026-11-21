import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { resolveGithubIdentity } from "./index";

const env = {
  GITHUB_APP_CLIENT_ID: "fixture-client-id",
  GITHUB_APP_CLIENT_SECRET: "fixture-client-secret-never-log",
};
const code = "fixture-one-use-code-never-log";
const verifier = "fixture-pkce-verifier-never-log";
const accessToken = "ghu_fixture-access-token-never-log";
const user = {
  id: 12345,
  login: "fixture-user",
  node_id: "U_fixture",
  type: "User",
};
let errors: ReturnType<typeof spyOn<typeof console, "error">>;
beforeEach(() => {
  errors = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

test("the actual resolver exchanges the one-use code and verifies the authenticated user", async () => {
  const calls: string[] = [];
  const result = await resolveGithubIdentity(
    code,
    verifier,
    env,
    async (url, init) => {
      calls.push(url);
      if (calls.length === 1) {
        expect(url).toBe("https://github.com/login/oauth/access_token");
        expect(init?.method).toBe("POST");
        const body = init?.body as URLSearchParams;
        expect(Object.fromEntries(body)).toEqual({
          client_id: env.GITHUB_APP_CLIENT_ID,
          client_secret: env.GITHUB_APP_CLIENT_SECRET,
          code,
          code_verifier: verifier,
          redirect_uri: "https://identity.slop.cash/v1/oauth/callback",
        });
        return Response.json({
          access_token: accessToken,
          token_type: "bearer",
        });
      }
      expect(url).toBe("https://api.github.com/user");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${accessToken}`,
      );
      return Response.json(user);
    },
  );
  expect(result).toEqual({
    githubActorId: "12345",
    githubLogin: "fixture-user",
    githubNodeId: "U_fixture",
  });
  expect(calls).toHaveLength(2);
  expect(errors).not.toHaveBeenCalled();
});

for (const [error, diagnostic] of [
  ["incorrect_client_credentials", "incorrect_client_credentials"],
  ["bad_verification_code", "bad_verification_code"],
  ["redirect_uri_mismatch", "redirect_uri_mismatch"],
  [env.GITHUB_APP_CLIENT_SECRET, undefined],
] as const) {
  test(`token error JSON stays a refusal with a safe ${diagnostic ?? "unknown"} category`, async () => {
    let calls = 0;
    const result = await resolveGithubIdentity(
      code,
      verifier,
      env,
      async () => {
        calls++;
        return Response.json({
          error,
          error_description: accessToken,
          error_uri: `https://fixture.invalid/${code}`,
        });
      },
    );
    expect(result).toBeNull();
    expect(calls).toBe(1);
    expect(errors.mock.calls).toEqual([
      [
        JSON.stringify({
          event: "github_identity_failed",
          stage: "token",
          reason: "invalid-response",
          httpStatus: 200,
          ...(diagnostic ? { oauthError: diagnostic } : {}),
        }),
      ],
    ]);
  });
}

for (const stage of ["token", "user"] as const) {
  for (const status of [401, 403, 429, 503]) {
    test(`${stage} HTTP ${status} reports only stage and status`, async () => {
      let calls = 0;
      expect(
        await resolveGithubIdentity(code, verifier, env, async () => {
          calls++;
          if (stage === "user" && calls === 1)
            return Response.json({
              access_token: accessToken,
              token_type: "Bearer",
            });
          return new Response(env.GITHUB_APP_CLIENT_SECRET, { status });
        }),
      ).toBeNull();
      expect(calls).toBe(stage === "token" ? 1 : 2);
      expect(errors.mock.calls).toEqual([
        [
          JSON.stringify({
            event: "github_identity_failed",
            stage,
            reason: "http-rejected",
            httpStatus: status,
          }),
        ],
      ]);
    });
  }
  test(`${stage} transport exceptions retain failure behavior without logging the cause`, async () => {
    let calls = 0;
    const failure = new Error(`${accessToken} ${code} ${verifier}`);
    await expect(
      resolveGithubIdentity(code, verifier, env, async () => {
        calls++;
        if (stage === "user" && calls === 1)
          return Response.json({
            access_token: accessToken,
            token_type: "bearer",
          });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(errors.mock.calls).toEqual([
      [
        JSON.stringify({
          event: "github_identity_failed",
          stage,
          reason: "request-or-response-failed",
        }),
      ],
    ]);
  });
}

test("a malformed user remains unverified and does not log identity fields", async () => {
  let calls = 0;
  expect(
    await resolveGithubIdentity(code, verifier, env, async () => {
      if (calls++ === 0)
        return Response.json({
          access_token: accessToken,
          token_type: "bearer",
        });
      return Response.json({ id: "12345", login: accessToken, node_id: code });
    }),
  ).toBeNull();
  expect(errors.mock.calls).toEqual([
    [
      JSON.stringify({
        event: "github_identity_failed",
        stage: "user",
        reason: "invalid-response",
        httpStatus: 200,
      }),
    ],
  ]);
});

test("malformed provider JSON keeps its existing exception behavior and logs no response bytes", async () => {
  await expect(
    resolveGithubIdentity(
      code,
      verifier,
      env,
      async () => new Response(`{${accessToken}`),
    ),
  ).rejects.toThrow();
  expect(errors.mock.calls).toEqual([
    [
      JSON.stringify({
        event: "github_identity_failed",
        stage: "token",
        reason: "request-or-response-failed",
      }),
    ],
  ]);
});
