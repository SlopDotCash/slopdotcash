import { assertFreshCyclePaymentPolicy } from "./fresh-cycle-policy.mjs";

export { assertFreshCyclePaymentPolicy } from "./fresh-cycle-policy.mjs";

/** Read-only runtime readiness. No manifest activation, approval, reservation write, or signing.
 * The trusted loader must authenticate reviewed policy/instrument history, complete
 * funding/signer/reservation ledgers (including losses and retired intents), and
 * finalized mainnet RPC provenance. JSON supplied by a requester is NOT a loader.
 * The release host loads the accepted global reservation and rechecks protected
 * develop before writing exact bytes. This read-only result is not a lease.
 */
import {
  assertProjectCommitmentLedger,
  commitmentVerifiedNetMinor,
} from "./funding-commitment";
import {
  assertFundingCommitments,
  type SquadsV4VaultInstrument,
} from "./funding-instruments.mjs";
import { fundingReviewProposalSha256 } from "./funding-review-submission";
import { assertRewardAllocationManifest } from "./rewards";
import {
  assertPublicSignerReport,
  type PublicSignerReport,
  publicSignerStatus,
} from "./signer-capability";
import {
  assertSquadsVaultUsdcState,
  deriveVaultUsdcTokenAccount,
} from "./squads-funding";

/** Optional reviewed contract in canonical project funding.
 * One exact cycle only. Review and activation must precede its first funded proposal,
 * not its contributions. Instrument month boundaries describe the funding period.
 * Imported accrual and additive review budgets are outside this minimal version.
 */
export interface FreshCyclePaymentPolicy {
  schemaVersion: "1";
  kind: "fresh-cycle-payment-policy";
  projectId: string;
  cycleId: string;
  effectiveAt: string;
  planningExpiresAt: string;
  instrumentSha256: string;
  feeRecipient: string;
}
export interface FundingReservation {
  planSha256: string;
  instrumentId: string;
  intentIds: string[];
  principalMinor: string;
  feeMinor: string;
  state: "reserved" | "issued" | "retired";
  /** Loader verifies irreversible retirement/non-replay evidence, not a timeout.
   * No implicit expiration, signer-loss release, or carry conversion is allowed. */
  retirementEvidenceSha256: string | null;
}
export interface FundingReadinessEvidence {
  policy: unknown | null;
  reviewedAt: string;
  reviewedCommit: string;
  instrumentBytes: Uint8Array;
  allocationSha256: string;
  observedAt: string;
  /** Same finalized mainnet getMultipleAccounts response: multisig + USDC ATA. */
  accounts: unknown;
  cluster: "mainnet-beta";
  commitment: "finalized";
  tokenAccount: string;
  /** Authenticated original monetary freezes, including superseded proposals.
   * Zero-funded preparatory snapshots are not monetary freezes. */
  fundedProposalHistory: {
    projectId: string;
    cycleId: string;
    instrumentId: string;
    firstPublishedAt: string;
    generatedAt: string;
    sourceSnapshotSha256: string;
  }[];
  fundingRecords: unknown[];
  signerReports: PublicSignerReport[];
  /** Complete across ALL projects/cycles, not just the requested allocation. */
  reservations: FundingReservation[];
  reservationRevision: string;
  /** Only the exact canonical reservation already validated by the host loader. */
  releasePlanSha256?: string;
}
export interface FundingReadinessResult {
  status: "ready" | "blocked";
  reasons: string[];
  paymentAuthorized: false;
  /** Existing manifest accessibility remains unknown even on a ready result. */
  publicAccessibility: "unknown";
  principalMinor: string;
  feeMinor: string;
  requiredMinor: string;
  reservedMinor: string | null;
  reservationRevision: string | null;
  allocationSha256: string;
}
const SHA = /^[a-f0-9]{64}$/u;
const MAX_OBSERVATION_AGE_MS = 300_000;
function utc(value: string): number {
  if (
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError("Noncanonical evidence timestamp");
  return Date.parse(value);
}
function money(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/u.test(value))
    throw new TypeError("Invalid reservation amount");
  return BigInt(value);
}
/** Returns reasoned readiness for an exact fresh-cycle plan release. Authentication is host-owned;
 * independent byte/identity/configuration/arithmetic checks remain local here. */
export async function verifyFundingReadiness(input: {
  allocationBytes: Uint8Array;
  now: string;
  loadTrustedEvidence: (
    allocationSha256: string,
  ) => Promise<FundingReadinessEvidence>;
}): Promise<FundingReadinessResult> {
  const bytes = new Uint8Array(input.allocationBytes);
  const digest = await fundingReviewProposalSha256(bytes);
  const result: FundingReadinessResult = {
    status: "blocked",
    reasons: [],
    paymentAuthorized: false,
    publicAccessibility: "unknown",
    principalMinor: "0",
    feeMinor: "0",
    requiredMinor: "0",
    reservedMinor: null,
    reservationRevision: null,
    allocationSha256: digest,
  };
  const block = (reason: string) => {
    result.reasons.push(reason);
  };
  try {
    const now = utc(input.now);
    // Snapshot all host-owned mutable data before any further asynchronous work.
    const evidence = structuredClone(await input.loadTrustedEvidence(digest));
    const allocation = assertRewardAllocationManifest(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    const policy = assertFreshCyclePaymentPolicy(evidence.policy);
    if (evidence.allocationSha256 !== digest)
      throw new TypeError("Allocation differs from reviewed evidence");
    const firstFreeze = utc(allocation.generatedAt);
    if (!/^[a-f0-9]{40}$/u.test(evidence.reviewedCommit))
      throw new TypeError("Missing immutable review commit");
    if (
      policy.projectId !== allocation.projectId ||
      policy.cycleId !== allocation.cycleId ||
      utc(evidence.reviewedAt) >= firstFreeze ||
      utc(policy.effectiveAt) >= firstFreeze
    )
      block(
        "Policy must be reviewed and effective before the first funded proposal",
      );
    if (utc(policy.planningExpiresAt) <= now)
      block("Reviewed planning policy expired; reservations remain held");
    if (
      allocation.status !== "approved" ||
      !allocation.approvedAt ||
      utc(allocation.approvedAt) > now
    )
      block("Allocation is not approved as of evaluation time");
    if (
      allocation.carriedMinor !== undefined &&
      allocation.carriedMinor !== "0"
    )
      block("Imported carry is unsupported");
    if (allocation.rewardLines)
      block("Separate review budgets require a later reviewed extension");
    const principal = money(allocation.totals.approvedMinor);
    const fee = money(allocation.totals.feeMinor);
    result.principalMinor = principal.toString();
    result.feeMinor = fee.toString();
    result.requiredMinor = (principal + fee).toString();
    if (principal === 0n) block("No approved payable principal");
    if (fee !== principal / 100n || allocation.feeBasisPoints !== 100)
      block("Fee does not reconcile approved principal");
    if (
      (await fundingReviewProposalSha256(evidence.instrumentBytes)) !==
      policy.instrumentSha256
    )
      throw new TypeError("Reviewed instrument digest mismatch");
    const [instrument] = assertFundingCommitments([
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          evidence.instrumentBytes,
        ),
      ),
    ]);
    if (instrument.kind !== "squads-v4-vault")
      throw new TypeError("Only reviewed Squads instruments are supported");
    const vault: SquadsV4VaultInstrument = instrument;
    const instrumentId = `squads-v4-vault:solana:${vault.multisig}:${vault.vaultIndex}:${vault.vault}`;
    const relevantFreezes = evidence.fundedProposalHistory.filter(
      (r) =>
        r.instrumentId === instrumentId ||
        (r.projectId === allocation.projectId &&
          r.cycleId === allocation.cycleId),
    );
    if (relevantFreezes.length !== 1)
      block(
        "Fresh activation requires exactly one original funded freeze and no prior instrument use",
      );
    for (const freeze of relevantFreezes) {
      if (
        freeze.projectId !== allocation.projectId ||
        freeze.cycleId !== allocation.cycleId ||
        freeze.instrumentId !== instrumentId ||
        freeze.generatedAt !== allocation.generatedAt ||
        freeze.sourceSnapshotSha256 !== allocation.sourceSnapshotSha256 ||
        utc(freeze.firstPublishedAt) > now ||
        utc(freeze.firstPublishedAt) < firstFreeze ||
        utc(evidence.reviewedAt) >= utc(freeze.firstPublishedAt) ||
        utc(policy.effectiveAt) >= utc(freeze.firstPublishedAt)
      )
        block(
          "Existing monetary freeze cannot be reactivated or repriced by a later policy",
        );
    }
    if (
      vault.replacedAt !== null ||
      utc(vault.effectiveAt) > now ||
      vault.monthlyCommitment?.cycleId !== allocation.cycleId ||
      !vault.stewardGithub ||
      vault.stewardGithub.actorId === vault.funderActorId
    )
      block(
        "Instrument is inactive, expired, or lacks independent exact-cycle stewardship",
      );
    if (
      allocation.fundingBasis?.instrumentId !== instrumentId ||
      allocation.fundingBasis?.fundingState !== "committed"
    )
      block("Allocation is not bound to this committed instrument");
    if (principal > money(vault.monthlyCommitment?.amountMinor ?? "0"))
      block("Principal exceeds reviewed monthly commitment");
    const intents = allocation.allocations.filter(
      (r) => r.state === "approved",
    );
    if (
      intents.reduce((sum, r) => sum + money(r.approvedMinor), 0n) !== principal
    )
      block("Approved intents do not reconcile principal");
    const { isSolanaAddress } = await import("./wallets");
    if (
      !isSolanaAddress(policy.feeRecipient) ||
      policy.feeRecipient === vault.vault ||
      intents.some((r) => !r.wallet || r.wallet.address === vault.vault)
    )
      block("Invalid payable destinations");
    if (
      evidence.cluster !== "mainnet-beta" ||
      evidence.commitment !== "finalized" ||
      utc(evidence.observedAt) > now ||
      now - utc(evidence.observedAt) > MAX_OBSERVATION_AGE_MS
    )
      block("Finalized mainnet evidence is absent, future, or stale");
    if (
      evidence.tokenAccount !== (await deriveVaultUsdcTokenAccount(vault.vault))
    )
      throw new TypeError("Observation is not the canonical vault USDC ATA");
    const state = await assertSquadsVaultUsdcState(
      evidence.accounts,
      vault.multisig,
      vault.vault,
      vault.vaultIndex,
      evidence.tokenAccount,
      vault.funderMember,
      vault.stewardMember,
    );
    const tokenInfo = (
      evidence.accounts as {
        value: { data: { parsed: { info: Record<string, unknown> } } }[];
      }
    ).value[1].data.parsed.info;
    if (
      tokenInfo.state !== "initialized" ||
      tokenInfo.delegate != null ||
      tokenInfo.closeAuthority != null
    )
      block(
        "Vault USDC account is frozen, delegated, or has a close authority",
      );
    // Existing funding verifier requires voting. New execution readiness also
    // requires proposer and executor capability across the reviewed members.
    const raw = (evidence.accounts as { value: { data: string[] }[] }).value[0]
      .data[0];
    const config = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    if (
      ((config[164] | config[197]) & 7) !== 7 ||
      config.slice(74, 78).some((b) => b !== 0)
    )
      block(
        "Execution requires proposer and executor roles across the voting members and zero timelock",
      );
    if (money(state.balanceMinor) < principal + fee)
      block("Finalized USDC balance does not cover principal plus fee");
    const records = assertProjectCommitmentLedger(evidence.fundingRecords, [
      vault,
    ]);
    if (
      records.some(
        (r) =>
          r.projectId !== allocation.projectId ||
          utc(r.observedAt) > now ||
          (r.verifier && utc(r.verifier.checkedAt) > now),
      )
    )
      throw new TypeError("Funding ledger project or observation mismatch");
    if (commitmentVerifiedNetMinor(records) < principal + fee)
      block("Canonical verified funding does not cover principal plus fee");
    const reports = evidence.signerReports.map(assertPublicSignerReport);
    if (
      reports.some(
        (r) =>
          r.projectId !== allocation.projectId ||
          r.cycleId !== allocation.cycleId ||
          r.instrumentId !== instrumentId,
      )
    )
      throw new TypeError("Signer ledger identity mismatch");
    if (publicSignerStatus(reports, now) !== "both-signers-current")
      block(
        "Both authenticated signers must be current; loss or expiry blocks new plans",
      );
    if (!SHA.test(evidence.reservationRevision))
      throw new TypeError("Missing complete reservation revision");
    const planIds = new Set<string>();
    const allIntents = new Set<string>();
    let reserved = 0n;
    for (const reservation of evidence.reservations) {
      if (
        !SHA.test(reservation.planSha256) ||
        planIds.has(reservation.planSha256) ||
        !Array.isArray(reservation.intentIds) ||
        reservation.intentIds.length === 0 ||
        typeof reservation.instrumentId !== "string" ||
        !reservation.instrumentId ||
        !["reserved", "issued", "retired"].includes(reservation.state)
      )
        throw new TypeError("Invalid reservation ledger");
      planIds.add(reservation.planSha256);
      const amount =
        money(reservation.principalMinor) + money(reservation.feeMinor);
      for (const id of reservation.intentIds) {
        if (typeof id !== "string" || !id || allIntents.has(id))
          throw new TypeError("Duplicate or invalid reserved intent");
        allIntents.add(id);
      }
      if (
        reservation.state === "retired"
          ? !SHA.test(reservation.retirementEvidenceSha256 ?? "")
          : reservation.retirementEvidenceSha256 !== null
      )
        throw new TypeError(
          "Retirement requires authenticated irreversible evidence",
        );
      if (
        reservation.instrumentId === instrumentId &&
        reservation.state !== "retired"
      )
        reserved += amount;
    }
    result.reservedMinor = reserved.toString();
    result.reservationRevision = evidence.reservationRevision;
    const own = evidence.releasePlanSha256
      ? evidence.reservations.find(
          (r) => r.planSha256 === evidence.releasePlanSha256,
        )
      : undefined;
    if (
      evidence.releasePlanSha256 &&
      (!own ||
        own.state === "retired" ||
        own.instrumentId !== instrumentId ||
        own.principalMinor !== principal.toString() ||
        own.feeMinor !== fee.toString() ||
        JSON.stringify([...own.intentIds].sort()) !==
          JSON.stringify(intents.map((r) => r.intentId).sort()))
    )
      block(
        "Release reservation does not bind exactly these principal, fee and intents",
      );
    if (
      evidence.reservations.some(
        (r) =>
          r !== own && r.instrumentId === instrumentId && r.state !== "retired",
      )
    )
      block(
        "Instrument already reserved; loss and expiry never release issued principal",
      );
    if (
      intents.some(
        (r) =>
          allIntents.has(r.intentId) && !own?.intentIds.includes(r.intentId),
      )
    )
      block(
        "Intent already reserved or retired; never reissue or import it as carry",
      );
    if (result.reasons.length === 0) result.status = "ready";
  } catch (error) {
    block(
      error instanceof Error ? error.message : "Readiness evidence unavailable",
    );
  }
  return result;
}
