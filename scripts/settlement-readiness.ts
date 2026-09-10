/** Production evidence assembly. All history comes from a verified canonical SHA;
 * no caller-supplied ledger, RPC endpoint, or positive readiness flag is accepted. */

import { readBoundedJson } from "../src/lib/browser-json";
import { assertFreshCyclePaymentPolicy } from "../src/lib/fresh-cycle-policy.mjs";
import { assertProjectCommitmentLedger } from "../src/lib/funding-commitment";
import {
  type FundingReadinessEvidence,
  verifyFundingReadiness,
} from "../src/lib/funding-readiness";
import { publicSignerReport } from "../src/lib/signer-capability";
import {
  assertSquadsVaultUsdcState,
  deriveVaultUsdcTokenAccount,
} from "../src/lib/squads-funding";
import type { loadCanonicalPaymentReservation } from "./load-payment-reservation";
import {
  gitReservationBlob,
  PAYMENT_REPOSITORY,
  reservationGit,
  reservationGithub,
  reservationJson,
} from "./payment-reservation-history";
import { SOLANA_COMMITMENT_RPC_AUTHORITIES } from "./verify-commitment-squads";

type Loaded = Awaited<ReturnType<typeof loadCanonicalPaymentReservation>>;
function paths(root: string, sha: string, directory: string): string[] {
  const rows = reservationGit(root, [
    "ls-tree",
    "-r",
    "--name-only",
    sha,
    "--",
    directory,
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (rows.length > 100000)
    throw new TypeError("Canonical inventory exceeds bound");
  return rows;
}
function acceptedAt(sha: string): string {
  const prs = reservationGithub(
    `repos/${PAYMENT_REPOSITORY}/commits/${sha}/pulls?per_page=100`,
  ) as {
    merged_at?: string;
    merge_commit_sha?: string;
    base?: { ref?: string; repo?: { full_name?: string } };
  }[];
  const matches = Array.isArray(prs)
    ? prs.filter(
        (p) =>
          p.merge_commit_sha === sha &&
          p.base?.ref === "develop" &&
          p.base.repo?.full_name === PAYMENT_REPOSITORY &&
          p.merged_at,
      )
    : [];
  if (matches.length !== 1)
    throw new TypeError(
      "Cannot prove canonical policy/proposal acceptance through a merged develop PR",
    );
  const time = new Date(matches[0].merged_at as string);
  if (!Number.isFinite(time.getTime()))
    throw new TypeError("Invalid GitHub merge timestamp");
  return time.toISOString();
}
function history(root: string, loaded: Loaded) {
  const { revision, policy } = loaded;
  const projectPath = `projects/${policy.projectId}/project.json`;
  const policyCommits = reservationGit(root, [
    "rev-list",
    "--first-parent",
    "--reverse",
    revision,
    "--",
    projectPath,
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (policyCommits.length > 24000)
    throw new TypeError("Policy history exceeds bound");
  let policyCommit: string | undefined;
  for (const sha of policyCommits) {
    const bytes = gitReservationBlob(root, sha, projectPath, true);
    const project = bytes
      ? (reservationJson(bytes) as {
          funding?: { freshCyclePaymentPolicy?: unknown };
        })
      : null;
    const candidate = project?.funding?.freshCyclePaymentPolicy;
    if (
      candidate &&
      JSON.stringify(assertFreshCyclePaymentPolicy(candidate)) ===
        JSON.stringify(policy)
    ) {
      policyCommit ??= sha;
    } else if (policyCommit)
      throw new TypeError("Accepted payment policy history was rewritten");
  }
  if (!policyCommit) throw new TypeError("No accepted policy introduction");
  const freezes: FundingReadinessEvidence["fundedProposalHistory"] = [];
  const seen = new Set<string>();
  const commits = reservationGit(root, [
    "rev-list",
    "--first-parent",
    "--reverse",
    revision,
    "--",
    "cycles",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (commits.length > 24000)
    throw new TypeError("Monetary history exceeds bound");
  for (const sha of commits) {
    for (const path of paths(root, sha, "cycles").filter((p) =>
      /^cycles\/[a-z0-9-]+\/\d{4}-\d{2}\/proposal\.json$/u.test(p),
    )) {
      const r = reservationJson(gitReservationBlob(root, sha, path)) as {
        projectId: string;
        cycleId: string;
        capMinor?: string;
        generatedAt: string;
        sourceSnapshotSha256: string;
        fundingBasis?: { instrumentId: string; committedMinor: string };
      };
      if (
        BigInt(r.capMinor ?? "0") === 0n &&
        BigInt(r.fundingBasis?.committedMinor ?? "0") === 0n
      )
        continue;
      const key = `${r.projectId}/${r.cycleId}/${r.fundingBasis?.instrumentId ?? "legacy"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (
        r.fundingBasis?.instrumentId !== loaded.reservation.instrumentId &&
        (r.projectId !== policy.projectId || r.cycleId !== policy.cycleId)
      )
        continue;
      reservationGit(root, ["merge-base", "--is-ancestor", policyCommit, sha]);
      if (sha === policyCommit)
        throw new TypeError(
          "Policy and first funded freeze must be separately accepted",
        );
      freezes.push({
        projectId: r.projectId,
        cycleId: r.cycleId,
        instrumentId: r.fundingBasis?.instrumentId ?? "legacy",
        generatedAt: r.generatedAt,
        sourceSnapshotSha256: r.sourceSnapshotSha256,
        firstPublishedAt: acceptedAt(sha),
      });
    }
  }
  return {
    reviewedCommit: policyCommit,
    reviewedAt: acceptedAt(policyCommit),
    fundedProposalHistory: freezes,
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Fixed public RPCs; two independently validated finalized observations must
 * agree on configuration and balance. Fresh finalized slot rejects stale replay. */
export async function observeSettlementVault(instrument: Loaded["instrument"]) {
  const tokenAccount = await deriveVaultUsdcTokenAccount(instrument.vault);
  const settled = await Promise.allSettled(
    SOLANA_COMMITMENT_RPC_AUTHORITIES.map(async (authority, index) => {
      async function rpc(method: string, params: unknown[]) {
        const id = `slop-release-${index}-${method}`;
        const response = await fetch(authority, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        });
        if (!response.ok)
          throw new TypeError(`Finalized RPC returned HTTP ${response.status}`);
        const value = (await readBoundedJson(
          response,
          1024 * 1024,
          "Finalized readiness RPC",
        )) as {
          jsonrpc?: string;
          id?: string;
          result?: unknown;
          error?: unknown;
        };
        if (
          value.jsonrpc !== "2.0" ||
          value.id !== id ||
          value.error ||
          !Object.hasOwn(value, "result")
        )
          throw new TypeError("Invalid finalized RPC envelope");
        return value.result;
      }
      const accounts = await rpc("getMultipleAccounts", [
        [instrument.multisig, tokenAccount],
        { commitment: "finalized", encoding: "jsonParsed" },
      ]);
      const state = await assertSquadsVaultUsdcState(
        accounts,
        instrument.multisig,
        instrument.vault,
        instrument.vaultIndex,
        tokenAccount,
        instrument.funderMember,
        instrument.stewardMember,
      );
      const latest = await rpc("getSlot", [{ commitment: "finalized" }]);
      if (
        !Number.isSafeInteger(latest) ||
        Number(latest) < state.slot ||
        Number(latest) - state.slot > 64
      )
        throw new TypeError("Finalized account observation is stale");
      return {
        accounts,
        key: canonical((accounts as { value: unknown }).value),
        observedAt: new Date().toISOString(),
      };
    }),
  );
  const groups = new Map<string, { accounts: unknown; observedAt: string }[]>();
  for (const result of settled)
    if (result.status === "fulfilled") {
      const group = groups.get(result.value.key) ?? [];
      group.push(result.value);
      groups.set(result.value.key, group);
    }
  const agreeing = [...groups.values()].find((g) => g.length >= 2);
  if (!agreeing)
    throw new TypeError("No finalized configuration/balance quorum");
  return {
    accounts: agreeing[0].accounts,
    observedAt: agreeing[0].observedAt,
    tokenAccount,
  };
}
export async function assertCanonicalSettlementReadiness(
  root: string,
  loaded: Loaded,
) {
  const evidenceHistory = history(root, loaded);
  const allRecords = paths(
    root,
    loaded.revision,
    `funding/${loaded.policy.projectId}/commitments`,
  )
    .map((path) => {
      if (
        !/^funding\/[a-z0-9-]+\/commitments\/(solana|base|ethereum)\/[A-Za-z0-9]+\/cmt_[a-z0-9_-]+\.json$/u.test(
          path,
        )
      )
        throw new TypeError("Noncanonical funding ledger path");
      return reservationJson(
        gitReservationBlob(root, loaded.revision, path),
      ) as {
        observedAt: string;
        recordId: string;
        manifestRevision: string;
        projectId: string;
        instrument: Record<string, unknown>;
      };
    })
    .sort(
      (a, b) =>
        a.observedAt.localeCompare(b.observedAt) ||
        a.recordId.localeCompare(b.recordId),
    );
  const relevant = allRecords.filter(
    (r) =>
      r.instrument.vault === loaded.instrument.vault &&
      r.instrument.multisig === loaded.instrument.multisig &&
      r.instrument.vaultIndex === loaded.instrument.vaultIndex,
  );
  for (const r of relevant) {
    if (
      r.projectId !== loaded.policy.projectId ||
      !/^[a-f0-9]{40}$/u.test(r.manifestRevision)
    )
      throw new TypeError("Funding record authority mismatch");
    reservationGit(root, [
      "merge-base",
      "--is-ancestor",
      r.manifestRevision,
      loaded.revision,
    ]);
  }
  const fundingRecords = assertProjectCommitmentLedger(relevant, [
    loaded.instrument,
  ]);
  const observation = await observeSettlementVault(loaded.instrument);
  const result = await verifyFundingReadiness({
    allocationBytes: loaded.allocationBytes,
    now: new Date().toISOString(),
    loadTrustedEvidence: async () => ({
      ...evidenceHistory,
      ...observation,
      policy: loaded.policy,
      instrumentBytes: loaded.instrumentBytes,
      allocationSha256: loaded.reservation.allocationSha256,
      cluster: "mainnet-beta",
      commitment: "finalized",
      fundingRecords: [...fundingRecords],
      signerReports: loaded.signerLedger.reports
        .filter(
          (r) =>
            r.projectId === loaded.policy.projectId &&
            r.cycleId === loaded.policy.cycleId &&
            r.instrumentId === loaded.reservation.instrumentId,
        )
        .map(publicSignerReport),
      reservations: loaded.ledger.map((r) => ({
        ...r,
        state: "issued" as const,
        retirementEvidenceSha256: null,
      })),
      reservationRevision: loaded.reservation.planSha256,
      releasePlanSha256: loaded.reservation.planSha256,
    }),
  });
  if (result.status !== "ready")
    throw new TypeError(
      `Settlement readiness blocked: ${result.reasons.join("; ")}`,
    );
  return { ...result, observedAt: observation.observedAt };
}
