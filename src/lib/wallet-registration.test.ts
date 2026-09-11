import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareWalletRegistration,
  type RegisteredWalletClaim,
} from "./wallet-registration";

const ADDRESS = "11111111111111111111111111111111";
const OTHER = "So11111111111111111111111111111111111111112";
const actor = { githubActorId: "123", githubLogin: "octocat" };
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function proof(
  address = ADDRESS,
  supersedesClaimId: string | null = null,
): Promise<RegisteredWalletClaim> {
  const canonical = {
    schemaVersion: 1 as const,
    ...actor,
    address,
    source: "d1_registry" as const,
    issueRepository: null,
    issueNumber: null,
    sourceBodySha256: await digest({
      schemaVersion: 1,
      githubActorId: actor.githubActorId,
      address,
      supersedesClaimId,
    }),
    observedAt: new Date().toISOString(),
    supersedesClaimId,
  };
  return {
    ...canonical,
    claimId: "claim_test",
    recordDigest: await digest(canonical),
  };
}
function harness(
  options: {
    current?: RegisteredWalletClaim;
    created?: RegisteredWalletClaim;
    authorizationUrl?: string;
    pending?: boolean;
    status?: number;
  } = {},
) {
  const flowId = `flow_${"a".repeat(24)}`;
  const calls: { url: string; init: RequestInit }[] = [];
  const authorization = vi.fn();
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });
    if (url.endsWith("/oauth/start"))
      return json(
        {
          flowId,
          authorizationUrl:
            options.authorizationUrl ??
            `https://identity.slop.cash/v1/oauth/authorize?flow_id=${flowId}&state=${"s".repeat(43)}`,
          pollCapability: "p".repeat(43),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          pollAfterSeconds: 1,
        },
        201,
      );
    if (url.endsWith("/oauth/poll"))
      return options.pending
        ? json({ status: "pending", retryAfterSeconds: 1 }, 202)
        : json({
            status: "complete",
            assertionType: "SlopIdentity",
            assertion: `slop_assert_v1_${"x".repeat(43)}`,
            expiresAt: new Date(Date.now() + 90000).toISOString(),
          });
    if (url.endsWith("/auth/session")) {
      const exp = Math.floor(Date.now() / 1000) + 600;
      return json({
        tokenType: "Bearer",
        token: `header.${btoa(JSON.stringify({ iss: "slop.cash", aud: "private-trace-api", sub: "github:123", githubId: "123", githubLogin: "octocat", exp }))}.synthetic-signature`,
        expiresAt: new Date(exp * 1000).toISOString(),
      });
    }
    if (url.endsWith("/wallet-claims/current"))
      return options.current
        ? json(options.current)
        : json({ error: "not_found" }, 404);
    if (url.endsWith("/wallet-claims"))
      return json(options.created ?? (await proof()), options.status ?? 201);
    throw new Error("Unexpected synthetic route");
  };
  return { calls, authorization, fetcher };
}
async function preview(h: ReturnType<typeof harness>, signal?: AbortSignal) {
  const pending = prepareWalletRegistration(ADDRESS, {
    fetch: h.fetcher,
    authorize: h.authorization,
    signal,
  });
  const outcome = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(1000);
  const result = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("wallet registration browser protocol", () => {
  it("resumes same-tab authorization without creating another flow or registering automatically", async () => {
    const h = harness();
    const save = vi.fn();
    const flowId = `flow_${"a".repeat(24)}`;
    const promise = prepareWalletRegistration(ADDRESS, {
      fetch: h.fetcher,
      authorize: h.authorization,
      saveAuthorization: save,
      resume: {
        flowId,
        pollCapability: "p".repeat(43),
        authorizationUrl: `https://identity.slop.cash/v1/oauth/authorize?flow_id=${flowId}&state=${"s".repeat(43)}`,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        pollAfterSeconds: 1,
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const session = await promise;
    expect(h.calls.some((call) => call.url.endsWith("/oauth/start"))).toBe(
      false,
    );
    expect(h.authorization).not.toHaveBeenCalled();
    expect(h.calls.some((call) => call.url.endsWith("/wallet-claims"))).toBe(
      false,
    );
    expect(save).toHaveBeenLastCalledWith(null);
    expect(session.preview.address).toBe(ADDRESS);
    session.cancel();
  });

  it("authenticates and previews without writing; confirmation posts the exact declaration and verifies proof", async () => {
    const h = harness();
    const session = await preview(h);
    expect(session.preview).toMatchObject({
      identity: actor,
      address: ADDRESS,
      current: null,
    });
    expect(h.calls.some((call) => call.url.endsWith("/wallet-claims"))).toBe(
      false,
    );
    const registered = await session.confirm();
    expect(registered.address).toBe(ADDRESS);
    const write = h.calls.find((call) => call.url.endsWith("/wallet-claims"));
    expect(JSON.parse(String(write?.init.body))).toEqual({
      address: ADDRESS,
      supersedesClaimId: null,
    });
    expect(
      h.calls.every(
        (call) =>
          call.init.credentials === "omit" &&
          call.init.redirect === "error" &&
          !call.url.includes("slop_assert") &&
          !call.url.includes("synthetic-signature"),
      ),
    ).toBe(true);
    await expect(session.confirm()).rejects.toThrow(/already submitted/);
  });
  it("binds predecessor and refuses attempts to mutate the displayed preview into a different registration", async () => {
    const current = await proof(OTHER);
    const created = await proof(ADDRESS, current.claimId);
    const h = harness({ current, created });
    const session = await preview(h);
    session.preview.address = OTHER;
    if (session.preview.current) session.preview.current.claimId = "tampered";
    await session.confirm();
    expect(JSON.parse(String(h.calls.at(-1)?.init.body))).toEqual({
      address: ADDRESS,
      supersedesClaimId: current.claimId,
    });
  });
  it("returns the verified existing claim without duplicate registration", async () => {
    const current = await proof();
    const h = harness({ current });
    const session = await preview(h);
    expect(await session.confirm()).toEqual(current);
    expect(h.calls.some((call) => call.url.endsWith("/wallet-claims"))).toBe(
      false,
    );
  });
  it.each(["address", "actor", "digest"])(
    "rejects returned %s mismatches without claiming success",
    async (field) => {
      const created = await proof(field === "address" ? OTHER : ADDRESS);
      if (field === "actor") created.githubActorId = "999";
      if (field === "digest") created.recordDigest = "0".repeat(64);
      const session = await preview(harness({ created }));
      await expect(session.confirm()).rejects.toThrow(
        /does not match|different GitHub|digest/,
      );
      await expect(session.confirm()).rejects.toThrow(/already submitted/);
    },
  );
  it("rejects a different current identity before preview", async () => {
    const current = await proof();
    current.githubActorId = "999";
    const pending = preview(harness({ current }));
    await expect(pending).rejects.toThrow(/different GitHub/);
  });
  it("cancels a preview and expires a session without a write", async () => {
    for (const expired of [false, true]) {
      const h = harness();
      const session = await preview(h);
      if (expired) await vi.advanceTimersByTimeAsync(600000);
      else session.cancel();
      await expect(session.confirm()).rejects.toThrow(/expired/);
      expect(h.calls.some((call) => call.url.endsWith("/wallet-claims"))).toBe(
        false,
      );
    }
  });
  it("cancels polling and stops a five-minute pending flow", async () => {
    const controller = new AbortController();
    const h = harness({ pending: true });
    const pending = prepareWalletRegistration(ADDRESS, {
      fetch: h.fetcher,
      authorize: h.authorization,
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow(/cancelled|timed out/);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await rejected;
    const timeout = prepareWalletRegistration(ADDRESS, {
      fetch: h.fetcher,
      authorize: h.authorization,
    });
    const timedOut = expect(timeout).rejects.toThrow(
      /cancelled|timed out|expired/,
    );
    await vi.advanceTimersByTimeAsync(300000);
    await timedOut;
    expect(h.calls.some((call) => call.url.endsWith("/auth/session"))).toBe(
      false,
    );
  });
  it("rejects an untrusted popup destination and invalid address before registration", async () => {
    const h = harness({ authorizationUrl: "https://evil.example/authorize" });
    await expect(
      prepareWalletRegistration(ADDRESS, {
        fetch: h.fetcher,
        authorize: h.authorization,
      }),
    ).rejects.toThrow(/invalid response/);
    expect(h.authorization).not.toHaveBeenCalled();
    const safe = harness();
    await expect(
      prepareWalletRegistration("seed words", {
        fetch: safe.fetcher,
        authorize: safe.authorization,
      }),
    ).rejects.toThrow(/public address/);
    expect(safe.calls).toHaveLength(0);
  });
  it("does not retry stale registration and requires a fresh current-claim review", async () => {
    const h = harness({ status: 409 });
    const session = await preview(h);
    await expect(session.confirm()).rejects.toThrow(/claim changed/);
    await expect(session.confirm()).rejects.toThrow(/already submitted/);
    expect(
      h.calls.filter((call) => call.url.endsWith("/wallet-claims")),
    ).toHaveLength(1);
  });
});
