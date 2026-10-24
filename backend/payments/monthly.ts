/**
 * Private monthly allocations and the automatic monthly coordinator (PRD
 * sections 6 and 7). The trusted monthly workflow stores one proposed
 * allocation per funded project month. The owner changes amounts privately,
 * can finalize a month early, and can turn the automatic default off. At the
 * configured UTC cutoff the coordinator freezes the current allocations once.
 * Each award becomes one obligation when the vault's free balance covers it.
 *
 * The vault contract accepts a reservation only from the owner's wallet, so
 * an obligation waits for the owner to reserve it; the existing executor then
 * settles reserved awards independently, one recipient at a time. A
 * reservation reuses the award's fixed source digest, so neither path can
 * reserve the same award twice. Change records stay internal for dispute
 * handling and reconciliation and are never published.
 */
import { readBoundedJson } from "../../src/lib/browser-json";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import {
  type MonthlyAwardState,
  type PaymentAsset,
  VAULT_SNAPSHOT_STALE_MS,
} from "../../src/lib/payments/contracts";
import { assertEscrowFinancialPolicy } from "../../src/lib/payments/escrow-review";
import {
  assertAllocationChange,
  assertPeriod,
  buildExecutionSnapshot,
  currentAllocations,
  type MonthlyAllocation,
  type MonthlyAllocationChange,
  MonthlyAllocationError,
  type MonthlyBaseRow,
  type MonthlyExecutionSnapshot,
  type MonthlySchedule,
  monthlyCutoff,
  periodEnd,
} from "../../src/lib/payments/monthly-allocation";
import { payoutExcludedGithubUserIds } from "../../src/lib/payout-exclusions.mjs";
import type {
  GithubActor,
  ProjectRecord,
} from "../../src/lib/project-contracts";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import { notifyMonthlyUnderfunded } from "../notifications/events";
import {
  hasParticipationBan,
  PARTICIPATION_BAN_QUERY,
} from "../projects/account-bans";

export class MonthlyPaymentError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Current GitHub authority: the repository still has the immutable identity
 * and owner in the D1 policy, and the signed-in person has write, maintain or
 * admin permission on it now. A stored steward ID alone is not authority.
 */
export async function verifyProjectAuthority(
  project: ProjectDefinition,
  actor: GithubActor,
  token?: string,
): Promise<void> {
  if (
    project.steward.github.type === "User" &&
    actor.githubId !== project.steward.github.actorId
  )
    throw new MonthlyPaymentError(
      403,
      "owner_required",
      "Only the current project steward can manage this project's awards.",
    );
  async function github(path: string, label: string) {
    const response = await fetch(`https://api.github.com/${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "Slop-monthly-awards",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new MonthlyPaymentError(
        503,
        "github_unavailable",
        "GitHub authority could not be checked. Retry.",
      );
    return readBoundedJson(response, 1048576, label);
  }
  const target = project.repositories[0].id;
  const identity = (await github(
    `repos/${target}`,
    "Project repository identity",
  )) as {
    id?: number;
    node_id?: string;
    owner?: { id?: number; node_id?: string; login?: string; type?: string };
  };
  const steward = project.steward.github;
  if (
    String(identity.id) !== project.authority.repositoryId ||
    identity.node_id !== project.authority.repositoryNodeId ||
    String(identity.owner?.id) !== steward.actorId ||
    identity.owner?.node_id !== steward.nodeId ||
    identity.owner?.type !== steward.type ||
    identity.owner?.login?.toLowerCase() !== steward.login.toLowerCase()
  )
    throw new MonthlyPaymentError(
      409,
      "repository_changed",
      "The GitHub repository identity differs from the project policy.",
    );
  const permission = (await github(
    `repos/${target}/collaborators/${encodeURIComponent(actor.githubLogin)}/permission`,
    "GitHub owner authority",
  )) as { permission?: string; user?: { id?: number } };
  if (
    !permission.permission ||
    !["admin", "maintain", "write"].includes(permission.permission) ||
    String(permission.user?.id) !== actor.githubId
  )
    throw new MonthlyPaymentError(
      403,
      "owner_required",
      "Current GitHub maintainer authority could not be verified.",
    );
}

interface StoredBase {
  projectId: string;
  period: string;
  manifest: ProjectDefinition;
  manifestSha256: string;
  sourceSnapshotSha256: string;
  capBase: string;
  rows: MonthlyBaseRow[];
}

async function loadBase(
  db: D1Database,
  projectId: string,
  period: string,
): Promise<StoredBase | null> {
  const base = await db
    .prepare(
      "SELECT manifest,manifest_sha256,source_snapshot_sha256,cap_base,recipient_count,(SELECT json_group_array(json_object('githubUserId',github_user_id,'login',github_login,'grossBase',gross_base,'sourceDigest',source_digest)) FROM monthly_reward_base_rows r WHERE r.project_id=b.project_id AND r.period=b.period) rows FROM monthly_reward_bases b WHERE project_id=? AND period=?",
    )
    .bind(projectId, period)
    .first<{
      manifest: string;
      manifest_sha256: string;
      source_snapshot_sha256: string;
      cap_base: string;
      recipient_count: number;
      rows: string;
    }>();
  if (!base) return null;
  const rows = JSON.parse(base.rows) as MonthlyBaseRow[];
  // The proposal and its rows are one import; a partial one is refused.
  if (rows.length !== base.recipient_count)
    throw new MonthlyPaymentError(
      503,
      "proposal_incomplete",
      "This month's proposed allocation is incomplete.",
    );
  return {
    projectId,
    period,
    manifest: assertProjectDefinition(JSON.parse(base.manifest)),
    manifestSha256: base.manifest_sha256,
    sourceSnapshotSha256: base.source_snapshot_sha256,
    capBase: base.cap_base,
    rows,
  };
}

async function loadChanges(
  db: D1Database,
  projectId: string,
  period: string,
): Promise<{ changes: MonthlyAllocationChange[]; sequence: number }> {
  const row = await db
    .prepare(
      "SELECT json_group_array(json_object('sequence',sequence,'githubUserId',github_user_id,'grossBase',gross_base)) items,COALESCE(MAX(sequence),0) sequence FROM monthly_allocation_changes WHERE project_id=? AND period=?",
    )
    .bind(projectId, period)
    .first<{ items: string; sequence: number }>();
  return {
    changes: JSON.parse(row?.items ?? "[]") as MonthlyAllocationChange[],
    sequence: row?.sequence ?? 0,
  };
}

/** Automatic monthly payment is the PRD default; only the owner turns it off. */
export async function automaticMonthlyPayment(
  db: D1Database,
  projectId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT automatic FROM monthly_payment_settings WHERE project_id=? ORDER BY sequence DESC LIMIT 1",
    )
    .bind(projectId)
    .first<{ automatic: number }>();
  return row === null || row.automatic === 1;
}

interface StoredRun {
  trigger: "owner" | "automatic";
  snapshot: MonthlyExecutionSnapshot;
  snapshotSha256: string;
  network: string;
  vault: string;
  frozenAt: string;
  obligationsCreatedAt: string | null;
}
async function loadRun(
  db: D1Database,
  projectId: string,
  period: string,
): Promise<StoredRun | null> {
  const row = await db
    .prepare(
      "SELECT trigger,snapshot,snapshot_sha256,network,vault,frozen_at,obligations_created_at FROM monthly_payment_runs WHERE project_id=? AND period=?",
    )
    .bind(projectId, period)
    .first<{
      trigger: "owner" | "automatic";
      snapshot: string;
      snapshot_sha256: string;
      network: string;
      vault: string;
      frozen_at: string;
      obligations_created_at: string | null;
    }>();
  return row
    ? {
        trigger: row.trigger,
        snapshot: JSON.parse(row.snapshot) as MonthlyExecutionSnapshot,
        snapshotSha256: row.snapshot_sha256,
        network: row.network,
        vault: row.vault,
        frozenAt: row.frozen_at,
        obligationsCreatedAt: row.obligations_created_at,
      }
    : null;
}

export type { MonthlyAwardState };

/** Chain evidence sets reserved/paid; the recorded ban decision sets excluded. */
async function awardStates(
  db: D1Database,
  run: StoredRun,
): Promise<Map<string, MonthlyAwardState>> {
  const row = await db
    .prepare(
      "SELECT json_group_array(json_object('sourceDigest',source_digest,'state',state)) items FROM payment_obligations WHERE network=? AND vault=? AND source_digest IN (SELECT json_extract(value,'$.sourceDigest') FROM json_each(?))",
    )
    .bind(run.network, run.vault, JSON.stringify(run.snapshot.awards))
    .first<{ items: string }>();
  const exclusions = await db
    .prepare(
      "SELECT json_group_array(source_digest) items FROM monthly_payment_exclusions WHERE network=? AND vault=?",
    )
    .bind(run.network, run.vault)
    .first<{ items: string }>();
  const excluded = new Set<string>(JSON.parse(exclusions?.items ?? "[]"));
  const chain = new Map(
    (
      JSON.parse(row?.items ?? "[]") as {
        sourceDigest: string;
        state: "reserved" | "paid";
      }[]
    ).map((entry) => [entry.sourceDigest, entry.state]),
  );
  return new Map(
    run.snapshot.awards.map((award) => [
      award.githubUserId,
      chain.get(award.sourceDigest) ??
        (excluded.has(award.sourceDigest)
          ? "excluded"
          : run.obligationsCreatedAt
            ? "awaiting-reservation"
            : "underfunded"),
    ]),
  );
}

/** The single served deployment of the project's one vault network, or null. */
export function servedDeployment(
  project: ProjectDefinition,
  networks: readonly string[],
): EscrowDeployment | null {
  const served = (project.escrow?.deployments ?? []).filter((entry) =>
    networks.includes(entry.network),
  );
  return served.length === 1 ? served[0] : null;
}

/**
 * Freezes the current allocations of one month exactly once. Both the
 * owner's early finalization and the automatic cutoff use this; the primary
 * key makes whichever comes first the only execution snapshot.
 */
export async function freezeMonthlyPeriod(
  db: D1Database,
  input: {
    project: ProjectRecord;
    deployment: EscrowDeployment;
    period: string;
    trigger: "owner" | "automatic";
    actorId: string | null;
    expectedSequence?: number;
    now: Date;
  },
): Promise<"frozen" | "already-frozen"> {
  if (input.actorId) await assertMonthlyParticipation(db, input.actorId);
  const { project, deployment } = input;
  const period = assertPeriod(input.period);
  if (input.now.getTime() < periodEnd(period).getTime())
    throw new MonthlyPaymentError(
      409,
      "month_open",
      "This month has not closed.",
    );
  if (await loadRun(db, project.id, period)) return "already-frozen";
  const base = await loadBase(db, project.id, period);
  if (!base)
    throw new MonthlyPaymentError(
      404,
      "proposal_unavailable",
      "No allocation has been proposed for this month.",
    );
  // Financial terms apply prospectively: the asset and fee policy that sized
  // the proposal must still be the vault's.
  try {
    assertEscrowFinancialPolicy(project.manifest, base.manifest);
  } catch {
    throw new MonthlyPaymentError(
      409,
      "financial_policy_changed",
      "The project's payment terms changed after this month was proposed.",
    );
  }
  const proposedDeployment = base.manifest.escrow?.deployments.find(
    (entry) => entry.network === deployment.network,
  );
  if (
    !proposedDeployment ||
    proposedDeployment.vault !== deployment.vault ||
    proposedDeployment.asset !== deployment.asset
  )
    throw new MonthlyPaymentError(
      409,
      "financial_policy_changed",
      "The project's vault or asset changed after this month was proposed.",
    );
  const { changes, sequence } = await loadChanges(db, project.id, period);
  if (
    input.expectedSequence !== undefined &&
    input.expectedSequence !== sequence
  )
    throw new MonthlyPaymentError(
      409,
      "allocations_changed",
      "The allocations changed. Reload them before finalizing.",
    );
  const frozenAt = input.now.toISOString();
  const { snapshot, text, sha256 } = buildExecutionSnapshot({
    base: {
      projectId: base.projectId,
      period,
      manifestSha256: base.manifestSha256,
      sourceSnapshotSha256: base.sourceSnapshotSha256,
      capBase: base.capBase,
    },
    allocations: currentAllocations(base.rows, changes),
    allocationSequence: sequence,
    trigger: input.trigger,
    manifestSha256: project.manifestSha256,
    network: deployment.network,
    vault: deployment.vault,
    asset: deployment.asset,
    frozenAt,
  });
  const inserted = await db
    .prepare(
      `INSERT INTO monthly_payment_runs(project_id,period,trigger,actor_id,allocation_sequence,snapshot,snapshot_sha256,network,vault,total_gross_base,frozen_at,obligations_created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,NULL WHERE (SELECT COALESCE(MAX(sequence),0) FROM monthly_allocation_changes WHERE project_id=? AND period=?)=? AND NOT EXISTS (${PARTICIPATION_BAN_QUERY}) ON CONFLICT(project_id,period) DO NOTHING`,
    )
    .bind(
      project.id,
      period,
      input.trigger,
      input.actorId,
      sequence,
      text,
      sha256,
      deployment.network,
      deployment.vault,
      snapshot.totalGrossBase,
      frozenAt,
      project.id,
      period,
      sequence,
      input.actorId,
    )
    .run();
  if (inserted.meta?.changes === 1) return "frozen";
  if (input.actorId) await assertMonthlyParticipation(db, input.actorId);
  if (await loadRun(db, project.id, period)) return "already-frozen";
  throw new MonthlyPaymentError(
    409,
    "allocations_changed",
    "The allocations changed while finalizing. Retry.",
  );
}

/**
 * Creates the obligations of a frozen month once, and only when the vault's
 * finalized free balance covers them together with every earlier obligation
 * still awaiting reservation in the same vault. Nothing is created for an
 * underfunded month; a later run retries after a deposit. Awards already
 * reserved under their source digest need no further funds.
 */
export async function createMonthlyObligations(
  db: D1Database,
  projectId: string,
  period: string,
  now: Date,
): Promise<"created" | "already-created" | "underfunded" | "stale-funding"> {
  const run = await loadRun(db, projectId, period);
  if (!run)
    throw new MonthlyPaymentError(
      404,
      "month_not_frozen",
      "This month has not been finalized.",
    );
  if (run.obligationsCreatedAt) return "already-created";
  const reserved = new Set(
    (
      JSON.parse(
        (
          await db
            .prepare(
              "SELECT json_group_array(source_digest) items FROM payment_obligations WHERE network=? AND vault=?",
            )
            .bind(run.network, run.vault)
            .first<{ items: string }>()
        )?.items ?? "[]",
      ) as string[]
    ).values(),
  );
  const currentBan = `SELECT enforcementId FROM (${PARTICIPATION_BAN_QUERY.replace(
    "b.github_id = ?",
    "b.github_id = json_extract(decision.value,'$.githubUserId')",
  )})`;
  // Capture every active decision in one query, then compare at the write.
  const decisions = JSON.parse(
    (
      await db
        .prepare(
          `SELECT json_group_array(json_object('githubUserId',json_extract(decision.value,'$.githubUserId'),'sourceDigest',json_extract(decision.value,'$.sourceDigest'),'enforcementId',(${currentBan}))) items FROM json_each(?) decision`,
        )
        .bind(JSON.stringify(run.snapshot.awards))
        .first<{ items: string }>()
    )?.items ?? "[]",
  ) as {
    githubUserId: string;
    sourceDigest: string;
    enforcementId: string | null;
  }[];
  const excluded = decisions.filter(
    (entry) =>
      entry.enforcementId !== null && !reserved.has(entry.sourceDigest),
  );
  const excludedDigests = new Set(excluded.map((entry) => entry.sourceDigest));
  const eligibleAwards = run.snapshot.awards.filter(
    (award) => !excludedDigests.has(award.sourceDigest),
  );
  const outstanding = JSON.parse(
    (
      await db
        .prepare(
          "SELECT json_group_array(json_object('grossBase',gross_base,'sourceDigest',source_digest)) items FROM monthly_payment_obligations WHERE network=? AND vault=?",
        )
        .bind(run.network, run.vault)
        .first<{ items: string }>()
    )?.items ?? "[]",
  ) as { grossBase: string; sourceDigest: string }[];
  let needed = 0n;
  for (const award of [...eligibleAwards, ...outstanding])
    if (!reserved.has(award.sourceDigest)) needed += BigInt(award.grossBase);
  let fundingSnapshot: {
    asset: string;
    free: string;
    observedAt: string;
  } | null = null;
  if (needed > 0n) {
    const vault = await db
      .prepare(
        "SELECT asset_address,free_balance,observed_at FROM vault_snapshots WHERE project_id=? AND network=? AND vault=?",
      )
      .bind(projectId, run.network, run.vault)
      .first<{
        asset_address: string;
        free_balance: string | null;
        observed_at: string;
      }>();
    if (
      !vault ||
      vault.asset_address.toLowerCase() !== run.snapshot.asset.toLowerCase() ||
      now.getTime() - Date.parse(vault.observed_at) > VAULT_SNAPSHOT_STALE_MS
    )
      return "stale-funding";
    if (vault.free_balance === null || BigInt(vault.free_balance) < needed) {
      await notifyMonthlyUnderfunded(
        db,
        projectId,
        period,
        now.toISOString(),
      ).run();
      return "underfunded";
    }
    fundingSnapshot = {
      asset: vault.asset_address,
      free: vault.free_balance,
      observedAt: vault.observed_at,
    };
  }
  const createdAt = now.toISOString();
  // Bind the calculation to the immutable obligation sets and the exact vault
  // snapshot. A concurrent month or refreshed balance must retry the check.
  await db.batch([
    db
      .prepare(
        `UPDATE monthly_payment_runs SET obligations_created_at=? WHERE project_id=? AND period=? AND obligations_created_at IS NULL AND (SELECT COUNT(*) FROM monthly_payment_obligations WHERE network=? AND vault=?)=? AND (SELECT COUNT(*) FROM payment_obligations WHERE network=? AND vault=?)=? AND (? IS NULL OR EXISTS(SELECT 1 FROM vault_snapshots WHERE project_id=? AND network=? AND vault=? AND asset_address=? AND free_balance=? AND observed_at=?)) AND NOT EXISTS(SELECT 1 FROM json_each(?) decision WHERE (${currentBan}) IS NOT json_extract(decision.value,'$.enforcementId'))`,
      )
      .bind(
        createdAt,
        projectId,
        period,
        run.network,
        run.vault,
        outstanding.length,
        run.network,
        run.vault,
        reserved.size,
        fundingSnapshot?.free ?? null,
        projectId,
        run.network,
        run.vault,
        fundingSnapshot?.asset ?? null,
        fundingSnapshot?.free ?? null,
        fundingSnapshot?.observedAt ?? null,
        JSON.stringify(decisions),
      ),
    db
      .prepare(
        "INSERT INTO monthly_payment_exclusions(project_id,period,github_user_id,network,vault,source_digest,enforcement_id,created_at) SELECT r.project_id,r.period,json_extract(a.value,'$.githubUserId'),r.network,r.vault,json_extract(a.value,'$.sourceDigest'),json_extract(a.value,'$.enforcementId'),r.obligations_created_at FROM monthly_payment_runs r,json_each(?) a WHERE r.project_id=? AND r.period=? AND r.obligations_created_at=? AND NOT EXISTS(SELECT 1 FROM monthly_payment_obligations m WHERE m.project_id=r.project_id AND m.period=r.period AND m.github_user_id=json_extract(a.value,'$.githubUserId')) ON CONFLICT DO NOTHING",
      )
      .bind(JSON.stringify(excluded), projectId, period, createdAt),
    db
      .prepare(
        "INSERT INTO monthly_payment_obligations(project_id,period,github_user_id,github_login,gross_base,fee_base,source_digest,network,vault,created_at) SELECT r.project_id,r.period,json_extract(a.value,'$.githubUserId'),json_extract(a.value,'$.login'),json_extract(a.value,'$.grossBase'),json_extract(a.value,'$.feeBase'),json_extract(a.value,'$.sourceDigest'),r.network,r.vault,r.obligations_created_at FROM monthly_payment_runs r, json_each(r.snapshot,'$.awards') a WHERE r.project_id=? AND r.period=? AND r.obligations_created_at=? AND NOT EXISTS(SELECT 1 FROM monthly_payment_exclusions x WHERE x.project_id=r.project_id AND x.period=r.period AND x.github_user_id=json_extract(a.value,'$.githubUserId')) ON CONFLICT DO NOTHING",
      )
      .bind(projectId, period, createdAt),
  ]);
  const after = await loadRun(db, projectId, period);
  if (!after?.obligationsCreatedAt) return "stale-funding";
  return after.obligationsCreatedAt === createdAt
    ? "created"
    : "already-created";
}

export interface MonthlyCoordinatorReport {
  scheduled: boolean;
  frozen: string[];
  created: string[];
  waiting: { key: string; reason: string }[];
  failures: unknown[];
}

/**
 * The single idempotent monthly coordinator. It runs in the scheduled
 * ordinary payments Worker, never for private bounty programs. Without a
 * configured cutoff it freezes nothing; it still creates the obligations of
 * months the owner finalized. A failure in one project month is reported and
 * never stops another.
 */
export async function coordinateMonthlyPayments(input: {
  db: D1Database;
  projects: {
    getProject(id: string): Promise<ProjectRecord | null>;
    restricted(project: ProjectRecord): Promise<boolean>;
  };
  networks: readonly string[];
  schedule: MonthlySchedule | null;
  now: Date;
}): Promise<MonthlyCoordinatorReport> {
  const { db, now } = input;
  const report: MonthlyCoordinatorReport = {
    scheduled: input.schedule !== null,
    frozen: [],
    created: [],
    waiting: [],
    failures: [],
  };
  if (input.schedule) {
    const due = JSON.parse(
      (
        await db
          .prepare(
            "SELECT json_group_array(json_object('projectId',project_id,'period',period)) items FROM (SELECT project_id,period FROM monthly_reward_bases b WHERE NOT EXISTS(SELECT 1 FROM monthly_payment_runs r WHERE r.project_id=b.project_id AND r.period=b.period) ORDER BY period,project_id)",
          )
          .first<{ items: string }>()
      )?.items ?? "[]",
    ) as { projectId: string; period: string }[];
    for (const { projectId, period } of due) {
      const key = `${projectId}/${period}`;
      try {
        const cutoff = monthlyCutoff(input.schedule, period);
        if (!cutoff) {
          report.waiting.push({ key, reason: "before-first-period" });
          continue;
        }
        if (now.getTime() < cutoff.getTime()) continue;
        const project = await input.projects.getProject(projectId);
        if (!project) throw new Error(`Project ${projectId} is not registered`);
        if (!(await automaticMonthlyPayment(db, projectId))) {
          report.waiting.push({ key, reason: "automatic-off" });
          continue;
        }
        if (
          project.manifest.status !== "active" ||
          (await input.projects.restricted(project))
        ) {
          report.waiting.push({ key, reason: "project-restricted" });
          continue;
        }
        const deployment = servedDeployment(project.manifest, input.networks);
        if (!deployment) {
          report.waiting.push({ key, reason: "vault-not-served" });
          continue;
        }
        if (
          (await freezeMonthlyPeriod(db, {
            project,
            deployment,
            period,
            trigger: "automatic",
            actorId: null,
            now,
          })) === "frozen"
        )
          report.frozen.push(key);
      } catch (error) {
        report.failures.push(error);
      }
    }
  }
  const pending = JSON.parse(
    (
      await db
        .prepare(
          "SELECT json_group_array(json_object('projectId',project_id,'period',period)) items FROM (SELECT project_id,period FROM monthly_payment_runs WHERE obligations_created_at IS NULL ORDER BY period,project_id)",
        )
        .first<{ items: string }>()
    )?.items ?? "[]",
  ) as { projectId: string; period: string }[];
  for (const { projectId, period } of pending) {
    const key = `${projectId}/${period}`;
    try {
      const result = await createMonthlyObligations(db, projectId, period, now);
      if (result === "created") report.created.push(key);
      else if (result !== "already-created")
        report.waiting.push({ key, reason: result });
    } catch (error) {
      report.failures.push(error);
    }
  }
  return report;
}

export interface MonthlyAwardView {
  githubUserId: string;
  login: string;
  grossBase: string;
  feeBase: string;
  netBase: string;
  state: MonthlyAwardState;
}
export interface MonthlyOwnerView {
  projectId: string;
  period: string;
  manifestSha256: string;
  automatic: boolean;
  /** Null without MONTHLY_PAYMENT_SCHEDULE or before its first period. */
  cutoffAt: string | null;
  deployment: EscrowDeployment | null;
  asset: (PaymentAsset & { symbol: string | null }) | null;
  proposal: {
    capBase: string;
    allocationSequence: number;
    allocations: MonthlyAllocation[];
  } | null;
  run: {
    trigger: "owner" | "automatic";
    frozenAt: string;
    snapshotSha256: string;
    totalGrossBase: string;
    network: string;
    vault: string;
    funded: boolean;
    awards: MonthlyAwardView[];
  } | null;
}

export interface MonthlyCommitmentInput {
  network: string;
  githubUserId: string;
  manifestSha256: string;
  snapshotSha256: string;
}
export interface MonthlyCommitmentPlan {
  schemaVersion: "2";
  projectId: string;
  cycleId: string;
  manifestSha256: string;
  snapshotSha256: string;
  deployment: EscrowDeployment;
  award: {
    githubUserId: string;
    login: string;
    sourceDigest: string;
    gross: string;
    fee: string;
    net: string;
  };
}

/** The owner's private monthly controls behind the Pages session. */
async function assertMonthlyParticipation(db: D1Database, githubId: string) {
  if (await hasParticipationBan(db, githubId))
    throw new MonthlyPaymentError(
      403,
      "account_banned",
      "This account cannot change or finalize new monthly awards while banned.",
    );
}

export function monthlyOwnerService(deps: {
  db: D1Database;
  getProject(id: string): Promise<ProjectRecord | null>;
  restricted(project: ProjectRecord): Promise<boolean>;
  networks(): readonly string[];
  verifyAuthority(project: ProjectRecord, actor: GithubActor): Promise<void>;
  schedule(): MonthlySchedule | null;
  now(): Date;
}) {
  async function authorized(projectId: string, actor: GithubActor) {
    const project = await deps.getProject(projectId);
    if (!project?.manifest.escrow)
      throw new MonthlyPaymentError(
        404,
        "project_unavailable",
        "This project has no vault awards.",
      );
    await deps.verifyAuthority(project, actor);
    return project;
  }
  async function unchanged(project: ProjectRecord) {
    const current = await deps.getProject(project.id);
    if (
      !current ||
      current.revision !== project.revision ||
      current.manifestSha256 !== project.manifestSha256
    )
      throw new MonthlyPaymentError(
        409,
        "project_changed",
        "The project changed. Reload its awards.",
      );
  }
  async function view(
    project: ProjectRecord,
    period: string,
  ): Promise<MonthlyOwnerView> {
    const deployment = servedDeployment(project.manifest, deps.networks());
    const base = await loadBase(deps.db, project.id, period);
    const run = await loadRun(deps.db, project.id, period);
    const schedule = deps.schedule();
    const cutoff = schedule ? monthlyCutoff(schedule, period) : null;
    const vault = deployment
      ? await deps.db
          .prepare(
            "SELECT network,asset_address,asset_decimals FROM vault_snapshots WHERE project_id=? AND network=? AND vault=?",
          )
          .bind(project.id, deployment.network, deployment.vault)
          .first<{
            network: string;
            asset_address: string;
            asset_decimals: number;
          }>()
      : null;
    let proposal: MonthlyOwnerView["proposal"] = null;
    if (base) {
      const { changes, sequence } = await loadChanges(
        deps.db,
        project.id,
        period,
      );
      proposal = {
        capBase: base.capBase,
        allocationSequence: sequence,
        allocations: currentAllocations(base.rows, changes),
      };
    }
    let frozen: MonthlyOwnerView["run"] = null;
    if (run) {
      const states = await awardStates(deps.db, run);
      frozen = {
        trigger: run.trigger,
        frozenAt: run.frozenAt,
        snapshotSha256: run.snapshotSha256,
        totalGrossBase: run.snapshot.awards
          .reduce(
            (total, award) =>
              total +
              (states.get(award.githubUserId) === "excluded"
                ? 0n
                : BigInt(award.grossBase)),
            0n,
          )
          .toString(),
        network: run.network,
        vault: run.vault,
        funded: run.obligationsCreatedAt !== null,
        awards: run.snapshot.awards.map((award) => ({
          githubUserId: award.githubUserId,
          login: award.login,
          grossBase:
            states.get(award.githubUserId) === "excluded"
              ? "0"
              : award.grossBase,
          feeBase:
            states.get(award.githubUserId) === "excluded" ? "0" : award.feeBase,
          netBase:
            states.get(award.githubUserId) === "excluded" ? "0" : award.netBase,
          state: states.get(award.githubUserId) ?? "underfunded",
        })),
      };
    }
    return {
      projectId: project.id,
      period,
      manifestSha256: project.manifestSha256,
      automatic: await automaticMonthlyPayment(deps.db, project.id),
      cutoffAt: cutoff?.toISOString() ?? null,
      deployment,
      asset: vault
        ? {
            network: vault.network,
            assetAddress: vault.asset_address,
            assetDecimals: vault.asset_decimals,
            symbol:
              project.manifest.rewardAsset?.symbol ??
              project.manifest.reward.currency,
          }
        : null,
      proposal,
      run: frozen,
    };
  }
  return {
    async view(projectId: string, period: string, actor: GithubActor) {
      const project = await authorized(projectId, actor);
      const result = await view(project, assertPeriod(period));
      await unchanged(project);
      return result;
    },
    async changeAllocation(
      projectId: string,
      period: string,
      actor: GithubActor,
      change: {
        githubUserId: string;
        grossBase: string;
        expectedSequence: number;
      },
    ) {
      const project = await authorized(projectId, actor);
      await assertMonthlyParticipation(deps.db, actor.githubId);
      assertPeriod(period);
      if (await loadRun(deps.db, project.id, period))
        throw new MonthlyPaymentError(
          409,
          "month_frozen",
          "This month is finalized. Its allocations can no longer change.",
        );
      // Decision D1: with the automatic default on, allocations stay as they
      // were at the cutoff until the coordinator freezes them.
      const schedule = deps.schedule();
      const cutoff = schedule ? monthlyCutoff(schedule, period) : null;
      if (
        cutoff &&
        deps.now().getTime() >= cutoff.getTime() &&
        (await automaticMonthlyPayment(deps.db, project.id))
      )
        throw new MonthlyPaymentError(
          409,
          "cutoff_passed",
          "The cutoff for this month has passed. The automatic process pays the current allocations.",
        );
      const base = await loadBase(deps.db, project.id, period);
      if (!base)
        throw new MonthlyPaymentError(
          404,
          "proposal_unavailable",
          "No allocation has been proposed for this month.",
        );
      const { changes, sequence } = await loadChanges(
        deps.db,
        project.id,
        period,
      );
      if (sequence !== change.expectedSequence)
        throw new MonthlyPaymentError(
          409,
          "allocations_changed",
          "The allocations changed. Reload them before saving.",
        );
      try {
        assertAllocationChange(
          currentAllocations(base.rows, changes),
          base.capBase,
          { ...change, actorId: actor.githubId },
          // The proposal's own manifest revision fixes the month's exclusions.
          payoutExcludedGithubUserIds(base.manifest, period),
        );
        if (
          base.manifest.reward.chain === "solana" &&
          BigInt(change.grossBase) > (1n << 64n) - 1n
        )
          throw new MonthlyAllocationError(
            "The amount exceeds the Solana token range.",
          );
      } catch (error) {
        if (error instanceof MonthlyAllocationError)
          throw new MonthlyPaymentError(
            error.message.includes("own allocation") ? 403 : 400,
            "invalid_allocation",
            error.message,
          );
        throw error;
      }
      let changed: number | undefined;
      try {
        const inserted = await deps.db
          .prepare(
            `INSERT INTO monthly_allocation_changes(project_id,period,sequence,github_user_id,gross_base,actor_id,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
          )
          .bind(
            project.id,
            period,
            sequence + 1,
            change.githubUserId,
            change.grossBase,
            actor.githubId,
            deps.now().toISOString(),
            actor.githubId,
          )
          .run();
        changed = inserted.meta?.changes;
      } catch {
        // A concurrent change took this sequence, or the month was frozen.
        throw new MonthlyPaymentError(
          409,
          "allocations_changed",
          "The allocations changed. Reload them before saving.",
        );
      }
      if (changed !== 1) {
        await assertMonthlyParticipation(deps.db, actor.githubId);
        throw new MonthlyPaymentError(
          409,
          "allocations_changed",
          "The allocations changed. Reload them before saving.",
        );
      }
      return view(project, period);
    },
    async setAutomatic(projectId: string, actor: GithubActor, on: boolean) {
      const project = await authorized(projectId, actor);
      await assertMonthlyParticipation(deps.db, actor.githubId);
      let changed: number | undefined;
      try {
        const inserted = await deps.db
          .prepare(
            `INSERT INTO monthly_payment_settings(project_id,sequence,automatic,actor_id,created_at) SELECT ?,COALESCE(MAX(sequence),0)+1,?,?,? FROM monthly_payment_settings WHERE project_id=? HAVING NOT EXISTS (${PARTICIPATION_BAN_QUERY})`,
          )
          .bind(
            project.id,
            on ? 1 : 0,
            actor.githubId,
            deps.now().toISOString(),
            project.id,
            actor.githubId,
          )
          .run();
        changed = inserted.meta?.changes;
      } catch {
        throw new MonthlyPaymentError(
          409,
          "setting_changed",
          "The setting changed at the same time. Retry.",
        );
      }
      if (changed !== 1) {
        await assertMonthlyParticipation(deps.db, actor.githubId);
        throw new MonthlyPaymentError(
          409,
          "setting_changed",
          "The setting changed at the same time. Retry.",
        );
      }
      return { automatic: await automaticMonthlyPayment(deps.db, project.id) };
    },
    async finalize(
      projectId: string,
      period: string,
      actor: GithubActor,
      expectedSequence: number,
    ) {
      const project = await authorized(projectId, actor);
      if (
        project.manifest.status !== "active" ||
        (await deps.restricted(project))
      )
        throw new MonthlyPaymentError(
          409,
          "project_restricted",
          "This project is restricted. Its awards cannot be finalized now.",
        );
      const deployment = servedDeployment(project.manifest, deps.networks());
      if (!deployment)
        throw new MonthlyPaymentError(
          409,
          "vault_not_served",
          "Award processing is not configured for this project's vault network.",
        );
      const now = deps.now();
      await freezeMonthlyPeriod(deps.db, {
        project,
        deployment,
        period,
        trigger: "owner",
        actorId: actor.githubId,
        expectedSequence,
        now,
      });
      await createMonthlyObligations(deps.db, project.id, period, now);
      await unchanged(project);
      return view(project, period);
    },
    async commitment(
      projectId: string,
      period: string,
      actor: GithubActor,
      expected: MonthlyCommitmentInput,
    ): Promise<MonthlyCommitmentPlan> {
      const project = await authorized(projectId, actor);
      if (
        project.manifest.status !== "active" ||
        (await deps.restricted(project))
      )
        throw new MonthlyPaymentError(
          409,
          "project_restricted",
          "This project is restricted. New award reservations are unavailable.",
        );
      if (project.manifestSha256 !== expected.manifestSha256)
        throw new MonthlyPaymentError(
          409,
          "project_changed",
          "The project changed. Reload its awards.",
        );
      const deployment = servedDeployment(project.manifest, deps.networks());
      if (!deployment || deployment.network !== expected.network)
        throw new MonthlyPaymentError(
          409,
          "vault_not_served",
          "Award processing is not configured for this network.",
        );
      const run = await loadRun(deps.db, project.id, assertPeriod(period));
      if (!run || run.snapshotSha256 !== expected.snapshotSha256)
        throw new MonthlyPaymentError(
          409,
          "snapshot_changed",
          "The finalized awards differ. Reload them.",
        );
      if (run.network !== deployment.network || run.vault !== deployment.vault)
        throw new MonthlyPaymentError(
          409,
          "vault_changed",
          "The vault changed after this month was finalized.",
        );
      const obligation = await deps.db
        .prepare(
          "SELECT m.github_login,m.gross_base,m.fee_base,m.source_digest,(SELECT state FROM payment_obligations o WHERE o.network=m.network AND o.vault=m.vault AND o.source_digest=m.source_digest) chain_state FROM monthly_payment_obligations m WHERE m.project_id=? AND m.period=? AND m.github_user_id=?",
        )
        .bind(project.id, period, expected.githubUserId)
        .first<{
          github_login: string;
          gross_base: string;
          fee_base: string;
          source_digest: string;
          chain_state: string | null;
        }>();
      if (
        !obligation &&
        (await deps.db
          .prepare(
            "SELECT 1 FROM monthly_payment_exclusions WHERE project_id=? AND period=? AND github_user_id=?",
          )
          .bind(project.id, period, expected.githubUserId)
          .first())
      )
        throw new MonthlyPaymentError(
          403,
          "award_excluded",
          "This account was banned before the award was funded.",
        );
      if (!obligation)
        throw new MonthlyPaymentError(
          409,
          "award_unfunded",
          "This award waits for enough free vault funds.",
        );
      if (obligation.chain_state !== null)
        throw new MonthlyPaymentError(
          409,
          "award_reserved",
          "This award is already reserved on the finalized chain.",
        );
      const gross = BigInt(obligation.gross_base);
      await unchanged(project);
      return {
        schemaVersion: "2",
        projectId: project.id,
        cycleId: period,
        manifestSha256: project.manifestSha256,
        snapshotSha256: run.snapshotSha256,
        deployment,
        award: {
          githubUserId: expected.githubUserId,
          login: obligation.github_login,
          sourceDigest: obligation.source_digest,
          gross: gross.toString(),
          fee: obligation.fee_base,
          net: (gross - BigInt(obligation.fee_base)).toString(),
        },
      };
    },
  };
}
export type MonthlyOwnerService = ReturnType<typeof monthlyOwnerService>;
