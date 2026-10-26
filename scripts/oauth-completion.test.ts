import { expect, test } from "bun:test";
import type { OAuthFlow } from "../workers/identity/contracts";
import { encryptPkceVerifier } from "../workers/identity/crypto";
import {
  handleIdentityRequest,
  type IdentityWorkerDependencies,
} from "../workers/identity/handler";

for (const scenario of [
  "success",
  "invalid-state",
  "expired",
  "identity-failed",
  "already-completed",
] as const) {
  test(`OAuth completion: ${scenario} preserves the success/error boundary`, async () => {
    const state = "a".repeat(43);
    const secret = Buffer.alloc(32, 7).toString("base64url");
    const flowId = `flow_${"b".repeat(24)}`;
    const encrypted = await encryptPkceVerifier("p".repeat(43), flowId, secret);
    const flow: OAuthFlow = {
      id: flowId,
      stateHash: "fixture",
      pollCapabilityHash: "fixture",
      encryptedPkceVerifier: encrypted.ciphertext,
      pkceIv: encrypted.iv,
      audience: "slop-points-web",
      status: "callback_processing",
      githubActorId: null,
      githubLogin: null,
      githubNodeId: null,
      createdAt: "2026-10-16T00:00:00Z",
      expiresAt: "2026-10-16T00:05:00Z",
      callbackCompletedAt: null,
      assertionIssuedAt: null,
    };
    let persisted = false;
    const deps: IdentityWorkerDependencies = {
      tier: "staging",
      stateEncryptionSecret: secret,
      assertionSecret: secret,
      githubClientId: "synthetic-local",
      now: () => new Date("2026-10-16T00:01:00Z"),
      randomToken: () => state,
      resolveGithubIdentity: async () =>
        scenario === "identity-failed"
          ? null
          : {
              githubActorId: "123",
              githubLogin: "fixture-private-login",
              githubNodeId: "U_fixture",
            },
      persistence: {
        createFlow: async () => false,
        findAuthorizableFlow: async () => null,
        claimCallback: async () => (scenario === "expired" ? null : flow),
        completeCallback: async () => {
          persisted = scenario !== "already-completed";
          return persisted;
        },
        findPollableFlow: async () => null,
        createAssertion: async () => null,
        markAssertionIssued: async () => false,
        consumeAssertion: async () => null,
        deleteExpired: async () => {},
      },
    };
    const response = await handleIdentityRequest(
      new Request(
        `https://identity-staging.slop.cash/v1/oauth/callback?state=${scenario === "invalid-state" ? "invalid" : state}&code=fixture_private_code`,
        { headers: { cookie: `__Host-slop_oauth_state=${state}` } },
      ),
      deps,
    );
    const body = await response.text();
    expect(response.status).toBe(
      {
        success: 200,
        "invalid-state": 400,
        expired: 410,
        "identity-failed": 502,
        "already-completed": 409,
      }[scenario],
    );
    expect(body).not.toMatch(
      /fixture_private_code|fixture-private-login|flow_b/,
    );
    expect(body).toContain('href="https://staging.slop.cash"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (scenario === "success") {
      expect(persisted).toBe(true);
      expect(body).not.toContain("close automatically");
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    } else {
      expect(persisted).toBe(false);
    }
    expect(body).not.toMatch(/<script|window.close/);
  });
}
