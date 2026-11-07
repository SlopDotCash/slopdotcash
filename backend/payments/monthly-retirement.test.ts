/**
 * Retirement × frozen money: an admin delist appends a paused, `retired`
 * revision with no enforcement record, so the project is unrestricted.
 * The delist stops new proposals and freezes (monthly.ts coordinator and
 * finalize keep their status gates), but a month that was already frozen
 * and funded is an existing obligation: the coordinator still creates its
 * obligations after the delist, and its execution — the attester signing
 * the frozen allocation and the owner reserving an award by hand — must
 * reach the same result as while the project was active
 * (backend/payments/README.md: "A paused project keeps its funded
 * obligations"; "A later project revision does not block the frozen month
 * unless it changes the chain, effective month, fees, vault or asset").
 * An enforcement restriction still blocks both execution paths.
 */
import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { parseMonthlySchedule } from "../../src/lib/payments/monthly-allocation";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import { createMonthlyAllocationFixture } from "../../tests/monthly-allocation-fixture";
import { sha256Hex } from "../../workers/identity/crypto";
import { CloudflareProjectPersistence } from "../projects/cloudflare-persistence";
import {
  coordinateMonthlyPayments,
  MonthlyPaymentError,
  monthlyOwnerService,
} from "./monthly";
import { prepareMonthlyAttestation } from "./monthly-attestation";

const deployment = {
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
const A = "101";
const actor = { githubId: OWNER, githubLogin: "owner" };
const schedule = parseMonthlySchedule(
  (
    Bun.TOML.parse(readFileSync("wrangler.toml", "utf8")) as {
      vars: Record<string, string>;
    }
  ).vars.MONTHLY_PAYMENT_SCHEDULE,
);
if (!schedule) throw new Error("Fixture schedule missing");
const afterCutoff = new Date("2026-12-04T00:00:00.000Z");

let db: Awaited<ReturnType<typeof createMonthlyAllocationFixture>>["db"];
let sqlite: Awaited<
  ReturnType<typeof createMonthlyAllocationFixture>
>["sqlite"];
let project: ProjectRecord;
let restricted = false;

beforeEach(async () => {
  ({ db, sqlite, project } = await createMonthlyAllocationFixture({
    deployment,
  }));
  restricted = false;
});

const persistence = () => new CloudflareProjectPersistence(db);
const projects = () => ({
  getProject: (id: string) => persistence().getProject(id),
  // Production wiring derives this from enforcement records only
  // (publicRestrictionOf); a voluntary delist records none.
  restricted: async () => restricted,
});
const coordinate = () =>
  coordinateMonthlyPayments({
    db,
    projects: projects(),
    networks: ["base-sepolia"],
    schedule,
    now: afterCutoff,
  });
const owner = () =>
  monthlyOwnerService({
    db,
    ...projects(),
    networks: () => ["base-sepolia"],
    verifyAuthority: async () => {},
    schedule: () => schedule,
    now: () => afterCutoff,
  });
function vault(free: string) {
  sqlite
    .prepare(
      "INSERT INTO vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,free_balance,reserved_principal,reserved_fees,accrued_fees,reserved,block_number,block_time,observed_at) VALUES(?,?,?,?,?,?,?,'0','0','0','0','0',?,'0','0','0','0','100',?,?) ON CONFLICT(project_id,network,vault) DO UPDATE SET free_balance=excluded.free_balance,observed_at=excluded.observed_at,block_number=CAST(CAST(block_number AS INTEGER)+1 AS TEXT)",
    )
    .run(
      project.id,
      deployment.network,
      "base",
      deployment.vault,
      deployment.asset,
      6,
      "5000",
      free,
      afterCutoff.toISOString(),
      afterCutoff.toISOString(),
    );
}
const count = (table: string) =>
  (sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;

async function revise(change: Record<string, unknown>) {
  const current = await persistence().getProject(project.id);
  if (!current) throw new Error("Fixture project missing");
  const manifest = { ...current.manifest, ...change };
  const text = JSON.stringify(manifest);
  expect(
    await persistence().appendProjectRevision(
      {
        projectId: project.id,
        expectedRevision: current.revision,
        manifest: manifest as ProjectRecord["manifest"],
        manifestText: text,
        manifestSha256: await sha256Hex(text),
        reason: "Admin delists the project",
        actor,
        at: afterCutoff.toISOString(),
      },
      0,
    ),
  ).toBe("updated");
  const next = await persistence().getProject(project.id);
  if (!next) throw new Error("Fixture project missing after revision");
  project = next;
}
const retire = () => revise({ status: "paused", listingTier: "retired" });

async function attestation() {
  if (!schedule) throw new Error("Fixture schedule missing");
  const row = sqlite
    .prepare(
      "SELECT snapshot_sha256 digest FROM monthly_payment_runs WHERE project_id=? AND period='2026-11'",
    )
    .get(project.id) as { digest: string };
  return prepareMonthlyAttestation(
    {
      db,
      ...projects(),
      networks: ["base-sepolia"],
      schedule,
      now: afterCutoff,
    },
    {
      projectId: project.id,
      period: "2026-11",
      network: "base-sepolia",
      snapshotSha256: row.digest,
    },
  );
}
async function commitment() {
  const view = await owner().view(project.id, "2026-11", actor);
  return owner().commitment(project.id, "2026-11", actor, {
    network: "base-sepolia",
    githubUserId: A,
    manifestSha256: project.manifestSha256,
    snapshotSha256: view.run?.snapshotSha256 ?? "",
  });
}
async function rejects(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(MonthlyPaymentError);
  expect((error as MonthlyPaymentError).code).toBe(code);
}

test("a frozen, funded month still signs and reserves after the project is retired", async () => {
  vault("1000");
  const report = await coordinate();
  expect(report.frozen).toEqual([`${project.id}/2026-11`]);
  expect(report.created).toEqual([`${project.id}/2026-11`]);
  // Control while active.
  expect((await attestation()).totalGrossBase).toBe("1000");
  expect((await commitment()).award.gross).toBe("600");

  await retire();
  expect(project.manifest.status).toBe("paused");
  expect(project.manifest.listingTier).toBe("retired");

  // The same frozen allocation signs with the same total and entries, and
  // the same funded award still produces its reservation plan.
  const plan = await attestation();
  expect(plan.totalGrossBase).toBe("1000");
  expect(plan.entries.map((entry) => entry.githubUserId)).toEqual([
    "101",
    "202",
  ]);
  expect((await commitment()).award.gross).toBe("600");

  // New commitments stay closed: an unfrozen month cannot be finalized.
  await rejects(
    owner().finalize(project.id, "2026-12", actor, 0),
    "project_restricted",
  );
  // An enforcement restriction still blocks the frozen month's execution.
  restricted = true;
  await rejects(attestation(), "project_restricted");
  await rejects(commitment(), "project_restricted");
  restricted = false;
  expect(count("monthly_payment_obligations")).toBe(2);
});

test("obligations created after retirement for an already frozen month can still be signed", async () => {
  vault("500");
  expect((await coordinate()).frozen).toEqual([`${project.id}/2026-11`]);
  expect(count("monthly_payment_obligations")).toBe(0);
  await retire();
  vault("1000");
  // The coordinator funds the frozen month even after the delist.
  expect((await coordinate()).created).toEqual([`${project.id}/2026-11`]);
  expect(count("monthly_payment_obligations")).toBe(2);
  expect((await attestation()).totalGrossBase).toBe("1000");
  expect((await commitment()).award.gross).toBe("600");
});

test("a retirement revision that changes only the vault refuses both paths", async () => {
  vault("1000");
  const report = await coordinate();
  expect(report.frozen).toEqual([`${project.id}/2026-11`]);
  expect(report.created).toEqual([`${project.id}/2026-11`]);
  expect((await attestation()).totalGrossBase).toBe("1000");
  expect((await commitment()).award.gross).toBe("600");

  await retire();
  await revise({
    escrow: {
      ...project.manifest.escrow,
      deployments: [
        {
          ...deployment,
          vault: "0x1000000000000000000000000000000000000009",
        },
      ],
    },
  });

  // Control: a vault-only revision is already refused by both paths.
  await rejects(attestation(), "snapshot_changed");
  await rejects(commitment(), "vault_changed");
});

test("a retirement revision that changes only the frozen month's asset refuses the reservation", async () => {
  vault("1000");
  const report = await coordinate();
  expect(report.frozen).toEqual([`${project.id}/2026-11`]);
  expect(report.created).toEqual([`${project.id}/2026-11`]);
  expect((await attestation()).totalGrossBase).toBe("1000");
  expect((await commitment()).award.gross).toBe("600");

  await retire();
  await revise({
    escrow: {
      ...project.manifest.escrow,
      deployments: [
        {
          ...deployment,
          asset: "0x1111111111111111111111111111111111111111",
        },
      ],
    },
  });

  // The attester refuses the changed asset, and the owner reservation must
  // refuse it too instead of issuing a plan against the new asset.
  await rejects(attestation(), "snapshot_changed");
  await rejects(commitment(), "snapshot_changed");
});

test("a retirement revision that changes only the fee policy refuses the reservation", async () => {
  vault("1000");
  const report = await coordinate();
  expect(report.frozen).toEqual([`${project.id}/2026-11`]);
  expect(report.created).toEqual([`${project.id}/2026-11`]);
  expect((await attestation()).totalGrossBase).toBe("1000");
  expect((await commitment()).award.gross).toBe("600");

  await retire();
  await revise({
    escrow: { ...project.manifest.escrow, feeBasisPoints: 300 },
  });

  // The attester refuses the changed fee policy, and the owner reservation
  // must refuse it too instead of issuing a plan under the new fees.
  await rejects(attestation(), "financial_policy_changed");
  await rejects(commitment(), "financial_policy_changed");
});
