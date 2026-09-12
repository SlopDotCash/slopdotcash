import { describe, expect, it, vi } from "vitest";
import worker, {
  PRIVATE_INTAKE_STATUS_URL,
  renewPrivateIntakeStatus,
  runScheduledMaintenance,
} from "./index";
import type { D1Database } from "./persistence";

const NOW = new Date("2026-09-12T20:17:00.000Z");

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
    ["an outage", github(null, { status: 503 })],
    ["a redirect", github(null, { status: 302 })],
    [
      "a rate limit",
      github(JSON.stringify({ message: "rate limited" }), {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      }),
    ],
    ["a malformed body", github(JSON.stringify({ enabled: "yes" }))],
    ["a non-object body", github(JSON.stringify([true]))],
    ["invalid JSON", github("{")],
    [
      "an oversized body",
      github(JSON.stringify({ enabled: true }), {
        headers: { "content-length": String(65 * 1024) },
      }),
    ],
    [
      "a network failure",
      vi.fn<FetchLike>(async () => {
        throw new Error("fetch failed");
      }),
    ],
  ])(
    "leaves the previous observation untouched after %s",
    async (_label, fetchImpl) => {
      const { db, writes } = database();
      await expect(
        renewPrivateIntakeStatus({ db, fetchImpl, now: () => NOW }),
      ).resolves.toEqual({ status: "skipped" });
      expect(writes).toHaveLength(0);
    },
  );

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
        "slop private intake renewal skipped",
      ]);
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
