import { expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import {
  handleProjectFlagsApi,
  ProjectFlagStore,
} from "../backend/vetting/flags";
import type { EscrowDeployment } from "../src/lib/escrow-policy.mjs";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { closedMonthLedger } from "../tests/closed-month-ledger";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { CONTRIBUTION } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  buildMonthlyBase,
  monthlyBasesSql,
  prepareMonthlyBases,
} from "./prepare-monthly-rewards";

const snapshotBytes = gunzipSync(
  readFileSync(
    "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json.gz",
  ),
);
function fundedProject(projectId = "eliza", effectiveCycle = "2026-09") {
  const project = fixtureProject(projectId);
  project.reward.feeBasisPoints = 200;
  project.escrow = {
    schemaVersion: "1",
    effectiveCycle,
    chain: "solana",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  };
  return project;
}

/** A registered Solana devnet vault: controlled schema-valid pins. */
const DEVNET_VAULT: EscrowDeployment = {
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
};

const SEPTEMBER_CLOSE = "2026-10-01T00:00:00.000Z";
const SEPTEMBER_WINDOW_FROM = "2026-08-27T00:00:00.000Z";
/** The complete ledger that `leaderboard:generate --cutoff` publishes after September closes. */
const closedSeptemberLedger = () =>
  closedMonthLedger(SEPTEMBER_CLOSE, SEPTEMBER_WINDOW_FROM);

test("a month's proposal is stored once; a later ledger never adds or replaces rows", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  try {
    const project = fundedProject();
    const policyBytes = Buffer.from(JSON.stringify(project));
    const base = buildMonthlyBase(
      {
        projectId: "eliza",
        period: "2026-09",
        generatedAt: "2026-10-01T00:00:00.000Z",
      },
      snapshotBytes,
      policyBytes,
      project,
    );
    const result = {
      period: "2026-09",
      skipped: [],
      bases: [{ ...base, manifest: policyBytes.toString() }],
    };
    const sql = monthlyBasesSql(result, "2026-10-01T00:11:00.000Z");
    sqlite.exec(sql);
    sqlite.exec(sql);
    const later = {
      ...result,
      bases: [
        {
          ...result.bases[0],
          sourceSnapshotSha256: "f".repeat(64),
          rows: [
            ...base.rows.map((row) => ({ ...row, grossBase: "1" })),
            {
              githubUserId: "999999999",
              login: "late-actor",
              grossBase: "5",
              sourceDigest: "e".repeat(64),
            },
          ],
        },
      ],
    };
    sqlite.exec(monthlyBasesSql(later, "2026-10-02T00:11:00.000Z"));
    const stored = await db
      .prepare(
        "SELECT b.source_snapshot_sha256 digest,b.recipient_count count,(SELECT COUNT(*) FROM monthly_reward_base_rows) rows,(SELECT SUM(CAST(gross_base AS INTEGER)) FROM monthly_reward_base_rows) total FROM monthly_reward_bases b",
      )
      .first<{ digest: string; count: number; rows: number; total: number }>();
    expect(stored).toEqual({
      digest: base.sourceSnapshotSha256,
      count: 41,
      rows: 41,
      total: Number(base.capBase),
    });
    expect(() => sqlite.exec("DELETE FROM monthly_reward_base_rows")).toThrow(
      "monthly base permanent",
    );
  } finally {
    sqlite.close();
  }
});

test("a month closed before vault setup is proposed by the rerun after the vault exists, never as a vaultless pledge", async () => {
  const root = mkdtempSync(join(tmpdir(), "slop-monthly-"));
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  try {
    const snapshotPath = join(root, "leaderboard.json");
    writeFileSync(snapshotPath, closedSeptemberLedger());
    mkdirSync(join(root, "src/lib"), { recursive: true });
    const project = fundedProject();
    // The D1 registry snapshot of the run (`bun run projects:sync`).
    const publish = (revision: number) => {
      const manifest = JSON.parse(JSON.stringify(project));
      writeFileSync(
        join(root, "src/lib/project-revisions.generated.json"),
        JSON.stringify([
          {
            projectId: project.id,
            revision,
            manifest,
            manifestSha256: sha256Hex(JSON.stringify(manifest)),
          },
        ]),
      );
    };
    // One scheduled run of monthly-rewards.yml on the given day.
    const run = async (day: string) => {
      const createdAt = `2026-10-0${day}T00:11:00.000Z`;
      const result = await prepareMonthlyBases({
        period: "2026-09",
        generatedAt: createdAt,
        snapshotPath,
        root,
      });
      // The workflow imports a non-empty file only.
      const sql = monthlyBasesSql(result, createdAt);
      if (sql) sqlite.exec(sql);
      return result;
    };

    // Day 1: the active project has its monthly policy but no vault yet.
    publish(1);
    expect(await run("1")).toEqual({
      period: "2026-09",
      bases: [],
      skipped: ["eliza"],
    });
    // The owner creates the vault; the day 2 rerun proposes the month.
    const vault = DEVNET_VAULT;
    project.escrow?.deployments.push(vault);
    publish(2);
    expect((await run("2")).bases.map((base) => base.projectId)).toEqual([
      "eliza",
    ]);

    // The stored proposal is permanent. The coordinator freezes a month only
    // into the vault that this manifest names (backend/payments/monthly.ts).
    const stored = await db
      .prepare("SELECT manifest FROM monthly_reward_bases")
      .all<{ manifest: string }>();
    expect(
      stored.results.map((row) => JSON.parse(row.manifest).escrow.deployments),
    ).toEqual([[vault]]);
  } finally {
    sqlite.close();
    rmSync(root, { force: true, recursive: true });
  }
});

/** Runs one command of the scheduled monthly job in a copied checkout. */
async function workflowCommand(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("a contributor-flag pause skips that project and keeps every other project's month", async () => {
  const root = mkdtempSync(join(tmpdir(), "slop-monthly-flag-"));
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const now = () => new Date("2026-10-30T12:00:00.000Z");
  const persistence = new CloudflareProjectPersistence(db);
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    // Two active monthly-pool projects with a registered vault each and the
    // generated skills that every registry project publishes.
    const registered = (id: string) => {
      const project = fundedProject(id);
      project.skill = {
        id: `contribute-to-${id}`,
        publishAtRoot: false,
        sourcePath: "skills/project-contributor-template",
        publicPath: `/projects/${id}/skill.md`,
      };
      project.reviewSkill = {
        id: `review-${id}-contributions`,
        sourcePath: "skills/project-reviewer-template",
      };
      project.contribution = { ...CONTRIBUTION };
      return project;
    };
    const asi = registered("asi");
    asi.escrow?.deployments.push({
      ...DEVNET_VAULT,
      vault: "Stake11111111111111111111111111111111111111",
      projectPda: "Config1111111111111111111111111111111111111",
      deploymentTransaction: `${"1".repeat(63)}2`,
    });
    const eliza = registered("eliza");
    eliza.escrow?.deployments.push(DEVNET_VAULT);
    for (const manifest of assertProjectRegistry([asi, eliza])) {
      const text = JSON.stringify(manifest);
      const digest = sha256Hex(text);
      const at = "2026-09-01T00:00:00.000Z";
      sqlite
        .prepare(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          manifest.id,
          1,
          text,
          digest,
          "Controlled registry revision",
          "900000001",
          "fixture-owner",
          at,
        );
      sqlite
        .prepare(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(manifest.id, manifest.status, 1, text, digest, at, at);
    }
    // PRD section 4: two distinct eligible members flag eliza through the
    // public route, and the second flag pauses it. The pause appends no D1
    // revision, so eliza's newest revision still says active.
    const flags = new ProjectFlagStore(db);
    let nextFlag = 0;
    const flag = (githubId: string) =>
      handleProjectFlagsApi(
        new Request("https://slop.cash/api/v1/project-flags/eliza", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://slop.cash",
          },
          body: JSON.stringify({
            category: "prompt-injection",
            evidence:
              "The install script downloads and runs an unpinned remote payload.",
            evidenceUrl:
              "https://github.com/elizaOS/eliza/blob/main/install.sh",
          }),
        }),
        {
          flags,
          projects: persistence,
          sessionActor: async () => ({
            githubId,
            githubLogin: `member-${githubId}`,
          }),
          // An established member with accepted work and read access only.
          flaggerStanding: async () => ({
            accountCreatedAt: "2020-01-01T00:00:00.000Z",
            hasAcceptedContribution: true,
          }),
          repositoryAuthority: async () => ({
            state: "denied",
            message: "Read access",
          }),
          moderatorGithubIds: ["900000009"],
          now,
          randomId: () =>
            `00000000-0000-4000-8000-${String(++nextFlag).padStart(12, "0")}`,
        },
      );
    expect((await flag("900000101"))?.status).toBe(201);
    expect(await (await flag("900000102"))?.json()).toMatchObject({
      paused: true,
    });
    const unsupported = async () => {
      throw new Error("Only public registry reads are allowed in this fixture");
    };
    const registryApi: ProjectApiDependencies = {
      persistence,
      adminGithubIds: new Set(),
      moderatorGithubIds: new Set(),
      now,
      randomId: () => {
        throw new Error("No writes are allowed in this fixture");
      },
      sessionActor: async () => null,
      readTokenMetadata: unsupported,
      github: { fetch: unsupported },
      vettingClearance: unsupported,
      repositoryControl: unsupported,
    };
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) =>
        (await handleProjectApi(request, registryApi)) ??
        new Response("Not found", { status: 404 }),
    });
    // The job's own checkout, so its registry snapshot is the synced one.
    const checkout = join(root, "checkout");
    for (const path of [
      "backend",
      "contracts",
      "package.json",
      "scripts",
      "src",
      "tests/closed-month-ledger.ts",
      "workers",
    ]) {
      mkdirSync(dirname(join(checkout, path)), { recursive: true });
      cpSync(join(import.meta.dir, "..", path), join(checkout, path), {
        recursive: true,
      });
    }
    symlinkSync(
      join(import.meta.dir, "..", "node_modules"),
      join(checkout, "node_modules"),
    );
    // monthly-rewards.yml: projects:sync, then the complete cycle ledger,
    // then rewards:propose-month.
    const sync = await workflowCommand(
      checkout,
      ["scripts/sync-project-registry.mjs"],
      { SLOP_API_ORIGIN: `http://127.0.0.1:${server.port}` },
    );
    expect(sync.code, sync.stderr).toBe(0);
    expect(sync.stdout).toContain(
      "Project eliza is restricted but its paused, retired revision is pending",
    );
    // The workflow then validates the synced registry before collection.
    const check = await workflowCommand(checkout, [
      "scripts/sync-project-registry.mjs",
      "--check",
    ]);
    expect(check.code, check.stderr).toBe(0);
    const ledger = join(root, "leaderboard.json");
    const collected = await workflowCommand(checkout, [
      "tests/closed-month-ledger.ts",
      ledger,
      SEPTEMBER_CLOSE,
      SEPTEMBER_WINDOW_FROM,
    ]);
    expect(collected.code, collected.stderr).toBe(0);
    const sql = join(root, "monthly-allocations.sql");
    expect(
      await workflowCommand(checkout, [
        "scripts/prepare-monthly-rewards.ts",
        "--cycle",
        "2026-09",
        "--snapshot",
        ledger,
        "--sql",
        sql,
      ]),
    ).toEqual({
      code: 0,
      stdout: "[Slop] proposed 2026-09 allocations: asi\n",
      stderr: "",
    });
    sqlite.exec(readFileSync(sql, "utf8"));
    const stored = await db
      .prepare("SELECT project_id FROM monthly_reward_bases")
      .all<{ project_id: string }>();
    expect(stored.results).toEqual([{ project_id: "asi" }]);
  } finally {
    server?.stop(true);
    sqlite.close();
    rmSync(root, { force: true, recursive: true });
  }
});
