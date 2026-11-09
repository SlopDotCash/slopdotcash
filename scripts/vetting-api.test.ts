// Community security vetting (PRD VET-01 to VET-08) on the real migrations:
// the signed service contract, refusal of unsupported clean claims, truthful
// incomplete and malicious fixtures, the activation and skill gates, and
// the fail-closed state when no vetting service is configured.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { handleProjectApi } from "../backend/projects/handler";
import { EVIDENCE_POLICY } from "../backend/vetting/evidence";
import {
  EVIDENCE_CHUNK_BYTES,
  type EvidenceChunk,
} from "../backend/vetting/evidence-chunks";
import {
  EVIDENCE_RETIREMENT_METADATA_KEY,
  EVIDENCE_RETIREMENT_METADATA_VALUE,
  EvidenceStorage,
  type EvidenceStorageRow,
} from "../backend/vetting/evidence-storage";
import {
  handleVettingApi,
  signedVettingRequest,
} from "../backend/vetting/handler";
import {
  CloudflareVettingPersistence,
  type VettingPin,
} from "../backend/vetting/persistence";
import { parseVettingResult } from "../backend/vetting/result";
import { onRequest } from "../functions/api/v1/[[path]]";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  EVIDENCE_OWNER_GITHUB_ID,
  EVIDENCE_READER_GITHUB_ID,
  localVettingEvidence,
} from "../tests/vetting-evidence-fixture";
import {
  signedVettingHeaders,
  VETTING_EVIDENCE_OBJECTS,
  VETTING_TRACE_BODY,
  VETTING_TRACE_SHA,
  vettingKeyPair,
  vettingResult,
} from "../tests/vetting-fixtures";
import { publishResult } from "../workers/vetting/publication";
import { servicePublicationJournal } from "../workers/vetting/publication-journal";

let retained: Awaited<ReturnType<typeof localVettingEvidence>>;

/** Resolve the row's published storage pointer; do not guess a physical key. */
async function selectedEvidenceKey(
  assessmentId: string,
  runId: string,
  sha256: string,
  part?: EvidenceChunk,
) {
  const db = retained.evidence.deps.db;
  const row = await evidenceStorageRow(assessmentId, runId, sha256);
  const key = await new EvidenceStorage(
    db,
    retained.evidence.deps.bucket!,
    () => NOW,
    () => crypto.randomUUID(),
  ).partKey(row, part);
  if (key === null) throw new Error("Evidence has no published storage target");
  return key;
}
async function evidenceStorageRow(
  assessmentId: string,
  runId: string,
  sha256: string,
) {
  const row = await retained.evidence.deps.db
    .prepare(
      "SELECT object_key,sha256,size_bytes,storage,storage_generation FROM vetting_evidence_objects WHERE assessment_id=? AND run_id=? AND sha256=?",
    )
    .bind(assessmentId, runId, sha256)
    .first<EvidenceStorageRow & { storage_generation: string | null }>();
  if (!row) throw new Error("Missing retained evidence row");
  return row;
}
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
    async (a) => a.result !== null && retained.evidence.retained(a.result),
  );
  keys = await vettingKeyPair();
  configuredKeys = keys.publicKey;
  livePin = { commitSha: HEAD, templateSha256: TEMPLATE };
});

/** Seed the old content protocol before its real migration; never bypass its trigger. */
async function legacyContentRun(runId: string) {
  await retained.dispose();
  const database = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql") && name < "0119_")
      .sort(),
  );
  const { db } = database;
  sqlite = database.sqlite;
  projects = new CloudflareProjectPersistence(db);
  retained = await localVettingEvidence(db, () => NOW);
  vetting = new CloudflareVettingPersistence(
    db,
    async (a) => a.result !== null && retained.evidence.retained(a.result),
  );
  await listPausedProject();
  const id = await queueScan();
  const objects = VETTING_EVIDENCE_OBJECTS.map(
    ({ body: _body, ...object }) => object,
  );
  const manifest = JSON.stringify({ traceSha256: VETTING_TRACE_SHA, objects });
  sqlite
    .query(
      "INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      runId,
      VETTING_TRACE_SHA,
      createHash("sha256").update(manifest).digest("hex"),
      manifest,
      JSON.stringify(EVIDENCE_POLICY),
      NOW.toISOString(),
      new Date(
        NOW.getTime() + EVIDENCE_POLICY.postClosureRetentionSeconds * 1000,
      ).toISOString(),
    );
  for (const object of VETTING_EVIDENCE_OBJECTS) {
    sqlite
      .query(
        "INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key,storage) VALUES(?,?,?,?,?,?,?,?,'content')",
      )
      .run(
        id,
        runId,
        object.sha256,
        object.sizeBytes,
        object.kind,
        object.label,
        object.contentType,
        `vetting/${id}/${runId}/${object.sha256}`,
      );
    await retained.bucket.put(
      `vetting/objects/${object.sha256}`,
      new TextEncoder().encode(object.body),
      {
        onlyIf: { etagDoesNotMatch: "*" },
        customMetadata: { sha256: object.sha256 },
        httpMetadata: { contentType: object.contentType },
      },
    );
  }
  sqlite.exec(
    readFileSync(
      new URL(
        "../migrations/0119_vetting_storage_generations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(
    (await evidenceStorageRow(id, runId, VETTING_TRACE_SHA)).storage_generation,
  ).toBeNull();
  return id;
}

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
    repositoryControl: async () => ({ state: "matched" }),
    repositoryAccess: async () => ({
      installation: "installed",
      installationId: 1,
      permission: "admin",
      roleName: "admin",
    }),
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
  const created = await projectApi(
    sessionRequest("POST", "projects", "applicant", {
      manifest: applicationManifest("open-registry", "example/open-registry"),
    }),
  );
  expect(created.status).toBe(201);
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

test("admin vetting binds protected reads and writes to the displayed actor", async () => {
  await listPausedProject();
  const bindActor = (request: Request, expected: string) => {
    const headers = new Headers(request.headers);
    headers.set("x-slop-expected-github-id", expected);
    return new Request(request, { headers });
  };
  const before = await vetting.listAssessments();
  for (const [method, path] of [
    ["GET", "admin/vetting"],
    ["POST", "admin/vetting/assessments"],
    ["POST", "admin/vetting/exemptions"],
    ["POST", "admin/vetting/exemptions/unknown/revoke"],
  ] as const) {
    for (const [expected, status, code] of [
      [APPLICANT.githubId, 403, "actor_changed"],
      ["invalid", 400, "invalid_expected_actor"],
    ] as const) {
      const response = await vettingApi(
        bindActor(
          sessionRequest(
            method,
            path,
            "admin",
            method === "POST" ? {} : undefined,
          ),
          expected,
        ),
      );
      expect(response.status).toBe(status);
      expect((await response.json()).error).toBe(code);
    }
  }
  expect(await vetting.listAssessments()).toEqual(before);
  expect(await vetting.listAdmissionExemptions()).toEqual([]);
  const read = sessionRequest("GET", "admin/vetting", "admin");
  expect((await vettingApi(read)).status).toBe(200);
  expect((await vettingApi(bindActor(read, ADMIN.githubId))).status).toBe(200);
  expect(
    (
      await vettingApi(
        bindActor(
          sessionRequest("GET", "admin/vetting", "applicant"),
          APPLICANT.githubId,
        ),
      )
    ).status,
  ).toBe(403);
  const queued = await vettingApi(
    bindActor(
      sessionRequest("POST", "admin/vetting/assessments", "admin", {
        projectId: "open-registry",
        revision: 1,
        reason: "Actor-bound admission scan",
      }),
      ADMIN.githubId,
    ),
  );
  expect(queued.status).toBe(201);
  // The independent signed-service protocol does not inherit an admin header.
  const service = await signed("GET", "vetting/requests");
  expect((await vettingApi(bindActor(service, "invalid"))).status).toBe(200);
});

describe("community security vetting", () => {
  test("the trusted publisher journals one signed intake attempt", async () => {
    await listPausedProject();
    const id = await queueScan();
    // A historical incomplete result; publication accepts exact v1 bytes.
    const publishable = async (assessmentId: string) => {
      const body = JSON.stringify(
        parseVettingResult(await fixture(assessmentId, "incomplete")),
      );
      return {
        body,
        resultSha256: createHash("sha256").update(body).digest("hex"),
      };
    };
    const prepared = await publishable(id);
    const journalDirectory = await mkdtemp(
      join(tmpdir(), "vetting-publisher-"),
    );
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        requests += 1;
        return vettingApi(request);
      },
    });
    try {
      const signer = {
        privateKey: keys.privateKey,
        publicKey: await crypto.subtle.importKey(
          "raw",
          keys.raw,
          "Ed25519",
          true,
          ["verify"],
        ),
      };
      const options = {
        origin: ORIGIN,
        body: prepared.body,
        approvedSha256: prepared.resultSha256,
        signer,
        journalDirectory,
        at: NOW,
        fetch: ((_url: unknown, init: RequestInit) =>
          fetch(`${server.url}api/v1/vetting/results`, init)) as typeof fetch,
      };
      const receipt = await publishResult(options);
      expect(receipt.outcome).toBe("accepted");
      expect((await publicVetting()).state).toBe("quarantined");
      expect(
        JSON.parse(
          await readFile(join(journalDirectory, id, "receipt.json"), "utf8"),
        ),
      ).toEqual(receipt);
      await expect(publishResult(options)).rejects.toThrow();
      expect(requests).toBe(1);

      // A lost response after a committed write must stay unknown, and the
      // journal must prevent a second attempt even though no receipt arrived.
      const nextId = await queueScan();
      const next = await publishable(nextId);
      const uncertain = await publishResult({
        ...options,
        body: next.body,
        approvedSha256: next.resultSha256,
        fetch: (async (_url: unknown, init: RequestInit) => {
          await fetch(`${server.url}api/v1/vetting/results`, init);
          throw new Error("Response lost after commit");
        }) as unknown as typeof fetch,
      });
      expect(uncertain.outcome).toBe("unknown");
      expect((await vetting.getAssessment(nextId))?.state).toBe("incomplete");
      await expect(
        publishResult({
          ...options,
          body: next.body,
          approvedSha256: next.resultSha256,
        }),
      ).rejects.toThrow();
      expect(requests).toBe(2);
    } finally {
      await server.stop(true);
      await rm(journalDirectory, { recursive: true });
    }
  });

  test("a signed clean claim without canonical closure cannot activate the revision", async () => {
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
    expect(recorded.status).toBe(422);
    expect((await recorded.json()).error).toBe("evidence_incomplete");
    expect((await postResult(await fixture(id, "clean"))).status).toBe(422);
    expect((await publicVetting()).state).toBe("queued");
    expect((await vetting.getAssessment(id))?.state).toBe("pending");
    expect((await activate()).status).toBe(422);
    expect((await projects.getProject("open-registry"))?.status).toBe("paused");
  });

  test("the queue binds commits and templates without accepting an unsupported clean claim", async () => {
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
    expect((await postResult(result)).status).toBe(422);
    expect((await publicVetting()).state).toBe("queued");
    // Finish the first pending scan truthfully before requesting another.
    expect((await postResult(await fixture(id, "incomplete"))).status).toBe(
      200,
    );
    livePin = { commitSha: "e".repeat(40), templateSha256: TEMPLATE };
    expect((await activate()).status).toBe(422);
    const rescan = await queueScan();
    expect((await vetting.getAssessment(rescan))?.commitSha).toBe(
      "e".repeat(40),
    );
    expect((await postResult(await fixture(rescan, "clean"))).status).toBe(422);
    expect((await publicVetting()).state).toBe("queued");
    livePin = { commitSha: "e".repeat(40), templateSha256: "f".repeat(64) };
    expect((await activate()).status).toBe(422);
    // The original pending assessment remains pending; no new scan can be
    // queued while the current pin is unreadable.
    livePin = null;
    expect((await publicVetting()).state).toBe("queued");
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
    expect((await postResult(result)).status).toBe(200);
    expect(await publicVetting()).toMatchObject({
      state: "quarantined",
      assessment: { state: "incomplete", heldArtifacts: 1 },
    });
    // The owners get one failed-check notice for this assessment.
    expect(
      sqlite
        .query(
          "SELECT DISTINCT kind, detail, action_path AS path FROM notifications WHERE event_key = ?",
        )
        .all(`project-scan:${id}`),
    ).toEqual([
      {
        kind: "project_scan_failed",
        detail: "Findings in the project repository block clearance.",
        path: "/projects/open-registry",
      },
    ]);
    // Exception evidence stays available until the policy owner closes its case.
    const close = (actor: string, origin = ORIGIN) =>
      retained.evidence.handle(
        new Request(`${ORIGIN}/api/v1/operator/vetting-evidence/${id}/close`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "x-test-operator": actor,
          },
          body: JSON.stringify({
            reason: "Exception investigation is complete",
          }),
        }),
      );
    expect(
      sqlite
        .query(
          "SELECT * FROM vetting_evidence_case_closures WHERE assessment_id=?",
        )
        .get(id),
    ).toBeNull();
    expect(
      (await retained.evidence.run(id, result.environment.runId)).expires_at,
    ).toBeNull();
    expect((await close("900000001"))?.status).toBe(403);
    expect((await close(EVIDENCE_READER_GITHUB_ID))?.status).toBe(403);
    expect(
      (await close(EVIDENCE_OWNER_GITHUB_ID, "https://other.invalid"))?.status,
    ).toBe(403);
    const closed = await close(EVIDENCE_OWNER_GITHUB_ID);
    expect(closed?.status).toBe(200);
    const expiry = new Date(NOW.getTime() + 90 * 86400_000).toISOString();
    expect(await closed?.json()).toMatchObject({
      closedAt: NOW.toISOString(),
      expiresAt: expiry,
    });
    expect(
      (await retained.evidence.run(id, result.environment.runId)).expires_at,
    ).toBe(expiry);
    // A replay must never restart the retention clock.
    retained.evidence.deps.now = () => new Date(NOW.getTime() + 1000);
    expect((await close(EVIDENCE_OWNER_GITHUB_ID))?.status).toBe(200);
    expect(
      (await retained.evidence.run(id, result.environment.runId)).expires_at,
    ).toBe(expiry);
    expect((await vetting.getAssessment(id))?.state).toBe("incomplete");
    const readGrant = () =>
      retained.evidence.handle(
        new Request(
          `${ORIGIN}/api/v1/operator/vetting-evidence/${id}/${result.environment.runId}/${result.traceSha256}/grant`,
          {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "content-type": "application/json",
              "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
            },
            body: JSON.stringify({
              reason: "Verify the closed-case access boundary",
            }),
          },
        ),
      );
    retained.evidence.deps.now = () => new Date(Date.parse(expiry) - 1);
    expect((await readGrant())?.status).toBe(201);
    retained.evidence.deps.now = () => new Date(expiry);
    expect((await readGrant())?.status).toBe(410);
    retained.evidence.deps.now = () => NOW;
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
            // Awards carry GitHub node IDs; membership joins by numeric ID.
            award: {
              actor: {
                id: btoa(
                  `04:User${
                    {
                      known: "900000010",
                      reversed: "900000011",
                      other: "900000012",
                      unresolved: "900000099",
                    }[actor]
                  }`,
                ),
              },
              projectId: project,
              amount,
            },
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
    expect((await postResult(await fixture(rescan, "clean"))).status).toBe(422);
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

test("private retained bytes remain inspectable without granting clean clearance", async () => {
  await listPausedProject();
  const id = await queueScan();
  const result = await fixture(id, "clean");
  const run = result.environment.runId;
  const base = `/api/v1/operator/vetting-evidence/${id}/${run}/${result.traceSha256}`;
  const key = await selectedEvidenceKey(id, run, result.traceSha256);
  const operator = async (
    path: string,
    actor = EVIDENCE_OWNER_GITHUB_ID,
    body?: unknown,
    grant?: string,
    expectedActor?: string,
  ) =>
    (await retained.evidence.handle(
      new Request(`${ORIGIN}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "x-test-operator": actor,
          ...(expectedActor === undefined
            ? {}
            : { "x-slop-expected-github-id": expectedActor }),
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
  const countsBeforeMismatch = {
    grants: sqlite
      .query("SELECT COUNT(*) n FROM vetting_evidence_grants")
      .get(),
    audits: sqlite.query("SELECT COUNT(*) n FROM vetting_evidence_audit").get(),
  };
  for (const path of [overview, `${base}/grant`, `${base}/download-grant`]) {
    const response = await operator(
      path,
      EVIDENCE_READER_GITHUB_ID,
      path === overview
        ? undefined
        : { reason: "Inspect expected-actor refusal" },
      undefined,
      EVIDENCE_OWNER_GITHUB_ID,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("actor_changed");
  }
  expect(
    sqlite.query("SELECT COUNT(*) n FROM vetting_evidence_grants").get(),
  ).toEqual(countsBeforeMismatch.grants);
  expect(
    sqlite.query("SELECT COUNT(*) n FROM vetting_evidence_audit").get(),
  ).toEqual(countsBeforeMismatch.audits);
  const malformedExpected = await operator(
    overview,
    undefined,
    undefined,
    undefined,
    "invalid",
  );
  expect(malformedExpected.status).toBe(400);
  expect((await malformedExpected.json()).error).toBe("invalid_expected_actor");
  const matchingExpected = await operator(
    overview,
    undefined,
    undefined,
    undefined,
    EVIDENCE_OWNER_GITHUB_ID,
  );
  expect(matchingExpected.status).toBe(200);
  const visible = await operator(overview);
  expect(visible.status).toBe(200);
  expect(await visible.text()).not.toContain(VETTING_TRACE_BODY);
  const grantResponse = await operator(`${base}/grant`, undefined, {
    reason: "Inspect recorded collector evidence",
  });
  expect(grantResponse.status).toBe(201);
  const grantedAccess = await grantResponse.json();
  expect(grantedAccess.expiresInSeconds).toBe(900);
  const grant = grantedAccess.grant;
  const reads = await Promise.all([
    operator(`${base}/body`, undefined, undefined, grant),
    operator(`${base}/body`, undefined, undefined, grant),
  ]);
  expect(reads.map((r) => r.status).sort()).toEqual([200, 403]);
  const read = reads.find((r) => r.ok)!;
  expect(await read.text()).toBe(VETTING_TRACE_BODY);
  expect(read.headers.get("cache-control")).toBe("private, no-store");
  // Read grants expire independently of the stored run's access window.
  const timedGrant = async () =>
    (
      await (
        await operator(`${base}/grant`, undefined, {
          reason: "Inspect the approved read access window",
        })
      ).json()
    ).grant;
  const beforeExpiry = await timedGrant();
  const atExpiry = await timedGrant();
  retained.evidence.deps.now = () => new Date(NOW.getTime() + 899_000);
  expect(
    await (
      await operator(`${base}/body`, undefined, undefined, beforeExpiry)
    ).text(),
  ).toBe(VETTING_TRACE_BODY);
  retained.evidence.deps.now = () => new Date(NOW.getTime() + 900_000);
  expect(
    (await operator(`${base}/body`, undefined, undefined, atExpiry)).status,
  ).toBe(403);
  const renewedGrant = await timedGrant();
  expect(
    await (
      await operator(`${base}/body`, undefined, undefined, renewedGrant)
    ).text(),
  ).toBe(VETTING_TRACE_BODY);

  expect((await publicVetting()).state).toBe("queued");
  await retained.bucket.delete(key);
  expect(
    (
      await operator(`${base}/grant`, undefined, {
        reason: "Inspect absent collector evidence",
      })
    ).status,
  ).toBe(404);
  expect((await publicVetting()).state).toBe("queued");
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
  expect((await publicVetting()).state).toBe("queued");
  await retained.bucket.delete(key);
  await retained.retain(id, run);
  expect((await publicVetting()).state).toBe("queued");
  retained.evidence.deps.now = () => new Date(NOW.getTime() + 3600_001);
  expect(
    (
      await operator(`${base}/grant`, undefined, {
        reason: "Inspect evidence while the case is still open",
      })
    ).status,
  ).toBe(201);
  expect((await publicVetting()).state).toBe("queued");
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
    await selectedEvidenceKey(id, run, result.artifacts[0].sha256),
  );
  expect((await postResult(result)).status).toBe(422);
  expect((await publicVetting()).state).toBe("queued");
  await retained.retain(id, run);
  expect((await postResult(result)).status).toBe(422);
  expect((await publicVetting()).state).toBe("queued");
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
  retained.evidence.deps.bucket = undefined;
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
          "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
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
    actor = EVIDENCE_OWNER_GITHUB_ID,
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
  expect(cookie).toContain("Max-Age=900;");
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
  expect(accepted.headers.has("set-cookie")).toBe(false);
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
    await selectedEvidenceKey(id, runId, digest, chunks[1]),
  );
  await expect(interruptedReader.read()).rejects.toThrow(
    "Declared evidence bytes are missing",
  );
  expect((await grant()).status).toBe(404);
}, 60_000);

test("evidence beyond the former 64 MiB run cap is stored once by digest, in bounded parts, and referenced by later runs", async () => {
  await listPausedProject();
  const id = await queueScan();
  retained.evidence.deps.signed = (request, maximum) =>
    signedVettingRequest(
      request,
      { resultPublicKeys: keys.publicKey, now: () => NOW },
      maximum,
    );
  const hash = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  // 72 MiB in one object plus a second object: above every former limit.
  const big = new Uint8Array(72 * 1024 * 1024);
  for (let offset = 0; offset < big.length; offset += 4096)
    big[offset] = (offset / 4096) % 251;
  const small = new TextEncoder().encode('{"report":true}');
  const layout = [];
  for (let offset = 0; offset < big.length; offset += EVIDENCE_CHUNK_BYTES) {
    const part = big.subarray(offset, offset + EVIDENCE_CHUNK_BYTES);
    layout.push({
      index: layout.length,
      sha256: hash(part),
      sizeBytes: part.length,
    });
  }
  const bigSha = hash(big),
    smallSha = hash(small);
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
    traceSha256: smallSha,
    objects: [
      {
        sha256: smallSha,
        sizeBytes: small.length,
        kind: "trace",
        label: "Scan report",
        contentType: "application/json",
      },
      {
        sha256: bigSha,
        sizeBytes: big.length,
        kind: "artifact",
        label: "Large committed binary",
        contentType: "application/octet-stream",
        chunks: layout,
      },
    ],
  });
  const first = `/api/v1/vetting/evidence/${id}/large-first`;
  const registered = await send("POST", first, manifest);
  expect(registered.status).toBe(201);
  expect((await registered.json()).stored).toEqual([]);
  expect((await send("PUT", `${first}/${smallSha}`, small)).status).toBe(200);
  // A part above 8 MiB is refused; each request carries at most one part.
  expect(
    (
      await send(
        "PUT",
        `${first}/${bigSha}/chunks/0`,
        big.subarray(0, EVIDENCE_CHUNK_BYTES + 1),
      )
    ).status,
  ).toBe(413);
  for (const part of layout.slice(0, -1))
    expect(
      (
        await send(
          "PUT",
          `${first}/${bigSha}/chunks/${part.index}`,
          big.subarray(
            part.index * EVIDENCE_CHUNK_BYTES,
            part.index * EVIDENCE_CHUNK_BYTES + part.sizeBytes,
          ),
        )
      ).status,
    ).toBe(200);
  // A partial upload cannot complete.
  expect((await send("POST", `${first}/${bigSha}/finalize`, "{}")).status).toBe(
    404,
  );
  const last = layout[layout.length - 1];
  expect(
    (
      await send(
        "PUT",
        `${first}/${bigSha}/chunks/${last.index}`,
        big.subarray(last.index * EVIDENCE_CHUNK_BYTES),
      )
    ).status,
  ).toBe(200);
  expect((await send("POST", `${first}/${bigSha}/finalize`, "{}")).status).toBe(
    200,
  );
  // One published target in the row's storage generation, never a run root.
  const smallKey = await selectedEvidenceKey(id, "large-first", smallSha);
  expect(await retained.bucket.head(smallKey)).not.toBeNull();
  expect(
    await retained.bucket.head(`vetting/${id}/large-first/${smallSha}`),
  ).toBeNull();
  // A later run declaring the same digests references the stored copy.
  const second = `/api/v1/vetting/evidence/${id}/large-second`;
  const referenced = await send("POST", second, manifest);
  expect(referenced.status).toBe(201);
  expect((await referenced.json()).stored.sort()).toEqual(
    [bigSha, smallSha].sort(),
  );
  expect(
    (await send("POST", `${second}/${bigSha}/finalize`, "{}")).status,
  ).toBe(200);
  const sharedGeneration = (await evidenceStorageRow(id, "large-first", bigSha))
    .storage_generation;
  expect(typeof sharedGeneration).toBe("string");
  const rows = sqlite
    .query(
      "SELECT run_id, storage, storage_generation FROM vetting_evidence_objects WHERE assessment_id=? AND sha256=? ORDER BY run_id",
    )
    .all(id, bigSha);
  expect(rows).toEqual([
    {
      run_id: "large-first",
      storage: "content",
      storage_generation: sharedGeneration,
    },
    {
      run_id: "large-second",
      storage: "content",
      storage_generation: sharedGeneration,
    },
  ]);
  expect(await selectedEvidenceKey(id, "large-second", smallSha)).toBe(
    smallKey,
  );
  // A changed stored part fails verification for every run that references it.
  const partKey = await selectedEvidenceKey(
    id,
    "large-first",
    bigSha,
    layout[3],
  );
  await retained.bucket.delete(partKey);
  const changed = new Uint8Array(layout[3].sizeBytes);
  await retained.bucket.put(partKey, changed, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { sha256: layout[3].sha256 },
  });
  const third = `/api/v1/vetting/evidence/${id}/large-third`;
  const rechecked = await send("POST", third, manifest);
  expect(rechecked.status).toBe(201);
  // The changed copy is not offered for reference.
  expect((await rechecked.json()).stored).toEqual([smallSha]);
  expect((await send("POST", `${third}/${bigSha}/finalize`, "{}")).status).toBe(
    409,
  );
  expect(
    sqlite
      .query(
        "SELECT count(*) AS n FROM vetting_evidence_completions WHERE run_id='large-third'",
      )
      .get(),
  ).toEqual({ n: 0 });
  // Uploading the verified part again repairs the shared copy.
  expect(
    (
      await send(
        "PUT",
        `${third}/${bigSha}/chunks/3`,
        big.subarray(
          3 * EVIDENCE_CHUNK_BYTES,
          3 * EVIDENCE_CHUNK_BYTES + layout[3].sizeBytes,
        ),
      )
    ).status,
  ).toBe(200);
  expect((await send("POST", `${third}/${bigSha}/finalize`, "{}")).status).toBe(
    200,
  );
  const repairedKey = await selectedEvidenceKey(
    id,
    "large-third",
    bigSha,
    layout[3],
  );
  expect(repairedKey).not.toBe(partKey);
  expect(await selectedEvidenceKey(id, "large-first", bigSha, layout[3])).toBe(
    repairedKey,
  );
  expect(await selectedEvidenceKey(id, "large-second", bigSha, layout[3])).toBe(
    repairedKey,
  );
  expect(
    new Uint8Array(await (await retained.bucket.get(partKey))!.arrayBuffer()),
  ).toEqual(changed);
}, 120_000);

/** #1411 C-09: the scanner controller records its publication state through the
 * signed service, so the protected job holds no database credential of its own. */
test("the journal route reserves and completes one publication per assessment", async () => {
  await listPausedProject();
  const id = await queueScan();
  const intent = {
    assessmentId: id,
    resultSha256: "a".repeat(64),
    origin: ORIGIN,
    disposition: "incomplete",
  };
  const post = async (payload: unknown) =>
    vettingApi(
      await signed("POST", "vetting/journal", JSON.stringify(payload)),
    );

  const before = await post({ operation: "has", assessmentId: id });
  expect(before.status).toBe(200);
  expect(await before.json()).toEqual({
    schemaVersion: "slop-vetting-journal-v1",
    present: false,
  });

  expect((await post({ operation: "reserve", ...intent })).status).toBe(200);
  expect((await post({ operation: "reserve", ...intent })).status).toBe(409);

  const after = await post({ operation: "has", assessmentId: id });
  expect(await after.json()).toEqual({
    schemaVersion: "slop-vetting-journal-v1",
    present: true,
  });

  const receipt = {
    operation: "complete",
    ...intent,
    outcome: "unknown",
    httpStatus: null,
  };
  expect((await post(receipt)).status).toBe(200);
  // One receipt per assessment, and it must match the reserved intent.
  expect((await post(receipt)).status).toBe(409);
  expect(
    (await post({ ...receipt, resultSha256: "c".repeat(64) })).status,
  ).toBe(422);
  // An unsupported operation, an unknown assessment and an unsigned call are refused.
  expect((await post({ operation: "purge", ...intent })).status).toBe(400);
  expect(
    (
      await post({
        operation: "reserve",
        ...intent,
        assessmentId: "vet_deadbeef",
      })
    ).status,
  ).toBe(404);
  // Unknown fields are refused, like the sibling signed routes.
  expect(
    (await post({ operation: "has", assessmentId: id, extra: 1 })).status,
  ).toBe(400);
  const unsigned = await vettingApi(
    new Request(`${ORIGIN}/api/v1/vetting/journal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "has", assessmentId: id }),
    }),
  );
  expect(unsigned.status).toBe(401);
}, 60_000);

/** #1411 C-09 review: two controllers racing one intent — exactly one reserve wins. */
test("only one of two concurrent journal reservations of one assessment is accepted", async () => {
  await listPausedProject();
  const id = await queueScan();
  const intent = {
    assessmentId: id,
    resultSha256: "e".repeat(64),
    origin: ORIGIN,
    disposition: "incomplete",
  };
  const post = async (payload: unknown) =>
    vettingApi(
      await signed("POST", "vetting/journal", JSON.stringify(payload)),
    );
  const settled = await Promise.allSettled([
    post({ operation: "reserve", ...intent }),
    post({ operation: "reserve", ...intent }),
  ]);
  const statuses = settled
    .map((result) => (result.status === "fulfilled" ? result.value.status : -1))
    .sort((left, right) => left - right);
  expect(statuses).toEqual([200, 409]);
  const after = await post({ operation: "has", assessmentId: id });
  expect(await after.json()).toEqual({
    schemaVersion: "slop-vetting-journal-v1",
    present: true,
  });
}, 60_000);

/** #1411 C-09 review: the reservation must outlive a reply the client never saw. */
test("a reservation whose reply is lost is still read as present by the next run", async () => {
  await listPausedProject();
  const id = await queueScan();
  const intent = {
    assessmentId: id,
    resultSha256: "f".repeat(64),
    origin: ORIGIN,
    disposition: "incomplete" as const,
  };
  const signer = {
    privateKey: keys.privateKey,
    publicKey: await crypto.subtle.importKey(
      "raw",
      keys.raw,
      { name: "Ed25519" },
      true,
      ["verify"],
    ),
  };
  const forwarding = servicePublicationJournal({
    origin: ORIGIN,
    signer,
    now: () => NOW,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const response = await vettingApi(
        new Request(input instanceof Request ? input : String(input), init),
      );
      expect(response.status).toBe(200);
      throw new Error("journal reply lost in transit");
    }) as unknown as typeof fetch,
  });
  await expect(forwarding.reserve(intent)).rejects.toThrow(
    "journal reply lost in transit",
  );
  // The next controller run reads the intent the lost reply could not confirm.
  const nextRun = servicePublicationJournal({
    origin: ORIGIN,
    signer,
    now: () => NOW,
    fetch: (async (input: string | URL | Request, init?: RequestInit) =>
      vettingApi(
        new Request(input instanceof Request ? input : String(input), init),
      )) as unknown as typeof fetch,
  });
  expect(await nextRun.has(id)).toBe(true);
}, 60_000);

test("a delayed native download response cannot clear a newer same-object grant", async () => {
  await listPausedProject();
  const id = await queueScan();
  const runId = "download-cookie-ownership";
  await retained.retain(id, runId);
  const path = `/api/v1/operator/vetting-evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
  const grant = async () => {
    const response = await retained.evidence.handle(
      new Request(`${ORIGIN}${path}/download-grant`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
        },
        body: JSON.stringify({
          reason: "Inspect retained download retry evidence",
        }),
      }),
    );
    expect(response?.status).toBe(201);
    const cookie = response?.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing synthetic download grant");
    return cookie;
  };
  const download = (cookie: string) =>
    retained.evidence.handle(
      new Request(`${ORIGIN}${path}/download`, {
        headers: {
          cookie,
          "sec-fetch-site": "same-origin",
          "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
        },
      }),
    );
  let started: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  let resume: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const audit = retained.evidence.audit.bind(retained.evidence);
  let holdFirst = true;
  retained.evidence.audit = async (...args) => {
    if (args[1] === "download-authorized" && holdFirst) {
      holdFirst = false;
      started();
      await gate;
    }
    return audit(...args);
  };
  let oldResponse: Promise<Response | null> | undefined;
  try {
    const oldCookie = await grant();
    oldResponse = download(oldCookie);
    await waiting;
    // The browser has already accepted this newer Set-Cookie when the first
    // response finally arrives. Only issuance may mutate that cookie slot.
    const newCookie = await grant();
    expect(newCookie).not.toBe(oldCookie);
    resume();
    const old = await oldResponse;
    expect(old?.status).toBe(200);
    expect(old?.headers.has("set-cookie")).toBe(false);
    await old?.body?.cancel();
    const current = await download(newCookie);
    expect(current?.status).toBe(200);
    expect(await current?.text()).toBe(VETTING_TRACE_BODY);
    expect(current?.headers.has("set-cookie")).toBe(false);
    const replay = await download(newCookie);
    expect(replay?.status).toBe(403);
    expect(replay?.headers.has("set-cookie")).toBe(false);
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) n FROM vetting_evidence_grants WHERE consumed_at IS NOT NULL",
        )
        .get(),
    ).toEqual({ n: 2 });
  } finally {
    resume();
    await oldResponse
      ?.then((response) => response?.body?.cancel())
      .catch(() => undefined);
    retained.evidence.audit = audit;
  }
}, 30000);

// PRD8: cancellation while the final audit is pending is one terminal stream
// outcome. It must not append both a cancelled and a finished receipt.
test("download cancellation during final audit records one terminal outcome", async () => {
  await listPausedProject();
  const id = await queueScan();
  const runId = "download-terminal-race";
  await retained.retain(id, runId);
  const path = `/api/v1/operator/vetting-evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
  const grant = await retained.evidence.handle(
    new Request(`${ORIGIN}${path}/download-grant`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
      },
      body: JSON.stringify({ reason: "Check the terminal stream audit race" }),
    }),
  );
  expect(grant?.status).toBe(201);
  const cookie = grant?.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Missing synthetic download grant");
  const response = await retained.evidence.handle(
    new Request(`${ORIGIN}${path}/download`, {
      headers: {
        cookie,
        "sec-fetch-site": "same-origin",
        "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
      },
    }),
  );
  if (!response?.body) throw new Error("Missing download stream");
  const reader = response.body.getReader();
  expect((await reader.read()).done).toBe(false);
  let finishStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    finishStarted = resolve;
  });
  let continueFinish: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    continueFinish = resolve;
  });
  let finishSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    finishSettled = resolve;
  });
  const audit = retained.evidence.audit.bind(retained.evidence);
  retained.evidence.audit = async (...args) => {
    if (args[1] === "download-finished") {
      finishStarted();
      await gate;
    }
    try {
      return await audit(...args);
    } finally {
      if (args[1] === "download-finished") finishSettled();
    }
  };
  const finalRead = reader.read();
  try {
    await started;
    await reader.cancel();
  } finally {
    continueFinish();
    retained.evidence.audit = audit;
  }
  await finalRead;
  await settled;
  const outcomes = sqlite
    .query(
      "SELECT action FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action IN ('download-finished','download-cancelled') ORDER BY action",
    )
    .all(id, runId);
  expect(outcomes).toHaveLength(1);
}, 30000);

for (const boundary of ["r2", "read-audit"] as const) {
  test(`buffered evidence refuses a session revoked during ${boundary}`, async () => {
    await listPausedProject();
    const id = await queueScan();
    const runId = `buffered-session-revoked-${boundary}`;
    await retained.retain(id, runId);
    const token = `buffered_evidence_session_${boundary}_${"a".repeat(40)}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const actorId = `buffered-evidence-operator-${boundary}`;
    sqlite.run(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
      [
        actorId,
        EVIDENCE_OWNER_GITHUB_ID,
        "fixture-operator",
        new Date().toISOString(),
      ],
    );
    sqlite.run(
      "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
      [tokenHash, actorId, new Date(Date.now() + 3600000).toISOString()],
    );
    const storage = retained.evidence.deps.bucket;
    if (!storage) throw new Error("Missing local R2 storage");
    const db = retained.evidence.deps.db;
    const prepare = db.prepare.bind(db);
    let hold = false;
    let signalStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let resume: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    db.prepare = (sql) => {
      const statement = prepare(sql);
      if (!sql.startsWith("INSERT INTO vetting_evidence_audit"))
        return statement;
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        const bound = bind(...values);
        if (values[2] !== "read") return bound;
        const run = bound.run.bind(bound);
        bound.run = async () => {
          if (hold && boundary === "read-audit") {
            signalStarted();
            await gate;
          }
          return run();
        };
        return bound;
      };
      return statement;
    };
    const env = {
      SLOP_DB: db,
      TRACE_AUTH_SECRET: "test-only-trace-rate-limit-secret-long-enough",
      VETTING_EVIDENCE: {
        head: storage.head.bind(storage),
        put: storage.put.bind(storage),
        async get(key: string) {
          if (hold && boundary === "r2") {
            signalStarted();
            await gate;
          }
          return storage.get(key);
        },
      },
    } as unknown as Parameters<typeof onRequest>[0]["env"];
    const path = `/api/v1/operator/vetting-evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
    const cookie = `__Host-slop_points=${token}`;
    let reading: Promise<Response> | undefined;
    try {
      const grant = await onRequest({
        env,
        request: new Request(`${ORIGIN}${path}/grant`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            reason: "Check buffered private read ownership",
          }),
        }),
      });
      expect(grant.status).toBe(201);
      const granted = (await grant.json()) as { grant: string };
      hold = true;
      reading = onRequest({
        env,
        request: new Request(`${ORIGIN}${path}/body`, {
          headers: { cookie, "x-vetting-read-grant": granted.grant },
        }),
      });
      await started;
      const signout = await onRequest({
        env,
        request: new Request(`${ORIGIN}/api/v1/points/signout`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            cookie,
          },
          body: "{}",
        }),
      });
      expect(signout.status).toBe(200);
      expect(
        sqlite
          .query("SELECT COUNT(*) n FROM points_sessions WHERE token_hash=?")
          .get(tokenHash),
      ).toEqual({ n: 0 });
      resume();
      const response = await reading;
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(VETTING_TRACE_BODY);
      expect(
        sqlite
          .query(
            "SELECT consumed_at IS NOT NULL AS used FROM vetting_evidence_grants",
          )
          .get(),
      ).toEqual({ used: 1 });
    } finally {
      resume();
      await reading?.catch(() => undefined);
      db.prepare = prepare;
    }
  }, 30000);
}

test("evidence inventory refuses a session revoked after its list audit commits", async () => {
  await listPausedProject();
  const id = await queueScan();
  const runId = "inventory-session-revoked";
  await retained.retain(id, runId);
  const token = `inventory_evidence_session_${"a".repeat(40)}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const actorId = "inventory-evidence-operator";
  sqlite.run(
    "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
    [
      actorId,
      EVIDENCE_OWNER_GITHUB_ID,
      "fixture-operator",
      new Date().toISOString(),
    ],
  );
  sqlite.run(
    "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
    [tokenHash, actorId, new Date(Date.now() + 3600000).toISOString()],
  );
  const db = retained.evidence.deps.db;
  const prepare = db.prepare.bind(db);
  let signalStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  let resume: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (!sql.startsWith("INSERT INTO vetting_evidence_audit")) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = bind(...values);
      if (values[2] !== "list") return bound;
      const run = bound.run.bind(bound);
      bound.run = async () => {
        const result = await run();
        signalStarted();
        await gate;
        return result;
      };
      return bound;
    };
    return statement;
  };
  const env = {
    SLOP_DB: db,
    TRACE_AUTH_SECRET: "test-only-trace-rate-limit-secret-long-enough",
    VETTING_EVIDENCE: retained.evidence.deps.bucket,
  } as unknown as Parameters<typeof onRequest>[0]["env"];
  const cookie = `__Host-slop_points=${token}`;
  let pending: Promise<Response> | undefined;
  try {
    pending = onRequest({
      env,
      request: new Request(
        `${ORIGIN}/api/v1/operator/vetting-evidence?assessmentId=${id}&runId=${runId}`,
        { headers: { cookie } },
      ),
    });
    await started;
    const signout = await onRequest({
      env,
      request: new Request(`${ORIGIN}/api/v1/points/signout`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          cookie,
        },
        body: "{}",
      }),
    });
    expect(signout.status).toBe(200);
    expect(
      sqlite
        .query("SELECT COUNT(*) n FROM points_sessions WHERE token_hash=?")
        .get(tokenHash),
    ).toEqual({ n: 0 });
    resume();
    const response = await pending;
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).not.toContain(runId);
    expect(body).not.toContain(VETTING_TRACE_SHA);
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) n FROM vetting_evidence_audit WHERE action='list' AND actor=?",
        )
        .get(EVIDENCE_OWNER_GITHUB_ID),
    ).toEqual({ n: 1 });
  } finally {
    resume();
    await pending?.catch(() => undefined);
    db.prepare = prepare;
  }
}, 30000);

// EVIDENCE.md requires current authorization for each streamed part. Use the
// real Pages session resolver and signout mutation while a local R2 read waits.
test("native evidence download stops when its session is revoked during a part read", async () => {
  await listPausedProject();
  const id = await queueScan();
  const runId = "download-session-revoked";
  await retained.retain(id, runId);
  const token = `native_evidence_session_${"a".repeat(40)}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const actorId = "native-evidence-operator";
  sqlite.run(
    "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
    [
      actorId,
      EVIDENCE_OWNER_GITHUB_ID,
      "fixture-operator",
      new Date().toISOString(),
    ],
  );
  sqlite.run(
    "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
    [tokenHash, actorId, new Date(Date.now() + 3600000).toISOString()],
  );
  const storage = retained.evidence.deps.bucket;
  if (!storage) throw new Error("Missing local R2 storage");
  let waitForRead = false;
  let readStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  let resumeRead: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    resumeRead = resolve;
  });
  const env = {
    SLOP_DB: retained.evidence.deps.db,
    TRACE_AUTH_SECRET: "test-only-trace-rate-limit-secret-long-enough",
    VETTING_EVIDENCE: {
      head: storage.head.bind(storage),
      put: storage.put.bind(storage),
      async get(key: string) {
        if (waitForRead) {
          readStarted();
          await gate;
        }
        return storage.get(key);
      },
    },
  } as unknown as Parameters<typeof onRequest>[0]["env"];
  const path = `/api/v1/operator/vetting-evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
  const sessionCookie = `__Host-slop_points=${token}`;
  const grant = await onRequest({
    env,
    request: new Request(`${ORIGIN}${path}/download-grant`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({
        reason: "Check signout during the native evidence transfer",
      }),
    }),
  });
  expect(grant.status).toBe(201);
  const grantCookie = grant.headers.get("set-cookie")?.split(";")[0];
  if (!grantCookie) throw new Error("Missing native read grant");
  const response = await onRequest({
    env,
    request: new Request(`${ORIGIN}${path}/download`, {
      headers: {
        cookie: `${sessionCookie}; ${grantCookie}`,
        "sec-fetch-site": "same-origin",
      },
    }),
  });
  expect(response.status).toBe(200);
  if (!response.body) throw new Error("Missing native evidence stream");
  waitForRead = true;
  const reader = response.body.getReader();
  const reading = reader.read();
  try {
    await started;
    const signout = await onRequest({
      env,
      request: new Request(`${ORIGIN}/api/v1/points/signout`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          cookie: sessionCookie,
        },
        body: "{}",
      }),
    });
    expect(signout.status).toBe(200);
    expect(
      sqlite
        .query("SELECT COUNT(*) n FROM points_sessions WHERE token_hash=?")
        .get(tokenHash),
    ).toEqual({ n: 0 });
  } finally {
    resumeRead();
  }
  await expect(reading).rejects.toThrow("Sign in with GitHub");
  expect(
    sqlite
      .query(
        "SELECT consumed_at IS NOT NULL AS used FROM vetting_evidence_grants",
      )
      .get(),
  ).toEqual({ used: 1 });
  expect(
    sqlite
      .query(
        "SELECT action FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action LIKE 'download-%' ORDER BY created_at,id",
      )
      .all(id, runId)
      .some(
        (row) => (row as { action: string }).action === "download-finished",
      ),
  ).toBe(false);
}, 30000);

for (const changed of [false, true]) {
  test(`concurrent evidence registration ${changed ? "rejects changed bytes" : "replays identical bytes"} atomically`, async () => {
    await listPausedProject();
    const id = await queueScan();
    const runId = "concurrent-registration";
    const path = `/api/v1/vetting/evidence/${id}/${runId}`;
    const manifest = {
      traceSha256: VETTING_TRACE_SHA,
      objects: VETTING_EVIDENCE_OBJECTS.map(
        ({ body: _body, ...object }) => object,
      ),
    };
    const firstBody = JSON.stringify(manifest);
    const secondBody = JSON.stringify(
      changed
        ? {
            ...manifest,
            objects: manifest.objects.map((object) => ({
              ...object,
              label: `${object.label} revised`,
            })),
          }
        : manifest,
    );
    const make = (body: string) => retained.request("POST", path, body);
    const requests = await Promise.all([make(firstBody), make(secondBody)]);
    const db = retained.evidence.deps.db;
    const batch = db.batch.bind(db);
    let entered = 0;
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    db.batch = async (statements) => {
      entered++;
      if (entered === 1) await gate;
      try {
        return await batch(statements);
      } finally {
        if (entered === 2) releaseFirst();
      }
    };
    try {
      const responses = await Promise.all(
        requests.map((request) => retained.evidence.handle(request)),
      );
      expect(entered).toBe(2);
      expect(responses.map((response) => response?.status).sort()).toEqual(
        changed ? [201, 409] : [200, 201],
      );
      expect(
        sqlite
          .query(
            "SELECT COUNT(*) n FROM vetting_evidence_runs WHERE assessment_id=? AND run_id=?",
          )
          .get(id, runId),
      ).toEqual({ n: 1 });
      expect(
        sqlite
          .query(
            "SELECT COUNT(*) n FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action='register'",
          )
          .get(id, runId),
      ).toEqual({ n: 1 });
    } finally {
      releaseFirst();
      db.batch = batch;
    }
  }, 30000);
}

// The real evidence route owns an R2 response even when its metadata or
// stream fails. Inject faults around the local R2 body after granting access;
// never replace the stored evidence or bypass the one-use grant/audit flow.
for (const failure of [
  "metadata",
  "retirement-marker",
  "overflow",
  "read",
] as const) {
  test(`evidence ${failure} refusal releases its body and preserves the original error`, async () => {
    await listPausedProject();
    const id = await queueScan();
    const runId = `reader-cleanup-${failure}`;
    await retained.retain(id, runId);
    const path = `/api/v1/operator/vetting-evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
    const request = (suffix: string, grant?: string) =>
      new Request(`${ORIGIN}${path}/${suffix}`, {
        method: grant ? "GET" : "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
          ...(grant ? { "x-vetting-read-grant": grant } : {}),
        },
        ...(grant
          ? {}
          : {
              body: JSON.stringify({
                reason: "Verify evidence reader cleanup",
              }),
            }),
      });
    const granted = await retained.evidence.handle(request("grant"));
    expect(granted?.status).toBe(201);
    const { grant } = await granted!.json();
    const bucket = retained.evidence.deps.bucket!;
    let body: ReadableStream<Uint8Array> | undefined;
    let bodyPulls = 0;
    let bodyCancels = 0;
    let nativeReleased = false;
    const readError = Object.assign(
      new Error("Injected evidence read failure"),
      {
        status: 409,
        code: "evidence_read_fixture",
      },
    );
    retained.evidence.deps.bucket = {
      ...bucket,
      get: async (key) => {
        const object = await bucket.get(key);
        if (!object) return null;
        const reader = object.body.getReader();
        const release = () => {
          if (!nativeReleased) {
            reader.releaseLock();
            nativeReleased = true;
          }
        };
        body = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              bodyPulls++;
              if (failure === "read") {
                try {
                  await reader.cancel();
                } finally {
                  release();
                }
                controller.error(readError);
                return;
              }
              const part = await reader.read();
              if (part.done) {
                release();
                controller.close();
              } else if (failure === "overflow") {
                controller.enqueue(new Uint8Array(object.size + 1));
              } else controller.enqueue(part.value);
            },
            async cancel() {
              bodyCancels++;
              try {
                await reader.cancel();
              } finally {
                release();
              }
              throw new Error(
                "Injected cleanup failure must not replace refusal",
              );
            },
          },
          { highWaterMark: 0 },
        );
        return {
          ...object,
          size: failure === "metadata" ? object.size + 1 : object.size,
          ...(failure === "retirement-marker"
            ? {
                customMetadata: {
                  ...object.customMetadata,
                  [EVIDENCE_RETIREMENT_METADATA_KEY]:
                    EVIDENCE_RETIREMENT_METADATA_VALUE,
                },
              }
            : {}),
          body,
        };
      },
    };
    try {
      const response = await retained.evidence.handle(request("body", grant));
      expect(response?.status).toBe(
        failure === "retirement-marker" ? 410 : 409,
      );
      const result = await response!.json();
      expect(result.error).toBe(
        failure === "read"
          ? "evidence_read_fixture"
          : failure === "retirement-marker"
            ? "evidence_retired"
            : "evidence_corrupt",
      );
      expect(JSON.stringify(result)).not.toContain(VETTING_TRACE_BODY);
      expect(body?.locked).toBe(false);
      expect(nativeReleased).toBe(true);
      expect(bodyPulls).toBe(
        failure === "metadata" || failure === "retirement-marker" ? 0 : 1,
      );
      // An already errored stream rejects cancel without invoking its source.
      expect(bodyCancels).toBe(failure === "read" ? 0 : 1);
      const replay = await retained.evidence.handle(request("body", grant));
      expect(replay?.status).toBe(403);
      const actions = sqlite
        .query(
          "SELECT action FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=?",
        )
        .all(id, runId) as { action: string }[];
      expect(
        actions.filter((row) => row.action === "read-attempt"),
      ).toHaveLength(1);
      expect(actions.some((row) => row.action === "read")).toBe(false);
    } finally {
      retained.evidence.deps.bucket = bucket;
      if (body && !body.locked) await body.cancel().catch(() => {});
    }
  }, 30000);
}

test("native evidence download refuses a retirement marker even when bytes and digest still match", async () => {
  await listPausedProject();
  const id = await queueScan();
  const runId = "native-retirement-marker";
  await retained.retain(id, runId);
  const path = `/api/v1/operator/vetting-evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
  const granted = await retained.evidence.handle(
    new Request(`${ORIGIN}${path}/download-grant`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
      },
      body: JSON.stringify({ reason: "Verify retired-target refusal" }),
    }),
  );
  expect(granted?.status).toBe(201);
  const cookie = granted!.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Missing synthetic download grant");
  const bucket = retained.evidence.deps.bucket!;
  retained.evidence.deps.bucket = {
    ...bucket,
    get: async (key) => {
      const object = await bucket.get(key);
      return object
        ? {
            ...object,
            customMetadata: {
              ...object.customMetadata,
              [EVIDENCE_RETIREMENT_METADATA_KEY]:
                EVIDENCE_RETIREMENT_METADATA_VALUE,
            },
          }
        : null;
    },
  };
  try {
    const response = await retained.evidence.handle(
      new Request(`${ORIGIN}${path}/download`, {
        headers: {
          cookie,
          "sec-fetch-site": "same-origin",
          "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
        },
      }),
    );
    expect(response?.status).toBe(200);
    await expect(response!.arrayBuffer()).rejects.toThrow();
    const actions = sqlite
      .query(
        "SELECT action FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action LIKE 'download-%' ORDER BY action",
      )
      .all(id, runId);
    expect(actions).toEqual([
      { action: "download-authorized" },
      { action: "download-failed" },
    ]);
  } finally {
    retained.evidence.deps.bucket = bucket;
  }
}, 30000);

test("legacy content refuses unavailable reads and repairs only verified corruption", async () => {
  const runId = "content-repair-classification";
  const id = await legacyContentRun(runId);
  const path = `/api/v1/vetting/evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
  const key = await selectedEvidenceKey(id, runId, VETTING_TRACE_SHA);
  const bytes = new TextEncoder().encode(VETTING_TRACE_BODY);
  const bucket = retained.evidence.deps.bucket!;
  const writes: boolean[] = [];
  const repairEtags: string[] = [];
  let unavailable = true;
  const uploadAudits = () =>
    sqlite
      .query(
        "SELECT count(*) AS n FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action='upload'",
      )
      .get(id, runId);
  const before = uploadAudits();
  retained.evidence.deps.bucket = {
    ...bucket,
    put: async (target, value, options) => {
      writes.push(options.onlyIf?.etagDoesNotMatch === "*");
      if (options.onlyIf.etagMatches !== undefined)
        repairEtags.push(options.onlyIf.etagMatches);
      return bucket.put(target, value, options);
    },
    get: async (target) => {
      if (target === key && unavailable) {
        unavailable = false;
        throw new Error("Transient R2 read failure");
      }
      return bucket.get(target);
    },
  };
  const upload = async () =>
    (await retained.evidence.handle(
      await retained.request("PUT", path, bytes),
    ))!;
  try {
    expect((await upload()).status).toBe(500);
    expect(writes).toEqual([true]);
    expect(uploadAudits()).toEqual(before);
    const retainedObject = await bucket.get(key);
    expect(await new Response(retainedObject!.body).text()).toBe(
      VETTING_TRACE_BODY,
    );
    expect((await upload()).status).toBe(200);
    expect(writes).toEqual([true, true]);

    // Corrupt storage is different evidence from a failed read. The original
    // verified upload bytes can repair a shared content-addressed object.
    await retained.bucket.delete(key);
    await bucket.put(key, new Uint8Array(bytes.length), {
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { sha256: VETTING_TRACE_SHA },
      httpMetadata: { contentType: "text/plain" },
    });
    const corrupt = await bucket.head(key);
    expect(typeof corrupt?.etag).toBe("string");
    expect((await upload()).status).toBe(200);
    expect(writes).toEqual([true, true, true, false]);
    expect(repairEtags).toEqual([corrupt!.etag!]);
    const repaired = await bucket.get(key);
    expect(await new Response(repaired!.body).text()).toBe(VETTING_TRACE_BODY);
  } finally {
    retained.evidence.deps.bucket = bucket;
  }
}, 30000);

for (const winner of ["repaired", "changed-corrupt", "missing-etag"] as const) {
  test(`legacy conditional repair handles a ${winner} observation without blind overwrite`, async () => {
    const runId = `conditional-repair-${winner}`;
    const id = await legacyContentRun(runId);
    const path = `/api/v1/vetting/evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
    const key = await selectedEvidenceKey(id, runId, VETTING_TRACE_SHA);
    const bytes = new TextEncoder().encode(VETTING_TRACE_BODY);
    const bucket = retained.evidence.deps.bucket!;
    await retained.bucket.delete(key);
    await bucket.put(key, new Uint8Array(bytes.length).fill(7), {
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { sha256: VETTING_TRACE_SHA },
      httpMetadata: { contentType: "text/plain" },
    });
    const before = await bucket.head(key);
    if (!before?.etag)
      throw new Error("Local R2 did not expose the corrupt ETag");
    const beforeEtag = before.etag;
    let repairs = 0;
    let rejected = false;
    retained.evidence.deps.bucket = {
      ...bucket,
      get: async (target) => {
        const object = await bucket.get(target);
        if (object && winner === "missing-etag") {
          const { etag: _etag, ...withoutEtag } = object;
          return withoutEtag;
        }
        return object;
      },
      put: async (target, value, options) => {
        if (options.onlyIf.etagMatches !== undefined) {
          repairs++;
          expect(options.onlyIf.etagMatches).toBe(beforeEtag);
          // Another writer commits after our corrupt-body read. Exercise the
          // actual workerd condition, then reread whichever bytes won.
          await bucket.put(
            target,
            winner === "repaired"
              ? bytes
              : new Uint8Array(bytes.length).fill(8),
            {
              onlyIf: { etagMatches: beforeEtag },
              customMetadata: { sha256: VETTING_TRACE_SHA, winner },
              httpMetadata: { contentType: "text/plain" },
            },
          );
          const result = await bucket.put(target, value, options);
          rejected = result === null;
          return result;
        }
        return bucket.put(target, value, options);
      },
    };
    const auditCount = sqlite
      .query(
        "SELECT count(*) AS n FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action='upload'",
      )
      .get(id, runId);
    try {
      const response = await retained.evidence.handle(
        await retained.request("PUT", path, bytes),
      );
      expect(response?.status).toBe(winner === "repaired" ? 200 : 409);
      expect(repairs).toBe(winner === "missing-etag" ? 0 : 1);
      expect(rejected).toBe(winner !== "missing-etag");
      const after = await bucket.head(key);
      if (winner === "missing-etag") expect(after?.etag).toBe(beforeEtag);
      else expect(after?.customMetadata?.winner).toBe(winner);
      if (winner !== "repaired")
        expect(
          sqlite
            .query(
              "SELECT count(*) AS n FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action='upload'",
            )
            .get(id, runId),
        ).toEqual(auditCount);
      if (winner === "repaired") {
        const object = await bucket.get(key);
        expect(await new Response(object!.body).text()).toBe(
          VETTING_TRACE_BODY,
        );
      }
    } finally {
      retained.evidence.deps.bucket = bucket;
    }
  }, 30000);
}

test("legacy missing evidence retry stays create-only when another writer restores the object", async () => {
  const runId = "missing-repair-race";
  const id = await legacyContentRun(runId);
  const path = `/api/v1/vetting/evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
  const key = await selectedEvidenceKey(id, runId, VETTING_TRACE_SHA);
  const bytes = new TextEncoder().encode(VETTING_TRACE_BODY);
  const bucket = retained.evidence.deps.bucket!;
  let hideOnce = true;
  let writes = 0;
  let rejected = false;
  retained.evidence.deps.bucket = {
    ...bucket,
    get: async (target) => {
      if (target === key && hideOnce) {
        hideOnce = false;
        await retained.bucket.delete(key);
        return null;
      }
      return bucket.get(target);
    },
    put: async (target, value, options) => {
      writes++;
      expect(options.onlyIf).toEqual({ etagDoesNotMatch: "*" });
      if (writes === 2) {
        await bucket.put(target, bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          customMetadata: { sha256: VETTING_TRACE_SHA, winner: "concurrent" },
          httpMetadata: { contentType: "text/plain" },
        });
      }
      const result = await bucket.put(target, value, options);
      if (writes === 2) rejected = result === null;
      return result;
    },
  };
  try {
    const response = await retained.evidence.handle(
      await retained.request("PUT", path, bytes),
    );
    expect(response?.status).toBe(200);
    expect(writes).toBe(2);
    expect(rejected).toBe(true);
    expect((await bucket.head(key))?.customMetadata?.winner).toBe("concurrent");
  } finally {
    retained.evidence.deps.bucket = bucket;
  }
}, 30000);

for (const state of ["missing", "corrupt"] as const) {
  test(`concurrent generated repairs of ${state} bytes publish one verified head without overwriting targets`, async () => {
    await listPausedProject();
    const id = await queueScan();
    const runId = `generated-repair-${state}`;
    await retained.retain(id, runId);
    const row = await evidenceStorageRow(id, runId, VETTING_TRACE_SHA);
    const previous = await selectedEvidenceKey(id, runId, VETTING_TRACE_SHA);
    const bytes = new TextEncoder().encode(VETTING_TRACE_BODY);
    const corrupt = new Uint8Array(bytes.length).fill(19);
    const bucket = retained.evidence.deps.bucket!;
    await retained.bucket.delete(previous);
    if (state === "corrupt")
      await bucket.put(previous, corrupt, {
        onlyIf: { etagDoesNotMatch: "*" },
        customMetadata: { sha256: VETTING_TRACE_SHA },
        httpMetadata: { contentType: "text/plain" },
      });
    let observed = 0;
    let release: () => void = () => {};
    const bothObserved = new Promise<void>((resolve) => {
      release = resolve;
    });
    const written: string[] = [];
    retained.evidence.deps.bucket = {
      ...bucket,
      get: async (key) => {
        const object = await bucket.get(key);
        if (key === previous && observed < 2) {
          if (++observed === 2) release();
          await bothObserved;
        }
        // The new protocol does not depend on an old target's provider ETag.
        if (object) {
          const { etag: _etag, ...withoutEtag } = object;
          return withoutEtag;
        }
        return null;
      },
      put: async (key, body, options) => {
        written.push(key);
        expect(key).not.toBe(previous);
        expect(options.onlyIf).toEqual({ etagDoesNotMatch: "*" });
        return bucket.put(key, body, options);
      },
    };
    const path = `/api/v1/vetting/evidence/${id}/${runId}/${VETTING_TRACE_SHA}`;
    try {
      const requests = await Promise.all([
        retained.request("PUT", path, bytes),
        retained.request("PUT", path, bytes),
      ]);
      const responses = await Promise.all(
        requests.map((request) => retained.evidence.handle(request)),
      );
      expect(responses.map((response) => response?.status)).toEqual([200, 200]);
      expect(observed).toBe(2);
      expect(new Set(written).size).toBe(2);
      const selected = await selectedEvidenceKey(id, runId, VETTING_TRACE_SHA);
      expect(written).toContain(selected);
      for (const key of written)
        expect(await new Response((await bucket.get(key))!.body).text()).toBe(
          VETTING_TRACE_BODY,
        );
      const old = await bucket.get(previous);
      if (state === "missing") expect(old).toBeNull();
      else
        expect(
          new Uint8Array(await new Response(old!.body).arrayBuffer()),
        ).toEqual(corrupt);
      expect(
        sqlite
          .query(
            "SELECT count(*) AS n FROM vetting_evidence_targets WHERE generation_id=? AND part_index=-1 AND sha256=?",
          )
          .get(row.storage_generation, VETTING_TRACE_SHA),
      ).toEqual({ n: 3 });
      expect(
        sqlite
          .query(
            "SELECT count(*) AS n FROM vetting_evidence_heads WHERE generation_id=? AND part_index=-1 AND sha256=?",
          )
          .get(row.storage_generation, VETTING_TRACE_SHA),
      ).toEqual({ n: 1 });
    } finally {
      release();
      retained.evidence.deps.bucket = bucket;
    }
  }, 30000);
}

for (const outcome of ["before-commit", "after-commit"] as const) {
  test(`generated target publication with a lost ${outcome} response uses exact readback`, async () => {
    await listPausedProject();
    const id = await queueScan();
    const runId = `unknown-publication-${outcome}`;
    const path = `/api/v1/vetting/evidence/${id}/${runId}`;
    const object = VETTING_EVIDENCE_OBJECTS[0];
    const registered = await retained.evidence.handle(
      await retained.request(
        "POST",
        path,
        JSON.stringify({
          traceSha256: object.sha256,
          objects: [{ ...object, body: undefined }],
        }),
      ),
    );
    expect(registered?.status).toBe(201);
    const row = await evidenceStorageRow(id, runId, object.sha256);
    const db = retained.evidence.deps.db;
    let injected = false;
    retained.evidence.deps.db = {
      ...db,
      prepare: (sql) => {
        const statement = db.prepare(sql);
        if (!sql.includes("INSERT INTO vetting_evidence_heads"))
          return statement;
        return {
          ...statement,
          bind: (...values) => {
            const bound = statement.bind(...values);
            return {
              ...bound,
              run: async () => {
                if (injected) return bound.run();
                injected = true;
                if (outcome === "after-commit") await bound.run();
                throw new Error("Publication response unavailable");
              },
            };
          },
        };
      },
    };
    const upload = () =>
      retained
        .request("PUT", `${path}/${object.sha256}`, object.body)
        .then((request) => retained.evidence.handle(request));
    try {
      const response = await upload();
      expect(injected).toBe(true);
      expect(response?.status).toBe(outcome === "after-commit" ? 200 : 500);
      expect(
        sqlite
          .query(
            "SELECT count(*) AS n FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action='upload'",
          )
          .get(id, runId),
      ).toEqual({ n: outcome === "after-commit" ? 1 : 0 });
      const candidates = sqlite
        .query(
          "SELECT target_key FROM vetting_evidence_targets WHERE generation_id=?",
        )
        .all(row.storage_generation) as { target_key: string }[];
      expect(candidates).toHaveLength(1);
      expect(
        await new Response(
          (await retained.evidence.deps.bucket!.get(candidates[0].target_key))!
            .body,
        ).text(),
      ).toBe(object.body);
      const storage = new EvidenceStorage(
        db,
        retained.evidence.deps.bucket!,
        () => NOW,
        () => crypto.randomUUID(),
      );
      expect(await storage.partKey(row)).toBe(
        outcome === "after-commit" ? candidates[0].target_key : null,
      );
      expect((await upload())?.status).toBe(200);
      expect(
        await new Response(
          (await retained.evidence.deps.bucket!.get(candidates[0].target_key))!
            .body,
        ).text(),
      ).toBe(object.body);
      expect(
        sqlite
          .query(
            "SELECT count(*) AS n FROM vetting_evidence_targets WHERE generation_id=?",
          )
          .get(row.storage_generation),
      ).toEqual({ n: outcome === "after-commit" ? 1 : 2 });
    } finally {
      retained.evidence.deps.db = db;
    }
  }, 30000);
}

for (const state of ["retiring", "retired"] as const) {
  test(`a new registration after a generation is ${state} cannot rebind the old run`, async () => {
    await listPausedProject();
    const id = await queueScan();
    const object = VETTING_EVIDENCE_OBJECTS[0];
    const manifest = JSON.stringify({
      traceSha256: object.sha256,
      objects: [{ ...object, body: undefined }],
    });
    const path = `/api/v1/vetting/evidence/${id}`;
    const send = async (method: string, suffix: string, body: string) =>
      retained.evidence.handle(
        await retained.request(method, `${path}${suffix}`, body),
      );
    expect((await send("POST", "/old", manifest))?.status).toBe(201);
    const old = await evidenceStorageRow(id, "old", object.sha256);
    // An unpopulated generation has no physical targets to retire. This fixture
    // isolates the immutable run binding; worker coverage retires actual bytes.
    sqlite
      .query(
        "UPDATE vetting_evidence_generations SET state='retiring' WHERE id=?",
      )
      .run(old.storage_generation);
    if (state === "retired")
      sqlite
        .query(
          "UPDATE vetting_evidence_generations SET state='retired',retired_at=? WHERE id=?",
        )
        .run(NOW.toISOString(), old.storage_generation);
    const later = await send("POST", "/new", manifest);
    expect(later?.status).toBe(201);
    expect((await later!.json()).stored).toEqual([]);
    const current = await evidenceStorageRow(id, "new", object.sha256);
    expect(current.storage_generation).not.toBe(old.storage_generation);
    expect(
      (await send("PUT", `/old/${object.sha256}`, object.body))?.status,
    ).toBe(410);
    expect(
      (await send("PUT", `/new/${object.sha256}`, object.body))?.status,
    ).toBe(200);
    expect(
      (await evidenceStorageRow(id, "old", object.sha256)).storage_generation,
    ).toBe(old.storage_generation);
    const storage = new EvidenceStorage(
      retained.evidence.deps.db,
      retained.evidence.deps.bucket!,
      () => NOW,
      () => crypto.randomUUID(),
    );
    expect(await storage.partKey(old)).toBeNull();
    expect(await storage.readPart(current)).toEqual(
      new TextEncoder().encode(object.body),
    );
  }, 30000);
}

for (const operation of ["upload", "upload-chunk", "finalize"] as const) {
  test(`${operation} crossing evidence expiry cannot record an accepted outcome`, async () => {
    await listPausedProject();
    const id = await queueScan();
    const result = await fixture(id, "incomplete");
    expect((await postResult(result)).status).toBe(200);
    const close = await retained.evidence.handle(
      new Request(`${ORIGIN}/api/v1/operator/vetting-evidence/${id}/close`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "x-test-operator": EVIDENCE_OWNER_GITHUB_ID,
        },
        body: JSON.stringify({ reason: "Finish the synthetic exception case" }),
      }),
    );
    expect(close?.status).toBe(200);
    const runId = `expiry-${operation}`;
    const path = `/api/v1/vetting/evidence/${id}/${runId}`;
    const bytes = new Uint8Array(
      operation === "upload" ? 17 : EVIDENCE_CHUNK_BYTES + 17,
    ).fill(21);
    const hash = (value: Uint8Array) =>
      createHash("sha256").update(value).digest("hex");
    const sha = hash(bytes);
    const chunks = (operation === "upload" ? [] : [0, 1]).map((index) => {
      const part = bytes.subarray(
        index * EVIDENCE_CHUNK_BYTES,
        (index + 1) * EVIDENCE_CHUNK_BYTES,
      );
      return { index, sizeBytes: part.length, sha256: hash(part) };
    });
    const send = async (
      method: string,
      suffix: string,
      body: string | Uint8Array,
    ) =>
      (await retained.evidence.handle(
        await retained.request(method, `${path}${suffix}`, body),
      ))!;
    const registered = await send(
      "POST",
      "",
      JSON.stringify({
        traceSha256: sha,
        objects: [
          {
            sha256: sha,
            sizeBytes: bytes.length,
            kind: "trace",
            label: "Expiry race",
            contentType: "application/octet-stream",
            ...(chunks.length ? { chunks } : {}),
          },
        ],
      }),
    );
    expect(registered.status).toBe(201);
    if (operation === "finalize") {
      for (const chunk of chunks)
        expect(
          (
            await send(
              "PUT",
              `/${sha}/chunks/${chunk.index}`,
              bytes.subarray(
                chunk.index * EVIDENCE_CHUNK_BYTES,
                chunk.index * EVIDENCE_CHUNK_BYTES + chunk.sizeBytes,
              ),
            )
          ).status,
        ).toBe(200);
    }
    const row = await evidenceStorageRow(id, runId, sha);
    const targetIndex =
      operation === "upload" ? -1 : operation === "upload-chunk" ? 0 : 1;
    let targetKey: string | null = null;
    const bucket = retained.evidence.deps.bucket!;
    let entered: () => void = () => {};
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    retained.evidence.deps.bucket = {
      ...bucket,
      get: async (key) => {
        const object = await bucket.get(key);
        // Upload reads its reserved target before publishing a head. Resolve
        // that exact reservation instead of assuming a physical storage path.
        if (
          targetKey === null &&
          sqlite
            .query(
              "SELECT 1 FROM vetting_evidence_targets WHERE target_key=? AND generation_id=? AND part_index=?",
            )
            .get(key, row.storage_generation, targetIndex)
        ) {
          targetKey = key;
          entered();
          await gate;
        }
        return object;
      },
    };
    const before = sqlite
      .query(
        "SELECT count(*) AS n FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action=?",
      )
      .get(id, runId, operation);
    try {
      const pending =
        operation === "upload"
          ? send("PUT", `/${sha}`, bytes)
          : operation === "upload-chunk"
            ? send(
                "PUT",
                `/${sha}/chunks/0`,
                bytes.subarray(0, EVIDENCE_CHUNK_BYTES),
              )
            : send("POST", `/${sha}/finalize`, "{}");
      await reading;
      retained.evidence.deps.now = () =>
        new Date(NOW.getTime() + 90 * 86400_000);
      release();
      const refused = await pending;
      expect(refused.status).toBe(410);
      expect((await refused.json()).error).toBe("evidence_expired");
      expect(
        sqlite
          .query(
            "SELECT count(*) AS n FROM vetting_evidence_audit WHERE assessment_id=? AND run_id=? AND action=?",
          )
          .get(id, runId, operation),
      ).toEqual(before);
      expect(
        sqlite
          .query(
            "SELECT count(*) AS n FROM vetting_evidence_completions WHERE assessment_id=? AND run_id=?",
          )
          .get(id, runId),
      ).toEqual({ n: 0 });
      // The completed bounded write is retained evidence, not an accepted
      // upload/finalization receipt and not proof of physical cleanup.
      if (targetKey === null)
        throw new Error("No reserved target read was held");
      expect(await bucket.head(targetKey)).not.toBeNull();
    } finally {
      release();
      retained.evidence.deps.bucket = bucket;
    }
  }, 60000);
}
