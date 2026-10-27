// The bounded malicious-code scan (audit finding 8) and two-contributor
// flags (audit finding 9) on the real migrations and handlers: a clean
// supported scan admits its immutable repository, explicit rescans retain
// exact evidence, and two distinct flags pause atomically
// with one moderator notice, and a clean fresh scan reinstates a flag-only
// pause while a confirmed malicious result stays with a moderator.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { flaggerAuthority } from "../backend/projects/setup";
import { githubFlaggerStanding } from "../backend/vetting/flagger-standing";
import {
  handleProjectFlagsApi,
  ProjectFlagStore,
} from "../backend/vetting/flags";
import {
  handleVettingApi,
  queueAutomaticScan,
  vettingScanRequester,
} from "../backend/vetting/handler";
import {
  CloudflareVettingPersistence,
  type VettingPin,
} from "../backend/vetting/persistence";
import { seedParticipationBan } from "../tests/participation-ban.fixture";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { localVettingEvidence } from "../tests/vetting-evidence-fixture";
import {
  signedVettingHeaders,
  vettingKeyPair,
  vettingScanResult,
} from "../tests/vetting-fixtures";

const ORIGIN = "https://slop.cash";
const ADMIN = { githubId: "900000001", githubLogin: "e2e-admin" };
const APPLICANT = { githubId: "900000002", githubLogin: "e2e-applicant" };
const MODERATOR = { githubId: "900000004", githubLogin: "e2e-moderator" };
const ALICE = { githubId: "900000010", githubLogin: "alice" };
const BOB = { githubId: "900000011", githubLogin: "bob" };
const CAROL = { githubId: "900000012", githubLogin: "carol" };
const STEWARD = { githubId: "987654321", githubLogin: "example" };
const NEWCOMER = { githubId: "900000013", githubLogin: "newcomer" };
const BYSTANDER = { githubId: "900000014", githubLogin: "bystander" };
const COLLABORATOR = { githubId: "900000015", githubLogin: "collaborator" };
const ACTORS: Record<string, { githubId: string; githubLogin: string }> = {
  admin: ADMIN,
  applicant: APPLICANT,
  alice: ALICE,
  bob: BOB,
  carol: CAROL,
  steward: STEWARD,
  newcomer: NEWCOMER,
  bystander: BYSTANDER,
  collaborator: COLLABORATOR,
};
/** GitHub account facts, merged Slop pull requests and write access. */
const STANDING: Record<
  string,
  { createdAt: string; merged: number; association?: string }
> = {
  alice: { createdAt: "2020-01-01T00:00:00Z", merged: 3 },
  bob: { createdAt: "2021-05-01T00:00:00Z", merged: 1 },
  carol: { createdAt: "2022-02-02T00:00:00Z", merged: 2 },
  steward: { createdAt: "2015-01-01T00:00:00Z", merged: 9 },
  newcomer: { createdAt: "2026-10-01T00:00:00Z", merged: 1 },
  bystander: { createdAt: "2019-01-01T00:00:00Z", merged: 0 },
  collaborator: {
    createdAt: "2018-01-01T00:00:00Z",
    merged: 4,
    association: "COLLABORATOR",
  },
};
const GITHUB = "https://api.github.test";
let githubUp = true;

/** Answers the GitHub REST reads the flag eligibility check makes. */
async function githubFixture(url: string): Promise<Response> {
  if (!githubUp) return new Response("unavailable", { status: 502 });
  const path = new URL(url).pathname;
  const user = /^\/user\/([0-9]+)$/u.exec(path)?.[1];
  if (user !== undefined) {
    const [name, actor] =
      Object.entries(ACTORS).find(([, entry]) => entry.githubId === user) ?? [];
    const facts = name === undefined ? undefined : STANDING[name];
    if (actor === undefined || facts === undefined)
      return new Response(null, { status: 404 });
    return Response.json({
      id: Number(actor.githubId),
      login: actor.githubLogin,
      node_id: `U_${actor.githubId}`,
      type: "User",
      created_at: facts.createdAt,
    });
  }
  if (/^\/repos\/[^/]+\/[^/]+\/issues$/u.test(path)) {
    const creator = new URL(url).searchParams.get("creator");
    const [name, actor] =
      Object.entries(ACTORS).find(
        ([, entry]) => entry.githubLogin === creator,
      ) ?? [];
    const merged = (name && STANDING[name]?.merged) || 0;
    return Response.json(
      Array.from({ length: merged }, (_, index) => ({
        number: index + 1,
        user: { id: Number(actor?.githubId) },
        pull_request: { merged_at: "2026-09-01T00:00:00Z" },
      })),
    );
  }
  return new Response(null, { status: 404 });
}

const NOW = new Date("2026-10-18T12:00:00.000Z");
const HEAD = "a".repeat(40);
const TEMPLATE = "b".repeat(64);

let retained: Awaited<ReturnType<typeof localVettingEvidence>>;
let sqlite: ReturnType<typeof sqliteD1>["sqlite"];
let projects: CloudflareProjectPersistence;
let vetting: CloudflareVettingPersistence;
let flags: ProjectFlagStore;
let beforeFlagBatch: (() => void) | null = null;
let keys: Awaited<ReturnType<typeof vettingKeyPair>>;
let livePin: VettingPin;
let pinUp = true;
let clock: Date;
let ids = 0;
let installation: "installed" | "missing" | "suspended" = "installed";

beforeEach(async () => {
  const database = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  sqlite = database.sqlite;
  projects = new CloudflareProjectPersistence(database.db);
  beforeFlagBatch = null;
  flags = new ProjectFlagStore({
    prepare: (sql) => database.db.prepare(sql),
    batch: async (statements) => {
      const hook = beforeFlagBatch;
      beforeFlagBatch = null;
      hook?.();
      return database.db.batch(statements);
    },
  });
  clock = NOW;
  githubUp = true;
  installation = "installed";
  retained = await localVettingEvidence(database.db, () => clock);
  vetting = new CloudflareVettingPersistence(
    database.db,
    async (a) => a.result !== null && retained.evidence.retained(a.result),
  );
  keys = await vettingKeyPair();
  livePin = { commitSha: HEAD, templateSha256: TEMPLATE };
  pinUp = true;
});
afterEach(async () => {
  await retained?.dispose();
});

const actorOf = (request: Request) =>
  ACTORS[request.headers.get("x-test-actor") ?? ""] ?? null;
const readLivePin = async () => {
  if (!pinUp) throw new Error("GitHub unavailable");
  return livePin;
};
const randomId = () =>
  `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const vettingDeps = () => ({
  evidence: retained.evidence,
  vetting,
  flags,
  projects,
  resultPublicKeys: keys.publicKey,
  operatorGithubIds: [ADMIN.githubId, MODERATOR.githubId],
  livePin: readLivePin,
  session: async (value: Request) => {
    const actor = actorOf(value);
    return actor && { ...actor, admin: actor === ADMIN };
  },
  now: () => clock,
  randomId,
});

function projectApi(
  request: Request,
  overrides: Partial<ProjectApiDependencies> = {},
) {
  return handleProjectApi(request, {
    persistence: projects,
    adminGithubIds: new Set([ADMIN.githubId]),
    moderatorGithubIds: new Set([MODERATOR.githubId]),
    now: () => clock,
    randomId,
    sessionActor: async (value) => actorOf(value),
    repositoryControl: async () => ({ state: "matched", reason: "fixture" }),
    repositoryAccess: async () => ({
      installation: "installed",
      installationId: 1,
      permission: "admin",
      roleName: null,
    }),
    readTokenMetadata: async () => {
      throw new Error("no token reads in this suite");
    },
    github: { fetch: async () => new Response(null, { status: 404 }) },
    vettingClearance: (projectId, manifest, through, forReinstatement) =>
      vetting.manifestClearance(
        projectId,
        manifest,
        through,
        readLivePin,
        forReinstatement,
      ),
    ...overrides,
  }) as Promise<Response>;
}

const vettingApi = (request: Request) =>
  handleVettingApi(request, vettingDeps()) as Promise<Response>;

const flagApi = (request: Request) =>
  handleProjectFlagsApi(request, {
    flags,
    projects,
    sessionActor: async (value) => actorOf(value),
    flaggerStanding: githubFlaggerStanding({
      fetch: githubFixture,
      apiOrigin: GITHUB,
      registryRepositories: async () =>
        (await projects.listProjects()).flatMap((entry) =>
          entry.manifest.repositories.map((repository) => repository.id),
        ),
    }),
    // Slopbot reads each member's repository permission.
    repositoryAuthority: async (manifest, actor) => {
      const name = Object.keys(ACTORS).find(
        (key) => ACTORS[key].githubId === actor.githubId,
      );
      return flaggerAuthority(
        {
          state: "read",
          access: {
            installation,
            installationId: 1,
            permission: name && STANDING[name]?.association ? "write" : "read",
            roleName: null,
          },
        },
        actor,
        manifest.repositories[0].id,
      );
    },
    moderatorGithubIds: [ADMIN.githubId, MODERATOR.githubId],
    queueFreshScan: (project) =>
      queueAutomaticScan(
        vettingDeps(),
        project,
        "Automatic fresh scan after two contributor flags paused the project",
      ),
    now: () => clock,
    randomId,
  }) as Promise<Response>;

function sessionRequest(
  method: string,
  path: string,
  actor: string,
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

async function signed(method: string, path: string, body = "") {
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
        clock,
      )),
    },
    body: method === "GET" ? undefined : body,
  });
}

/** The owner lists the project paused through self-service setup. */
async function listPausedProject() {
  const created = await projectApi(
    sessionRequest("POST", "projects", "applicant", {
      manifest: applicationManifest("open-registry", "example/open-registry"),
    }),
  );
  expect(created.status).toBe(201);
}

/** The signed scanner service asks Slop to queue what changed. */
async function refresh() {
  const response = await vettingApi(
    await signed("POST", "vetting/refresh", "{}"),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { queued: string[] };
}

async function scanFixture(
  assessmentId: string,
  disposition: "clean" | "incomplete" | "malicious",
  options: Parameters<typeof vettingScanResult>[2] = {},
  retain = true,
) {
  const project = await projects.getProject("open-registry");
  const assessment = await vetting.getAssessment(assessmentId);
  if (project === null || assessment === null) throw new Error("not queued");
  const result = vettingScanResult(
    {
      assessmentId,
      projectId: project.id,
      revision: assessment.revision,
      manifestSha256: assessment.manifestSha256,
      repository: "example/open-registry",
      commitSha: assessment.commitSha,
      templateSha256: assessment.templateSha256,
    },
    disposition,
    options,
  );
  if (retain) await retained.retain(assessmentId, result.scan.runId);
  return result;
}

async function postResult(body: unknown) {
  return vettingApi(
    await signed("POST", "vetting/results", JSON.stringify(body)),
  );
}

async function activate() {
  const project = await projects.getProject("open-registry");
  return projectApi(
    sessionRequest("PUT", "admin/projects/open-registry/manifest", "admin", {
      manifest: { ...project?.manifest, status: "active" },
      expectedRevision: project?.revision,
      reason: "Activate the scanned revision",
    }),
  );
}

const publicProject = () =>
  projectApi(new Request(`${ORIGIN}/api/v1/projects/open-registry`));

function flag(actor: string, category = "credential-theft") {
  return flagApi(
    sessionRequest("POST", "project-flags/open-registry", actor, {
      category,
      evidence:
        "scripts/postinstall.js reads ~/.config/solana/id.json and posts it to a remote host",
      evidenceUrl:
        "https://github.com/example/open-registry/blob/main/scripts/postinstall.js",
    }),
  );
}

/** Lists, scans clean, and activates the project, as self-service setup does. */
async function activeProject() {
  await listPausedProject();
  const [id] = (await refresh()).queued;
  expect((await postResult(await scanFixture(id, "clean"))).status).toBe(200);
  expect((await activate()).status).toBe(200);
  return id;
}

describe("automatic scan and activation", () => {
  test("a clean supported scan lets activation proceed without an admin scan request", async () => {
    await listPausedProject();
    expect((await activate()).status).toBe(422);
    const { queued } = await refresh();
    expect(queued).toHaveLength(1);
    const assessment = await vetting.getAssessment(queued[0]);
    expect(assessment).toMatchObject({
      state: "pending",
      commitSha: HEAD,
      templateSha256: TEMPLATE,
      requestedBy: STEWARD,
      requestReason: "Automatic scan of new project content",
    });
    // A repeated refresh does not queue a duplicate.
    expect((await refresh()).queued).toEqual([]);

    // A clean claim without the retained report is refused.
    const unretained = await postResult(
      await scanFixture(queued[0], "clean", {}, false),
    );
    expect(unretained.status).toBe(422);
    expect((await unretained.json()).error).toBe("evidence_incomplete");

    const recorded = await postResult(await scanFixture(queued[0], "clean"));
    expect(recorded.status).toBe(200);
    expect(
      sqlite
        .query(
          "SELECT closed_at, closed_by FROM vetting_evidence_case_closures WHERE assessment_id=?",
        )
        .get(queued[0]),
    ).toEqual({ closed_at: NOW.toISOString(), closed_by: "automatic" });
    expect((await recorded.json()).assessment).toMatchObject({
      state: "clean",
      modelRuns: [
        {
          reviewer: "primary",
          provider: "anthropic",
          model: "claude-opus-5-5",
        },
      ],
    });
    const detail = await (await publicProject()).json();
    expect(detail.vetting.state).toBe("cleared");
    expect((await activate()).status).toBe(200);
    expect((await projects.getProject("open-registry"))?.status).toBe("active");
  });

  test("admission clearance survives same-repository content changes without rewriting scan evidence", async () => {
    const id = await activeProject();
    const original = JSON.stringify(await vetting.getAssessment(id));
    livePin = { commitSha: "e".repeat(40), templateSha256: "f".repeat(64) };
    pinUp = false;
    expect((await (await publicProject()).json()).vetting).toMatchObject({
      state: "cleared",
      basis: "admission",
      assessment: { id, commitSha: HEAD, templateSha256: TEMPLATE },
    });
    expect((await refresh()).queued).toEqual([]);
    const current = await projects.getProject("open-registry");
    if (!current) throw new Error("missing project");
    const updated = await projectApi(
      sessionRequest("PUT", "projects/open-registry", "applicant", {
        manifest: {
          ...current.manifest,
          contribution: {
            ...current.manifest.contribution,
            requiredTests: "Run the changed repository checks.",
          },
        },
        expectedRevision: current.revision,
        reason: "Same-repository contribution instructions changed",
      }),
    );
    expect(updated.status).toBe(200);
    expect((await (await publicProject()).json()).vetting.state).toBe(
      "cleared",
    );
    expect(JSON.stringify(await vetting.getAssessment(id))).toBe(original);
    expect(await vetting.projectAssessments("open-registry")).toHaveLength(1);
    const next = await projects.getProject("open-registry");
    if (!next) throw new Error("missing revised project");
    const other = {
      ...next.manifest,
      authority: {
        ...next.manifest.authority,
        repositoryId: "999999991",
        repositoryNodeId: "R_other",
      },
    };
    expect(
      (
        await vetting.manifestClearance(
          next.id,
          other,
          next.revision,
          readLivePin,
        )
      ).state,
    ).toBe("unscanned");
  });

  test("admission evidence stays usable after the ordinary 90-day closure boundary", async () => {
    const id = await activeProject();
    const original = JSON.stringify(await vetting.getAssessment(id));
    clock = new Date(NOW.getTime() + 91 * 86400_000);
    expect((await (await publicProject()).json()).vetting).toMatchObject({
      state: "cleared",
      basis: "admission",
      assessment: { id },
    });
    expect(JSON.stringify(await vetting.getAssessment(id))).toBe(original);
  });

  test("an explicit investigation can reuse identical content without automatic rescans", async () => {
    const first = await activeProject();
    // A routine commit keeps admission; a separate explicit request still
    // exercises the exact-input reuse and retained-evidence guards.
    livePin = { commitSha: "e".repeat(40), templateSha256: TEMPLATE };
    expect((await (await publicProject()).json()).vetting.state).toBe(
      "cleared",
    );
    expect((await refresh()).queued).toEqual([]);
    const project = await projects.getProject("open-registry");
    if (!project) throw new Error("missing project");
    expect(
      await queueAutomaticScan(
        vettingDeps(),
        project,
        "Explicit security investigation",
      ),
    ).toBe("queued");
    expect((await (await publicProject()).json()).vetting.state).toBe("queued");
    const rescan = (await vetting.pendingAssessments())[0].id;
    const reuse = await scanFixture(
      rescan,
      "clean",
      { runId: "scan-run-1", reusedAssessmentId: first },
      false,
    );
    // A reuse must cite the same report and inventory as the original.
    const mismatched = await postResult({
      ...reuse,
      assessed: { ...reuse.assessed, inputManifestSha256: "f".repeat(64) },
      primaryReview: {
        ...reuse.primaryReview,
        inputManifestSha256: "f".repeat(64),
      },
    });
    expect(mismatched.status).toBe(422);
    expect((await mismatched.json()).error).toBe("reuse_mismatch");
    expect((await postResult(reuse)).status).toBe(200);
    expect((await (await publicProject()).json()).vetting.state).toBe(
      "cleared",
    );
  });

  test("an incomplete or legacy result never clears", async () => {
    await listPausedProject();
    const [id] = (await refresh()).queued;
    const incomplete = await scanFixture(id, "incomplete");
    const overclaimed = await postResult({
      ...incomplete,
      disposition: "clean",
    });
    expect(overclaimed.status).toBe(422);
    expect((await overclaimed.json()).message).toContain(
      "The downloads surface was not read completely",
    );
    expect((await postResult(incomplete)).status).toBe(200);
    expect((await (await publicProject()).json()).vetting.state).toBe(
      "quarantined",
    );
    expect((await activate()).status).toBe(422);
  });
});

describe("two-contributor flags", () => {
  test("two distinct flags pause atomically with one moderator notice; a clean fresh scan reinstates", async () => {
    await activeProject();
    const first = await flag("alice");
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      paused: false,
      restriction: "clear",
      flag: { category: "credential-theft", state: "active" },
    });
    // One active flag per contributor and project.
    const repeated = await flag("alice", "prompt-injection");
    expect(repeated.status).toBe(409);
    expect((await repeated.json()).error).toBe("flag_active");
    expect((await publicProject()).status).toBe(200);

    clock = new Date(NOW.getTime() + 60_000);
    const second = await flag("bob");
    expect(second.status).toBe(201);
    const paused = await second.json();
    expect(paused).toMatchObject({
      paused: true,
      restriction: "quarantined",
      pausedByFlags: true,
      freshScan: "queued",
    });
    // The pause closes the project's public routes and skills at once.
    const closed = await publicProject();
    expect(closed.status).toBe(410);
    expect((await closed.json()).restriction.state).toBe("quarantined");
    const [record] = (await projects.listEnforcements()).filter(
      (entry) => entry.projectId === "open-registry",
    );
    expect(record).toMatchObject({
      action: "quarantine",
      actorRole: "contributor-flags",
      decisionSource: "standing-rule",
      actor: null,
      systemIssuer: { kind: "contributor-flags", threshold: 2 },
    });
    expect((record.systemIssuer as { flagIds: string[] }).flagIds).toHaveLength(
      2,
    );
    // One notice per moderator, plus the project owner's notice.
    const notices = sqlite
      .query(
        "SELECT recipient_github_id AS recipient, kind, action_path AS path FROM notifications WHERE event_key = ? ORDER BY recipient_github_id",
      )
      .all(`project-enforcement:${record.id}`);
    expect(notices).toEqual([
      {
        recipient: ADMIN.githubId,
        kind: "project_quarantined",
        path: "/admin",
      },
      {
        recipient: APPLICANT.githubId,
        kind: "project_quarantined",
        path: "/projects/open-registry",
      },
      {
        recipient: MODERATOR.githubId,
        kind: "project_quarantined",
        path: "/admin",
      },
      {
        recipient: STEWARD.githubId,
        kind: "project_quarantined",
        path: "/projects/open-registry",
      },
    ]);
    expect(
      (await projects.listEnforcements()).filter(
        (entry) => entry.projectId === "open-registry",
      ),
    ).toHaveLength(1);
    // Moderators read the evidence; the pause needed no approval.
    const overview = await vettingApi(
      sessionRequest("GET", "admin/vetting", "admin"),
    );
    expect((await overview.json()).flags).toHaveLength(2);

    // The fresh scan queued with the pause reinstates on a clean result.
    const fresh = (await vetting.pendingAssessments()).at(-1);
    expect(fresh?.requestReason).toBe(
      "Automatic fresh scan after two contributor flags paused the project",
    );
    clock = new Date(NOW.getTime() + 120_000);
    if (!fresh) throw new Error("no fresh scan");
    expect(
      (
        await postResult(
          await scanFixture(fresh.id, "clean", { runId: "scan-run-2" }),
        )
      ).status,
    ).toBe(200);
    const records = (await projects.listEnforcements()).filter(
      (entry) => entry.projectId === "open-registry",
    );
    expect(records.at(-1)).toMatchObject({
      action: "reinstate",
      stateAfter: "clear",
      appealAfter: "none",
      actorRole: "vetting-service",
      systemIssuer: {
        rule: "clean-fresh-scan-after-flags",
        assessmentId: fresh.id,
      },
      result: "no_revision_needed",
    });
    expect((await publicProject()).status).toBe(200);
    expect((await projects.getProject("open-registry"))?.status).toBe("active");
    // Resolved flags stop counting, so the project does not pause again.
    expect(await flags.activeFlags(clock)).toEqual([]);
    clock = new Date(NOW.getTime() + 180_000);
    expect(await (await flag("alice")).json()).toMatchObject({ paused: false });
    expect((await publicProject()).status).toBe(200);
  });

  test.each([0, 30_000])(
    "a flag filed during a scan waits for a newer scan (offset %i)",
    async (offset) => {
      await activeProject();
      expect((await flag("alice")).status).toBe(201);
      clock = new Date(NOW.getTime() + 60_000);
      expect((await flag("bob")).status).toBe(201);
      const old = (await vetting.pendingAssessments()).at(-1);
      if (!old) throw new Error("Missing pause scan");
      clock = new Date(NOW.getTime() + 60_000 + offset);
      expect((await flag("carol")).status).toBe(201);
      clock = new Date(NOW.getTime() + 120_000);
      expect(
        (
          await postResult(
            await scanFixture(old.id, "clean", { runId: "old-flag-scan" }),
          )
        ).status,
      ).toBe(200);
      expect((await publicProject()).status).toBe(410);
      expect(
        (await flags.activeFlags(clock)).map(
          (entry) => entry.reporter.githubId,
        ),
      ).toEqual([CAROL.githubId]);
      const refreshed = await refresh();
      expect(refreshed.queued).toHaveLength(1);
      const fresh = refreshed.queued[0];
      clock = new Date(NOW.getTime() + 180_000);
      expect(
        (
          await postResult(
            await scanFixture(fresh, "clean", { runId: "new-flag-scan" }),
          )
        ).status,
      ).toBe(200);
      expect((await publicProject()).status).toBe(200);
      expect(await flags.activeFlags(clock)).toEqual([]);
    },
  );

  test("withdrawn flags stop counting and owners cannot flag", async () => {
    await activeProject();
    const owner = await flag("steward");
    expect(owner.status).toBe(403);
    expect((await owner.json()).error).toBe("owner_cannot_flag");
    expect((await flag("alice")).status).toBe(201);
    const mine = await flagApi(
      sessionRequest("GET", "project-flags/open-registry", "alice"),
    );
    expect((await mine.json()).flag.state).toBe("active");
    const withdrawn = await flagApi(
      sessionRequest(
        "POST",
        "project-flags/open-registry/withdraw",
        "alice",
        {},
      ),
    );
    expect(withdrawn.status).toBe(200);
    expect(await (await flag("bob")).json()).toMatchObject({ paused: false });
    expect((await publicProject()).status).toBe(200);
    // Signed-out members and cross-site writes are refused.
    expect(
      (
        await flagApi(
          new Request(`${ORIGIN}/api/v1/project-flags/open-registry`),
        )
      ).status,
    ).toBe(401);
    const crossSite = await flagApi(
      new Request(`${ORIGIN}/api/v1/project-flags/open-registry`, {
        method: "POST",
        headers: {
          "x-test-actor": "carol",
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: "{}",
      }),
    );
    expect(crossSite.status).toBe(403);
  });

  test("only established contributors outside the project may flag", async () => {
    await activeProject();
    for (const [actor, code] of [
      ["collaborator", "maintainer_cannot_flag"],
      ["newcomer", "flagger_account_too_new"],
      ["bystander", "flagger_needs_accepted_contribution"],
    ] as const) {
      const refused = await flag(actor);
      expect(refused.status).toBe(403);
      expect((await refused.json()).error).toBe(code);
    }
    for (const state of ["missing", "suspended"] as const) {
      installation = state;
      const unavailable = await flag("alice");
      expect(unavailable.status).toBe(503);
      expect((await unavailable.json()).error).toBe(
        "flagger_standing_unavailable",
      );
      expect(await flags.activeFlags(clock)).toEqual([]);
    }
    installation = "installed";
    // A failed GitHub read refuses the flag; it never admits one.
    githubUp = false;
    const unknown = await flag("alice");
    expect(unknown.status).toBe(503);
    expect((await unknown.json()).error).toBe("flagger_standing_unavailable");
    githubUp = true;
    expect(await flags.activeFlags(clock)).toEqual([]);
    expect((await flag("alice")).status).toBe(201);
  });

  test("a flag stops counting 90 days after it was filed", async () => {
    await activeProject();
    expect((await flag("alice")).status).toBe(201);
    clock = new Date(NOW.getTime() + 7_776_000_000);
    // Alice's flag reached its lifetime, so Bob's flag alone does not pause.
    expect(await (await flag("bob")).json()).toMatchObject({ paused: false });
    expect((await publicProject()).status).toBe(200);
    const mine = await flagApi(
      sessionRequest("GET", "project-flags/open-registry", "alice"),
    );
    expect((await mine.json()).flag).toBeNull();
    // Alice may file again; two counting flags then pause the project.
    expect(await (await flag("alice")).json()).toMatchObject({ paused: true });
    expect(
      sqlite
        .query("SELECT state, closed_by FROM project_flags ORDER BY created_at")
        .all(),
    ).toEqual([
      { state: "expired", closed_by: "lifetime" },
      { state: "active", closed_by: null },
      { state: "active", closed_by: null },
    ]);
  });

  test("a confirmed malicious result after a flag pause stays with a moderator", async () => {
    await activeProject();
    expect((await flag("alice")).status).toBe(201);
    clock = new Date(NOW.getTime() + 60_000);
    expect(await (await flag("bob")).json()).toMatchObject({ paused: true });
    const fresh = (await vetting.pendingAssessments()).at(-1);
    if (!fresh) throw new Error("no fresh scan");
    clock = new Date(NOW.getTime() + 120_000);
    expect(
      (
        await postResult(
          await scanFixture(fresh.id, "malicious", { runId: "scan-run-2" }),
        )
      ).status,
    ).toBe(200);
    const records = (await projects.listEnforcements()).filter(
      (entry) => entry.projectId === "open-registry",
    );
    expect(records.at(-1)).toMatchObject({
      action: "ban",
      actorRole: "vetting-service",
    });
    // A later clean scan alone cannot lift a ban.
    clock = new Date(NOW.getTime() + 180_000);
    const banned = await projects.getProject("open-registry");
    if (banned === null) throw new Error("project vanished");
    const queued = await queueAutomaticScan(
      vettingDeps(),
      banned,
      "Automatic rescan",
    );
    expect(queued).toBe("queued");
    const next = (await vetting.pendingAssessments()).at(-1);
    if (!next) throw new Error("no rescan");
    expect(
      (
        await postResult(
          await scanFixture(next.id, "clean", { runId: "scan-run-3" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await projects.listEnforcements())
        .filter((entry) => entry.projectId === "open-registry")
        .at(-1)?.action,
    ).toBe("ban");
    expect((await publicProject()).status).toBe(410);
  });

  test("the database refuses a flag pause without two distinct active reporters", async () => {
    await activeProject();
    expect((await flag("alice")).status).toBe(201);
    const project = await projects.getProject("open-registry");
    if (project === null) throw new Error("project vanished");
    const [only] = await flags.activeFlags(clock);
    expect(() =>
      sqlite
        .query(
          `INSERT INTO project_enforcements (id, project_id, sequence, action, state_after, appeal_after, reason, evidence_reference, repository_github_id, repository_keys, actor_role, decision_source, before_revision, before_manifest_sha256, result, created_at, system_issuer)
           VALUES ('enf_forged_flags', 'open-registry', 1, 'quarantine', 'quarantined', 'none', 'forged', 'forged', '123456789', '["example/open-registry"]', 'contributor-flags', 'standing-rule', ?, ?, 'revision_pending', ?, ?)`,
        )
        .run(
          project.revision,
          project.manifestSha256,
          NOW.toISOString(),
          JSON.stringify({
            kind: "contributor-flags",
            threshold: 2,
            flagIds: [only.id, only.id],
          }),
        ),
    ).toThrow("a flag pause needs two distinct active contributor flags");
  });
});

test("a banned account cannot add a flag but can withdraw its earlier flag", async () => {
  await activeProject();
  expect((await flag("alice")).status).toBe(201);
  seedParticipationBan(sqlite, ALICE, ADMIN, clock.toISOString());
  expect(
    (
      await flagApi(
        sessionRequest("GET", "project-flags/open-registry", "alice"),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await flagApi(
        sessionRequest(
          "POST",
          "project-flags/open-registry/withdraw",
          "alice",
          {},
        ),
      )
    ).status,
  ).toBe(200);
  const refused = await flag("alice");
  expect(refused.status).toBe(403);
  expect((await refused.json()).error).toBe("participation_banned");
  expect(await flags.activeFlags(clock)).toHaveLength(0);
});

test("a concurrent account ban cannot supply the flag that pauses another project", async () => {
  await activeProject();
  expect((await flag("alice")).status).toBe(201);
  beforeFlagBatch = () =>
    seedParticipationBan(sqlite, BOB, ADMIN, clock.toISOString());
  expect((await flag("bob")).status).toBe(403);
  expect(
    (await flags.activeFlags(clock)).map((entry) => entry.reporter.githubId),
  ).toEqual([ALICE.githubId]);
  expect((await publicProject()).status).toBe(200);
});

test("the existing-project exemption is permanent but cannot clear reinstatement or later projects", async () => {
  const migration = "0075_vetting_grandfathered_projects.sql";
  const database = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql") && name !== migration)
      .sort(),
  );
  try {
    const registry = new CloudflareProjectPersistence(database.db);
    const clearance = new CloudflareVettingPersistence(database.db);
    const canonical = async (id: string) => {
      const response = await projectApi(
        sessionRequest("POST", "projects", "applicant", {
          manifest: applicationManifest(id, `example/${id}`),
        }),
      );
      expect(response.status).toBe(201);
      const project = await projects.getProject(id);
      if (!project) throw new Error("The created project was not persisted");
      return project.manifest;
    };
    const existing = await canonical("existing-exempt");
    const later = await canonical("later-scanned");
    const create = async (manifest: typeof existing) =>
      registry.createProject({
        manifest,
        manifestText: JSON.stringify(manifest),
        manifestSha256: "a".repeat(64),
        reason: "Owner creates a test project",
        actor: APPLICANT,
        at: NOW.toISOString(),
        referrer: null,
      });
    expect(await create(existing)).toBe("created");
    database.sqlite.exec(
      readFileSync(
        new URL(`../migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
    expect(await create(later)).toBe("created");
    const inspect = (manifest: typeof existing, reinstating = false) =>
      clearance.manifestClearance(
        manifest.id,
        manifest,
        1,
        async () => ({
          commitSha: "b".repeat(40),
          templateSha256: "c".repeat(64),
        }),
        reinstating,
      );
    expect(await inspect(existing)).toEqual({
      state: "cleared",
      assessment: null,
      grandfathered: true,
    });
    expect((await inspect(later)).state).not.toBe("cleared");
    expect((await inspect(existing, true)).state).not.toBe("cleared");
    // A later executable head still receives exemption, without a fabricated scan.
    expect(
      await clearance.manifestClearance(existing.id, existing, 1, async () => ({
        commitSha: "d".repeat(40),
        templateSha256: "e".repeat(64),
      })),
    ).toEqual({ state: "cleared", assessment: null, grandfathered: true });
    // Migration 0075 exempts the project id permanently, not only its first
    // repository identity. A later stored revision keeps that existing policy.
    const changedRepository = {
      ...existing,
      authority: {
        ...existing.authority,
        repositoryId: "999999991",
        repositoryNodeId: "R_replaced",
      },
    };
    expect(
      await registry.appendProjectRevision(
        {
          projectId: existing.id,
          expectedRevision: 1,
          manifest: changedRepository,
          manifestText: JSON.stringify(changedRepository),
          manifestSha256: "f".repeat(64),
          reason: "Record a replacement repository identity",
          actor: ADMIN,
          at: NOW.toISOString(),
        },
        0,
      ),
    ).toBe("updated");
    const replaced = await registry.getProject(existing.id);
    if (!replaced) throw new Error("Missing revised exempt project");
    const inspectReplacement = (reinstating = false) =>
      clearance.manifestClearance(
        replaced.id,
        replaced.manifest,
        replaced.revision,
        async () => ({
          commitSha: "d".repeat(40),
          templateSha256: "e".repeat(64),
        }),
        reinstating,
      );
    expect(await inspectReplacement()).toEqual({
      state: "cleared",
      assessment: null,
      grandfathered: true,
    });
    const content = (await clearance.revisionContents(existing.id)).at(-1);
    if (!content) throw new Error("Missing revised exempt content");
    expect(
      await clearance.createAssessment({
        id: "vet_00000000000000000000000000000099",
        projectId: replaced.id,
        revision: replaced.revision,
        manifestSha256: replaced.manifestSha256,
        contentSha256: content.contentSha256,
        commitSha: "d".repeat(40),
        templateSha256: "e".repeat(64),
        requestedBy: ADMIN,
        requestedAt: NOW.toISOString(),
        requestReason: "Explicit investigation of an exempt project",
      }),
    ).toBe("created");
    // Existing exemption semantics ignore pending normal scans. Flags and
    // remedial reinstatement still require their separate fresh evidence.
    expect(await inspectReplacement()).toEqual({
      state: "cleared",
      assessment: null,
      grandfathered: true,
    });
    expect((await inspectReplacement(true)).state).not.toBe("cleared");
    expect(() =>
      database.sqlite.exec(
        "INSERT INTO vetting_grandfathered_projects VALUES ('later-scanned', '2026-10-24T00:00:00Z')",
      ),
    ).toThrow("grandfathered projects are fixed");
    expect(() =>
      database.sqlite.exec(
        "DELETE FROM vetting_grandfathered_projects WHERE project_id = 'existing-exempt'",
      ),
    ).toThrow("grandfathered projects are permanent");
  } finally {
    database.sqlite.close();
  }
});

test("an exempt owner edit stays active without a scan, while flags still require fresh reinstatement", async () => {
  await listPausedProject();
  const canonical = await projects.getProject("open-registry");
  if (!canonical) throw new Error("Missing canonical project");
  const migration = "0075_vetting_grandfathered_projects.sql";
  const database = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql") && name !== migration)
      .sort(),
  );
  await retained.dispose();
  sqlite = database.sqlite;
  projects = new CloudflareProjectPersistence(database.db);
  flags = new ProjectFlagStore(database.db);
  retained = await localVettingEvidence(database.db, () => clock);
  vetting = new CloudflareVettingPersistence(
    database.db,
    async (assessment) =>
      assessment.result !== null &&
      retained.evidence.retained(assessment.result),
  );
  expect(
    await projects.createProject({
      manifest: canonical.manifest,
      manifestText: JSON.stringify(canonical.manifest),
      manifestSha256: canonical.manifestSha256,
      reason: "Existing project before the scan gate",
      actor: APPLICANT,
      at: NOW.toISOString(),
      referrer: null,
    }),
  ).toBe("created");
  sqlite.exec(
    readFileSync(
      new URL(`../migrations/${migration}`, import.meta.url),
      "utf8",
    ),
  );
  const initial = await projectApi(
    sessionRequest(
      "POST",
      "project-setup/open-registry/check",
      "applicant",
      {},
    ),
  );
  expect(initial.status).toBe(200);
  const active = await projects.getProject("open-registry");
  if (!active) throw new Error("Missing active project");
  expect(active.status).toBe("active");
  let scanRequests = 0;
  const unavailable = vettingScanRequester({
    vetting,
    serviceAvailable: async () => true,
    livePin: async () => {
      throw new Error("Integration head unavailable");
    },
    now: () => clock,
    randomId,
  });
  const edit = async () => {
    const current = await projects.getProject("open-registry");
    if (!current) throw new Error("Missing current project");
    return projectApi(
      sessionRequest("PUT", "projects/open-registry", "applicant", {
        expectedRevision: current.revision,
        manifest: {
          ...current.manifest,
          contribution: {
            ...current.manifest.contribution,
            approvedScope: "Fix reproduced defects in the supported runtime.",
          },
        },
      }),
      {
        requestScan: async (...args) => {
          scanRequests++;
          return unavailable(...args);
        },
      },
    );
  };
  const published = await edit();
  expect(published.status).toBe(200);
  const result = await published.json();
  expect(result.project.revision).toBe(active.revision + 1);
  expect(result.project.status).toBe("active");
  expect(result.setup).toMatchObject({
    state: "ready",
    status: "active",
    nextAction: { kind: "none" },
    checks: { scan: { state: "cleared", exempt: true } },
  });
  expect(scanRequests).toBe(0);
  expect(await vetting.projectAssessments("open-registry")).toHaveLength(0);
  expect((await publicProject()).status).toBe(200);

  // The permanent exemption does not remove the two-contributor flag gate.
  expect((await flag("alice")).status).toBe(201);
  const flagged = await flag("bob");
  expect(flagged.status).toBe(201);
  expect(await flagged.json()).toMatchObject({
    paused: true,
    restriction: "quarantined",
    freshScan: "queued",
  });
  expect((await edit()).status).toBe(409);
  const paused = await projects.getProject("open-registry");
  if (!paused) throw new Error("Missing flagged project");
  expect((await publicProject()).status).toBe(410);
  const check = await projectApi(
    sessionRequest(
      "POST",
      "project-setup/open-registry/check",
      "applicant",
      {},
    ),
  );
  expect((await check.json()).setup.state).toBe("restricted");
  expect(
    (
      await vetting.manifestClearance(
        paused.id,
        paused.manifest,
        paused.revision,
        readLivePin,
        true,
      )
    ).state,
  ).not.toBe("cleared");
  expect(scanRequests).toBe(0);
});

test("a previously admitted owner executable edit stays active without a new scan", async () => {
  await activeProject();
  const current = await projects.getProject("open-registry");
  if (!current) throw new Error("Missing active project");
  const response = await projectApi(
    sessionRequest("PUT", "projects/open-registry", "applicant", {
      expectedRevision: current.revision,
      manifest: {
        ...current.manifest,
        contribution: {
          ...current.manifest.contribution,
          approvedScope: "Fix reproduced defects in the supported runtime.",
        },
      },
    }),
    {
      requestScan: vettingScanRequester({
        vetting,
        serviceAvailable: async () => true,
        livePin: readLivePin,
        now: () => clock,
        randomId,
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    project: { revision: current.revision + 1, status: "active" },
    setup: { state: "ready", checks: { scan: { state: "cleared" } } },
  });
  expect(
    (await vetting.projectAssessments("open-registry")).filter(
      (assessment) =>
        assessment.revision === current.revision + 1 &&
        assessment.state === "pending",
    ),
  ).toHaveLength(0);
});

test("a routine owner edit does not resume a manually paused admitted project", async () => {
  await activeProject();
  const current = await projects.getProject("open-registry");
  if (!current) throw new Error("Missing project");
  expect(
    (
      await projectApi(
        sessionRequest(
          "PUT",
          "admin/projects/open-registry/manifest",
          "admin",
          {
            manifest: { ...current.manifest, status: "paused" },
            expectedRevision: current.revision,
            reason: "Manual pause",
          },
        ),
      )
    ).status,
  ).toBe(200);
  const paused = await projects.getProject("open-registry");
  if (!paused) throw new Error("Missing project");
  expect(
    (
      await projectApi(
        sessionRequest("PUT", "projects/open-registry", "applicant", {
          manifest: { ...paused.manifest, headline: "Updated while paused" },
          expectedRevision: paused.revision,
        }),
      )
    ).status,
  ).toBe(200);
  expect((await projects.getProject("open-registry"))?.status).toBe("paused");
  expect((await refresh()).queued).toEqual([]);
});

test("withdrawing a flag after the 90-day lifetime expires it by lifetime and returns 404", async () => {
  await activeProject();
  const created = await flag("alice");
  expect(created.status).toBe(201);
  const flagId = (await created.json()).flag.id as string;

  clock = new Date(NOW.getTime() + 7_776_000_000);
  const status = await flagApi(
    sessionRequest("GET", "project-flags/open-registry", "alice"),
  );
  expect(status.status).toBe(200);
  expect((await status.json()).flag).toBeNull();

  const withdrawn = await flagApi(
    sessionRequest("POST", "project-flags/open-registry/withdraw", "alice", {}),
  );
  expect(withdrawn.status).toBe(404);
  expect((await withdrawn.json()).error).toBe("not_found");
  expect(await flags.get(flagId)).toMatchObject({
    id: flagId,
    state: "expired",
    closedAt: clock.toISOString(),
    closedBy: "lifetime",
  });

  expect((await flag("alice", "prompt-injection")).status).toBe(201);
});

test("a cached scan from before a two-flag pause is refused and cannot reinstate the project", async () => {
  const initialAssessmentId = await activeProject();
  expect((await flag("alice")).status).toBe(201);
  clock = new Date(NOW.getTime() + 60_000);
  const second = await flag("bob");
  expect(second.status).toBe(201);
  expect(await second.json()).toMatchObject({
    paused: true,
    restriction: "quarantined",
    freshScan: "queued",
  });
  const fresh = (await vetting.pendingAssessments()).at(-1);
  if (!fresh) throw new Error("Missing pause scan");

  const reused = await scanFixture(
    fresh.id,
    "clean",
    { runId: "scan-run-1", reusedAssessmentId: initialAssessmentId },
    false,
  );
  const response = await postResult(reused);
  expect(response.status).toBe(422);
  expect((await response.json()).error).toBe("reuse_mismatch");
  expect((await publicProject()).status).toBe(410);
  expect(await flags.activeFlags(clock)).toHaveLength(2);
});

test("a completed scan for a superseded commit pin records without lifting a flag pause until the live pin is scanned", async () => {
  await activeProject();
  expect((await flag("alice")).status).toBe(201);
  clock = new Date(NOW.getTime() + 60_000);
  const second = await flag("bob");
  expect(second.status).toBe(201);
  expect(await second.json()).toMatchObject({
    paused: true,
    restriction: "quarantined",
    freshScan: "queued",
  });
  const stale = (await vetting.pendingAssessments()).at(-1);
  if (!stale) throw new Error("Missing pause scan");

  // The repository integration branch advances while the pause scan is in flight.
  livePin = { commitSha: "e".repeat(40), templateSha256: TEMPLATE };
  const staleScan = await scanFixture(stale.id, "clean", {
    runId: "scan-run-2",
  });
  const recordedStale = await postResult(staleScan);
  expect(recordedStale.status).toBe(200);
  expect((await vetting.getAssessment(stale.id))?.state).toBe("clean");

  // Because the completed scan does not match the live pin, the flag pause
  // remains in place without a reinstatement enforcement record.
  expect((await publicProject()).status).toBe(410);
  expect(
    (await projects.listEnforcements()).filter(
      (entry) =>
        entry.projectId === "open-registry" && entry.action === "reinstate",
    ),
  ).toHaveLength(0);

  // Refresh queues a fresh scan at the current live pin, which reinstates.
  const { queued } = await refresh();
  expect(queued).toHaveLength(1);
  const freshAssessment = await vetting.getAssessment(queued[0]);
  expect(freshAssessment?.commitSha).toBe("e".repeat(40));
  expect(
    (
      await postResult(
        await scanFixture(queued[0], "clean", { runId: "scan-run-3" }),
      )
    ).status,
  ).toBe(200);
  expect((await publicProject()).status).toBe(200);
  expect(
    (await projects.listEnforcements()).filter(
      (entry) =>
        entry.projectId === "open-registry" && entry.action === "reinstate",
    ),
  ).toHaveLength(1);
});

test("a live-pin outage while a fresh clean scan lands defers the flag reinstatement to the next refresh", async () => {
  await activeProject();
  expect((await flag("alice")).status).toBe(201);
  clock = new Date(NOW.getTime() + 60_000);
  expect((await flag("bob")).status).toBe(201);
  const pending = (await vetting.pendingAssessments()).at(-1);
  if (!pending) throw new Error("Missing pause scan");
  const result = await scanFixture(pending.id, "clean", {
    runId: "scan-run-4",
  });

  pinUp = false;
  expect((await postResult(result)).status).toBe(200);
  expect((await vetting.getAssessment(pending.id))?.state).toBe("clean");
  expect((await publicProject()).status).toBe(410);
  // Refresh during the outage changes nothing.
  expect((await refresh()) as unknown).toMatchObject({
    queued: [],
    reinstated: [],
  });
  expect((await publicProject()).status).toBe(410);

  pinUp = true;
  expect((await refresh()) as unknown).toMatchObject({
    queued: [],
    reinstated: [pending.id],
  });
  expect((await publicProject()).status).toBe(200);
  expect((await refresh()) as unknown).toMatchObject({
    queued: [],
    reinstated: [],
  });
  expect(
    (await projects.listEnforcements()).filter(
      (entry) =>
        entry.projectId === "open-registry" && entry.action === "reinstate",
    ),
  ).toHaveLength(1);
});
