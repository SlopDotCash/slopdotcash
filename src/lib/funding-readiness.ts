import { assertFreshCyclePaymentPolicy } from "./fresh-cycle-policy.mjs";

export { assertFreshCyclePaymentPolicy } from "./fresh-cycle-policy.mjs";

import { fundingInstrumentId } from "./allocation-funding-basis.mjs";
/** Read-only runtime readiness. No manifest activation, approval, reservation write, or signing.
 * The trusted loader must authenticate reviewed policy/instrument history, complete
 * funding/signer/reservation ledgers (including losses and retired intents), and
 * finalized mainnet RPC provenance. JSON supplied by a requester is NOT a loader.
 * The release host loads the accepted global reservation and rechecks protected
 * main before writing exact bytes. This read-only result is not a lease.
 */
import {
  assertProjectCommitmentLedger,
  commitmentVerifiedNetMinor,
} from "./funding-commitment";
import {
  assertFundingCommitments,
  type FundingCommitmentInstrument,
} from "./funding-instruments.mjs";
import { fundingReviewProposalSha256 } from "./funding-review-submission";
import { assertRewardAllocationManifest } from "./rewards";
import {
  fundingInstrumentSource,
  planCarriesPlatformFee,
} from "./settlement-plan";
import {
  assertPublicSignerReport,
  currentSignerStatus,
  type PublicSignerReport,
  publicSignerStatus,
} from "./signer-capability";
import {
  assertSquadsCreatorSeat,
  assertSquadsProjectVaultUsdcState,
  assertSquadsVaultUsdcState,
  deriveVaultUsdcTokenAccount,
  SQUADS_PERMISSION_INITIATE,
  type VerifiedSquadsCreatorSeat,
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
  /** Same finalized mainnet getMultipleAccounts response: multisig + USDC ATA,
   * plus the creator multisig as a third account on a project vault. On a
   * Base stream (RFC #472) the quorum-agreed source observation: stream
   * state, recipient code and recipient USDC balance at a finalized block. */
  accounts: unknown;
  cluster: "mainnet-beta" | "base-mainnet";
  commitment: "finalized";
  /** The Solana vault USDC account, or the Base stream recipient. */
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
    // A Squads vault settles on Solana; a Base Sablier stream on Base.
    const network = instrument.kind === "sablier-lockup-v4" ? "base" : "solana";
    if (
      instrument.kind === "sablier-lockup-v4" &&
      instrument.network !== "base"
    )
      throw new TypeError("Only a Base Sablier stream can back a release");
    if (allocation.chain !== network)
      block("Instrument network differs from the allocation network");
    const vault: FundingCommitmentInstrument = instrument;
    const instrumentId = fundingInstrumentId(vault);
    const source = fundingInstrumentSource(vault);
    // RFC #500 section 8: only a 2-of-2 vault pays the platform fee from the
    // vault. A project vault covers contributor principal only; its fee is a
    // separate creator transfer reconciled at settlement, never reserved here.
    const sourceFee = planCarriesPlatformFee(instrumentId) ? fee : 0n;
    const coverage = sourceFee ? "principal plus fee" : "contributor principal";
    result.requiredMinor = (principal + sourceFee).toString();
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
    if (vault.kind === "sablier-lockup-v4") {
      if (
        vault.replacedAt !== null ||
        utc(vault.effectiveAt) > now ||
        vault.monthlyCommitment?.cycleId !== allocation.cycleId ||
        !vault.recipientGithub
      )
        block(
          "Stream is inactive, expired, or lacks a reviewed exact-cycle recipient",
        );
    } else if (vault.kind === "squads-v4-vault") {
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
    } else if (
      vault.replacedAt !== null ||
      utc(vault.effectiveAt) > now ||
      vault.monthlyCommitment.cycleId !== allocation.cycleId ||
      vault.independentGithub.actorId === vault.creatorActorId
    )
      block(
        "Project vault is inactive, expired, or lacks an independent exact-cycle signer",
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
    const { isWalletAddress } = await import("./wallets");
    // On a project vault nothing Slop votes on may pay a Slop address
    // (protocol/project-vault-signing.md step 3).
    const slopAddresses =
      vault.kind === "squads-project-vault"
        ? [vault.slopMember, policy.feeRecipient]
        : [];
    if (
      !isWalletAddress(network, policy.feeRecipient) ||
      policy.feeRecipient === source ||
      intents.some(
        (r) =>
          !r.wallet ||
          r.wallet.address === source ||
          slopAddresses.includes(r.wallet.address),
      )
    )
      block("Invalid payable destinations");
    if (
      evidence.cluster !==
        (network === "base" ? "base-mainnet" : "mainnet-beta") ||
      evidence.commitment !== "finalized" ||
      utc(evidence.observedAt) > now ||
      now - utc(evidence.observedAt) > MAX_OBSERVATION_AGE_MS
    )
      block("Finalized mainnet evidence is absent, future, or stale");
    if (
      evidence.tokenAccount !==
      (vault.kind === "sablier-lockup-v4"
        ? vault.recipient
        : await deriveVaultUsdcTokenAccount(vault.vault))
    )
      throw new TypeError("Observation is not the canonical source account");
    const observation = evidence.accounts as {
      context: unknown;
      value: unknown[];
    };
    let state: { balanceMinor: string };
    let creatorSeat: VerifiedSquadsCreatorSeat | null = null;
    if (vault.kind === "sablier-lockup-v4") {
      // RFC #472, owner decision of 8 October 2026: the recipient must be an
      // EOA (no code), the stream non-cancelable (checked by the verifier) and
      // not canceled, and the recipient's own finalized USDC balance must
      // cover principal plus fee. Once withdrawn, the funds sit in a single
      // key, so the reservation is bookkeeping only.
      state = assertBaseSourceObservation(evidence.accounts, vault);
    } else if (vault.kind === "squads-v4-vault") {
      state = await assertSquadsVaultUsdcState(
        evidence.accounts,
        vault.multisig,
        vault.vault,
        vault.vaultIndex,
        evidence.tokenAccount,
        vault.funderMember,
        vault.stewardMember,
      );
      // Existing funding verifier requires voting. New execution readiness also
      // requires proposer and executor capability across the reviewed members.
      const raw = (observation.value as { data: string[] }[])[0].data[0];
      const config = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      if (
        ((config[164] | config[197]) & 7) !== 7 ||
        config.slice(74, 78).some((b) => b !== 0)
      )
        block(
          "Execution requires proposer and executor roles across the voting members and zero timelock",
        );
    } else {
      // RFC #500: the shape assertion proves masks 7/2/6, threshold 2, and no
      // config authority. The observed time lock must be the reviewed one, and
      // the creator seat must still be the creator's own multisig.
      if (!Array.isArray(observation.value) || observation.value.length !== 3)
        throw new TypeError(
          "Project vault observation must contain the multisig, its USDC account, and the creator multisig",
        );
      const projectVault = await assertSquadsProjectVaultUsdcState(
        { context: observation.context, value: observation.value.slice(0, 2) },
        vault.multisig,
        vault.vault,
        vault.vaultIndex,
        evidence.tokenAccount,
        {
          creatorMember: vault.creatorMember,
          slopMember: vault.slopMember,
          independentMember: vault.independentMember,
        },
      );
      state = projectVault;
      if (projectVault.timeLockSeconds !== vault.timeLockSeconds)
        block("On-chain time lock differs from the reviewed manifest");
      creatorSeat = await assertSquadsCreatorSeat(
        observation.value[2],
        vault.creatorMultisig,
        vault.creatorMember,
        vault.creatorVaultIndex,
      );
    }
    if (vault.kind !== "sablier-lockup-v4") {
      const tokenInfo = (
        observation.value as {
          data: { parsed: { info: Record<string, unknown> } };
        }[]
      )[1].data.parsed.info;
      if (
        tokenInfo.state !== "initialized" ||
        tokenInfo.delegate != null ||
        tokenInfo.closeAuthority != null
      )
        block(
          "Vault USDC account is frozen, delegated, or has a close authority",
        );
    }
    if (money(state.balanceMinor) < principal + sourceFee)
      block(`Finalized USDC balance does not cover ${coverage}`);
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
    if (commitmentVerifiedNetMinor(records) < principal + sourceFee)
      block(`Canonical verified funding does not cover ${coverage}`);
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
    for (const report of reports) {
      if (!signerReportBindsMember(vault, report, creatorSeat))
        throw new TypeError(
          "Signer report member differs from the reviewed instrument",
        );
    }
    if (publicSignerStatus(reports, now) !== currentSignerStatus(instrumentId))
      block(
        vault.kind === "sablier-lockup-v4"
          ? "The authenticated stream recipient must be current; loss or expiry blocks new plans"
          : vault.kind === "squads-v4-vault"
            ? "Both authenticated signers must be current; loss or expiry blocks new plans"
            : "The creator and the independent signer must be current; loss or expiry blocks new plans",
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
        own.feeMinor !== sourceFee.toString() ||
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

/**
 * Validates the quorum-agreed Base source observation from
 * `observeBaseSettlementSource` against the exact reviewed stream.
 */
function assertBaseSourceObservation(
  value: unknown,
  stream: { recipient: string; streamId: string },
): { balanceMinor: string } {
  const o = value as {
    network?: unknown;
    recipient?: unknown;
    recipientCode?: unknown;
    balanceMinor?: unknown;
    stream?: { streamId?: unknown; wasCanceled?: unknown };
  } | null;
  if (
    !o ||
    o.network !== "base" ||
    o.recipient !== stream.recipient ||
    typeof o.balanceMinor !== "string" ||
    !/^(0|[1-9]\d{0,77})$/u.test(o.balanceMinor) ||
    o.stream?.streamId !== stream.streamId
  )
    throw new TypeError("Base source observation is not the reviewed stream");
  if (o.recipientCode !== "0x")
    throw new TypeError(
      "Base stream recipient has contract code; only an EOA source is supported",
    );
  if (o.stream.wasCanceled !== false)
    throw new TypeError("Base stream was canceled");
  return { balanceMinor: o.balanceMinor };
}

/**
 * Binds each signer report to the member it may speak for. On the 2-of-2 each
 * role is one reviewed key. On a project vault the independent signer is one
 * reviewed key, and the creator seat is the creator multisig's vault PDA,
 * which cannot sign: a creator capability report is therefore signed by a key
 * that is a member of the creator multisig with the Initiate permission, and
 * a creator loss report names the seat itself. Slop's vote-only key has no
 * role here (see signer-capability.ts).
 */
function signerReportBindsMember(
  vault: FundingCommitmentInstrument,
  report: PublicSignerReport,
  creatorSeat: VerifiedSquadsCreatorSeat | null,
): boolean {
  if (vault.kind === "sablier-lockup-v4")
    return report.role === "recipient" && report.member === vault.recipient;
  if (vault.kind === "squads-v4-vault") {
    if (report.role === "funder") return report.member === vault.funderMember;
    if (report.role === "steward") return report.member === vault.stewardMember;
    return false;
  }
  if (report.role === "independent")
    return report.member === vault.independentMember;
  if (report.role !== "creator") return false;
  if (report.capability === "lost-access")
    return report.member === vault.creatorMember;
  if (!creatorSeat || report.member === vault.creatorMember) return false;
  return creatorSeat.members.some(
    (member) =>
      member.key === report.member &&
      (member.permissions & SQUADS_PERMISSION_INITIATE) !== 0,
  );
}
