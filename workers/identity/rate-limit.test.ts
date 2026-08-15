/** Exercises the identity Worker limiter boundary with the same bindings production uses. */
import { describe, expect, it } from "vitest";
import { applyIdentityRateLimit } from "./index";

function limiter(success: boolean) {
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }: { key: string }) {
      keys.push(key);
      return { success };
    },
  };
}

describe("identity rate limits", () => {
  it.each([
    ["/v1/oauth/start", "start"],
    ["/v1/oauth/poll", "poll"],
  ])("returns a stable 429 for %s", async (path, selected) => {
    const start = limiter(selected !== "start");
    const poll = limiter(selected !== "poll");
    const response = await applyIdentityRateLimit(
      new Request(`https://identity.slop.cash${path}`, {
        method: "POST",
        headers: { "cf-connecting-ip": "2001:db8::1" },
      }),
      {
        IDENTITY_START_LIMITER: start,
        IDENTITY_POLL_LIMITER: poll,
      },
    );

    expect(response?.status).toBe(429);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(await response?.json()).toEqual({
      error: "rate_limited",
      message: "Too many requests. Try again later.",
    });
    expect(selected === "start" ? start.keys : poll.keys).toEqual([
      "2001:db8::1",
    ]);
  });

  it("allows requests below the limit", async () => {
    const start = limiter(true);
    const response = await applyIdentityRateLimit(
      new Request("https://identity.slop.cash/v1/oauth/start", {
        method: "POST",
        headers: { "cf-connecting-ip": "192.0.2.1" },
      }),
      {
        IDENTITY_START_LIMITER: start,
        IDENTITY_POLL_LIMITER: limiter(true),
      },
    );

    expect(response).toBeNull();
    expect(start.keys).toEqual(["192.0.2.1"]);
  });

  it("fails closed when a limiter is unavailable", async () => {
    const response = await applyIdentityRateLimit(
      new Request("https://identity.slop.cash/v1/oauth/start", {
        method: "POST",
      }),
      {
        IDENTITY_START_LIMITER: {
          limit: async () => {
            throw new Error("provider detail must not escape");
          },
        },
        IDENTITY_POLL_LIMITER: limiter(true),
      },
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(await response?.json()).toEqual({
      error: "service_unavailable",
      message: "Identity service is temporarily unavailable.",
    });
  });

  it.each([
    ["GET", "/v1/oauth/authorize"],
    ["GET", "/v1/oauth/callback"],
    ["POST", "/v1/assertions/consume"],
    ["POST", "/not-found"],
  ])("does not count %s %s", async (method, path) => {
    const start = limiter(false);
    const poll = limiter(false);
    const response = await applyIdentityRateLimit(
      new Request(`https://identity.slop.cash${path}`, { method }),
      {
        IDENTITY_START_LIMITER: start,
        IDENTITY_POLL_LIMITER: poll,
      },
    );

    expect(response).toBeNull();
    expect(start.keys).toEqual([]);
    expect(poll.keys).toEqual([]);
  });
});
