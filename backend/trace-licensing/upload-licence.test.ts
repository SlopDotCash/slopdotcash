/**
 * A trace records the terms version of its first upload intent. A v2 trace
 * is licensed with basis 'upload' only when the owner's licensing setting is
 * on at finalization, in the same transaction as the finalization.
 */
import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { seedParticipationBan } from "../../tests/participation-ban.fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { signApiToken } from "../trace/auth";
import {
  CloudflareTracePersistence,
  type R2Bucket,
} from "../trace/cloudflare-persistence";
import { handleTraceApi, type TraceApiDependencies } from "../trace/handler";

const SECRET = "trace-licence-test-secret-0123456789abcdef-0123456789";
const ACTOR = "777001";
const T0 = Date.parse("2026-11-22T00:00:00.000Z");
const TRACE = new TextEncoder().encode("trace for licensing\n");

function memoryBucket(): R2Bucket {
  const objects = new Map<
    string,
    { bytes: Uint8Array; meta: Record<string, string> }
  >();
  return {
    async head(key) {
      const object = objects.get(key);
      return object
        ? { size: object.bytes.byteLength, customMetadata: object.meta }
        : null;
    },
    async put(key, value, options) {
      if (objects.has(key)) throw new Error("precondition failed");
      objects.set(key, { bytes: value.slice(), meta: options.customMetadata });
      return {};
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        size: object.bytes.byteLength,
        customMetadata: object.meta,
        body: new Response(object.bytes.slice())
          .body as ReadableStream<Uint8Array>,
      };
    },
  };
}

function api() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec("PRAGMA foreign_keys=ON");
  let counter = 0;
  let now = T0;
  const deps: TraceApiDependencies = {
    persistence: new CloudflareTracePersistence(db, memoryBucket()),
    authSecret: SECRET,
    operatorGithubIds: new Set<string>(),
    now: () => new Date(now),
    randomId: () => `trace-licence-id-${++counter}`,
    verifyIdentityAssertion: async () => null,
    privateIntakeStatus: async () => ({
      status: "verified",
      enabled: true,
      verifiedAt: new Date(T0).toISOString(),
    }),
  };
  const call = async (
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
    raw?: Uint8Array,
  ) => {
    const iat = Math.floor(now / 1000);
    const token = await signApiToken(
      {
        iss: "slop.cash",
        aud: "private-trace-api",
        sub: `github:${ACTOR}`,
        githubId: ACTOR,
        githubLogin: "contributor",
        roles: ["contributor"],
        iat,
        exp: iat + 300,
        jti: `trace-licence-jti-0123456789-${++counter}`,
      },
      SECRET,
    );
    const response = await handleTraceApi(
      new Request(`http://localhost/api/v1/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        body: raw
          ? new Uint8Array(raw)
          : body === undefined
            ? undefined
            : JSON.stringify(body),
      }),
      deps,
    );
    return {
      status: response.status,
      json: (await response.json()) as Record<string, unknown>,
    };
  };
  const createRun = async () => {
    const created = await call(
      "POST",
      "runs",
      {
        clientRunId: `run_client_${++counter}`,
        projectId: "slopdotcash",
        repository: "SlopDotCash/slopdotcash",
        projectPolicyRevision: "a".repeat(40),
        provider: "openai",
        model: "gpt-5",
        client: "codex",
        clientVersion: "1.0.0",
      },
      { "idempotency-key": `create-key-${++counter}-0123456789` },
    );
    expect(created.status).toBe(201);
    return created.json.serverRunId as string;
  };
  const intent = async (runId: string, termsVersion?: unknown) =>
    call(
      "POST",
      `runs/${runId}/trace-intents`,
      {
        sha256: await sha256Hex(TRACE),
        sizeBytes: TRACE.byteLength,
        contentType: "text/plain",
        ...(termsVersion === undefined ? {} : { termsVersion }),
      },
      { "idempotency-key": `intent-key-${++counter}-0123456789` },
    );
  const upload = async (uploadUrl: string) =>
    call(
      "PUT",
      `trace-uploads/${new URL(uploadUrl).pathname.split("/").pop()}`,
      undefined,
      {
        "content-type": "text/plain",
        digest: `sha-256=${await sha256Hex(TRACE)}`,
      },
      TRACE,
    );
  const finalize = (runId: string) =>
    call("POST", `runs/${runId}/finalize`, undefined, {
      "idempotency-key": `finalize-key-${++counter}-0123456789`,
    });
  /** Create a run, stamp it with one intent, and upload the trace. */
  const uploaded = async (termsVersion?: string) => {
    const runId = await createRun();
    const accepted = await intent(runId, termsVersion);
    expect(accepted.status).toBe(201);
    const stored = await upload(accepted.json.uploadUrl as string);
    expect(stored.status).toBe(201);
    return runId;
  };
  /** The licensing setting and its account history, as Task 3 writes them. */
  const setting = (enabled: boolean) => {
    const at = new Date(now).toISOString();
    sqlite
      .query(
        `INSERT INTO trace_licensing_settings (github_id, enabled, provider_terms_confirmed, changed_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(github_id) DO UPDATE SET enabled = excluded.enabled, changed_at = excluded.changed_at`,
      )
      .run(ACTOR, enabled ? 1 : 0, at);
    return Number(
      sqlite
        .query(
          `INSERT INTO trace_licensing_events (github_id, kind, terms_version, at)
           VALUES (?, ?, 'private-trace-v2', ?) RETURNING id`,
        )
        .get(ACTOR, enabled ? "enabled" : "disabled", at) as never,
    );
  };
  return {
    sqlite,
    deps,
    createRun,
    intent,
    uploaded,
    finalize,
    setting,
    advance(milliseconds: number) {
      now += milliseconds;
    },
    version: (runId: string) =>
      (
        sqlite
          .query("SELECT terms_version FROM trace_runs WHERE id = ?")
          .get(runId) as { terms_version: string | null }
      ).terms_version,
    licences: (runId: string) =>
      sqlite
        .query(
          "SELECT run_id, github_id, state, basis, updated_at FROM trace_licences WHERE run_id = ?",
        )
        .all(runId),
    events: (runId: string) =>
      sqlite
        .query(
          "SELECT run_id, github_id, kind, reason, account_event_id, at FROM trace_licence_events WHERE run_id = ? ORDER BY id",
        )
        .all(runId),
  };
}

function enabledEventId(t: ReturnType<typeof api>) {
  return (
    t.sqlite
      .query(
        "SELECT id FROM trace_licensing_events WHERE github_id = ? AND kind = 'enabled' ORDER BY id DESC LIMIT 1",
      )
      .get(ACTOR) as { id: number }
  ).id;
}

describe("trace terms version and upload licence", () => {
  test("absent termsVersion finalizes as v1 with no licence even with setting on", async () => {
    const t = api();
    t.setting(true);
    const runId = await t.uploaded();
    expect(t.version(runId)).toBe("private-trace-v1");
    const finalized = await t.finalize(runId);
    expect(finalized.status).toBe(200);
    expect(t.version(runId)).toBe("private-trace-v1");
    expect(t.licences(runId)).toEqual([]);
    expect(t.events(runId)).toEqual([]);
  });

  test("v2 with setting off: no licence", async () => {
    const t = api();
    t.setting(true);
    t.setting(false);
    const runId = await t.uploaded("private-trace-v2");
    expect((await t.finalize(runId)).status).toBe(200);
    expect(t.version(runId)).toBe("private-trace-v2");
    expect(t.licences(runId)).toEqual([]);
    expect(t.events(runId)).toEqual([]);
  });

  test("v2 with no setting row: no licence", async () => {
    const t = api();
    const runId = await t.uploaded("private-trace-v2");
    expect((await t.finalize(runId)).status).toBe(200);
    expect(t.licences(runId)).toEqual([]);
    expect(t.events(runId)).toEqual([]);
  });

  test("v2 with setting on: licence licensed/upload plus one granted event", async () => {
    const t = api();
    t.setting(true);
    t.advance(1000);
    t.setting(false);
    t.advance(1000);
    t.setting(true);
    const latestEnabled = enabledEventId(t);
    t.advance(1000);
    const runId = await t.uploaded("private-trace-v2");
    t.advance(1000);
    const at = new Date(T0 + 4000).toISOString();
    const finalized = await t.finalize(runId);
    expect(finalized.status).toBe(200);
    expect(finalized.json.state).toBe("finalized");
    expect(t.licences(runId)).toEqual([
      {
        run_id: runId,
        github_id: ACTOR,
        state: "licensed",
        basis: "upload",
        updated_at: at,
      },
    ]);
    expect(t.events(runId)).toEqual([
      {
        run_id: runId,
        github_id: ACTOR,
        kind: "granted",
        reason: "upload",
        account_event_id: latestEnabled,
        at,
      },
    ]);
  });

  test("an explicit v1 is stamped and never licensed", async () => {
    const t = api();
    t.setting(true);
    const runId = await t.uploaded("private-trace-v1");
    expect((await t.finalize(runId)).status).toBe(200);
    expect(t.version(runId)).toBe("private-trace-v1");
    expect(t.licences(runId)).toEqual([]);
  });

  test("second intent with other version is 409 trace_terms_conflict", async () => {
    const t = api();
    const runId = await t.createRun();
    expect((await t.intent(runId, "private-trace-v2")).status).toBe(201);
    const same = await t.intent(runId, "private-trace-v2");
    expect(same.status).toBe(201);
    const other = await t.intent(runId, "private-trace-v1");
    expect(other.status).toBe(409);
    expect(other.json.error).toBe("trace_terms_conflict");
    const absent = await t.intent(runId);
    expect(absent.status).toBe(409);
    expect(absent.json.error).toBe("trace_terms_conflict");
    expect(t.version(runId)).toBe("private-trace-v2");
  });

  test("invalid termsVersion is 400", async () => {
    const t = api();
    const runId = await t.createRun();
    for (const value of ["private-trace-v3", "", 2, null]) {
      const refused = await t.intent(runId, value);
      expect(refused.status).toBe(400);
      expect(refused.json.error).toBe("invalid_request");
    }
    expect(t.version(runId)).toBeNull();
  });

  test("finalizing twice adds no second event", async () => {
    const t = api();
    t.setting(true);
    const runId = await t.uploaded("private-trace-v2");
    expect((await t.finalize(runId)).status).toBe(200);
    t.advance(60_000);
    expect((await t.finalize(runId)).status).toBe(200);
    expect(t.licences(runId)).toHaveLength(1);
    expect(t.events(runId)).toHaveLength(1);
  });

  test("a v2 run finalized with the setting off is not licensed by a later finalize", async () => {
    const t = api();
    const runId = await t.uploaded("private-trace-v2");
    expect((await t.finalize(runId)).status).toBe(200);
    t.setting(true);
    t.advance(60_000);
    expect((await t.finalize(runId)).status).toBe(200);
    expect(t.licences(runId)).toEqual([]);
    expect(t.events(runId)).toEqual([]);
  });

  test("a participation ban at finalization finalizes nothing and licenses nothing", async () => {
    const t = api();
    t.setting(true);
    const runId = await t.uploaded("private-trace-v2");
    seedParticipationBan(
      t.sqlite,
      { githubId: ACTOR, githubLogin: "contributor" },
      { githubId: "900000001", githubLogin: "admin" },
      new Date(T0).toISOString(),
    );
    const result = await t.deps.persistence.finalizeRun(
      runId,
      ACTOR,
      new Date(T0 + 1000).toISOString(),
    );
    expect(result).toBeNull();
    expect((await t.deps.persistence.getRun(runId))?.state).toBe(
      "trace_uploaded",
    );
    expect(t.licences(runId)).toEqual([]);
    expect(t.events(runId)).toEqual([]);
  });
});
