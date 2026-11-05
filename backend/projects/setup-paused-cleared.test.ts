/**
 * A paused project whose scan has cleared but which the setup check cannot
 * activate must not be told to retry the scan: the scan already passed, and
 * re-checking queues nothing. When the manifest's generated-skill content
 * is incomplete, activation is refused (appendRevision rejects an active
 * revision without it), so the status names that blocker; when the content
 * is complete, a fresh check is what activates the project.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import type {
  ProjectRecord,
  RepositoryAccess,
} from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { VettingClearance } from "../../src/lib/vetting-contracts";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { CloudflareProjectPersistence } from "./cloudflare-persistence";
import { projectRestriction } from "./enforcement";
import { handleProjectApi, type ProjectApiDependencies } from "./handler";
import type { ScanRequest } from "./setup";
import { projectSetupStatus } from "./setup";
import { TokenMetadataError } from "./token-metadata";

const at = "2026-10-27T12:00:00.000Z";
const ADMIN = "900000001";
const OWNER = "900000002";
const NOW = "2026-10-19T12:00:00.000Z";

const ADMISSION: VettingClearance = {
  state: "cleared",
  basis: "admission",
  assessment: {
    id: "vet_00000000000000000000000000000001",
    revision: 1,
    state: "clean",
    commitSha: "a".repeat(40),
    templateSha256: "d".repeat(64),
    policyVersion: "fixture",
    requestedAt: at,
    completedAt: at,
    modelRuns: [],
    artifacts: 0,
    heldArtifacts: 0,
  },
};

const GRANDFATHERED: VettingClearance = {
  state: "cleared",
  assessment: null,
  grandfathered: true,
};

function record(manifest: ProjectDefinition): ProjectRecord {
  return {
    id: manifest.id,
    status: "paused",
    revision: 3,
    manifest,
    manifestSha256: "a".repeat(64),
    createdAt: at,
    updatedAt: at,
    sourceApplicationId: null,
    referrer: null,
  };
}

function status(
  project: ProjectRecord,
  clearance: VettingClearance | { state: "unavailable"; message: string },
) {
  return projectSetupStatus({
    project,
    restriction: projectRestriction(project.id, []),
    authority: { state: "verified", message: "Fixture authority check." },
    access: {
      state: "read",
      access: {
        installation: "installed",
        installationId: 42,
        permission: "admin",
        roleName: "admin",
      },
    },
    clearance,
    scanRequest: null,
    activatedRevision: null,
    checkedAt: at,
  });
}

/**
 * The legacy shape the frozen fixture registry shows for the
 * pre-self-service projects (canonry, darling-arm64, feed, nurosos,
 * payzcode-ai are paused in it): per-project skill paths and no
 * contribution rules, so generated skills do not publish.
 */
function legacyManifest(id: string, repository: string): ProjectDefinition {
  const manifest = applicationManifest(id, repository, {
    status: "paused",
  }) as unknown as Record<string, unknown>;
  delete manifest.contribution;
  manifest.skill = {
    ...(manifest.skill as Record<string, unknown>),
    id: `contribute-to-${id}`,
    sourcePath: `skills/contribute-to-${id}`,
    publicPath: `/projects/${id}/skill.md`,
  };
  manifest.reviewSkill = {
    ...(manifest.reviewSkill as Record<string, unknown>),
    id: `review-${id}-contributions`,
    sourcePath: `skills/review-${id}-contributions`,
  };
  return manifest as unknown as ProjectDefinition;
}

describe("paused project with a cleared scan", () => {
  test("an exempt legacy project is told to complete its skill content, not to retry the scan", () => {
    const result = status(
      record(legacyManifest("canonry", "Canonry/canonry")),
      GRANDFATHERED,
    );
    expect(result.checks.scan).toMatchObject({
      state: "cleared",
      exempt: true,
      exemptionKind: "existing-project",
    });
    expect(result.state).toBe("action_required");
    expect(result.nextAction.kind).toBe("complete_skill_content");
    expect(result.nextAction.message).toContain("permanently exempt");
    expect(result.nextAction.message).toContain("contribution rules");
  });

  test("an admission-cleared legacy project names the same blocker", () => {
    const result = status(
      record(legacyManifest("canonry", "Canonry/canonry")),
      ADMISSION,
    );
    expect(result.state).toBe("action_required");
    expect(result.nextAction.kind).toBe("complete_skill_content");
    expect(result.nextAction.message).toContain(
      "Repository admission passed at revision 1.",
    );
  });

  test("a paused project with complete skill content is told a check activates it", () => {
    const manifest = applicationManifest(
      "setup-paused",
      "example/setup-paused",
      { status: "paused" },
    ) as unknown as ProjectDefinition;
    const result = status(record(manifest), ADMISSION);
    expect(result.state).toBe("action_required");
    expect(result.nextAction.kind).toBe("activate_project");
    expect(result.nextAction.message).toContain("still paused");
  });

  test("an unavailable scan still derives the scan retry", () => {
    const result = status(
      record(legacyManifest("canonry", "Canonry/canonry")),
      {
        state: "unavailable",
        message: "The scan service did not answer.",
      },
    );
    expect(result.state).toBe("retry");
    expect(result.nextAction).toMatchObject({
      kind: "retry_scan",
      message: "The scan service did not answer.",
    });
  });
});

function registry() {
  const { db } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const persistence = new CloudflareProjectPersistence(db);
  let sequence = 0;
  const state = {
    access: {
      installation: "installed",
      installationId: 42,
      permission: "admin",
      roleName: "admin",
    } as RepositoryAccess,
    clearance: { state: "unscanned" } as VettingClearance,
    scans: [] as string[],
    scanAnswer: { state: "queued" } as ScanRequest,
  };
  const deps: ProjectApiDependencies = {
    persistence,
    adminGithubIds: new Set([ADMIN]),
    moderatorGithubIds: new Set(),
    vettingClearance: async () => state.clearance,
    now: () => new Date(NOW),
    randomId: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    sessionActor: async (request) => {
      const actor = request.headers.get("x-test-actor");
      return actor
        ? { githubId: actor, githubLogin: actor === ADMIN ? "admin" : "owner" }
        : null;
    },
    readTokenMetadata: async () => {
      throw new TokenMetadataError("No contract exists at that token address");
    },
    github: {
      fetch: async () =>
        Response.json({ message: "Not Found" }, { status: 404 }),
    },
    repositoryControl: async () => ({ state: "matched" }),
    repositoryAccess: async () => state.access,
    requestScan: async (project, _actor, reason) => {
      state.scans.push(`${project.id}@${project.revision}: ${reason}`);
      return state.scanAnswer;
    },
  };
  const call = async (
    method: string,
    path: string,
    actor: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await handleProjectApi(
      new Request(`https://slop.cash/api/v1/${path}`, {
        method,
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
          "x-test-actor": actor,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      deps,
    );
    if (!response) return { status: 404, body: {} };
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  return { persistence, state, call };
}

type Setup = {
  state: string;
  status: string;
  nextAction: { kind: string; message: string; href: string | null };
  checks: { scan: { state: string } };
  activatedRevision: number | null;
};

test("the setup check reports the skill-content blocker and never queues a scan for it", async () => {
  const { persistence, state, call } = registry();
  const created = await call("POST", "projects", OWNER, {
    manifest: applicationManifest("open-registry", "example/open-registry"),
  });
  expect(created.status).toBe(201);
  const current = await persistence.getProject("open-registry");
  if (!current) throw new Error("project was not listed");
  // An admin revision gives the project the legacy shape the fixture
  // registry shows for the pre-self-service projects: per-project skill
  // paths and no contribution rules, still paused.
  const legacy = { ...current.manifest } as Record<string, unknown>;
  delete legacy.contribution;
  legacy.skill = {
    ...(current.manifest.skill as Record<string, unknown>),
    id: "contribute-to-open-registry",
    sourcePath: "skills/contribute-to-open-registry",
    publicPath: "/projects/open-registry/skill.md",
  };
  legacy.reviewSkill = {
    ...(current.manifest.reviewSkill as Record<string, unknown>),
    id: "review-open-registry-contributions",
    sourcePath: "skills/review-open-registry-contributions",
  };
  legacy.status = "paused";
  const revised = await call(
    "PUT",
    "admin/projects/open-registry/manifest",
    ADMIN,
    {
      manifest: legacy,
      expectedRevision: 1,
      reason: "Legacy shape for the paused setup status",
    },
  );
  expect(revised.status).toBe(200);
  state.clearance = GRANDFATHERED;
  const check = async () =>
    (await call("POST", "project-setup/open-registry/check", OWNER, {}))
      .body as { setup: Setup };
  const first = (await check()).setup;
  expect(first).toMatchObject({
    state: "action_required",
    status: "paused",
    activatedRevision: null,
    checks: { scan: { state: "cleared" } },
  });
  expect(first.nextAction.kind).toBe("complete_skill_content");
  expect(first.nextAction.message).toContain("contribution rules");
  // Re-checking changes nothing and queues no scan: only the report moved.
  const second = (await check()).setup;
  expect(second.nextAction).toEqual(first.nextAction);
  expect(state.scans).toHaveLength(1);
  expect(await persistence.getProject("open-registry")).toMatchObject({
    status: "paused",
    revision: 2,
  });
});
