import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { EscrowDeployment } from "../src/lib/escrow-policy.mjs";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
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

/** The complete ledger that `leaderboard:generate --cutoff` publishes after September closes. */
function closedSeptemberLedger(): string {
  const at = "2026-10-01T00:00:00.000Z";
  const from = "2026-08-27T00:00:00.000Z";
  return JSON.stringify(
    createLeaderboardSnapshot({
      generatedAt: at,
      windowFrom: from,
      windowTo: at,
      sourceUpdatedAt: at,
      source: {
        provider: "github-graphql",
        fetchedAt: at,
        cutoffAt: at,
        repositoryId: "R_fixture",
        repositories: TARGET_REPOSITORIES.map((target) => ({
          id: target.id,
          repositoryId:
            target.role === "primary"
              ? "R_fixture"
              : `R_fixture_${target.name.replaceAll("-", "_")}`,
        })),
        requestCount: 1,
        searchSliceCount: 1,
        rateLimit: {
          cost: 1,
          limit: 5000,
          remaining: 4999,
          resetAt: "2026-10-01T01:00:00.000Z",
        },
        counts: {
          mergedPullRequests: 0,
          detailedMergedPullRequests: 0,
          closedIssues: 0,
          detailedClosedIssues: 0,
          resolvedIssues: 0,
          openIssues: 0,
          openPullRequests: 0,
        },
        verificationWindow: { days: 35, from, to: at },
        evidenceVerification: {
          status: "complete",
          sourceCount: 0,
          artifactCount: 0,
          maxSources: 64,
          maxArtifacts: 64,
        },
      },
      mergedPullRequestOutcomes: [],
      mergedPullRequests: [],
      detailEligibleMergedPullRequestIds: [],
      closedIssueCount: 0,
      resolvedIssues: [],
      openIssues: [],
      openPullRequests: [],
      verificationWindowFrom: from,
      verifiedEvidence: [],
      evaluatedContributions: [],
    }),
  );
}

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
    const vault: EscrowDeployment = {
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
