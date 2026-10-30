// #1411 C-01: a pending row stuck on a stale pin must not block a live-pin queue.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { queueAutomaticScan } from "../backend/vetting/handler";
import {
  CloudflareVettingPersistence,
  composeStalePinIncomplete,
  pendingPinIsStale,
  SCANNER_CLAIM_LEASE_MS,
  STALE_PIN_POLICY_VERSION,
  stalePinGap,
  vettedContentSha256,
} from "../backend/vetting/persistence";
import { isScanResult } from "../backend/vetting/scan-result";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { vettingKeyPair } from "../tests/vetting-fixtures";

const AT = "2026-10-29T20:00:00.000Z";
const PROJECT = "stale-pin-fixture";
const REPO = "example/stale-pin-fixture";
const ADMIN = { githubId: "900000001", githubLogin: "fixture-admin" };
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function openProject() {
  const { db, sqlite } = sqliteD1();
  const projects = new CloudflareProjectPersistence(db);
  const vetting = new CloudflareVettingPersistence(db, async () => true);
  const manifest = applicationManifest(PROJECT, REPO) as unknown as Parameters<
    typeof vettedContentSha256
  >[0];
  const text = JSON.stringify(manifest);
  const sha = digest(text);
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(PROJECT, 1, text, sha, "Synthetic revision", AT);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)",
    )
    .run(PROJECT, text, sha, AT, AT);
  return { db, sqlite, projects, vetting, manifest, manifestSha256: sha };
}

describe("stale pin helpers", () => {
  test("pendingPinIsStale compares commit and template", () => {
    const pending = {
      commitSha: "a".repeat(40),
      templateSha256: "b".repeat(64),
    };
    expect(
      pendingPinIsStale(pending, {
        commitSha: "a".repeat(40),
        templateSha256: "b".repeat(64),
      }),
    ).toBe(false);
    expect(
      pendingPinIsStale(pending, {
        commitSha: "c".repeat(40),
        templateSha256: "b".repeat(64),
      }),
    ).toBe(true);
    expect(
      pendingPinIsStale(pending, {
        commitSha: "a".repeat(40),
        templateSha256: "d".repeat(64),
      }),
    ).toBe(true);
  });

  test("composeStalePinIncomplete is a parseable incomplete v2 result", () => {
    const assessment = {
      id: `vet_${"a".repeat(32)}`,
      projectId: PROJECT,
      revision: 1,
      manifestSha256: "e".repeat(64),
      contentSha256: "f".repeat(64),
      commitSha: "a".repeat(40),
      templateSha256: "b".repeat(64),
      requestedBy: ADMIN,
      requestedAt: AT,
      requestReason: "Synthetic",
      state: "pending" as const,
      policyVersion: null,
      result: null,
      resultSha256: null,
      signingKeySha256: null,
      completedAt: null,
    };
    const gap = stalePinGap(assessment, {
      commitSha: "c".repeat(40),
      templateSha256: "d".repeat(64),
    });
    const result = composeStalePinIncomplete({
      assessment,
      gap,
      at: AT,
    });
    expect(isScanResult(result)).toBe(true);
    expect(result.disposition).toBe("incomplete");
    expect(result.policyVersion).toBe(STALE_PIN_POLICY_VERSION);
    expect(result.visibilityGaps).toEqual([gap]);
    expect(result.primaryReview.status).toBe("not-started");
  });
});

describe("#1411 C-01 stale pending recovery", () => {
  test("queueAutomaticScan terminalizes a stale pending row and queues the live pin", async () => {
    const { projects, vetting, manifest, manifestSha256 } = openProject();
    const keys = await vettingKeyPair();
    const stalePin = {
      commitSha: "a".repeat(40),
      templateSha256: "b".repeat(64),
    };
    const livePin = {
      commitSha: "c".repeat(40),
      templateSha256: "d".repeat(64),
    };
    const staleId = `vet_${"1".repeat(32)}`;
    expect(
      await vetting.createAssessment({
        id: staleId,
        projectId: PROJECT,
        revision: 1,
        manifestSha256,
        contentSha256: await vettedContentSha256(manifest),
        commitSha: stalePin.commitSha,
        templateSha256: stalePin.templateSha256,
        requestedBy: ADMIN,
        requestedAt: AT,
        requestReason: "Stuck on a stale pin",
      }),
    ).toBe("created");

    const project = await projects.getProject(PROJECT);
    if (!project) throw new Error("Missing fixture project");
    let ids = 0;
    const status = await queueAutomaticScan(
      {
        vetting,
        livePin: async () => livePin,
        now: () => new Date(AT),
        randomId: () =>
          `0000000000004000a000${String(++ids).padStart(12, "0")}`,
        resultPublicKeys: keys.publicKey,
      },
      project,
      "Recover from a stale queued pin",
    );
    expect(status).toBe("queued");

    const superseded = await vetting.getAssessment(staleId);
    expect(superseded?.state).toBe("incomplete");
    expect(superseded?.policyVersion).toBe(STALE_PIN_POLICY_VERSION);
    expect(superseded?.result && isScanResult(superseded.result)).toBe(true);
    if (superseded?.result && isScanResult(superseded.result)) {
      expect(superseded.result.visibilityGaps[0]).toContain("stale");
      expect(superseded.result.visibilityGaps[0]).toContain(
        livePin.commitSha.slice(0, 7),
      );
    }

    const pending = await vetting.currentPending(PROJECT);
    expect(pending).not.toBeNull();
    expect(pending?.id).not.toBe(staleId);
    expect(pending?.commitSha).toBe(livePin.commitSha);
    expect(pending?.templateSha256).toBe(livePin.templateSha256);
  });

  test("queueAutomaticScan still conflicts when the pending pin matches", async () => {
    const { projects, vetting, manifest, manifestSha256 } = openProject();
    const keys = await vettingKeyPair();
    const pin = {
      commitSha: "a".repeat(40),
      templateSha256: "b".repeat(64),
    };
    expect(
      await vetting.createAssessment({
        id: `vet_${"2".repeat(32)}`,
        projectId: PROJECT,
        revision: 1,
        manifestSha256,
        contentSha256: await vettedContentSha256(manifest),
        commitSha: pin.commitSha,
        templateSha256: pin.templateSha256,
        requestedBy: ADMIN,
        requestedAt: AT,
        requestReason: "Already queued at the live pin",
      }),
    ).toBe("created");
    const project = await projects.getProject(PROJECT);
    if (!project) throw new Error("Missing fixture project");
    let ids = 0;
    expect(
      await queueAutomaticScan(
        {
          vetting,
          livePin: async () => pin,
          now: () => new Date(AT),
          randomId: () =>
            `0000000000004000b000${String(++ids).padStart(12, "0")}`,
          resultPublicKeys: keys.publicKey,
        },
        project,
        "Duplicate live pin",
      ),
    ).toBe("already_queued");
    expect((await vetting.currentPending(PROJECT))?.state).toBe("pending");
    expect(await vetting.listAssessments()).toHaveLength(1);
  });

  test("queueAutomaticScan recovers an expired scanner claim on a stale pin", async () => {
    const { projects, vetting, manifest, manifestSha256 } = openProject();
    const keys = await vettingKeyPair();
    const stalePin = {
      commitSha: "a".repeat(40),
      templateSha256: "b".repeat(64),
    };
    const livePin = {
      commitSha: "c".repeat(40),
      templateSha256: "d".repeat(64),
    };
    const staleId = `vet_${"3".repeat(32)}`;
    expect(
      await vetting.createAssessment({
        id: staleId,
        projectId: PROJECT,
        revision: 1,
        manifestSha256,
        contentSha256: await vettedContentSha256(manifest),
        commitSha: stalePin.commitSha,
        templateSha256: stalePin.templateSha256,
        requestedBy: ADMIN,
        requestedAt: AT,
        requestReason: "Claimed then abandoned",
      }),
    ).toBe("created");
    // Claim at AT, then queue after the lease expires so C-01 still recovers.
    await vetting.claimPendingAssessments(AT);
    const afterLease = new Date(
      Date.parse(AT) + SCANNER_CLAIM_LEASE_MS + 1,
    ).toISOString();
    const project = await projects.getProject(PROJECT);
    if (!project) throw new Error("Missing fixture project");
    let ids = 0;
    expect(
      await queueAutomaticScan(
        {
          vetting,
          livePin: async () => livePin,
          now: () => new Date(afterLease),
          randomId: () =>
            `0000000000004000c000${String(++ids).padStart(12, "0")}`,
          resultPublicKeys: keys.publicKey,
        },
        project,
        "Recover after an expired scanner claim",
      ),
    ).toBe("queued");
    expect((await vetting.getAssessment(staleId))?.state).toBe("incomplete");
    expect((await vetting.currentPending(PROJECT))?.commitSha).toBe(
      livePin.commitSha,
    );
  });

  test("queueAutomaticScan defers terminalization while a scanner claim is active", async () => {
    const { projects, vetting, manifest, manifestSha256 } = openProject();
    const keys = await vettingKeyPair();
    const stalePin = {
      commitSha: "a".repeat(40),
      templateSha256: "b".repeat(64),
    };
    const livePin = {
      commitSha: "c".repeat(40),
      templateSha256: "d".repeat(64),
    };
    const staleId = `vet_${"4".repeat(32)}`;
    expect(
      await vetting.createAssessment({
        id: staleId,
        projectId: PROJECT,
        revision: 1,
        manifestSha256,
        contentSha256: await vettedContentSha256(manifest),
        commitSha: stalePin.commitSha,
        templateSha256: stalePin.templateSha256,
        requestedBy: ADMIN,
        requestedAt: AT,
        requestReason: "Claimed and still in flight",
      }),
    ).toBe("created");
    await vetting.claimPendingAssessments(AT);
    const project = await projects.getProject(PROJECT);
    if (!project) throw new Error("Missing fixture project");
    let ids = 0;
    expect(
      await queueAutomaticScan(
        {
          vetting,
          livePin: async () => livePin,
          now: () => new Date(AT),
          randomId: () =>
            `0000000000004000d000${String(++ids).padStart(12, "0")}`,
          resultPublicKeys: keys.publicKey,
        },
        project,
        "Queue live pin beside an in-flight claim",
      ),
    ).toBe("queued");
    expect((await vetting.getAssessment(staleId))?.state).toBe("pending");
    const pending = await vetting.currentPending(PROJECT);
    expect(pending?.id).not.toBe(staleId);
    expect(pending?.commitSha).toBe(livePin.commitSha);
  });
});
