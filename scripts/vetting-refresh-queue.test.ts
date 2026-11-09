import { expect, test } from "bun:test";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { handleVettingApi, type VettingApiDependencies } from "../backend/vetting/handler";
import { CloudflareVettingPersistence, type VettingPin } from "../backend/vetting/persistence";
import { sha256Hex } from "../src/lib/async-sha256.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { signedVettingHeaders, vettingKeyPair } from "../tests/vetting-fixtures";

// Actual signed refresh handler and migrated persistence. No acquisition,
// scanner/provider calls or chain activity. D1 reply loss is injected only
// after the real INSERT has completed; read faults precede real queries.
const ORIGIN = "https://slop.cash";
const PATH = "/api/v1/vetting/refresh";
const NOW = new Date("2026-11-09T12:00:00.000Z");
const ACTOR = { githubId: "987654321", githubLogin: "example" };
async function fixture() {
  const { db, sqlite } = sqliteD1();
  const projects = new CloudflareProjectPersistence(db);
  const keys = await vettingKeyPair();
  const state = {
    pin: { commitSha: "a".repeat(40), templateSha256: "b".repeat(64) } as VettingPin,
    failPinFor: "", failReadFor: "", loseInsertFor: "", ids: 0,
  };
  const guarded: typeof db = {
    prepare(sql) {
      const wrap = (statement: ReturnType<typeof db.prepare>, args: unknown[] = []): ReturnType<typeof db.prepare> => ({
        ...statement,
        bind: (...values) => wrap(statement.bind(...values), values),
        all: async <T>() => {
          if (state.failReadFor === args[0] && sql.includes("FROM vetting_assessments WHERE project_id = ?"))
            throw new Error("injected assessment read failure");
          return statement.all<T>();
        },
        run: async () => {
          const result = await statement.run();
          if (state.loseInsertFor === args[1] && sql.startsWith("INSERT INTO vetting_assessments")) {
            state.loseInsertFor = "";
            throw new Error("injected committed insert reply loss");
          }
          return result;
        },
      });
      return wrap(db.prepare(sql));
    },
    batch: (statements) => db.batch(statements),
  };
  const vetting = new CloudflareVettingPersistence(guarded);
  const deps: VettingApiDependencies = {
    vetting, projects, resultPublicKeys: keys.publicKey,
    livePin: async (manifest) => {
      if (manifest.id === state.failPinFor) throw new Error("injected pin failure");
      return state.pin;
    },
    session: async () => null,
    now: () => NOW,
    randomId: () => `00000000-0000-4000-8000-${String(++state.ids).padStart(12, "0")}`,
  };
  const seed = async (id: string) => {
    const manifest = assertProjectDefinition(applicationManifest(id, `example/${id}`));
    const text = JSON.stringify(manifest);
    expect(await projects.createProject({
      manifest, manifestText: text, manifestSha256: await sha256Hex(text), reason: "Refresh fixture",
      actor: ACTOR, at: NOW.toISOString(), referrer: null,
    }, await projects.enforcementGeneration())).toBe("created");
  };
  const refresh = async (body = "{}") => {
    const response = await handleVettingApi(new Request(`${ORIGIN}${PATH}`, {
      method: "POST", headers: {
        "content-type": "application/json",
        ...await signedVettingHeaders(keys.privateKey, keys.raw, "POST", PATH, body, NOW),
      }, body,
    }), deps);
    if (!response) throw new Error("Refresh route missing");
    return { status: response.status, body: await response.json() as {
      queued?: string[]; reinstated?: string[]; skipped?: { projectId: string; reason: string }[]; error?: string;
    } };
  };
  return { sqlite, projects, vetting, state, deps, seed, refresh, close: () => sqlite.close() };
}

test("signed refresh requires the exact empty object bytes", async () => {
  const f = await fixture();
  try {
    await f.seed("refresh-a");
    const result = await f.refresh("{ }");
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_request");
    expect(await f.vetting.pendingAssessments()).toEqual([]);
  } finally { f.close(); }
});

test("ordinary projects queue in registry order and a matching pending pin is not duplicated", async () => {
  const f = await fixture();
  try {
    await f.seed("refresh-b");
    await f.seed("refresh-a");
    const first = await f.refresh();
    expect(first.status).toBe(200);
    expect(first.body.queued).toHaveLength(2);
    const rows = await Promise.all(first.body.queued!.map((id) => f.vetting.getAssessment(id)));
    expect(rows.map((row) => row?.projectId)).toEqual(["refresh-a", "refresh-b"]);
    const second = await f.refresh();
    expect(second).toEqual({ status: 200, body: { queued: [], reinstated: [], skipped: [] } });
    expect(await f.vetting.pendingAssessments()).toHaveLength(2);
  } finally { f.close(); }
});

test("a template replacement keeps the original assigned commit and manifest", async () => {
  const f = await fixture();
  try {
    await f.seed("refresh-a");
    const first = await f.refresh();
    const before = await f.vetting.getAssessment(first.body.queued![0]);
    if (!before) throw new Error("Initial assessment missing");
    f.state.pin = { commitSha: "c".repeat(40), templateSha256: "d".repeat(64) };
    const second = await f.refresh();
    expect(second.status).toBe(200);
    expect(second.body.queued).toHaveLength(1);
    const after = await f.vetting.getAssessment(second.body.queued![0]);
    expect(after).toMatchObject({
      projectId: before.projectId, revision: before.revision,
      manifestSha256: before.manifestSha256, contentSha256: before.contentSha256,
      commitSha: before.commitSha, templateSha256: f.state.pin.templateSha256,
    });
    expect(f.sqlite.query("SELECT replaces_assessment_id FROM vetting_assessments WHERE id=?")
      .get(second.body.queued![0])).toEqual({ replaces_assessment_id: before.id });
    expect(await f.vetting.getAssessment(before.id)).toEqual(before);
  } finally { f.close(); }
});

test("one pin failure is skipped while the later project still queues", async () => {
  const f = await fixture();
  try {
    await f.seed("refresh-a"); await f.seed("refresh-b");
    f.state.failPinFor = "refresh-a";
    const result = await f.refresh();
    expect(result.status).toBe(200);
    expect(result.body.skipped).toEqual([{ projectId: "refresh-a", reason: "pin_unavailable" }]);
    expect(result.body.queued).toHaveLength(1);
    expect((await f.vetting.getAssessment(result.body.queued![0]))?.projectId).toBe("refresh-b");
  } finally { f.close(); }
});

test("an uncaught later assessment read fails the response but keeps the first queued project", async () => {
  const f = await fixture();
  try {
    await f.seed("refresh-a"); await f.seed("refresh-b");
    f.state.failReadFor = "refresh-b";
    const result = await f.refresh();
    expect(result.status).toBe(500);
    expect(result.body).not.toHaveProperty("queued");
    f.state.failReadFor = "";
    expect((await f.vetting.projectAssessments("refresh-a"))).toHaveLength(1);
    expect((await f.vetting.projectAssessments("refresh-b"))).toHaveLength(0);
  } finally { f.close(); }
});

test("the per-refresh cap counts confirmed returns rather than committed rows with lost replies", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 26; i += 1) await f.seed(`refresh-${String(i).padStart(2, "0")}`);
    f.state.loseInsertFor = "refresh-00";
    const result = await f.refresh();
    expect(result.status).toBe(200);
    expect(result.body.queued).toHaveLength(25);
    expect(result.body.skipped).toEqual([{ projectId: "refresh-00", reason: "queue_failed" }]);
    expect(f.sqlite.query("SELECT COUNT(*) AS n FROM vetting_assessments").get()).toEqual({ n: 26 });
    expect((await f.vetting.projectAssessments("refresh-00"))).toHaveLength(1);
  } finally { f.close(); }
});

test("a successful 25-row cap leaves later projects unvisited for the next refresh", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 26; i += 1) await f.seed(`refresh-${String(i).padStart(2, "0")}`);
    const first = await f.refresh();
    expect(first.body.queued).toHaveLength(25);
    expect((await f.vetting.projectAssessments("refresh-25"))).toHaveLength(0);
    const second = await f.refresh();
    expect(second.body.queued).toHaveLength(1);
    expect((await f.vetting.getAssessment(second.body.queued![0]))?.projectId).toBe("refresh-25");
  } finally { f.close(); }
});
