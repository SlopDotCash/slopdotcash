// Community security vetting (PRD VET-01 to VET-08) on the real migrations:
// the signed service contract, the clean, incomplete and malicious
// dispositions from harmless fixtures, the activation and skill gates, and
// the fail-closed state when no vetting service is configured.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { handleProjectApi } from "../backend/projects/handler";
import { EVIDENCE_CHUNK_BYTES } from "../backend/vetting/evidence-chunks";
import {
  handleVettingApi,
  signedVettingRequest,
} from "../backend/vetting/handler";
import {
  CloudflareVettingPersistence,
  type VettingPin,
} from "../backend/vetting/persistence";
import { parseVettingResult } from "../backend/vetting/result";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { localVettingEvidence } from "../tests/vetting-evidence-fixture";
import {
  signedVettingHeaders,
  VETTING_EVIDENCE_OBJECTS,
  VETTING_TRACE_BODY,
  vettingKeyPair,
  vettingResult,
} from "../tests/vetting-fixtures";

let retained: Awaited<ReturnType<typeof localVettingEvidence>>;
afterEach(async () => {
  await retained?.dispose();
});

const ORIGIN = "https://slop.cash";
const ADMIN = { githubId: "900000001", githubLogin: "e2e-admin" };
const APPLICANT = { githubId: "900000002", githubLogin: "e2e-applicant" };
const NOW = new Date("2026-10-18T12:00:00.000Z");

let sqlite: ReturnType<typeof sqliteD1>["sqlite"];
let projects: CloudflareProjectPersistence;
let vetting: CloudflareVettingPersistence;
let keys: Awaited<ReturnType<typeof vettingKeyPair>>;
let configuredKeys: string | undefined;
/** The live integration-branch head and template digest; null is unreadable. */
let livePin: VettingPin | null;
const HEAD = "a".repeat(40);
const TEMPLATE = "b".repeat(64);

async function readLivePin(): Promise<VettingPin> {
  if (livePin === null) throw new Error("GitHub returned 502.");
  return livePin;
}
let ids = 0;

beforeEach(async () => {
  const database = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const { db } = database;
  sqlite = database.sqlite;
  projects = new CloudflareProjectPersistence(db);
  retained = await localVettingEvidence(db, () => NOW);
  vetting = new CloudflareVettingPersistence(
    db,
    async (a) => a.result !== null && retained.evidence.complete(a.result),
  );
  keys = await vettingKeyPair();
  configuredKeys = keys.publicKey;
  livePin = { commitSha: HEAD, templateSha256: TEMPLATE };
});

const actorOf = (request: Request) =>
  request.headers.get("x-test-actor") === "admin"
    ? ADMIN
    : request.headers.get("x-test-actor") === "applicant"
      ? APPLICANT
      : null;

function projectApi(request: Request) {
  return handleProjectApi(request, {
    persistence: projects,
    adminGithubIds: new Set([ADMIN.githubId]),
    moderatorGithubIds: new Set(),
    now: () => NOW,
    randomId: () =>
      `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    sessionActor: async (value) => actorOf(value),
    notifyAdmins: async () => true,
    repositoryControl: async () => ({ state: "proven", reason: "fixture" }),
    readTokenMetadata: async () => {
      throw new Error("no token reads in this suite");
    },
    github: { fetch: async () => new Response(null, { status: 404 }) },
    vettingClearance: (projectId, manifest, through) =>
      vetting.manifestClearance(projectId, manifest, through, readLivePin),
  }) as Promise<Response>;
}

function vettingApi(request: Request) {
  return handleVettingApi(request, {
    evidence: retained.evidence,
    vetting,
    projects,
    resultPublicKeys: configuredKeys,
    operatorGithubIds: [ADMIN.githubId, "900000004", ADMIN.githubId],
    livePin: readLivePin,
    session: async (value) => {
      const actor = actorOf(value);
      return actor && { ...actor, admin: actor === ADMIN };
    },
    now: () => NOW,
    randomId: () => `0000000000004000a000${String(++ids).padStart(12, "0")}`,
  }) as Promise<Response>;
}

function sessionRequest(
  method: string,
  path: string,
  actor: "admin" | "applicant",
  body?: unknown,
) {
  return new Request(`${ORIGIN}/api/v1/${path}`, {
    method,
    headers: {
      "x-test-actor": actor,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", origin: ORIGIN }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signed(method: string, path: string, body = "", at = NOW) {
  return new Request(`${ORIGIN}/api/v1/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(await signedVettingHeaders(
        keys.privateKey,
        keys.raw,
        method,
        `/api/v1/${path}`,
        body,
        at,
      )),
    },
    body: method === "GET" ? undefined : body,
  });
}

async function listPausedProject() {
  const submitted = await projectApi(
    sessionRequest("POST", "project-applications", "applicant", {
      manifest: applicationManifest("open-registry", "example/open-registry"),
    }),
  );
  expect(submitted.status).toBe(201);
  const { application } = await submitted.json();
  expect(
    (
      await projectApi(
        sessionRequest(
          "POST",
          `admin/project-applications/${application.id}/approve`,
          "admin",
          {},
        ),
      )
    ).status,
  ).toBe(200);
}

async function queueScan(): Promise<string> {
  const queued = await vettingApi(
    sessionRequest("POST", "admin/vetting/assessments", "admin", {
      projectId: "open-registry",
      revision: 1,
      reason: "Admission scan",
    }),
  );
  expect(queued.status).toBe(201);
  return (await queued.json()).assessment.id;
}

async function postResult(body: unknown, at = NOW) {
  const text = JSON.stringify(body);
  return vettingApi(await signed("POST", "vetting/results", text, at));
}

async function fixture(
  assessmentId: string,
  disposition: "clean" | "incomplete" | "malicious",
  retain = true,
) {
  const project = await projects.getProject("open-registry");
  if (project === null) throw new Error("project was not listed");
  // The service scans exactly the commits the queue assigned.
  const assessment = await vetting.getAssessment(assessmentId);
  if (assessment === null) throw new Error("assessment was not queued");
  if (retain) await retained.retain(assessmentId, `vm-run-${project.revision}`);
  return vettingResult(
    {
      assessmentId,
      projectId: project.id,
      revision: project.revision,
      manifestSha256: project.manifestSha256,
      repository: "example/open-registry",
      commitSha: assessment.commitSha,
      templateSha256: assessment.templateSha256,
    },
    disposition,
  );
}

async function activate(expectedRevision = 1) {
  const project = await projects.getProject("open-registry");
  return projectApi(
    sessionRequest("PUT", "admin/projects/open-registry/manifest", "admin", {
      manifest: { ...project?.manifest, status: "active" },
      expectedRevision,
      reason: "Activate the scanned revision",
    }),
  );
}

async function publicVetting() {
  return (
    await (
      await projectApi(new Request(`${ORIGIN}/api/v1/projects/open-registry`))
    ).json()
  ).vetting;
}

describe("community security vetting", () => {
  test("a clean signed result clears the exact revision for activation", async () => {
    await listPausedProject();
    expect(await publicVetting()).toEqual({ state: "unscanned" });
    expect((await activate()).status).toBe(422);
    const id = await queueScan();
    expect((await publicVetting()).state).toBe("queued");

    // The service reads its queue with a signed request.
    const queue = await vettingApi(await signed("GET", "vetting/requests"));
    expect(queue.status).toBe(200);
    expect((await queue.json()).assessments).toMatchObject([
      {
        assessmentId: id,
        projectId: "open-registry",
        revision: 1,
        commitSha: HEAD,
        templateSha256: TEMPLATE,
        manifestUrl: `${ORIGIN}/api/v1/project-revisions/open-registry/1`,
      },
    ]);

    const recorded = await postResult(await fixture(id, "clean"));
    expect(recorded.status).toBe(200);
    expect((await recorded.json()).assessment).toMatchObject({
      state: "clean",
      commitSha: "a".repeat(40),
      policyVersion: "vet-policy-1",
      artifacts: 1,
      heldArtifacts: 0,
    });
    // A replay of the same result cannot record twice.
    expect((await postResult(await fixture(id, "clean"))).status).toBe(409);
    expect((await publicVetting()).state).toBe("cleared");

    const activated = await activate();
    expect(activated.status).toBe(200);
    expect((await projects.getProject("open-registry"))?.status).toBe("active");
    // Revision 2 differs only by status, so the revision 1 scan still covers it.
    expect(await publicVetting()).toMatchObject({
      state: "cleared",
      assessment: { revision: 1 },
    });
  });

  test("a clearance binds the assigned commit and template; a moved head is stale", async () => {
    await listPausedProject();
    const id = await queueScan();
    const result = await fixture(id, "clean");
    // The service cannot choose the commit or template it reports (VET-07).
    for (const assessed of [
      { ...result.assessed, commitSha: "c".repeat(40) },
      { ...result.assessed, templateSha256: "c".repeat(64) },
    ]) {
      const refused = await postResult({ ...result, assessed });
      expect(refused.status).toBe(422);
      expect((await refused.json()).error).toBe("commit_mismatch");
    }
    expect((await postResult(result)).status).toBe(200);
    expect((await publicVetting()).state).toBe("cleared");

    // New commits on the integration branch lose the clearance.
    livePin = { commitSha: "e".repeat(40), templateSha256: TEMPLATE };
    expect(await publicVetting()).toMatchObject({
      state: "stale",
      assessment: { commitSha: HEAD, templateSha256: TEMPLATE },
      live: { commitSha: "e".repeat(40) },
    });
    const refused = await activate();
    expect(refused.status).toBe(422);
    expect((await refused.json()).message).toContain(
      "Security vetting is stale",
    );
    // A rescan is assigned the new head, and its clean result clears it.
    const rescan = await queueScan();
    expect((await vetting.getAssessment(rescan))?.commitSha).toBe(
      "e".repeat(40),
    );
    expect((await publicVetting()).state).toBe("queued");
    expect((await postResult(await fixture(rescan, "clean"))).status).toBe(200);
    expect((await publicVetting()).state).toBe("cleared");

    // A new skill template loses the clearance too.
    livePin = { commitSha: "e".repeat(40), templateSha256: "f".repeat(64) };
    expect((await publicVetting()).state).toBe("stale");
    // An unreadable head never counts as cleared, and no scan can be queued.
    livePin = null;
    expect((await publicVetting()).state).toBe("unverified");
    expect((await activate()).status).toBe(422);
    const unqueued = await vettingApi(
      sessionRequest("POST", "admin/vetting/assessments", "admin", {
        projectId: "open-registry",
        revision: 1,
        reason: "Rescan while GitHub is down",
      }),
    );
    expect(unqueued.status).toBe(503);
    expect((await unqueued.json()).error).toBe("pin_unavailable");
  });

  test("an incomplete result quarantines the revision and blocks activation", async () => {
    await listPausedProject();
    const id = await queueScan();
    const result = await fixture(id, "incomplete");
    // A clean claim with a telemetry gap and a quarantined artifact is refused.
    const overclaimed = await postResult({ ...result, disposition: "clean" });
    expect(overclaimed.status).toBe(422);
    expect((await overclaimed.json()).message).toContain(
      "Telemetry channel http is not complete",
    );
    expect((await postResult(result)).status).toBe(200);
    expect(await publicVetting()).toMatchObject({
      state: "quarantined",
      assessment: { state: "incomplete", heldArtifacts: 1 },
    });
    const refused = await activate();
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toBe("vetting_required");
  });

  test("an unavailable model review can never produce a clean result", async () => {
    await listPausedProject();
    const id = await queueScan();
    const result = await fixture(id, "clean");
    result.modelReviews[1] = {
      ...result.modelReviews[1],
      status: "unavailable",
      verdict: null,
    } as unknown as (typeof result.modelReviews)[number];
    const refused = await postResult(result);
    expect(refused.status).toBe(422);
    expect((await refused.json()).message).toContain(
      "The opus review did not complete",
    );
    expect(
      (await postResult({ ...result, disposition: "incomplete" })).status,
    ).toBe(200);
    expect((await publicVetting()).state).toBe("quarantined");
  });

  test("confirmed malice bans the project; a model label alone cannot", async () => {
    await listPausedProject();
    const id = await queueScan();
    const result = await fixture(id, "malicious");
    // Current contribution identity, reversed credit, unrelated project and
    // unresolved identities exercise the actual recipient selection boundary.
    for (const [actor, githubId] of [
      ["known", "900000010"],
      ["reversed", "900000011"],
      ["other", "900000012"],
    ]) {
      sqlite
        .prepare(
          "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
        )
        .run(actor, githubId, actor, NOW.toISOString());
    }
    for (const [key, actor, project, amount, previous] of [
      ["known", "known", "open-registry", 10, null],
      ["reversed", "reversed", "open-registry", 10, null],
      ["reversed-next", "reversed", "open-registry", 0, "reversed"],
      ["other", "other", "another-project", 10, null],
      ["unresolved", "unresolved", "open-registry", 10, null],
    ] as const) {
      sqlite
        .prepare(
          "INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(?,?,?,?,?)",
        )
        .run(
          key,
          previous ?? key,
          previous,
          NOW.toISOString(),
          JSON.stringify({
            award: { actor: { id: actor }, projectId: project, amount },
          }),
        );
    }
    sqlite
      .prepare(
        `INSERT INTO payment_direct_transfers(network,transaction_id,project_id,contribution_month,github_user_id,github_node_id,github_login,chain,recipient,amount_micro,block_time,block_id,source_path,imported_at)
      VALUES('base-mainnet','fixture-transfer','open-registry','2026-10','900000013','financial','financial','base','fixture-wallet','1',?,'fixture-block','fixture',?)`,
      )
      .run(NOW.toISOString(), NOW.toISOString());
    const unconfirmed = await postResult({ ...result, confirmation: null });
    expect(unconfirmed.status).toBe(422);
    expect(await projects.listEnforcements()).toEqual([]);
    expect((await postResult(result)).status).toBe(200);
    const notices = sqlite
      .prepare(
        "SELECT recipient_github_id AS recipient, action_path AS path, detail FROM notifications WHERE event_key LIKE 'project-enforcement:%' ORDER BY recipient_github_id",
      )
      .all() as { recipient: string; path: string; detail: null }[];
    expect(notices.map((notice) => notice.recipient)).toEqual([
      "900000001",
      "900000002",
      "900000004",
      "900000010",
      "900000013",
      "987654321",
    ]);
    expect(notices.every((notice) => notice.detail === null)).toBe(true);
    expect(
      notices.find((notice) => notice.recipient === ADMIN.githubId)?.path,
    ).toBe("/admin");
    expect((await postResult(result)).status).toBe(409);
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM notifications WHERE event_key LIKE 'project-enforcement:%'",
        )
        .get(),
    ).toEqual({ n: 6 });
    expect(await projects.listEnforcements()).toMatchObject([
      {
        action: "ban",
        actor: null,
        actorRole: "vetting-service",
        decisionSource: "standing-rule",
        result: "revision_pending",
        systemIssuer: { kind: "vetting-service", assessmentId: id },
      },
    ]);
    expect(
      (await projectApi(new Request(`${ORIGIN}/api/v1/projects/open-registry`)))
        .status,
    ).toBe(410);
    // A later clean scan cannot lift the ban (VET-06).
    const rescan = await queueScan();
    expect((await postResult(await fixture(rescan, "clean"))).status).toBe(200);
    expect(
      (await projectApi(new Request(`${ORIGIN}/api/v1/projects/open-registry`)))
        .status,
    ).toBe(410);
    expect((await activate()).status).toBe(409);
  });

  test("forged, stale, mismatched and unconfigured requests fail closed", async () => {
    await listPausedProject();
    const id = await queueScan();
    const result = await fixture(id, "clean");
    // Stale timestamp.
    expect(
      (await postResult(result, new Date(NOW.getTime() - 10 * 60 * 1000)))
        .status,
    ).toBe(401);
    // Signature over other bytes.
    const forged = await signed("POST", "vetting/results", "{}");
    expect(
      (
        await vettingApi(
          new Request(forged.url, {
            method: "POST",
            headers: forged.headers,
            body: JSON.stringify(result),
          }),
        )
      ).status,
    ).toBe(401);
    // A result for another revision digest.
    const mismatch = await postResult({
      ...result,
      manifestSha256: "9".repeat(64),
    });
    expect(mismatch.status).toBe(422);
    // Unknown fields are refused.
    expect((await postResult({ ...result, extra: true })).status).toBe(422);
    // A non-admin cannot queue scans.
    expect(
      (
        await vettingApi(
          sessionRequest("POST", "admin/vetting/assessments", "applicant", {
            projectId: "open-registry",
            revision: 1,
            reason: "x",
          }),
        )
      ).status,
    ).toBe(403);
    expect((await publicVetting()).state).toBe("queued");

    configuredKeys = undefined;
    const overview = await vettingApi(
      sessionRequest("GET", "admin/vetting", "admin"),
    );
    expect((await overview.json()).service.state).toBe("unavailable");
    expect((await postResult(result)).status).toBe(503);
    expect(
      (
        await vettingApi(
          sessionRequest("POST", "admin/vetting/assessments", "admin", {
            projectId: "open-registry",
            revision: 1,
            reason: "Admission scan",
          }),
        )
      ).status,
    ).toBe(503);
  });
});

test("private retained bytes control inspection and continuing clean clearance", async () => {
  await listPausedProject();
  const id = await queueScan();
  const result = await fixture(id, "clean");
  const run = result.environment.runId;
  const base = `/api/v1/operator/vetting-evidence/${id}/${run}/${result.traceSha256}`;
  const key = `vetting/${id}/${run}/${result.traceSha256}`;
  const operator = async (
    path: string,
    actor = "900000003",
    body?: unknown,
    grant?: string,
  ) =>
    (await retained.evidence.handle(
      new Request(`${ORIGIN}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "x-test-operator": actor,
          ...(body === undefined
            ? {}
            : { origin: ORIGIN, "content-type": "application/json" }),
          ...(grant ? { "x-vetting-read-grant": grant } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    ))!;
  const overview = `/api/v1/operator/vetting-evidence?assessmentId=${id}&runId=${run}`;
  expect((await operator(overview, "900000001")).status).toBe(403);
  expect((await operator(overview, "")).status).toBe(401);
  const visible = await operator(overview);
  expect(visible.status).toBe(200);
  expect(await visible.text()).not.toContain(VETTING_TRACE_BODY);
  const grantResponse = await operator(`${base}/grant`, undefined, {
    reason: "Inspect recorded collector evidence",
  });
  expect(grantResponse.status).toBe(201);
  const grant = (await grantResponse.json()).grant;
  const reads = await Promise.all([
    operator(`${base}/body`, undefined, undefined, grant),
    operator(`${base}/body`, undefined, undefined, grant),
  ]);
  expect(reads.map((r) => r.status).sort()).toEqual([200, 403]);
  const read = reads.find((r) => r.ok)!;
  expect(await read.text()).toBe(VETTING_TRACE_BODY);
  expect(read.headers.get("cache-control")).toBe("private, no-store");
  const policy = retained.evidence.deps.policy!;
  const revokeGrant = (
    await (
      await operator(`${base}/grant`, undefined, {
        reason: "Inspect before access is revoked",
      })
    ).json()
  ).grant;
  retained.evidence.deps.policy = JSON.stringify({
    ...JSON.parse(policy),
    operatorGithubIds: ["900000099"],
  });
  expect(
    (await operator(`${base}/body`, undefined, undefined, revokeGrant)).status,
  ).toBe(403);
  retained.evidence.deps.policy = policy;
  expect((await postResult(result)).status).toBe(200);
  expect((await publicVetting()).state).toBe("cleared");
  await retained.bucket.delete(key);
  expect(
    (
      await operator(`${base}/grant`, undefined, {
        reason: "Inspect absent collector evidence",
      })
    ).status,
  ).toBe(404);
  expect((await publicVetting()).state).toBe("unverified");
  expect((await activate()).status).not.toBe(200);
  await retained.bucket.put(
    key,
    new TextEncoder().encode(
      VETTING_TRACE_BODY.replace("Harmless", "Changed!"),
    ),
    {
      customMetadata: { sha256: result.traceSha256 },
      httpMetadata: { contentType: "text/plain" },
      onlyIf: { etagDoesNotMatch: "*" },
    },
  );
  expect(
    (
      await operator(`${base}/grant`, undefined, {
        reason: "Inspect changed collector evidence",
      })
    ).status,
  ).toBe(409);
  expect((await publicVetting()).state).toBe("unverified");
  await retained.bucket.delete(key);
  await retained.retain(id, run);
  expect((await publicVetting()).state).toBe("cleared");
  retained.evidence.deps.policy = JSON.stringify({
    ...JSON.parse(policy),
    maxObjectBytes: 1,
  });
  expect(
    (
      await operator(`${base}/grant`, undefined, {
        reason: "Inspect over-limit collector evidence",
      })
    ).status,
  ).toBe(413);
  retained.evidence.deps.policy = policy;
  retained.evidence.deps.now = () => new Date(NOW.getTime() + 3600_001);
  expect(
    (
      await operator(`${base}/grant`, undefined, {
        reason: "Inspect expired collector evidence",
      })
    ).status,
  ).toBe(410);
  expect((await publicVetting()).state).toBe("unverified");
  retained.evidence.deps.now = () => new Date(NOW.getTime() + 7200_001);
  expect(retained.evidence.ready()).toBe(false);
  expect((await operator(overview)).status).toBe(503);
});

test("a clean result cannot omit a referenced retained artifact or replace an immutable inventory", async () => {
  await listPausedProject();
  const id = await queueScan();
  const result = await fixture(id, "clean");
  const run = result.environment.runId;
  const service = `/api/v1/vetting/evidence/${id}/${run}`;
  const changed = {
    traceSha256: result.traceSha256,
    objects: VETTING_EVIDENCE_OBJECTS.slice(0, 1).map(
      ({ body: _body, ...object }) => object,
    ),
  };
  const conflict = await retained.evidence.handle(
    await retained.request("POST", service, JSON.stringify(changed)),
  );
  expect(conflict?.status).toBe(409);
  await retained.bucket.delete(
    `vetting/${id}/${run}/${result.artifacts[0].sha256}`,
  );
  expect((await postResult(result)).status).toBe(422);
  expect((await publicVetting()).state).toBe("queued");
  await retained.retain(id, run);
  expect((await postResult(result)).status).toBe(200);
  const audits = await retained.evidence.deps.db
    .prepare(
      "SELECT action,reason FROM vetting_evidence_audit WHERE assessment_id=?",
    )
    .bind(id)
    .all<{ action: string; reason: string | null }>();
  expect(audits.results?.filter((a) => a.action === "register")).toHaveLength(
    1,
  );
});

test("historical metadata-only clean results have no retained-evidence exemption", async () => {
  await listPausedProject();
  const id = await queueScan();
  const result = await fixture(id, "clean", false);
  const parsed = parseVettingResult(result);
  expect(
    await vetting.recordResult({
      result: parsed,
      resultText: JSON.stringify(parsed),
      resultSha256: "1".repeat(64),
      signingKeySha256: "2".repeat(64),
      at: NOW.toISOString(),
    }),
  ).toBe("recorded");
  expect((await publicVetting()).state).toBe("unverified");
  expect((await activate()).status).not.toBe(200);
});

test("missing storage pauses acquisition while harmless queue registration remains available", async () => {
  retained.evidence.deps.policy = undefined;
  await listPausedProject();
  const id = await queueScan();
  expect((await vetting.getAssessment(id))?.state).toBe("pending");
  const overview = await vettingApi(
    sessionRequest("GET", "admin/vetting", "admin"),
  );
  expect((await overview.json()).service).toMatchObject({
    state: "unavailable",
    queueRegistrationAvailable: true,
  });
  expect(
    (await vettingApi(await signed("GET", "vetting/requests"))).status,
  ).toBe(503);
});

test("large retained evidence uses bounded chunks, immutable completion and actor-bound native downloads", async () => {
  await listPausedProject();
  const id = await queueScan(),
    runId = "large-retention";
  const bytes = process.env.SLOP_VETTING_OVERLAY_PATH
    ? readFileSync(process.env.SLOP_VETTING_OVERLAY_PATH)
    : Buffer.alloc(23_592_960, 71);
  const hash = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  const digest = hash(bytes),
    chunks = [];
  for (let offset = 0; offset < bytes.length; offset += EVIDENCE_CHUNK_BYTES) {
    const part = bytes.subarray(offset, offset + EVIDENCE_CHUNK_BYTES);
    chunks.push({
      index: chunks.length,
      sha256: hash(part),
      sizeBytes: part.length,
    });
  }
  const policy = JSON.parse(retained.evidence.deps.policy!);
  policy.maxObjectBytes = 32 * 1024 * 1024;
  retained.evidence.deps.policy = JSON.stringify(policy);
  retained.evidence.deps.signed = (request, maximum) =>
    signedVettingRequest(
      request,
      { resultPublicKeys: keys.publicKey, now: () => NOW },
      maximum,
    );
  const servicePath = `/api/v1/vetting/evidence/${id}/${runId}`;
  // Preserve an unexpected local-workerd cause instead of losing it behind
  // the production route's deliberately generic private-error response.
  let unexpectedUploadError: unknown;
  const uploadChunk = retained.evidence.uploadChunk.bind(retained.evidence);
  retained.evidence.uploadChunk = async (...args) => {
    try {
      return await uploadChunk(...args);
    } catch (error) {
      if (!(error instanceof Error && "status" in error))
        unexpectedUploadError = error;
      throw error;
    }
  };
  const send = async (
    method: string,
    path: string,
    body: string | Uint8Array,
  ) => {
    const response = (await retained.evidence.handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: await signedVettingHeaders(
          keys.privateKey,
          keys.raw,
          method,
          path,
          body,
          NOW,
        ),
        body: body as BodyInit,
      }),
    ))!;
    if (response.status === 500 && unexpectedUploadError)
      throw unexpectedUploadError;
    return response;
  };
  const manifest = JSON.stringify({
    traceSha256: digest,
    objects: [
      {
        sha256: digest,
        sizeBytes: bytes.length,
        kind: "trace",
        label: "Retained synthetic VM overlay",
        contentType: "application/octet-stream",
        chunks,
      },
    ],
  });
  expect((await send("POST", servicePath, manifest)).status).toBe(201);
  expect((await send("POST", servicePath, manifest)).status).toBe(200);
  const changed = JSON.parse(manifest);
  changed.objects[0].chunks[0].sha256 = "a".repeat(64);
  expect(
    (await send("POST", servicePath, JSON.stringify(changed))).status,
  ).toBe(409);
  expect(
    (await send("POST", `${servicePath}/${digest}/finalize`, "{}")).status,
  ).toBe(404);
  for (const part of chunks) {
    const path = `${servicePath}/${digest}/chunks/${part.index}`;
    expect(
      (
        await send(
          "PUT",
          path,
          bytes.subarray(
            part.index * EVIDENCE_CHUNK_BYTES,
            part.index * EVIDENCE_CHUNK_BYTES + part.sizeBytes,
          ),
        )
      ).status,
    ).toBe(200);
  }
  expect(
    (await send("PUT", `${servicePath}/${digest}/chunks/0`, new Uint8Array(20)))
      .status,
  ).toBe(422);
  sqlite.exec(
    "CREATE TRIGGER reject_finalize BEFORE INSERT ON vetting_evidence_audit WHEN NEW.action='finalize' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  expect(
    (await send("POST", `${servicePath}/${digest}/finalize`, "{}")).status,
  ).toBe(500);
  expect(
    sqlite
      .query(
        "SELECT count(*) AS n FROM vetting_evidence_completions WHERE run_id=?",
      )
      .get(runId),
  ).toEqual({ n: 0 });
  sqlite.exec("DROP TRIGGER reject_finalize");
  expect(
    (await send("POST", `${servicePath}/${digest}/finalize`, "{}")).status,
  ).toBe(200);
  const replay = await send("POST", `${servicePath}/${digest}/finalize`, "{}");
  expect((await replay.json()).replayed).toBe(true);
  const base = `/api/v1/operator/vetting-evidence/${id}/${runId}/${digest}`;
  const grant = async () =>
    (await retained.evidence.handle(
      new Request(`${ORIGIN}${base}/download-grant`, {
        method: "POST",
        headers: {
          "x-test-operator": "900000003",
          origin: ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reason: "Inspect complete synthetic VM overlay bytes",
        }),
      }),
    ))!;
  const request = async (
    cookie: string,
    actor = "900000003",
    extra: Record<string, string> = {},
  ) =>
    (await retained.evidence.handle(
      new Request(`${ORIGIN}${base}/download`, {
        headers: {
          "x-test-operator": actor,
          "sec-fetch-site": "same-origin",
          cookie,
          ...extra,
        },
      }),
    ))!;
  const granted = await grant();
  expect(granted.status).toBe(201);
  expect(await granted.text()).not.toContain("grant");
  const cookie = granted.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly; SameSite=Strict");
  expect(cookie).toContain(`Path=${base}/download;`);
  const token = cookie.split(";")[0];
  expect((await request(token, "900000001")).status).toBe(403);
  expect((await request(`${token}; ${token}`)).status).toBe(403);
  expect(
    (await request(token, undefined, { "sec-fetch-site": "same-site" })).status,
  ).toBe(403);
  const replies = await Promise.all([request(token), request(token)]);
  expect(replies.map((r) => r.status).sort()).toEqual([200, 403]);
  const accepted = replies.find((r) => r.status === 200)!;
  expect(accepted.headers.get("set-cookie")).toContain("Max-Age=0");
  const reader = accepted.body!.getReader(),
    streamed = createHash("sha256");
  let size = 0,
    maximum = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    maximum = Math.max(maximum, value.length);
    size += value.length;
    streamed.update(value);
  }
  expect(size).toBe(bytes.length);
  expect(maximum).toBeLessThanOrEqual(EVIDENCE_CHUNK_BYTES);
  expect(streamed.digest("hex")).toBe(digest);
  const cancellation = await request(
    (await grant()).headers.get("set-cookie")!.split(";")[0],
  );
  const cancelled = cancellation.body!.getReader();
  await cancelled.read();
  await cancelled.cancel();
  const audit = sqlite
    .query("SELECT action FROM vetting_evidence_audit WHERE run_id=?")
    .all(runId) as { action: string }[];
  expect(audit.filter((r) => r.action === "download-finished")).toHaveLength(1);
  expect(audit.filter((r) => r.action === "download-cancelled")).toHaveLength(
    1,
  );
  const wrongPath = `/api/v1/vetting/evidence/${id}/wrong-whole-digest`;
  const wrong = JSON.parse(manifest);
  wrong.traceSha256 = "a".repeat(64);
  wrong.objects[0].sha256 = wrong.traceSha256;
  expect((await send("POST", wrongPath, JSON.stringify(wrong))).status).toBe(
    201,
  );
  for (const part of chunks)
    expect(
      (
        await send(
          "PUT",
          `${wrongPath}/${wrong.traceSha256}/chunks/${part.index}`,
          bytes.subarray(
            part.index * EVIDENCE_CHUNK_BYTES,
            part.index * EVIDENCE_CHUNK_BYTES + part.sizeBytes,
          ),
        )
      ).status,
    ).toBe(200);
  expect(
    (await send("POST", `${wrongPath}/${wrong.traceSha256}/finalize`, "{}"))
      .status,
  ).toBe(409);
  expect(
    sqlite
      .query(
        "SELECT count(*) AS n FROM vetting_evidence_completions WHERE run_id='wrong-whole-digest'",
      )
      .get(),
  ).toEqual({ n: 0 });
  const finishing = await request(
    (await grant()).headers.get("set-cookie")!.split(";")[0],
  );
  sqlite.exec(
    "CREATE TRIGGER reject_download_audit BEFORE INSERT ON vetting_evidence_audit WHEN NEW.action IN ('download-finished','download-failed') BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  await expect(finishing.arrayBuffer()).rejects.toThrow("audit unavailable");
  sqlite.exec("DROP TRIGGER reject_download_audit");
  const interrupted = await request(
    (await grant()).headers.get("set-cookie")!.split(";")[0],
  );
  const interruptedReader = interrupted.body!.getReader();
  await interruptedReader.read();
  await retained.bucket.delete(
    `vetting/${id}/${runId}/${digest}/chunks/1/${chunks[1].sha256}`,
  );
  await expect(interruptedReader.read()).rejects.toThrow(
    "Declared evidence bytes are missing",
  );
  expect((await grant()).status).toBe(404);
}, 60_000);

test("a native download stops serving parts once the operator session is revoked", async () => {
  await listPausedProject();
  const id = await queueScan(),
    runId = "revoked-download";
  const bytes = Buffer.alloc(EVIDENCE_CHUNK_BYTES + 1024, 83);
  const hash = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  const digest = hash(bytes);
  const parts = [
    bytes.subarray(0, EVIDENCE_CHUNK_BYTES),
    bytes.subarray(EVIDENCE_CHUNK_BYTES),
  ];
  const chunks = parts.map((part, index) => ({
    index,
    sha256: hash(part),
    sizeBytes: part.length,
  }));
  const policy = JSON.parse(retained.evidence.deps.policy!);
  policy.maxObjectBytes = 16 * 1024 * 1024;
  retained.evidence.deps.policy = JSON.stringify(policy);
  retained.evidence.deps.signed = (request, maximum) =>
    signedVettingRequest(
      request,
      { resultPublicKeys: keys.publicKey, now: () => NOW },
      maximum,
    );
  const servicePath = `/api/v1/vetting/evidence/${id}/${runId}`;
  const send = async (
    method: string,
    path: string,
    body: string | Uint8Array,
  ) =>
    (await retained.evidence.handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: await signedVettingHeaders(
          keys.privateKey,
          keys.raw,
          method,
          path,
          body,
          NOW,
        ),
        body: body as BodyInit,
      }),
    ))!;
  const manifest = JSON.stringify({
    traceSha256: digest,
    objects: [
      {
        sha256: digest,
        sizeBytes: bytes.length,
        kind: "trace",
        label: "Retained synthetic overlay",
        contentType: "application/octet-stream",
        chunks,
      },
    ],
  });
  expect((await send("POST", servicePath, manifest)).status).toBe(201);
  for (const [index, part] of parts.entries())
    expect(
      (await send("PUT", `${servicePath}/${digest}/chunks/${index}`, part))
        .status,
    ).toBe(200);
  expect(
    (await send("POST", `${servicePath}/${digest}/finalize`, "{}")).status,
  ).toBe(200);
  const base = `/api/v1/operator/vetting-evidence/${id}/${runId}/${digest}`;
  const granted = (await retained.evidence.handle(
    new Request(`${ORIGIN}${base}/download-grant`, {
      method: "POST",
      headers: {
        "x-test-operator": "900000003",
        origin: ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "Inspect retained overlay bytes" }),
    }),
  ))!;
  expect(granted.status).toBe(201);
  const download = (await retained.evidence.handle(
    new Request(`${ORIGIN}${base}/download`, {
      headers: {
        "x-test-operator": "900000003",
        "sec-fetch-site": "same-origin",
        cookie: granted.headers.get("set-cookie")!.split(";")[0],
      },
    }),
  ))!;
  expect(download.status).toBe(200);
  const reader = download.body!.getReader();
  expect((await reader.read()).value?.length).toBe(EVIDENCE_CHUNK_BYTES);
  // The operator signs out (their session row is deleted) mid-transfer.
  retained.evidence.deps.session = async () => null;
  await expect(reader.read()).rejects.toThrow("Sign in with GitHub");
  const audit = sqlite
    .query("SELECT action FROM vetting_evidence_audit WHERE run_id=?")
    .all(runId) as { action: string }[];
  expect(audit.map((row) => row.action)).toContain("download-failed");
  expect(audit.map((row) => row.action)).not.toContain("download-finished");
}, 60_000);
