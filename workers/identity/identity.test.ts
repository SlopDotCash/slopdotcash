import { describe, expect, it } from "vitest";
import {
  IDENTITY_AUDIENCE,
  type IdentityAssertion,
  type IdentityPersistence,
  type OAuthFlow,
} from "./contracts";
import { sha256Hex } from "./crypto";
import {
  handleIdentityRequest,
  type IdentityWorkerDependencies,
} from "./handler";
import { MAX_GITHUB_RESPONSE_BYTES, readBoundedGithubJson } from "./index";

const NOW = new Date("2026-08-15T20:00:00.000Z");
const STATE_SECRET = "A".repeat(43);
const ASSERTION_SECRET = "B".repeat(43);

class MemoryIdentityPersistence implements IdentityPersistence {
  readonly flows = new Map<string, OAuthFlow>();
  readonly assertions = new Map<string, IdentityAssertion>();

  async createFlow(flow: OAuthFlow): Promise<boolean> {
    if (this.flows.has(flow.id)) return false;
    this.flows.set(flow.id, { ...flow });
    return true;
  }

  async findAuthorizableFlow(
    flowId: string,
    stateHash: string,
    now: string,
  ): Promise<OAuthFlow | null> {
    const flow = this.flows.get(flowId);
    return flow !== undefined &&
      flow.stateHash === stateHash &&
      flow.status === "pending" &&
      flow.expiresAt > now
      ? { ...flow }
      : null;
  }

  async claimCallback(
    stateHash: string,
    now: string,
  ): Promise<OAuthFlow | null> {
    const flow = [...this.flows.values()].find(
      (item) =>
        item.stateHash === stateHash &&
        item.status === "pending" &&
        item.expiresAt > now,
    );
    if (flow === undefined) return null;
    const original = { ...flow };
    this.flows.set(flow.id, {
      ...flow,
      status: "callback_processing",
      encryptedPkceVerifier: null,
      pkceIv: null,
    });
    return original;
  }

  async completeCallback(
    flowId: string,
    githubActorId: string,
    githubLogin: string,
    completedAt: string,
  ): Promise<boolean> {
    const flow = this.flows.get(flowId);
    if (flow?.status !== "callback_processing") return false;
    this.flows.set(flowId, {
      ...flow,
      status: "callback_complete",
      githubActorId,
      githubLogin,
      callbackCompletedAt: completedAt,
    });
    return true;
  }

  async findPollableFlow(
    flowId: string,
    pollCapabilityHash: string,
    now: string,
  ): Promise<OAuthFlow | null> {
    const flow = this.flows.get(flowId);
    return flow !== undefined &&
      flow.pollCapabilityHash === pollCapabilityHash &&
      flow.expiresAt > now
      ? { ...flow }
      : null;
  }

  async createAssertion(assertion: IdentityAssertion): Promise<void> {
    if (!this.assertions.has(assertion.tokenHash)) {
      this.assertions.set(assertion.tokenHash, { ...assertion });
    }
  }

  async markAssertionIssued(
    flowId: string,
    issuedAt: string,
  ): Promise<boolean> {
    const flow = this.flows.get(flowId);
    if (flow?.status !== "callback_complete") return false;
    this.flows.set(flowId, {
      ...flow,
      status: "assertion_issued",
      assertionIssuedAt: issuedAt,
    });
    return true;
  }

  async consumeAssertion(
    tokenHash: string,
    audience: string,
    now: string,
  ): Promise<IdentityAssertion | null> {
    const assertion = this.assertions.get(tokenHash);
    if (
      assertion === undefined ||
      assertion.audience !== audience ||
      assertion.expiresAt <= now ||
      assertion.consumedAt !== null
    ) {
      return null;
    }
    const consumed = { ...assertion, consumedAt: now };
    this.assertions.set(tokenHash, consumed);
    return consumed;
  }

  async deleteExpired(now: string): Promise<void> {
    for (const [id, flow] of this.flows) {
      if (flow.expiresAt <= now) this.flows.delete(id);
    }
    for (const [hash, assertion] of this.assertions) {
      if (assertion.expiresAt <= now) this.assertions.delete(hash);
    }
  }
}

let randomCounter = 0;
function deterministicToken(bytes = 32): string {
  randomCounter += 1;
  const prefix = `${randomCounter.toString(36)}_`;
  return `${prefix}${"x".repeat(Math.max(0, Math.ceil((bytes * 4) / 3) - prefix.length))}`;
}

function dependencies(store = new MemoryIdentityPersistence()) {
  const resolved: Array<{ code: string; verifier: string }> = [];
  const deps: IdentityWorkerDependencies = {
    persistence: store,
    stateEncryptionSecret: STATE_SECRET,
    assertionSecret: ASSERTION_SECRET,
    githubClientId: "Iv1.test-client-id",
    now: () => new Date(NOW),
    randomToken: deterministicToken,
    resolveGithubIdentity: async (code, verifier) => {
      resolved.push({ code, verifier });
      return { githubActorId: "123456", githubLogin: "octocat" };
    },
  };
  return { deps, resolved, store };
}

function jsonRequest(
  host: string,
  path: string,
  body: Record<string, unknown>,
) {
  return new Request(`https://${host}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function start(deps: IdentityWorkerDependencies) {
  const response = await handleIdentityRequest(
    jsonRequest("identity.slop.cash", "/v1/oauth/start", {
      audience: IDENTITY_AUDIENCE,
    }),
    deps,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    flowId: string;
    authorizationUrl: string;
    pollCapability: string;
    expiresAt: string;
    pollAfterSeconds: number;
  };
}

async function authorizeAndCallback(
  deps: IdentityWorkerDependencies,
  flow: Awaited<ReturnType<typeof start>>,
) {
  const authorize = await handleIdentityRequest(
    new Request(flow.authorizationUrl),
    deps,
  );
  expect(authorize.status).toBe(302);
  const githubUrl = new URL(authorize.headers.get("location") ?? "");
  const state = githubUrl.searchParams.get("state");
  expect(githubUrl.origin).toBe("https://github.com");
  expect(githubUrl.pathname).toBe("/login/oauth/authorize");
  expect(githubUrl.searchParams.get("redirect_uri")).toBe(
    "https://identity.slop.cash/v1/oauth/callback",
  );
  expect(githubUrl.searchParams.get("code_challenge_method")).toBe("S256");
  expect(githubUrl.searchParams.has("scope")).toBe(false);
  const setCookie = authorize.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";", 1)[0];
  const callback = await handleIdentityRequest(
    new Request(
      `https://identity.slop.cash/v1/oauth/callback?code=oauth_code_12345&state=${state}`,
      { headers: { cookie } },
    ),
    deps,
  );
  return { authorize, callback, state };
}

describe("slop identity worker", () => {
  it("cancels oversized GitHub responses without buffering the full body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_GITHUB_RESPONSE_BYTES / 2 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBoundedGithubJson(new Response(body))).rejects.toThrow(
      /size limit/u,
    );
    expect(cancelled).toBe(true);
  });

  it("cancels oversized request bodies before buffering the full body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(2049));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { deps } = dependencies();
    const response = await handleIdentityRequest(
      new Request("https://identity.slop.cash/v1/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      deps,
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("completes OAuth and returns a one-time audience-bound assertion by polling", async () => {
    const { deps, resolved, store } = dependencies();
    const flow = await start(deps);
    expect(flow.authorizationUrl).toMatch(
      /^https:\/\/identity\.slop\.cash\/v1\/oauth\/authorize/u,
    );
    expect(flow.pollCapability).not.toContain(flow.flowId);
    const storedBefore = store.flows.get(flow.flowId);
    expect(storedBefore?.encryptedPkceVerifier).not.toContain("x".repeat(40));
    expect(storedBefore?.pollCapabilityHash).not.toBe(flow.pollCapability);

    const pending = await handleIdentityRequest(
      jsonRequest("identity.slop.cash", "/v1/oauth/poll", {
        flowId: flow.flowId,
        pollCapability: flow.pollCapability,
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    expect(pending.status).toBe(202);

    const { callback } = await authorizeAndCallback(deps, flow);
    expect(callback.status).toBe(200);
    expect(await callback.text()).not.toContain("oauth_code_12345");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].code).toBe("oauth_code_12345");
    expect(resolved[0].verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/u);
    expect(store.flows.get(flow.flowId)?.encryptedPkceVerifier).toBeNull();

    const completed = await handleIdentityRequest(
      jsonRequest("identity.slop.cash", "/v1/oauth/poll", {
        flowId: flow.flowId,
        pollCapability: flow.pollCapability,
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    expect(completed.status).toBe(200);
    const completion = (await completed.json()) as {
      assertion: string;
      status: string;
    };
    expect(completion).toMatchObject({ status: "complete" });
    expect(completion.assertion).toMatch(/^slop_assert_v1_/u);
    expect(completion).not.toHaveProperty("role");

    const replay = await handleIdentityRequest(
      jsonRequest("identity.slop.cash", "/v1/oauth/poll", {
        flowId: flow.flowId,
        pollCapability: flow.pollCapability,
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    expect(replay.status).toBe(410);

    const consumed = await handleIdentityRequest(
      new Request("https://identity.internal/v1/assertions/consume", {
        method: "POST",
        headers: {
          authorization: `Bearer ${completion.assertion}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ audience: IDENTITY_AUDIENCE }),
      }),
      deps,
    );
    expect(consumed.status).toBe(200);
    expect(await consumed.json()).toEqual({
      githubActorId: "123456",
      githubLogin: "octocat",
      audience: IDENTITY_AUDIENCE,
    });
    const consumeReplay = await handleIdentityRequest(
      new Request("https://identity.internal/v1/assertions/consume", {
        method: "POST",
        headers: {
          authorization: `Bearer ${completion.assertion}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ audience: IDENTITY_AUDIENCE }),
      }),
      deps,
    );
    expect(consumeReplay.status).toBe(401);
  });

  it("requires the browser-bound CSRF cookie and consumes callback state once", async () => {
    const { deps, resolved } = dependencies();
    const flow = await start(deps);
    const authorize = await handleIdentityRequest(
      new Request(flow.authorizationUrl),
      deps,
    );
    const githubUrl = new URL(authorize.headers.get("location") ?? "");
    const state = githubUrl.searchParams.get("state");
    const missingCookie = await handleIdentityRequest(
      new Request(
        `https://identity.slop.cash/v1/oauth/callback?code=oauth_code_12345&state=${state}`,
      ),
      deps,
    );
    expect(missingCookie.status).toBe(400);
    expect(resolved).toHaveLength(0);

    const cookie = (authorize.headers.get("set-cookie") ?? "").split(";", 1)[0];
    const valid = await handleIdentityRequest(
      new Request(
        `https://identity.slop.cash/v1/oauth/callback?code=oauth_code_12345&state=${state}`,
        { headers: { cookie } },
      ),
      deps,
    );
    expect(valid.status).toBe(200);
    const replay = await handleIdentityRequest(
      new Request(
        `https://identity.slop.cash/v1/oauth/callback?code=oauth_code_12345&state=${state}`,
        { headers: { cookie } },
      ),
      deps,
    );
    expect(replay.status).toBe(410);
    expect(resolved).toHaveLength(1);
  });

  it("fails closed before persistence when the encryption secret is malformed", async () => {
    const { deps, store } = dependencies();
    deps.stateEncryptionSecret = "not-base64url";
    const response = await handleIdentityRequest(
      jsonRequest("identity.slop.cash", "/v1/oauth/start", {
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "internal_error",
      message: "Internal error",
    });
    expect(store.flows.size).toBe(0);
  });

  it("normalizes non-Error failures without dropping the response boundary", async () => {
    const { deps, store } = dependencies();
    deps.now = () => {
      throw null;
    };
    const response = await handleIdentityRequest(
      jsonRequest("identity.slop.cash", "/v1/oauth/start", {
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "internal_error",
      message: "Internal error",
    });
    expect(store.flows.size).toBe(0);
  });

  it("keeps assertion consumption internal and strictly fixes the callback", async () => {
    const { deps } = dependencies();
    const publicConsume = await handleIdentityRequest(
      jsonRequest("identity.slop.cash", "/v1/assertions/consume", {
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    expect(publicConsume.status).toBe(404);
    const fakeReturn = await handleIdentityRequest(
      jsonRequest("identity.slop.cash", "/v1/oauth/start", {
        audience: IDENTITY_AUDIENCE,
        returnTo: "https://attacker.example/callback",
      }),
      deps,
    );
    expect(fakeReturn.status).toBe(400);
    const unknownHost = await handleIdentityRequest(
      jsonRequest("attacker.example", "/v1/oauth/start", {
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    expect(unknownHost.status).toBe(404);
    const publicAlternatePort = await handleIdentityRequest(
      jsonRequest("identity.slop.cash:444", "/v1/oauth/start", {
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    expect(publicAlternatePort.status).toBe(404);
    const internalAlternatePort = await handleIdentityRequest(
      new Request("https://identity.internal:444/v1/assertions/consume", {
        method: "POST",
      }),
      deps,
    );
    expect(internalAlternatePort.status).toBe(404);
  });

  it("rejects a wrong poll capability without disclosing flow state", async () => {
    const { deps } = dependencies();
    const flow = await start(deps);
    const response = await handleIdentityRequest(
      jsonRequest("identity.slop.cash", "/v1/oauth/poll", {
        flowId: flow.flowId,
        pollCapability: `wrong_${"x".repeat(40)}`,
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: "flow_unavailable" });
  });

  it("binds assertions to the numeric GitHub actor and exact audience", async () => {
    const { deps } = dependencies();
    const flow = await start(deps);
    await authorizeAndCallback(deps, flow);
    const completed = await handleIdentityRequest(
      jsonRequest("identity.slop.cash", "/v1/oauth/poll", {
        flowId: flow.flowId,
        pollCapability: flow.pollCapability,
        audience: IDENTITY_AUDIENCE,
      }),
      deps,
    );
    const { assertion } = (await completed.json()) as { assertion: string };
    expect(await sha256Hex(assertion)).toMatch(/^[a-f0-9]{64}$/u);
    const wrongAudience = await handleIdentityRequest(
      new Request("https://identity.internal/v1/assertions/consume", {
        method: "POST",
        headers: {
          authorization: `Bearer ${assertion}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ audience: "some-other-api" }),
      }),
      deps,
    );
    expect(wrongAudience.status).toBe(400);
  });
});
