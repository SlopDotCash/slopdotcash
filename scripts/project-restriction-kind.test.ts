// ADM-06: the enforcement kind a moderator picks (Quarantine vs Ban) must
// arrive as that same kind on every public surface — the projects list
// restrictions array, the project detail 410 and the skill artifact 410 —
// including when the restriction is transferred through a shared repository.
// A Ban in force on a claimed repository outweighs the project's own
// Quarantine: holding or placing a lighter restriction must never make a
// banned repository read as merely quarantined.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import type { RepositoryControl } from "../backend/projects/contracts";
import type { EdgeCache } from "../backend/projects/edge-cache";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import {
  handleProjectArtifactRequest,
  type SkillTemplateIndex,
} from "../backend/projects/skill-publication";
import { TokenMetadataError } from "../backend/projects/token-metadata";
import { readSecurityProgramFunds } from "../backend/security/program-funds";
import { vettingScanRequester } from "../backend/vetting/handler";
import {
  CloudflareVettingPersistence,
  type VettingPin,
} from "../backend/vetting/persistence";
import type { RepositoryAccess } from "../src/lib/project-contracts";
import { PROJECT_SKILL_TEMPLATES } from "../src/lib/project-schema.mjs";
import { sha256Hex } from "../src/lib/project-skill-publication.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { localVettingEvidence } from "../tests/vetting-evidence-fixture";

const ORIGIN = "https://slop.cash";
const ADMIN = { githubId: "900000001", githubLogin: "e2e-admin" };
const APPLICANT = { githubId: "900000002", githubLogin: "e2e-applicant" };
const MODERATOR = { githubId: "900000003", githubLogin: "e2e-moderator" };
const TOKEN = "0x1111111111111111111111111111111111111111";
const EVIDENCE =
  "https://github.com/example/open-registry/security/advisories/GHSA-test";

class MemoryCache implements EdgeCache {
  readonly entries = new Map<string, Response>();
  async match(request: Request) {
    return this.entries.get(request.url)?.clone();
  }
  async put(request: Request, response: Response) {
    this.entries.set(request.url, response.clone());
  }
  async delete(request: Request) {
    return this.entries.delete(request.url);
  }
}

let persistence: CloudflareProjectPersistence;
let retained: Awaited<ReturnType<typeof localVettingEvidence>>;
afterEach(async () => {
  await retained?.dispose();
});
let vetting: CloudflareVettingPersistence;
let livePin: VettingPin;
let cache: MemoryCache;
let deps: ProjectApiDependencies;
let control: (repository: string) => RepositoryControl;
let access: RepositoryAccess | "unavailable";
let scanService: boolean;

beforeEach(async () => {
  const database = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  persistence = new CloudflareProjectPersistence(database.db);
  retained = await localVettingEvidence(
    database.db,
    () => new Date("2026-10-18T12:00:00.000Z"),
  );
  vetting = new CloudflareVettingPersistence(
    database.db,
    async (a) => a.result !== null && retained.evidence.retained(a.result),
  );
  livePin = { commitSha: "a".repeat(40), templateSha256: "d".repeat(64) };
  cache = new MemoryCache();
  control = () => ({ state: "matched" });
  access = { installation: "missing" };
  scanService = false;
  let id = 0;
  const randomId = () =>
    `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
  deps = {
    persistence,
    securityProgramFunds: (projectId, program) =>
      readSecurityProgramFunds(
        { db: database.db, now: () => deps.now() },
        projectId,
        program,
      ),
    adminGithubIds: new Set([ADMIN.githubId, MODERATOR.githubId]),
    moderatorGithubIds: new Set([ADMIN.githubId, MODERATOR.githubId]),
    now: () => new Date("2026-10-18T12:00:00.000Z"),
    randomId,
    sessionActor: async (request) =>
      request.headers.get("x-test-actor") === "admin"
        ? ADMIN
        : request.headers.get("x-test-actor") === "applicant"
          ? APPLICANT
          : request.headers.get("x-test-actor") === "moderator"
            ? MODERATOR
            : null,
    repositoryControl: async (manifest) => control(manifest.repositories[0].id),
    repositoryAccess: async () => {
      if (access === "unavailable") throw new Error("Slopbot unavailable");
      return access;
    },
    requestScan: vettingScanRequester({
      vetting,
      serviceAvailable: async () => scanService,
      livePin: async () => livePin,
      now: () => new Date("2026-10-18T12:00:00.000Z"),
      randomId,
    }),
    vettingClearance: (
      projectId,
      manifest,
      throughRevision,
      forReinstatement,
    ) =>
      vetting.manifestClearance(
        projectId,
        manifest,
        throughRevision,
        async () => livePin,
        forReinstatement,
      ),
    readTokenMetadata: async (_network, address) => {
      if (address === TOKEN) return { decimals: 18, symbol: "OPEN" };
      throw new TokenMetadataError("No contract exists at that token address");
    },
    github: {
      fetch: async (url) => {
        if (url === `https://api.github.com/user/${APPLICANT.githubId}`)
          return Response.json({
            id: Number(APPLICANT.githubId),
            login: APPLICANT.githubLogin,
            type: "User",
          });
        if (
          url ===
          "https://api.github.com/repos/example/open-registry/branches?per_page=100&page=1"
        )
          return Response.json([
            { name: "main", commit: { sha: "a".repeat(40) } },
            { name: "development", commit: { sha: "b".repeat(40) } },
          ]);
        if (url === "https://api.github.com/repos/example/open-registry")
          return Response.json({
            id: 123456789,
            node_id: "R_example",
            full_name: "example/open-registry",
            description: "Reproducible research tooling for everyone.",
            private: false,
            default_branch: "main",
            owner: {
              login: "example",
              id: 987654321,
              node_id: "O_example",
              type: "Organization",
            },
          });
        return Response.json({ message: "Not Found" }, { status: 404 });
      },
    },
    cache,
  };
});

function call(
  method: string,
  path: string,
  actor?: "admin" | "applicant" | "moderator",
  body?: unknown,
) {
  return handleProjectApi(
    new Request(`${ORIGIN}/api/v1/${path}`, {
      method,
      headers: {
        ...(actor ? { "x-test-actor": actor } : {}),
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", origin: ORIGIN }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    deps,
  ) as Promise<Response>;
}

const ADMIN_ACCESS: RepositoryAccess = {
  installation: "installed",
  installationId: 7,
  permission: "admin",
  roleName: "admin",
};

async function create(manifest: unknown, extra: Record<string, unknown> = {}) {
  const previous = access;
  access = ADMIN_ACCESS;
  try {
    return await call("POST", "projects", "applicant", { manifest, ...extra });
  } finally {
    access = previous;
  }
}

async function listProject(
  manifest = applicationManifest("open-registry", "example/open-registry"),
) {
  const created = await create(manifest);
  expect(created.status).toBe(201);
  return (await created.json()).project;
}

async function enforceOn(
  projectId: string,
  actor: "admin" | "moderator",
  action: string,
) {
  const project = await persistence.getProject(projectId);
  const records = await persistence.listEnforcements();
  const own = records.filter((record) => record.projectId === projectId);
  return call("POST", `admin/projects/${projectId}/enforcement`, actor, {
    action,
    reason: `Moderator note for ${action}`,
    evidenceReference: EVIDENCE,
    expectedRevision: project?.revision,
    expectedSequence: own.length + 1,
  });
}

function files(path: string): string[] {
  const absolute = join(resolve(import.meta.dir, ".."), path);
  return readdirSync(absolute, { recursive: true })
    .map(String)
    .filter((entry) => statSync(join(absolute, entry)).isFile())
    .map((entry) => relative(absolute, join(absolute, entry)))
    .sort();
}

async function publicationRequests() {
  const root = resolve(import.meta.dir, "..");
  const group = async (sourcePath: string, paths: string[]) => ({
    sourcePath,
    files: await Promise.all(
      paths.map(async (path) => ({
        path,
        sha256: await sha256Hex(readFileSync(join(root, sourcePath, path))),
      })),
    ),
  });
  const index: SkillTemplateIndex = {
    schemaVersion: "1",
    repository: "SlopDotCash/slopdotcash",
    commit: "d".repeat(40),
    templateSha256: "d".repeat(64),
    revisionStatus: "committed",
    contributor: await group(
      PROJECT_SKILL_TEMPLATES.contributor,
      files(PROJECT_SKILL_TEMPLATES.contributor),
    ),
    reviewer: await group(
      PROJECT_SKILL_TEMPLATES.reviewer,
      files(PROJECT_SKILL_TEMPLATES.reviewer),
    ),
    renderer: {
      paths: ["scripts/render-install-guide.mjs"],
      sources: [],
      revisionStatus: "committed",
    },
    acceptedRevisions: ["current main head"],
  };
  const publication = {
    getProject: (id: string) => persistence.getProject(id),
    listProjects: () => persistence.listProjects(),
    listEnforcements: () => persistence.listEnforcements(),
    enforcementGeneration: () => persistence.enforcementGeneration(),
    loadTemplate: async () => ({
      index,
      readFile: async (path: string) =>
        new Uint8Array(readFileSync(join(root, path))),
    }),
    vettingClearance: (
      project: { id: string; manifest: object; revision: number },
      templateSha256: string,
    ) =>
      vetting.manifestClearance(
        project.id,
        project.manifest,
        project.revision,
        async () => ({ commitSha: livePin.commitSha, templateSha256 }),
      ),
    cache,
  };
  // A cleared vetting stub, so artifact reads reach the restriction gate.
  const get = (path: string) =>
    handleProjectArtifactRequest(new Request(`${ORIGIN}${path}`), {
      ...publication,
      vettingClearance: async () => ({
        state: "cleared",
        assessment: {
          id: `vet_${"0".repeat(32)}`,
          revision: 1,
          state: "clean",
          commitSha: livePin.commitSha,
          templateSha256: livePin.templateSha256,
          policyVersion: null,
          requestedAt: "2026-10-18T12:00:00.000Z",
          completedAt: "2026-10-18T12:00:01.000Z",
          modelRuns: [],
          artifacts: 0,
          heldArtifacts: 0,
        },
      }),
    }) as Promise<Response>;
  return { publication, get };
}

/** Every public surface's restriction state for one project. */
async function publicStates(projectId: string) {
  const { get } = await publicationRequests();
  const list = await (await call("GET", "projects")).json();
  const entry = (list.restrictions as Record<string, unknown>[]).find(
    (restriction) => restriction.projectId === projectId,
  );
  const detail = await call("GET", `projects/${projectId}`);
  const detailBody = detail.status === 410 ? await detail.json() : null;
  const skill = await get(`/projects/${projectId}/skill.md`);
  const skillText = skill.status === 410 ? await skill.text() : null;
  return {
    listEntry: entry ?? null,
    detailStatus: detail.status,
    detailRestriction: detailBody?.restriction ?? null,
    detailMessage: detailBody?.message ?? null,
    skillStatus: skill.status,
    skillText,
  };
}

describe("project restriction kind (ADM-06)", () => {
  test("a quarantine on the project itself arrives as quarantined on every public surface", async () => {
    await listProject();
    expect(
      (await enforceOn("open-registry", "admin", "quarantine")).status,
    ).toBe(200);
    const states = await publicStates("open-registry");
    expect(states.listEntry).toMatchObject({
      projectId: "open-registry",
      sourceProjectId: "open-registry",
      state: "quarantined",
    });
    expect(states.detailStatus).toBe(410);
    expect(states.detailRestriction).toMatchObject({ state: "quarantined" });
    expect(states.detailMessage).toContain("quarantined");
    expect(states.skillStatus).toBe(410);
    expect(states.skillText).toContain("quarantined");
  });

  test("a ban on the project itself arrives as banned on every public surface", async () => {
    await listProject();
    expect((await enforceOn("open-registry", "admin", "ban")).status).toBe(200);
    const states = await publicStates("open-registry");
    expect(states.listEntry).toMatchObject({ state: "banned" });
    expect(states.detailRestriction).toMatchObject({ state: "banned" });
    expect(states.detailMessage).toContain("banned");
    expect(states.skillText).toContain("banned");
  });

  test("an escalation from quarantine to ban arrives as banned", async () => {
    await listProject();
    expect(
      (await enforceOn("open-registry", "admin", "quarantine")).status,
    ).toBe(200);
    expect((await enforceOn("open-registry", "admin", "ban")).status).toBe(200);
    const states = await publicStates("open-registry");
    expect(states.listEntry).toMatchObject({ state: "banned" });
    expect(states.detailRestriction).toMatchObject({ state: "banned" });
    expect(states.skillText).toContain("banned");
  });

  test("a quarantine on the source project arrives as quarantined on the project sharing the repository", async () => {
    await listProject();
    await listProject(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    expect(
      (await enforceOn("open-registry", "admin", "quarantine")).status,
    ).toBe(200);
    const states = await publicStates("renamed-registry");
    expect(states.listEntry).toMatchObject({
      projectId: "renamed-registry",
      sourceProjectId: "open-registry",
      state: "quarantined",
    });
    expect(states.detailRestriction).toMatchObject({
      projectId: "renamed-registry",
      sourceProjectId: "open-registry",
      state: "quarantined",
    });
    expect(states.skillText).toContain("quarantined");
  });

  test("a source ban outweighs the sharing project's own earlier quarantine", async () => {
    await listProject();
    await listProject(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    // The sharing project is quarantined on its own records first.
    expect(
      (await enforceOn("renamed-registry", "admin", "quarantine")).status,
    ).toBe(200);
    const before = await publicStates("renamed-registry");
    expect(before.listEntry).toMatchObject({ state: "quarantined" });
    // Then the source project for the same repository is banned.
    expect((await enforceOn("open-registry", "admin", "ban")).status).toBe(200);
    const states = await publicStates("renamed-registry");
    expect(states.listEntry).toMatchObject({
      projectId: "renamed-registry",
      sourceProjectId: "open-registry",
      state: "banned",
    });
    expect(states.detailRestriction).toMatchObject({
      projectId: "renamed-registry",
      sourceProjectId: "open-registry",
      state: "banned",
    });
    expect(states.detailMessage).toContain("banned");
    expect(states.skillText).toContain("banned");
  });

  test("placing a quarantine on a project of a banned repository does not lighten its public state", async () => {
    await listProject();
    await listProject(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    expect((await enforceOn("open-registry", "admin", "ban")).status).toBe(200);
    const before = await publicStates("renamed-registry");
    expect(before.listEntry).toMatchObject({
      sourceProjectId: "open-registry",
      state: "banned",
    });
    // A moderator then quarantines the sharing project on its own records.
    expect(
      (await enforceOn("renamed-registry", "admin", "quarantine")).status,
    ).toBe(200);
    const states = await publicStates("renamed-registry");
    expect(states.listEntry).toMatchObject({
      projectId: "renamed-registry",
      sourceProjectId: "open-registry",
      state: "banned",
    });
    expect(states.detailRestriction).toMatchObject({
      projectId: "renamed-registry",
      sourceProjectId: "open-registry",
      state: "banned",
    });
    expect(states.skillText).toContain("banned");
  });

  test("the sharing project's own ban is not lightened by a source quarantine", async () => {
    await listProject();
    await listProject(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    expect((await enforceOn("renamed-registry", "admin", "ban")).status).toBe(
      200,
    );
    expect(
      (await enforceOn("open-registry", "admin", "quarantine")).status,
    ).toBe(200);
    const states = await publicStates("renamed-registry");
    expect(states.listEntry).toMatchObject({
      projectId: "renamed-registry",
      sourceProjectId: "renamed-registry",
      state: "banned",
    });
    expect(states.detailRestriction).toMatchObject({ state: "banned" });
  });

  test("equal kinds keep the project's own restriction and its appeal", async () => {
    await listProject();
    await listProject(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    expect(
      (await enforceOn("renamed-registry", "admin", "quarantine")).status,
    ).toBe(200);
    expect(
      (await enforceOn("open-registry", "admin", "quarantine")).status,
    ).toBe(200);
    const states = await publicStates("renamed-registry");
    expect(states.listEntry).toMatchObject({
      projectId: "renamed-registry",
      sourceProjectId: "renamed-registry",
      state: "quarantined",
    });
    expect(states.detailRestriction).toMatchObject({
      sourceProjectId: "renamed-registry",
      state: "quarantined",
    });
  });

  test("a ban on the alphabetically later project outweighs a quarantine on the earlier one", async () => {
    await listProject();
    await listProject(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    await listProject(
      applicationManifest("mmm-project", "example/mmm-project"),
    );
    // Quarantine sits on the alphabetically earlier project, Ban on the later.
    expect(
      (await enforceOn("open-registry", "admin", "quarantine")).status,
    ).toBe(200);
    expect((await enforceOn("renamed-registry", "admin", "ban")).status).toBe(
      200,
    );
    const states = await publicStates("open-registry");
    expect(states.listEntry).toMatchObject({
      projectId: "open-registry",
      sourceProjectId: "renamed-registry",
      state: "banned",
    });
    expect(states.detailRestriction).toMatchObject({
      projectId: "open-registry",
      sourceProjectId: "renamed-registry",
      state: "banned",
    });
    expect(states.detailMessage).toContain("banned");
    expect(states.skillText).toContain("banned");
    // A third project with no restriction of its own reads the same Ban.
    const third = await publicStates("mmm-project");
    expect(third.listEntry).toMatchObject({
      projectId: "mmm-project",
      sourceProjectId: "renamed-registry",
      state: "banned",
    });
  });
});
