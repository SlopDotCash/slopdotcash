/** Exercises the identity Worker's approximate edge and exact D1 admission boundary. */
import { describe, expect, it } from "vitest";
import { applyIdentityRateLimit } from "./index";
import type { D1Database } from "./persistence";
import { consumeExactRateLimit, deleteExpiredRateLimits } from "./rate-limit";

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

function database(options: { fail?: boolean } = {}) {
  const buckets = new Map<
    string,
    { expiresAt: number; requestCount: number; windowStartedAt: number }
  >();
  const observedKeyHashes: string[] = [];
  let tail = Promise.resolve();

  function serialize<T>(operation: () => T): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  const db: D1Database = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...nextValues: unknown[]) {
          values = nextValues;
          return statement;
        },
        async first<T>() {
          return serialize(() => {
            if (options.fail) throw new Error("D1 unavailable");
            expect(query).toContain("ON CONFLICT(key_hash) DO UPDATE");
            expect(query).toContain("RETURNING request_count, expires_at");
            const [keyHash, nowEpochSeconds, nextExpiry] = values;
            if (
              typeof keyHash !== "string" ||
              typeof nowEpochSeconds !== "number" ||
              typeof nextExpiry !== "number"
            ) {
              throw new TypeError("Unexpected exact limiter bindings");
            }
            observedKeyHashes.push(keyHash);
            const current = buckets.get(keyHash);
            const next =
              current === undefined || current.expiresAt <= nowEpochSeconds
                ? {
                    expiresAt: nextExpiry,
                    requestCount: 1,
                    windowStartedAt: nowEpochSeconds,
                  }
                : {
                    ...current,
                    requestCount: current.requestCount + 1,
                  };
            buckets.set(keyHash, next);
            return {
              expires_at: next.expiresAt,
              request_count: next.requestCount,
            } as T;
          });
        },
        async run() {
          if (options.fail) throw new Error("D1 unavailable");
          if (query.startsWith("DELETE FROM identity_rate_limits")) {
            const [nowEpochSeconds] = values;
            for (const [key, bucket] of buckets) {
              if (
                typeof nowEpochSeconds === "number" &&
                bucket.expiresAt <= nowEpochSeconds
              ) {
                buckets.delete(key);
              }
            }
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return statement;
    },
  };

  return { bucketCount: () => buckets.size, db, observedKeyHashes };
}

function environment(
  start = limiter(true),
  poll = limiter(true),
  exact = database(),
) {
  return {
    exact,
    value: {
      IDENTITY_DB: exact.db,
      IDENTITY_POLL_LIMITER: poll,
      IDENTITY_START_LIMITER: start,
      IDENTITY_STATE_KEY: "identity-state-key-for-tests",
    },
  };
}

function startRequest(ip = "192.0.2.1") {
  return new Request("https://identity.slop.cash/v1/oauth/start", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
  });
}

function pollRequest(ip = "192.0.2.1") {
  return new Request("https://identity.slop.cash/v1/oauth/poll", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
  });
}

describe("identity rate limits", () => {
  it.each([
    ["/v1/oauth/start", "start"],
    ["/v1/oauth/poll", "poll"],
  ])(
    "returns a stable 429 when the edge rejects %s",
    async (path, selected) => {
      const start = limiter(selected !== "start");
      const poll = limiter(selected !== "poll");
      const env = environment(start, poll);
      const response = await applyIdentityRateLimit(
        new Request(`https://identity.slop.cash${path}`, {
          method: "POST",
          headers: { "cf-connecting-ip": "2001:db8::1" },
        }),
        env.value,
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
      expect(env.exact.observedKeyHashes).toEqual([]);
    },
  );

  it("allows requests below the exact limit without persisting the raw IP", async () => {
    const start = limiter(true);
    const env = environment(start);
    const response = await applyIdentityRateLimit(startRequest(), env.value);

    expect(response).toBeNull();
    expect(start.keys).toEqual(["192.0.2.1"]);
    expect(env.exact.observedKeyHashes).toHaveLength(1);
    expect(env.exact.observedKeyHashes[0]).toMatch(/^[0-9a-f]{64}$/u);
    expect(env.exact.observedKeyHashes[0]).not.toContain("192.0.2.1");
  });

  it("admits exactly twelve concurrent start requests and rejects the thirteenth", async () => {
    const env = environment();
    const now = () => new Date("2026-08-15T23:20:00.000Z");
    const responses = await Promise.all(
      Array.from({ length: 13 }, () =>
        applyIdentityRateLimit(startRequest(), env.value, now),
      ),
    );

    expect(responses.filter((response) => response === null)).toHaveLength(12);
    const rejected = responses.filter(
      (response): response is Response => response !== null,
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].status).toBe(429);
    expect(rejected[0].headers.get("retry-after")).toBe("60");
  });

  it("keeps the start and poll policies independent at their exact limits", async () => {
    const env = environment();
    const now = () => new Date("2026-08-15T23:20:00.000Z");

    expect(
      await applyIdentityRateLimit(startRequest(), env.value, now),
    ).toBeNull();
    const pollResponses = await Promise.all(
      Array.from({ length: 121 }, () =>
        applyIdentityRateLimit(pollRequest(), env.value, now),
      ),
    );

    expect(pollResponses.filter((response) => response === null)).toHaveLength(
      120,
    );
    expect(pollResponses.filter((response) => response !== null)).toHaveLength(
      1,
    );
    expect(new Set(env.exact.observedKeyHashes)).toHaveLength(2);
  });

  it("starts a fresh exact window after the prior window expires", async () => {
    const env = environment();
    const firstWindow = () => new Date("2026-08-15T23:20:00.000Z");
    for (let index = 0; index < 12; index += 1) {
      expect(
        await applyIdentityRateLimit(startRequest(), env.value, firstWindow),
      ).toBeNull();
    }
    const nextWindow = () => new Date("2026-08-15T23:21:00.000Z");
    expect(
      await applyIdentityRateLimit(startRequest(), env.value, nextWindow),
    ).toBeNull();
  });

  it("deletes expired exact buckets without retaining client state", async () => {
    const exact = database();
    await consumeExactRateLimit({
      db: exact.db,
      limit: 12,
      nowEpochSeconds: 1_787_353_200,
      principal: "192.0.2.1",
      scope: "oauth-start",
      secret: "identity-state-key-for-tests",
      windowSeconds: 60,
    });
    expect(exact.bucketCount()).toBe(1);

    await deleteExpiredRateLimits(exact.db, 1_787_353_260);

    expect(exact.bucketCount()).toBe(0);
  });

  it.each(["edge", "exact"])(
    "fails closed when the %s limiter is unavailable",
    async (boundary) => {
      const start = limiter(true);
      if (boundary === "edge") {
        start.limit = async () => {
          throw new Error("provider detail must not escape");
        };
      }
      const env = environment(
        start,
        limiter(true),
        database({ fail: boundary === "exact" }),
      );
      const response = await applyIdentityRateLimit(startRequest(), env.value);

      expect(response?.status).toBe(503);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(response?.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response?.headers.get("retry-after")).toBe("60");
      expect(await response?.json()).toEqual({
        error: "service_unavailable",
        message: "Identity service is temporarily unavailable.",
      });
    },
  );

  it.each([
    ["GET", "/v1/oauth/authorize"],
    ["GET", "/v1/oauth/callback"],
    ["POST", "/v1/assertions/consume"],
    ["POST", "/not-found"],
  ])("does not count %s %s", async (method, path) => {
    const start = limiter(false);
    const poll = limiter(false);
    const env = environment(start, poll);
    const response = await applyIdentityRateLimit(
      new Request(`https://identity.slop.cash${path}`, { method }),
      env.value,
    );

    expect(response).toBeNull();
    expect(start.keys).toEqual([]);
    expect(poll.keys).toEqual([]);
    expect(env.exact.observedKeyHashes).toEqual([]);
  });
});
