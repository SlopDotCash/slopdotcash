import { expect, test } from "bun:test";
import type { D1Database, D1Result, D1Statement } from "../../backend/d1";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { PRIVATE_INTAKE_STATUS_URL, renewPrivateIntakeStatus, runScheduledMaintenance } from "./index";

// Source-authored tests of actual renewal SQL and HTTP-response ownership.
// No provider, scheduled service, or database command has been run here.
const BEFORE = "2026-11-09T11:00:00.000Z";
const AT = "2026-11-09T12:00:00.000Z";
const TOKEN = "synthetic_github_status_token";
function fixture() {
  const { db, sqlite } = sqliteD1();
  sqlite.query("INSERT INTO private_intake_status VALUES(1,1,?)").run(BEFORE);
  const row = () => sqlite.query("SELECT enabled,verified_at FROM private_intake_status WHERE singleton=1").get();
  return { db, sqlite, row, close: () => sqlite.close() };
}
function intercepted(db: D1Database, run: (sql: string, next: () => Promise<D1Result>) => Promise<D1Result>): D1Database {
  const wrap = (sql: string, statement: D1Statement): D1Statement => ({
    bind: (...values) => wrap(sql, statement.bind(...values)),
    first: <T>() => statement.first<T>(),
    run: () => run(sql, () => statement.run()),
  });
  return { prepare: (sql) => wrap(sql, db.prepare(sql)) };
}
function refusal(status: number, headers: HeadersInit = {}, failCancel = false) {
  let cancels = 0;
  const response = new Response(new ReadableStream({ cancel() {
    cancels++;
    if (failCancel) throw new Error("private cancellation detail");
  } }), { status, headers });
  return { response, cancels: () => cancels };
}
const current = () => new Date(AT);

test("anonymous renewal persists the exact boolean and canonical observation time", async () => {
  const f = fixture();
  try {
    const response = Response.json({ enabled: true });
    const result = await renewPrivateIntakeStatus({ db: f.db, now: current, fetchImpl: async (url, init) => {
      expect(url).toBe(PRIVATE_INTAKE_STATUS_URL);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return response;
    } });
    expect(result).toEqual({ status: "renewed", enabled: true, verifiedAt: AT, tokenRejected: false });
    expect(f.row()).toEqual({ enabled: 1, verified_at: AT });
    expect(response.bodyUsed).toBe(true);
  } finally { f.close(); }
});

test("disabled is a valid observation and must replace the prior enabled row", async () => {
  const f = fixture();
  try {
    expect(await renewPrivateIntakeStatus({ db: f.db, now: current, fetchImpl: async () => Response.json({ enabled: false }) }))
      .toEqual({ status: "renewed", enabled: false, verifiedAt: AT, tokenRejected: false });
    expect(f.row()).toEqual({ enabled: 0, verified_at: AT });
  } finally { f.close(); }
});

test("a malformed optional token is omitted and reported without an authenticated request", async () => {
  const f = fixture(); let calls = 0;
  try {
    const result = await renewPrivateIntakeStatus({ db: f.db, now: current, token: "bad token", fetchImpl: async (_url, init) => {
      calls++;
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return Response.json({ enabled: true });
    } });
    expect(result).toMatchObject({ status: "renewed", tokenRejected: true });
    expect(calls).toBe(1);
  } finally { f.close(); }
});

for (const status of [401, 403]) {
  test(`authenticated ${status} is disposed before one anonymous retry`, async () => {
    const f = fixture(); const rejected = refusal(status); let calls = 0;
    try {
      const result = await renewPrivateIntakeStatus({ db: f.db, now: current, token: TOKEN, fetchImpl: async (_url, init) => {
        calls++;
        const auth = new Headers(init?.headers).get("authorization");
        if (calls === 1) { expect(auth).toBe(`Bearer ${TOKEN}`); return rejected.response; }
        expect(calls).toBe(2); expect(auth).toBeNull(); expect(rejected.cancels()).toBe(1);
        return Response.json({ enabled: true });
      } });
      expect(result).toMatchObject({ status: "renewed", tokenRejected: true });
      expect(calls).toBe(2);
    } finally { f.close(); }
  });
}

test("a rejected token's disposal failure does not prevent its anonymous fallback", async () => {
  const f = fixture(); const rejected = refusal(401, {}, true); let calls = 0;
  try {
    const result = await renewPrivateIntakeStatus({ db: f.db, now: current, token: TOKEN,
      fetchImpl: async () => ++calls === 1 ? rejected.response : Response.json({ enabled: false }) });
    expect(result).toMatchObject({ status: "renewed", enabled: false, tokenRejected: true });
    expect(rejected.cancels()).toBe(1); expect(calls).toBe(2);
  } finally { f.close(); }
});

for (const [status, headers, reason] of [
  [429, {}, "rate-limited"], [403, { "x-ratelimit-remaining": "0" }, "rate-limited"],
  [403, { "retry-after": "60" }, "rate-limited"], [307, { location: "https://other.example/" }, "rejected"],
  [404, {}, "rejected"], [503, {}, "rejected"],
] as const) {
  test(`status ${status} with ${JSON.stringify(headers)} refuses without token fallback`, async () => {
    const f = fixture(); const rejected = refusal(status, headers); let calls = 0;
    try {
      const result = await renewPrivateIntakeStatus({ db: f.db, now: current, token: TOKEN,
        fetchImpl: async () => { calls++; return rejected.response; } });
      expect(result).toEqual({ status: "skipped", reason, httpStatus: status, tokenRejected: false });
      expect(calls).toBe(1); expect(rejected.cancels()).toBe(1);
      expect(f.row()).toEqual({ enabled: 1, verified_at: BEFORE });
    } finally { f.close(); }
  });
}

test("a second unauthorized reply is disposed and cannot recurse", async () => {
  const f = fixture(); const first = refusal(401), second = refusal(401); let calls = 0;
  try {
    const result = await renewPrivateIntakeStatus({ db: f.db, now: current, token: TOKEN,
      fetchImpl: async () => ++calls === 1 ? first.response : second.response });
    expect(result).toEqual({ status: "skipped", reason: "unauthorized", httpStatus: 401, tokenRejected: true });
    expect(calls).toBe(2); expect(first.cancels()).toBe(1); expect(second.cancels()).toBe(1);
  } finally { f.close(); }
});

test("network failure preserves the old observation without anonymous retry", async () => {
  const f = fixture(); let calls = 0;
  try {
    const result = await renewPrivateIntakeStatus({ db: f.db, now: current, token: TOKEN,
      fetchImpl: async () => { calls++; throw new Error("private provider failure"); } });
    expect(result).toEqual({ status: "skipped", reason: "unreachable", tokenRejected: false });
    expect(calls).toBe(1); expect(f.row()).toEqual({ enabled: 1, verified_at: BEFORE });
  } finally { f.close(); }
});

for (const value of [null, [], true, {}, { enabled: "true" }]) {
  test(`a malformed reporting object ${JSON.stringify(value)} cannot refresh the observation`, async () => {
    const f = fixture();
    try {
      expect(await renewPrivateIntakeStatus({ db: f.db, now: current, fetchImpl: async () => Response.json(value) }))
        .toEqual({ status: "skipped", reason: "malformed", tokenRejected: false });
      expect(f.row()).toEqual({ enabled: 1, verified_at: BEFORE });
    } finally { f.close(); }
  });
}

test("malformed, oversized and interrupted successful bodies do not renew", async () => {
  for (const response of [new Response("{invalid"), new Response(new Uint8Array([0xff])),
    new Response(null), new Response("{}", { headers: { "content-length": String(64 * 1024 + 1) } }),
    new Response(new ReadableStream({ start(controller) { controller.error(new Error("stream failed")); } }))]) {
    const f = fixture();
    try {
      expect(await renewPrivateIntakeStatus({ db: f.db, now: current, fetchImpl: async () => response }))
        .toMatchObject({ status: "skipped", reason: "malformed" });
      expect(f.row()).toEqual({ enabled: 1, verified_at: BEFORE });
      expect(response.body?.locked ?? false).toBe(false);
    } finally { f.close(); }
  }
});

test("a failed database result cannot be reported as renewed", async () => {
  const f = fixture();
  try {
    const db = intercepted(f.db, async () => ({ success: false, meta: { changes: 0 } }));
    await expect(renewPrivateIntakeStatus({ db, now: current, fetchImpl: async () => Response.json({ enabled: true }) }))
      .rejects.toThrow("could not be stored");
    expect(f.row()).toEqual({ enabled: 1, verified_at: BEFORE });
  } finally { f.close(); }
});

test("a failed reply after the database write does not roll back the observation", async () => {
  const f = fixture();
  try {
    const db = intercepted(f.db, async (_sql, next) => { await next(); return { success: false }; });
    await expect(renewPrivateIntakeStatus({ db, now: current, fetchImpl: async () => Response.json({ enabled: false }) }))
      .rejects.toThrow("could not be stored");
    expect(f.row()).toEqual({ enabled: 0, verified_at: AT });
  } finally { f.close(); }
});

test("a database exception preserves the prior observation and rejects the call", async () => {
  const f = fixture();
  try {
    const db = intercepted(f.db, async () => { throw new Error("private write failure"); });
    await expect(renewPrivateIntakeStatus({ db, now: current, fetchImpl: async () => Response.json({ enabled: false }) }))
      .rejects.toThrow("private write failure");
    expect(f.row()).toEqual({ enabled: 1, verified_at: BEFORE });
  } finally { f.close(); }
});

for (const stamp of [BEFORE, "2026-11-09T10:00:00.000Z"]) {
  test(`conditional no-op at ${stamp} preserves the newer row but reports the observed candidate`, async () => {
    const f = fixture();
    try {
      expect(await renewPrivateIntakeStatus({ db: f.db, now: () => new Date(stamp), fetchImpl: async () => Response.json({ enabled: false }) }))
        .toEqual({ status: "renewed", enabled: false, verifiedAt: stamp, tokenRejected: false });
      expect(f.row()).toEqual({ enabled: 1, verified_at: BEFORE });
    } finally { f.close(); }
  });
}

test("direct renewal samples its supplied clock after consuming the body", async () => {
  const f = fixture(); let clock = BEFORE;
  try {
    const response = new Response(new ReadableStream({ pull(controller) {
      clock = AT; controller.enqueue(new TextEncoder().encode('{"enabled":true}')); controller.close();
    } }, { highWaterMark: 0 }));
    expect(await renewPrivateIntakeStatus({ db: f.db, now: () => new Date(clock), fetchImpl: async () => response }))
      .toMatchObject({ status: "renewed", verifiedAt: AT });
  } finally { f.close(); }
});

test("scheduled renewal reports false database success while cleanup still completes", async () => {
  const f = fixture();
  try {
    const db = intercepted(f.db, async (sql, next) => sql.includes("INSERT INTO private_intake_status") ? { success: false } : next());
    await expect(runScheduledMaintenance({ IDENTITY_DB: db }, new Date(AT), async () => Response.json({ enabled: true })))
      .rejects.toThrow("scheduled maintenance failed");
    expect(f.row()).toEqual({ enabled: 1, verified_at: BEFORE });
  } finally { f.close(); }
});
