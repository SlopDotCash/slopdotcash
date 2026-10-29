/** Real migrations and registry tables; GitHub authority is a controlled stub here (see scripts/owner-award-authority.test.ts). */

import type { Database } from "bun:sqlite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { privateKeyToAccount } from "viem/accounts";
import {
  EvmMonthlyAlreadyAdmitted,
  evmMonthlySumTree,
} from "../../contracts/evm/adapter";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { monthlyBasesSql } from "../../scripts/prepare-monthly-rewards";
import { requestOwnerCommitment } from "../../src/lib/owner-commitment-actions";
import type { PaymentsAccount } from "../../src/lib/payments/contracts";
import { escrowAwardOrigin } from "../../src/lib/payments/escrow-cycle";
import { parseMonthlySchedule } from "../../src/lib/payments/monthly-allocation";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { fixtureProject } from "../../tests/fixture-overlay.mjs";
import { createMonthlyAllocationFixture } from "../../tests/monthly-allocation-fixture";
import { seedParticipationBan } from "../../tests/participation-ban.fixture";
import { sha256Hex } from "../../workers/identity/crypto";
import type { JournalStore } from "../../workers/payment-executor/core";
import { runMonthlyAttester } from "../../workers/payment-executor/index";
import { signMonthlyAllocation } from "../../workers/payment-executor/monthly";
import { runMonthlyCommitments } from "../../workers/payments/index";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../projects/cloudflare-persistence";
import { handlePaymentsApi } from "./handler";
import {
  coordinateMonthlyPayments,
  MonthlyPaymentError,
  monthlyOwnerService,
} from "./monthly";
import {
  type MonthlyAttestationPlan,
  prepareMonthlyAttestation,
} from "./monthly-attestation";
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
  ({ db, sqlite, project } = await createMonthlyAllocationFixture({
    deployment: selected,
    unit,
    applyAmountRange,
  }));
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
  test("Solana refuses a monthly cap above its token range before storing an allocation", async () => {
    sqlite.close();
    await setupFixture(solanaDeployment, 10n ** 18n);
    clock = beforeCutoff;
    await expect(
      owner().changeAllocation(project.id, "2026-11", actor, {
        githubUserId: B,
        grossBase: (300n * 10n ** 18n).toString(),
        expectedSequence: 0,
      }),
    ).rejects.toThrow("monthly pool policy is inconsistent");
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

  test("an 18-decimal token month keeps exact amounts through owner review, freeze and attestation", async () => {
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
    // Use the real commitment route and database result as the browser's input.
    // GitHub authority remains controlled by this existing fixture.
    clock = afterCutoff;
    const token = "o".repeat(43);
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node-owner',?,'owner',?,0)",
      )
      .run(OWNER, afterCutoff.toISOString());
    sqlite
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(await sha256Hex(token), "node-owner", "2027-01-01T00:00:00.000Z");
    const originalFetch = globalThis.fetch;
    let commitmentRequests = 0;
    globalThis.fetch = (async (input, init) => {
      const request = new Request(
        new URL(String(input), "https://slop.cash"),
        init,
      );
      expect(new URL(request.url).pathname).toBe(
        `/api/v1/payments/projects/${project.id}/monthly/2026-11/commitment`,
      );
      request.headers.set("cookie", `__Host-slop_points=${token}`);
      request.headers.set("origin", "https://slop.cash");
      commitmentRequests += 1;
      const response = await handlePaymentsApi(request, {
        db,
        monthly: owner(),
        now: () => afterCutoff,
      });
      expect(response.status).toBe(200);
      return response;
    }) as typeof fetch;
    try {
      const reviewed = await requestOwnerCommitment(project.id, "2026-11", {
        network: "base-sepolia",
        githubUserId: A,
        manifestSha256: project.manifestSha256,
        snapshotSha256: digest,
      });
      expect(reviewed.award).toMatchObject({
        gross: (600n * unit).toString(),
        fee: (12n * unit).toString(),
        net: (588n * unit).toString(),
      });
      expect(commitmentRequests).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
        action_path: `/projects/${project.id}/funding`,
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

  test("a Solana hand reservation waits until automatic monthly payment is off", async () => {
    await setupFixture(solanaDeployment);
    await coordinate(afterCutoff);
    vault("1000");
    expect((await coordinate(afterCutoff)).created).toEqual([
      `${project.id}/2026-11`,
    ]);
    const service = monthlyOwnerService({
      db,
      ...projects(),
      networks: () => [solanaDeployment.network],
      verifyAuthority: async () => {},
      schedule: () => schedule,
      now: () => clock,
    });
    const request = {
      network: solanaDeployment.network,
      manifestSha256: project.manifestSha256,
      snapshotSha256:
        (await service.view(project.id, "2026-11", actor)).run
          ?.snapshotSha256 ?? "",
      githubUserId: A,
    };
    await rejects(
      service.commitment(project.id, "2026-11", actor, request),
      "monthly_automatic",
    );
    await service.setAutomatic(project.id, actor, false);
    expect(
      await service.commitment(project.id, "2026-11", actor, request),
    ).toMatchObject({ award: { githubUserId: A, gross: "600", fee: "12" } });
  });

  test("a Solana month needs its full total free, even for an award reserved earlier", async () => {
    // Solana admission reserves the whole total; the identical earlier award is
    // released afterwards, so it cannot count as already funded.
    await setupFixture(solanaDeployment);
    sqlite
      .prepare(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,?,?,?,6,'600','12',?,'reserved',?,NULL)",
      )
      .run(
        "9".repeat(64),
        project.id,
        A,
        solanaDeployment.network,
        "solana",
        solanaDeployment.vault,
        solanaDeployment.asset,
        escrowAwardOrigin(project.id, "2026-11", A),
        afterCutoff.toISOString(),
      );
    await coordinate(afterCutoff);
    vault("999");
    expect((await coordinate(afterCutoff)).created).toEqual([]);
    expect(count("monthly_payment_obligations")).toBe(0);
    vault("1000");
    expect((await coordinate(afterCutoff)).created).toEqual([
      `${project.id}/2026-11`,
    ]);
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

  test("a change that crosses the cutoff while loading its proposal cannot alter the frozen month", async () => {
    clock = beforeCutoff;
    const prepare = db.prepare.bind(db);
    db.prepare = (query) => {
      const statement = prepare(query);
      if (
        !query.startsWith(
          "SELECT manifest,manifest_sha256,source_snapshot_sha256",
        )
      )
        return statement;
      return {
        ...statement,
        bind(...values: unknown[]) {
          const bound = statement.bind(...values);
          return {
            ...bound,
            async first<T>() {
              const row = await bound.first<T>();
              clock = afterCutoff;
              return row;
            },
          };
        },
      };
    };
    try {
      await rejects(
        owner().changeAllocation(project.id, "2026-11", actor, {
          githubUserId: B,
          grossBase: "100",
          expectedSequence: 0,
        }),
        "cutoff_passed",
      );
    } finally {
      db.prepare = prepare;
    }
    expect(count("monthly_allocation_changes")).toBe(0);
    vault("1000");
    await coordinate(afterCutoff);
    const frozen = await owner().view(project.id, "2026-11", actor);
    expect(frozen.run?.awards.map((award) => award.grossBase)).toEqual([
      "600",
      "400",
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

  test("monthly HTTP writes distinguish storage outages from allocation races", async () => {
    clock = beforeCutoff;
    const service = owner();
    const token = "w".repeat(43);
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('write-owner',?,'owner',?,0)",
      )
      .run(OWNER, clock.toISOString());
    sqlite
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(await sha256Hex(token), "write-owner", "2027-01-01T00:00:00.000Z");
    const call = (action: string, body: unknown) =>
      handlePaymentsApi(
        new Request(
          `https://slop.cash/api/v1/payments/projects/${project.id}/${action}`,
          {
            method: "POST",
            headers: {
              origin: "https://slop.cash",
              "content-type": "application/json",
              cookie: `__Host-slop_points=${token}`,
            },
            body: JSON.stringify(body),
          },
        ),
        { db, monthly: service, now: () => clock },
      );
    const allocation = (
      githubUserId: string,
      grossBase: string,
      expectedSequence: number,
    ) =>
      call("monthly/2026-11/allocations", {
        githubUserId,
        grossBase,
        expectedSequence,
      });
    expect((await call("monthly-settings", { automatic: false })).status).toBe(
      200,
    );
    expect((await allocation(B, "300", 0)).status).toBe(200);
    const records = () =>
      Object.fromEntries(
        [
          "monthly_allocation_changes",
          "monthly_payment_settings",
          "monthly_payment_runs",
          "monthly_payment_obligations",
        ].map((table) => [
          table,
          sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ]),
      );
    const before = records();
    sqlite.exec("PRAGMA query_only = ON");
    try {
      for (const response of [
        await allocation(B, "200", 1),
        await call("monthly-settings", { automatic: true }),
      ]) {
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: "payments_unavailable",
        });
      }
      expect(records()).toEqual(before);
    } finally {
      sqlite.exec("PRAGMA query_only = OFF");
    }
    expect((await call("monthly-settings", { automatic: true })).status).toBe(
      200,
    );

    // Another real owner operation commits after our read and before our INSERT.
    // The losing write must remain a conflict, including the freeze trigger.
    const prepare = db.prepare.bind(db);
    const beforeAllocationWrite = (competing: () => Promise<unknown>) => {
      db.prepare = (query) => {
        const statement = prepare(query);
        if (!query.startsWith("INSERT INTO monthly_allocation_changes("))
          return statement;
        return {
          ...statement,
          bind(...values: unknown[]) {
            const bound = statement.bind(...values);
            return {
              ...bound,
              async run() {
                db.prepare = prepare;
                await competing();
                return bound.run();
              },
            };
          },
        };
      };
    };
    try {
      beforeAllocationWrite(() =>
        service.changeAllocation(project.id, "2026-11", actor, {
          githubUserId: A,
          grossBase: "500",
          expectedSequence: 1,
        }),
      );
      const raced = await allocation(B, "200", 1);
      expect(raced.status).toBe(409);
      expect(await raced.json()).toMatchObject({
        error: "allocations_changed",
      });
      expect(count("monthly_allocation_changes")).toBe(2);
      expect(
        (
          await service.view(project.id, "2026-11", actor)
        ).proposal?.allocations.map((row) => row.grossBase),
      ).toEqual(["500", "300"]);

      vault("1000");
      beforeAllocationWrite(() =>
        service.finalize(project.id, "2026-11", actor, 2),
      );
      const frozen = await allocation(B, "200", 2);
      expect(frozen.status).toBe(409);
      expect(await frozen.json()).toMatchObject({
        error: "allocations_changed",
      });
      expect(count("monthly_allocation_changes")).toBe(2);
      expect(count("monthly_payment_runs")).toBe(1);
      expect(count("monthly_payment_obligations")).toBe(2);
    } finally {
      db.prepare = prepare;
    }
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
  const chainObligation = (
    id: string,
    user: string,
    gross: string,
    fee: string,
    source: string,
  ) =>
    sqlite
      .prepare(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,?,?,?,6,?,?,?,'reserved',?,NULL)",
      )
      .run(
        `0x${id.repeat(64)}`,
        project.id,
        user,
        "base-sepolia",
        "base",
        deployment.vault,
        deployment.asset,
        gross,
        fee,
        escrowAwardOrigin(project.id, "2026-11", source),
        afterCutoff.toISOString(),
      );
  // Source digests are public: an owner can reserve another award under a frozen
  // award's source. Only the same actor and gross with a 2% fee (ceil, or the
  // pre-#1189 floor) is this award. Any other is a conflict: it needs no funds,
  // cannot be reserved, and is left out of the signed month so the rest commits.
  for (const [label, chainActor, chainGross, chainFee] of [
    ["another actor", "999", "600", "12"],
    ["a smaller gross", A, "1", "1"],
    ["a wrong fee", A, "600", "0"],
  ] as const)
    test(`an obligation for ${label} under a frozen award's source is a conflict left out of the month`, async () => {
      clock = beforeCutoff;
      // 399 has a floor fee of 7 and a ceil fee of 8.
      await owner().changeAllocation(project.id, "2026-11", actor, {
        githubUserId: B,
        grossBase: "399",
        expectedSequence: 0,
      });
      clock = afterCutoff;
      chainObligation("8", chainActor, chainGross, chainFee, A);
      chainObligation("9", B, "399", "7", B);
      // Neither source needs new funds: the month is funded with no vault reading.
      expect((await coordinate(afterCutoff)).created).toEqual([
        `${project.id}/2026-11`,
      ]);
      const view = await owner().view(project.id, "2026-11", actor);
      expect(
        view.run?.awards.map((award) => [award.login, award.state]),
      ).toEqual([
        ["first", "conflict"],
        ["second", "reserved"],
      ]);
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
        "award_conflict",
      );
      await rejects(
        owner().commitment(project.id, "2026-11", actor, {
          ...expected,
          githubUserId: B,
        }),
        "award_reserved",
      );
      // The identical legacy-fee award stays in the month and is counted once.
      const plan = await prepare();
      expect(plan.entries.map((e) => [e.githubUserId, e.grossMicro])).toEqual([
        [B, "399"],
      ]);
      expect(plan.totalGrossBase).toBe("399");
    });

  test("a contributor sees a conflicting award, and a month of only conflicts signs nothing", async () => {
    chainObligation("7", "999", "600", "12", A);
    chainObligation("8", "999", "400", "8", B);
    await coordinate(afterCutoff);
    await rejects(prepare(), "empty_allocation");
    const token = "c".repeat(43);
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node-first',?,'first',?,0)",
      )
      .run(A, afterCutoff.toISOString());
    sqlite
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(await sha256Hex(token), "node-first", "2027-01-01T00:00:00.000Z");
    const account = (await (
      await handlePaymentsApi(
        new Request("https://slop.cash/api/v1/payments/me", {
          headers: { cookie: `__Host-slop_points=${token}` },
        }),
        { db, now: () => clock },
      )
    ).json()) as PaymentsAccount;
    expect(account.monthlyAwards).toMatchObject([
      { projectId: project.id, grossBase: "600", state: "conflict" },
    ]);
  });
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
  test("signs a frozen month after a later revision that keeps its payment terms", async () => {
    const revise = async (
      change: (manifest: ProjectRecord["manifest"]) => object,
    ) => {
      const current = await projects().getProject(project.id);
      if (!current) throw new Error("Fixture project missing");
      const manifest = assertProjectDefinition(change(current.manifest));
      const text = JSON.stringify(manifest);
      expect(
        await new CloudflareProjectPersistence(db).appendProjectRevision(
          {
            projectId: project.id,
            expectedRevision: current.revision,
            manifest,
            manifestText: text,
            manifestSha256: await sha256Hex(text),
            reason: "Owner update",
            actor,
            at: afterCutoff.toISOString(),
          },
          0,
        ),
      ).toBe("updated");
    };
    vault("500");
    await coordinate(afterCutoff);
    await rejects(prepare(), "award_unfunded");
    // While the frozen month waits for a deposit, the owner edits the headline.
    await revise((manifest) => ({
      ...manifest,
      headline: `${manifest.headline} Now with vaults.`,
    }));
    vault("1000");
    expect((await coordinate(afterCutoff)).created).toEqual([
      `${project.id}/2026-11`,
    ]);
    expect((await prepare()).totalGrossBase).toBe("1000");
    // Terms that sized the month still bind it.
    await revise((manifest) => ({
      ...manifest,
      escrow: { ...manifest.escrow, effectiveCycle: "2026-12" },
    }));
    await rejects(prepare(), "financial_policy_changed");
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
  test("accepts a month frozen before fees rounded up, and no other fee", async () => {
    clock = beforeCutoff;
    await owner().changeAllocation(project.id, "2026-11", actor, {
      githubUserId: B,
      grossBase: "349",
      expectedSequence: 0,
    });
    vault("2000");
    await coordinate(afterCutoff);
    const current = await prepare();
    expect(current.entries.map((e) => [e.githubUserId, e.grossMicro])).toEqual([
      [A, "600"],
      [B, "349"],
    ]);
    const row = sqlite
      .prepare("SELECT snapshot FROM monthly_payment_runs")
      .get() as { snapshot: string };
    const frozen = JSON.parse(row.snapshot) as {
      awards: { githubUserId: string; feeBase: string; netBase: string }[];
    };
    const award = frozen.awards.find((a) => a.githubUserId === B);
    // A month frozen now holds ceil(349 / 50) = 7.
    expect([award?.feeBase, award?.netBase]).toEqual(["7", "342"]);
    // Rewrite the month as it was frozen before the change, with
    // floor(349 / 50) = 6 in the snapshot and in its funded obligation.
    for (const trigger of sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('monthly_payment_runs','monthly_payment_obligations')",
      )
      .all() as { name: string }[])
      sqlite.exec(`DROP TRIGGER ${trigger.name}`);
    const freezeWithFee = async (fee: string) => {
      if (!award) throw new Error("Fixture award missing");
      award.feeBase = fee;
      award.netBase = (349n - BigInt(fee)).toString();
      const text = JSON.stringify(frozen);
      sqlite
        .prepare(
          "UPDATE monthly_payment_runs SET snapshot=?, snapshot_sha256=?",
        )
        .run(text, await sha256Hex(text));
      sqlite
        .prepare(
          "UPDATE monthly_payment_obligations SET fee_base=? WHERE github_user_id=?",
        )
        .run(fee, B);
    };
    await freezeWithFee("6");
    const legacy = await prepare();
    // The allocation root binds actor, gross and source only, so the root is the same.
    expect(legacy.allocationRoot).toBe(current.allocationRoot);
    expect(legacy.entries).toEqual(current.entries);
    // A fee that neither rounding produces is not canonical.
    await freezeWithFee("5");
    await rejects(prepare(), "invalid_allocation");
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
    // A rebuilt snapshot must still name an actual immutable project revision.
    const unknownRevision = JSON.parse(row.snapshot);
    unknownRevision.manifestSha256 = "f".repeat(64);
    const text = JSON.stringify(unknownRevision);
    sqlite
      .prepare("UPDATE monthly_payment_runs SET snapshot=?,snapshot_sha256=?")
      .run(text, await sha256Hex(text));
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
      // A reviewed upgrade can add V2; an unchanged legacy vault reuses its
      // stored signature when the scheduled job checks again.
      authorize: async () => first,
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

test("the attester publishes every funded month while another project's month cannot be frozen", async () => {
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
  const signed = await signMonthlyAllocation(
    {
      db,
      ...projects(),
      networks: ["base-sepolia"],
      schedule,
      now: () => afterCutoff,
      journal,
      verifyDeployment: async () => {},
      sign: async (plan: { messageHex: string }) =>
        (await testAttester.sign({ hash: `0x${plan.messageHex}` })).slice(2),
    },
    {
      projectId: project.id,
      period: "2026-11",
      network: "base-sepolia",
      snapshotSha256: digest,
    },
  );
  // Another project was proposed as a vaultless pledge. Its owner then added
  // the first vault before the cutoff, so its month can never be frozen.
  const listed = fixtureProject("asi");
  const pledge = assertProjectDefinition({
    ...listed,
    reward: { ...listed.reward, feeBasisPoints: 200, chain: "base" },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-11",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [],
    },
  });
  const funded = JSON.stringify({
    ...pledge,
    escrow: {
      ...pledge.escrow,
      deployments: [{ ...deployment, vault: `0x${"7".repeat(40)}` }],
    },
  });
  const proposed = JSON.stringify(pledge);
  for (const [revision, text] of [
    [1, proposed],
    [2, funded],
  ] as const)
    sqlite
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,'Fixture','2026-12-02T00:00:00.000Z')",
      )
      .run(listed.id, revision, text, await sha256Hex(text));
  sqlite
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',2,?,?,?,?)",
    )
    .run(
      listed.id,
      funded,
      await sha256Hex(funded),
      "2026-10-01T00:00:00.000Z",
      "2026-12-02T00:00:00.000Z",
    );
  sqlite.exec(
    monthlyBasesSql(
      {
        period: "2026-11",
        skipped: [],
        bases: [
          {
            projectId: listed.id,
            period: "2026-11",
            manifest: proposed,
            manifestSha256: await sha256Hex(proposed),
            sourceSnapshotSha256: "6".repeat(64),
            capBase: "1000",
            rows: [
              {
                githubUserId: "303",
                login: "third",
                grossBase: "1000",
                sourceDigest: escrowAwardOrigin(listed.id, "2026-11", "303"),
              },
            ],
          },
        ],
      },
      "2026-12-01T00:11:00.000Z",
    ),
  );
  // No chain RPC exists here; vault reads and scans fail and are reported.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("No chain RPC in this test");
  }) as unknown as typeof fetch;
  setSystemTime(afterCutoff);
  const outcome = await runMonthlyAttester({
    SIGNER_ROLE: "attester",
    CHAIN_FAMILY: "evm",
    PAYMENTS_DB: db,
    REGISTRY_DB: db,
    MONTHLY_PAYMENT_SCHEDULE: JSON.stringify(schedule),
    PAYMENT_DEPLOYMENTS: JSON.stringify([{ network: "base-sepolia" }]),
    PAYMENT_RPC_URLS: "{}",
    JOURNAL: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (request: Request) => {
          expect(new URL(request.url).pathname).toBe(
            "/v1/monthly-authorization",
          );
          return Response.json(signed);
        },
      }),
    },
  } as never)
    .then(
      () => null,
      (error: unknown) => error,
    )
    .finally(() => {
      setSystemTime();
      globalThis.fetch = realFetch;
    });
  // The funded month of the healthy project is published.
  const published = sqlite
    .prepare(
      "SELECT project_id,authorization FROM monthly_payment_authorizations",
    )
    .all() as { project_id: string; authorization: string }[];
  expect(published.map((row) => row.project_id)).toEqual([project.id]);
  expect(JSON.parse(published[0].authorization)).toEqual(signed);
  // The other project's month stays unfrozen and the run still fails with it.
  expect(count("monthly_payment_runs")).toBe(1);
  expect(outcome).toBeInstanceOf(AggregateError);
  const coordinator = (outcome as AggregateError).errors.find(
    (error) =>
      error instanceof Error &&
      error.message === "Monthly coordinator failures",
  ) as AggregateError;
  expect(
    coordinator.errors.map((error) => (error as MonthlyPaymentError).code),
  ).toEqual(["financial_policy_changed"]);
});

test("V2 monthly signing publishes permanent source-bound attempts and resumes the selected admitted month", async () => {
  vault("1000");
  await coordinate(afterCutoff);
  if (!schedule) throw new Error("Fixture schedule missing");
  const { digest } = sqlite
    .prepare("SELECT snapshot_sha256 digest FROM monthly_payment_runs")
    .get() as { digest: string };
  const request = {
    projectId: project.id,
    period: "2026-11",
    network: "base-sepolia" as const,
    snapshotSha256: digest,
  };
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
  // Controlled finalized observations here; the Anvil workflow invokes the
  // real adapter with the same signer/publication path and actual source changes.
  let sequence = 9n;
  let admitted = false;
  let changeDuringSign = false;
  let signatures = 0;
  const deps = {
    db,
    ...projects(),
    networks: ["base-sepolia"],
    schedule,
    now: () => afterCutoff,
    journal,
    verifyDeployment: async () => {},
    reserve: async (plan: MonthlyAttestationPlan) => {
      if (admitted) throw new EvmMonthlyAlreadyAdmitted();
      expect(plan.entries.map((e) => e.githubUserId)).toEqual([A, B]);
      expect(plan.totalGrossBase).toBe("1000");
      const entries = sequence === 9n ? plan.entries : plan.entries.slice(1);
      const tree = evmMonthlySumTree(entries);
      return {
        entries,
        reservation: {
          version: 2 as const,
          allocationDigest: `0x${digest}`,
          allocationRoot: tree.hash,
          wholeGross: plan.totalGrossBase,
          remainingGross: tree.total.toString(),
          count: entries.length,
          sourceSequence: sequence.toString(),
        },
      };
    },
    sign: async (plan: MonthlyAttestationPlan) => {
      signatures++;
      const signature = (
        await testAttester.sign({ hash: `0x${plan.messageHex}` })
      ).slice(2);
      if (changeDuringSign) sequence++;
      return signature;
    },
  };
  const authorize = () => signMonthlyAllocation(deps, request);
  const publication = {
    db,
    networks: ["base-sepolia"],
    schedule,
    now: afterCutoff,
    authorize,
  };
  // This frozen month was published before its reviewed vault gained V2.
  // Keep the old signature, even if its all-at-once call is above the gas bound.
  const legacy = await signMonthlyAllocation(
    { ...deps, reserve: undefined },
    request,
  );
  expect(
    (
      await publishMonthlyAuthorizations({
        ...publication,
        authorize: async () => legacy,
      })
    ).failures,
  ).toEqual([]);
  const original = sqlite
    .prepare("SELECT authorization FROM monthly_payment_authorizations")
    .get();
  expect((await publishMonthlyAuthorizations(publication)).failures).toEqual(
    [],
  );
  const first = await authorize();
  expect(first.plan.evmReservation?.sourceSequence).toBe("9");
  expect(signatures).toBe(2);
  expect(count("monthly_payment_authorization_attempts")).toBe(1);
  expect(await publishMonthlyAuthorizations(publication)).toEqual({
    published: [],
    failures: [],
  });
  // The indexed conflicting source must not shrink the economic allocation.
  sqlite
    .prepare(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,?,?,?,6,'1','1',?,'reserved',?,NULL)",
    )
    .run(
      "manual-source",
      project.id,
      A,
      request.network,
      "base",
      deployment.vault,
      deployment.asset,
      escrowAwardOrigin(project.id, request.period, A),
      afterCutoff.toISOString(),
    );
  sequence = 10n;
  expect((await publishMonthlyAuthorizations(publication)).failures).toEqual(
    [],
  );
  const second = await authorize();
  expect(second.plan.entries.map((e) => e.githubUserId)).toEqual([B]);
  expect(second.plan.totalGrossBase).toBe("1000");
  expect(second.plan.evmReservation?.remainingGross).toBe("400");
  expect(second.plan.request).toEqual(first.plan.request);
  expect(second.plan.allocationRoot).not.toBe(first.plan.allocationRoot);
  expect(count("monthly_payment_authorization_attempts")).toBe(2);
  expect(
    sqlite
      .prepare("SELECT authorization FROM monthly_payment_authorizations")
      .get(),
  ).toEqual(original);
  const publicUrl = `https://slop.cash/api/v1/payments/projects/${project.id}/monthly/2026-11/authorization/base-sepolia`;
  const readPublic = async () => {
    const response = await handlePaymentsApi(new Request(publicUrl), { db });
    expect(response.status).toBe(200);
    return ((await response.json()) as { authorization: typeof second })
      .authorization;
  };
  expect(await readPublic()).toEqual({
    ...second,
    legacyAuthorization: legacy,
  });
  // An older signature cannot replace the new public execution inputs.
  expect(
    (
      await publishMonthlyAuthorizations({
        ...publication,
        authorize: async () => first,
      })
    ).failures,
  ).toHaveLength(1);
  expect(await readPublic()).toEqual({
    ...second,
    legacyAuthorization: legacy,
  });
  // A source consumed during signing leaves its intent, but publishes nothing.
  sequence = 11n;
  changeDuringSign = true;
  await expect(authorize()).rejects.toThrow("changed during signing");
  expect(count("monthly_payment_authorization_attempts")).toBe(2);
  changeDuringSign = false;
  // Sequence is uint256; ordering must not cast it to SQLite int64.
  sequence = 1n << 64n;
  expect((await publishMonthlyAuthorizations(publication)).failures).toEqual(
    [],
  );
  const current = await authorize();
  expect(await readPublic()).toEqual({
    ...current,
    legacyAuthorization: legacy,
  });
  expect(count("monthly_payment_authorization_attempts")).toBe(3);
  expect(() =>
    sqlite.exec(
      "UPDATE monthly_payment_authorization_attempts SET published_at='later'",
    ),
  ).toThrow("immutable");
  expect(() =>
    sqlite.exec("DELETE FROM monthly_payment_authorization_attempts"),
  ).toThrow("permanent");
  admitted = true;
  expect(await publishMonthlyAuthorizations(publication)).toEqual({
    published: [],
    failures: [],
  });
  expect(await readPublic()).toEqual({
    ...current,
    legacyAuthorization: legacy,
  });
  sqlite
    .prepare(
      "INSERT INTO monthly_payment_settings(project_id,sequence,automatic,actor_id,created_at) VALUES(?,1,0,?,?)",
    )
    .run(project.id, OWNER, afterCutoff.toISOString());
  let complete = false;
  let dispatches = 0;
  const dispatcher = {
    PAYMENTS_DB: db,
    REGISTRY_DB: db,
    PAYMENT_NETWORKS: '["base-sepolia"]',
    PAYMENT_RPC_URLS: "{}",
    MONTHLY_PAYMENT_SCHEDULE: JSON.stringify(schedule),
    EVM_PAYMENT_EXECUTOR: {
      fetch: async (request: Request) => {
        expect(new URL(request.url).searchParams.get("admit")).toBe("false");
        expect(await request.json()).toEqual({
          ...current,
          legacyAuthorization: legacy,
        });
        dispatches++;
        // A run that pushes V2 leaves to the admitted reserve returns the last leaf transaction.
        return Response.json({
          transactionId: complete ? null : `0x${"a".repeat(64)}`,
          alreadyCommitted: true,
          complete,
        });
      },
    },
  };
  const later = new Date("2027-01-04T00:00:00.000Z");
  await runMonthlyCommitments(dispatcher, later);
  expect(
    sqlite.prepare("SELECT complete FROM monthly_payment_execution").get(),
  ).toEqual({ complete: 0 });
  complete = true;
  await runMonthlyCommitments(dispatcher, later);
  await runMonthlyCommitments(dispatcher, later);
  expect(dispatches).toBe(2);
  expect(
    sqlite.prepare("SELECT complete FROM monthly_payment_execution").get(),
  ).toEqual({ complete: 1 });
  expect(count("payment_obligations")).toBe(1); // Only the separately indexed manual award.
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

test("monthly dispatcher sends a new EVM V2 reservation before an older month's leaves", async () => {
  // An older leaf mined first would advance ordinarySourceSequence and revert the newer
  // reservation, which was signed for the earlier sequence. This tests the dispatcher transport
  // boundary only, so the two authorizations need no frozen runs.
  sqlite.exec("PRAGMA foreign_keys=OFF");
  const insert = sqlite.prepare(
    "INSERT INTO monthly_payment_authorizations VALUES(?,?,?,?,?,?)",
  );
  for (const [period, digest] of [
    ["2026-11", "b"],
    ["2026-12", "c"],
  ])
    insert.run(
      project.id,
      period,
      "base-sepolia",
      digest.repeat(64),
      JSON.stringify({
        plan: {
          family: "evm",
          request: { projectId: project.id, period, network: "base-sepolia" },
          deployment,
          evmReservation: { version: 2 },
        },
      }),
      afterCutoff.toISOString(),
    );
  sqlite.exec("PRAGMA foreign_keys=ON");
  const sent: string[] = [];
  const dispatcher = {
    PAYMENTS_DB: db,
    REGISTRY_DB: db,
    PAYMENT_NETWORKS: '["base-sepolia"]',
    PAYMENT_RPC_URLS: "{}",
    MONTHLY_PAYMENT_SCHEDULE: JSON.stringify(schedule),
    EVM_PAYMENT_EXECUTOR: {
      async fetch(request: Request) {
        const { plan } = (await request.json()) as {
          plan: { request: { period: string } };
        };
        const admit = new URL(request.url).searchParams.get("admit");
        sent.push(`${plan.request.period}:${admit}`);
        return Response.json(
          admit === "true"
            ? {
                transactionId: "0xreserve",
                alreadyCommitted: false,
                complete: false,
              }
            : {
                transactionId: "0xleaf",
                alreadyCommitted: true,
                complete: false,
              },
        );
      },
    },
  };
  // 2026-11 can no longer admit, so it only resumes leaves; 2026-12 is in its window.
  await runMonthlyCommitments(dispatcher, new Date("2027-01-05T00:00:00Z"));
  expect(sent).toEqual(["2026-12:true", "2026-11:false"]);
});

test("monthly dispatcher keeps a legacy EVM month open while its re-sent nonce is unmined", async () => {
  // Another sender committed the month; the executor re-sent its own journaled commit bytes.
  sqlite.exec("PRAGMA foreign_keys=OFF");
  sqlite
    .prepare("INSERT INTO monthly_payment_authorizations VALUES(?,?,?,?,?,?)")
    .run(
      project.id,
      "2026-11",
      "base-sepolia",
      "d".repeat(64),
      JSON.stringify({
        plan: {
          family: "evm",
          request: {
            projectId: project.id,
            period: "2026-11",
            network: "base-sepolia",
          },
          deployment,
        },
      }),
      afterCutoff.toISOString(),
    );
  sqlite.exec("PRAGMA foreign_keys=ON");
  let calls = 0;
  const dispatcher = {
    PAYMENTS_DB: db,
    REGISTRY_DB: db,
    PAYMENT_NETWORKS: '["base-sepolia"]',
    PAYMENT_RPC_URLS: "{}",
    MONTHLY_PAYMENT_SCHEDULE: JSON.stringify(schedule),
    EVM_PAYMENT_EXECUTOR: {
      async fetch(request: Request) {
        expect(new URL(request.url).searchParams.get("admit")).toBe("true");
        calls++;
        return Response.json(
          calls === 1
            ? { transactionId: null, alreadyCommitted: true, complete: false }
            : { transactionId: null, alreadyCommitted: true },
        );
      },
    },
  };
  await runMonthlyCommitments(dispatcher, afterCutoff);
  await runMonthlyCommitments(dispatcher, afterCutoff);
  await runMonthlyCommitments(dispatcher, afterCutoff);
  // The incomplete result is retried; the committed result then retires the month.
  expect(calls).toBe(2);
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

test("reserve release requires current authority and refuses a revision changed during the request", async () => {
  const token = "r".repeat(43);
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('release-owner',?,'owner',?,0)",
    )
    .run(OWNER, afterCutoff.toISOString());
  sqlite
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(await sha256Hex(token), "release-owner", "2027-01-01T00:00:00.000Z");
  let authority = true,
    requested = 0,
    reviseDuringRelease = false;
  const service = monthlyOwnerService({
    db,
    ...projects(),
    networks: () => ["base-sepolia"],
    schedule: () => schedule,
    now: () => clock,
    verifyAuthority: async () => {
      if (!authority)
        throw new MonthlyPaymentError(
          403,
          "not_owner",
          "Current GitHub authority is required.",
        );
    },
    releaseReserve: async (input) => {
      expect(input).toEqual({
        projectId: project.id,
        period: "2026-11",
        network: "base-sepolia",
        manifestSha256: project.manifestSha256,
      });
      requested++;
      if (reviseDuringRelease) {
        const text = JSON.stringify(project.manifest);
        expect(
          await new CloudflareProjectPersistence(db).appendProjectRevision(
            {
              projectId: project.id,
              expectedRevision: project.revision,
              manifest: project.manifest,
              manifestText: text,
              manifestSha256: await sha256Hex(text),
              reason: "Owner updated the project while release was checked",
              actor,
              at: afterCutoff.toISOString(),
            },
            0,
          ),
        ).toBe("updated");
      }
      return { status: "held", reason: "allocation-unavailable" };
    },
  });
  const body = {
    network: "base-sepolia",
    manifestSha256: project.manifestSha256,
  };
  const request = (
    changes: Record<string, unknown> = {},
    origin = "https://slop.cash",
    signedIn = true,
  ) =>
    handlePaymentsApi(
      new Request(
        `https://slop.cash/api/v1/payments/projects/${project.id}/monthly/2026-11/reserve-release`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            ...(signedIn ? { cookie: `__Host-slop_points=${token}` } : {}),
          },
          body: JSON.stringify({ ...body, ...changes }),
        },
      ),
      { db, monthly: service, now: () => afterCutoff },
    );
  expect((await request({}, "https://attacker.invalid")).status).toBe(403);
  expect((await request({}, "https://slop.cash", false)).status).toBe(401);
  authority = false;
  expect((await request()).status).toBe(403);
  authority = true;
  expect((await request({ manifestSha256: "0".repeat(64) })).status).toBe(409);
  expect((await request({ amount: "10" })).status).toBe(400);
  expect(requested).toBe(0);
  expect((await request()).status).toBe(200);
  expect(requested).toBe(1);
  reviseDuringRelease = true;
  const changed = await request();
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({ error: "project_changed" });
  expect(requested).toBe(2);
  expect(
    (await new CloudflareProjectPersistence(db).getProject(project.id))
      ?.revision,
  ).toBe(project.revision + 1);
});

test("account keeps an award visible when a reservation is indexed during its read", async () => {
  const token = "d".repeat(43);
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node-account-race',?,'first',?,0)",
    )
    .run(A, afterCutoff.toISOString());
  sqlite
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(
      await sha256Hex(token),
      "node-account-race",
      "2027-01-01T00:00:00.000Z",
    );
  vault("1000");
  await coordinate(afterCutoff);
  let indexed = false;
  let projections = 0;
  const racingDb: ProjectD1Database = {
    ...db,
    prepare(query) {
      const isAccountProjection = query.includes(
        "FROM payment_obligations o LEFT JOIN payment_outbox",
      );
      type Statement = ReturnType<ProjectD1Database["prepare"]>;
      const wrap = (statement: Statement): Statement => ({
        ...statement,
        bind: (...values) => wrap(statement.bind(...values)),
        async first<T>() {
          const result = await statement.first<T>();
          if (isAccountProjection) {
            projections += 1;
            if (!indexed) {
              indexed = true;
              // The real writer's reservation becomes visible after this read.
              // The response must contain the award before or after that change.
              sqlite
                .prepare(
                  "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,?,?,?,6,'600','12',?,'reserved',?,NULL)",
                )
                .run(
                  `0x${"6".repeat(64)}`,
                  project.id,
                  A,
                  "base-sepolia",
                  "base",
                  deployment.vault,
                  deployment.asset,
                  escrowAwardOrigin(project.id, "2026-11", A),
                  afterCutoff.toISOString(),
                );
            }
          }
          return result;
        },
      });
      return wrap(db.prepare(query));
    },
  };
  const account = async () => {
    const response = await handlePaymentsApi(
      new Request("https://slop.cash/api/v1/payments/me", {
        headers: { cookie: `__Host-slop_points=${token}` },
      }),
      { db: racingDb, now: () => afterCutoff },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as PaymentsAccount;
  };
  const during = await account();
  expect(during.monthlyAwards).toMatchObject([
    { grossBase: "600", netBase: "588", state: "awaiting-reservation" },
  ]);
  expect(during.payments).toEqual([]);
  const after = await account();
  expect(after.monthlyAwards).toEqual([]);
  expect(after.payments).toMatchObject([
    { grossBase: "600", netBase: "588", state: "reserved" },
  ]);
  expect(projections).toBe(2);
});
