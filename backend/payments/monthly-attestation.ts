/** Trusted input for the bounded monthly attester (PRD sections 6 and 7).
 * Requests identify a frozen month; they never supply recipients or amounts.
 * This prepares authorization bytes only. It does not reserve or pay funds.
 */
import {
  evmAllocationRoot,
  evmMonthlyDigest,
} from "../../contracts/evm/adapter";
import {
  solanaAllocationRoot,
  solanaMonthlyMessage,
} from "../../contracts/solana/adapter";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
  isBaseUnits,
} from "../../src/lib/escrow-policy.mjs";
import { escrowAwardOrigin } from "../../src/lib/payments/escrow-cycle";
import {
  assertPeriod,
  buildExecutionSnapshot,
  type MonthlyExecutionSnapshot,
  type MonthlySchedule,
  monthlyCutoff,
  periodEnd,
} from "../../src/lib/payments/monthly-allocation";
import { payoutExcludedGithubUserIds } from "../../src/lib/payout-exclusions.mjs";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import { sha256Hex } from "../../src/lib/sha256";
import type { D1TransactionalDatabase } from "../d1";
import { automaticMonthlyPayment, MonthlyPaymentError } from "./monthly";

export interface MonthlyAttestationRequest {
  projectId: string;
  period: string;
  network: EscrowDeployment["network"];
  snapshotSha256: string;
}
export interface MonthlyAttestationPlan {
  request: MonthlyAttestationRequest;
  deployment: EscrowDeployment;
  allocationRoot: string;
  /** EIP-712 digest on EVM; domain-separated message on Solana. Hex without 0x. */
  messageHex: string;
  family: "evm" | "solana";
  totalGrossBase: string;
  /** Solana only: Unix seconds of the finalized slot at which the attester saw
   * no `origin` or `monthly-source` account for any included source. */
  frozenAt?: string;
  entries: { githubUserId: string; grossMicro: string; sourceDigest: string }[];
}
function reject(code: string, message: string): never {
  throw new MonthlyPaymentError(409, code, message);
}

/** The caller must re-run this immediately before signing and publishing.
 * The chain still enforces its live cap, opt-out, authority and monthly window.
 * The recorded funding-time decisions preserve already-funded awards.
 * A Solana plan without `frozenAt` has an empty `messageHex` and cannot be
 * signed; the attester first observes the freeze slot (`freezeSolanaMonthly`).
 */
export async function prepareMonthlyAttestation(
  deps: {
    db: D1TransactionalDatabase;
    getProject(id: string): Promise<ProjectRecord | null>;
    restricted(project: ProjectRecord): Promise<boolean>;
    networks: readonly string[];
    schedule: MonthlySchedule;
    now: Date;
  },
  request: MonthlyAttestationRequest,
  frozenAt?: string,
): Promise<MonthlyAttestationPlan> {
  const period = assertPeriod(request.period);
  const cutoff = monthlyCutoff(deps.schedule, period);
  // Match the contract's single open accounting month; a late funding deposit
  // must not make an expired authorization signable in a different month.
  const nextPeriod = periodEnd(period).toISOString().slice(0, 7);
  const closes = monthlyCutoff(deps.schedule, nextPeriod);
  if (
    !cutoff ||
    !closes ||
    !Number.isFinite(deps.now.getTime()) ||
    deps.now < cutoff ||
    deps.now >= closes
  )
    reject(
      "monthly_window_closed",
      "This month is outside its commitment window.",
    );
  const project = await deps.getProject(request.projectId);
  if (project?.manifest.status !== "active" || (await deps.restricted(project)))
    reject("project_restricted", "The project cannot create new commitments.");
  const deployment = project.manifest.escrow?.deployments.find(
    (d) => d.network === request.network,
  );
  if (!deployment || !deps.networks.includes(request.network))
    reject(
      "vault_not_served",
      "The project's vault is not served by this attester.",
    );
  if (!(await automaticMonthlyPayment(deps.db, project.id)))
    reject(
      "automatic_off",
      "The owner disabled automatic monthly commitments.",
    );
  const run = await deps.db
    .prepare(
      "SELECT r.snapshot,r.snapshot_sha256,r.network,r.vault,r.frozen_at,r.obligations_created_at,b.cap_base,b.manifest_sha256 base_manifest_sha256,b.source_snapshot_sha256 FROM monthly_payment_runs r JOIN monthly_reward_bases b ON b.project_id=r.project_id AND b.period=r.period WHERE r.project_id=? AND r.period=?",
    )
    .bind(project.id, period)
    .first<{
      snapshot: string;
      snapshot_sha256: string;
      network: string;
      vault: string;
      frozen_at: string;
      obligations_created_at: string | null;
      cap_base: string;
      base_manifest_sha256: string;
      source_snapshot_sha256: string;
    }>();
  if (
    !run ||
    !/^[a-f0-9]{64}$/.test(request.snapshotSha256) ||
    run.snapshot_sha256 !== request.snapshotSha256 ||
    sha256Hex(run.snapshot) !== request.snapshotSha256
  )
    reject(
      "snapshot_changed",
      "The requested frozen allocation is unavailable.",
    );
  if (!run.obligations_created_at)
    reject(
      "award_unfunded",
      "The month has not qualified for funded obligations.",
    );
  const snapshot = JSON.parse(run.snapshot) as MonthlyExecutionSnapshot;
  if (
    snapshot.projectId !== project.id ||
    snapshot.period !== period ||
    snapshot.network !== request.network ||
    run.network !== request.network ||
    snapshot.vault !== deployment.vault ||
    run.vault !== deployment.vault ||
    snapshot.asset !== deployment.asset ||
    snapshot.manifestSha256 !== project.manifestSha256 ||
    snapshot.baseManifestSha256 !== run.base_manifest_sha256 ||
    snapshot.sourceSnapshotSha256 !== run.source_snapshot_sha256 ||
    snapshot.capBase !== run.cap_base ||
    snapshot.frozenAt !== run.frozen_at
  )
    reject(
      "snapshot_changed",
      "The frozen allocation does not match the current project and proposal.",
    );
  if (!Array.isArray(snapshot.awards) || snapshot.awards.length === 0)
    reject("empty_allocation", "An empty month needs no chain commitment.");
  const excluded = payoutExcludedGithubUserIds(project.manifest, period);
  const ids = new Set<string>();
  for (const award of snapshot.awards) {
    if (
      !isBaseUnits(award.grossBase) ||
      award.grossBase === "0" ||
      (ESCROW_NETWORKS[deployment.network].family === "solana" &&
        BigInt(award.grossBase) > (1n << 64n) - 1n) ||
      ids.has(award.githubUserId) ||
      award.sourceDigest !==
        escrowAwardOrigin(project.id, period, award.githubUserId)
    )
      reject(
        "invalid_allocation",
        "The frozen allocation contains an invalid or repeated award.",
      );
    ids.add(award.githubUserId);
    if (excluded.has(award.githubUserId))
      reject("recipient_restricted", "An allocation recipient is excluded.");
  }
  const canonical = buildExecutionSnapshot({
    base: {
      projectId: project.id,
      period,
      manifestSha256: run.base_manifest_sha256,
      sourceSnapshotSha256: run.source_snapshot_sha256,
      capBase: run.cap_base,
    },
    allocations: snapshot.awards.map((a) => ({
      ...a,
      proposedGrossBase: a.grossBase,
    })),
    allocationSequence: snapshot.allocationSequence,
    trigger: snapshot.trigger,
    manifestSha256: project.manifestSha256,
    network: request.network,
    vault: deployment.vault,
    asset: deployment.asset,
    frozenAt: run.frozen_at,
  });
  if (canonical.text !== run.snapshot)
    reject("invalid_allocation", "The frozen allocation is not canonical.");
  // Eligibility was decided atomically when obligations were funded. A later
  // account ban must not revoke that funded right. Every omitted snapshot
  // award needs its immutable funding-time exclusion record.
  const exclusions = await deps.db
    .prepare(
      "SELECT json_group_array(json_object('githubUserId',github_user_id,'sourceDigest',source_digest,'network',network,'vault',vault)) items FROM monthly_payment_exclusions WHERE project_id=? AND period=?",
    )
    .bind(project.id, period)
    .first<{ items: string }>();
  const omitted = JSON.parse(exclusions?.items ?? "[]") as {
    githubUserId: string;
    sourceDigest: string;
    network: string;
    vault: string;
  }[];
  if (
    omitted.some(
      (r) =>
        r.network !== request.network ||
        r.vault !== deployment.vault ||
        !snapshot.awards.some(
          (a) =>
            a.githubUserId === r.githubUserId &&
            a.sourceDigest === r.sourceDigest,
        ),
    )
  )
    reject(
      "obligations_changed",
      "An exclusion does not match the frozen allocation.",
    );
  const omittedSources = new Set(omitted.map((r) => r.sourceDigest));
  const eligible = snapshot.awards.filter(
    (a) => !omittedSources.has(a.sourceDigest),
  );
  if (eligible.length === 0)
    reject("empty_allocation", "No eligible award needs a chain commitment.");
  const totalGrossBase = eligible
    .reduce((total, a) => total + BigInt(a.grossBase), 0n)
    .toString();
  // Compare every obligation, not just the existence of the month marker.
  const obligations = await deps.db
    .prepare(
      "SELECT json_group_array(json_object('githubUserId',github_user_id,'grossBase',gross_base,'feeBase',fee_base,'sourceDigest',source_digest,'network',network,'vault',vault)) items FROM monthly_payment_obligations WHERE project_id=? AND period=?",
    )
    .bind(project.id, period)
    .first<{ items: string }>();
  const rows = JSON.parse(obligations?.items ?? "[]") as {
    githubUserId: string;
    grossBase: string;
    feeBase: string;
    sourceDigest: string;
    network: string;
    vault: string;
  }[];
  if (
    rows.length !== eligible.length ||
    eligible.some(
      (a) =>
        !rows.some(
          (r) =>
            r.githubUserId === a.githubUserId &&
            r.grossBase === a.grossBase &&
            r.feeBase === a.feeBase &&
            r.sourceDigest === a.sourceDigest &&
            r.network === request.network &&
            r.vault === deployment.vault,
        ),
    )
  )
    reject(
      "obligations_changed",
      "The funded obligations do not match the frozen allocation.",
    );
  // The contract releases a leaf whose source another month consumed, so no
  // source may appear in two months of one vault. Sources are period-bound by
  // escrowAwardOrigin; this also refuses any published month that repeats one.
  const others = await deps.db
    .prepare(
      "SELECT json_group_array(authorization) items FROM monthly_payment_authorizations WHERE project_id=? AND network=? AND period<>?",
    )
    .bind(project.id, request.network, period)
    .first<{ items: string }>();
  const sources = new Set(eligible.map((a) => a.sourceDigest.toLowerCase()));
  for (const text of JSON.parse(others?.items ?? "[]") as string[]) {
    const other = JSON.parse(text) as {
      plan: { entries: { sourceDigest: string }[] };
    };
    if (
      other.plan.entries.some((e) =>
        sources.has(e.sourceDigest.replace(/^0x/, "").toLowerCase()),
      )
    )
      reject(
        "source_repeated",
        "An award source already appears in another month.",
      );
  }
  const network = ESCROW_NETWORKS[request.network];
  const entries = eligible.map((a) => ({
    githubUserId: a.githubUserId,
    grossMicro: a.grossBase,
    sourceDigest:
      network.family === "evm" ? `0x${a.sourceDigest}` : a.sourceDigest,
  }));
  const allocationRoot =
    network.family === "evm"
      ? evmAllocationRoot(entries)
      : solanaAllocationRoot(entries);
  let messageHex = "";
  if (network.family === "evm") {
    if (!network.chainId)
      reject("invalid_deployment", "EVM chain identity is missing.");
    messageHex = evmMonthlyDigest(
      BigInt(network.chainId),
      deployment.vault,
      period,
      allocationRoot,
    ).slice(2);
  } else {
    if (
      !deployment.programId ||
      !deployment.projectPda ||
      !deployment.networkDomain
    )
      reject("invalid_deployment", "Solana deployment identity is missing.");
    if (frozenAt !== undefined) {
      // The contract requires window opening <= frozen_at <= admission time.
      const at = /^[1-9][0-9]{0,15}$/.test(frozenAt) ? Number(frozenAt) : NaN;
      if (
        !(at >= cutoff.getTime() / 1000) ||
        !(at < closes.getTime() / 1000) ||
        at > deps.now.getTime() / 1000
      )
        reject(
          "invalid_freeze",
          "The freeze time is outside the commitment window.",
        );
      messageHex = Array.from(
        solanaMonthlyMessage(
          deployment.programId,
          deployment.projectPda,
          period,
          allocationRoot,
          totalGrossBase,
          frozenAt,
          deployment.networkDomain,
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
    }
  }
  return {
    request,
    deployment,
    family: network.family,
    allocationRoot,
    messageHex,
    totalGrossBase,
    ...(network.family === "solana" && frozenAt !== undefined
      ? { frozenAt }
      : {}),
    entries,
  };
}
