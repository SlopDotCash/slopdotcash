import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareTracePersistence,
  type D1Database,
  type R2Bucket,
} from "../../../backend/trace/cloudflare-persistence";
import {
  applyVerificationAdmission,
  VERIFICATION_ADMISSION,
} from "../../../backend/trace/verification-admission";

type Row = { request_count: number; expires_at: number };
function setup() {
  const rows = new Map<string, Row>();
  const db: D1Database = {
    batch: async () => {
      throw new Error("Unexpected batch");
    },
    prepare(query) {
      expect(query).toContain("INSERT INTO identity_rate_limits");
      expect(query).toContain("ON CONFLICT(key_hash) DO UPDATE");
      expect(query).toContain("RETURNING request_count, expires_at");
      let values: unknown[] = [];
      return {
        bind(...input) {
          values = input;
          return this;
        },
        async run() {
          throw new Error("Unexpected run");
        },
        async first<T>() {
          const [key, now, expiry] = values as [string, number, number];
          const prior = rows.get(key);
          const row =
            !prior || prior.expires_at <= now
              ? { request_count: 1, expires_at: expiry }
              : { ...prior, request_count: prior.request_count + 1 };
          rows.set(key, row);
          return row as T;
        },
      };
    },
  };
  const persistence = new CloudflareTracePersistence(
    db,
    new Proxy({} as R2Bucket, {
      get() {
        throw new Error("R2 must not be touched");
      },
    }),
  );
  return {
    rows,
    db,
    deps: {
      persistence,
      authSecret: "A".repeat(43),
      now: () => new Date("2026-09-10T00:00:00.000Z"),
    },
  };
}
function request(ip = "192.0.2.1", route = "funding") {
  return new Request(
    `https://api.slop.cash/api/v1/projects/eliza/${route}/2026-08`,
    { headers: { "cf-connecting-ip": ip } },
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("durable public verification admission", () => {
  it("shares the exact client budget across both routes under concurrent requests and resets at expiry", async () => {
    const { deps, rows } = setup();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        applyVerificationAdmission(
          request("192.0.2.1", i % 2 ? "funding" : "executions"),
          deps,
        ),
      ),
    );
    expect(results.filter((value) => value === null)).toHaveLength(4);
    for (const response of results.filter((value) => value !== null)) {
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(rows.size).toBe(2);
    expect(
      await applyVerificationAdmission(request(), {
        ...deps,
        now: () => new Date("2026-09-10T00:01:00.000Z"),
      }),
    ).toBeNull();
    expect(rows.size).toBe(2);
  });
  it("enforces the shared global budget even when client identities rotate", async () => {
    const { deps, rows } = setup();
    for (let i = 0; i < VERIFICATION_ADMISSION.globalLimit; i++)
      await applyVerificationAdmission(request(`192.0.2.${i + 1}`), deps);
    const response = await applyVerificationAdmission(
      request("198.51.100.1", "executions"),
      deps,
    );
    expect(response?.status).toBe(429);
    expect(rows.size).toBeLessThanOrEqual(25);
  });
  it("does not use forwarded headers to replace a missing trusted principal", async () => {
    const { deps, rows } = setup();
    expect(
      (
        await applyVerificationAdmission(
          new Request("https://api.slop.cash", {
            headers: { "x-forwarded-for": "192.0.2.1" },
          }),
          deps,
        )
      )?.status,
    ).toBe(503);
    expect(rows.size).toBe(0);
  });
  it("fails closed on unavailable D1 or invalid counters", async () => {
    const { deps } = setup();
    const consume = vi.spyOn(deps.persistence, "consumeVerificationAdmission");
    consume.mockRejectedValueOnce(new Error("secret database error"));
    expect(
      await (await applyVerificationAdmission(request(), deps))?.json(),
    ).toEqual({ error: "verification_admission_unavailable" });
    consume.mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 });
    expect((await applyVerificationAdmission(request(), deps))?.status).toBe(
      503,
    );
  });
  it("bounds a stalled admission call and never admits its late result", async () => {
    vi.useFakeTimers();
    const { deps } = setup();
    let release:
      | ((value: { allowed: boolean; retryAfterSeconds: number }) => void)
      | undefined;
    vi.spyOn(
      deps.persistence,
      "consumeVerificationAdmission",
    ).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = applyVerificationAdmission(request(), deps);
    await vi.advanceTimersByTimeAsync(VERIFICATION_ADMISSION.timeoutMs);
    expect((await pending)?.status).toBe(503);
    release?.({ allowed: true, retryAfterSeconds: 60 });
  });
});
