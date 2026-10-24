// The D1 project registry API on the real migrations: cached public reads,
// purge on admin writes, server-verified reward assets, the GitHub ownership
// check, submission limits, exact revision bytes, the generated-skill
// activation gate, the security-vetting gate, same-origin GitHub lookups,
// and ADM-06 enforcement.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  CloudflareProjectPersistence,
  ENFORCEMENT_COLUMNS,
} from "../backend/projects/cloudflare-persistence";
import type { RepositoryControl } from "../backend/projects/contracts";
import type { EdgeCache } from "../backend/projects/edge-cache";
import {
  EnforcementRefusal,
  planEnforcement,
  projectRestriction,
} from "../backend/projects/enforcement";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { vettingScanRequester } from "../backend/projects/setup";
import type { SkillTemplateIndex } from "../backend/projects/skill-publication";
import { handleProjectArtifactRequest } from "../backend/projects/skill-publication";
import { TokenMetadataError } from "../backend/projects/token-metadata";
import {
  CloudflareVettingPersistence,
  type VettingPin,
  vettedContentSha256,
} from "../backend/vetting/persistence";
import { parseVettingResult } from "../backend/vetting/result";
import type { RepositoryAccess } from "../src/lib/project-contracts";
import { slugify } from "../src/lib/project-proposal";
import { PROJECT_SKILL_TEMPLATES } from "../src/lib/project-schema.mjs";
import {
  buildProjectPublication,
  sha256Hex,
} from "../src/lib/project-skill-publication.mjs";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import {
  applicationManifest,
  CONTRIBUTION,
} from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { vettingResult } from "../tests/vetting-fixtures";
import { fetchProjectRegistry } from "./sync-project-registry.mjs";

const ORIGIN = "https://slop.cash";
const ADMIN = { githubId: "900000001", githubLogin: "e2e-admin" };
const APPLICANT = { githubId: "900000002", githubLogin: "e2e-applicant" };
const MODERATOR = { githubId: "900000003", githubLogin: "e2e-moderator" };
const TOKEN = "0x1111111111111111111111111111111111111111";

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
let sqlite: Database;

import { localVettingEvidence } from "../tests/vetting-evidence-fixture";

let retained: Awaited<ReturnType<typeof localVettingEvidence>>;
afterEach(async () => {
  await retained?.dispose();
});
let vetting: CloudflareVettingPersistence;
let scans = 0;
/** The live integration-branch head and template digest vetting compares. */
let livePin: VettingPin;
let cache: MemoryCache;
let tokenReads: string[];
let githubReads: string[];
let deps: ProjectApiDependencies;
/** GitHub's answer for the ownership check, by repository. */
let control: (repository: string) => RepositoryControl;
/** What the Slopbot installation reads for the repository and account. */
let access: RepositoryAccess | "unavailable";
/** Whether the scan service accepts queued scans. */
let scanService: boolean;

beforeEach(async () => {
  const database = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  sqlite = database.sqlite;
  persistence = new CloudflareProjectPersistence(database.db);
  retained = await localVettingEvidence(
    database.db,
    () => new Date("2026-10-18T12:00:00.000Z"),
  );
  vetting = new CloudflareVettingPersistence(
    database.db,
    async (a) => a.result !== null && retained.evidence.complete(a.result),
  );
  livePin = { commitSha: "a".repeat(40), templateSha256: "d".repeat(64) };
  cache = new MemoryCache();
  tokenReads = [];
  githubReads = [];
  control = () => ({
    state: "unproven",
    reason: "@e2e-applicant is not a public member of example",
  });
  access = { installation: "missing" };
  scanService = false;
  let id = 0;
  const randomId = () =>
    `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
  deps = {
    persistence,
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
    readTokenMetadata: async (network, address) => {
      tokenReads.push(`${network}:${address}`);
      if (address === TOKEN) return { decimals: 18, symbol: "OPEN" };
      throw new TokenMetadataError("No contract exists at that token address");
    },
    github: {
      fetch: async (url) => {
        githubReads.push(url);
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

/** Seeds a historical persistence result; this does not pass HTTP admission. */
async function seedHistoricalResult(
  projectId: string,
  disposition: "clean" | "malicious" = "clean",
) {
  const project = await persistence.getProject(projectId);
  if (project === null) throw new Error("project was not listed");
  const id = `vet_${String(++scans).padStart(32, "0")}`;
  const requestedAt = new Date(
    Date.parse("2026-10-18T12:00:00.000Z") + scans * 2000,
  ).toISOString();
  await vetting.createAssessment({
    id,
    projectId,
    revision: project.revision,
    manifestSha256: project.manifestSha256,
    contentSha256: await vettedContentSha256(project.manifest),
    commitSha: livePin.commitSha,
    templateSha256: livePin.templateSha256,
    requestedBy: ADMIN,
    requestedAt,
    requestReason: "Fixture scan",
  });
  const result = parseVettingResult(
    vettingResult(
      {
        assessmentId: id,
        projectId,
        revision: project.revision,
        manifestSha256: project.manifestSha256,
        repository: project.manifest.repositories[0].id,
        commitSha: livePin.commitSha,
        templateSha256: livePin.templateSha256,
      },
      disposition,
    ),
  );
  await retained.retain(id, result.environment.runId);
  expect(
    await vetting.recordResult({
      result,
      resultText: JSON.stringify(result),
      resultSha256: "0".repeat(64),
      signingKeySha256: "1".repeat(64),
      at: new Date(Date.parse(requestedAt) + 1000).toISOString(),
    }),
  ).toBe("recorded");
  return id;
}

/** Creates a project through self-service setup as an owner GitHub proves. */
async function create(manifest: unknown, extra: Record<string, unknown> = {}) {
  const previous = control;
  control = () => ({
    state: "proven",
    reason: "@e2e-applicant is a public member of example",
  });
  try {
    return await call("POST", "projects", "applicant", { manifest, ...extra });
  } finally {
    control = previous;
  }
}

async function listProject(
  manifest = applicationManifest("open-registry", "example/open-registry"),
) {
  const created = await create(manifest);
  expect(created.status).toBe(201);
  return (await created.json()).project;
}

describe("project registry API", () => {
  test("serves a newly approved project at once, purging the cached list", async () => {
    const empty = await call("GET", "projects");
    expect((await empty.json()).projects).toEqual([]);
    expect((await call("GET", "projects")).headers.get("x-slop-cache")).toBe(
      "hit",
    );
    await listProject();
    const listed = await call("GET", "projects");
    expect(listed.headers.get("x-slop-cache")).toBe("miss");
    expect(listed.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30",
    );
    const body = await listed.json();
    expect(body.projects.map((project: { id: string }) => project.id)).toEqual([
      "open-registry",
    ]);
    expect(Object.keys(body).sort()).toEqual([
      "projects",
      "restrictions",
      "schemaVersion",
    ]);
    expect(body.restrictions).toEqual([]);
    const single = await call("GET", "projects/open-registry");
    expect(single.status).toBe(200);
    // Skills publish only after a clean scan of the exact revision.
    expect(await single.json()).toMatchObject({
      revision: 1,
      skillsPublished: false,
      vetting: { state: "unscanned" },
      project: { id: "open-registry", status: "paused" },
    });
    expect((await call("GET", "projects/missing")).status).toBe(404);
  });

  test("an owner revision publishes at once and appends only its expected revision", async () => {
    control = () => ({
      state: "proven",
      reason: "@e2e-applicant is a public member of example",
    });
    await listProject();
    const current = await persistence.getProject("open-registry");
    if (!current) throw new Error("Missing listed project");
    const manifest = {
      ...current.manifest,
      headline: "Updated scope for the open registry",
    };
    const body = { manifest, expectedRevision: 1 };
    const published = await call(
      "PUT",
      "projects/open-registry",
      "applicant",
      body,
    );
    expect(published.status).toBe(200);
    const result = await published.json();
    expect(result.changes).toEqual({
      presentation: ["headline"],
      executable: [],
      financial: [],
    });
    expect(await persistence.getProject("open-registry")).toMatchObject({
      revision: 2,
      manifest: { headline: manifest.headline, status: "paused" },
    });
    // The stale base revision is refused instead of overwriting.
    const stale = await call(
      "PUT",
      "projects/open-registry",
      "applicant",
      body,
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("stale_revision");
    // Status, listing and identity stay with the exception paths.
    const listing = await call("PUT", "projects/open-registry", "applicant", {
      manifest: {
        ...manifest,
        steward: { ...manifest.steward, displayName: "Someone else" },
      },
      expectedRevision: 2,
    });
    expect(listing.status).toBe(422);
    expect(await listing.json()).toMatchObject({
      error: "owner_field_restricted",
      message: expect.stringContaining("steward"),
    });
    const unchanged = await call("PUT", "projects/open-registry", "applicant", {
      manifest,
      expectedRevision: 2,
    });
    expect((await unchanged.json()).error).toBe("no_change");
    // Without current authority nothing is published.
    control = () => ({
      state: "unproven",
      reason: "@e2e-applicant is not a public member of example",
    });
    const denied = await call("PUT", "projects/open-registry", "applicant", {
      manifest: { ...manifest, headline: "A change without authority" },
      expectedRevision: 2,
    });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe("authority_required");
    // An unavailable GitHub answer is a retry, never a queued admin task.
    deps.repositoryControl = async () => {
      throw new Error("GitHub is down");
    };
    access = "unavailable";
    const retry = await call("PUT", "projects/open-registry", "applicant", {
      manifest: { ...manifest, headline: "A change while GitHub is down" },
      expectedRevision: 2,
    });
    expect(retry.status).toBe(503);
    expect((await retry.json()).error).toBe("github_unavailable");
    expect((await persistence.getProject("open-registry"))?.revision).toBe(2);
  });

  test("reads token decimals from chain once and keeps them on later revisions", async () => {
    await listProject(
      applicationManifest("open-registry", "example/open-registry", {
        rewardAsset: {
          network: "base",
          kind: "token",
          address: TOKEN.toUpperCase().replace("0X", "0x"),
          symbol: "OPN",
          decimals: 0,
        },
        reward: {
          ...(applicationManifest("x", "a/b").reward as object),
          chain: "base",
          currency: "OPN",
        },
      }),
    );
    expect(tokenReads).toEqual([`base:${TOKEN}`]);
    const project = await persistence.getProject("open-registry");
    expect(project?.manifest.rewardAsset).toEqual({
      network: "base",
      kind: "token",
      address: TOKEN,
      symbol: "OPEN",
      decimals: 18,
      chainId: "8453",
      cluster: null,
      verifiedAt: "2026-10-18T12:00:00.000Z",
    });
    expect(project?.manifest.reward.currency).toBe("OPEN");
    const revised = await call(
      "PUT",
      "admin/projects/open-registry/manifest",
      "admin",
      {
        manifest: {
          ...project?.manifest,
          rewardAsset: { ...project?.manifest.rewardAsset, decimals: 2 },
          headline: "Reproducible research tooling, revised.",
        },
        expectedRevision: 1,
        reason: "Headline update",
      },
    );
    expect(revised.status).toBe(200);
    expect(tokenReads).toHaveLength(1);
    expect(
      (await persistence.getProject("open-registry"))?.manifest.rewardAsset
        ?.decimals,
    ).toBe(18);
  });

  test("refuses an unverifiable or malformed token and stores nothing", async () => {
    const base = applicationManifest("open-registry", "example/open-registry");
    for (const [address, error] of [
      ["0x2222222222222222222222222222222222222222", "reward_asset_unverified"],
      ["0x1234", "invalid_manifest"],
    ]) {
      const response = await create({
        ...base,
        rewardAsset: {
          network: "ethereum",
          kind: "token",
          address,
          symbol: "BAD",
        },
      });
      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe(error);
    }
    expect(await persistence.listProjects()).toEqual([]);
  });

  test("refuses a project id too long for its reviewer skill name", async () => {
    const id = "reproducible-research-toolkit-for-everyone-x";
    expect(`review-${id}-contributions`).toHaveLength(65);
    const response = await create(
      applicationManifest(id, "example/open-registry"),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "invalid_manifest",
      message: "project.id is invalid",
    });
    expect(await persistence.listProjects()).toEqual([]);
  });

  test("refuses activation when historical clean metadata lacks canonical closure", async () => {
    await listProject();
    const current = await persistence.getProject("open-registry");
    const activate = (manifest: unknown) =>
      call("PUT", "admin/projects/open-registry/manifest", "admin", {
        manifest,
        expectedRevision: 1,
        reason: "Activate",
      });
    // Without the contribution fields the project has no generated skill.
    if (current === null) throw new Error("project was not listed");
    const { contribution: _fields, ...withoutFields } =
      current.manifest as unknown as Record<string, unknown>;
    const refused = await activate({ ...withoutFields, status: "active" });
    expect(refused.status).toBe(422);
    // An unscanned revision cannot activate either (VET-01).
    const unscanned = await activate({ ...current.manifest, status: "active" });
    expect(unscanned.status).toBe(422);
    expect((await unscanned.json()).error).toBe("vetting_required");
    await seedHistoricalResult("open-registry");
    expect((await persistence.getProject("open-registry"))?.status).toBe(
      "paused",
    );
    const accepted = await activate({
      ...current?.manifest,
      status: "active",
      contribution: CONTRIBUTION,
    });
    expect(accepted.status).toBe(422);
    expect((await accepted.json()).error).toBe("vetting_required");
    expect((await persistence.getProject("open-registry"))?.status).toBe(
      "paused",
    );
  });

  test("creates a project only for current GitHub authority and refuses contradicted facts", async () => {
    const manifest = applicationManifest(
      "open-registry",
      "example/open-registry",
    );
    control = () => ({
      state: "mismatch",
      reason: "Repository or steward facts do not match GitHub",
    });
    const refused = await call("POST", "projects", "applicant", { manifest });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      error: "invalid_manifest",
      message: "Repository or steward facts do not match GitHub",
    });
    // Unproven public facts and no installation: install Slopbot first.
    control = () => ({
      state: "unproven",
      reason: "@e2e-applicant is not a public member of example",
    });
    const unproven = await call("POST", "projects", "applicant", { manifest });
    expect(unproven.status).toBe(403);
    expect((await unproven.json()).message).toContain("Install Slopbot");
    // The installation is authoritative: read access is not enough.
    access = {
      installation: "installed",
      installationId: 7,
      permission: "read",
      roleName: "triage",
    };
    const reader = await call("POST", "projects", "applicant", { manifest });
    expect(reader.status).toBe(403);
    expect((await reader.json()).message).toContain("Write, maintain or admin");
    // A failed lookup is a retry, not an application waiting for an admin.
    deps.repositoryControl = async () => {
      throw new Error("GitHub is down");
    };
    access = "unavailable";
    const retry = await call("POST", "projects", "applicant", { manifest });
    expect(retry.status).toBe(503);
    expect((await retry.json()).error).toBe("github_unavailable");
    expect(await persistence.listProjects()).toEqual([]);
    // Maintain access read through the installation creates the project.
    access = {
      installation: "installed",
      installationId: 7,
      permission: "write",
      roleName: "maintain",
    };
    const accepted = await call("POST", "projects", "applicant", { manifest });
    expect(accepted.status).toBe(201);
    const body = await accepted.json();
    expect(body.project).toMatchObject({ id: "open-registry", revision: 1 });
    expect(body.setup.checks.authority).toEqual({
      state: "verified",
      basis: "installation",
      message: "@e2e-applicant has maintain access to example/open-registry.",
    });
    const revisions = sqlite
      .query("SELECT actor_github_login, reason FROM project_revisions")
      .all() as { actor_github_login: string; reason: string }[];
    expect(revisions).toEqual([
      {
        actor_github_login: "e2e-applicant",
        reason:
          "Created through self-service setup by @e2e-applicant. @e2e-applicant has maintain access to example/open-registry.",
      },
    ]);
    // No application, admin email or approval notice is created.
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM project_applications").get(),
    ).toEqual({ n: 0 });
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM notifications").get(),
    ).toEqual({ n: 0 });
    // The same repository cannot be listed twice.
    const again = await call("POST", "projects", "applicant", {
      manifest: applicationManifest("second-registry", "example/open-registry"),
    });
    expect(again.status).toBe(409);
  });

  test("serves the exact approved bytes of a revision", async () => {
    await listProject();
    const response = await call("GET", "project-revisions/open-registry/1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(await sha256Hex(body.manifestText)).toBe(body.manifestSha256);
    expect(JSON.parse(body.manifestText)).toMatchObject({
      id: "open-registry",
      contribution: CONTRIBUTION,
    });
    expect(
      (await call("GET", "project-revisions/open-registry/2")).status,
    ).toBe(404);
  });

  test("looks up GitHub only for a signed-in visitor and caches the facts", async () => {
    expect(
      (await call("GET", "project-github/repositories/example/open-registry"))
        .status,
    ).toBe(401);
    const first = await call(
      "GET",
      "project-github/repositories/example/open-registry",
      "applicant",
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, max-age=300");
    expect((await first.json()).repository).toMatchObject({
      repository: "example/open-registry",
      numericId: "123456789",
      license: { state: "unknown" },
    });
    const reads = githubReads.length;
    const second = await call(
      "GET",
      "project-github/repositories/example/open-registry",
      "applicant",
    );
    expect(second.headers.get("x-slop-cache")).toBe("hit");
    expect(githubReads).toHaveLength(reads);
    const missing = await call(
      "GET",
      "project-github/repositories/example/missing",
      "applicant",
    );
    expect(missing.status).toBe(404);
  });
});

function files(path: string): string[] {
  const absolute = join(resolve(import.meta.dir, ".."), path);
  return readdirSync(absolute, { recursive: true })
    .map(String)
    .filter((entry) => statSync(join(absolute, entry)).isFile())
    .map((entry) => relative(absolute, join(absolute, entry)))
    .sort();
}

/** Serves project artifacts from this test's D1 and the real templates. */
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
        async () => {
          if (livePin.commitSha === "unreadable")
            throw new Error("GitHub returned 502.");
          return { commitSha: livePin.commitSha, templateSha256 };
        },
      ),
    cache,
  };
  const get = (path: string) =>
    handleProjectArtifactRequest(
      new Request(`${ORIGIN}${path}`),
      publication,
    ) as Promise<Response>;
  return { publication, get, index };
}

describe("generated skill publication", () => {
  test("an id derived from a long project name renders the reviewer skill", async () => {
    // /projects/new derives the id from the name. The reviewer skill is
    // `review-<id>-contributions`, and a skill name has at most 64 characters.
    const id = slugify(
      "Reproducible Research Toolkit for Everyone, Everywhere",
    );
    await listProject(applicationManifest(id, "example/open-registry"));
    const project = await persistence.getProject(id);
    if (project === null) throw new Error("project was not listed");
    const { index } = await publicationRequests();
    const root = resolve(import.meta.dir, "..");
    const files = await buildProjectPublication({
      template: index,
      readFile: async (path: string) =>
        new Uint8Array(readFileSync(join(root, path))),
      project: project.manifest,
      revision: project.revision,
      manifestSha256: project.manifestSha256,
      generatedAt: project.updatedAt,
    });
    const reviewer = `review-${id}-contributions`;
    expect(reviewer.length).toBeLessThanOrEqual(64);
    expect(Object.keys(files ?? {})).toContain(`downloads/${reviewer}.skill`);
  });

  test("historical clean metadata cannot publish skills without canonical closure", async () => {
    const { publication, get } = await publicationRequests();
    expect(
      await handleProjectArtifactRequest(
        new Request(`${ORIGIN}/projects/open-registry`),
        publication,
      ),
    ).toBeNull();
    expect((await get("/projects/open-registry/skill.md")).status).toBe(404);
    await listProject();
    expect((await get("/projects/open-registry/skill.md")).status).toBe(404);
    await seedHistoricalResult("open-registry");
    for (const path of [
      "skill.md",
      "SKILL.md",
      "skill-manifest.json",
      "review/SKILL.md",
      "downloads/contribute-to-open-registry.skill",
      "codex.md",
      "claude.md",
      "manual.md",
    ])
      expect((await get(`/projects/open-registry/${path}`)).status).toBe(503);
    expect(
      (await (await get("/.well-known/slop/projects.json")).json()).projects,
    ).toEqual([]);
    const current = await persistence.getProject("open-registry");
    const revised = await call(
      "PUT",
      "admin/projects/open-registry/manifest",
      "admin",
      {
        manifest: {
          ...current?.manifest,
          headline: "Reproducible tooling, second revision.",
        },
        expectedRevision: 1,
        reason: "Second revision",
      },
    );
    expect(revised.status).toBe(200);
    // A presentation change keeps the scanned content, so the gate is unchanged.
    expect((await get("/projects/open-registry/skill.md")).status).toBe(503);
    const executable = await call(
      "PUT",
      "admin/projects/open-registry/manifest",
      "admin",
      {
        manifest: {
          ...current?.manifest,
          headline: "Reproducible tooling, second revision.",
          contribution: { ...CONTRIBUTION, maintainerNotes: "New note." },
        },
        expectedRevision: 2,
        reason: "Third revision",
      },
    );
    expect(executable.status).toBe(200);
    // Changed skill inputs have no scan yet.
    expect((await get("/projects/open-registry/skill.md")).status).toBe(404);
    await seedHistoricalResult("open-registry");
    expect((await get("/projects/open-registry/skill.md")).status).toBe(503);
  });
});

describe("project enforcement (ADM-06)", () => {
  const EVIDENCE =
    "https://github.com/example/open-registry/security/advisories/GHSA-test";

  async function enforce(
    actor: "admin" | "moderator",
    action: string,
    mode: "enforcement" | "enforcement-preview" = "enforcement",
  ) {
    const project = await persistence.getProject("open-registry");
    const records = await persistence.listEnforcements();
    return call("POST", `admin/projects/open-registry/${mode}`, actor, {
      action,
      reason: `Moderator note for ${action}`,
      evidenceReference: EVIDENCE,
      expectedRevision: project?.revision,
      expectedSequence: records.length + 1,
    });
  }

  test("quarantines and bans while refusing an appeal with only historical clean metadata", async () => {
    const { get } = await publicationRequests();
    await listProject();
    await seedHistoricalResult("open-registry");
    // Retained metadata is not canonical closure, so the project stays paused.
    expect((await call("GET", "projects")).status).toBe(200);
    expect((await call("GET", "projects")).headers.get("x-slop-cache")).toBe(
      "hit",
    );
    expect((await get("/projects/open-registry/SKILL.md")).status).toBe(503);
    expect(
      (await (await get("/.well-known/slop/projects.json")).json()).projects,
    ).toEqual([]);

    // Without a configured moderator role the actions stay closed.
    deps.moderatorGithubIds = new Set();
    const closed = await enforce("admin", "quarantine");
    expect(closed.status).toBe(403);
    expect((await closed.json()).error).toBe("moderation_unavailable");
    deps.moderatorGithubIds = new Set([ADMIN.githubId, MODERATOR.githubId]);

    // The preview shows the exact revision and writes nothing.
    const preview = await enforce("admin", "quarantine", "enforcement-preview");
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview).toMatchObject({
      stateBefore: "clear",
      stateAfter: "quarantined",
      result: "revision_appended",
      revision: {
        before: 1,
        after: 2,
        statusBefore: "paused",
        statusAfter: "paused",
        listingTierBefore: "community",
        listingTierAfter: "retired",
      },
    });
    expect(await persistence.listEnforcements()).toEqual([]);

    const quarantined = await enforce("admin", "quarantine");
    expect(quarantined.status).toBe(200);
    expect((await quarantined.json()).record).toMatchObject({
      sequence: 1,
      action: "quarantine",
      actor: ADMIN,
      actorRole: "project-moderator",
      decisionSource: "admin-panel",
      evidenceReference: EVIDENCE,
      repositoryGithubId: "123456789",
      repositoryKeys: ["example/open-registry"],
      beforeRevision: 1,
      afterRevision: 2,
      result: "revision_appended",
    });
    const revision = await persistence.getProject("open-registry");
    expect(revision).toMatchObject({ revision: 2, status: "paused" });
    expect(revision?.manifest.listingTier).toBe("retired");
    // The warm caches cannot serve the project after the record lands.
    const list = await call("GET", "projects");
    expect(list.headers.get("x-slop-cache")).toBe("miss");
    expect((await list.json()).restrictions).toMatchObject([
      { projectId: "open-registry", state: "quarantined", appeal: "none" },
    ]);
    const single = await call("GET", "projects/open-registry");
    expect(single.status).toBe(410);
    expect((await single.json()).restriction.state).toBe("quarantined");
    expect((await get("/projects/open-registry/SKILL.md")).status).toBe(410);
    expect(
      (
        await get(
          "/projects/open-registry/downloads/contribute-to-open-registry.skill",
        )
      ).status,
    ).toBe(410);
    expect(
      (await (await get("/.well-known/slop/projects.json")).json()).projects,
    ).toEqual([]);

    // A revision cannot lift the restriction.
    const lifted = await call(
      "PUT",
      "admin/projects/open-registry/manifest",
      "admin",
      {
        manifest: { ...revision?.manifest, listingTier: "community" },
        expectedRevision: 2,
        reason: "Try to relist",
      },
    );
    expect(lifted.status).toBe(409);
    expect((await lifted.json()).error).toBe("project_restricted");
    // Neither can a new project for the renamed repository.
    const renamed = await create(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    expect(renamed.status).toBe(403);
    expect((await renamed.json()).error).toBe("repository_restricted");

    // Escalation to a ban needs no second revision.
    const banned = await enforce("admin", "ban");
    expect(banned.status).toBe(200);
    expect((await banned.json()).record).toMatchObject({
      stateAfter: "banned",
      result: "no_revision_needed",
      afterRevision: null,
    });
    const early = await enforce("moderator", "reinstate");
    expect(early.status).toBe(409);
    expect((await early.json()).error).toBe("no_open_appeal");
    // ELG-02: the applicant who listed the project files the appeal. Another
    // account that is neither steward nor applicant cannot.
    const appeal = {
      projectId: "open-registry",
      reason: "The release script was removed",
      evidenceReference: EVIDENCE,
    };
    const stranger = await call("POST", "project-appeals", "moderator", appeal);
    expect(stranger.status).toBe(403);
    const appealed = await call("POST", "project-appeals", "applicant", appeal);
    expect(appealed.status).toBe(200);
    expect((await appealed.json()).record).toMatchObject({
      action: "request_reinstatement",
      actor: APPLICANT,
      actorRole: "project-applicant",
      decisionSource: "owner-request",
      stateAfter: "banned",
      appealAfter: "requested",
      afterRevision: null,
    });
    const again = await call("POST", "project-appeals", "applicant", appeal);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("appeal_open");
    // An owner record can only be an appeal.
    expect(() =>
      sqlite.exec(
        `INSERT INTO project_enforcements (${ENFORCEMENT_COLUMNS}) SELECT 'enf_owner_forged', project_id, 4, 'reinstate', 'clear', 'granted', reason, evidence_reference, repository_github_id, repository_keys, actor_github_id, actor_github_login, actor_role, decision_source, before_revision, before_manifest_sha256, NULL, NULL, 'no_revision_needed', created_at, NULL FROM project_enforcements WHERE sequence = 3`,
      ),
    ).toThrow("CHECK constraint failed");
    // The moderator who banned cannot decide the appeal.
    const self = await enforce("admin", "reinstate");
    expect(self.status).toBe(403);
    expect((await self.json()).error).toBe("independent_review_required");
    const unscannedAppeal = await enforce("moderator", "reinstate");
    expect(unscannedAppeal.status).toBe(409);
    expect((await unscannedAppeal.json()).error).toBe("vetting_required");
    expect((await call("GET", "projects/open-registry")).status).toBe(410);
    const maliciousId = await seedHistoricalResult(
      "open-registry",
      "malicious",
    );
    const cleanId = await seedHistoricalResult("open-registry");
    // A clean scan alone cannot waive a confirmed malicious finding.
    const restrictedProject = await persistence.getProject("open-registry");
    if (!restrictedProject) throw new Error("Missing restricted project");
    const bannedClearance = await vetting.manifestClearance(
      "open-registry",
      restrictedProject.manifest,
      2,
      async () => livePin,
    );
    expect(bannedClearance.state).toBe("banned");
    const scannedPin = livePin;
    livePin = { ...livePin, commitSha: "b".repeat(40) };
    const staleScan = await enforce("moderator", "reinstate");
    expect(staleScan.status).toBe(409);
    expect((await staleScan.json()).error).toBe("vetting_required");
    livePin = scannedPin;
    const refused = await enforce("moderator", "reinstate");
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("vetting_required");
    expect(
      sqlite
        .query("SELECT count(*) AS n FROM project_vetting_reinstatements")
        .get(),
    ).toEqual({ n: 0 });
    const restricted = await persistence.getProject("open-registry");
    expect(restricted).toMatchObject({ revision: 2, status: "paused" });
    expect(restricted?.manifest.listingTier).toBe("retired");
    expect((await call("GET", "projects/open-registry")).status).toBe(410);
    expect((await get("/projects/open-registry/SKILL.md")).status).toBe(410);

    // A concurrent revision must abort the database write, not leave a
    // scanner result or appeal pointing at an enforcement that did not land.
    const records = await persistence.listEnforcements();
    const latestRecord = records.at(-1);
    if (!latestRecord) throw new Error("Missing enforcement record");
    expect(
      await persistence.appendEnforcement(
        {
          ...latestRecord,
          id: "enf_stale_database_revision",
          sequence: latestRecord.sequence + 1,
          beforeRevision: 999,
        },
        null,
        [],
      ),
    ).toBe("conflict");
    expect(await persistence.listEnforcements()).toHaveLength(records.length);
    // A stale preview cannot be confirmed, and history is append-only.
    const stale = await call(
      "POST",
      "admin/projects/open-registry/enforcement",
      "moderator",
      {
        action: "quarantine",
        reason: "Stale",
        evidenceReference: EVIDENCE,
        expectedRevision: 4,
        expectedSequence: 1,
      },
    );
    expect(stale.status).toBe(409);
    expect(() =>
      sqlite.exec("UPDATE project_enforcements SET reason = 'edited'"),
    ).toThrow("immutable");
    expect(() => sqlite.exec("DELETE FROM project_enforcements")).toThrow(
      "permanent",
    );
    const history = await call("GET", "admin/projects", "moderator");
    expect(
      (await history.json()).projects[0].enforcement.records.map(
        (record: { action: string }) => record.action,
      ),
    ).toEqual(["quarantine", "ban", "request_reinstatement", "ban"]);
    // Independently preserve the append-only persistence contract. This is
    // historical database setup, never HTTP admission or a complete scan.
    if (!restricted || !latestRecord)
      throw new Error("Missing restricted state");
    const plan = planEnforcement({
      action: "reinstate",
      actor: MODERATOR,
      project: restricted,
      restriction: projectRestriction("open-registry", records),
      listedBefore: true,
    });
    if (!plan.manifest) throw new Error("Missing reinstatement revision plan");
    const manifestText = JSON.stringify(plan.manifest);
    const manifestSha256 = await sha256Hex(
      new TextEncoder().encode(manifestText),
    );
    const at = "2026-10-18T13:00:00.000Z";
    expect(
      await persistence.appendEnforcement(
        {
          ...latestRecord,
          id: "enf_historical_persistence_review",
          sequence: latestRecord.sequence + 1,
          action: "reinstate",
          stateAfter: "clear",
          appealAfter: "granted",
          actor: MODERATOR,
          actorRole: "project-moderator",
          decisionSource: "admin-panel",
          beforeRevision: restricted.revision,
          beforeManifestSha256: restricted.manifestSha256,
          afterRevision: restricted.revision + 1,
          afterManifestSha256: manifestSha256,
          result: "revision_appended",
          systemIssuer: undefined,
          vettingReview: {
            assessmentId: cleanId,
            maliciousAssessmentIds: [maliciousId],
          },
          createdAt: at,
        },
        {
          projectId: restricted.id,
          expectedRevision: restricted.revision,
          manifest: plan.manifest,
          manifestText,
          manifestSha256,
          reason: "Historical persistence contract",
          actor: MODERATOR,
          at,
        },
        [],
      ),
    ).toBe("recorded");
    const bridge = sqlite
      .query("SELECT * FROM project_vetting_reinstatements")
      .get() as { assessment_id: string; malicious_assessment_ids: string };
    expect(bridge.assessment_id).toBe(cleanId);
    expect(JSON.parse(bridge.malicious_assessment_ids)).toEqual([maliciousId]);
    expect(() =>
      sqlite.exec("DELETE FROM project_vetting_reinstatements"),
    ).toThrow("permanent");
    // Even a stored historical appeal cannot publish skills without closure.
    expect((await get("/projects/open-registry/SKILL.md")).status).not.toBe(
      200,
    );
    await seedHistoricalResult("open-registry", "malicious");
    const restored = await persistence.getProject("open-registry");
    if (!restored) throw new Error("Missing restored persistence revision");
    expect(
      (
        await vetting.manifestClearance(
          "open-registry",
          restored.manifest,
          restored.revision,
          async () => livePin,
        )
      ).state,
    ).toBe("banned");
  });

  test("a revision of another project cannot claim a banned repository", async () => {
    await listProject();
    // Listed before the ban: the renamed repository, same GitHub id.
    await listProject(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    // Listed before the ban: a different repository.
    const base = applicationManifest(
      "other-registry",
      "example/other-registry",
    );
    await listProject({
      ...base,
      authority: {
        ...(base.authority as Record<string, unknown>),
        repositoryId: "222222222",
        repositoryNodeId: "R_other",
      },
    });
    expect((await enforce("admin", "quarantine")).status).toBe(200);
    expect((await enforce("admin", "ban")).status).toBe(200);
    async function revise(
      projectId: string,
      change: (manifest: ProjectDefinition) => Record<string, unknown>,
    ) {
      const project = await persistence.getProject(projectId);
      if (project === null) throw new Error(`${projectId} is not listed`);
      const response = await call(
        "PUT",
        `admin/projects/${projectId}/manifest`,
        "admin",
        {
          manifest: change(project.manifest),
          expectedRevision: 1,
          reason: "List the banned repository again",
        },
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("repository_restricted");
      expect(await persistence.getProject(projectId)).toMatchObject({
        revision: 1,
      });
    }
    // The banned repository's GitHub id under its new name.
    await revise("renamed-registry", (manifest) => ({
      ...manifest,
      listingTier: "featured",
    }));
    // The banned repository's old path appended as an alias.
    await revise("other-registry", (manifest) => ({
      ...manifest,
      repositories: manifest.repositories.map((repository) => ({
        ...repository,
        aliases: ["example/open-registry"],
      })),
    }));
  });

  test("a ban closes the public routes of another project listed for the repository", async () => {
    const { publication } = await publicationRequests();
    // Vetting is a separate gate; a clean scan lets this test reach the
    // restriction gate on every artifact route.
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
    const routes = [
      "/projects/renamed-registry/skill.md",
      "/projects/renamed-registry/downloads/contribute-to-renamed-registry.skill",
    ];
    await listProject();
    // Listed before the ban: the renamed repository, same GitHub id.
    await listProject(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    for (const route of routes) expect((await get(route)).status).toBe(200);
    expect((await enforce("admin", "quarantine")).status).toBe(200);
    expect((await enforce("admin", "ban")).status).toBe(200);

    for (const route of routes) expect((await get(route)).status).toBe(410);
    expect(
      (await (await get("/.well-known/slop/projects.json")).json()).projects,
    ).toEqual([]);
    const single = await call("GET", "projects/renamed-registry");
    expect(single.status).toBe(410);
    const closed = await single.json();
    // The record, and so the only appeal, lives on the banned project.
    expect(closed.restriction).toMatchObject({
      projectId: "renamed-registry",
      sourceProjectId: "open-registry",
      state: "banned",
    });
    expect(closed.message).toContain("open-registry");
    expect((await (await call("GET", "projects")).json()).restrictions).toEqual(
      [
        expect.objectContaining({
          projectId: "open-registry",
          sourceProjectId: "open-registry",
          state: "banned",
        }),
        expect.objectContaining({
          projectId: "renamed-registry",
          sourceProjectId: "open-registry",
          state: "banned",
        }),
      ],
    );
  });

  test("another project listed for a banned repository can still be retired", async () => {
    await listProject();
    // Listed before the ban: the renamed repository, same GitHub id.
    await listProject(
      applicationManifest("renamed-registry", "example/renamed-registry"),
    );
    expect((await enforce("admin", "quarantine")).status).toBe(200);
    expect((await enforce("admin", "ban")).status).toBe(200);
    const registry = async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: string | URL | Request) =>
        handleProjectApi(new Request(input), deps)) as typeof fetch;
      try {
        return await fetchProjectRegistry(ORIGIN);
      } finally {
        globalThis.fetch = originalFetch;
      }
    };
    // projects:sync asks an admin to append B's paused, retired revision.
    expect((await registry()).withheld).toEqual(["renamed-registry"]);
    async function revise(
      change: (manifest: ProjectDefinition) => Record<string, unknown>,
    ) {
      const project = await persistence.getProject("renamed-registry");
      if (project === null) throw new Error("renamed-registry is not listed");
      return call("PUT", "admin/projects/renamed-registry/manifest", "admin", {
        manifest: change(project.manifest),
        expectedRevision: project.revision,
        reason: "Retire the project of the banned repository",
      });
    }
    const retire = (manifest: ProjectDefinition) => ({
      ...manifest,
      status: "paused",
      listingTier: "retired",
    });
    // Every other revision still cannot claim the banned repository.
    for (const change of [
      (manifest: ProjectDefinition) => ({ ...manifest, status: "active" }),
      (manifest: ProjectDefinition) => ({
        ...manifest,
        listingTier: "featured",
      }),
      (manifest: ProjectDefinition) => ({
        ...retire(manifest),
        repositories: manifest.repositories.map((repository) => ({
          ...repository,
          aliases: ["example/open-registry"],
        })),
      }),
    ]) {
      const refused = await revise(change);
      expect(refused.status).toBe(403);
      expect((await refused.json()).error).toBe("repository_restricted");
    }
    expect(await persistence.getProject("renamed-registry")).toMatchObject({
      revision: 1,
    });

    expect((await revise(retire)).status).toBe(200);
    expect(await persistence.getProject("renamed-registry")).toMatchObject({
      revision: 2,
      manifest: { status: "paused", listingTier: "retired" },
    });
    expect((await registry()).withheld).toEqual([]);
    // The retired project cannot be listed again while the ban holds.
    const restored = await revise((manifest) => ({
      ...manifest,
      listingTier: "community",
    }));
    expect(restored.status).toBe(403);
    expect((await restored.json()).error).toBe("repository_restricted");
  });

  test("reinstatement is refused while the restriction revision is pending", async () => {
    await listProject();
    const listed = await persistence.getProject("open-registry");
    if (listed === null) throw new Error("project missing");
    // The quarantine found an active, featured manifest whose paused,
    // retired revision could not be appended, and the appeal is open.
    const project = {
      ...listed,
      manifest: {
        ...listed.manifest,
        status: "active",
        listingTier: "featured",
      } as ProjectDefinition,
    };
    const restriction = {
      ...projectRestriction("open-registry", []),
      state: "quarantined" as const,
      appeal: "requested" as const,
      restrictedBy: [ADMIN],
      openedAtRevision: 1,
    };
    let refusal: unknown = null;
    try {
      planEnforcement({
        action: "reinstate",
        actor: MODERATOR,
        project,
        restriction,
        listedBefore: true,
      });
    } catch (error) {
      refusal = error;
    }
    // Clearing it would restore the featured, active manifest unreviewed.
    expect(refusal).toBeInstanceOf(EnforcementRefusal);
    expect((refusal as EnforcementRefusal).code).toBe("revision_pending");
    expect((refusal as EnforcementRefusal).status).toBe(409);
  });

  test("a revision fails when a restriction lands after its read", async () => {
    await listProject();
    const listed = await persistence.getProject("open-registry");
    // Retired already, so the quarantine appends no revision of its own and
    // only the enforcement guard can refuse the stale write.
    const retired = await call(
      "PUT",
      "admin/projects/open-registry/manifest",
      "admin",
      {
        manifest: { ...listed?.manifest, listingTier: "retired" },
        expectedRevision: 1,
        reason: "Retire",
      },
    );
    expect(retired.status).toBe(200);
    const read = persistence.listEnforcements.bind(persistence);
    // The quarantine lands between the restriction read and the append.
    persistence.listEnforcements = async () => {
      const records = await read();
      persistence.listEnforcements = read;
      const quarantined = await enforce("admin", "quarantine");
      expect((await quarantined.json()).record.result).toBe(
        "no_revision_needed",
      );
      return records;
    };
    const raced = await call(
      "PUT",
      "admin/projects/open-registry/manifest",
      "admin",
      {
        manifest: { ...listed?.manifest, listingTier: "community" },
        expectedRevision: 2,
        reason: "List again",
      },
    );
    expect(raced.status).toBe(409);
    const after = await persistence.getProject("open-registry");
    expect(after).toMatchObject({ revision: 2, status: "paused" });
    expect(after?.manifest.listingTier).toBe("retired");
  });
});

test("cached skill and public clearance cannot survive loss of retained evidence", async () => {
  const { get } = await publicationRequests();
  await listProject();
  const id = await seedHistoricalResult("open-registry");
  const assessment = await vetting.getAssessment(id);
  if (!assessment?.result) throw new Error("Missing fixture assessment");
  const skillPath = "/projects/open-registry/skill.md";
  const oldSkill = await get(skillPath);
  const oldDetail = await call("GET", "projects/open-registry");
  expect(oldSkill.status).toBe(503);
  expect((await oldDetail.clone().json()).skillsPublished).toBe(false);
  const generation = await persistence.enforcementGeneration();
  // Seed the exact legacy cache keys, as if an earlier deployment had cached them.
  for (const [path, response] of [
    [skillPath, new Response("Previously cached skill bytes")],
    [
      "/api/v1/projects/open-registry",
      new Response(
        JSON.stringify({
          skillsPublished: true,
          vetting: { state: "cleared" },
        }),
      ),
    ],
    [
      "/.well-known/slop/projects.json",
      new Response(
        JSON.stringify({
          schemaVersion: "1",
          projects: [
            {
              project_id: "open-registry",
              repository: "example/open-registry",
              skill: "contribute-to-open-registry",
            },
          ],
        }),
      ),
    ],
  ] as const)
    await cache.put(
      new Request(`${ORIGIN}/__slop-cache/projects-v1/g${generation}${path}`),
      response,
    );
  await retained.bucket.delete(
    `vetting/${id}/${assessment.result.environment.runId}/${assessment.result.traceSha256}`,
  );
  const refused = await get(skillPath);
  expect(refused.status).toBe(503);
  expect(refused.headers.get("cache-control")).toBe("no-store");
  const detail = await call("GET", "projects/open-registry");
  expect(detail.headers.get("access-control-allow-origin")).toBe("*");
  expect(detail.headers.get("cache-control")).toContain("no-store");
  expect(await detail.json()).toMatchObject({
    skillsPublished: false,
    vetting: { state: "unverified" },
  });
  expect(
    (await (await get("/.well-known/slop/projects.json")).json()).projects,
  ).toEqual([]);
});

describe("referral attribution (PRJ-05)", () => {
  const REFERRER = { githubId: "900000010", githubLogin: "e2e-referrer" };
  const liveActors = new Map<
    string,
    { githubId: string; githubLogin: string }
  >();
  beforeEach(() => {
    liveActors.clear();
    const fetcher = deps.github.fetch;
    deps.github.fetch = async (url, init) => {
      const match = /^https:\/\/api.github.com\/users\/([^/?]+)$/.exec(url);
      if (!match) return fetcher(url, init);
      const actor = liveActors.get(match[1].toLowerCase());
      return actor
        ? Response.json({
            id: Number(actor.githubId),
            login: actor.githubLogin,
            type: "User",
          })
        : new Response(null, { status: 404 });
    };
  });
  /** A signed-in slop.cash account, as the points sign-in records one. */
  function joinMember(actor: { githubId: string; githubLogin: string }) {
    liveActors.set(actor.githubLogin.toLowerCase(), actor);
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
      )
      .run(
        actor.githubId,
        actor.githubId,
        actor.githubLogin,
        "2026-10-01T00:00:00.000Z",
      );
  }

  test("records the referrer once on the created project", async () => {
    joinMember(REFERRER);
    const manifest = applicationManifest("referred", "example/referred");
    const submitted = await create(manifest, { referrer: "E2E-Referrer" });
    expect(submitted.status).toBe(201);
    const { project } = await submitted.json();
    // Store the current canonical GitHub login, not the input casing.
    expect(project.referrer).toEqual(REFERRER);
    expect((await persistence.getProject("referred"))?.referrer).toEqual(
      REFERRER,
    );
    const admin = await call("GET", "admin/projects", "admin");
    expect(
      (await admin.json()).projects.find(
        (entry: { id: string }) => entry.id === "referred",
      ).referrer,
    ).toEqual(REFERRER);
    // Neither row can change or drop the referrer afterwards.
    expect(() =>
      sqlite.exec(
        "UPDATE projects SET referrer_github_login = 'other' WHERE id = 'referred'",
      ),
    ).toThrow(/project referrer is immutable/u);
    expect(() =>
      sqlite.exec(
        "UPDATE projects SET referrer_github_id = NULL WHERE id = 'referred'",
      ),
    ).toThrow(/project referrer is immutable/u);
  });

  test("a recycled login cannot attribute the applicant to an older cached member", async () => {
    joinMember({ githubId: "900000020", githubLogin: APPLICANT.githubLogin });
    joinMember(APPLICANT);
    const manifest = applicationManifest("recycled", "example/recycled");
    const response = await create(manifest, {
      referrer: APPLICANT.githubLogin,
    });
    expect(response.status).toBe(422);
    expect((await response.json()).message).toMatch(
      /cannot refer your own project/u,
    );
    expect(await persistence.listProjects()).toEqual([]);
    // Even one stale cached row is insufficient if the current holder has never joined.
    liveActors.set(APPLICANT.githubLogin.toLowerCase(), {
      githubId: "900000030",
      githubLogin: APPLICANT.githubLogin,
    });
    const unknown = await create(manifest, {
      referrer: APPLICANT.githubLogin,
    });
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).message).toMatch(/has not signed in/u);
  });

  test("a project that names nobody records no referrer", async () => {
    const project = await listProject();
    expect(project.referrer).toBeNull();
    expect(
      (await persistence.getProject("open-registry"))?.referrer,
    ).toBeNull();
  });

  test("refuses the applicant, the steward, team accounts and unknown logins", async () => {
    joinMember(APPLICANT);
    joinMember(ADMIN);
    joinMember({ githubId: "987654321", githubLogin: "example" });
    const manifest = applicationManifest("refused", "example/refused");
    const cases: [unknown, RegExp][] = [
      ["e2e-applicant", /cannot refer your own project/u],
      ["example", /steward cannot be recorded/u],
      ["e2e-admin", /team accounts cannot be recorded/u],
      ["nobody-here", /has not signed in to slop\.cash/u],
      ["not a login!", /must be a GitHub login/u],
      [42, /must be a GitHub login/u],
    ];
    for (const [referrer, message] of cases) {
      const response = await create(manifest, { referrer });
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error).toBe("invalid_referrer");
      expect(body.message).toMatch(message);
    }
    // A refused referral stores nothing, so the owner can submit again.
    expect(await persistence.listProjects()).toEqual([]);
    const accepted = await create(manifest, { referrer: null });
    expect(accepted.status).toBe(201);
    expect((await accepted.json()).project.referrer).toBeNull();
  });
});
