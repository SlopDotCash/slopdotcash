/**
 * Self-service project setup (PRD section 4) on the real migrations: owners
 * create projects without an admin, applications stored before the change
 * publish without being entered again, the registry stays unique, owner
 * revisions classify their changes, and setup activates a project only when
 * the installation reads write access and the exact content has a clean scan.
 */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import type { RepositoryControl } from "../backend/projects/contracts";
import {
  handleProjectApi,
  type ProjectApiDependencies,
  refreshProjectSetup,
} from "../backend/projects/handler";
import type { ScanRequest } from "../backend/projects/setup";
import { TokenMetadataError } from "../backend/projects/token-metadata";
import { vettedContentSha256 } from "../backend/vetting/persistence";
import type { RepositoryAccess } from "../src/lib/project-contracts";
import { classifyRevisionChanges } from "../src/lib/project-revision-changes";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import type { VettingClearance } from "../src/lib/vetting-contracts";
import {
  applicationManifest,
  CONTRIBUTION,
} from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";

const ADMIN = "900000001";
const OWNER = "900000002";
const OTHER = "900000003";
const NOW = "2026-10-19T12:00:00.000Z";

const CLEARED: VettingClearance = {
  state: "cleared",
  assessment: {
    id: "vet_00000000000000000000000000000001",
    revision: 1,
    state: "clean",
    commitSha: "a".repeat(40),
    templateSha256: "d".repeat(64),
    policyVersion: "fixture",
    requestedAt: NOW,
    completedAt: NOW,
    modelRuns: [],
    artifacts: 0,
    heldArtifacts: 0,
  },
};

function registry() {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const persistence = new CloudflareProjectPersistence(db);
  let sequence = 0;
  const state = {
    control: {
      state: "proven",
      reason: "@owner is a public member of example",
    } as RepositoryControl,
    access: { installation: "missing" } as RepositoryAccess,
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
        ? {
            githubId: actor,
            githubLogin:
              actor === ADMIN ? "admin" : actor === OWNER ? "owner" : "other",
          }
        : null;
    },
    readTokenMetadata: async () => {
      throw new TokenMetadataError("No contract exists at that token address");
    },
    github: {
      fetch: async () =>
        Response.json({ message: "Not Found" }, { status: 404 }),
    },
    repositoryControl: async () => state.control,
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
    // Paths outside the project API fall through to the next module.
    if (!response) return { status: 404, body: {} };
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  const create = (id: string, repository: string, actor = OWNER) =>
    call("POST", "projects", actor, {
      manifest: applicationManifest(id, repository),
    });
  return { persistence, sqlite, state, call, create, deps };
}

type Setup = {
  state: string;
  status: string;
  nextAction: { kind: string; href: string | null };
  checks: { scan: { state: string } };
  funding: Record<string, unknown>;
  activatedRevision: number | null;
};

test("a new project cannot reuse a listed project id or repository", async () => {
  const { persistence, create } = registry();
  expect((await create("open-registry", "example/open-registry")).status).toBe(
    201,
  );
  const duplicate = await create("open-registry", "other/their-repo", OTHER);
  expect(duplicate.status).toBe(409);
  expect(duplicate.body).toEqual({
    error: "registry_conflict",
    message: "project registry contains duplicate ids",
  });
  expect((await persistence.listProjects()).map((p) => p.id)).toEqual([
    "open-registry",
  ]);
});

test("an admin revision still replaces the listed project with that id", async () => {
  const { persistence, call, create } = registry();
  await create("open-registry", "example/open-registry");
  const current = await persistence.getProject("open-registry");
  if (!current) throw new Error("project was not listed");
  const revised = await call(
    "PUT",
    "admin/projects/open-registry/manifest",
    ADMIN,
    {
      manifest: {
        ...current.manifest,
        description: "Build and maintain reproducible research tooling.",
      },
      expectedRevision: 1,
      reason: "Shorten the description",
    },
  );
  expect(revised.status).toBe(200);
  expect((await persistence.getProject("open-registry"))?.revision).toBe(2);
});

test("creation queues the first scan and returns one status whose next action is the Slopbot installation", async () => {
  const { create, state } = registry();
  const created = await create("open-registry", "example/open-registry");
  expect(created.status).toBe(201);
  const setup = created.body.setup as Setup;
  expect(state.scans).toEqual([
    "open-registry@1: First scan after self-service setup",
  ]);
  expect(setup).toMatchObject({
    state: "action_required",
    status: "paused",
    nextAction: {
      kind: "install_slopbot",
      href: "https://github.com/apps/slopdotcash/installations/new",
    },
    checks: { scan: { state: "queued" } },
    // Funding is separate from readiness.
    funding: {
      mode: "monthly",
      network: "ethereum",
      symbol: "USDC",
      monthlyAmountMinor: "1000000000",
      state: "pledged",
      payments: "disabled",
    },
    activatedRevision: null,
  });
});

test("setup activates a project only with installation write access and a clean scan", async () => {
  const { persistence, call, create, state, sqlite, deps } = registry();
  await create("open-registry", "example/open-registry");
  const check = async (actor = OWNER) =>
    (await call("POST", "project-setup/open-registry/check", actor, {}))
      .body as { setup: Setup };
  // Public facts let the owner create, but activation needs the installation.
  state.clearance = CLEARED;
  expect((await check()).setup).toMatchObject({
    state: "action_required",
    nextAction: { kind: "install_slopbot" },
    activatedRevision: null,
  });
  // An installation that reads only triage access denies the account.
  state.access = {
    installation: "installed",
    installationId: 42,
    permission: "read",
    roleName: "triage",
  };
  expect((await check()).setup).toMatchObject({
    state: "action_required",
    nextAction: { kind: "ask_maintainer" },
  });
  // An unscanned revision waits for the scan it queues.
  state.access = {
    installation: "installed",
    installationId: 42,
    permission: "admin",
    roleName: "admin",
  };
  state.clearance = { state: "unscanned" };
  state.scans = [];
  expect((await check()).setup).toMatchObject({
    state: "waiting",
    nextAction: { kind: "wait_for_scan" },
  });
  expect(state.scans).toEqual(["open-registry@1: Setup check by @owner"]);
  // An unavailable scan service is a retry with a reason.
  state.scanAnswer = {
    state: "unavailable",
    message: "The security scan service is not available yet.",
  };
  expect((await check()).setup).toMatchObject({
    state: "retry",
    nextAction: { kind: "retry_scan" },
  });
  // With every check passing, the project activates once, by status alone.
  state.clearance = CLEARED;
  // The scan completion hook has no owner session. It reloads the creator
  // and checks current authority before activating the project.
  const ready = await refreshProjectSetup(
    new Request("https://slop.cash/api/v1/vetting/results"),
    deps,
    "open-registry",
  );
  expect(ready).toMatchObject({
    state: "ready",
    status: "active",
    nextAction: { kind: "none" },
    activatedRevision: 2,
  });
  const project = await persistence.getProject("open-registry");
  expect(project).toMatchObject({ status: "active", revision: 2 });
  const reason = sqlite
    .query(
      "SELECT reason FROM project_revisions WHERE project_id = 'open-registry' AND revision = 2",
    )
    .get() as { reason: string };
  expect(reason.reason).toBe(
    "Activated automatically after setup checks for @owner: @owner has admin access to example/open-registry. Slopbot installation 42. Clean scan vet_00000000000000000000000000000001.",
  );
  expect((await check()).setup).toMatchObject({
    state: "ready",
    activatedRevision: null,
  });
  expect((await persistence.getProject("open-registry"))?.revision).toBe(2);
});

test("owner revisions publish presentation at once, rescan skill inputs and apply money prospectively", async () => {
  const { persistence, call, create, state } = registry();
  await create("open-registry", "example/open-registry");
  state.access = {
    installation: "installed",
    installationId: 42,
    permission: "write",
    roleName: "write",
  };
  state.clearance = CLEARED;
  await call("POST", "project-setup/open-registry/check", OWNER, {});
  const active = await persistence.getProject("open-registry");
  if (!active) throw new Error("project was not listed");
  expect(active.status).toBe("active");
  state.scans = [];
  // Presentation keeps the project active and queues no scan.
  const presentation = await call("PUT", "projects/open-registry", OWNER, {
    manifest: { ...active.manifest, headline: "A clearer one-line summary." },
    expectedRevision: active.revision,
  });
  expect(presentation.status).toBe(200);
  expect(presentation.body.changes).toEqual({
    presentation: ["headline"],
    executable: [],
    financial: [],
  });
  expect(state.scans).toEqual([]);
  const afterPresentation = await persistence.getProject("open-registry");
  expect(afterPresentation?.status).toBe("active");
  // A skill input change pauses the project and queues a new scan.
  state.clearance = { state: "unscanned" };
  const executable = await call("PUT", "projects/open-registry", OWNER, {
    manifest: {
      ...afterPresentation?.manifest,
      contribution: { ...CONTRIBUTION, requiredTests: "Run `bun test` twice." },
    },
    expectedRevision: afterPresentation?.revision,
  });
  expect(executable.status).toBe(200);
  expect(executable.body.changes).toEqual({
    presentation: [],
    executable: ["contribution"],
    financial: [],
  });
  expect(state.scans).toEqual(["open-registry@4: Owner changed contribution"]);
  expect((executable.body.setup as Setup).nextAction.kind).toBe(
    "wait_for_scan",
  );
  const paused = await persistence.getProject("open-registry");
  expect(paused?.status).toBe("paused");
  // A new monthly amount keeps the open October cycle at the old amount.
  if (paused?.manifest.reward.kind !== "monthly-pool")
    throw new Error("monthly reward expected");
  const financial = await call("PUT", "projects/open-registry", OWNER, {
    manifest: {
      ...paused.manifest,
      reward: {
        ...paused.manifest.reward,
        monthlyCapMinor: "2000000000",
        monthlyCapDisplay: "$2,000",
      },
    },
    expectedRevision: paused.revision,
  });
  expect(financial.status).toBe(200);
  const reward = (await persistence.getProject("open-registry"))?.manifest
    .reward;
  expect(reward).toMatchObject({
    monthlyCapMinor: "2000000000",
    cycleCaps: [{ cycleId: "2026-10", monthlyCapMinor: "1000000000" }],
  });
  // A separate review budget is no longer offered.
  const latest = await persistence.getProject("open-registry");
  if (latest?.manifest.reward.kind !== "monthly-pool")
    throw new Error("monthly reward expected");
  const budget = await call("PUT", "projects/open-registry", OWNER, {
    manifest: {
      ...latest.manifest,
      reward: {
        ...latest.manifest.reward,
        reviewBudget: {
          effectiveAt: "2026-11-01T00:00:00.000Z",
          monthlyCapMinor: "50000000",
          monthlyCapDisplay: "$50",
          committedMinor: "0",
          paymentMode: "disabled",
          unusedFunds: "rollover-without-cap-increase",
          fundingState: "pledged",
        },
      },
    },
    expectedRevision: latest.revision,
  });
  expect(budget.status).toBe(422);
  expect(budget.body.error).toBe("financial_change_restricted");
});

test("an application stored before self-service setup publishes once, by its applicant", async () => {
  const { persistence, sqlite, call, state } = registry();
  // Submission stored the verified reward asset with the manifest.
  const manifest = JSON.stringify(
    applicationManifest("open-registry", "example/open-registry", {
      rewardAsset: {
        network: "ethereum",
        kind: "stablecoin",
        address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        symbol: "USDC",
        decimals: 6,
        chainId: "1",
        cluster: null,
        verifiedAt: "2026-10-10T00:00:00.000Z",
      },
    }),
  );
  sqlite.exec(
    `INSERT INTO project_applications (id,project_id,repository_key,manifest,manifest_sha256,acceptance_criteria,applicant_github_id,applicant_github_login,submitted_at,status,admin_notification,admin_notification_at)
       VALUES ('app_storedapplication1','open-registry','example/open-registry','${manifest}','${"a".repeat(64)}','Merged pull requests','${OWNER}','owner','2026-10-10T00:00:00.000Z','pending','sent','2026-10-10T00:00:01.000Z')`,
  );
  const listed = await call("GET", "project-setup", OWNER);
  expect(listed.body.applications).toEqual([
    expect.objectContaining({
      id: "app_storedapplication1",
      status: "pending",
    }),
  ]);
  // Only its applicant may publish it.
  expect(
    (
      await call(
        "POST",
        "project-applications/app_storedapplication1/publish",
        OTHER,
        {},
      )
    ).status,
  ).toBe(404);
  const published = await call(
    "POST",
    "project-applications/app_storedapplication1/publish",
    OWNER,
    {},
  );
  expect(published.body.error ?? null).toBeNull();
  expect(published.status).toBe(201);
  expect(published.body.project).toMatchObject({
    id: "open-registry",
    revision: 1,
    sourceApplicationId: "app_storedapplication1",
  });
  expect(state.scans).toEqual([
    "open-registry@1: First scan after publishing a stored application",
  ]);
  expect(
    await persistence.getApplication("app_storedapplication1"),
  ).toMatchObject({ status: "approved", decidedBy: { githubId: OWNER } });
  // No approval notice is written for the owner's own action.
  expect(sqlite.query("SELECT COUNT(*) AS n FROM notifications").get()).toEqual(
    { n: 0 },
  );
  const again = await call(
    "POST",
    "project-applications/app_storedapplication1/publish",
    OWNER,
    {},
  );
  expect(again.status).toBe(409);
  const mine = await call("GET", "project-setup", OWNER);
  expect(mine.body).toEqual({
    projects: [
      {
        id: "open-registry",
        slug: "open-registry",
        name: "Project open-registry",
        status: "paused",
        listingTier: "community",
        revision: 1,
      },
    ],
    applications: [],
  });
});

test("the removed admin approval routes no longer exist", async () => {
  const { call } = registry();
  for (const path of [
    "admin/project-applications",
    "admin/project-applications/app_storedapplication1/approve",
  ])
    expect(
      (await call(path.endsWith("approve") ? "POST" : "GET", path, ADMIN, {}))
        .status,
    ).toBe(404);
  expect(
    (
      await call("POST", "project-applications", OWNER, {
        manifest: applicationManifest("open-registry", "example/open-registry"),
      })
    ).status,
  ).toBe(404);
});

test("the scan digest ignores presentation, listing and money but binds skill inputs", async () => {
  const base = applicationManifest(
    "open-registry",
    "example/open-registry",
  ) as unknown as ProjectDefinition;
  const digest = (manifest: ProjectDefinition) => vettedContentSha256(manifest);
  const original = await digest(base);
  expect(
    await digest({
      ...base,
      status: "active",
      listingTier: "featured",
      headline: "A different one-line summary.",
      reward: { ...base.reward, monthlyCapMinor: "0", monthlyCapDisplay: "$0" },
    } as ProjectDefinition),
  ).toBe(original);
  expect(
    await digest({
      ...base,
      contribution: { ...CONTRIBUTION, requiredTests: "Run every test." },
    } as ProjectDefinition),
  ).not.toBe(original);
  expect(
    await digest({
      ...base,
      repositories: [{ ...base.repositories[0], integrationBranch: "next" }],
    } as ProjectDefinition),
  ).not.toBe(original);
  expect(
    classifyRevisionChanges(base, {
      ...base,
      headline: "A different one-line summary.",
      contribution: { ...CONTRIBUTION, requiredTests: "Run every test." },
      reward: { ...base.reward, monthlyCapMinor: "0", monthlyCapDisplay: "$0" },
      status: "active",
    } as ProjectDefinition),
  ).toEqual({
    presentation: ["headline"],
    executable: ["contribution"],
    financial: ["reward"],
    restricted: ["status"],
  });
});
