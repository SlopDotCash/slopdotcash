// A reward-token revision that lands while a monthly cycle is proposed,
// frozen or funded must not relabel that cycle: the owner view's asset
// block names the vault snapshot's asset (address and decimals), so its
// symbol must name the same asset. Real handlers and migrations: the
// monthly coordinator and owner service, the admin manifest route, the
// owner revision route, and the contributor /me read.
import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import { parseMonthlySchedule } from "../../src/lib/payments/monthly-allocation";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import { monthlyAmountDisplay } from "../../src/lib/project-schema.mjs";
import type { RewardAsset } from "../../src/lib/reward-asset.mjs";
import { createMonthlyAllocationFixture } from "../../tests/monthly-allocation-fixture";
import { CONTRIBUTION } from "../../tests/project-application-manifest";
import { sha256Hex } from "../../workers/identity/crypto";
import { CloudflareProjectPersistence } from "../projects/cloudflare-persistence";
import type { EdgeCache } from "../projects/edge-cache";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../projects/handler";
import { handlePaymentsApi } from "./handler";
import { coordinateMonthlyPayments, monthlyOwnerService } from "./monthly";

const deployment: EscrowDeployment = {
  network: "base-sepolia",
  vault: "0x1000000000000000000000000000000000000001",
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
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
const OWNER = "900000071";
const ADMIN = { githubId: "900000001", githubLogin: "e2e-admin" };
const STEWARD = { githubId: "186240462", githubLogin: "elizaOS" };
const NEW_ADDRESS = "0x2222222222222222222222222222222222222222";
const NEW_ASSET: RewardAsset = {
  network: "base",
  kind: "token",
  address: NEW_ADDRESS,
  symbol: "NEW",
  decimals: 9,
  chainId: "8453",
  cluster: null,
  verifiedAt: "2026-12-04T00:00:00.000Z",
};
const schedule = parseMonthlySchedule(
  (
    Bun.TOML.parse(readFileSync("wrangler.toml", "utf8")) as {
      vars: Record<string, string>;
    }
  ).vars.MONTHLY_PAYMENT_SCHEDULE,
);
const clock = new Date("2026-12-04T00:00:00.000Z");

let db: Awaited<ReturnType<typeof createMonthlyAllocationFixture>>["db"];
let sqlite: Database;
let project: ProjectRecord;
let unit = 1n;

beforeEach(async () => {
  unit = 1n;
  ({ db, sqlite, project } = await createMonthlyAllocationFixture({
    deployment: { ...deployment },
    unit,
  }));
  // The frozen fixture registry predates generated skills: its manifest
  // has no contribution fields, so no handler-level revision of an active
  // project could ever append (skill_content_incomplete). Give the project
  // the canonical generated-skill form a live registry project carries.
  const manifest = {
    ...project.manifest,
    skill: {
      ...project.manifest.skill,
      sourcePath: "skills/project-contributor-template",
      publishAtRoot: false,
    },
    reviewSkill: {
      ...project.manifest.reviewSkill,
      sourcePath: "skills/project-reviewer-template",
    },
    contribution: CONTRIBUTION,
  };
  const text = JSON.stringify(manifest);
  expect(
    await persistence().appendProjectRevision(
      {
        projectId: project.id,
        expectedRevision: project.revision,
        manifest: manifest as ProjectRecord["manifest"],
        manifestText: text,
        manifestSha256: await sha256Hex(text),
        reason: "Fixture: complete the generated-skill fields.",
        actor: { githubId: OWNER, githubLogin: "owner" },
        at: "2026-11-15T00:00:00.000Z",
      },
      0,
    ),
  ).toBe("updated");
  const reloaded = await persistence().getProject(project.id);
  if (!reloaded) throw new Error("Fixture project vanished");
  project = reloaded;
});

const persistence = () => new CloudflareProjectPersistence(db);
const projects = () => ({
  getProject: (id: string) => persistence().getProject(id),
  restricted: async () => false,
});
const coordinate = () =>
  coordinateMonthlyPayments({
    db,
    projects: projects(),
    networks: ["base-sepolia"],
    schedule,
    now: clock,
  });
const owner = () =>
  monthlyOwnerService({
    db,
    ...projects(),
    networks: () => ["base-sepolia"],
    verifyAuthority: async () => {},
    schedule: () => schedule,
    now: () => clock,
  });
const actor = { githubId: OWNER, githubLogin: "owner" };

function vault(free: string, decimals = 6) {
  const selected = project.manifest.escrow?.deployments[0];
  if (!selected) throw new Error("Missing fixture deployment");
  sqlite
    .prepare(
      "INSERT INTO vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,free_balance,reserved_principal,reserved_fees,accrued_fees,reserved,block_number,block_time,observed_at) VALUES(?,?,?,?,?,?,?,'0','0','0','0','0',?,'0','0','0','0','100',?,?) ON CONFLICT(project_id,network,vault) DO UPDATE SET free_balance=excluded.free_balance,observed_at=excluded.observed_at,asset_decimals=excluded.asset_decimals,block_number=CAST(CAST(block_number AS INTEGER)+1 AS TEXT)",
    )
    .run(
      project.id,
      selected.network,
      "base",
      selected.vault,
      selected.asset,
      decimals,
      "5000",
      free,
      clock.toISOString(),
      clock.toISOString(),
    );
}
const count = (table: string) =>
  (sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
const obligations = () =>
  sqlite
    .prepare(
      "SELECT github_user_id,gross_base,fee_base,network,vault FROM monthly_payment_obligations ORDER BY github_user_id",
    )
    .all();

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

function projectDeps(): ProjectApiDependencies {
  let id = 0;
  return {
    persistence: persistence(),
    adminGithubIds: new Set([ADMIN.githubId]),
    moderatorGithubIds: new Set([ADMIN.githubId]),
    now: () => clock,
    randomId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    sessionActor: async (request) =>
      request.headers.get("x-test-actor") === "admin"
        ? ADMIN
        : request.headers.get("x-test-actor") === "owner"
          ? STEWARD
          : null,
    readTokenMetadata: async (_network, address) => {
      if (address.toLowerCase() === NEW_ADDRESS)
        return { decimals: 9, symbol: "NEW" };
      throw new Error("No contract exists at that token address");
    },
    github: {
      fetch: async () =>
        Response.json({ message: "Not Found" }, { status: 404 }),
    },
    cache: new MemoryCache(),
    vettingClearance: async () =>
      ({ state: "cleared", assessment: null }) as never,
    repositoryControl: async () => ({ state: "matched" }) as never,
    repositoryAccess: async () =>
      ({
        installation: "installed",
        permission: "admin",
        repository: { id: "1406333828" },
      }) as never,
  };
}

function changedManifest(current: ProjectRecord["manifest"]) {
  return {
    ...current,
    rewardAsset: NEW_ASSET,
    reward: {
      ...current.reward,
      currency: "NEW",
      monthlyCapDisplay: monthlyAmountDisplay(
        current.reward.monthlyCapMinor,
        NEW_ASSET as never,
      ),
    },
  };
}

async function adminTokenChange(): Promise<Response> {
  const current = await persistence().getProject(project.id);
  if (!current) throw new Error("Missing fixture project");
  const response = await handleProjectApi(
    new Request(
      `https://slop.cash/api/v1/admin/projects/${project.id}/manifest`,
      {
        method: "PUT",
        headers: {
          "x-test-actor": "admin",
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          manifest: changedManifest(current.manifest),
          expectedRevision: current.revision,
          reason: "Admin changes the reward token mid-cycle.",
        }),
      },
    ),
    projectDeps(),
  );
  if (!response) throw new Error("Project API did not handle the route");
  return response;
}

// A vault migration lands as a manifest revision (the vault-setup route
// appends the verified deployment); the owner view reads the project fresh,
// so this is the manifest the view sees after migration.
const NEW_VAULT = "0x2222222222222222222222222222222222222222";
const CUSTOM_ADDRESS = "0x3333333333333333333333333333333333333333";
const CUSTOM_ASSET: RewardAsset = {
  network: "base",
  kind: "token",
  address: CUSTOM_ADDRESS,
  symbol: "CUSTOM",
  decimals: 18,
  chainId: "8453",
  cluster: null,
  verifiedAt: "2026-12-04T00:00:00.000Z",
};

async function reviseManifest(
  mutate: (manifest: ProjectRecord["manifest"]) => ProjectRecord["manifest"],
): Promise<void> {
  const current = await persistence().getProject(project.id);
  if (!current) throw new Error("Missing fixture project");
  const manifest = mutate(current.manifest);
  const text = JSON.stringify(manifest);
  expect(
    await persistence().appendProjectRevision(
      {
        projectId: project.id,
        expectedRevision: current.revision,
        manifest: manifest as ProjectRecord["manifest"],
        manifestText: text,
        manifestSha256: await sha256Hex(text),
        reason: "Fixture: migrate the vault after freeze.",
        actor: { githubId: ADMIN.githubId, githubLogin: "admin" },
        at: "2026-12-04T00:00:00.000Z",
      },
      0,
    ),
  ).toBe("updated");
  const reloaded = await persistence().getProject(project.id);
  if (!reloaded) throw new Error("Fixture project vanished");
  project = reloaded;
}

async function migrateVault(): Promise<void> {
  await reviseManifest((manifest) => ({
    ...manifest,
    rewardAsset: NEW_ASSET,
    reward: {
      ...manifest.reward,
      currency: "NEW",
      monthlyCapDisplay: monthlyAmountDisplay(
        manifest.reward.monthlyCapMinor,
        NEW_ASSET as never,
      ),
    },
    escrow: manifest.escrow
      ? {
          ...manifest.escrow,
          deployments: [
            { ...deployment, vault: NEW_VAULT, asset: NEW_ADDRESS },
            ...manifest.escrow.deployments.slice(1),
          ],
        }
      : manifest.escrow,
  }));
}

async function migrateToCustomAsset(): Promise<void> {
  await reviseManifest((manifest) => ({
    ...manifest,
    reward: {
      ...manifest.reward,
      currency: "CUSTOM",
      monthlyCapDisplay: monthlyAmountDisplay(
        manifest.reward.monthlyCapMinor,
        CUSTOM_ASSET as never,
      ),
    },
    escrow: manifest.escrow
      ? {
          ...manifest.escrow,
          deployments: [{ ...deployment, asset: CUSTOM_ADDRESS }],
        }
      : manifest.escrow,
  }));
}

async function seedMember(githubId: string, login: string) {
  const token = `t${githubId}`.padEnd(43, "x");
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?, ?,1)",
    )
    .run(`fixture-${githubId}`, githubId, login, "2026-10-01T00:00:00.000Z");
  sqlite
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(
      await sha256Hex(token),
      `fixture-${githubId}`,
      "2027-01-01T00:00:00.000Z",
    );
  return token;
}

async function myAwards(token: string) {
  const response = await handlePaymentsApi(
    new Request("https://slop.cash/api/v1/payments/me", {
      headers: { cookie: `__Host-slop_points=${token}` },
    }),
    { db, monthly: owner(), now: () => clock },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    monthlyAwards: {
      assetAddress: string;
      assetDecimals: number;
      grossBase: string;
      netBase: string;
    }[];
  };
  return body.monthlyAwards;
}

test("a cycle with no token change freezes, funds and displays in its proposal asset", async () => {
  vault("10000");
  const before = await owner().view(project.id, "2026-11", actor);
  expect(before.asset).toMatchObject({
    assetAddress: deployment.asset,
    assetDecimals: 6,
    symbol: "USDC",
  });
  expect(before.proposal?.capBase).toBe("1000");

  const report = await coordinate();
  expect(report.frozen).toEqual([`${project.id}/2026-11`]);
  expect(report.created).toEqual([`${project.id}/2026-11`]);
  expect(obligations()).toEqual([
    {
      github_user_id: "101",
      gross_base: "600",
      fee_base: "12",
      network: "base-sepolia",
      vault: deployment.vault,
    },
    {
      github_user_id: "202",
      gross_base: "400",
      fee_base: "8",
      network: "base-sepolia",
      vault: deployment.vault,
    },
  ]);
  const run = sqlite
    .prepare("SELECT snapshot FROM monthly_payment_runs WHERE project_id=?")
    .get(project.id) as { snapshot: string };
  expect(JSON.parse(run.snapshot).asset).toBe(deployment.asset);

  const awards = await myAwards(await seedMember("101", "first"));
  expect(awards).toHaveLength(1);
  expect(awards[0]).toMatchObject({
    assetAddress: deployment.asset,
    assetDecimals: 6,
    grossBase: "600",
    netBase: "588",
  });
});

test("an admin reward-token revision mid-cycle keeps the frozen month's money and label on the proposal asset", async () => {
  vault("10000");
  const report = await coordinate();
  expect(report.frozen).toEqual([`${project.id}/2026-11`]);
  expect(report.created).toEqual([`${project.id}/2026-11`]);

  const changed = await adminTokenChange();
  expect(changed.status).toBe(200);
  const current = await persistence().getProject(project.id);
  expect(current?.revision).toBe(project.revision + 1);
  expect(current?.manifest.rewardAsset).toMatchObject({
    address: NEW_ADDRESS,
    symbol: "NEW",
    decimals: 9,
  });

  // The frozen money record is untouched and never refreezes.
  expect(count("monthly_payment_runs")).toBe(1);
  expect(obligations()).toHaveLength(2);
  const after = await coordinate();
  expect(after.frozen).toEqual([]);
  expect(after.failures).toEqual([]);

  // The contributor read still names the snapshot asset and its decimals.
  const awards = await myAwards(await seedMember("101", "first"));
  expect(awards).toHaveLength(1);
  expect(awards[0]).toMatchObject({
    assetAddress: deployment.asset,
    assetDecimals: 6,
    grossBase: "600",
    netBase: "588",
  });

  // The owner read of the same frozen month must label its amounts with
  // the asset its address and decimals name: the proposal asset, not the
  // revision's new token.
  const view = await owner().view(project.id, "2026-11", actor);
  expect(view.asset?.assetAddress).toBe(deployment.asset);
  expect(view.asset?.assetDecimals).toBe(6);
  expect(view.asset?.symbol).toBe("USDC");
  expect(view.run?.awards.map((award) => award.grossBase)).toEqual([
    "600",
    "400",
  ]);
});

test("a revision landing after freeze but before obligation creation still settles and labels the frozen asset", async () => {
  vault("0");
  const first = await coordinate();
  expect(first.frozen).toEqual([`${project.id}/2026-11`]);
  expect(count("monthly_payment_obligations")).toBe(0);

  expect((await adminTokenChange()).status).toBe(200);

  vault("10000");
  const second = await coordinate();
  expect(second.created).toEqual([`${project.id}/2026-11`]);
  expect(obligations()).toEqual([
    {
      github_user_id: "101",
      gross_base: "600",
      fee_base: "12",
      network: "base-sepolia",
      vault: deployment.vault,
    },
    {
      github_user_id: "202",
      gross_base: "400",
      fee_base: "8",
      network: "base-sepolia",
      vault: deployment.vault,
    },
  ]);
  const view = await owner().view(project.id, "2026-11", actor);
  expect(view.asset?.assetAddress).toBe(deployment.asset);
  expect(view.asset?.assetDecimals).toBe(6);
  expect(view.asset?.symbol).toBe("USDC");
});

test("owner self-service cannot change the reward token of a funded project", async () => {
  const current = await persistence().getProject(project.id);
  if (!current) throw new Error("Missing fixture project");
  const response = await handleProjectApi(
    new Request(`https://slop.cash/api/v1/projects/${project.id}`, {
      method: "PUT",
      headers: {
        "x-test-actor": "owner",
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        manifest: changedManifest(current.manifest),
        expectedRevision: current.revision,
      }),
    }),
    projectDeps(),
  );
  if (!response) throw new Error("Project API did not handle the route");
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("financial_change_restricted");
  expect((await persistence().getProject(project.id))?.revision).toBe(
    current.revision,
  );
});

test("a vault migration after freeze keeps the frozen month on its own vault", async () => {
  vault("10000");
  const report = await coordinate();
  expect(report.frozen).toEqual([`${project.id}/2026-11`]);
  expect(report.created).toEqual([`${project.id}/2026-11`]);

  await migrateVault();
  // The new vault is indexed too: the owner view must still read the
  // frozen run's vault, not the migrated deployment.
  vault("10000", 9);

  const view = await owner().view(project.id, "2026-11", actor);
  expect(view.asset?.assetAddress).toBe(deployment.asset);
  expect(view.asset?.assetDecimals).toBe(6);
  expect(view.asset?.symbol).toBe("USDC");
  expect(view.run?.awards.map((award) => award.grossBase)).toEqual([
    "600",
    "400",
  ]);
});

test("a vault migration before the new vault is indexed keeps the frozen month's asset", async () => {
  vault("10000");
  const report = await coordinate();
  expect(report.frozen).toEqual([`${project.id}/2026-11`]);
  expect(report.created).toEqual([`${project.id}/2026-11`]);

  await migrateVault();

  const view = await owner().view(project.id, "2026-11", actor);
  expect(view.asset?.assetAddress).toBe(deployment.asset);
  expect(view.asset?.assetDecimals).toBe(6);
  expect(view.asset?.symbol).toBe("USDC");
});

test("an open month with no proposal and a custom deployment asset keeps the manifest currency", async () => {
  // No coordinate(): no proposal base exists for 2026-12, so base === null.
  await migrateToCustomAsset();
  vault("10000", 18);

  const view = await owner().view(project.id, "2026-12", actor);
  expect(view.asset?.assetAddress).toBe(CUSTOM_ADDRESS);
  expect(view.asset?.assetDecimals).toBe(18);
  expect(view.asset?.symbol).toBe("CUSTOM");
});
