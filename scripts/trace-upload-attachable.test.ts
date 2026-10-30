/**
 * Trace bodies are create-only, permanent R2 objects. An upload that cannot
 * attach to its run (a different trace already attached, or the run
 * finalized) must be refused before its bytes are written; otherwise private
 * bytes are retained with no D1 object, upload, or audit row, invisible to
 * every audited read path, while the client was told the upload failed.
 */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { signApiToken } from "../backend/trace/auth";
import {
  CloudflareTracePersistence,
  type R2Bucket,
} from "../backend/trace/cloudflare-persistence";
import {
  handleTraceApi,
  type TraceApiDependencies,
} from "../backend/trace/handler";
import { sha256Hex } from "../backend/trace/validation";
import { seedParticipationBan } from "../tests/participation-ban.fixture";
import { sqliteD1 } from "../tests/sqlite-d1";

const SECRET = "trace-upload-test-secret-0123456789abcdef-0123456789";
const ACTOR = "777001";
const T0 = Date.parse("2026-10-19T00:00:00.000Z");

/** A create-only bucket that records every object it was asked to keep. */
function r2() {
  let failNextWrite = false;
  const objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string; meta: Record<string, string> }
  >();
  const bucket: R2Bucket = {
    async head(key) {
      const object = objects.get(key);
      return object
        ? { size: object.bytes.byteLength, customMetadata: object.meta }
        : null;
    },
    async put(key, value, options) {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("local storage failure");
      }
      if (objects.has(key)) throw new Error("precondition failed");
      objects.set(key, {
        bytes: value.slice(),
        contentType: options.httpMetadata.contentType,
        meta: options.customMetadata,
      });
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
  return {
    bucket,
    objects,
    failNextWrite() {
      failNextWrite = true;
    },
  };
}

function api() {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  sqlite.exec("PRAGMA foreign_keys=ON");
  const store = r2();
  let counter = 0;
  const deps: TraceApiDependencies = {
    persistence: new CloudflareTracePersistence(db, store.bucket),
    authSecret: SECRET,
    operatorGithubIds: new Set<string>(),
    now: () => new Date(T0),
    randomId: () => `trace-upload-id-${++counter}`,
    verifyIdentityAssertion: async () => null,
    privateIntakeStatus: async () => ({
      status: "verified",
      enabled: true,
      verifiedAt: new Date(T0).toISOString(),
    }),
  };
  const token = async () => {
    const iat = Math.floor(T0 / 1000);
    return signApiToken(
      {
        iss: "slop.cash",
        aud: "private-trace-api",
        sub: `github:${ACTOR}`,
        githubId: ACTOR,
        githubLogin: "contributor",
        roles: ["contributor"],
        iat,
        exp: iat + 300,
        jti: `trace-upload-jti-0123456789-${++counter}`,
      },
      SECRET,
    );
  };
  const call = async (
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
    raw?: Uint8Array,
  ) => {
    const response = await handleTraceApi(
      new Request(`http://localhost/api/v1/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await token()}`,
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
  const createRun = () =>
    call(
      "POST",
      "runs",
      {
        clientRunId: "run_client_1",
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
  const intent = async (
    runId: string,
    bytes: Uint8Array,
    idempotencyKey = `intent-key-${++counter}-0123456789`,
  ) =>
    call(
      "POST",
      `runs/${runId}/trace-intents`,
      {
        sha256: await sha256Hex(bytes),
        sizeBytes: bytes.byteLength,
        contentType: "text/plain",
      },
      { "idempotency-key": idempotencyKey },
    );
  const upload = async (uploadUrl: string, bytes: Uint8Array) =>
    call(
      "PUT",
      `trace-uploads/${new URL(uploadUrl).pathname.split("/").pop()}`,
      undefined,
      {
        "content-type": "text/plain",
        digest: `sha-256=${await sha256Hex(bytes)}`,
      },
      bytes,
    );
  const finalize = (runId: string) =>
    call("POST", `runs/${runId}/finalize`, undefined, {
      "idempotency-key": `finalize-key-${++counter}-0123456789`,
    });
  const claimWallet = () =>
    call(
      "POST",
      "wallet-claims",
      {
        address: "0x1111111111111111111111111111111111111111",
        chain: "ethereum",
      },
      { "idempotency-key": `wallet-key-${++counter}-0123456789` },
    );
  const ban = () =>
    seedParticipationBan(
      sqlite,
      { githubId: ACTOR, githubLogin: "contributor" },
      { githubId: "900000001", githubLogin: "admin" },
      new Date(T0).toISOString(),
    );
  const retained = async (bytes: Uint8Array) => {
    const digest = await sha256Hex(bytes);
    return store.objects.has(`traces/sha256/${digest.slice(0, 2)}/${digest}`);
  };
  return {
    deps,
    createRun,
    intent,
    upload,
    finalize,
    claimWallet,
    ban,
    retained,
    failNextWrite: store.failNextWrite,
    reservation: (id: string) =>
      sqlite
        .query(
          "SELECT trace_sha256 FROM trace_write_reservations WHERE run_id = ?",
        )
        .get(id),
  };
}

const encode = (text: string) => new TextEncoder().encode(text);
const TRACE_A = encode("trace A\n");
const TRACE_B = encode("trace B, a different file\n");

async function runWithTraceA(t: ReturnType<typeof api>) {
  const created = await t.createRun();
  expect(created.status).toBe(201);
  const runId = created.json.serverRunId as string;
  const intentA = await t.intent(runId, TRACE_A);
  expect(intentA.status).toBe(201);
  const uploadA = await t.upload(intentA.json.uploadUrl as string, TRACE_A);
  expect(uploadA.status).toBe(201);
  expect(await t.retained(TRACE_A)).toBe(true);
  return runId;
}

test("uploaded traces cannot be read through removed routes, even by an operator", async () => {
  const t = api();
  const runId = await runWithTraceA(t);
  const digest = await sha256Hex(TRACE_A);
  t.deps.operatorGithubIds = new Set([ACTOR]);
  t.deps.operatorSession = async () => ({
    githubId: ACTOR,
    githubLogin: "contributor",
  });
  const bearer = async (role: "contributor" | "operator") =>
    signApiToken(
      {
        iss: "slop.cash",
        aud: "private-trace-api",
        sub: `github:${ACTOR}`,
        githubId: ACTOR,
        githubLogin: "contributor",
        roles: [role],
        iat: Math.floor(T0 / 1000),
        exp: Math.floor(T0 / 1000) + 300,
        jti: `removed-trace-route-${role}`,
      },
      SECRET,
    );
  const callers: { origin: string; headers: Record<string, string> }[] = [
    { origin: "https://api.slop.cash", headers: {} },
    {
      origin: "https://api.slop.cash",
      headers: { authorization: `Bearer ${await bearer("contributor")}` },
    },
    {
      origin: "https://api.slop.cash",
      headers: { authorization: `Bearer ${await bearer("operator")}` },
    },
    {
      origin: "https://slop.cash",
      headers: { cookie: "slop_session=fixture", origin: "https://slop.cash" },
    },
  ];
  for (const caller of callers) {
    for (const method of ["GET", "POST"]) {
      const path = `operator/traces/${digest}${method === "POST" ? "/grant" : ""}`;
      const response = await handleTraceApi(
        new Request(`${caller.origin}/api/v1/${path}`, {
          method,
          headers: caller.headers,
        }),
        t.deps,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  }
  // Removing reads neither deletes the object nor blocks normal run completion.
  expect(await t.retained(TRACE_A)).toBe(true);
  expect((await t.finalize(runId)).status).toBe(200);
  expect(await t.retained(TRACE_A)).toBe(true);
});

test("a second trace for a run is refused at the intent, and its bytes are never written", async () => {
  const t = api();
  const runId = await runWithTraceA(t);
  const intentB = await t.intent(runId, TRACE_B);
  expect(intentB.status).toBe(409);
  expect(intentB.json).toMatchObject({
    error: "trace_conflict",
  });
  // The same trace may be re-declared: the intent stays idempotent.
  expect((await t.intent(runId, TRACE_A)).status).toBe(201);
  expect(await t.retained(TRACE_B)).toBe(false);
});

test("an intent issued before another trace attached cannot write its bytes", async () => {
  const t = api();
  const created = await t.createRun();
  const runId = created.json.serverRunId as string;
  const intentB = await t.intent(runId, TRACE_B);
  expect(intentB.status).toBe(201);
  const intentA = await t.intent(runId, TRACE_A);
  expect(
    (await t.upload(intentA.json.uploadUrl as string, TRACE_A)).status,
  ).toBe(201);
  const uploadB = await t.upload(intentB.json.uploadUrl as string, TRACE_B);
  expect(uploadB.status).toBe(409);
  expect(uploadB.json).toMatchObject({
    error: "trace_conflict",
  });
  expect(await t.retained(TRACE_B)).toBe(false);
});

test("an intent issued before finalization cannot write its bytes afterwards", async () => {
  const t = api();
  const runId = await runWithTraceA(t);
  const created = await t.createRun();
  const other = created.json.serverRunId as string;
  const intentB = await t.intent(other, TRACE_B);
  expect(intentB.status).toBe(201);
  const intentA = await t.intent(other, TRACE_A);
  expect(
    (await t.upload(intentA.json.uploadUrl as string, TRACE_A)).status,
  ).toBe(201);
  expect((await t.finalize(other)).status).toBe(200);
  expect((await t.finalize(runId)).status).toBe(200);
  const uploadB = await t.upload(intentB.json.uploadUrl as string, TRACE_B);
  expect(uploadB.status).toBe(409);
  expect(uploadB.json).toMatchObject({
    error: "run_finalized",
  });
  expect(await t.retained(TRACE_B)).toBe(false);
});

test("overlapping different uploads retain only the reserved trace", async () => {
  const t = api();
  const created = await t.createRun();
  const id = created.json.serverRunId as string;
  const a = await t.intent(id, TRACE_A);
  const b = await t.intent(id, TRACE_B);
  const results = await Promise.all([
    t.upload(a.json.uploadUrl as string, TRACE_A),
    t.upload(b.json.uploadUrl as string, TRACE_B),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    [await t.retained(TRACE_A), await t.retained(TRACE_B)].filter(Boolean),
  ).toHaveLength(1);
});

test("a failed storage write retains its reservation and permits a same-byte retry", async () => {
  const t = api();
  const created = await t.createRun();
  const id = created.json.serverRunId as string;
  const a = await t.intent(id, TRACE_A);
  const b = await t.intent(id, TRACE_B);
  t.failNextWrite();
  expect((await t.upload(a.json.uploadUrl as string, TRACE_A)).status).toBe(
    500,
  );
  expect(await t.retained(TRACE_A)).toBe(false);
  expect(t.reservation(id)).toEqual({ trace_sha256: await sha256Hex(TRACE_A) });
  expect((await t.finalize(id)).status).toBe(409);
  expect((await t.upload(b.json.uploadUrl as string, TRACE_B)).status).toBe(
    409,
  );
  expect(await t.retained(TRACE_B)).toBe(false);
  expect((await t.upload(a.json.uploadUrl as string, TRACE_A)).status).toBe(
    201,
  );
  expect((await t.finalize(id)).status).toBe(200);
});

test("a stale or disabled private intake observation refuses a capability upload before any bytes are kept", async () => {
  const t = api();
  const created = await t.createRun();
  const runId = created.json.serverRunId as string;
  const intentA = await t.intent(runId, TRACE_A);
  expect(intentA.status).toBe(201);
  const uploadUrl = intentA.json.uploadUrl as string;
  const observations = [
    { status: "unavailable" as const },
    {
      status: "verified" as const,
      enabled: false,
      verifiedAt: new Date(T0).toISOString(),
    },
  ];
  for (const observation of observations) {
    // A client that skips the public preflight still reaches the write path.
    t.deps.privateIntakeStatus = async () => observation;
    const refused = await t.upload(uploadUrl, TRACE_A);
    expect(refused.status).toBe(503);
    expect(refused.json).toEqual({ error: "private_intake_unavailable" });
    expect(await t.retained(TRACE_A)).toBe(false);
    expect(t.reservation(runId)).toBeNull();
    expect((await t.deps.persistence.getRun(runId))?.state).toBe(
      "awaiting_trace",
    );
  }
  // The unconsumed capability uploads once the observation is renewed.
  t.deps.privateIntakeStatus = async () => ({
    status: "verified",
    enabled: true,
    verifiedAt: new Date(T0).toISOString(),
  });
  expect((await t.upload(uploadUrl, TRACE_A)).status).toBe(201);
  expect(await t.retained(TRACE_A)).toBe(true);
  expect((await t.finalize(runId)).status).toBe(200);
});

test("an account ban stops trace intents, capability uploads and finalization on existing runs without retaining R2 bytes, while preserving wallet claims", async () => {
  const t = api();
  const runUploaded = await runWithTraceA(t);
  const createdWithIntent = await t.createRun();
  expect(createdWithIntent.status).toBe(201);
  const runWithIntent = createdWithIntent.json.serverRunId as string;
  const intentKey = "intent-before-ban-0123456789";
  const intentB = await t.intent(runWithIntent, TRACE_B, intentKey);
  expect(intentB.status).toBe(201);
  const createdAwaiting = await t.createRun();
  expect(createdAwaiting.status).toBe(201);
  const runAwaiting = createdAwaiting.json.serverRunId as string;

  t.ban();

  const refusedIntent = await t.intent(runAwaiting, TRACE_B);
  expect(refusedIntent.status).toBe(403);
  expect(refusedIntent.json.error).toBe("participation_banned");

  const refusedReplayIntent = await t.intent(runWithIntent, TRACE_B, intentKey);
  expect(refusedReplayIntent.status).toBe(403);
  expect(refusedReplayIntent.json.error).toBe("participation_banned");

  const refusedUpload = await t.upload(
    intentB.json.uploadUrl as string,
    TRACE_B,
  );
  expect(refusedUpload.status).toBe(403);
  expect(refusedUpload.json.error).toBe("participation_banned");
  expect(await t.retained(TRACE_B)).toBe(false);
  expect(t.reservation(runWithIntent)).toBeNull();

  const refusedFinalize = await t.finalize(runUploaded);
  expect(refusedFinalize.status).toBe(403);
  expect(refusedFinalize.json.error).toBe("participation_banned");
  expect((await t.deps.persistence.getRun(runUploaded))?.state).toBe(
    "trace_uploaded",
  );

  // Funded award claims remain available to banned accounts (PRD section 8).
  const walletClaim = await t.claimWallet();
  expect(walletClaim.status).toBe(201);
});

test("a ban landing concurrently with trace intent creation, capability upload or finalization refuses the write", async () => {
  // 1. Concurrent ban during createTraceIntent
  {
    const t = api();
    const created = await t.createRun();
    const runId = created.json.serverRunId as string;
    const readBan = t.deps.persistence.hasParticipationBan.bind(
      t.deps.persistence,
    );
    let pendingBan = true;
    t.deps.persistence.hasParticipationBan = async (githubId) => {
      const banned = await readBan(githubId);
      if (pendingBan) {
        pendingBan = false;
        t.ban();
      }
      return banned;
    };
    const refused = await t.intent(runId, TRACE_B);
    expect(refused.status).toBe(403);
    expect(refused.json.error).toBe("participation_banned");
  }

  // 2. Concurrent ban during uploadTraceCapability before reserveTraceWrite
  {
    const t = api();
    const created = await t.createRun();
    const runId = created.json.serverRunId as string;
    const intentB = await t.intent(runId, TRACE_B);
    expect(intentB.status).toBe(201);
    const readBan = t.deps.persistence.hasParticipationBan.bind(
      t.deps.persistence,
    );
    let pendingBan = true;
    t.deps.persistence.hasParticipationBan = async (githubId) => {
      const banned = await readBan(githubId);
      if (pendingBan) {
        pendingBan = false;
        t.ban();
      }
      return banned;
    };
    const refused = await t.upload(intentB.json.uploadUrl as string, TRACE_B);
    expect(refused.status).toBe(403);
    expect(refused.json.error).toBe("participation_banned");
    expect(await t.retained(TRACE_B)).toBe(false);
    expect(t.reservation(runId)).toBeNull();
  }

  // 3. Concurrent ban during finalizeRun
  {
    const t = api();
    const runId = await runWithTraceA(t);
    const readBan = t.deps.persistence.hasParticipationBan.bind(
      t.deps.persistence,
    );
    let pendingBan = true;
    t.deps.persistence.hasParticipationBan = async (githubId) => {
      const banned = await readBan(githubId);
      if (pendingBan) {
        pendingBan = false;
        t.ban();
      }
      return banned;
    };
    const refused = await t.finalize(runId);
    expect(refused.status).toBe(403);
    expect(refused.json.error).toBe("participation_banned");
    expect((await t.deps.persistence.getRun(runId))?.state).toBe(
      "trace_uploaded",
    );
  }

  // 4. Ban landing after reserveTraceWrite: the reservation already authorized
  // one write, so the bytes stay in R2, but the attachment is refused.
  {
    const t = api();
    const created = await t.createRun();
    const runId = created.json.serverRunId as string;
    const intentB = await t.intent(runId, TRACE_B);
    expect(intentB.status).toBe(201);
    const reserve = t.deps.persistence.reserveTraceWrite.bind(
      t.deps.persistence,
    );
    t.deps.persistence.reserveTraceWrite = async (input) => {
      const reserved = await reserve(input);
      t.ban();
      return reserved;
    };
    const refused = await t.upload(intentB.json.uploadUrl as string, TRACE_B);
    expect(refused.status).toBe(403);
    expect(refused.json.error).toBe("participation_banned");
    expect(await t.retained(TRACE_B)).toBe(true);
    expect(
      await t.deps.persistence.getTraceObject(await sha256Hex(TRACE_B)),
    ).toBeNull();
    expect((await t.deps.persistence.getRun(runId))?.state).toBe(
      "awaiting_trace",
    );
  }
});
