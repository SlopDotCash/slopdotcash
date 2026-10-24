/**
 * Self-service project setup (PRD section 4) on the real migrations: owners
 * create projects without an admin, applications stored before the change
 * publish without being entered again, the registry stays unique, owner
 * revisions classify their changes, and setup activates a project only when
 * the installation reads write access and the exact content has a clean scan.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { hasParticipationBan } from "../backend/projects/account-bans";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import type {
  ProjectEnforcement,
  RepositoryControl,
} from "../backend/projects/contracts";
import {
  handleProjectApi,
  type ProjectApiDependencies,
  refreshProjectSetup,
} from "../backend/projects/handler";
import type { ScanRequest } from "../backend/projects/setup";
import { TokenMetadataError } from "../backend/projects/token-metadata";
import { seedParticipationBan } from "../backend/security/participation-ban.fixture";
import { signApiToken } from "../backend/trace/auth";
import {
  CloudflareTracePersistence,
  type R2Bucket,
} from "../backend/trace/cloudflare-persistence";
import {
  handleTraceApi,
  type TraceApiDependencies,
} from "../backend/trace/handler";
import { vettedContentSha256 } from "../backend/vetting/persistence";
import type { EscrowDeployment } from "../src/lib/escrow-policy.mjs";
import type { RepositoryAccess } from "../src/lib/project-contracts";
import { classifyRevisionChanges } from "../src/lib/project-revision-changes";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { resolveRewardCapMinor } from "../src/lib/reward-cap.mjs";
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

const TEST_VAULT: EscrowDeployment = {
  network: "ethereum" as const,
  vault: "0x1000000000000000000000000000000000000001",
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  owner: "0x2000000000000000000000000000000000000002",
  identityAuthority: "0x3000000000000000000000000000000000000003",
  feeRecipient: "0x4000000000000000000000000000000000000004",
  deploymentTransaction: `0x${"ab".repeat(32)}`,
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  codeSha256: "ab".repeat(32),
  bindingDelaySeconds: "60",
  rotationDelaySeconds: null,
  factory: "0x5000000000000000000000000000000000000005",
  factoryCodeSha256: "cd".repeat(32),
  registrar: "0x6000000000000000000000000000000000000006",
};

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
    control: { state: "matched" } as RepositoryControl,
    access: {
      installation: "installed",
      installationId: 42,
      permission: "admin",
      roleName: "admin",
    } as RepositoryAccess,
    clearance: { state: "unscanned" } as VettingClearance,
    scans: [] as string[],
    scanAnswer: { state: "queued" } as ScanRequest,
    now: NOW,
  };
  const deps: ProjectApiDependencies = {
    persistence,
    adminGithubIds: new Set([ADMIN]),
    moderatorGithubIds: new Set(),
    vettingClearance: async () => state.clearance,
    now: () => new Date(state.now),
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
  return { db, persistence, sqlite, state, call, create, deps };
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

test("creation requires the Slopbot installation, then queues the first scan and returns one status", async () => {
  const { create, persistence, state } = registry();
  // Owner decision D11: no installation read, no project.
  state.access = { installation: "missing" };
  const refused = await create("open-registry", "example/open-registry");
  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({
    error: "slopbot_required",
    message:
      "Slop reads your access to example/open-registry through Slopbot. Install Slopbot on example/open-registry, then try again.",
  });
  expect(await persistence.listProjects()).toEqual([]);
  expect(state.scans).toEqual([]);
  state.access = {
    installation: "installed",
    installationId: 42,
    permission: "admin",
    roleName: "admin",
  };
  const created = await create("open-registry", "example/open-registry");
  expect(created.status).toBe(201);
  const setup = created.body.setup as Setup;
  expect(state.scans).toEqual([
    "open-registry@1: First scan after self-service setup",
  ]);
  expect(setup).toMatchObject({
    state: "waiting",
    status: "paused",
    nextAction: { kind: "wait_for_scan", href: null },
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
  // An installation removed after creation stops activation, and the next
  // action links the installation.
  state.access = { installation: "missing" };
  state.clearance = CLEARED;
  expect((await check()).setup).toMatchObject({
    state: "action_required",
    nextAction: {
      kind: "install_slopbot",
      href: "https://github.com/apps/slopdotcash/installations/new",
    },
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
  // On 2 December the November proposal may not exist yet; it reads the
  // newest revision. A new amount then keeps November and December too.
  state.now = "2026-12-02T00:05:00.000Z";
  const december = await persistence.getProject("open-registry");
  if (december?.manifest.reward.kind !== "monthly-pool")
    throw new Error("monthly reward expected");
  const raised = await call("PUT", "projects/open-registry", OWNER, {
    manifest: {
      ...december.manifest,
      reward: {
        ...december.manifest.reward,
        monthlyCapMinor: "3000000000",
        monthlyCapDisplay: "$3,000",
      },
    },
    expectedRevision: december.revision,
  });
  expect(raised.status).toBe(200);
  const stored = await persistence.getProject("open-registry");
  if (!stored) throw new Error("project expected");
  expect(stored.manifest.reward).toMatchObject({
    monthlyCapMinor: "3000000000",
    cycleCaps: [
      { cycleId: "2026-10", monthlyCapMinor: "1000000000" },
      { cycleId: "2026-11", monthlyCapMinor: "2000000000" },
      { cycleId: "2026-12", monthlyCapMinor: "2000000000" },
    ],
  });
  expect(
    ["2026-10", "2026-11", "2026-12", "2027-01"].map((cycle) =>
      resolveRewardCapMinor(stored.manifest, cycle),
    ),
  ).toEqual(["1000000000", "2000000000", "2000000000", "3000000000"]);
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

test("an owner revision cannot record a vault; a reviewed admin revision can", async () => {
  const { persistence, call, create } = registry();
  await create("open-registry", "example/open-registry");
  const current = await persistence.getProject("open-registry");
  if (current?.manifest.reward.kind !== "monthly-pool")
    throw new Error("monthly reward expected");
  // An unverified vault record on an unfunded project: the funding page
  // offers a deposit for every recorded vault, so this must never publish.
  const withVault = {
    ...current.manifest,
    reward: { ...current.manifest.reward, feeBasisPoints: 200 },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-11",
      chain: "ethereum",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [TEST_VAULT],
    },
  };
  const owner = await call("PUT", "projects/open-registry", OWNER, {
    manifest: withVault,
    expectedRevision: current.revision,
  });
  expect(owner.status).toBe(422);
  expect(owner.body).toEqual({
    error: "financial_change_restricted",
    message:
      "Use vault setup to register a verified owner vault; a manifest edit cannot change vault records",
  });
  expect((await persistence.getProject("open-registry"))?.manifest.escrow).toBe(
    undefined,
  );
  // The reviewed admin exception path still records the vault.
  const admin = await call(
    "PUT",
    "admin/projects/open-registry/manifest",
    ADMIN,
    {
      manifest: withVault,
      expectedRevision: current.revision,
      reason: "Record the reviewed Ethereum vault",
    },
  );
  expect(admin.status).toBe(200);
  const recorded = await persistence.getProject("open-registry");
  expect(recorded?.manifest.escrow?.deployments).toEqual(
    withVault.escrow.deployments,
  );
  // The owner may not change the recorded vault either.
  if (!recorded) throw new Error("project expected");
  const changed = await call("PUT", "projects/open-registry", OWNER, {
    manifest: {
      ...recorded.manifest,
      escrow: {
        ...withVault.escrow,
        deployments: [
          {
            ...withVault.escrow.deployments[0],
            vault: "0x7000000000000000000000000000000000000007",
          },
        ],
      },
    },
    expectedRevision: recorded.revision,
  });
  expect(changed.status).toBe(422);
  expect(changed.body.error).toBe("financial_change_restricted");
});

test("a payout exclusion starts with the next UTC month on every revision path", async () => {
  const { persistence, call, create, deps } = registry();
  await create("open-registry", "example/open-registry");
  const exclusion = (fromCycle: string) => ({
    actorId: OTHER,
    nodeId: btoa(`04:User${OTHER}`),
    login: "other",
    relationship: "funded-employee" as const,
    fromCycle,
    untilCycle: null,
  });
  const revise = async (
    path: string,
    actor: string,
    exclusions: unknown[] | undefined,
  ) => {
    const current = await persistence.getProject("open-registry");
    if (current?.manifest.reward.kind !== "monthly-pool")
      throw new Error("monthly reward expected");
    const { payoutExclusions: _old, ...reward } = current.manifest.reward;
    return call("PUT", path, actor, {
      manifest: {
        ...current.manifest,
        reward: exclusions
          ? { ...reward, payoutExclusions: exclusions }
          : reward,
      },
      expectedRevision: current.revision,
      reason: "Record a payout exclusion",
    });
  };
  // NOW is in October 2026: the open month cannot change.
  for (const [path, actor] of [
    ["projects/open-registry", OWNER],
    ["admin/projects/open-registry/manifest", ADMIN],
  ])
    expect(await revise(path, actor, [exclusion("2026-10")])).toEqual({
      status: 422,
      body: {
        error: "invalid_manifest",
        message: "payout exclusions apply prospectively; 2026-10 cannot change",
      },
    });
  // Public shares and private allocation must name the same account.
  expect(
    (
      await revise("projects/open-registry", OWNER, [
        {
          ...exclusion("2026-11"),
          actorId: OWNER,
        },
      ])
    ).status,
  ).toBe(422);
  const recorded = await revise("projects/open-registry", OWNER, [
    exclusion("2026-11"),
  ]);
  expect(recorded.status).toBe(200);
  expect(recorded.body.changes).toMatchObject({ financial: ["reward"] });
  expect(
    (await persistence.getProject("open-registry"))?.manifest.reward
      .payoutExclusions,
  ).toEqual([exclusion("2026-11")]);
  // A presentation edit keeps the exclusion.
  const current = await persistence.getProject("open-registry");
  expect(
    (
      await call("PUT", "projects/open-registry", OWNER, {
        manifest: { ...current?.manifest, headline: "A clearer summary." },
        expectedRevision: current?.revision,
      })
    ).status,
  ).toBe(200);
  // Before November starts, the future exclusion may still be withdrawn.
  expect(
    (await revise("admin/projects/open-registry/manifest", ADMIN, undefined))
      .status,
  ).toBe(200);
  expect(
    (await revise("projects/open-registry", OWNER, [exclusion("2026-11")]))
      .status,
  ).toBe(200);
  deps.now = () => new Date("2026-11-01T00:00:00.000Z");
  // The numeric account ID controls private allocation checks. Keeping the
  // node ID must not allow an owner or admin to replace that identity now.
  for (const [path, actor] of [
    ["projects/open-registry", OWNER],
    ["admin/projects/open-registry/manifest", ADMIN],
  ]) {
    const changed = await revise(path, actor, [
      { ...exclusion("2026-11"), actorId: OWNER },
    ]);
    expect(changed.status).toBe(422);
    expect(
      (await persistence.getProject("open-registry"))?.manifest.reward
        .payoutExclusions,
    ).toEqual([exclusion("2026-11")]);
  }
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

test("an explicit moderator ban blocks new contribution intake without blaming the original applicant", async () => {
  const t = registry();
  t.deps.moderatorGithubIds = new Set([ADMIN]);
  t.deps.github.fetch = async (url) =>
    Response.json(
      String(url).endsWith("/second")
        ? { id: 900000004, login: "second", type: "User" }
        : { id: Number(OTHER), login: "other", type: "User" },
    );
  expect(
    (await t.create("responsibility", "example/responsibility")).status,
  ).toBe(201);
  const project = await t.persistence.getProject("responsibility");
  if (!project) throw new Error("Project missing");
  await t.persistence.appendEnforcement(
    {
      id: "enf_responsibility_scan",
      projectId: project.id,
      sequence: 1,
      action: "ban",
      stateAfter: "banned",
      appealAfter: "none",
      reason: "Synthetic confirmed malicious scan",
      evidenceReference: "private-case-fixture",
      repositoryGithubId: "987654321",
      repositoryKeys: ["example/responsibility"],
      actor: null,
      actorRole: "vetting-service",
      decisionSource: "standing-rule",
      systemIssuer: {
        kind: "vetting-service",
        keySha256: "a".repeat(64),
        assessmentId: "vet_fixture",
        policyVersion: "fixture",
        rule: "confirmed-malicious",
      },
      beforeRevision: project.revision,
      beforeManifestSha256: project.manifestSha256,
      afterRevision: null,
      afterManifestSha256: null,
      result: "revision_pending",
      createdAt: NOW,
    },
    null,
    [],
  );
  const secret = "synthetic-ban-workflow-secret-01234567890123456789";
  const token = await signApiToken(
    {
      iss: "slop.cash",
      aud: "private-trace-api",
      sub: `github:${OTHER}`,
      githubId: OTHER,
      githubLogin: "other",
      roles: ["contributor"],
      iat: Math.floor(Date.parse(NOW) / 1000),
      exp: Math.floor(Date.parse(NOW) / 1000) + 300,
      jti: "ban-workflow-token-0123456789",
    },
    secret,
  );
  let run = 0;
  const trace: TraceApiDependencies = {
    persistence: new CloudflareTracePersistence(t.db, {} as R2Bucket),
    authSecret: secret,
    operatorGithubIds: new Set(),
    now: () => new Date(NOW),
    randomId: () => `ban-workflow-run-${++run}`,
    verifyIdentityAssertion: async () => null,
    privateIntakeStatus: async () => ({ status: "unavailable" }),
  };
  const newRun = () =>
    handleTraceApi(
      new Request("http://localhost/api/v1/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": `ban-workflow-create-${run}-0123456789`,
        },
        body: JSON.stringify({
          clientRunId: "client_ban_workflow",
          projectId: "other-project",
          repository: "example/other-project",
          projectPolicyRevision: "a".repeat(40),
          provider: "openai",
          model: "gpt-5",
          client: "codex",
          clientVersion: "1.0.0",
        }),
      }),
      trace,
    );
  expect((await newRun()).status).toBe(201);
  const decision = {
    action: "ban",
    reason: "Evidence identifies the selected account, not the applicant",
    evidenceReference: "private-case-fixture",
    expectedRevision: project.revision,
    expectedSequence: 2,
  };
  const empty = await t.call(
    "POST",
    "admin/projects/responsibility/enforcement-preview",
    ADMIN,
    decision,
  );
  expect(empty.status).toBe(200);
  expect(
    (empty.body.preview as { maintainerBans: unknown[] }).maintainerBans,
  ).toEqual([]);
  const preview = await t.call(
    "POST",
    "admin/projects/responsibility/enforcement-preview",
    ADMIN,
    {
      ...decision,
      responsibleAccounts: [
        { githubLogin: "other" },
        { githubLogin: "second" },
      ],
    },
  );
  expect(preview.status).toBe(200);
  const selected = (preview.body.preview as { maintainerBans: unknown[] })
    .maintainerBans;
  expect(selected).toEqual([
    { githubId: OTHER, githubLogin: "other" },
    { githubId: "900000004", githubLogin: "second" },
  ]);
  // The ban lands after intake checks the account but before it writes the run.
  const readBan = trace.persistence.hasParticipationBan.bind(trace.persistence);
  let pendingBan = true;
  trace.persistence.hasParticipationBan = async (githubId) => {
    const banned = await readBan(githubId);
    if (pendingBan) {
      pendingBan = false;
      expect(
        (
          await t.call(
            "POST",
            "admin/projects/responsibility/enforcement",
            ADMIN,
            {
              ...decision,
              responsibleAccounts: selected,
            },
          )
        ).status,
      ).toBe(200);
    }
    return banned;
  };
  const refused = await newRun();
  expect(refused.status).toBe(403);
  expect((await refused.json()).error).toBe("participation_banned");
  expect((await newRun()).status).toBe(403);
  expect(
    (
      await t.create(
        "unrelated-applicant",
        "example/unrelated-applicant",
        OWNER,
      )
    ).status,
  ).toBe(201);
  expect(
    (await t.create("banned-actor", "example/banned-actor", OTHER)).status,
  ).toBe(403);
  // A ban on one project grants no appeal authority on an unrelated project.
  expect(
    (
      await t.call("POST", "project-appeals", OTHER, {
        projectId: "unrelated-applicant",
        reason: "Try to act on a project that did not ban this account",
        evidenceReference: "private-account-appeal-fixture",
      })
    ).status,
  ).toBe(403);
  expect((await t.call("GET", "project-account-bans", "")).body).toEqual({
    schemaVersion: "slop-account-bans:v1",
    bans: [OTHER, "900000004"].map((githubId) => ({ githubId, bannedAt: NOW })),
  });
  const listedAppeals = await t.call("GET", "project-appeals", OTHER);
  expect(listedAppeals.status).toBe(200);
  expect(listedAppeals.body).toEqual({
    appeals: [{ projectId: "responsibility", state: "banned", appeal: "none" }],
  });
  expect((await t.call("GET", "project-appeals", OWNER)).body).toEqual({
    appeals: [],
  });
  expect((await t.call("GET", "project-appeals", "")).status).toBe(401);
  const appeal = await t.call("POST", "project-appeals", OTHER, {
    projectId: "responsibility",
    reason: "The evidence does not establish my responsibility",
    evidenceReference: "private-account-appeal-fixture",
  });
  expect(appeal.status).toBe(200);
  expect(appeal.body.record).toMatchObject({
    actorRole: "banned-account",
    decisionSource: "account-request",
    action: "request_reinstatement",
    stateAfter: "banned",
    afterRevision: null,
  });
  // Each banned account retains its own appeal and evidence.
  expect((await t.call("GET", "project-appeals", "900000004")).body).toEqual({
    appeals: [{ projectId: "responsibility", state: "banned", appeal: "none" }],
  });
  const secondAppeal = await t.call("POST", "project-appeals", "900000004", {
    projectId: "responsibility",
    reason: "Review the evidence for my account separately",
    evidenceReference: "private-second-account-appeal-fixture",
  });
  expect(secondAppeal.status).toBe(200);
  expect((await t.call("GET", "project-appeals", "900000004")).body).toEqual({
    appeals: [
      { projectId: "responsibility", state: "banned", appeal: "requested" },
    ],
  });
  expect(
    (
      await t.call("POST", "project-appeals", OTHER, {
        projectId: "responsibility",
        reason: "Duplicate appeal",
        evidenceReference: "private-account-appeal-fixture",
      })
    ).status,
  ).toBe(409);
  // Filing an appeal grants no new participation or project authority.
  expect((await newRun()).status).toBe(403);
  const restore = {
    action: "reinstate_accounts",
    reason: "Evidence clears this account only",
    evidenceReference: "private-account-review-fixture",
    expectedRevision: (await t.persistence.getProject(project.id))?.revision,
    expectedSequence: 5,
    responsibleAccounts: [{ githubId: OTHER, githubLogin: "other" }],
  };
  expect(
    (
      await t.call(
        "POST",
        "admin/projects/responsibility/enforcement",
        ADMIN,
        restore,
      )
    ).status,
  ).toBe(403);
  t.deps.moderatorGithubIds = new Set([ADMIN, OWNER]);
  t.deps.adminGithubIds = new Set([ADMIN, OWNER]);
  const restored = await t.call(
    "POST",
    "admin/projects/responsibility/enforcement",
    OWNER,
    restore,
  );
  expect(restored.status).toBe(200);
  expect(restored.body.record).toMatchObject({
    action: "reinstate_accounts",
    stateAfter: "banned",
    afterRevision: null,
  });
  expect((await newRun()).status).toBe(201);
  expect(await hasParticipationBan(t.db, "900000004")).toBe(true);
  expect((await t.call("GET", "project-account-bans", "")).body).toEqual({
    schemaVersion: "slop-account-bans:v1",
    bans: [{ githubId: "900000004", bannedAt: NOW }],
  });

  expect((await t.call("GET", "project-appeals", OTHER)).body).toEqual({
    appeals: [],
  });
  expect(
    (
      await t.call(
        "POST",
        "admin/projects/responsibility/enforcement",
        OWNER,
        restore,
      )
    ).status,
  ).toBe(409);
  expect(
    (await t.persistence.listEnforcements()).at(-1)?.accountReinstatements,
  ).toEqual([
    {
      githubId: OTHER,
      githubLogin: "other",
      banEnforcementId: (await t.persistence.listEnforcements())[1].id,
    },
  ]);
});

test("account-reinstatement upgrade preserves prior releases and separates future project decisions", async () => {
  const names = readdirSync(new URL("../migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const { db, sqlite } = sqliteD1(names.filter((name) => name < "0070"));
  try {
    const moderator = { githubId: ADMIN, githubLogin: "admin" };
    for (const id of [OWNER, OTHER])
      seedParticipationBan(
        sqlite,
        { githubId: id, githubLogin: "fixture" },
        moderator,
        NOW,
      );
    const reinstate = (id: string) =>
      sqlite
        .query(`
      INSERT INTO project_enforcements
      SELECT 'enf_release_' || ?, project_id, 3, 'reinstate', 'clear', 'granted',
        reason, evidence_reference, repository_github_id, repository_keys,
        '700000001', 'independent', NULL, 'project-moderator', 'admin-panel',
        before_revision, before_manifest_sha256, NULL, NULL, 'no_revision_needed', created_at
      FROM project_enforcements WHERE id = ?
    `)
        .run(id, `enf_malicious-${id}_2`);
    reinstate(OWNER);
    const rows = sqlite
      .query("SELECT rowid,* FROM project_enforcements ORDER BY rowid")
      .all();
    const triggers = sqlite
      .query(
        "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name",
      )
      .all() as { name: string; sql: string }[];
    // Test this upgrade only. Later migrations may intentionally replace unrelated triggers.
    for (const name of names.filter((name) => name >= "0070" && name < "0073"))
      sqlite.exec(
        readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
      );
    expect(
      sqlite
        .query("SELECT rowid,* FROM project_enforcements ORDER BY rowid")
        .all(),
    ).toEqual(rows);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    for (const trigger of triggers)
      expect(
        sqlite
          .query("SELECT name,sql FROM sqlite_master WHERE name=?")
          .get(trigger.name),
      ).toEqual(trigger);
    expect(await hasParticipationBan(db, OWNER)).toBe(false);
    expect(await hasParticipationBan(db, OTHER)).toBe(true);
    reinstate(OTHER);
    expect(await hasParticipationBan(db, OTHER)).toBe(true);
    expect(
      sqlite
        .query("SELECT github_id FROM project_account_reinstatements")
        .all(),
    ).toEqual([{ github_id: OWNER }]);
  } finally {
    sqlite.close();
  }
});

test.each(["vault verification", "owner update"])(
  "a ban issued during %s blocks the owner revision",
  async (flow) => {
    const t = registry();
    await t.create("vault-target", "example/vault-target");
    const banSource = applicationManifest(
      "ban-source",
      "example/ban-source",
    ) as unknown as ProjectDefinition;
    await t.call("POST", "projects", OTHER, {
      manifest: {
        ...banSource,
        authority: {
          ...banSource.authority,
          repositoryId: "987654322",
          repositoryNodeId: "R_different",
        },
      },
    });
    const target = await t.persistence.getProject("vault-target");
    const source = await t.persistence.getProject("ban-source");
    if (!target || !source) throw new Error("Projects required");
    expect(
      (
        await t.call("PUT", "admin/projects/vault-target/manifest", ADMIN, {
          expectedRevision: target.revision,
          reason: "Set the approved monthly vault policy",
          manifest: {
            ...target.manifest,
            reward: { ...target.manifest.reward, feeBasisPoints: 200 },
            escrow: {
              schemaVersion: "1",
              effectiveCycle: "2026-11",
              chain: "ethereum",
              feeBasisPoints: 200,
              withdrawalFeeBasisPoints: 200,
              feeMode: "deduct-from-gross",
              deployments: [],
            },
          },
        })
      ).status,
    ).toBe(200);
    let start!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const verified = new Promise<void>((resolve) => {
      finish = resolve;
    });
    t.deps.vaultSetup = {
      networks: async () => ["ethereum"],
      review: async () => {
        throw new Error("Not used");
      },
      register: async () => {
        start();
        await verified;
        return TEST_VAULT;
      },
    };
    const prepared = await t.persistence.getProject(target.id);
    if (!prepared) throw new Error("Project required");
    if (flow === "owner update")
      t.deps.repositoryAccess = async () => {
        start();
        await verified;
        return t.state.access;
      };
    const registration =
      flow === "owner update"
        ? t.call("PUT", `projects/${target.id}`, OWNER, {
            manifest: {
              ...prepared.manifest,
              headline: "A useful updated project summary.",
            },
            expectedRevision: prepared.revision,
          })
        : t.call("POST", "project-vaults/vault-target", OWNER, {
            step: "register",
            expectedRevision: 2,
            network: "ethereum",
            claimId: "verified-owner-wallet",
            automatic: true,
            transactionId: TEST_VAULT.deploymentTransaction,
          });
    await started;
    const scan: ProjectEnforcement = {
      id: "enf_vault_race_scan",
      projectId: source.id,
      sequence: 1,
      action: "ban",
      stateAfter: "banned",
      appealAfter: "none",
      reason: "Confirmed malicious code",
      evidenceReference: "private-fixture",
      repositoryGithubId: "987654322",
      repositoryKeys: ["example/ban-source"],
      actor: null,
      actorRole: "vetting-service",
      decisionSource: "standing-rule",
      systemIssuer: {
        kind: "vetting-service",
        keySha256: "a".repeat(64),
        assessmentId: "vet_fixture",
        policyVersion: "fixture",
        rule: "confirmed-malicious",
      },
      beforeRevision: source.revision,
      beforeManifestSha256: source.manifestSha256,
      afterRevision: null,
      afterManifestSha256: null,
      result: "revision_pending",
      createdAt: NOW,
    };
    expect(await t.persistence.appendEnforcement(scan, null, [])).toBe(
      "recorded",
    );
    expect(
      await t.persistence.appendEnforcement(
        {
          ...scan,
          id: "enf_vault_race_moderator",
          sequence: 2,
          actor: { githubId: ADMIN, githubLogin: "admin" },
          actorRole: "project-moderator",
          decisionSource: "admin-panel",
          systemIssuer: undefined,
          maintainerBans: [{ githubId: OWNER, githubLogin: "owner" }],
        },
        null,
        [],
      ),
    ).toBe("recorded");
    finish();
    const result = await registration;
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("maintainer_banned");
    expect((await t.persistence.getProject(target.id))?.revision).toBe(2);
    expect(
      (await t.persistence.getProject(target.id))?.manifest.escrow?.deployments,
    ).toEqual([]);
  },
);
