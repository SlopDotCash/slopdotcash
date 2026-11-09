import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { JOURNAL_SCHEMA, type PublicationIntent, type PublicationReceipt } from "../../src/lib/vetting-contracts";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { signedVettingHeaders, vettingKeyPair } from "../../tests/vetting-fixtures";
import { CloudflareProjectPersistence } from "../projects/cloudflare-persistence";
import { handleVettingApi } from "./handler";
import { CloudflareVettingPersistence } from "./persistence";

// Actual signed route and migrated SQL. Auth, provider and deployment acceptance
// remain separate. These source-authored cases have not been executed here.
const ORIGIN = "https://slop.cash";
const PATH = "/api/v1/vetting/journal";
const NOW = new Date("2026-11-09T12:00:00.000Z");
const ID = `vet_${"1".repeat(32)}`;
async function fixture() {
  const { db, sqlite } = sqliteD1();
  const keys = await vettingKeyPair();
  const projects = new CloudflareProjectPersistence(db);
  const owner = { githubId: "123", githubLogin: "journal-owner" };
  const manifest = assertProjectDefinition(applicationManifest("journal-test", "example/journal-test"));
  const manifestText = JSON.stringify(manifest);
  await projects.createProject({ manifest, manifestText,
    manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    reason: "Journal fixture", actor: owner, at: NOW.toISOString(), referrer: null,
  }, await projects.enforcementGeneration());
  const project = await projects.getProject("journal-test");
  if (!project) throw new Error("Missing journal fixture project");
  class JournalStore extends CloudflareVettingPersistence {
    assessmentReads = 0; presenceReads = 0; reserves = 0; completions = 0;
    loseReserveReply = false; loseCompleteReply = false; failReserve = false;
    override async getAssessment(id: string) { this.assessmentReads++; return super.getAssessment(id); }
    override async hasPublicationIntent(id: string) { this.presenceReads++; return super.hasPublicationIntent(id); }
    override async reservePublicationIntent(intent: PublicationIntent) {
      this.reserves++;
      if (this.failReserve) throw new Error("private reserve read failure");
      const result = await super.reservePublicationIntent(intent);
      if (this.loseReserveReply) { this.loseReserveReply = false; throw new Error("private committed reservation reply lost"); }
      return result;
    }
    override async completePublicationReceipt(receipt: PublicationReceipt) {
      this.completions++;
      const result = await super.completePublicationReceipt(receipt);
      if (this.loseCompleteReply) { this.loseCompleteReply = false; throw new Error("private committed receipt reply lost"); }
      return result;
    }
  }
  const vetting = new JournalStore(db);
  await vetting.createAssessment({ id: ID, projectId: project.id, revision: project.revision,
    manifestSha256: project.manifestSha256, contentSha256: "b".repeat(64),
    commitSha: "c".repeat(40), templateSha256: "d".repeat(64), requestedBy: owner,
    requestedAt: NOW.toISOString(), requestReason: "Private journal fixture",
  });
  const intent: PublicationIntent = { assessmentId: ID, resultSha256: "e".repeat(64), origin: ORIGIN, disposition: "incomplete" };
  async function post(payload: unknown, options: { raw?: Uint8Array; authenticated?: boolean; configured?: boolean } = {}) {
    const body = options.raw ?? new TextEncoder().encode(JSON.stringify(payload));
    const headers = options.authenticated === false ? {} : await signedVettingHeaders(
      keys.privateKey, keys.raw, "POST", PATH, body, NOW,
    );
    const response = await handleVettingApi(new Request(`${ORIGIN}${PATH}`, { method: "POST", headers, body }), {
      vetting, projects, resultPublicKeys: options.configured === false ? undefined : keys.publicKey,
      now: () => NOW, randomId: () => "unused",
      livePin: async () => { throw new Error("Journal must not fetch a live pin"); },
      session: async () => { throw new Error("Journal must not use browser sessions"); },
    });
    if (!response) throw new Error("Journal route not handled");
    return response;
  }
  const counts = () => ({ intents: (sqlite.query("SELECT COUNT(*) AS n FROM vetting_publication_intents").get() as { n: number }).n,
    receipts: (sqlite.query("SELECT COUNT(*) AS n FROM vetting_publication_receipts").get() as { n: number }).n });
  const reserve = () => post({ operation: "reserve", ...intent });
  const complete = (patch: Record<string, unknown> = {}) => post({ operation: "complete", ...intent, outcome: "unknown", httpStatus: null, ...patch });
  return { sqlite, vetting, intent, post, counts, reserve, complete, close: () => sqlite.close() };
}

test("has accepts a readiness identifier without reading an assessment", async () => {
  const f = await fixture();
  try {
    const response = await f.post({ operation: "has", assessmentId: "readiness.probe-1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: JOURNAL_SCHEMA, present: false });
    expect(f.vetting.assessmentReads).toBe(0);
    expect(f.vetting.presenceReads).toBe(1);
  } finally { f.close(); }
});

for (const [name, options, status] of [
  ["unsigned", { authenticated: false }, 401], ["unconfigured", { configured: false }, 503],
] as const) {
  test(`journal ${name} request cannot inspect or write tables`, async () => {
    const f = await fixture();
    try {
      expect((await f.post({ operation: "reserve", ...f.intent }, options)).status).toBe(status);
      expect(f.vetting.assessmentReads + f.vetting.presenceReads + f.vetting.reserves + f.vetting.completions).toBe(0);
      expect(f.counts()).toEqual({ intents: 0, receipts: 0 });
    } finally { f.close(); }
  });
}

for (const [name, payload, raw] of [
  ["invalid UTF-8", null, new Uint8Array([0xff])],
  ["invalid JSON", null, new TextEncoder().encode("{")],
  ["null", null, undefined], ["array", [], undefined],
  ["invalid id", { operation: "has", assessmentId: "bad/id" }, undefined],
  ["missing id", { operation: "has" }, undefined],
  ["extra has field", { operation: "has", assessmentId: ID, origin: ORIGIN }, undefined],
  ["unsupported operation", { operation: "erase", assessmentId: ID }, undefined],
] as const) {
  test(`journal refuses ${name} before persistence`, async () => {
    const f = await fixture();
    try {
      expect((await f.post(payload, raw ? { raw } : {})).status).toBe(400);
      expect(f.vetting.assessmentReads + f.vetting.presenceReads + f.vetting.reserves + f.vetting.completions).toBe(0);
      expect(f.counts()).toEqual({ intents: 0, receipts: 0 });
    } finally { f.close(); }
  });
}

for (const [name, patch] of [
  ["uppercase digest", { resultSha256: "E".repeat(64) }], ["short digest", { resultSha256: "e" }],
  ["empty origin", { origin: "" }], ["long origin", { origin: "x".repeat(201) }],
  ["unsupported disposition", { disposition: "pending" }], ["unknown field", { privateBody: "not accepted" }],
] as const) {
  test(`journal refuses ${name} before assessment lookup`, async () => {
    const f = await fixture();
    try {
      expect((await f.post({ operation: "reserve", ...f.intent, ...patch })).status).toBe(400);
      expect(f.vetting.assessmentReads).toBe(0);
      expect(f.counts()).toEqual({ intents: 0, receipts: 0 });
    } finally { f.close(); }
  });
}

test("missing assessment takes precedence over invalid receipt outcome", async () => {
  const f = await fixture();
  try {
    const response = await f.complete({ assessmentId: "readiness-probe", outcome: "invalid", httpStatus: 600 });
    expect(response.status).toBe(404);
    expect(f.vetting.completions).toBe(0);
  } finally { f.close(); }
});

test("reservation is immutable and has observes its durable presence", async () => {
  const f = await fixture();
  try {
    expect((await f.reserve()).status).toBe(200);
    const second = await f.post({ operation: "reserve", ...f.intent, resultSha256: "f".repeat(64) });
    expect(second.status).toBe(409);
    const reply = await f.post({ operation: "has", assessmentId: ID });
    expect(await reply.json()).toEqual({ schemaVersion: JOURNAL_SCHEMA, present: true });
    expect(f.counts()).toEqual({ intents: 1, receipts: 0 });
    expect(f.sqlite.query("SELECT result_sha256 FROM vetting_publication_intents").get()).toEqual({ result_sha256: f.intent.resultSha256 });
  } finally { f.close(); }
});

test("a completed assessment can retain a publication reservation", async () => {
  const f = await fixture();
  try {
    const result = { assessmentId: ID, disposition: "incomplete", assessed: { commitSha: "c".repeat(40), templateSha256: "d".repeat(64) } };
    f.sqlite.query("UPDATE vetting_assessments SET state='incomplete', policy_version='fixture', result=?, result_sha256=?, signing_key_sha256=?, completed_at=? WHERE id=?")
      .run(JSON.stringify(result), "f".repeat(64), "a".repeat(64), NOW.toISOString(), ID);
    expect((await f.reserve()).status).toBe(200);
  } finally { f.close(); }
});

test("receipt without a matching intent is refused without a write", async () => {
  const f = await fixture();
  try { expect((await f.complete()).status).toBe(422); expect(f.counts()).toEqual({ intents: 0, receipts: 0 }); }
  finally { f.close(); }
});

for (const [name, patch] of [
  ["digest", { resultSha256: "f".repeat(64) }], ["origin", { origin: "https://other.example" }],
  ["disposition", { disposition: "clean" }],
] as const) {
  test(`receipt must match reserved ${name} exactly`, async () => {
    const f = await fixture();
    try {
      await f.reserve();
      expect((await f.complete(patch)).status).toBe(422);
      expect(f.counts()).toEqual({ intents: 1, receipts: 0 });
    } finally { f.close(); }
  });
}

test("first receipt is immutable; later mismatch is not classified as a duplicate", async () => {
  const f = await fixture();
  try {
    await f.reserve();
    expect((await f.complete()).status).toBe(200);
    expect((await f.complete({ outcome: "accepted", httpStatus: 200 })).status).toBe(409);
    expect((await f.complete({ resultSha256: "f".repeat(64) })).status).toBe(422);
    expect(f.sqlite.query("SELECT outcome,http_status FROM vetting_publication_receipts").get()).toEqual({ outcome: "unknown", http_status: null });
  } finally { f.close(); }
});

for (const [outcome, httpStatus] of [["accepted", null], ["unknown", 100], ["rejected", 599]] as const) {
  test(`journal records reported ${outcome}/${String(httpStatus)} without claiming intake truth`, async () => {
    const f = await fixture();
    try {
      await f.reserve();
      expect((await f.complete({ outcome, httpStatus })).status).toBe(200);
      expect(f.sqlite.query("SELECT outcome,http_status FROM vetting_publication_receipts").get()).toEqual({ outcome, http_status: httpStatus });
    } finally { f.close(); }
  });
}

for (const [name, patch] of [
  ["unknown outcome", { outcome: "invalid" }], ["missing outcome", { outcome: undefined }],
  ["missing status", { httpStatus: undefined }], ["small status", { httpStatus: 99 }],
  ["large status", { httpStatus: 600 }], ["fractional status", { httpStatus: 200.5 }],
  ["string status", { httpStatus: "200" }],
] as const) {
  test(`journal refuses ${name} after finding the assessment`, async () => {
    const f = await fixture();
    try {
      await f.reserve();
      const reads = f.vetting.assessmentReads;
      expect((await f.complete(patch)).status).toBe(400);
      expect(f.vetting.assessmentReads).toBe(reads + 1);
      expect(f.vetting.completions).toBe(0);
      expect(f.counts()).toEqual({ intents: 1, receipts: 0 });
    } finally { f.close(); }
  });
}

test("failed reservation before commit leaves the next attempt available", async () => {
  const f = await fixture();
  try {
    f.vetting.failReserve = true;
    const response = await f.reserve();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error", message: "Internal error" });
    expect(f.counts()).toEqual({ intents: 0, receipts: 0 });
    f.vetting.failReserve = false;
    expect((await f.reserve()).status).toBe(200);
  } finally { f.close(); }
});

test("a lost reservation reply leaves a durable reservation and blocks retry", async () => {
  const f = await fixture();
  try {
    f.vetting.loseReserveReply = true;
    expect((await f.reserve()).status).toBe(500);
    expect(f.counts()).toEqual({ intents: 1, receipts: 0 });
    expect((await f.reserve()).status).toBe(409);
  } finally { f.close(); }
});

test("a lost receipt reply retains the first outcome and retry conflicts", async () => {
  const f = await fixture();
  try {
    await f.reserve(); f.vetting.loseCompleteReply = true;
    expect((await f.complete()).status).toBe(500);
    expect(f.counts()).toEqual({ intents: 1, receipts: 1 });
    expect((await f.complete()).status).toBe(409);
  } finally { f.close(); }
});

test("concurrent reservation and completion calls each have one winner", async () => {
  const f = await fixture();
  try {
    const reserves = await Promise.all([f.reserve(), f.reserve()]);
    expect(reserves.map((response) => response.status).sort()).toEqual([200, 409]);
    const completions = await Promise.all([f.complete(), f.complete()]);
    expect(completions.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(f.counts()).toEqual({ intents: 1, receipts: 1 });
  } finally { f.close(); }
});

test("database triggers preserve both journal records against updates and deletes", async () => {
  const f = await fixture();
  try {
    await f.reserve(); await f.complete();
    for (const table of ["vetting_publication_intents", "vetting_publication_receipts"]) {
      expect(() => f.sqlite.exec(`UPDATE ${table} SET created_at='changed'`)).toThrow();
      expect(() => f.sqlite.exec(`DELETE FROM ${table}`)).toThrow();
    }
    expect(f.counts()).toEqual({ intents: 1, receipts: 1 });
  } finally { f.close(); }
});
