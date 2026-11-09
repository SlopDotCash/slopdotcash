import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { signedVettingHeaders, vettingKeyPair } from "../../tests/vetting-fixtures";
import { CloudflareProjectPersistence } from "../projects/cloudflare-persistence";
import { VettingEvidence } from "./evidence";
import { handleVettingApi } from "./handler";
import { CloudflareVettingPersistence, type VettingAssessment } from "./persistence";

// Source-authored regressions for the real signed endpoint and migrated SQL.
// The evidence adapter records readiness only; no R2, scanner or provider call
// belongs to this endpoint. These definitions were not executed in this audit.
const at = new Date("2026-11-09T00:00:00.000Z");
const owner = { githubId: "123", githubLogin: "queue-owner" };
const path = "/api/v1/vetting/requests";

async function fixture() {
  const { db, sqlite } = sqliteD1();
  const projects = new CloudflareProjectPersistence(db);
  const keys = await vettingKeyPair();
  let sequence = 0;
  class QueueStore extends CloudflareVettingPersistence {
    reads = 0;
    failure: Error | null = null;
    afterRead: (() => Promise<void>) | null = null;
    override async pendingAssessments() {
      this.reads += 1;
      if (this.failure) throw this.failure;
      const rows = await super.pendingAssessments();
      const callback = this.afterRead;
      this.afterRead = null;
      if (callback) await callback();
      return rows;
    }
  }
  const vetting = new QueueStore(db);
  let bucketCalls = 0;
  class QueueEvidence extends VettingEvidence {
    reads = 0;
    available = true;
    override ready() {
      this.reads += 1;
      return this.available && super.ready();
    }
  }
  const evidence = new QueueEvidence({
    db, now: () => at, randomId: () => "unused",
    bucket: {
      head: async () => { bucketCalls += 1; throw new Error("Queue must not read evidence bodies"); },
      get: async () => { bucketCalls += 1; throw new Error("Queue must not read evidence bodies"); },
      put: async () => { bucketCalls += 1; throw new Error("Queue must not write evidence bodies"); },
    },
  });
  const projectIds = new Set<string>();
  async function queue(projectId: string, requestedAt = at.toISOString()) {
    if (!projectIds.has(projectId)) {
      const manifest = assertProjectDefinition(applicationManifest(projectId, `example/${projectId}`));
      const manifestText = JSON.stringify(manifest);
      await projects.createProject({ manifest, manifestText,
        manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
        reason: "Queue fixture", actor: owner, at: at.toISOString(), referrer: null,
      }, await projects.enforcementGeneration());
      projectIds.add(projectId);
    }
    const project = await projects.getProject(projectId);
    if (!project) throw new Error("Missing queue project");
    const value = (++sequence).toString(16);
    const assessment: VettingAssessment = {
      id: `vet_${value.padStart(32, "0")}`, projectId, revision: project.revision,
      manifestSha256: project.manifestSha256, contentSha256: value.padStart(64, "0"),
      commitSha: value.padStart(40, "0"), templateSha256: value.padStart(64, "0"),
      requestedAt, requestedBy: owner, requestReason: `Private request reason ${sequence}`,
      state: "pending", policyVersion: null, result: null, resultSha256: null,
      signingKeySha256: null, completedAt: null,
    };
    expect(await vetting.createAssessment(assessment)).toBe("created");
    return assessment;
  }
  function complete(assessment: VettingAssessment, state: "clean" | "incomplete" | "malicious") {
    // Populate the exact columns constrained by the real one-result trigger.
    // Result admission/evidence validation is deliberately not under test here.
    const result = { assessmentId: assessment.id, disposition: state,
      assessed: { commitSha: assessment.commitSha, templateSha256: assessment.templateSha256 } };
    sqlite.query(`UPDATE vetting_assessments SET state=?, policy_version=?, result=?,
      result_sha256=?, signing_key_sha256=?, completed_at=? WHERE id=?`).run(
      state, "queue-fixture", JSON.stringify(result), "d".repeat(64), "e".repeat(64),
      at.toISOString(), assessment.id,
    );
  }
  async function read(options: { authenticated?: boolean; configured?: boolean;
    origin?: string; evidence?: VettingEvidence | null } = {}) {
    const headers = options.authenticated === false ? {} : await signedVettingHeaders(
      keys.privateKey, keys.raw, "GET", path, "", at,
    );
    const response = await handleVettingApi(new Request(`${options.origin ?? "https://slop.cash"}${path}`, { headers }), {
      vetting, evidence: options.evidence === null ? undefined : options.evidence ?? evidence,
      projects: {
        getProject: async () => { throw new Error("Queue must not replace its assigned source with the live project"); },
        listProjects: async () => { throw new Error("Queue must not enumerate the live registry"); },
        listEnforcements: async () => { throw new Error("Queue must not independently filter assigned work"); },
        enforcementGeneration: async () => { throw new Error("Queue must not read live enforcement"); },
      },
      resultPublicKeys: options.configured === false ? undefined : keys.publicKey,
      now: () => at, randomId: () => "unused",
      livePin: async () => { throw new Error("Queue must not replace its assigned pin"); },
      session: async () => { throw new Error("Service queue does not use a browser session"); },
    });
    if (!response) throw new Error("Queue route was not handled");
    return response;
  }
  return { db, sqlite, vetting, evidence, queue, complete, read,
    bucketCalls: () => bucketCalls, close: () => sqlite.close() };
}

function publicAssignment(row: VettingAssessment, origin = "https://slop.cash") {
  return {
    assessmentId: row.id, projectId: row.projectId, revision: row.revision,
    manifestSha256: row.manifestSha256, commitSha: row.commitSha,
    templateSha256: row.templateSha256,
    manifestUrl: `${origin}/api/v1/project-revisions/${row.projectId}/${row.revision}`,
    templateIndexUrl: `${origin}/skill-templates/index.json`, requestedAt: row.requestedAt,
  };
}

test("signed empty queue returns the exact empty schema without acquiring evidence", async () => {
  const f = await fixture();
  try {
    const response = await f.read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: "slop-vetting-queue-v1", assessments: [] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.vetting.reads).toBe(1);
    expect(f.evidence.reads).toBe(1);
    expect(f.bucketCalls()).toBe(0);
  } finally { f.close(); }
});

test("queue returns only the assigned immutable source and redacts private assessment fields", async () => {
  const f = await fixture();
  try {
    const row = await f.queue("queue-private");
    const before = await f.vetting.getAssessment(row.id);
    expect(await (await f.read()).json()).toEqual({
      schemaVersion: "slop-vetting-queue-v1", assessments: [publicAssignment(row)],
    });
    expect(await f.vetting.getAssessment(row.id)).toEqual(before);
    expect(f.bucketCalls()).toBe(0);
  } finally { f.close(); }
});

test("unsigned requests fail before evidence readiness or database reads", async () => {
  const f = await fixture();
  try {
    f.evidence.available = false;
    const response = await f.read({ authenticated: false });
    expect(response.status).toBe(401);
    expect(f.evidence.reads).toBe(0);
    expect(f.vetting.reads).toBe(0);
  } finally { f.close(); }
});

test("unconfigured signing keys refuse before evidence or queue inspection", async () => {
  const f = await fixture();
  try {
    const response = await f.read({ configured: false });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("vetting_unavailable");
    expect(f.evidence.reads).toBe(0);
    expect(f.vetting.reads).toBe(0);
  } finally { f.close(); }
});

test("missing or unavailable evidence refuses an authenticated queue read", async () => {
  const f = await fixture();
  try {
    const absent = await f.read({ evidence: null });
    expect(absent.status).toBe(503);
    expect((await absent.json()).error).toBe("evidence_unavailable");
    f.evidence.available = false;
    expect((await f.read()).status).toBe(503);
    expect(f.vetting.reads).toBe(0);
    expect(f.bucketCalls()).toBe(0);
  } finally { f.close(); }
});

test("query failure redacts its details and leaves the assignment recoverable", async () => {
  const f = await fixture();
  try {
    const row = await f.queue("queue-retry");
    f.vetting.failure = new Error("Private database diagnostic and request reason");
    const response = await f.read();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error", message: "Internal error" });
    expect(await f.vetting.getAssessment(row.id)).toEqual(row);
    f.vetting.failure = null;
    expect((await (await f.read()).json()).assessments).toEqual([publicAssignment(row)]);
  } finally { f.close(); }
});

test("highest rowid wins even when its requested timestamp sorts earlier", async () => {
  const f = await fixture();
  try {
    const old = await f.queue("queue-latest", "2026-11-09T03:00:00.000Z");
    const current = await f.queue("queue-latest", "2026-11-09T01:00:00.000Z");
    expect((await f.vetting.pendingAssessments()).map((row) => row.id)).toEqual([current.id]);
    expect((await f.vetting.getAssessment(old.id))?.state).toBe("pending");
  } finally { f.close(); }
});

test.each(["clean", "incomplete", "malicious"] as const)(
  "latest %s record suppresses historical pending work without deleting it", async (state) => {
    const f = await fixture();
    try {
      const old = await f.queue("queue-terminal");
      const current = await f.queue("queue-terminal");
      f.complete(current, state);
      expect(await f.vetting.pendingAssessments()).toEqual([]);
      expect((await f.vetting.getAssessment(old.id))?.state).toBe("pending");
      expect((await f.vetting.getAssessment(current.id))?.state).toBe(state);
      expect(await f.vetting.projectAssessments(old.projectId)).toHaveLength(2);
    } finally { f.close(); }
  },
);

test("queue ordering uses requested time followed by insertion rowid", async () => {
  const f = await fixture();
  try {
    const late = await f.queue("queue-late", "2026-11-09T03:00:00.000Z");
    const first = await f.queue("queue-first", "2026-11-09T01:00:00.000Z");
    const second = await f.queue("queue-second", "2026-11-09T01:00:00.000Z");
    expect((await f.vetting.pendingAssessments()).map((row) => row.id)).toEqual([first.id, second.id, late.id]);
  } finally { f.close(); }
});

test("100-row cap applies after selecting the current assessment of each project", async () => {
  const f = await fixture();
  try {
    const old = await f.queue("queue-001");
    const current = await f.queue("queue-001");
    const expected = [current.id];
    for (let index = 2; index <= 101; index += 1) {
      const row = await f.queue(`queue-${String(index).padStart(3, "0")}`);
      if (index <= 100) expected.push(row.id);
    }
    expect((await f.vetting.pendingAssessments()).map((row) => row.id)).toEqual(expected);
    expect((await f.vetting.getAssessment(old.id))?.state).toBe("pending");
    expect(sqliteCount(f.sqlite)).toBe(102);
  } finally { f.close(); }
});

function sqliteCount(sqlite: ReturnType<typeof sqliteD1>["sqlite"]) {
  return (sqlite.query("SELECT COUNT(*) AS count FROM vetting_assessments").get() as { count: number }).count;
}

test("completion after the SQL read leaves that response intact and changes the next poll", async () => {
  const f = await fixture();
  try {
    const row = await f.queue("queue-completion-race");
    f.vetting.afterRead = async () => f.complete(row, "clean");
    expect((await (await f.read()).json()).assessments).toEqual([publicAssignment(row)]);
    expect((await (await f.read()).json()).assessments).toEqual([]);
    expect((await f.vetting.getAssessment(row.id))?.state).toBe("clean");
  } finally { f.close(); }
});

test("replacement after the SQL read does not splice a new source into an old response", async () => {
  const f = await fixture();
  try {
    const first = await f.queue("queue-replacement-race");
    let replacement: VettingAssessment | undefined;
    f.vetting.afterRead = async () => { replacement = await f.queue(first.projectId); };
    expect((await (await f.read()).json()).assessments).toEqual([publicAssignment(first)]);
    if (!replacement) throw new Error("Replacement fixture was not created");
    expect((await (await f.read()).json()).assessments).toEqual([publicAssignment(replacement)]);
    expect((await f.vetting.getAssessment(first.id))?.state).toBe("pending");
  } finally { f.close(); }
});

test("replayed and concurrent signed polls read the same work without claiming it", async () => {
  const f = await fixture();
  try {
    const row = await f.queue("queue-read-only");
    const responses = await Promise.all([f.read(), f.read(), f.read()]);
    for (const response of responses) expect((await response.json()).assessments).toEqual([publicAssignment(row)]);
    expect(await f.vetting.getAssessment(row.id)).toEqual(row);
    expect(sqliteCount(f.sqlite)).toBe(1);
  } finally { f.close(); }
});

test("both immutable read URLs use the incoming request origin", async () => {
  const f = await fixture();
  try {
    const row = await f.queue("queue-origin");
    const origin = "https://alternate.slop.invalid:8443";
    expect((await (await f.read({ origin })).json()).assessments).toEqual([publicAssignment(row, origin)]);
  } finally { f.close(); }
});

test("readiness is observed once before the snapshot and performs no R2 operation", async () => {
  const f = await fixture();
  try {
    const row = await f.queue("queue-ready-observation");
    f.vetting.afterRead = async () => { f.evidence.available = false; };
    expect((await (await f.read()).json()).assessments).toEqual([publicAssignment(row)]);
    expect(f.evidence.reads).toBe(1);
    expect(f.bucketCalls()).toBe(0);
    expect((await f.read()).status).toBe(503);
    expect(f.vetting.reads).toBe(1);
  } finally { f.close(); }
});
