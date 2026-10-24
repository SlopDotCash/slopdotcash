/** Real migrations and registry tables; GitHub authority is a controlled stub here (see scripts/owner-award-authority.test.ts). */

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { privateKeyToAccount } from "viem/accounts";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { monthlyBasesSql } from "../../scripts/prepare-monthly-rewards";
import type { PaymentsAccount } from "../../src/lib/payments/contracts";
import { escrowAwardOrigin } from "../../src/lib/payments/escrow-cycle";
import { parseMonthlySchedule } from "../../src/lib/payments/monthly-allocation";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { sha256Hex } from "../../workers/identity/crypto";
import type { JournalStore } from "../../workers/payment-executor/core";
import { signMonthlyAllocation } from "../../workers/payment-executor/monthly";
import {
  runMonthlyCommitments,
  runMonthlyCoordinator,
} from "../../workers/payments/index";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../projects/cloudflare-persistence";
import { seedParticipationBan } from "../security/participation-ban.fixture";
import { handlePaymentsApi } from "./handler";
import {
  coordinateMonthlyPayments,
  MonthlyPaymentError,
  monthlyOwnerService,
} from "./monthly";
import { prepareMonthlyAttestation } from "./monthly-attestation";
import { publishMonthlyAuthorizations } from "./monthly-publication";

const testAttester = privateKeyToAccount(`0x${"01".repeat(32)}`);
const deployment = {
  network: "base-sepolia",
  vault: "0x1000000000000000000000000000000000000001",
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  owner: "0x2000000000000000000000000000000000000002",
  identityAuthority: testAttester.address.toLowerCase(),
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
const solanaDeployment = {
  ...deployment,
  network: "solana-devnet",
  vault: "So11111111111111111111111111111111111111112",
  programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  projectPda: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  networkDomain: "cd".repeat(32),
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  owner: "11111111111111111111111111111111",
  identityAuthority: "SysvarRent111111111111111111111111111111111",
  feeRecipient: "SysvarC1ock11111111111111111111111111111111",
  rotationAuthority: "Vote111111111111111111111111111111111111111",
  deploymentTransaction: "1".repeat(64),
  rotationDelaySeconds: "60",
  factory: null,
  factoryCodeSha256: null,
  registrar: null,
};
const OWNER = "900000071";
const A = "101";
const B = "202";
// Owner decision D1, read from the reviewed Pages configuration: the cutoff of
// 2026-11 is 72 hours after the month ends.
const schedule = parseMonthlySchedule(
  (
    Bun.TOML.parse(readFileSync("wrangler.toml", "utf8")) as {
      vars: Record<string, string>;
    }
  ).vars.MONTHLY_PAYMENT_SCHEDULE,
);
const beforeCutoff = new Date("2026-12-03T23:30:00.000Z");
const afterCutoff = new Date("2026-12-04T00:00:00.000Z");

let db: ProjectD1Database;
let sqlite: Database;
let project: ProjectRecord;
let restricted = false;
let clock = afterCutoff;

async function setupFixture(
  selected: Record<string, string | null> = deployment,
  unit = 1n,
  applyAmountRange = true,
) {
  ({ db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .filter(
        (name) =>
          applyAmountRange || name !== "0081_monthly_asset_amount_range.sql",
      )
      .sort(),
  ));
  const manifest = JSON.parse(
    readFileSync("tests/fixtures/projects/eliza.json", "utf8"),
  );
  manifest.reward.feeBasisPoints = 200;
  const chain = selected.network?.startsWith("solana") ? "solana" : "base";
  manifest.reward.chain = chain;
  if (unit > 1n) {
    manifest.reward.currency = "TOKEN";
    manifest.reward.monthlyCapMinor = (1000n * unit).toString();
    manifest.reward.monthlyCapDisplay = "1,000 TOKEN";
    manifest.rewardAsset = {
      network: chain,
      kind: "token",
      address: selected.asset,
      symbol: "TOKEN",
      decimals: 18,
      chainId: chain === "solana" ? null : "8453",
      cluster: chain === "solana" ? "mainnet-beta" : null,
      verifiedAt: "2026-10-01T00:00:00.000Z",
    };
  }
  manifest.escrow = {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain,
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [selected],
  };
  const text = JSON.stringify(manifest);
  const digest = await sha256Hex(text);
  sqlite
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(manifest.id, text, digest, "Fixture", "2026-10-01T00:00:00.000Z");
  sqlite
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,?,?)",
    )
    .run(
      manifest.id,
      manifest.status,
      text,
      digest,
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    );
  const stored = await new CloudflareProjectPersistence(db).getProject(
    manifest.id,
  );
  if (!stored) throw new Error("fixture project missing");
  project = stored;
  sqlite.exec(
    monthlyBasesSql(
      {
        period: "2026-11",
        skipped: [],
        bases: [
          {
            projectId: project.id,
            period: "2026-11",
            manifest: text,
            manifestSha256: digest,
            sourceSnapshotSha256: "5".repeat(64),
            capBase: (1000n * unit).toString(),
            rows: [
              {
                githubUserId: A,
                login: "first",
                grossBase: (600n * unit).toString(),
                sourceDigest: escrowAwardOrigin(project.id, "2026-11", A),
              },
              {
                githubUserId: B,
                login: "second",
                grossBase: (400n * unit).toString(),
                sourceDigest: escrowAwardOrigin(project.id, "2026-11", B),
              },
            ],
          },
        ],
      },
      "2026-12-01T00:11:00.000Z",
    ),
  );
  restricted = false;
  clock = afterCutoff;
}
beforeEach(() => setupFixture());
afterEach(() => sqlite.close());

const projects = () => ({
  getProject: (id: string) =>
    new CloudflareProjectPersistence(db).getProject(id),
  restricted: async () => restricted,
});
const coordinate = (now: Date, configured = schedule) =>
  coordinateMonthlyPayments({
    db,
    projects: projects(),
    networks: project.manifest.escrow?.deployments.map((d) => d.network) ?? [],
    schedule: configured,
    now,
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
function vault(
  free: string,
  observedAt = afterCutoff.toISOString(),
  decimals = 6,
) {
  const escrow = project.manifest.escrow;
  const selected = escrow?.deployments[0];
  if (!escrow || !selected) throw new Error("Missing fixture deployment");
  sqlite
    .prepare(
      "INSERT INTO vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,free_balance,reserved_principal,reserved_fees,accrued_fees,reserved,block_number,block_time,observed_at) VALUES(?,?,?,?,?,?,?,'0','0','0','0','0',?,'0','0','0','0','100',?,?) ON CONFLICT(project_id,network,vault) DO UPDATE SET free_balance=excluded.free_balance,observed_at=excluded.observed_at,block_number=CAST(CAST(block_number AS INTEGER)+1 AS TEXT)",
    )
    .run(
      project.id,
      selected.network,
      escrow.chain,
      selected.vault,
      selected.asset,
      decimals,
      BigInt(free) > 5000n ? free : "5000",
      free,
      observedAt,
      observedAt,
    );
}
const count = (table: string) =>
  (sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
async function rejects(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(MonthlyPaymentError);
  expect((error as MonthlyPaymentError).code).toBe(code);
}

describe("monthly coordinator", () => {
  test("Solana still refuses an owner allocation above its token range before storing it", async () => {
    sqlite.close();
    await setupFixture(solanaDeployment, 10n ** 18n);
    clock = beforeCutoff;
    await expect(
      owner().changeAllocation(project.id, "2026-11", actor, {
        githubUserId: B,
        grossBase: (300n * 10n ** 18n).toString(),
        expectedSequence: 0,
      }),
    ).rejects.toMatchObject({
      code: "invalid_allocation",
      message: "The amount exceeds the Solana token range.",
    });
    expect(count("monthly_allocation_changes")).toBe(0);
  });

  test("the amount-range migration preserves funded months, exclusions and authorization history", async () => {
    sqlite.close();
    await setupFixture(deployment, 1n, false);
    clock = beforeCutoff;
    await owner().changeAllocation(project.id, "2026-11", actor, {
      githubUserId: B,
      grossBase: "300",
      expectedSequence: 0,
    });
    seedParticipationBan(
      sqlite,
      { githubId: B, githubLogin: "second" },
      actor,
      beforeCutoff.toISOString(),
    );
    vault("600");
    await coordinate(afterCutoff);
    expect(count("monthly_payment_obligations")).toBe(1);
    expect(count("monthly_payment_exclusions")).toBe(1);
    sqlite
      .prepare(
        "INSERT INTO monthly_payment_authorizations SELECT project_id,period,network,snapshot_sha256,?,? FROM monthly_payment_runs",
      )
      .run('{"fixture":"migration-preservation"}', afterCutoff.toISOString());
    sqlite
      .prepare(
        "INSERT INTO monthly_payment_execution SELECT project_id,period,network,?,0 FROM monthly_payment_authorizations",
      )
      .run(afterCutoff.toISOString());
    const tables = [
      "monthly_reward_bases",
      "monthly_reward_base_rows",
      "monthly_allocation_changes",
      "monthly_payment_runs",
      "monthly_payment_obligations",
      "monthly_payment_exclusions",
      "monthly_payment_authorizations",
      "monthly_payment_execution",
    ];
    const records = () =>
      tables.map((table) =>
        sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1,2,3`).all(),
      );
    const before = records();
    sqlite.exec("PRAGMA foreign_keys=ON; BEGIN");
    try {
      sqlite.exec(
        readFileSync("migrations/0081_monthly_asset_amount_range.sql", "utf8"),
      );
      expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
    expect(records()).toEqual(before);
    expect(sqlite.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    expect(() =>
      sqlite.exec("UPDATE monthly_payment_runs SET snapshot='{}'"),
    ).toThrow("frozen");
    expect(() =>
      sqlite.exec("DELETE FROM monthly_payment_obligations"),
    ).toThrow("permanent");
    expect((await coordinate(afterCutoff)).created).toEqual([]);
  });

  test("an 18-decimal token month keeps exact amounts through an owner edit, freeze and attestation", async () => {
    sqlite.close();
    const unit = 10n ** 18n;
    await setupFixture(
      { ...deployment, asset: "0x7000000000000000000000000000000000000007" },
      unit,
    );
    clock = beforeCutoff;
    const changed = await owner().changeAllocation(
      project.id,
      "2026-11",
      actor,
      {
        githubUserId: B,
        grossBase: (300n * unit).toString(),
        expectedSequence: 0,
      },
    );
    expect(changed.proposal?.allocations.map((row) => row.grossBase)).toEqual([
      (600n * unit).toString(),
      (300n * unit).toString(),
    ]);
    await rejects(
      owner().changeAllocation(project.id, "2026-11", actor, {
        githubUserId: B,
        grossBase: (401n * unit).toString(),
        expectedSequence: 1,
      }),
      "invalid_allocation",
    );
    vault((900n * unit).toString(), afterCutoff.toISOString(), 18);
    expect((await coordinate(afterCutoff)).created).toEqual([
      `${project.id}/2026-11`,
    ]);
    expect((await coordinate(afterCutoff)).created).toEqual([]);
    expect(count("monthly_payment_obligations")).toBe(2);
    if (!schedule) throw new Error("Fixture schedule missing");
    const { digest } = sqlite
      .prepare("SELECT snapshot_sha256 digest FROM monthly_payment_runs")
      .get() as { digest: string };
    const plan = await prepareMonthlyAttestation(
      {
        db,
        ...projects(),
        networks: [deployment.network],
        schedule,
        now: afterCutoff,
      },
      {
        projectId: project.id,
        period: "2026-11",
        network: "base-sepolia",
        snapshotSha256: digest,
      },
    );
    expect(plan.totalGrossBase).toBe((900n * unit).toString());
    expect(plan.entries.map((row) => row.grossMicro)).toEqual([
      (600n * unit).toString(),
      (300n * unit).toString(),
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT gross_base,fee_base FROM monthly_payment_obligations ORDER BY github_user_id",
        )
        .all(),
    ).toEqual([
      {
        gross_base: (600n * unit).toString(),
        fee_base: (12n * unit).toString(),
      },
      {
        gross_base: (300n * unit).toString(),
        fee_base: (6n * unit).toString(),
      },
    ]);
  });

  for (const action of ["allocation", "setting", "finalize"] as const) {
    for (const racing of [false, true]) {
      test(`a ${racing ? "concurrent" : "current"} owner ban refuses monthly ${action}`, async () => {
        clock = beforeCutoff;
        const ban = () =>
          seedParticipationBan(
            sqlite,
            actor,
            { githubId: "404", githubLogin: "moderator" },
            beforeCutoff.toISOString(),
          );
        const table =
          action === "allocation"
            ? "monthly_allocation_changes"
            : action === "setting"
              ? "monthly_payment_settings"
              : "monthly_payment_runs";
        const original = db.prepare.bind(db);
        if (racing) {
          db.prepare = (sql) => {
            if (sql.startsWith(`INSERT INTO ${table}(`)) {
              ban();
              db.prepare = original;
            }
            return original(sql);
          };
        } else ban();
        const service = owner();
        await rejects(
          action === "allocation"
            ? service.changeAllocation(project.id, "2026-11", actor, {
                githubUserId: B,
                grossBase: "300",
                expectedSequence: 0,
              })
            : action === "setting"
              ? service.setAutomatic(project.id, actor, false)
              : service.finalize(project.id, "2026-11", actor, 0),
          "account_banned",
        );
        db.prepare = original;
        expect(count(table)).toBe(0);
        expect(count("monthly_payment_obligations")).toBe(0);
        expect(
          (await service.view(project.id, "2026-11", actor)).projectId,
        ).toBe(project.id);
      });
    }
  }
  test("a ban after freeze excludes only the unfunded award and preserves the snapshot", async () => {
    await coordinate(afterCutoff);
    const before = sqlite
      .query("SELECT snapshot, snapshot_sha256 FROM monthly_payment_runs")
      .get();
    seedParticipationBan(
      sqlite,
      { githubId: A, githubLogin: "first" },
      actor,
      afterCutoff.toISOString(),
    );
    vault("400");
    const result = await coordinate(afterCutoff);
    expect(result.created).toEqual([`${project.id}/2026-11`]);
    expect(
      sqlite
        .query("SELECT github_user_id FROM monthly_payment_obligations")
        .all(),
    ).toEqual([{ github_user_id: B }]);
    expect(
      sqlite
        .query("SELECT snapshot, snapshot_sha256 FROM monthly_payment_runs")
        .get(),
    ).toEqual(before);
    expect(
      sqlite
        .query("SELECT github_user_id FROM monthly_payment_exclusions")
        .all(),
    ).toEqual([{ github_user_id: A }]);
    await coordinate(afterCutoff);
    expect(count("monthly_payment_obligations")).toBe(1);
    const view = await owner().view(project.id, "2026-11", actor);
    expect(view.run?.totalGrossBase).toBe("400");
    await rejects(
      owner().commitment(project.id, "2026-11", actor, {
        network: "base-sepolia",
        manifestSha256: project.manifestSha256,
        snapshotSha256: view.run?.snapshotSha256 ?? "",
        githubUserId: A,
      }),
      "award_excluded",
    );
    const eligible = await owner().commitment(project.id, "2026-11", actor, {
      network: "base-sepolia",
      manifestSha256: project.manifestSha256,
      snapshotSha256: view.run?.snapshotSha256 ?? "",
      githubUserId: B,
    });
    expect(eligible.award.gross).toBe("400");
    expect(
      view.run?.awards.find((award) => award.githubUserId === A),
    ).toMatchObject({
      state: "excluded",
      grossBase: "0",
      feeBase: "0",
      netBase: "0",
    });
  });

  test("a ban that races monthly funding makes the coordinator retry before creating awards", async () => {
    await coordinate(afterCutoff);
    vault("1000");
    const batch = db.batch.bind(db);
    let pending = true;
    db.batch = async (statements) => {
      if (pending) {
        pending = false;
        seedParticipationBan(
          sqlite,
          { githubId: A, githubLogin: "first" },
          actor,
          afterCutoff.toISOString(),
        );
      }
      return batch(statements);
    };
    expect((await coordinate(afterCutoff)).created).toEqual([]);
    expect(count("monthly_payment_obligations")).toBe(0);
    expect(count("monthly_payment_exclusions")).toBe(0);
    expect((await coordinate(afterCutoff)).created).toEqual([
      `${project.id}/2026-11`,
    ]);
    expect(
      sqlite
        .query("SELECT github_user_id FROM monthly_payment_obligations")
        .all(),
    ).toEqual([{ github_user_id: B }]);
  });

  test("a later ban preserves monthly awards that are already funded", async () => {
    vault("1000");
    await coordinate(afterCutoff);
    seedParticipationBan(
      sqlite,
      { githubId: A, githubLogin: "first" },
      actor,
      afterCutoff.toISOString(),
    );
    await coordinate(afterCutoff);
    expect(count("monthly_payment_obligations")).toBe(2);
    seedParticipationBan(
      sqlite,
      actor,
      { githubId: "404", githubLogin: "moderator" },
      afterCutoff.toISOString(),
    );
    const view = await owner().view(project.id, "2026-11", actor);
    const plan = await owner().commitment(project.id, "2026-11", actor, {
      network: deployment.network,
      manifestSha256: project.manifestSha256,
      snapshotSha256: view.run?.snapshotSha256 ?? "",
      githubUserId: A,
    });
    expect(plan.award.gross).toBe("600");
    expect(plan.award.sourceDigest).toBe(
      escrowAwardOrigin(project.id, "2026-11", A),
    );
  });

  test("freezes the current private allocations once at the cutoff and creates each obligation once when funded", async () => {
    clock = beforeCutoff;
    const changed = await owner().changeAllocation(
      project.id,
      "2026-11",
      actor,
      {
        githubUserId: B,
        grossBase: "300",
        expectedSequence: 0,
      },
    );
    expect(changed.proposal?.allocations.map((row) => row.grossBase)).toEqual([
      "600",
      "300",
    ]);
    expect((await coordinate(beforeCutoff)).frozen).toEqual([]);
    expect(count("monthly_payment_runs")).toBe(0);

    const first = await coordinate(afterCutoff);
    expect(first.frozen).toEqual([`${project.id}/2026-11`]);
    // No finalized vault reading yet: nothing is created.
    expect(first.waiting).toEqual([
      { key: `${project.id}/2026-11`, reason: "stale-funding" },
    ]);
    vault("899");
    expect((await coordinate(afterCutoff)).waiting).toEqual([
      { key: `${project.id}/2026-11`, reason: "underfunded" },
    ]);
    expect((await coordinate(afterCutoff)).waiting).toEqual([
      { key: `${project.id}/2026-11`, reason: "underfunded" },
    ]);
    expect(count("monthly_payment_obligations")).toBe(0);
    // The steward gets one Inbox payout exception for the month, however
    // often the coordinator retries; it names no amount or contributor.
    expect(
      sqlite
        .prepare(
          "SELECT event_key,recipient_github_id,kind,subject,action_path FROM notifications",
        )
        .all(),
    ).toEqual([
      {
        event_key: `monthly-underfunded:${project.id}:2026-11`,
        recipient_github_id: project.manifest.steward.github.actorId,
        kind: "payout_exception",
        subject: project.id,
        action_path: `/projects/${project.id}/awards`,
      },
    ]);
    vault("900");
    expect((await coordinate(afterCutoff)).created).toEqual([
      `${project.id}/2026-11`,
    ]);
    const again = await coordinate(afterCutoff);
    expect([again.frozen, again.created, again.waiting]).toEqual([[], [], []]);
    expect(
      sqlite
        .prepare(
          "SELECT github_user_id,gross_base,fee_base,source_digest FROM monthly_payment_obligations ORDER BY github_user_id",
        )
        .all(),
    ).toEqual([
      {
        github_user_id: A,
        gross_base: "600",
        fee_base: "12",
        source_digest: escrowAwardOrigin(project.id, "2026-11", A),
      },
      {
        github_user_id: B,
        gross_base: "300",
        fee_base: "6",
        source_digest: escrowAwardOrigin(project.id, "2026-11", B),
      },
    ]);
    // A finalized month accepts no change, through the service or directly.
    await rejects(
      owner().changeAllocation(project.id, "2026-11", actor, {
        githubUserId: B,
        grossBase: "1",
        expectedSequence: 1,
      }),
      "month_frozen",
    );
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO monthly_allocation_changes VALUES(?,?,2,?,'1',?,?)",
        )
        .run(project.id, "2026-11", B, OWNER, afterCutoff.toISOString()),
    ).toThrow("monthly allocations frozen");
    // The owner's late finalization reuses the automatic snapshot.
    const view = await owner().finalize(project.id, "2026-11", actor, 1);
    expect(view.run?.trigger).toBe("automatic");
    expect(count("monthly_payment_runs")).toBe(1);
    expect(view.run?.awards.map((award) => award.state)).toEqual([
      "awaiting-reservation",
      "awaiting-reservation",
    ]);
  });

  test("a funding-time excluded award is not advertised as awaiting payment", async () => {
    const token = "c".repeat(43);
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node-first',?,'first',?,0)",
      )
      .run(A, afterCutoff.toISOString());
    sqlite
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(await sha256Hex(token), "node-first", "2027-01-01T00:00:00.000Z");
    seedParticipationBan(
      sqlite,
      { githubId: A, githubLogin: "first" },
      { githubId: "900000072", githubLogin: "moderator" },
      beforeCutoff.toISOString(),
    );
    vault("1000");
    await coordinate(afterCutoff);
    const response = await handlePaymentsApi(
      new Request("https://slop.cash/api/v1/payments/me", {
        headers: { cookie: `__Host-slop_points=${token}` },
      }),
      { db, now: () => afterCutoff },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      monthlyAwards: [],
      payments: [],
      balances: [],
    });
    expect(count("monthly_payment_exclusions")).toBe(1);
    expect(count("monthly_payment_runs")).toBe(1);
    expect(
      (await owner().view(project.id, "2026-11", actor)).run?.awards.find(
        (a) => a.githubUserId === A,
      )?.state,
    ).toBe("excluded");
  });

  test("a contributor's account shows the approved monthly award from the freeze until the vault reserves it", async () => {
    const token = "c".repeat(43);
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node-first',?,'first',?,0)",
      )
      .run(A, afterCutoff.toISOString());
    sqlite
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(await sha256Hex(token), "node-first", "2027-01-01T00:00:00.000Z");
    const account = async () =>
      (await (
        await handlePaymentsApi(
          new Request("https://slop.cash/api/v1/payments/me", {
            headers: { cookie: `__Host-slop_points=${token}` },
          }),
          { db, now: () => clock },
        )
      ).json()) as PaymentsAccount;
    // A proposal under the owner's review is private; nothing is shown.
    expect((await account()).monthlyAwards).toEqual([]);
    await coordinate(afterCutoff);
    vault("899");
    expect((await coordinate(afterCutoff)).waiting).toEqual([
      { key: `${project.id}/2026-11`, reason: "underfunded" },
    ]);
    const award = {
      projectId: project.id,
      period: "2026-11",
      network: "base-sepolia",
      chain: "base" as const,
      assetAddress: deployment.asset,
      assetDecimals: 6,
      grossBase: "600",
      feeBase: "12",
      netBase: "588",
    };
    // Approved and frozen, but the vault cannot cover the month yet.
    expect(await account()).toMatchObject({
      monthlyAwards: [{ ...award, state: "underfunded" }],
      payments: [],
      balances: [],
    });
    vault("1000");
    expect((await coordinate(afterCutoff)).created).toEqual([
      `${project.id}/2026-11`,
    ]);
    expect((await account()).monthlyAwards).toEqual([
      { ...award, state: "awaiting-reservation" },
    ]);
    // The finalized chain projection records the reservation: the award is
    // now a reserved payment that waits for the contributor's wallet.
    sqlite
      .prepare(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,?,?,?,6,'600','12',?,'reserved',?,NULL)",
      )
      .run(
        `0x${"8".repeat(64)}`,
        project.id,
        A,
        "base-sepolia",
        "base",
        deployment.vault,
        deployment.asset,
        escrowAwardOrigin(project.id, "2026-11", A),
        afterCutoff.toISOString(),
      );
    const reserved = await account();
    expect(reserved.monthlyAwards).toEqual([]);
    expect(reserved.payments).toMatchObject([
      {
        projectId: project.id,
        grossBase: "600",
        netBase: "588",
        state: "reserved",
        deliveryState: "needs_wallet",
      },
    ]);
  });

  test("without a defined cutoff nothing is frozen automatically, but the owner can finalize", async () => {
    expect((await coordinate(afterCutoff, null)).frozen).toEqual([]);
    expect(count("monthly_payment_runs")).toBe(0);
    vault("1000");
    const view = await owner().finalize(project.id, "2026-11", actor, 0);
    expect(view.run).toMatchObject({ trigger: "owner", funded: true });
    expect(count("monthly_payment_obligations")).toBe(2);
    expect((await coordinate(afterCutoff, null)).created).toEqual([]);
  });

  test("an owner who turns the default off, a restricted project and an unserved vault are not distributed automatically", async () => {
    expect(await owner().setAutomatic(project.id, actor, false)).toEqual({
      automatic: false,
    });
    expect((await coordinate(afterCutoff)).waiting).toEqual([
      { key: `${project.id}/2026-11`, reason: "automatic-off" },
    ]);
    await owner().setAutomatic(project.id, actor, true);
    restricted = true;
    expect((await coordinate(afterCutoff)).waiting).toEqual([
      { key: `${project.id}/2026-11`, reason: "project-restricted" },
    ]);
    await rejects(
      owner().finalize(project.id, "2026-11", actor, 0),
      "project_restricted",
    );
    restricted = false;
    const unserved = await coordinateMonthlyPayments({
      db,
      projects: projects(),
      networks: ["solana-devnet"],
      schedule,
      now: afterCutoff,
    });
    expect(unserved.waiting).toEqual([
      { key: `${project.id}/2026-11`, reason: "vault-not-served" },
    ]);
    expect(count("monthly_payment_runs")).toBe(0);
  });

  test("an award reserved earlier needs no new funds and cannot be planned twice", async () => {
    sqlite
      .prepare(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,?,?,?,6,'600','12',?,'reserved',?,NULL)",
      )
      .run(
        `0x${"9".repeat(64)}`,
        project.id,
        A,
        "base-sepolia",
        "base",
        deployment.vault,
        deployment.asset,
        escrowAwardOrigin(project.id, "2026-11", A),
        afterCutoff.toISOString(),
      );
    await coordinate(afterCutoff);
    vault("400");
    expect((await coordinate(afterCutoff)).created).toEqual([
      `${project.id}/2026-11`,
    ]);
    const view = await owner().view(project.id, "2026-11", actor);
    expect(view.run?.awards.map((award) => [award.login, award.state])).toEqual(
      [
        ["first", "reserved"],
        ["second", "awaiting-reservation"],
      ],
    );
    const expected = {
      network: "base-sepolia",
      manifestSha256: project.manifestSha256,
      snapshotSha256: view.run?.snapshotSha256 ?? "",
    };
    await rejects(
      owner().commitment(project.id, "2026-11", actor, {
        ...expected,
        githubUserId: A,
      }),
      "award_reserved",
    );
    const plan = await owner().commitment(project.id, "2026-11", actor, {
      ...expected,
      githubUserId: B,
    });
    expect(plan).toMatchObject({
      schemaVersion: "2",
      cycleId: "2026-11",
      deployment: { vault: deployment.vault },
      award: {
        githubUserId: B,
        sourceDigest: escrowAwardOrigin(project.id, "2026-11", B),
        gross: "400",
        fee: "8",
        net: "392",
      },
    });
    await rejects(
      owner().commitment(project.id, "2026-11", actor, {
        ...expected,
        githubUserId: B,
        snapshotSha256: "0".repeat(64),
      }),
      "snapshot_changed",
    );
  });

  test("an underfunded month has no obligation to reserve, and earlier unreserved obligations hold their funds", async () => {
    await coordinate(afterCutoff);
    vault("999");
    await coordinate(afterCutoff);
    const view = await owner().view(project.id, "2026-11", actor);
    expect(view.run?.funded).toBe(false);
    expect(view.run?.awards.map((award) => award.state)).toEqual([
      "underfunded",
      "underfunded",
    ]);
    await rejects(
      owner().commitment(project.id, "2026-11", actor, {
        network: "base-sepolia",
        manifestSha256: project.manifestSha256,
        snapshotSha256: view.run?.snapshotSha256 ?? "",
        githubUserId: A,
      }),
      "award_unfunded",
    );
    // A refreshed balance can arrive after the read but before the batch.
    vault("5000");
    const originalBatch = db.batch.bind(db);
    db.batch = async (statements) => {
      vault("0");
      return originalBatch(statements);
    };
    await coordinate(afterCutoff);
    db.batch = originalBatch;
    expect(count("monthly_payment_obligations")).toBe(0);
    expect((await owner().view(project.id, "2026-11", actor)).run?.funded).toBe(
      false,
    );
    // A stale vault reading never funds a month.
    vault("5000", "2026-11-30T00:00:00.000Z");
    expect((await coordinate(afterCutoff)).waiting).toEqual([
      { key: `${project.id}/2026-11`, reason: "stale-funding" },
    ]);
    vault("5000");
    expect((await coordinate(afterCutoff)).created).toEqual([
      `${project.id}/2026-11`,
    ]);
    expect(count("monthly_payment_obligations")).toBe(2);
  });

  test("after the cutoff the automatic default fixes the allocations until they are frozen", async () => {
    await rejects(
      owner().changeAllocation(project.id, "2026-11", actor, {
        githubUserId: B,
        grossBase: "100",
        expectedSequence: 0,
      }),
      "cutoff_passed",
    );
    await owner().setAutomatic(project.id, actor, false);
    const view = await owner().changeAllocation(project.id, "2026-11", actor, {
      githubUserId: B,
      grossBase: "100",
      expectedSequence: 0,
    });
    expect(view.proposal?.allocations.map((row) => row.grossBase)).toEqual([
      "600",
      "100",
    ]);
  });

  test("a month before the first automatic period is never frozen automatically", async () => {
    const later = parseMonthlySchedule(
      '{"firstPeriod":"2026-12","cutoffSecondsAfterPeriodEnd":259200}',
    );
    expect((await coordinate(afterCutoff, later)).waiting).toEqual([
      { key: `${project.id}/2026-11`, reason: "before-first-period" },
    ]);
    expect(count("monthly_payment_runs")).toBe(0);
  });

  test("private changes stay within the cap, never pay their author and are serialized", async () => {
    clock = beforeCutoff;
    const service = owner();
    await rejects(
      service.changeAllocation(project.id, "2026-11", actor, {
        githubUserId: B,
        grossBase: "401",
        expectedSequence: 0,
      }),
      "invalid_allocation",
    );
    const self = await service
      .changeAllocation(
        project.id,
        "2026-11",
        { githubId: A, githubLogin: "first" },
        { githubUserId: A, grossBase: "700", expectedSequence: 0 },
      )
      .catch((error: MonthlyPaymentError) => error);
    expect(self).toMatchObject({ status: 403, code: "invalid_allocation" });
    await service.changeAllocation(project.id, "2026-11", actor, {
      githubUserId: B,
      grossBase: "100",
      expectedSequence: 0,
    });
    await rejects(
      service.changeAllocation(project.id, "2026-11", actor, {
        githubUserId: A,
        grossBase: "100",
        expectedSequence: 0,
      }),
      "allocations_changed",
    );
    await rejects(
      service.finalize(project.id, "2026-11", actor, 0),
      "allocations_changed",
    );
    // The view shows current amounts, never who changed them or when.
    const view = await service.view(project.id, "2026-11", actor);
    expect(JSON.stringify(view)).not.toContain(OWNER);
    expect(view.proposal?.allocations.map((row) => row.grossBase)).toEqual([
      "600",
      "100",
    ]);
  });

  test("an open month cannot be finalized", async () => {
    clock = new Date("2026-11-30T23:00:00.000Z");
    await rejects(
      owner().finalize(project.id, "2026-11", actor, 0),
      "month_open",
    );
  });

  test("private bounty programs never run the monthly coordinator", async () => {
    expect(
      await runMonthlyCoordinator({
        PAYMENT_SCOPE: "security-bounty",
      } as never),
    ).toBeNull();
  });
});

describe("monthly attestation input", () => {
  async function prepare(
    options: { now?: Date; blocked?: boolean; digest?: string } = {},
  ) {
    const row = sqlite
      .prepare(
        "SELECT snapshot_sha256 digest FROM monthly_payment_runs WHERE project_id=? AND period=?",
      )
      .get(project.id, "2026-11") as { digest: string } | null;
    if (!schedule) throw new Error("Fixture schedule missing");
    return prepareMonthlyAttestation(
      {
        db,
        ...projects(),
        networks: ["base-sepolia"],
        schedule,
        now: options.now ?? afterCutoff,
      },
      {
        projectId: project.id,
        period: "2026-11",
        network: "base-sepolia",
        snapshotSha256: options.digest ?? row?.digest ?? "0".repeat(64),
      },
    );
  }
  test("uses only the frozen owner-adjusted awards, even after a later funding observation", async () => {
    clock = beforeCutoff;
    await owner().changeAllocation(project.id, "2026-11", actor, {
      githubUserId: B,
      grossBase: "300",
      expectedSequence: 0,
    });
    vault("2000");
    await coordinate(afterCutoff);
    const plan = await prepare();
    expect(plan.entries.map((e) => [e.githubUserId, e.grossMicro])).toEqual([
      [A, "600"],
      [B, "300"],
    ]);
    expect(plan.totalGrossBase).toBe("900");
    vault("5000");
    expect(await prepare()).toEqual(plan);
    await rejects(prepare({ digest: "f".repeat(64) }), "snapshot_changed");
    expect(count("payment_obligations")).toBe(0);
  });
  test("refuses the root before the cutoff, after its window, and when the whole month is unfunded", async () => {
    vault("500");
    await coordinate(afterCutoff);
    await rejects(prepare({ now: beforeCutoff }), "monthly_window_closed");
    await rejects(
      prepare({ now: new Date("2027-01-04T00:00:00.000Z") }),
      "monthly_window_closed",
    );
    await rejects(prepare(), "award_unfunded");
    vault("1000");
    await coordinate(afterCutoff);
    expect((await prepare()).totalGrossBase).toBe("1000");
  });
  test("rechecks restrictions and the owner's opt-out after the month was frozen", async () => {
    vault("1000");
    await coordinate(afterCutoff);
    restricted = true;
    await rejects(prepare(), "project_restricted");
    restricted = false;
    sqlite
      .prepare(
        "INSERT INTO monthly_payment_settings(project_id,sequence,automatic,actor_id,created_at) VALUES(?,1,0,?,?)",
      )
      .run(project.id, OWNER, afterCutoff.toISOString());
    await rejects(prepare(), "automatic_off");
    expect(count("monthly_payment_obligations")).toBe(2);
  });
  test("omits funding-time exclusions while preserving awards funded before a later ban", async () => {
    seedParticipationBan(
      sqlite,
      { githubId: B, githubLogin: "second" },
      { githubId: "900000072", githubLogin: "moderator" },
      beforeCutoff.toISOString(),
    );
    vault("1000");
    await coordinate(afterCutoff);
    const initial = await prepare();
    expect(initial.entries.map((e) => e.githubUserId)).toEqual([A]);
    expect(initial.totalGrossBase).toBe("600");
    seedParticipationBan(
      sqlite,
      { githubId: A, githubLogin: "first" },
      { githubId: "900000072", githubLogin: "moderator" },
      afterCutoff.toISOString(),
    );
    expect(await prepare()).toEqual(initial);
  });
  test("rejects a forged frozen payload even when its metadata still names the real project", async () => {
    vault("1000");
    await coordinate(afterCutoff);
    // Simulate storage corruption outside the normal immutable API.
    const row = sqlite
      .prepare("SELECT snapshot FROM monthly_payment_runs")
      .get() as { snapshot: string };
    const bad = JSON.parse(row.snapshot);
    bad.awards[0].grossBase = "601";
    for (const trigger of sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='monthly_payment_runs'",
      )
      .all() as { name: string }[])
      sqlite.exec(`DROP TRIGGER ${trigger.name}`);
    sqlite
      .prepare("UPDATE monthly_payment_runs SET snapshot=?")
      .run(JSON.stringify(bad));
    await rejects(prepare(), "snapshot_changed");
  });
});

test("monthly signing preserves its first intent through retry and refuses a changed root", async () => {
  vault("1000");
  await coordinate(afterCutoff);
  if (!schedule) throw new Error("Fixture schedule missing");
  const { digest } = sqlite
    .prepare("SELECT snapshot_sha256 digest FROM monthly_payment_runs")
    .get() as { digest: string };
  const records = new Map<string, unknown>();
  const journal: JournalStore = {
    async get<T>(key: string) {
      return records.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      records.set(key, structuredClone(value));
    },
    async transaction<T>(fn: (store: JournalStore) => Promise<T>) {
      return fn(journal);
    },
  };
  let signatures = 0;
  const deps = {
    db,
    ...projects(),
    networks: ["base-sepolia"],
    schedule,
    now: () => afterCutoff,
    journal,
    verifyDeployment: async () => {}, // Chain preflight has independent RPC integration coverage.
    sign: async (plan: { messageHex: string }) => {
      signatures++;
      return (await testAttester.sign({ hash: `0x${plan.messageHex}` })).slice(
        2,
      );
    },
  };
  const request = {
    projectId: project.id,
    period: "2026-11",
    network: "base-sepolia" as const,
    snapshotSha256: digest,
  };
  const first = await signMonthlyAllocation(deps, request);
  expect(await signMonthlyAllocation(deps, request)).toEqual(first);
  expect(signatures).toBe(1);
  const publicUrl = `https://slop.cash/api/v1/payments/projects/${project.id}/monthly/2026-11/authorization/base-sepolia`;
  expect((await handlePaymentsApi(new Request(publicUrl), { db })).status).toBe(
    404,
  );
  const publication = {
    db,
    networks: ["base-sepolia"],
    schedule,
    now: afterCutoff,
    authorize: async () => first,
  };
  const failed = await publishMonthlyAuthorizations({
    ...publication,
    authorize: async () => {
      throw new Error("transient signer outage");
    },
  });
  expect(failed.failures).toHaveLength(1);
  expect(count("monthly_payment_authorizations")).toBe(0);
  expect((await publishMonthlyAuthorizations(publication)).published).toEqual([
    `${project.id}/2026-11/base-sepolia`,
  ]);
  expect(
    await publishMonthlyAuthorizations({
      ...publication,
      authorize: async () => {
        throw new Error("must reuse published authorization");
      },
    }),
  ).toEqual({ published: [], failures: [] });
  const response = await handlePaymentsApi(new Request(publicUrl), { db });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    authorization: first,
    publishedAt: afterCutoff.toISOString(),
  });
  expect(count("payment_obligations")).toBe(0);
  expect(() =>
    sqlite.exec("DELETE FROM monthly_payment_authorizations"),
  ).toThrow("permanent");
  let dispatches = 0;
  const dispatcher = {
    PAYMENTS_DB: db,
    REGISTRY_DB: db,
    PAYMENT_NETWORKS: '["base-sepolia"]',
    PAYMENT_RPC_URLS: "{}",
    MONTHLY_PAYMENT_SCHEDULE: JSON.stringify(schedule),
    EVM_PAYMENT_EXECUTOR: {
      fetch: async (request: Request) => {
        expect(new URL(request.url).pathname).toBe("/v1/commit-monthly");
        expect(await request.json()).toEqual(first);
        dispatches++;
        return Response.json({
          transactionId: `0x${"ab".repeat(32)}`,
          alreadyCommitted: false,
        });
      },
    },
  };
  await runMonthlyCommitments(dispatcher, afterCutoff);
  expect(dispatches).toBe(1);
  await expect(
    runMonthlyCommitments(
      {
        ...dispatcher,
        EVM_PAYMENT_EXECUTOR: { fetch: async () => Response.json({}) },
      },
      afterCutoff,
    ),
  ).rejects.toThrow("Monthly commitment failures");
  expect(count("payment_obligations")).toBe(0);
  // A saved intent survives an interrupted signer and cannot be replaced.
  const [key, value] = [...records.entries()][0] as [
    string,
    { messageHex: string },
  ];
  records.set(key, { ...value, messageHex: "a".repeat(64) });
  await expect(signMonthlyAllocation(deps, request)).rejects.toThrow(
    "already bound",
  );
  expect(signatures).toBe(1);
});

test("monthly signing never publishes when the signer fails or an opt-out arrives during signing", async () => {
  vault("1000");
  await coordinate(afterCutoff);
  if (!schedule) throw new Error("Fixture schedule missing");
  const { digest } = sqlite
    .prepare("SELECT snapshot_sha256 digest FROM monthly_payment_runs")
    .get() as { digest: string };
  const records = new Map<string, unknown>();
  const journal: JournalStore = {
    async get<T>(key: string) {
      return records.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      records.set(key, structuredClone(value));
    },
    async transaction<T>(fn: (store: JournalStore) => Promise<T>) {
      return fn(journal);
    },
  };
  const deps = {
    db,
    ...projects(),
    networks: ["base-sepolia"],
    schedule,
    now: () => afterCutoff,
    journal,
    verifyDeployment: async () => {},
    sign: async () => {
      throw new Error("signer unavailable");
    },
  };
  const request = {
    projectId: project.id,
    period: "2026-11",
    network: "base-sepolia" as const,
    snapshotSha256: digest,
  };
  await expect(signMonthlyAllocation(deps, request)).rejects.toThrow(
    "signer unavailable",
  );
  expect([...records.values()]).toHaveLength(1);
  expect([...records.values()][0]).not.toHaveProperty("authorization");
  await rejects(
    signMonthlyAllocation(
      {
        ...deps,
        sign: async (plan) => {
          sqlite
            .prepare(
              "INSERT INTO monthly_payment_settings(project_id,sequence,automatic,actor_id,created_at) VALUES(?,1,0,?,?)",
            )
            .run(project.id, OWNER, afterCutoff.toISOString());
          return (
            await testAttester.sign({ hash: `0x${plan.messageHex}` })
          ).slice(2);
        },
      },
      request,
    ),
    "automatic_off",
  );
  expect([...records.values()][0]).not.toHaveProperty("authorization");
});

test("monthly dispatcher resumes an older Solana reservation after opt-out and retires only finalized completion", async () => {
  vault("1000");
  await coordinate(afterCutoff);
  await owner().setAutomatic(project.id, actor, false);
  // This is the dispatcher transport boundary. Real signature/admission and
  // post-opt-out leaf execution are covered by the Solana validator suite.
  const solana = solanaDeployment;
  const current = sqlite
    .prepare("SELECT manifest FROM projects WHERE id=?")
    .get(project.id) as { manifest: string };
  const manifest = JSON.parse(current.manifest);
  manifest.escrow.chain = "solana";
  manifest.escrow.deployments = [solana];
  const text = JSON.stringify(manifest);
  const digest = await sha256Hex(text);
  sqlite
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,2,?,?,?,?)",
    )
    .run(
      project.id,
      text,
      digest,
      "Solana dispatcher fixture",
      afterCutoff.toISOString(),
    );
  sqlite
    .prepare(
      "UPDATE projects SET revision=2,manifest=?,manifest_sha256=? WHERE id=?",
    )
    .run(text, digest, project.id);
  const authorization = {
    plan: {
      family: "solana",
      request: {
        projectId: project.id,
        period: "2026-11",
        network: "solana-devnet",
      },
      deployment: solana,
    },
  };
  sqlite
    .prepare("INSERT INTO monthly_payment_authorizations VALUES(?,?,?,?,?,?)")
    .run(
      project.id,
      "2026-11",
      "solana-devnet",
      "a".repeat(64),
      JSON.stringify(authorization),
      afterCutoff.toISOString(),
    );
  let calls = 0;
  const dispatcher = {
    PAYMENTS_DB: db,
    REGISTRY_DB: db,
    PAYMENT_NETWORKS: '["solana-devnet"]',
    PAYMENT_RPC_URLS: "{}",
    MONTHLY_PAYMENT_SCHEDULE: JSON.stringify(schedule),
    SOLANA_PAYMENT_EXECUTOR: {
      async fetch(request: Request) {
        expect(new URL(request.url).searchParams.get("admit")).toBe("false");
        expect(await request.json()).toEqual(authorization);
        calls++;
        if (calls === 1)
          return Response.json({
            transactionId: null,
            alreadyCommitted: false,
            notAdmitted: true,
          });
        if (calls === 2)
          return Response.json({
            transactionId: "accepted-signature",
            alreadyCommitted: false,
          });
        return Response.json({ transactionId: null, alreadyCommitted: true });
      },
    },
  };
  const nextMonth = new Date("2027-01-05T00:00:00Z");
  await runMonthlyCommitments(dispatcher, nextMonth);
  await runMonthlyCommitments(dispatcher, nextMonth);
  await runMonthlyCommitments(dispatcher, nextMonth);
  await runMonthlyCommitments(dispatcher, nextMonth);
  expect(calls).toBe(3);
  expect(count("payment_obligations")).toBe(0);
});

test("Solana v3 retries preserve the first signed freeze time after a signer outage", async () => {
  sqlite.close();
  const seed = new Uint8Array(32).fill(7); // Public synthetic test key.
  await setupFixture({
    ...solanaDeployment,
    identityAuthority: solanaBase58(ed25519.getPublicKey(seed)),
  });
  vault("1000");
  await coordinate(afterCutoff);
  if (!schedule) throw new Error("Missing fixture schedule");
  const row = sqlite
    .prepare("SELECT snapshot_sha256 digest FROM monthly_payment_runs")
    .get() as { digest: string };
  const values = new Map<string, unknown>();
  const journal: JournalStore = {
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      values.set(key, structuredClone(value));
    },
    async transaction<T>(fn: (store: JournalStore) => Promise<T>) {
      return fn(journal);
    },
  };
  let now = new Date(afterCutoff.getTime() + 30_000);
  let freezeReads = 0;
  let fail = true;
  const messages: string[] = [];
  const deps = {
    db,
    ...projects(),
    networks: ["solana-devnet"],
    schedule,
    now: () => now,
    journal,
    verifyDeployment: async () => {},
    freeze: async () => {
      freezeReads++;
      return String(afterCutoff.getTime() / 1000);
    },
    sign: async (plan: { messageHex: string }) => {
      messages.push(plan.messageHex);
      if (fail) throw new Error("test signer outage");
      return Buffer.from(
        ed25519.sign(Buffer.from(plan.messageHex, "hex"), seed),
      ).toString("hex");
    },
  };
  const request = {
    projectId: project.id,
    period: "2026-11",
    network: "solana-devnet" as const,
    snapshotSha256: row.digest,
  };
  await expect(signMonthlyAllocation(deps, request)).rejects.toThrow(
    "test signer outage",
  );
  now = new Date(afterCutoff.getTime() + 60_000);
  fail = false;
  const signed = await signMonthlyAllocation(deps, request);
  expect(signed.plan.frozenAt).toBe(String(afterCutoff.getTime() / 1000));
  expect(messages[1]).toBe(messages[0]);
  now = new Date(afterCutoff.getTime() + 120_000);
  expect(await signMonthlyAllocation(deps, request)).toEqual(signed);
  expect(messages.length).toBe(2);
  expect(freezeReads).toBe(1);
});
