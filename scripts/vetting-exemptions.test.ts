// Audited admission exemptions against actual D1 schemas and API gates.
// GitHub answers and scan results are synthetic control evidence, not live scans.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { publicRestrictionOf } from "../backend/projects/enforcement";
import type { RepositoryAccessReader } from "../backend/projects/setup";
import { ProjectFlagStore } from "../backend/vetting/flags";
import { handleVettingApi } from "../backend/vetting/handler";
import {
  CloudflareVettingPersistence,
  vettedContentSha256,
} from "../backend/vetting/persistence";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import type { AdmissionExemption } from "../src/lib/vetting-contracts";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  signedVettingHeaders,
  vettingKeyPair,
  vettingResult,
} from "../tests/vetting-fixtures";

const ORIGIN = "https://slop.test";
const AT = "2026-10-27T16:00:00.000Z";
const ADMIN = { githubId: "12345678", githubLogin: "owner" };
const PROJECT = "owner-admission";
const REPO = "example/owner-admission";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function fixture() {
  const { db, sqlite } = sqliteD1();
  const projects = new CloudflareProjectPersistence(db);
  const vetting = new CloudflareVettingPersistence(db, async () => false);
  let manifest = applicationManifest(
    PROJECT,
    REPO,
  ) as unknown as ProjectDefinition;
  let revision = 0,
    ids = 0;
  function publish(next = manifest) {
    manifest = next;
    revision++;
    const text = JSON.stringify(manifest),
      sha = digest(text);
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(PROJECT, revision, text, sha, "Synthetic revision", AT);
    if (revision === 1)
      sqlite
        .query(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)",
        )
        .run(PROJECT, text, sha, AT, AT);
    else
      sqlite
        .query(
          "UPDATE projects SET revision=?,manifest=?,manifest_sha256=? WHERE id=?",
        )
        .run(revision, text, sha, PROJECT);
  }
  publish();
  let administrator = ADMIN;
  let permission: "admin" | "read" = "admin",
    wrongIdentity = false,
    unavailable = false;
  let beforeAccess: (() => void) | null = null;
  const repositoryAccess: RepositoryAccessReader = async () => {
    beforeAccess?.();
    beforeAccess = null;
    if (unavailable) throw new Error("Synthetic GitHub outage");
    return {
      installation: "installed",
      installationId: 1,
      permission,
      roleName: null,
      repository: {
        id: wrongIdentity ? 999999 : Number(manifest.authority.repositoryId),
        node_id: manifest.authority.repositoryNodeId,
        full_name: manifest.repositories[0].id,
        private: false,
        owner: {
          id: Number(manifest.steward.github.actorId),
          node_id: manifest.steward.github.nodeId,
          login: manifest.steward.github.login,
          type: manifest.steward.github.type,
        },
      },
    };
  };
  const readPin = async () => ({
    commitSha: "a".repeat(40),
    templateSha256: "b".repeat(64),
  });
  const call = async (
    path: string,
    body?: unknown,
    admin = true,
    origin = ORIGIN,
    contentType = "application/json",
  ) => {
    const reply = await handleVettingApi(
      new Request(`${ORIGIN}/api/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined ? {} : { origin, "content-type": contentType },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      {
        vetting,
        projects,
        resultPublicKeys: undefined,
        repositoryAccess,
        livePin: readPin,
        session: async () => ({ ...administrator, admin }),
        now: () => new Date(AT),
        randomId: () => `exemption${String(++ids).padStart(12, "0")}`,
      },
    );
    if (!reply) throw new Error("Missing route response");
    return {
      status: reply.status,
      body: (await reply.json()) as {
        exemption: AdmissionExemption;
        exemptions: AdmissionExemption[];
        error?: string;
      },
    };
  };
  const grant = (extra: Record<string, unknown> = {}) =>
    call("admin/vetting/exemptions", {
      projectId: PROJECT,
      revision,
      reason: "Reviewed explicit owner decision.",
      decisionReference: "private-owner-decision-2026-10-27",
      confirmation: true,
      ...extra,
    });
  const clearance = (fresh = false) =>
    vetting.manifestClearance(PROJECT, manifest, revision, readPin, fresh);
  const queue = async () => {
    const id = `vet_test_${String(++ids).padStart(12, "0")}`;
    const assessment = {
      id,
      projectId: PROJECT,
      revision,
      manifestSha256: digest(JSON.stringify(manifest)),
      contentSha256: await vettedContentSha256(manifest),
      commitSha: String(ids % 10).repeat(40),
      templateSha256: "b".repeat(64),
      requestedBy: ADMIN,
      requestedAt: AT,
      requestReason: "Synthetic investigation",
    };
    expect(await vetting.createAssessment(assessment)).toBe("created");
    return assessment;
  };
  const finish = async (
    assessment: Awaited<ReturnType<typeof queue>>,
    state: "incomplete" | "malicious",
  ) => {
    const result = vettingResult(
      {
        assessmentId: assessment.id,
        projectId: PROJECT,
        revision,
        manifestSha256: assessment.manifestSha256,
        commitSha: assessment.commitSha,
        templateSha256: assessment.templateSha256,
        repository: REPO,
      },
      state,
    );
    sqlite
      .query(
        "UPDATE vetting_assessments SET state=?,policy_version='fixture',result=?,result_sha256=?,signing_key_sha256=?,completed_at=? WHERE id=?",
      )
      .run(
        state,
        JSON.stringify(result),
        digest(JSON.stringify(result)),
        "c".repeat(64),
        AT,
        assessment.id,
      );
  };
  // One signed refresh after a release changed the skill template digest.
  const refresh = async (templateSha256: string, id: string) => {
    const keys = await vettingKeyPair();
    const reply = await handleVettingApi(
      new Request(`${ORIGIN}/api/v1/vetting/refresh`, {
        method: "POST",
        headers: await signedVettingHeaders(
          keys.privateKey,
          keys.raw,
          "POST",
          "/api/v1/vetting/refresh",
          "{}",
          new Date(AT),
        ),
        body: "{}",
      }),
      {
        vetting,
        projects,
        resultPublicKeys: keys.publicKey,
        livePin: async () => ({ commitSha: "f".repeat(40), templateSha256 }),
        session: async () => null,
        now: () => new Date(AT),
        randomId: () => id,
      },
    );
    if (!reply) throw new Error("Missing refresh response");
    expect(reply.status).toBe(200);
    const { queued } = (await reply.json()) as { queued: string[] };
    expect(queued).toHaveLength(1);
    const replacement = await vetting.getAssessment(queued[0]);
    if (!replacement) throw new Error("Missing replacement scan");
    return replacement;
  };
  return {
    db,
    sqlite,
    vetting,
    projects,
    call,
    grant,
    clearance,
    queue,
    finish,
    refresh,
    publish,
    manifest: () => manifest,
    setPermission: (value: "admin" | "read") => (permission = value),
    setAdministrator: (actor: typeof ADMIN) => (administrator = actor),
    setWrongIdentity: () => (wrongIdentity = true),
    setUnavailable: () => (unavailable = true),
    beforeAccess: (action: () => void) => (beforeAccess = action),
    beforeGrant: (action: () => Promise<void>) => {
      const grant = vetting.grantAdmissionExemption.bind(vetting);
      vetting.grantAdmissionExemption = async (input) => {
        await action();
        return grant(input);
      };
    },
    flag: async (index: number) => {
      const project = await projects.getProject(PROJECT);
      if (!project) throw new Error("Missing fixture project");
      return new ProjectFlagStore(db).file({
        flagId: `flg_fixture_${index}`,
        pauseRecordId: `enf_flag_fixture_${index}`,
        project,
        repositoryGithubId: manifest.authority.repositoryId,
        repositoryKeys: [REPO],
        reporter: {
          githubId: String(8000000 + index),
          githubLogin: `flagger-${index}`,
        },
        category: "other",
        evidence: "Synthetic evidence of risky install behavior.",
        evidenceUrl: null,
        moderatorGithubIds: [ADMIN.githubId],
        at: AT,
      });
    },
  };
}

describe("owner-approved admission exemptions", () => {
  test("binds an explicit admin grant to the registered repository without inventing a scan", async () => {
    const f = fixture();
    const queued = await f.queue();
    const granted = await f.grant();
    expect(granted.status).toBe(201);
    expect(granted.body.exemption).toMatchObject({
      projectId: PROJECT,
      revision: 1,
      repositoryId: "123456789",
      repositoryNodeId: "R_example",
      grantedBy: ADMIN,
      reason: "Reviewed explicit owner decision.",
      decisionReference: "private-owner-decision-2026-10-27",
      revokedAt: null,
    });
    expect(await f.clearance()).toMatchObject({
      state: "cleared",
      assessment: null,
      exemption: {
        kind: "owner-approved-admission",
        id: granted.body.exemption.id,
      },
    });
    const publicState = JSON.stringify(await f.clearance());
    expect(publicState).not.toContain("private-owner-decision");
    expect(publicState).not.toContain("Reviewed explicit owner");
    expect((await f.vetting.getAssessment(queued.id))?.state).toBe("pending");
    expect((await f.grant()).status).toBe(200);
    expect(await f.vetting.listAdmissionExemptions()).toHaveLength(1);
    expect(await f.clearance(true)).toMatchObject({ state: "stale" });
    expect(
      f.sqlite.query("SELECT * FROM vetting_grandfathered_projects").all(),
    ).toHaveLength(0);
  });
  test("rejects an unconfirmed, unprivileged, stale or mismatched grant", async () => {
    const f = fixture();
    expect((await f.grant({ confirmation: false })).status).toBe(400);
    expect((await f.call("admin/vetting/exemptions", {}, false)).status).toBe(
      403,
    );
    expect(
      (
        await f.call(
          "admin/vetting/exemptions",
          {},
          true,
          "https://attacker.example",
        )
      ).status,
    ).toBe(403);
    expect((await f.grant({ revision: 99 })).status).toBe(409);
    expect((await f.grant({ repositoryId: "99999" })).status).toBe(400);
    f.setPermission("read");
    expect((await f.grant()).status).toBe(403);
    f.setPermission("admin");
    f.setWrongIdentity();
    expect((await f.grant()).status).toBe(409);
    expect(await f.vetting.listAdmissionExemptions()).toHaveLength(0);
  });
  test("keeps outage and a concurrently changed revision closed", async () => {
    const f = fixture();
    f.setUnavailable();
    expect((await f.grant()).status).toBe(503);
    const changed = fixture();
    changed.beforeAccess(() => changed.publish());
    expect((await changed.grant()).status).toBe(409);
    expect(await changed.vetting.listAdmissionExemptions()).toHaveLength(0);
  });
  test("retains admission across routine revisions but a different identity cannot inherit it", async () => {
    const f = fixture();
    expect((await f.grant()).status).toBe(201);
    f.publish({
      ...f.manifest(),
      description: "An ordinary documentation update.",
    });
    expect(await f.clearance()).toMatchObject({
      state: "cleared",
      assessment: null,
    });
    f.publish({
      ...f.manifest(),
      authority: {
        ...f.manifest().authority,
        repositoryId: "98765",
        repositoryNodeId: "R_another",
      },
    });
    expect(await f.clearance()).toEqual({ state: "unscanned" });
  });
  test("the same repository cannot retain the owner exemption after a steward transfer", async () => {
    const f = fixture();
    const original = await f.grant();
    expect(original.status).toBe(201);
    const previous = f.manifest();
    f.publish({
      ...previous,
      steward: {
        ...previous.steward,
        github: {
          ...previous.steward.github,
          actorId: "99999",
          nodeId: "O_new_owner",
          login: "new-owner",
        },
      },
    });
    expect(await f.clearance()).toEqual({ state: "unscanned" });
    const newOwner = { githubId: "99999", githubLogin: "new-owner" };
    f.setAdministrator(newOwner);
    const newlyApproved = await f.grant({
      reason: "The new owner separately approved this admission waiver.",
      decisionReference: "new-owner-decision",
    });
    expect(newlyApproved.status).toBe(201);
    expect(newlyApproved.body.exemption.id).not.toBe(
      original.body.exemption.id,
    );
    expect(newlyApproved.body.exemption).toMatchObject({
      stewardId: "99999",
      stewardNodeId: "O_new_owner",
      grantedBy: newOwner,
    });
    const history = await f.vetting.listAdmissionExemptions();
    expect(history).toHaveLength(2);
    expect(
      history.find((entry) => entry.id === original.body.exemption.id),
    ).toEqual(original.body.exemption);
    expect(await f.clearance()).toMatchObject({
      state: "cleared",
      exemption: { id: newlyApproved.body.exemption.id },
    });
  });

  test("any later investigation controls clearance even with the same timestamp", async () => {
    const f = fixture();
    const original = await f.queue();
    await f.finish(original, "incomplete");
    expect((await f.grant()).status).toBe(201);
    expect(await f.clearance()).toMatchObject({
      state: "cleared",
      assessment: null,
    });
    const later = await f.queue();
    expect(later.requestedAt).toBe(original.requestedAt);
    expect(await f.clearance()).toMatchObject({
      state: "queued",
      assessment: { id: later.id },
    });
    await f.finish(later, "incomplete");
    expect(await f.clearance()).toMatchObject({
      state: "quarantined",
      assessment: { id: later.id },
    });
    expect((await f.grant()).status).toBe(200);
    expect(await f.clearance()).toMatchObject({ state: "quarantined" });
  });
  test("a template release recovers a covered pending scan without removing the exemption", async () => {
    const f = fixture();
    const queued = await f.queue();
    const granted = await f.grant();
    expect(granted.status).toBe(201);
    const refresh = async (templateSha256: string, id: string) => {
      const replacement = await f.refresh(templateSha256, id);
      expect(replacement).toMatchObject({
        state: "pending",
        revision: queued.revision,
        manifestSha256: queued.manifestSha256,
        commitSha: queued.commitSha,
        templateSha256,
      });
      expect(await f.clearance()).toMatchObject({
        state: "cleared",
        assessment: null,
        exemption: { id: granted.body.exemption.id },
      });
      return replacement;
    };
    await refresh("e".repeat(64), "0123456789abcdef0123456789abcdef");
    const latest = await refresh(
      "d".repeat(64),
      "fedcba9876543210fedcba9876543210",
    );
    expect((await f.vetting.getAssessment(queued.id))?.state).toBe("pending");
    await f.finish(latest, "malicious");
    expect(await f.clearance()).toMatchObject({ state: "banned" });
  });
  test("an incomplete covered retry stays exempt, but a later investigation's retry controls clearance", async () => {
    const f = fixture();
    await f.queue();
    const granted = await f.grant();
    expect(granted.status).toBe(201);
    const retry = await f.refresh(
      "e".repeat(64),
      "0123456789abcdef0123456789abcdef",
    );
    await f.finish(retry, "incomplete");
    expect(await f.clearance()).toMatchObject({
      state: "cleared",
      assessment: null,
      exemption: { id: granted.body.exemption.id },
    });
    const later = await f.queue();
    const recovered = await f.refresh(
      "d".repeat(64),
      "fedcba9876543210fedcba9876543210",
    );
    expect(recovered).toMatchObject({
      state: "pending",
      commitSha: later.commitSha,
      templateSha256: "d".repeat(64),
    });
    expect(await f.clearance()).toMatchObject({
      state: "queued",
      assessment: { id: recovered.id },
    });
    await f.finish(recovered, "incomplete");
    expect(await f.clearance()).toMatchObject({
      state: "quarantined",
      assessment: { id: recovered.id },
    });
  });
  test("an unreviewed malicious result blocks both an existing grant and a new one", async () => {
    const f = fixture();
    const queued = await f.queue();
    expect((await f.grant()).status).toBe(201);
    await f.finish(queued, "malicious");
    expect(await f.clearance()).toMatchObject({ state: "banned" });
    expect((await f.grant()).status).toBe(409);
  });
  test("a malicious result arriving at the grant write cannot be waived", async () => {
    const f = fixture();
    const assessment = await f.queue();
    f.beforeGrant(() => f.finish(assessment, "malicious"));
    expect((await f.grant()).status).toBe(409);
    expect(await f.vetting.listAdmissionExemptions()).toHaveLength(0);
    expect(await f.clearance()).toMatchObject({ state: "banned" });
  });
  test("two active contributor flags still restrict an exempt project and require a fresh scan", async () => {
    const f = fixture();
    expect((await f.grant()).status).toBe(201);
    await f.flag(1);
    await f.flag(2);
    const project = await f.projects.getProject(PROJECT);
    if (!project) throw new Error("Missing fixture project");
    expect(
      publicRestrictionOf(project, await f.projects.listEnforcements()).state,
    ).toBe("quarantined");
    expect((await f.grant()).status).toBe(409);
    expect((await f.clearance(true)).state).not.toBe("cleared");
    expect(
      await new ProjectFlagStore(f.db).activeFlags(new Date(AT)),
    ).toHaveLength(2);
  });

  test("revocation restores normal clearance and keeps the grant and audit history immutable", async () => {
    const f = fixture();
    const queued = await f.queue();
    const granted = await f.grant();
    const id = granted.body.exemption.id;
    const revocation = {
      reason: "The owner revoked the admission waiver.",
      decisionReference: "owner-revocation-1",
      confirmation: true,
    };
    const misplaced = await f.call(
      `vetting/not-admin/exemptions/${id}/revoke`,
      revocation,
      true,
      "https://attacker.example",
      "text/plain",
    );
    expect(misplaced.status).toBe(404);
    expect((await f.vetting.admissionExemption(id))?.revokedAt).toBe(null);
    expect(
      (
        await f.call(
          `admin/vetting/exemptions/${id}/revoke`,
          revocation,
          true,
          "https://attacker.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.call(
          `admin/vetting/exemptions/${id}/revoke`,
          revocation,
          true,
          ORIGIN,
          "text/plain",
        )
      ).status,
    ).toBe(403);
    expect((await f.vetting.admissionExemption(id))?.revokedAt).toBe(null);
    const revoked = await f.call(
      `admin/vetting/exemptions/${id}/revoke`,
      revocation,
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.exemption).toMatchObject({
      id,
      revokedAt: AT,
      revokedBy: ADMIN,
      revocationDecisionReference: "owner-revocation-1",
    });
    expect(await f.clearance()).toMatchObject({
      state: "queued",
      assessment: { id: queued.id },
    });
    expect(() =>
      f.sqlite.exec("DELETE FROM vetting_admission_exemptions"),
    ).toThrow("permanent");
    expect(() =>
      f.sqlite.exec(
        "UPDATE vetting_admission_exemption_revocations SET reason='edited'",
      ),
    ).toThrow("immutable");
    expect((await f.call("admin/vetting")).body.exemptions).toHaveLength(1);
  });
});

test("an explicit investigation cannot inherit exemption from its reason text", async () => {
  const f = fixture();
  const queued = await f.queue();
  expect((await f.grant()).status).toBe(201);
  const keys = await vettingKeyPair();
  const response = await handleVettingApi(
    new Request(`${ORIGIN}/api/v1/admin/vetting/assessments`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT,
        revision: queued.revision,
        reason: "Automatic replacement of an unavailable queued template",
      }),
    }),
    {
      vetting: f.vetting,
      projects: f.projects,
      resultPublicKeys: keys.publicKey,
      livePin: async () => ({
        commitSha: queued.commitSha,
        templateSha256: "e".repeat(64),
      }),
      session: async () => ({ ...ADMIN, admin: true }),
      now: () => new Date(AT),
      randomId: () => "0123456789abcdef0123456789abcdef",
    },
  );
  expect(response?.status).toBe(201);
  expect(await f.clearance()).toMatchObject({ state: "queued" });
});

test("a result write cannot change the automatic retry predecessor", async () => {
  const f = fixture();
  await f.queue();
  await f.grant();
  const retry = await f.refresh(
    "e".repeat(64),
    "0123456789abcdef0123456789abcdef",
  );
  expect(() =>
    f.sqlite
      .query(
        "UPDATE vetting_assessments SET state = 'incomplete', replaces_assessment_id = NULL WHERE id = ?",
      )
      .run(retry.id),
  ).toThrow("vetting replacement provenance is immutable");
  await f.finish(retry, "incomplete");
  expect(await f.clearance()).toMatchObject({ state: "cleared" });
});
