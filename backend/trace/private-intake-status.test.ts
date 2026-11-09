// Source-authored tests for migrated status storage and real public/upload
// entry points. No database, provider, browser or runtime checks ran here.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { CloudflareTracePersistence, privateIntakeStatus, type R2Bucket } from "./cloudflare-persistence";
import { handleTraceApi, type TraceApiDependencies } from "./handler";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const bytes = new TextEncoder().encode("Private trace fixture\n");
const digest = createHash("sha256").update(bytes).digest("hex");
const capability = "c".repeat(43);
const tokenHash = createHash("sha256").update(capability).digest("hex");
function fixture() {
  const { db, sqlite } = sqliteD1();
  let now = new Date(NOW), reads = 0, writes = 0;
  const objects = new Map<string, { bytes: Uint8Array; contentType: string; metadata: Record<string, string> }>();
  const bucket: R2Bucket = {
    async head(key) {
      reads += 1;
      const object = objects.get(key);
      return object ? { size: object.bytes.byteLength, customMetadata: object.metadata } : null;
    },
    async get(key) {
      reads += 1;
      const object = objects.get(key);
      return object ? { size: object.bytes.byteLength, customMetadata: object.metadata,
        body: new Response(object.bytes).body! } : null;
    },
    async put(key, value, options) {
      writes += 1;
      if (objects.has(key)) throw new Error("Object already exists");
      objects.set(key, { bytes: value.slice(), contentType: options.httpMetadata.contentType, metadata: options.customMetadata });
      return {};
    },
  };
  const persistence = new CloudflareTracePersistence(db, bucket);
  const deps: TraceApiDependencies = {
    persistence, authSecret: "private-intake-fixture-secret", operatorGithubIds: new Set(),
    now: () => now, randomId: () => "private-intake-fixture", verifyIdentityAssertion: async () => null,
    privateIntakeStatus: () => privateIntakeStatus(db, now),
  };
  function store(enabled: number, verifiedAt: string) {
    sqlite.query("INSERT INTO private_intake_status(singleton,enabled,verified_at) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,verified_at=excluded.verified_at")
      .run(enabled, verifiedAt);
  }
  async function seedUpload() {
    expect((await persistence.createRun({ id: "intake-run", clientRunId: "intake-client-run",
      githubId: "123", githubLogin: "intake-fixture", projectId: "slopdotcash", repository: "SlopDotCash/slopdotcash",
      projectPolicyRevision: "a".repeat(40), provider: "openai", model: "gpt-5", client: "codex", clientVersion: "1.0.0",
      createdAt: iso(0), idempotencyKey: "intake-run-idempotency" })).status).toBe("created");
    expect((await persistence.createUploadIntent({ tokenHash, runId: "intake-run", githubId: "123",
      sha256: digest, sizeBytes: bytes.byteLength, contentType: "text/plain", idempotencyKey: "intake-upload-idempotency",
      createdAt: iso(0), expiresAt: iso(300_000), consumedAt: null })).status).toBe("created");
  }
  const status = () => handleTraceApi(new Request("https://api.slop.cash/api/v1/private-request-intake"), deps);
  const upload = (body: BodyInit = bytes) => handleTraceApi(new Request(
    `https://api.slop.cash/api/v1/trace-uploads/${capability}`, {
      method: "PUT", headers: { "content-type": "text/plain", digest: `sha-256=${digest}` },
      body, duplex: "half",
    } as RequestInit & { duplex: "half" }), deps);
  return { db, sqlite, persistence, deps, store, status, seedUpload, upload,
    clock: () => now, setClock: (value: Date) => { now = value; },
    storageCalls: () => ({ reads, writes }), close: () => sqlite.close() };
}

test("missing observation is unavailable and reading it creates no row", async () => {
  const f = fixture();
  try {
    expect(await privateIntakeStatus(f.db, f.clock())).toEqual({ status: "unavailable" });
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM private_intake_status").get()).toEqual({ n: 0 });
  } finally { f.close(); }
});

test.each([
  ["current", 0, true], ["oldest accepted", -86_400_000, true], ["one ms stale", -86_400_001, false],
  ["future skew boundary", 300_000, true], ["one ms too future", 300_001, false],
] as const)("status freshness: %s", async (_name, offset, accepted) => {
  const f = fixture();
  try {
    f.store(1, iso(offset));
    expect(await privateIntakeStatus(f.db, f.clock())).toEqual(accepted
      ? { status: "verified", enabled: true, verifiedAt: iso(offset) } : { status: "unavailable" });
  } finally { f.close(); }
});

test.each(["2026-11-09", "2026-11-09T12:00:00+00:00", "2026-11-09T12:00:00.00Z",
  "2026-11-09T12:00:00.000Z ", "2026-02-30T12:00:00.000Z", "not-a-date"])(
  "noncanonical or invalid observation %s never returns verified", async (verifiedAt) => {
    const f = fixture();
    try { f.store(1, verifiedAt); expect(await privateIntakeStatus(f.db, f.clock())).toEqual({ status: "unavailable" }); }
    finally { f.close(); }
  },
);

test("whole-second UTC observations retain the existing accepted timestamp form", async () => {
  const f = fixture();
  try {
    const verifiedAt = "2026-11-09T12:00:00Z";
    f.store(0, verifiedAt);
    expect(await privateIntakeStatus(f.db, f.clock())).toEqual({ status: "verified", enabled: false, verifiedAt });
  } finally { f.close(); }
});

test("fresh disabled status is verified but does not authorize trace collection", async () => {
  const f = fixture();
  try {
    f.store(0, iso(0));
    const response = await f.status();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, source: "github-public-status", verifiedAt: iso(0) });
    expect(response.headers.get("cache-control")).toBe("no-store");
  } finally { f.close(); }
});

test("unavailable public status returns 503 without private observation metadata", async () => {
  const f = fixture();
  try {
    f.store(1, iso(-86_400_001));
    const response = await f.status();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "private_intake_unavailable" });
  } finally { f.close(); }
});

test("reader owns clock milliseconds before the awaited database read", async () => {
  const f = fixture();
  try {
    f.store(1, iso(0));
    const clock = new Date(NOW);
    const db: typeof f.db = { ...f.db, prepare(sql) {
      const statement = f.db.prepare(sql);
      return { ...statement, async first<T>() {
        const row = await statement.first<T>();
        clock.setTime(NOW + 86_400_001);
        return row;
      } };
    } };
    expect(await privateIntakeStatus(db, clock)).toEqual({ status: "verified", enabled: true, verifiedAt: iso(0) });
    expect(clock.getTime()).toBe(NOW + 86_400_001);
  } finally { f.close(); }
});

test("a later disabled row does not rewrite an already captured enabled snapshot", async () => {
  const f = fixture();
  try {
    f.store(1, iso(0));
    const db: typeof f.db = { ...f.db, prepare(sql) {
      const statement = f.db.prepare(sql);
      return { ...statement, async first<T>() {
        const row = await statement.first<T>(); f.store(0, iso(1)); return row;
      } };
    } };
    expect(await privateIntakeStatus(db, f.clock())).toEqual({ status: "verified", enabled: true, verifiedAt: iso(0) });
    expect(await privateIntakeStatus(f.db, f.clock())).toEqual({ status: "verified", enabled: false, verifiedAt: iso(1) });
  } finally { f.close(); }
});

test("failed reads and invalid caller clocks return unavailable without changing stored evidence", async () => {
  const f = fixture();
  try {
    f.store(1, iso(0));
    const db: typeof f.db = { ...f.db, prepare() { throw new Error("Private database detail"); } };
    expect(await privateIntakeStatus(db, f.clock())).toEqual({ status: "unavailable" });
    expect(await privateIntakeStatus(f.db, new Date(NaN))).toEqual({ status: "unavailable" });
    expect(f.sqlite.query("SELECT enabled,verified_at FROM private_intake_status").get()).toEqual({ enabled: 1, verified_at: iso(0) });
  } finally { f.close(); }
});

test("the migrated singleton rejects duplicate ids and nonboolean enabled values", () => {
  const f = fixture();
  try {
    expect(() => f.sqlite.query("INSERT INTO private_intake_status VALUES(2,1,?)").run(iso(0))).toThrow();
    expect(() => f.store(2, iso(0))).toThrow();
    f.store(1, iso(0));
    expect(() => f.sqlite.query("INSERT INTO private_intake_status VALUES(1,1,?)").run(iso(0))).toThrow();
  } finally { f.close(); }
});

test("disabled capability upload reads no bytes and can retry after a verified renewal", async () => {
  const f = fixture();
  try {
    await f.seedUpload(); f.store(0, iso(0));
    let pulls = 0;
    const unread = new ReadableStream<Uint8Array>({ pull() { pulls += 1; } }, { highWaterMark: 0 });
    expect((await f.upload(unread)).status).toBe(503);
    expect(pulls).toBe(0);
    expect(f.storageCalls()).toEqual({ reads: 0, writes: 0 });
    expect((await f.persistence.getUploadIntent(tokenHash, iso(0)))?.consumedAt).toBeNull();
    expect((await f.persistence.getRun("intake-run"))?.state).toBe("awaiting_trace");
    f.store(1, iso(0));
    expect((await f.upload()).status).toBe(201);
    expect(f.storageCalls().writes).toBe(1);
    expect((await f.persistence.getRun("intake-run"))?.state).toBe("trace_uploaded");
  } finally { f.close(); }
});
