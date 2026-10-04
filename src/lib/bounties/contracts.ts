/** Disabled foundation contracts. Evidence is supplied by trusted local loaders
 * or authenticated adapters, never by accepting authority flags in a request. */
import type { PaymentReservation } from "../payment-reservations";
import type {
  SOLANA_MAINNET_USDC_MINT,
  USDC_DECIMALS,
} from "../settlement-plan";
import type { WalletPossessionChallenge } from "../wallet-possession";

export type ContributionSubject =
  | { kind: "github-user"; actorId: string }
  | { kind: "resident"; residentId: string };

export type EvidenceProvenance =
  | { kind: "local-synthetic"; fixtureId: string }
  | {
      kind: "authenticated-adapter";
      adapterId: string;
      adapterRevision: string;
      sourceDigest: string;
      observedAt: string;
    };

export interface ResidentRevision {
  schemaVersion: "1";
  residentId: string;
  revision: string;
  supersedesRevision: string | null;
  issuer: string;
  issuerResidentId: string;
  controllerActorId: string;
  controllerRevision: string;
  verifiedOrganizationId: string | null;
  authorizedStewardActorId: string;
  githubAppId: string;
  installationIds: readonly string[];
  repositoryIds: readonly string[];
  policyDigest: string;
  display: { name: string; avatarUrl: string | null; controllerLogin: string };
  state: "active" | "suspended" | "revoked";
  effectiveAt: string;
}

export type FeeRule =
  | { kind: "fixed"; amountMinor: string; payer: "funder" | "beneficiary" }
  | {
      kind: "basis-points";
      basisPoints: string;
      rounding: "floor" | "ceil";
      payer: "funder" | "beneficiary";
    };

/** Only complete published terms have this type. Incomplete drafts are unknown
 * input and cannot pass the published terms/funding boundary. */
export interface BountyTerms {
  schemaVersion: "1";
  status: "published";
  bountyId: string;
  projectId: string;
  repositoryId: string;
  publicBriefUrl: string;
  deliverableDigest: string;
  acceptanceDigest: string;
  licenseDigest: string;
  inboundTermsDigest: string;
  eligibleSubjectKinds: readonly ContributionSubject["kind"][];
  principalMinor: string;
  feeRule: FeeRule;
  feeRecipient: string;
  networkCostPolicy: {
    payerActorId: string;
    costSourceId: string;
    maxLamports: string;
    tokenAccountRentLamports: string;
  };
  network: "solana-mainnet";
  mint: typeof SOLANA_MAINNET_USDC_MINT;
  decimals: typeof USDC_DECIMALS;
  sourceInstrumentId: string;
  funders: readonly {
    funderActorId: string;
    sourceInstrumentId: string;
    refundDestination: string;
    refundProofDigest: string;
  }[];
  authority: {
    acceptanceActorIds: readonly string[];
    creatorActorId: string;
    reviewerActorIds: readonly string[];
    disputeActorIds: readonly string[];
    retirementActorIds: readonly string[];
  };
  candidateSelection: {
    kind: "human-ranked";
    criteriaDigest: string;
    decisionDeadline: string;
    requiresMerge: boolean;
  };
  submissionDeadline: string;
  reviewDurationMs: string;
  disputeDurationMs: string;
  targetSettlementAt: string;
  cancellationPolicyDigest: string;
  termsDigest: string;
}

export interface AdmissionNonce {
  nonceId: string;
  residentId: string;
  residentRevision: string;
  controllerActorId: string;
  controllerRevision: string;
  bountyId: string;
  termsDigest: string;
  repositoryId: string;
  runId: string;
  attemptId: string;
  issuedAt: string;
  expiresAt: string;
  acceptedAttestationDigest: string | null;
}

export interface ResidentAttestationV1 {
  schemaVersion: "1";
  audience: "slop.cash/resident-bounty";
  environment: "test" | "production";
  issuer: string;
  keyId: string;
  residentId: string;
  residentRevision: string;
  controllerActorId: string;
  controllerRevision: string;
  runId: string;
  attemptId: string;
  nonceId: string;
  issuedAt: string;
  expiresAt: string;
  projectId: string;
  bountyId: string;
  termsDigest: string;
  repositoryId: string;
  taskDefinitionDigest: string;
  artifactDigests: readonly { artifactId: string; digest: string }[];
  submittedCommit: string;
  prNodeId: string;
  executionResultDigest: string;
  buildEvidenceDigest: string;
  toolPolicyRevision: string;
  publicationManifestDigest: string;
  signature: string;
}

export interface ReviewedResidentPolicy {
  policyDigest: string;
  issuer: string;
  environment: "test" | "production";
  projectIds: readonly string[];
  repositoryIds: readonly string[];
  githubAppIds: readonly string[];
  installationIds: readonly string[];
  toolPolicyRevision: string;
  maxAdmissionLifetimeMs: string;
  effectiveAt: string;
  revokedAt: string | null;
  provenance: EvidenceProvenance;
}
export interface ReviewedAttesterKey {
  issuer: string;
  keyId: string;
  publicKey: Uint8Array;
  policyDigest: string;
  effectiveAt: string;
  revokedAt: string | null;
  provenance: EvidenceProvenance;
}
export interface AuthenticatedController {
  actorId: string;
  revision: string;
  organizationId: string | null;
  authorizedStewardActorId: string;
  residentIds: readonly string[];
  evidenceDigest: string;
  effectiveAt: string;
  provenance: EvidenceProvenance;
}
export interface GitHubSubmissionFacts {
  evidenceDigest: string;
  repositoryId: string;
  prNodeId: string;
  authorActorId: string;
  githubAppId: string;
  installationId: string;
  submittedCommit: string;
  submittedTree: string;
  artifactDigests: ResidentAttestationV1["artifactDigests"];
  observedAt: string;
  provenance: EvidenceProvenance;
}
export interface AcceptedWorkLineage {
  lineageDigest: string;
  repositoryId: string;
  prNodeId: string;
  submittedCommit: string;
  submittedTree: string;
  acceptedCommit: string;
  acceptedTree: string;
  relationship: "unchanged" | "rebase" | "squash" | "maintainer-edits";
  acceptanceActorId: string;
  acceptedAt: string;
  acceptedBuildEvidenceDigest: string | null;
  workBoundaryDigest: string;
  provenance: EvidenceProvenance;
}
export interface TrustedBuildEvidence {
  /** Explicit reviewed criteria binding for required fresh acceptance builds. */
  acceptanceTermsDigest: string | null;
  evidenceDigest: string;
  repositoryId: string;
  commit: string;
  tree: string;
  artifactDigests: ResidentAttestationV1["artifactDigests"];
  toolPolicyRevision: string;
  executionResultDigest: string;
  result: "passed" | "failed";
  observedAt: string;
  provenance: EvidenceProvenance;
}
export interface ReviewedPublicationManifest {
  manifestDigest: string;
  repositoryId: string;
  submittedCommit: string;
  artifactDigests: ResidentAttestationV1["artifactDigests"];
  licenseDigest: string;
  inboundTermsDigest: string;
  publicMetadataReviewDigest: string;
  provenance: EvidenceProvenance;
}

/** A verifier output retains original bytes and independently obtained facts.
 * Pending acceptance is valid submission evidence, never award acceptance. */
export interface VerifiedResidentSubmission {
  attestationDigest: string;
  attestationBytes: Uint8Array;
  residentId: string;
  residentRevision: string;
  controllerActorId: string;
  controllerRevision: string;
  bountyId: string;
  termsDigest: string;
  repositoryId: string;
  prNodeId: string;
  submittedCommit: string;
  submittedTree: string;
  artifactDigests: ResidentAttestationV1["artifactDigests"];
  nonceId: string;
  githubEvidenceDigest: string;
  buildEvidenceDigest: string;
  publicationManifestDigest: string;
  acceptance: AcceptedWorkLineage | null;
  workUnitId: string;
  verifiedAt: string;
  evidenceRevision: string;
}

export interface BeneficiaryInput {
  beneficiaryId: string;
  authenticatedActorId: string;
  residentId: string;
  residentRevision: string;
  controllerRevision: string;
  walletClaimDigest: string;
  walletProofDigest: string;
  destination: string;
  network: "solana-mainnet";
  mint: typeof SOLANA_MAINNET_USDC_MINT;
}
export interface FrozenBeneficiary extends BeneficiaryInput {
  evidenceRevision: string;
  frozenAt: string;
  beneficiaryDigest: string;
}
export interface AuthenticatedWalletClaim {
  claimId: string;
  claimDigest: string;
  authenticatedActorId: string;
  destination: string;
  observedAt: string;
  provenance: EvidenceProvenance;
}
export interface WalletProofEvidence {
  proofDigest: string;
  challenge: WalletPossessionChallenge;
  signature: string;
  authenticatedActorId: string;
  /** Authenticated immutable single-use consumption of this exact challenge,
   * signature, claim and actor. Never a timestamp supplied by the payee. */
  consumedAt: string | null;
  provenance: EvidenceProvenance;
}

/** Reviewed return authorization is separate from mere wallet possession. The
 * retained claim/proof and source observation must resolve exactly; unsupported
 * destination control cannot supply this v1 evidence and remains held. */
export interface ReviewedFunderReturnEvidence {
  proofDigest: string;
  funderActorId: string;
  sourceInstrumentId: string;
  returnDestination: string;
  network: "solana-mainnet";
  mint: typeof SOLANA_MAINNET_USDC_MINT;
  fundingObservationDigest: string;
  sourceControllerConfigurationDigest: string;
  destinationControl: {
    kind: "wallet-possession";
    claim: AuthenticatedWalletClaim;
    proof: WalletProofEvidence;
  };
  reviewPolicyDigest: string;
  reviewedByActorId: string;
  reviewedAt: string;
  effectiveAt: string;
  revokedAt: string | null;
  provenance: EvidenceProvenance;
}

export interface RelationshipDisclosure {
  disclosureDigest: string;
  actorId: string;
  controllerGroupId: string;
  relatedActorIds: readonly string[];
  roles: readonly (
    | "controller"
    | "author"
    | "steward"
    | "creator"
    | "reviewer"
    | "funder"
    | "beneficiary"
  )[];
  reviewedByActorId: string;
  provenance: EvidenceProvenance;
}
export interface HumanDecision {
  resolvedDisputeDigests: readonly string[];
  decisionId: string;
  decisionDigest: string;
  authenticatedActorId: string;
  role:
    | "creator"
    | "reviewer"
    | "acceptance"
    | "dispute"
    | "retirement"
    | "refund";
  policyDigest: string;
  bountyId: string;
  termsDigest: string;
  submissionId: string | null;
  workUnitId: string | null;
  awardDigest: string | null;
  beneficiaryDigest: string | null;
  /** Separate frozen refund projection; never overloaded onto awardDigest. */
  refundProposalDigest: string | null;
  /** Exact reviewed union mapping; independent from economic approval. */
  workEquivalenceDigest: string | null;
  /** Required exact intent binding for retirement authorization. */
  intentId: string | null;
  intentDigest: string | null;
  sourceInstrumentId: string;
  principalMinor: string;
  feeMinor: string;
  decision:
    | "propose"
    | "approve"
    | "reject"
    | "hold"
    | "resolve-dispute"
    | "retire"
    | "refund";
  reasonDigest: string;
  relationshipDisclosureDigest: string;
  decidedAt: string;
  provenance: EvidenceProvenance;
}
export interface AdvisoryReview {
  reviewDigest: string;
  submissionId: string;
  personaId: string;
  findingsDigest: string;
  reviewedAt: string;
}
export interface DisputeEvidence {
  disputeDigest: string;
  bountyId: string;
  submissionId: string;
  authenticatedActorId: string;
  reasonDigest: string;
  raisedAt: string;
  resolvedByDecisionDigest: string | null;
  provenance: EvidenceProvenance;
}

export interface FundingObservation {
  observationDigest: string;
  sourceInstrumentId: string;
  sourceOwner: string;
  instrumentKind: "bounty-squads-v4";
  network: "solana-mainnet";
  mint: typeof SOLANA_MAINNET_USDC_MINT;
  availableMinor: string;
  networkCostSourceId: string;
  /** Actual SOL account identity from trusted funding evidence. */
  networkCostSourceOwner: string;
  availableLamports: string;
  controllerConfigurationDigest: string;
  transactionSignature: string;
  slot: string;
  finality: "finalized" | "confirmed" | "unknown";
  observedAt: string;
  provenance: EvidenceProvenance;
}
export interface LegacyWorkAward {
  workUnitId: string;
  repositoryId: string;
  workBoundaryDigest: string;
  state: "frozen" | "paid";
  allocationDigest: string;
}
export interface WorkEquivalence {
  workUnitIds: readonly string[];
  canonicalWorkUnitId: string;
  mappingDigest: string;
  decisionDigest: string;
}

export interface CapacityReservation {
  capacityReservationId: string;
  bountyId: string;
  termsDigest: string;
  sourceInstrumentId: string;
  fundingObservationDigest: string;
  principalMinor: string;
  feeMinor: string;
  networkCostPolicy: BountyTerms["networkCostPolicy"];
  expectedRevision: string;
  awardId: string | null;
  intentId: string | null;
  status:
    | "reserved"
    | "award-bound"
    | "paid"
    | "refund-bound"
    | "refunded"
    | "retired";
  retirementEvidenceDigest: string | null;
}
export interface WorkReservation {
  workReservationId: string;
  workUnitId: string;
  repositoryId: string;
  workBoundaryDigest: string;
  submissionIds: readonly string[];
  bountyId: string;
  awardId: string | null;
  expectedRevision: string;
  status: "reserved" | "award-bound" | "paid" | "released";
  releaseDecisionDigest: string | null;
}
/** Binds existing backing once; this bundle is never a second monetary debit. */
export interface AwardReservation {
  capacityReservation: CapacityReservation;
  workReservation: WorkReservation;
}
export interface IntentRetirementEvidence {
  retirementDigest: string;
  intentId: string;
  intentDigest: string;
  method: "never-executable" | "on-chain-invalidated";
  controllerConfigurationDigest: string;
  observationDigest: string;
  humanDecisionDigest: string;
  retiredAt: string;
  provenance: EvidenceProvenance;
}
export interface SettlementAttempt {
  attemptId: string;
  intentId: string;
  intentDigest: string;
  bountyId: string;
  awardId: string | null;
  refundDecisionId: string | null;
  capacityReservationId: string;
  sourceInstrumentId: string;
  principalMinor: string;
  feeMinor: string;
  status:
    | "non-executable"
    | "signing-pending"
    | "submitted"
    | "unknown"
    | "partial"
    | "paid"
    | "retired";
  transactionSignatures: readonly string[];
  settlementDigest: string | null;
  retirementEvidenceDigest: string | null;
}

export interface BountyRecord {
  bountyId: string;
  termsDigest: string;
  opportunityStatus:
    | "published-unfunded"
    | "funded-open"
    | "held"
    | "expired"
    | "cancelled"
    | "awarded";
  capacityReservationId: string | null;
  acceptedSubmissionIds: readonly string[];
  winningAwardId: string | null;
}
export interface AuthenticatedBountyCommand {
  admissionDigest: string;
  commandDigest: string;
  authenticatedActorId: string;
  authenticatedAt: string;
  provenance: EvidenceProvenance;
}
export interface AwardSuccessorConsent {
  consentDigest: string;
  authenticatedActorId: string;
  submissionId: string;
  predecessorAwardId: string;
  predecessorAwardDigest: string;
  successorAwardDigest: string;
  acceptedAt: string;
  provenance: EvidenceProvenance;
}
export interface SubmissionRecord {
  decisionDisputeEndsAt: string | null;
  admittedClaimantActorId: string;
  attribution: Pick<
    VerifiedResidentSubmission,
    | "residentId"
    | "residentRevision"
    | "controllerActorId"
    | "controllerRevision"
    | "repositoryId"
    | "prNodeId"
    | "submittedCommit"
    | "submittedTree"
    | "githubEvidenceDigest"
    | "buildEvidenceDigest"
    | "publicationManifestDigest"
  >;
  submissionId: string;
  bountyId: string;
  termsDigest: string;
  subject: ContributionSubject;
  attestationDigest: string;
  lineageDigest: string | null;
  workUnitId: string;
  beneficiary: FrozenBeneficiary;
  submittedAt: string;
  reviewStatus:
    | "submitted"
    | "under-review"
    | "approved"
    | "rejected"
    | "withdrawn"
    | "disputed"
    | "held";
  decisionDigests: readonly string[];
  disputeDigests: readonly string[];
}
export interface AwardRecord {
  acceptedPublicationManifestDigest: string;
  supersedesAwardId: string | null;
  successorConsentDigest: string | null;
  predecessorDecisionDigests: readonly string[];
  awardId: string;
  /** Digest of the frozen proposal projection; later decisions/state are outside
   * this binding, so a decision can name the proposal without a hash cycle. */
  awardDigest: string;
  bountyId: string;
  submissionId: string;
  workUnitId: string;
  /** Exact reviewed acceptance, separate from the original admission evidence. */
  acceptedLineageDigest: string;
  terms: BountyTerms;
  beneficiary: FrozenBeneficiary;
  principalMinor: string;
  feeMinor: string;
  sourceInstrumentId: string;
  capacityReservationId: string;
  intentId: string;
  intentDigest: string;
  requiredHumanDecisionDigests: readonly string[];
  state:
    | "under-review"
    | "approved-reserved"
    | "signing-pending"
    | "submitted"
    | "held"
    | "disputed"
    | "paid"
    | "rejected"
    | "superseded"
    | "withdrawn"
    | "retired";
  proposedAt: string;
  reviewEndsAt: string;
  disputeEndsAt: string;
  approvedAt: string | null;
  paidAt: string | null;
}
export interface RefundDecision {
  decisionId: string;
  bountyId: string;
  termsDigest: string;
  /** Canonical frozen projection excludes authority/evidence references and
   * decision time, preventing cycles with the authenticated human approval. */
  refundProposalDigest: string;
  authorityDecisionDigest: string;
  evidenceDigest: string;
  legs: readonly {
    funderActorId: string;
    sourceInstrumentId: string;
    returnDestination: string;
    amountMinor: string;
    refundProofDigest: string;
  }[];
  feeTreatment: "no-fee" | "remaining-after-paid-fee";
  decidedAt: string;
}

export interface CommandReceipt {
  commandId: string;
  commandDigest: string;
  baseRevision: string;
  resultRevision: string;
  eventIds: readonly string[];
  /** Hash of the resulting domain snapshot, excluding receipts (no recursion). */
  resultDigest: string;
}
export interface BountySnapshot {
  revision: string;
  terms: readonly BountyTerms[];
  bounties: readonly BountyRecord[];
  submissions: readonly SubmissionRecord[];
  awards: readonly AwardRecord[];
  workReservations: readonly WorkReservation[];
  capacityReservations: readonly CapacityReservation[];
  nonces: readonly AdmissionNonce[];
  settlementAttempts: readonly SettlementAttempt[];
  refundDecisions: readonly RefundDecision[];
  receipts: readonly CommandReceipt[];
}
/** Finite replay base and immutable events, never nested TransitionResult
 * snapshots. Replay is reconstructed at the original accepted event prefix. */
export interface BountyState extends BountySnapshot {
  history: { base: BountySnapshot; events: readonly BountyEvent[] };
}

interface CommandBase {
  commandId: string;
  expectedRevision: string;
  actorId: string;
  evidenceDigest: string;
  reason: string;
}
export type BountyCommand = CommandBase &
  (
    | { kind: "publish-terms"; termsDigest: string }
    | {
        kind: "open-funded";
        bountyId: string;
        termsDigest: string;
        fundingObservationDigest: string;
      }
    | { kind: "issue-nonce"; nonce: AdmissionNonce }
    | {
        kind: "submit";
        submissionId: string;
        bountyId: string;
        termsDigest: string;
        attestationDigest: string;
        beneficiaryDigest: string;
        nonceId: string;
      }
    | {
        kind: "propose-decision";
        acceptanceDecisionDigest: string;
        successorDecisionDigests: readonly string[];
        submissionId: string;
        award: AwardRecord;
        decisionDigest: string;
      }
    | { kind: "record-review"; awardId: string; decisionDigest: string }
    | {
        kind: "select-award";
        awardId: string;
        decisionDigests: readonly string[];
      }
    | {
        kind: "reject-submission";
        submissionId: string;
        decisionDigest: string;
      }
    | {
        kind: "withdraw-submission";
        submissionId: string;
        subject: ContributionSubject;
      }
    | {
        kind: "hold";
        bountyId: string;
        submissionId: string | null;
        awardId: string | null;
        disputeDigest: string | null;
      }
    | { kind: "expire-opportunity"; bountyId: string; termsDigest: string }
    | {
        kind: "retire-intent";
        intentId: string;
        intentDigest: string;
        retirementEvidenceDigest: string;
        decisionDigest: string;
      }
    | {
        kind: "reconcile-payment";
        awardId: string;
        intentId: string;
        settlementDigest: string;
      }
    | { kind: "approve-refund"; refund: RefundDecision; decisionDigest: string }
    | {
        kind: "reconcile-refund";
        refundDecisionId: string;
        intentId: string;
        settlementDigest: string;
      }
  );

export interface BountyEventDelta {
  "publish-terms": { terms: BountyTerms; bounty: BountyRecord };
  "open-funded": {
    bounty: BountyRecord;
    capacityReservation: CapacityReservation;
  };
  "issue-nonce": { nonce: AdmissionNonce };
  submit: {
    nonce: AdmissionNonce;
    submission: SubmissionRecord;
    workReservation: WorkReservation;
  };
  "propose-decision": {
    submission: SubmissionRecord;
    award: AwardRecord;
    predecessor: AwardRecord | null;
    terms: BountyTerms;
  };
  "record-review": { submission: SubmissionRecord; award: AwardRecord };
  "select-award":
    | {
        outcome: "selected";
        bounty: BountyRecord;
        submission: SubmissionRecord;
        award: AwardRecord;
        capacityReservation: CapacityReservation;
        workReservation: WorkReservation;
        settlementAttempt: SettlementAttempt;
      }
    | {
        outcome: "held";
        bounty: BountyRecord;
        submission: SubmissionRecord;
        award: AwardRecord;
      };
  "reject-submission": {
    awards: readonly AwardRecord[];
    submission: SubmissionRecord;
    workReservation: WorkReservation | null;
  };
  "withdraw-submission": {
    awards: readonly AwardRecord[];
    submission: SubmissionRecord;
    workReservation: WorkReservation | null;
  };
  hold: {
    bounty: BountyRecord;
    submission: SubmissionRecord | null;
    award: AwardRecord | null;
  };
  "expire-opportunity": { bounty: BountyRecord };
  "retire-intent": {
    settlementAttempt: SettlementAttempt;
    capacityReservation: CapacityReservation;
    award: AwardRecord | null;
  };
  "reconcile-payment": {
    award: AwardRecord;
    settlementAttempt: SettlementAttempt;
    capacityReservation: CapacityReservation;
    workReservation: WorkReservation;
  };
  "approve-refund": {
    refund: RefundDecision;
    settlementAttempt: SettlementAttempt;
    capacityReservation: CapacityReservation;
  };
  "reconcile-refund": {
    refund: RefundDecision;
    settlementAttempt: SettlementAttempt;
    capacityReservation: CapacityReservation;
  };
}
interface EventBase {
  eventId: string;
  commandId: string;
  commandDigest: string;
  previousRevision: string;
  nextRevision: string;
  actorId: string;
  evidenceDigests: readonly string[];
  occurredAt: string;
  reason: string;
  receipt: CommandReceipt;
}
export type BountyEvent = {
  [K in keyof BountyEventDelta]: EventBase & {
    kind: K;
    delta: BountyEventDelta[K];
  };
}[keyof BountyEventDelta];
export interface TransitionResult {
  state: BountyState;
  events: readonly BountyEvent[];
}
export type TransitionErrorCode =
  | "invalid"
  | "unauthorized"
  | "stale-revision"
  | "replay-conflict"
  | "held"
  | "insufficient-funds"
  | "duplicate-work"
  | "unsafe-settlement";
export class TransitionError extends Error {
  constructor(readonly code: TransitionErrorCode) {
    // Fixed messages cannot echo evidence bodies, private context or secrets.
    super(`Bounty transition rejected: ${code}`);
    this.name = "TransitionError";
  }
}

export interface BountySettlementPreview {
  fundingObservationDigest: string;
  schemaVersion: "1";
  kind: "bounty-settlement-preview";
  status: "non-executable";
  bountyId: string;
  awardId: string | null;
  refundDecisionId: string | null;
  intentId: string;
  intentDigest: string;
  previewDigest: string;
  sourceInstrumentId: string;
  sourceOwner: string;
  capacityReservationId: string;
  network: "solana-mainnet";
  mint: typeof SOLANA_MAINNET_USDC_MINT;
  decimals: typeof USDC_DECIMALS;
  legs: readonly {
    obligationId: string;
    kind: "principal" | "fee" | "refund";
    destination: string;
    amountMinor: string;
  }[];
  networkCostPolicy: BountyTerms["networkCostPolicy"];
}
export interface TrustedSettlementObservation {
  observationDigest: string;
  transactionSignature: string;
  network: "solana-mainnet";
  mint: typeof SOLANA_MAINNET_USDC_MINT;
  slot: string;
  finality: "finalized" | "confirmed" | "unknown";
  transaction: unknown;
  observedAt: string;
  provenance: EvidenceProvenance;
}
export interface VerifiedBountySettlement {
  settlementDigest: string;
  previewDigest: string;
  intentId: string;
  intentDigest: string;
  sourceInstrumentId: string;
  principalMinor: string;
  feeMinor: string;
  refundMinor: string;
  observationDigests: readonly string[];
  transactionSignatures: readonly string[];
  slots: readonly string[];
  settledAt: string;
}

export interface EvidenceContext {
  commandAdmissions: readonly AuthenticatedBountyCommand[];
  successorConsents: readonly AwardSuccessorConsent[];
  revision: string;
  now: string;
  environment: "test" | "production";
  provenance: EvidenceProvenance;
  terms: readonly BountyTerms[];
  /** Independently reviewed exact append-only revision ledger, not proposed
   * resident rows accepted from an untrusted request. */
  residents: readonly ResidentRevision[];
  controllers: readonly AuthenticatedController[];
  reviewedPolicies: readonly ReviewedResidentPolicy[];
  reviewedKeys: readonly ReviewedAttesterKey[];
  githubSubmissions: readonly GitHubSubmissionFacts[];
  acceptedLineages: readonly AcceptedWorkLineage[];
  buildEvidence: readonly TrustedBuildEvidence[];
  publicationManifests: readonly ReviewedPublicationManifest[];
  verifiedSubmissions: readonly VerifiedResidentSubmission[];
  beneficiaries: readonly FrozenBeneficiary[];
  humanDecisions: readonly HumanDecision[];
  relationshipDisclosures: readonly RelationshipDisclosure[];
  advisoryReviews: readonly AdvisoryReview[];
  disputes: readonly DisputeEvidence[];
  walletClaims: readonly AuthenticatedWalletClaim[];
  walletProofs: readonly WalletProofEvidence[];
  funderReturnEvidence: readonly ReviewedFunderReturnEvidence[];
  fundingObservations: readonly FundingObservation[];
  legacyReservations: readonly PaymentReservation[];
  legacyWorkAwards: readonly LegacyWorkAward[];
  workEquivalences: readonly WorkEquivalence[];
  retirementEvidence: readonly IntentRetirementEvidence[];
  settlementObservations: readonly TrustedSettlementObservation[];
  verifiedSettlements: readonly VerifiedBountySettlement[];
}

/** Fixture interface; no fixture snapshot constitutes live approval. Later
 * tasks derive verified/approved records through their actual pure modules. */
export interface Scenario {
  terms: BountyTerms;
  residents: readonly ResidentRevision[];
  nonce: AdmissionNonce;
  attestationBytes: Uint8Array;
  /** Funded and nonce-ready, immediately before submission. */
  initialState: BountyState;
  submitCommand: Extract<BountyCommand, { kind: "submit" }>;
  award: AwardRecord;
  approvedState: BountyState;
  context: EvidenceContext;
  contextWithLegacyReservation: EvidenceContext;
  transactionSignature: string;
  stateWithPrivateContext: BountyState & {
    privateContext: {
      prompts: string;
      rawTraces: string;
      credentials: string;
      unapprovedPersona: string;
    };
  };
  privateSentinel: string;
}
