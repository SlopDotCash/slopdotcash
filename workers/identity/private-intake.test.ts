import { describe, expect, it, vi } from "vitest";
import worker, {
  PRIVATE_INTAKE_STATUS_URL,
  renewPrivateIntakeStatus,
  runScheduledMaintenance,
} from "./index";
import type { D1Database } from "./persistence";

const NOW = new Date("2026-09-12T20:17:00.000Z");
const TOKEN = "github_pat_11ABCDEF0_testonlyvalue_1234567890";

function database(options: { fail?: RegExp } = {}) {
  const writes: Array<{ query: string; values: unknown[] }> = [];
  const db: D1Database = {
    prepare(query) {
      const statement = {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          statement.values = values;
          return statement;
        },
        async first<T>() {
          return null as T | null;
        },
        async run() {
          if (options.fail?.test(query)) throw new Error("D1 unavailable");
          writes.push({ query, values: statement.values });
          return { success: true };
        },
      };
      return statement;
    },
  };
  return { db, writes };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function sentHeaders(
  fetchImpl: ReturnType<typeof vi.fn<FetchLike>>,
  call: number,
): Record<string, string> {
  const init = fetchImpl.mock.calls[call]?.[1];
  if (init === undefined) throw new Error(`fetch call ${call} was not made`);
  return init.headers as Record<string, string>;
}

function github(body: BodyInit | null, init: ResponseInit = {}) {
  return vi.fn<FetchLike>(
    async () => new Response(body, { status: 200, ...init }),
  );
}

describe("private intake renewal", () => {
  it("records GitHub's enabled answer without any Cloudflare credential", async () => {
    const { db, writes } = database();
    const fetchImpl = github(JSON.stringify({ enabled: true }));
    await expect(
      renewPrivateIntakeStatus({ db, fetchImpl, now: () => NOW }),
    ).resolves.toEqual({
      status: "renewed",
      enabled: true,
      verifiedAt: NOW.toISOString(),
      tokenRejected: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(PRIVATE_INTAKE_STATUS_URL);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "slop-identity",
        "x-github-api-version": "2022-11-28",
      },
    });
    expect(sentHeaders(fetchImpl, 0).authorization).toBeUndefined();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.query).toContain(
      "INSERT INTO private_intake_status(singleton, enabled, verified_at) VALUES (1, ?, ?)",
    );
    expect(writes[0]?.query).toContain(
      "WHERE excluded.verified_at > private_intake_status.verified_at",
    );
    expect(writes[0]?.values).toEqual([1, NOW.toISOString()]);
  });

  it("records disabled reporting so collection stops at the next read", async () => {
    const { db, writes } = database();
    await expect(
      renewPrivateIntakeStatus({
        db,
        fetchImpl: github(JSON.stringify({ enabled: false })),
        now: () => NOW,
      }),
    ).resolves.toMatchObject({ status: "renewed", enabled: false });
    expect(writes[0]?.values).toEqual([0, NOW.toISOString()]);
  });

  it.each([
    [
      "an outage",
      github(null, { status: 503 }),
      { reason: "rejected", httpStatus: 503 },
    ],
    [
      "a redirect",
      github(null, { status: 302 }),
      { reason: "rejected", httpStatus: 302 },
    ],
    [
      "a rate limit",
      github(JSON.stringify({ message: "rate limited" }), {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      }),
      { reason: "rate-limited", httpStatus: 403 },
    ],
    [
      "a secondary rate limit",
      github(JSON.stringify({ message: "slow down" }), {
        status: 403,
        headers: { "retry-after": "60" },
      }),
      { reason: "rate-limited", httpStatus: 403 },
    ],
    [
      "a 429",
      github(null, { status: 429 }),
      { reason: "rate-limited", httpStatus: 429 },
    ],
    [
      "a forbidden answer",
      github(JSON.stringify({ message: "forbidden" }), { status: 403 }),
      { reason: "unauthorized", httpStatus: 403 },
    ],
    [
      "a malformed body",
      github(JSON.stringify({ enabled: "yes" })),
      { reason: "malformed" },
    ],
    [
      "a non-object body",
      github(JSON.stringify([true])),
      { reason: "malformed" },
    ],
    ["invalid JSON", github("{"), { reason: "malformed" }],
    [
      "an oversized body",
      github(JSON.stringify({ enabled: true }), {
        headers: { "content-length": String(65 * 1024) },
      }),
      { reason: "malformed" },
    ],
    [
      "a network failure",
      vi.fn<FetchLike>(async () => {
        throw new Error("fetch failed");
      }),
      { reason: "unreachable" },
    ],
  ])(
    "leaves the previous observation untouched after %s",
    async (_label, fetchImpl, expected) => {
      const { db, writes } = database();
      await expect(
        renewPrivateIntakeStatus({ db, fetchImpl, now: () => NOW }),
      ).resolves.toEqual({
        status: "skipped",
        tokenRejected: false,
        ...expected,
      });
      expect(writes).toHaveLength(0);
    },
  );

  it("sends the read-only token so GitHub bills the renewal's own budget", async () => {
    const { db, writes } = database();
    const fetchImpl = github(JSON.stringify({ enabled: true }));
    await expect(
      renewPrivateIntakeStatus({
        db,
        fetchImpl,
        now: () => NOW,
        token: TOKEN,
      }),
    ).resolves.toMatchObject({ status: "renewed", tokenRejected: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(writes).toHaveLength(1);
  });

  it.each([
    ["revoked", 401, JSON.stringify({ message: "Bad credentials" })],
    ["forbidden", 403, JSON.stringify({ message: "Resource not accessible" })],
  ])(
    "repeats the request anonymously once when GitHub reports the token %s",
    async (_label, status, body) => {
      const { db, writes } = database();
      const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        if (headers.authorization !== undefined) {
          return new Response(body, { status });
        }
        return new Response(JSON.stringify({ enabled: true }), {
          status: 200,
        });
      });
      await expect(
        renewPrivateIntakeStatus({
          db,
          fetchImpl,
          now: () => NOW,
          token: TOKEN,
        }),
      ).resolves.toEqual({
        status: "renewed",
        enabled: true,
        verifiedAt: NOW.toISOString(),
        tokenRejected: true,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sentHeaders(fetchImpl, 1).authorization).toBeUndefined();
      expect(writes).toHaveLength(1);
    },
  );

  it("does not retry anonymously when the token itself is rate limited", async () => {
    const { db, writes } = database();
    const fetchImpl = github(JSON.stringify({ message: "rate limited" }), {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    });
    await expect(
      renewPrivateIntakeStatus({
        db,
        fetchImpl,
        now: () => NOW,
        token: TOKEN,
      }),
    ).resolves.toEqual({
      status: "skipped",
      reason: "rate-limited",
      httpStatus: 403,
      tokenRejected: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(0);
  });

  it.each([
    ["", "blank"],
    ["not a token\n", "malformed"],
  ])("never sends a secret that cannot be a token (%s)", async (token) => {
    const { db, writes } = database();
    const fetchImpl = github(JSON.stringify({ enabled: true }));
    await expect(
      renewPrivateIntakeStatus({ db, fetchImpl, now: () => NOW, token }),
    ).resolves.toMatchObject({ status: "renewed", tokenRejected: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sentHeaders(fetchImpl, 0).authorization).toBeUndefined();
    expect(writes).toHaveLength(1);
  });

  it("surfaces a failed write instead of reporting a renewal", async () => {
    const { db } = database({ fail: /private_intake_status/u });
    await expect(
      renewPrivateIntakeStatus({
        db,
        fetchImpl: github(JSON.stringify({ enabled: true })),
        now: () => NOW,
      }),
    ).rejects.toThrow("D1 unavailable");
  });
});

describe("scheduled maintenance", () => {
  it("renews intake even when identity cleanup fails, and reports the failure", async () => {
    const { db, writes } = database({ fail: /identity_oauth_flows/u });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        runScheduledMaintenance(
          { IDENTITY_DB: db },
          NOW,
          github(JSON.stringify({ enabled: true })),
        ),
      ).rejects.toThrow("slop identity scheduled maintenance failed");
      expect(
        writes.some((write) => write.query.includes("private_intake_status")),
      ).toBe(true);
      expect(error.mock.calls.map((call) => call[0])).toEqual([
        "slop identity cleanup failed",
      ]);
    } finally {
      error.mockRestore();
    }
  });

  it("cleans identity state even when renewal is skipped, without failing the run", async () => {
    const { db, writes } = database();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runScheduledMaintenance(
        { IDENTITY_DB: db },
        NOW,
        github(null, { status: 503 }),
      );
      expect(writes.map((write) => write.query)).toEqual([
        "DELETE FROM identity_oauth_flows WHERE expires_at <= ?",
        "DELETE FROM identity_assertions WHERE expires_at <= ?",
        expect.stringContaining("identity_rate_limits"),
      ]);
      expect(error.mock.calls.map((call) => call[0])).toEqual([
        "slop private intake renewal skipped: rejected 503",
      ]);
    } finally {
      error.mockRestore();
    }
  });

  it("names an unreachable GitHub without an HTTP status", async () => {
    const { db } = database();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runScheduledMaintenance(
        { IDENTITY_DB: db },
        NOW,
        vi.fn<FetchLike>(async () => {
          throw new Error("fetch failed");
        }),
      );
      expect(error.mock.calls.map((call) => call[0])).toEqual([
        "slop private intake renewal skipped: unreachable",
      ]);
    } finally {
      error.mockRestore();
    }
  });

  it("passes the configured token through and reports a rejected one without printing it", async () => {
    const { db, writes } = database();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      if (headers.authorization !== undefined) {
        return new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
        });
      }
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    });
    try {
      await runScheduledMaintenance(
        { IDENTITY_DB: db, GITHUB_INTAKE_STATUS_TOKEN: TOKEN },
        NOW,
        fetchImpl,
      );
      expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(
        writes.some((write) => write.query.includes("private_intake_status")),
      ).toBe(true);
      const logged = error.mock.calls.map((call) => String(call[0]));
      expect(logged).toEqual(["slop private intake token rejected"]);
      expect(logged.join("\n")).not.toContain(TOKEN);
    } finally {
      error.mockRestore();
    }
  });

  it("fails the invocation when the intake write fails", async () => {
    const { db } = database({ fail: /private_intake_status/u });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        runScheduledMaintenance(
          { IDENTITY_DB: db },
          NOW,
          github(JSON.stringify({ enabled: true })),
        ),
      ).rejects.toThrow("slop identity scheduled maintenance failed");
      expect(error.mock.calls.map((call) => call[0])).toEqual([
        "slop private intake renewal failed",
      ]);
    } finally {
      error.mockRestore();
    }
  });

  it("is wired to the Worker's existing hourly cron trigger", async () => {
    const { db, writes } = database();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = github(
      JSON.stringify({ enabled: true }),
    ) as unknown as typeof fetch;
    try {
      await worker.scheduled(undefined, {
        IDENTITY_DB: db,
      } as never);
      expect(
        writes.some((write) => write.query.includes("private_intake_status")),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
