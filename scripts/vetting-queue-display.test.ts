// The admin scan history names a superseded pending request "Superseded",
// never "Queued": only a project's newest request occupies its queue
// (pendingAssessments), and an older pending request will not be scanned.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import {
  CloudflareVettingPersistence,
  summarize,
} from "../backend/vetting/persistence";
import {
  type AssessmentSummary,
  assessmentHistoryStateText,
} from "../src/lib/vetting-contracts";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function summary(partial: Partial<AssessmentSummary>): AssessmentSummary {
  return {
    id: `vet_${"0".repeat(32)}`,
    revision: 1,
    state: "pending",
    commitSha: "a".repeat(40),
    templateSha256: "b".repeat(64),
    policyVersion: null,
    requestedAt: "2026-11-09T01:00:00.000Z",
    completedAt: null,
    modelRuns: [],
    artifacts: 0,
    heldArtifacts: 0,
    ...partial,
  };
}

describe("assessmentHistoryStateText", () => {
  test("the newest pending request is the one queued scan", () => {
    const queued = summary({ id: `vet_${"c".repeat(32)}` });
    expect(assessmentHistoryStateText([queued], queued)).toBe("Queued");
  });

  test("a pending request behind a newer request is superseded", () => {
    const newer = summary({ id: `vet_${"c".repeat(32)}` });
    const older = summary({ id: `vet_${"a".repeat(32)}` });
    expect(assessmentHistoryStateText([newer, older], older)).toBe(
      "Superseded",
    );
    expect(assessmentHistoryStateText([newer, older], newer)).toBe("Queued");
  });

  test("a pending request behind a completed scan is superseded", () => {
    const completed = summary({
      id: `vet_${"c".repeat(32)}`,
      state: "clean",
      completedAt: "2026-11-09T03:00:00.000Z",
    });
    const older = summary({ id: `vet_${"a".repeat(32)}` });
    expect(assessmentHistoryStateText([completed, older], older)).toBe(
      "Superseded",
    );
  });

  test("completed states keep their text", () => {
    const clean = summary({ state: "clean" });
    const incomplete = summary({ state: "incomplete" });
    const malicious = summary({ state: "malicious" });
    expect(assessmentHistoryStateText([clean], clean)).toBe("Clean");
    expect(assessmentHistoryStateText([incomplete], incomplete)).toBe(
      "Incomplete",
    );
    expect(assessmentHistoryStateText([malicious], malicious)).toBe(
      "Confirmed malicious",
    );
  });
});

describe("superseded pending scans in the recorded queue", () => {
  test("the service queue serves only the newest request while the history keeps the older one pending", async () => {
    const database = sqliteD1(
      readdirSync(new URL("../migrations", import.meta.url))
        .filter((name) => name.endsWith(".sql"))
        .sort(),
    );
    const { db, sqlite } = database;
    const vetting = new CloudflareVettingPersistence(db);
    const manifest = applicationManifest("queue-display", "example/fixture");
    const manifestText = JSON.stringify(manifest);
    const manifestSha256 = digest(manifestText);
    const t0 = "2026-11-09T00:00:00.000Z";
    sqlite
      .prepare(
        "INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
      )
      .run("queue-display", manifestText, manifestSha256, "Fixture", t0);
    sqlite
      .prepare(
        "INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'paused',1,?,?,?,?)",
      )
      .run("queue-display", manifestText, manifestSha256, t0, t0);
    const base = {
      projectId: "queue-display",
      revision: 1,
      manifestSha256,
      contentSha256: manifestSha256,
      templateSha256: "b".repeat(64),
      requestedBy: { githubId: "1", githubLogin: "admin" },
      requestReason: "Admission scan",
    };
    expect(
      await vetting.createAssessment({
        ...base,
        id: `vet_${"a".repeat(32)}`,
        commitSha: "a".repeat(40),
        requestedAt: "2026-11-09T01:00:00.000Z",
      }),
    ).toBe("created");
    // The repository head moved, so a fresh scan of the same revision is
    // queued; the first request stays in the permanent history.
    expect(
      await vetting.createAssessment({
        ...base,
        id: `vet_${"c".repeat(32)}`,
        commitSha: "c".repeat(40),
        requestedAt: "2026-11-09T02:00:00.000Z",
      }),
    ).toBe("created");

    const queue = await vetting.pendingAssessments();
    expect(queue.map((entry) => entry.id)).toEqual([`vet_${"c".repeat(32)}`]);

    const history = (await vetting.listAssessments()).map(summarize);
    expect(history.map((entry) => entry.id)).toEqual([
      `vet_${"c".repeat(32)}`,
      `vet_${"a".repeat(32)}`,
    ]);
    expect(assessmentHistoryStateText(history, history[0])).toBe("Queued");
    expect(assessmentHistoryStateText(history, history[1])).toBe("Superseded");
  });

  test("the queue head keeps the Queued label when requested_at is not monotonic with insertion", async () => {
    const database = sqliteD1(
      readdirSync(new URL("../migrations", import.meta.url))
        .filter((name) => name.endsWith(".sql"))
        .sort(),
    );
    const { db, sqlite } = database;
    const vetting = new CloudflareVettingPersistence(db);
    const manifest = applicationManifest("queue-display", "example/fixture");
    const manifestText = JSON.stringify(manifest);
    const manifestSha256 = digest(manifestText);
    const t0 = "2026-11-09T00:00:00.000Z";
    sqlite
      .prepare(
        "INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
      )
      .run("queue-display", manifestText, manifestSha256, "Fixture", t0);
    sqlite
      .prepare(
        "INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'paused',1,?,?,?,?)",
      )
      .run("queue-display", manifestText, manifestSha256, t0, t0);
    const base = {
      projectId: "queue-display",
      revision: 1,
      manifestSha256,
      contentSha256: manifestSha256,
      templateSha256: "b".repeat(64),
      requestedBy: { githubId: "1", githubLogin: "admin" },
      requestReason: "Admission scan",
    };
    // A is inserted first but carries the later requested_at: the clock
    // moved back between the two requests, so insertion order and
    // requested_at disagree. The queue serves by insertion order
    // (pendingAssessments picks MAX(rowid)), so B is the live scan even
    // though its requested_at is earlier.
    expect(
      await vetting.createAssessment({
        ...base,
        id: `vet_${"a".repeat(32)}`,
        commitSha: "a".repeat(40),
        requestedAt: "2026-11-09T02:00:00.000Z",
      }),
    ).toBe("created");
    expect(
      await vetting.createAssessment({
        ...base,
        id: `vet_${"c".repeat(32)}`,
        commitSha: "c".repeat(40),
        requestedAt: "2026-11-09T01:30:00.000Z",
      }),
    ).toBe("created");

    const queue = await vetting.pendingAssessments();
    expect(queue.map((entry) => entry.id)).toEqual([`vet_${"c".repeat(32)}`]);

    const history = (await vetting.listAssessments()).map(summarize);
    expect(history.map((entry) => entry.id)).toEqual([
      `vet_${"c".repeat(32)}`,
      `vet_${"a".repeat(32)}`,
    ]);
    expect(assessmentHistoryStateText(history, history[0])).toBe("Queued");
    expect(assessmentHistoryStateText(history, history[1])).toBe("Superseded");
  });
});
