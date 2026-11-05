/**
 * A monthly amount change is prospective on every revision path (PRD
 * section 4, "Economic changes are prospective"): the owner route pins
 * every month from the reward start through the open UTC cycle to the
 * amount it had, because a closed month's proposal reads the newest
 * revision. An admin revision that changes the amount must pin the same
 * months; otherwise it silently resizes a closed month whose proposal
 * has not run yet, and the open month. Real handlers + real migrations:
 * owner revision and admin manifest routes (backend/projects/handler.ts),
 * the proposal builder the trusted workflow calls
 * (scripts/prepare-monthly-rewards buildMonthlyBase), and the cap
 * resolver it uses (src/lib/reward-cap.mjs).
 */
import { beforeEach, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import type { EdgeCache } from "../backend/projects/edge-cache";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import type { ProjectRecord } from "../src/lib/project-contracts";
import { monthlyAmountDisplay } from "../src/lib/project-schema.mjs";
import { resolveRewardCapMinor } from "../src/lib/reward-cap.mjs";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { CONTRIBUTION } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { sha256Hex } from "../workers/identity/crypto";
import { buildMonthlyBase } from "./prepare-monthly-rewards";

const ADMIN = { githubId: "900000001", githubLogin: "e2e-admin" };
const STEWARD = { githubId: "186240462", githubLogin: "elizaOS" };
const OLD_CAP = "1000000000"; // $1,000 at 6 decimals
const NEW_CAP = "400000000"; // $400

const DEVNET_VAULT = {
  network: "solana-devnet",
  vault: "So11111111111111111111111111111111111111112",
  programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  upgradeAuthority: null,
  projectPda: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  networkDomain: "cd".repeat(32),
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  owner: "11111111111111111111111111111111",
  identityAuthority: "SysvarRent111111111111111111111111111111111",
  feeRecipient: "SysvarC1ock11111111111111111111111111111111",
  rotationAuthority: "Vote111111111111111111111111111111111111111",
  deploymentTransaction: "1".repeat(64),
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  codeSha256: "ab".repeat(32),
  bindingDelaySeconds: "60",
  rotationDelaySeconds: "60",
  factory: null,
  factoryCodeSha256: null,
  registrar: null,
} as const;

const snapshotBytes = gunzipSync(
  readFileSync(
    "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json.gz",
  ),
);

// 2 October 2026: September is closed, its proposal window (Oct 1-3) is
// open and no proposal has been stored yet; October is the open cycle.
let clock = new Date("2026-10-02T00:05:00.000Z");
let db: ReturnType<typeof sqliteD1>["db"];
let project: ProjectRecord;

function baseManifest() {
  const fixture = fixtureProject("eliza");
  return {
    ...fixture,
    skill: {
      ...fixture.skill,
      sourcePath: "skills/project-contributor-template",
      publishAtRoot: false,
    },
    reviewSkill: {
      ...fixture.reviewSkill,
      sourcePath: "skills/project-reviewer-template",
    },
    contribution: CONTRIBUTION,
    reward: {
      ...fixture.reward,
      feeBasisPoints: 200,
      // September is NOT listed, so it resolves to the default cap.
      cycleCaps: [{ cycleId: "2026-08", monthlyCapMinor: "10000000000" }],
    },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-09",
      chain: "solana",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [DEVNET_VAULT],
    },
  };
}

beforeEach(async () => {
  clock = new Date("2026-10-02T00:05:00.000Z");
  const made = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  db = made.db;
  const manifest = baseManifest();
  const text = JSON.stringify(manifest);
  const digest = await sha256Hex(text);
  made.sqlite
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(manifest.id, text, digest, "Fixture", "2026-09-01T00:00:00.000Z");
  made.sqlite
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,?,?)",
    )
    .run(
      manifest.id,
      manifest.status,
      text,
      digest,
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    );
  const stored = await persistence().getProject(manifest.id);
  if (!stored) throw new Error("fixture project missing");
  project = stored;
});

const persistence = () => new CloudflareProjectPersistence(db);

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
    readTokenMetadata: async () => {
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

function loweredManifest(current: ProjectRecord["manifest"]) {
  return {
    ...current,
    reward: {
      ...current.reward,
      monthlyCapMinor: NEW_CAP,
      monthlyCapDisplay: monthlyAmountDisplay(NEW_CAP, undefined as never),
    },
  };
}

async function call(
  method: string,
  path: string,
  actor: "admin" | "owner",
  body: Record<string, unknown>,
) {
  const response = await handleProjectApi(
    new Request(`https://slop.cash/api/v1/${path}`, {
      method,
      headers: {
        "x-test-actor": actor,
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    projectDeps(),
  );
  if (!response) throw new Error("project route did not respond");
  return response;
}

async function storedProject() {
  const stored = await persistence().getProject(project.id);
  if (!stored) throw new Error("project vanished");
  return stored;
}

/** The proposal the trusted workflow would store for September, built from
 * the project's newest stored revision, exactly as prepareMonthlyBases does. */
function septemberProposal(manifest: ProjectRecord["manifest"]) {
  const bytes = Buffer.from(JSON.stringify(manifest));
  return buildMonthlyBase(
    {
      projectId: project.id,
      period: "2026-09",
      generatedAt: clock.toISOString(),
    },
    snapshotBytes,
    bytes,
    manifest as never,
  );
}

test("(a) control: an owner cap cut on 2 Oct keeps closed September and open October at the old amount; the new amount starts in November", async () => {
  const before = septemberProposal(project.manifest);
  console.log("proposal before change: capBase", before.capBase);
  expect(before.capBase).toBe(OLD_CAP);

  const current = await storedProject();
  const response = await call("PUT", `projects/${project.id}`, "owner", {
    manifest: loweredManifest(current.manifest),
    expectedRevision: current.revision,
  });
  console.log(
    "owner revision status:",
    response.status,
    await response
      .clone()
      .text()
      .then((t) => t.slice(0, 200)),
  );
  expect(response.status).toBe(200);

  const stored = await storedProject();
  console.log(
    "stored cycleCaps:",
    JSON.stringify(stored.manifest.reward.cycleCaps),
  );
  expect(resolveRewardCapMinor(stored.manifest, "2026-09")).toBe(OLD_CAP);
  expect(resolveRewardCapMinor(stored.manifest, "2026-10")).toBe(OLD_CAP);
  expect(resolveRewardCapMinor(stored.manifest, "2026-11")).toBe(NEW_CAP);
  const after = septemberProposal(stored.manifest);
  console.log("proposal after owner change: capBase", after.capBase);
  expect(after.capBase).toBe(OLD_CAP);
  expect(
    after.rows.reduce((sum, row) => sum + BigInt(row.grossBase), 0n).toString(),
  ).toBe(OLD_CAP);
});

test("(b) an admin cap cut on 2 Oct must not resize closed September or open October either", async () => {
  const before = septemberProposal(project.manifest);
  expect(before.capBase).toBe(OLD_CAP);

  const current = await storedProject();
  const response = await call(
    "PUT",
    `admin/projects/${project.id}/manifest`,
    "admin",
    {
      manifest: loweredManifest(current.manifest),
      expectedRevision: current.revision,
      reason: "Admin lowers the monthly amount on 2 October (probe).",
    },
  );
  console.log(
    "admin revision status:",
    response.status,
    await response
      .clone()
      .text()
      .then((t) => t.slice(0, 200)),
  );
  expect(response.status).toBe(200);

  const stored = await storedProject();
  console.log(
    "stored cycleCaps:",
    JSON.stringify(stored.manifest.reward.cycleCaps),
  );
  console.log(
    "resolved caps Sep/Oct/Nov:",
    ["2026-09", "2026-10", "2026-11"].map((cycle) =>
      resolveRewardCapMinor(stored.manifest, cycle),
    ),
  );
  const after = septemberProposal(stored.manifest);
  console.log(
    "proposal after admin change: capBase",
    after.capBase,
    "rows sum",
    after.rows.reduce((sum, row) => sum + BigInt(row.grossBase), 0n).toString(),
    "rows",
    after.rows.length,
  );
  // THE CROSS: a closed month whose proposal has not run yet keeps the
  // amount it had, whichever revision path changed the default.
  expect(resolveRewardCapMinor(stored.manifest, "2026-09")).toBe(OLD_CAP);
  expect(resolveRewardCapMinor(stored.manifest, "2026-10")).toBe(OLD_CAP);
  expect(resolveRewardCapMinor(stored.manifest, "2026-11")).toBe(NEW_CAP);
  expect(after.capBase).toBe(OLD_CAP);
  expect(
    after.rows.reduce((sum, row) => sum + BigInt(row.grossBase), 0n).toString(),
  ).toBe(OLD_CAP);
});

test("(d) an admin cap raise on 2 Oct must not grow closed September or open October either", async () => {
  const current = await storedProject();
  const raised = {
    ...current.manifest,
    reward: {
      ...current.manifest.reward,
      monthlyCapMinor: "2000000000",
      monthlyCapDisplay: monthlyAmountDisplay("2000000000", undefined as never),
    },
  };
  const response = await call(
    "PUT",
    `admin/projects/${project.id}/manifest`,
    "admin",
    {
      manifest: raised,
      expectedRevision: current.revision,
      reason: "Admin raises the monthly amount on 2 October (probe).",
    },
  );
  expect(response.status).toBe(200);
  const stored = await storedProject();
  console.log(
    "resolved caps Sep/Oct/Nov after raise:",
    ["2026-09", "2026-10", "2026-11"].map((cycle) =>
      resolveRewardCapMinor(stored.manifest, cycle),
    ),
  );
  expect(resolveRewardCapMinor(stored.manifest, "2026-09")).toBe(OLD_CAP);
  expect(resolveRewardCapMinor(stored.manifest, "2026-10")).toBe(OLD_CAP);
  expect(resolveRewardCapMinor(stored.manifest, "2026-11")).toBe("2000000000");
});

test("guard: an admin revision that changes only cycleCaps keeps the submitted entries", async () => {
  const current = await storedProject();
  const manifest = {
    ...current.manifest,
    reward: {
      ...current.manifest.reward,
      cycleCaps: [
        { cycleId: "2026-08", monthlyCapMinor: "10000000000" },
        { cycleId: "2026-09", monthlyCapMinor: "700000000" },
      ],
    },
  };
  const response = await call(
    "PUT",
    `admin/projects/${project.id}/manifest`,
    "admin",
    {
      manifest,
      expectedRevision: current.revision,
      reason: "Admin corrects September's recorded cap only (guard).",
    },
  );
  expect(response.status).toBe(200);
  const stored = await storedProject();
  expect(stored.manifest.reward.cycleCaps).toEqual([
    { cycleId: "2026-08", monthlyCapMinor: "10000000000" },
    { cycleId: "2026-09", monthlyCapMinor: "700000000" },
  ]);
  expect(resolveRewardCapMinor(stored.manifest, "2026-09")).toBe("700000000");
});

test("guard: an admin revision with no amount change gains no cycleCaps", async () => {
  const current = await storedProject();
  const manifest = {
    ...current.manifest,
    name: `${current.manifest.name} Renamed`,
  };
  const response = await call(
    "PUT",
    `admin/projects/${project.id}/manifest`,
    "admin",
    {
      manifest,
      expectedRevision: current.revision,
      reason: "Admin renames the project only (guard).",
    },
  );
  expect(response.status).toBe(200);
  const stored = await storedProject();
  expect(stored.manifest.reward.cycleCaps).toEqual([
    { cycleId: "2026-08", monthlyCapMinor: "10000000000" },
  ]);
  expect(resolveRewardCapMinor(stored.manifest, "2026-09")).toBe(OLD_CAP);
});
