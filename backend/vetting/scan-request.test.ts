import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { vettingKeyPair } from "../../tests/vetting-fixtures";
import { CloudflareProjectPersistence } from "../projects/cloudflare-persistence";
import { handleVettingApi, queueAutomaticScan, vettingScanRequester } from "./handler";
import { CloudflareVettingPersistence } from "./persistence";

// Real queue wrappers and migrated persistence. Live-pin and service readiness
// are controlled observations; no provider/scanner executes in these tests.
const at = new Date("2026-11-09T00:00:00.000Z");
const owner = { githubId: "123", githubLogin: "owner" };
async function fixture() {
  const { db, sqlite } = sqliteD1();
  const projects = new CloudflareProjectPersistence(db);
  const manifest = assertProjectDefinition(applicationManifest("queue-test", "example/queue-test"));
  const manifestText = JSON.stringify(manifest);
  await projects.createProject({
    manifest, manifestText, manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    reason: "Queue fixture", actor: owner, at: at.toISOString(), referrer: null,
  }, await projects.enforcementGeneration());
  const project = await projects.getProject("queue-test");
  if (!project) throw new Error("Missing project fixture");
  const vetting = new CloudflareVettingPersistence(db);
  const keys = await vettingKeyPair();
  let sequence = 0, pinCalls = 0;
  const pin = { commitSha: "a".repeat(40), templateSha256: "b".repeat(64) };
  const base = {
    vetting,
    now: () => at,
    randomId: () => String(++sequence).padStart(32, "0"),
    livePin: async () => { pinCalls += 1; return { ...pin }; },
  };
  const requester = () => vettingScanRequester({ ...base, serviceAvailable: async () => true });
  const admin = async (body: unknown) => handleVettingApi(new Request("https://slop.cash/api/v1/admin/vetting/assessments", {
    method: "POST", headers: { origin: "https://slop.cash", "content-type": "application/json" }, body: JSON.stringify(body),
  }), {
    ...base, projects, resultPublicKeys: keys.publicKey,
    session: async () => ({ ...owner, admin: true }),
  });
  return { sqlite, project, projects, vetting, pin, base, requester, admin, keys,
    pinCalls: () => pinCalls, close: () => sqlite.close() };
}

test("owner readiness refusal does not read a pin or queue a row", async () => {
  const f = await fixture();
  try {
    const request = vettingScanRequester({ ...f.base, serviceAvailable: async () => false });
    expect(await request(f.project, owner, "Requested scan")).toMatchObject({ state: "unavailable" });
    expect(f.pinCalls()).toBe(0);
    expect(await f.vetting.projectAssessments(f.project.id)).toEqual([]);
  } finally { f.close(); }
});

test("owner pin outage is recoverable but other queue errors propagate", async () => {
  const f = await fixture();
  try {
    const missingPin = vettingScanRequester({ ...f.base, serviceAvailable: async () => true,
      livePin: async () => { throw new Error("pin offline"); } });
    expect(await missingPin(f.project, owner, "Requested scan")).toMatchObject({ state: "unavailable" });
    const invalidId = vettingScanRequester({ ...f.base, serviceAvailable: async () => true, randomId: () => "not-hex" });
    await expect(invalidId(f.project, owner, "Requested scan")).rejects.toMatchObject({ code: "internal_error" });
    expect(await f.vetting.projectAssessments(f.project.id)).toEqual([]);
  } finally { f.close(); }
});

test("owner readiness exception occurs before the recoverable pin boundary", async () => {
  const f = await fixture();
  try {
    const request = vettingScanRequester({ ...f.base,
      serviceAvailable: async () => { throw new Error("readiness read failed"); } });
    await expect(request(f.project, owner, "Requested scan")).rejects.toThrow("readiness read failed");
    expect(f.pinCalls()).toBe(0);
  } finally { f.close(); }
});

test("owner queue stores exact requester, live pin and truncated reason", async () => {
  const f = await fixture();
  try {
    expect(await f.requester()(f.project, owner, "r".repeat(1001))).toEqual({ state: "queued" });
    const rows = await f.vetting.projectAssessments(f.project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "pending", revision: f.project.revision,
      manifestSha256: f.project.manifestSha256, commitSha: f.pin.commitSha,
      templateSha256: f.pin.templateSha256, requestedBy: owner, requestReason: "r".repeat(1000) });
  } finally { f.close(); }
});

test("same current pin conflicts without replacing the first pending record", async () => {
  const f = await fixture();
  try {
    expect(await f.requester()(f.project, owner, "First scan")).toEqual({ state: "queued" });
    const first = await f.vetting.projectAssessments(f.project.id);
    expect(await f.requester()(f.project, owner, "Second scan")).toEqual({ state: "already_queued" });
    expect(await f.vetting.projectAssessments(f.project.id)).toEqual(first);
  } finally { f.close(); }
});

test("changed pin queues a new row while retaining the old pending source", async () => {
  const f = await fixture();
  try {
    await f.requester()(f.project, owner, "First scan");
    f.pin.commitSha = "c".repeat(40);
    expect(await f.requester()(f.project, owner, "New head")).toEqual({ state: "queued" });
    const rows = await f.vetting.projectAssessments(f.project.id);
    expect(rows.map((row) => row.commitSha)).toEqual(["a".repeat(40), "c".repeat(40)]);
    expect(rows.every((row) => row.state === "pending")).toBe(true);
  } finally { f.close(); }
});

test("a lost queue write reply leaves the record for exact retry recovery", async () => {
  const f = await fixture();
  try {
    const request = vettingScanRequester({ ...f.base, serviceAvailable: async () => true,
      vetting: {
        async createAssessment(...args) { await f.vetting.createAssessment(...args); throw new Error("lost insert reply"); },
        getAssessment: (id) => f.vetting.getAssessment(id),
      },
    });
    await expect(request(f.project, owner, "First scan")).rejects.toThrow("lost insert reply");
    expect(await f.vetting.projectAssessments(f.project.id)).toHaveLength(1);
    expect(await f.requester()(f.project, owner, "Retry scan")).toEqual({ state: "already_queued" });
  } finally { f.close(); }
});

test("missing post-insert readback does not undo the durable assessment", async () => {
  const f = await fixture();
  try {
    const request = vettingScanRequester({ ...f.base, serviceAvailable: async () => true,
      vetting: { createAssessment: (...args) => f.vetting.createAssessment(...args), getAssessment: async () => null },
    });
    await expect(request(f.project, owner, "Requested scan")).rejects.toMatchObject({ code: "internal_error" });
    expect(await f.vetting.projectAssessments(f.project.id)).toHaveLength(1);
  } finally { f.close(); }
});

test("automatic queue failures report unavailable without undoing their caller", async () => {
  const f = await fixture();
  try {
    expect(await queueAutomaticScan({ ...f.base, resultPublicKeys: undefined }, f.project, "Automatic scan")).toBe("unavailable");
    expect(f.pinCalls()).toBe(0);
    expect(await queueAutomaticScan({ ...f.base, resultPublicKeys: f.keys.publicKey, randomId: () => "bad" }, f.project, "Automatic scan"))
      .toBe("unavailable");
    expect(await f.vetting.projectAssessments(f.project.id)).toEqual([]);
  } finally { f.close(); }
});

test("automatic scan records the steward rather than an invented operator", async () => {
  const f = await fixture();
  try {
    expect(await queueAutomaticScan({ ...f.base, resultPublicKeys: f.keys.publicKey }, f.project, "Automatic scan"))
      .toBe("queued");
    expect((await f.vetting.projectAssessments(f.project.id))[0].requestedBy).toEqual({
      githubId: f.project.manifest.steward.github.actorId,
      githubLogin: f.project.manifest.steward.github.login,
    });
  } finally { f.close(); }
});

test("admin checks current revision and reports duplicate queue separately", async () => {
  const f = await fixture();
  try {
    const stale = await f.admin({ projectId: f.project.id, revision: 2, reason: "Investigate" });
    expect(stale?.status).toBe(409);
    expect(f.pinCalls()).toBe(0);
    const body = { projectId: f.project.id, revision: 1, reason: " Investigate " };
    expect((await f.admin(body))?.status).toBe(201);
    expect((await f.admin(body))?.status).toBe(409);
    expect((await f.vetting.projectAssessments(f.project.id))[0].requestReason).toBe("Investigate");
  } finally { f.close(); }
});
