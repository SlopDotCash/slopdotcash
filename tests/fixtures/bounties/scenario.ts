/** Entirely synthetic local evidence. Numeric actor/repository IDs and public
 * keys below have no connection to a live GitHub account or payment authority.
 * Keys are disposable fixed test seeds, never production signing material. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { residentWorkUnitId } from "../../../src/lib/bounties/attestations";
import {
  bountyAwardDigest,
  bountyPaymentPreview,
  canonicalBountyBytes,
  residentAttestationSigningBytes,
} from "../../../src/lib/bounties/codec";
import type {
  AcceptedWorkLineage,
  AdmissionNonce,
  AwardRecord,
  BountySnapshot,
  BountyState,
  BountyTerms,
  EvidenceContext,
  FrozenBeneficiary,
  FundingObservation,
  GitHubSubmissionFacts,
  ResidentAttestationV1,
  ResidentRevision,
  ReviewedFunderReturnEvidence,
  ReviewedPublicationManifest,
  ReviewedResidentPolicy,
  Scenario,
  TrustedBuildEvidence,
} from "../../../src/lib/bounties/contracts";
import { freezeBeneficiary } from "../../../src/lib/bounties/residents";
import {
  assertBountyTerms,
  bountyTermsDigest,
} from "../../../src/lib/bounties/terms";
import {
  SOLANA_MAINNET_USDC_MINT,
  USDC_DECIMALS,
} from "../../../src/lib/settlement-plan";
import { sha256Hex } from "../../../src/lib/sha256";
import { walletPossessionMessage } from "../../../src/lib/wallet-possession";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leading = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    leading += "1";
  }
  return (
    leading +
    digits
      .reverse()
      .map((d) => BASE58[d])
      .join("")
  );
}
const base64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));
const digest = (label: string): string =>
  sha256Hex(`synthetic-resident-bounty:${label}`);
function recordDigest(value: object, selfField: string): string {
  const payload = { ...value } as Record<string, unknown>;
  delete payload[selfField];
  return sha256Hex(canonicalBountyBytes(payload));
}
function state(snapshot: BountySnapshot): BountyState {
  return {
    ...structuredClone(snapshot),
    history: { base: structuredClone(snapshot), events: [] },
  };
}

/** A fresh graph each call, with independently copied history/evidence/snapshots.
 * Task 1 supplies raw synthetic facts; later verifiers populate their outputs.
 * approvedState is an explicit synthetic phase snapshot, not a live approval. */
export function scenario(): Scenario {
  const provenance = {
    kind: "local-synthetic",
    fixtureId: "resident-bounty-v1",
  } as const;
  const issuedAt = "2026-09-30T12:00:00.000Z";
  const now = "2026-09-30T12:01:00.000Z";
  const expiresAt = "2026-10-02T12:00:00.000Z";
  const policy: ReviewedResidentPolicy = {
    policyDigest: "",
    issuer: "synthetic-p3ts",
    environment: "test",
    projectIds: ["synthetic-project"],
    repositoryIds: ["9001"],
    githubAppIds: ["7001"],
    installationIds: ["8001"],
    toolPolicyRevision: "synthetic-tools-v1",
    maxAdmissionLifetimeMs: "172800000",
    effectiveAt: "2026-09-29T12:00:00.000Z",
    revokedAt: null,
    provenance,
  };
  policy.policyDigest = recordDigest(policy, "policyDigest");
  const policyDigest = policy.policyDigest;
  const attesterSeed = new Uint8Array(32).fill(17);
  const walletSeed = new Uint8Array(32).fill(23);
  const destination = base58(ed25519.getPublicKey(walletSeed));
  const sourceSeed = new Uint8Array(32).fill(31);
  const sourceOwner = base58(ed25519.getPublicKey(sourceSeed));
  const feeRecipient = base58(
    ed25519.getPublicKey(new Uint8Array(32).fill(37)),
  );
  const sourceInstrumentId = `squads-v4-vault:solana:${sourceOwner}:0:${sourceOwner}`;
  const transactionSignature = base58(new Uint8Array(64).fill(43));
  const sourceControllerConfigurationDigest = digest(
    "independent-external-signers",
  );
  const fundingObservation: FundingObservation = {
    observationDigest: "",
    sourceInstrumentId,
    sourceOwner,
    instrumentKind: "bounty-squads-v4",
    network: "solana-mainnet",
    mint: SOLANA_MAINNET_USDC_MINT,
    availableMinor: "10100000",
    networkCostSourceId: "synthetic-sol-cost-source",
    networkCostSourceOwner: sourceOwner,
    availableLamports: "2044280",
    controllerConfigurationDigest: sourceControllerConfigurationDigest,
    transactionSignature,
    slot: "1000",
    finality: "finalized",
    observedAt: issuedAt,
    provenance,
  };
  fundingObservation.observationDigest = recordDigest(
    fundingObservation,
    "observationDigest",
  );
  const observationDigest = fundingObservation.observationDigest;
  const returnSeed = new Uint8Array(32).fill(47);
  const returnOwner = base58(ed25519.getPublicKey(returnSeed));
  const returnChallenge = {
    kind: "slop-wallet-possession",
    schemaVersion: "1",
    audience: "slop.cash",
    challengeId: "f".repeat(32),
    claimId: "synthetic-funder-return-claim",
    githubActorId: "401",
    address: returnOwner,
    issuedAt,
    expiresAt: "2026-09-30T12:15:00.000Z",
  } as const;
  const returnSignature = base64(
    ed25519.sign(
      new TextEncoder().encode(walletPossessionMessage(returnChallenge)),
      returnSeed,
    ),
  );
  const returnProofInput: ReviewedFunderReturnEvidence = {
    proofDigest: "",
    funderActorId: "401",
    sourceInstrumentId,
    returnDestination: returnOwner,
    network: "solana-mainnet",
    mint: SOLANA_MAINNET_USDC_MINT,
    fundingObservationDigest: observationDigest,
    sourceControllerConfigurationDigest,
    destinationControl: {
      kind: "wallet-possession",
      claim: {
        claimId: returnChallenge.claimId,
        claimDigest: digest("authenticated-funder-return-claim"),
        authenticatedActorId: "401",
        destination: returnOwner,
        observedAt: issuedAt,
        provenance,
      },
      proof: {
        proofDigest: sha256Hex(
          canonicalBountyBytes({
            challenge: returnChallenge,
            signature: returnSignature,
          }),
        ),
        challenge: returnChallenge,
        signature: returnSignature,
        authenticatedActorId: "401",
        consumedAt: "2026-09-30T12:00:15.000Z",
        provenance,
      },
    },
    reviewPolicyDigest: policyDigest,
    reviewedByActorId: "303",
    reviewedAt: "2026-09-30T12:00:30.000Z",
    effectiveAt: "2026-09-30T12:00:30.000Z",
    revokedAt: null,
    provenance,
  };
  const funderReturnEvidence: ReviewedFunderReturnEvidence = {
    ...returnProofInput,
    proofDigest: recordDigest(returnProofInput, "proofDigest"),
  };
  const refundProofDigest = funderReturnEvidence.proofDigest;
  const termsInput = {
    schemaVersion: "1",
    status: "published",
    bountyId: "bounty-synthetic-a",
    projectId: "synthetic-project",
    repositoryId: "9001",
    publicBriefUrl: "https://example.invalid/synthetic/bounty-a",
    deliverableDigest: digest("deliverable"),
    acceptanceDigest: digest("acceptance"),
    licenseDigest: digest("license"),
    inboundTermsDigest: digest("inbound"),
    eligibleSubjectKinds: ["resident", "github-user"],
    principalMinor: "10000000",
    feeRule: { kind: "fixed", amountMinor: "100000", payer: "funder" },
    feeRecipient,
    networkCostPolicy: {
      payerActorId: "401",
      costSourceId: "synthetic-sol-cost-source",
      maxLamports: "5000",
      tokenAccountRentLamports: "2039280",
    },
    network: "solana-mainnet",
    mint: SOLANA_MAINNET_USDC_MINT,
    decimals: USDC_DECIMALS,
    sourceInstrumentId,
    funders: [
      {
        funderActorId: "401",
        sourceInstrumentId,
        refundDestination: returnOwner,
        refundProofDigest,
      },
    ],
    authority: {
      acceptanceActorIds: ["301"],
      creatorActorId: "301",
      reviewerActorIds: ["302"],
      disputeActorIds: ["303"],
      retirementActorIds: ["303"],
    },
    candidateSelection: {
      kind: "human-ranked",
      criteriaDigest: digest("comparison-criteria"),
      decisionDeadline: "2026-10-03T12:00:00.000Z",
      requiresMerge: true,
    },
    submissionDeadline: expiresAt,
    reviewDurationMs: "1209600000",
    disputeDurationMs: "259200000",
    targetSettlementAt: "2026-10-21T12:00:00.000Z",
    cancellationPolicyDigest: digest("cancellation-remedies"),
    termsDigest: "",
  };
  const terms: BountyTerms = assertBountyTerms({
    ...termsInput,
    termsDigest: bountyTermsDigest(termsInput),
  });
  const residents: ResidentRevision[] = ["a", "b"].map((suffix, i) => ({
    schemaVersion: "1",
    residentId: `resident-${suffix}`,
    revision: "1",
    supersedesRevision: null,
    issuer: "synthetic-p3ts",
    issuerResidentId: `synthetic-pet-${suffix}`,
    controllerActorId: String(101 + i),
    controllerRevision: "1",
    verifiedOrganizationId: null,
    authorizedStewardActorId: String(101 + i),
    githubAppId: "7001",
    installationIds: ["8001"],
    repositoryIds: ["9001"],
    policyDigest,
    display: {
      name: `Synthetic resident ${suffix.toUpperCase()}`,
      avatarUrl: null,
      controllerLogin: `synthetic-controller-${suffix}`,
    },
    state: "active",
    effectiveAt: "2026-09-29T12:00:00.000Z",
  }));
  const nonce: AdmissionNonce = {
    nonceId: "nonce-synthetic-a",
    residentId: "resident-a",
    residentRevision: "1",
    controllerActorId: "101",
    controllerRevision: "1",
    bountyId: terms.bountyId,
    termsDigest: terms.termsDigest,
    repositoryId: "9001",
    runId: "run-synthetic-a",
    attemptId: "attempt-synthetic-a",
    issuedAt,
    expiresAt,
    acceptedAttestationDigest: null,
  };
  const submittedCommit = "a".repeat(40);
  const submittedTree = "b".repeat(40);
  const artifactDigests = [
    { artifactId: "synthetic-artifact", digest: digest("public-artifact") },
  ];
  const executionResultDigest = digest("execution-result");
  const submittedBuild: TrustedBuildEvidence = {
    acceptanceTermsDigest: null,
    evidenceDigest: "",
    repositoryId: "9001",
    commit: submittedCommit,
    tree: submittedTree,
    artifactDigests: structuredClone(artifactDigests),
    toolPolicyRevision: "synthetic-tools-v1",
    executionResultDigest,
    result: "passed",
    observedAt: issuedAt,
    provenance,
  };
  submittedBuild.evidenceDigest = recordDigest(
    submittedBuild,
    "evidenceDigest",
  );
  const buildEvidenceDigest = submittedBuild.evidenceDigest;
  const publicationManifest: ReviewedPublicationManifest = {
    manifestDigest: "",
    repositoryId: "9001",
    submittedCommit,
    artifactDigests: structuredClone(artifactDigests),
    licenseDigest: terms.licenseDigest,
    inboundTermsDigest: terms.inboundTermsDigest,
    publicMetadataReviewDigest: digest("public-content-review"),
    provenance,
  };
  publicationManifest.manifestDigest = recordDigest(
    publicationManifest,
    "manifestDigest",
  );
  const publicationManifestDigest = publicationManifest.manifestDigest;
  const unsigned: ResidentAttestationV1 = {
    schemaVersion: "1",
    audience: "slop.cash/resident-bounty",
    environment: "test",
    issuer: "synthetic-p3ts",
    keyId: "test-attester-1",
    residentId: "resident-a",
    residentRevision: "1",
    controllerActorId: "101",
    controllerRevision: "1",
    runId: nonce.runId,
    attemptId: nonce.attemptId,
    nonceId: nonce.nonceId,
    issuedAt,
    expiresAt,
    projectId: terms.projectId,
    bountyId: terms.bountyId,
    termsDigest: terms.termsDigest,
    repositoryId: "9001",
    taskDefinitionDigest: terms.deliverableDigest,
    artifactDigests,
    submittedCommit,
    prNodeId: "PR_synthetic_a",
    executionResultDigest,
    buildEvidenceDigest,
    toolPolicyRevision: "synthetic-tools-v1",
    publicationManifestDigest,
    signature: base64(new Uint8Array(64)),
  };
  const attestation = {
    ...unsigned,
    signature: base64(
      ed25519.sign(residentAttestationSigningBytes(unsigned), attesterSeed),
    ),
  };
  const attestationBytes = canonicalBountyBytes(attestation);
  const githubSubmission: GitHubSubmissionFacts = {
    evidenceDigest: "",
    repositoryId: "9001",
    prNodeId: attestation.prNodeId,
    authorActorId: "7002",
    githubAppId: "7001",
    installationId: "8001",
    submittedCommit,
    submittedTree,
    artifactDigests: structuredClone(artifactDigests),
    observedAt: now,
    provenance,
  };
  githubSubmission.evidenceDigest = recordDigest(
    githubSubmission,
    "evidenceDigest",
  );
  // Original attestation digest covers complete canonical wire bytes, signature included.
  const attestationDigest = sha256Hex(attestationBytes);
  const challenge = {
    kind: "slop-wallet-possession",
    schemaVersion: "1",
    audience: "slop.cash",
    challengeId: "e".repeat(32),
    claimId: "synthetic-wallet-claim",
    githubActorId: "101",
    address: destination,
    issuedAt,
    expiresAt: "2026-09-30T12:15:00.000Z",
  } as const;
  const walletSignature = base64(
    ed25519.sign(
      new TextEncoder().encode(walletPossessionMessage(challenge)),
      walletSeed,
    ),
  );
  const walletClaimDigest = digest("authenticated-public-wallet-claim");
  const walletProofDigest = sha256Hex(
    canonicalBountyBytes({ challenge, signature: walletSignature }),
  );
  const beneficiaryInput = {
    beneficiaryId: "beneficiary-synthetic-a",
    authenticatedActorId: "101",
    residentId: "resident-a",
    residentRevision: "1",
    controllerRevision: "1",
    walletClaimDigest,
    walletProofDigest,
    destination,
    network: "solana-mainnet",
    mint: SOLANA_MAINNET_USDC_MINT,
    evidenceRevision: "2",
    frozenAt: now,
    beneficiaryDigest: "",
  } as const;
  const beneficiary: FrozenBeneficiary = {
    ...beneficiaryInput,
    beneficiaryDigest: recordDigest(beneficiaryInput, "beneficiaryDigest"),
  };
  const workUnitId = residentWorkUnitId("9001", "PR_synthetic_a");
  const capacityReservationId = "capacity-synthetic-a";
  const intentId = "intent-synthetic-a";
  let intentDigest = "";
  const acceptedAt = "2026-10-03T11:00:00.000Z";
  const acceptedManifest = {
    ...structuredClone(publicationManifest),
    submittedCommit: "c".repeat(40),
  };
  acceptedManifest.manifestDigest = recordDigest(
    acceptedManifest,
    "manifestDigest",
  );
  const acceptedLineage: AcceptedWorkLineage = {
    lineageDigest: "",
    repositoryId: "9001",
    prNodeId: attestation.prNodeId,
    submittedCommit,
    submittedTree,
    acceptedCommit: "c".repeat(40),
    acceptedTree: submittedTree,
    relationship: "unchanged",
    acceptanceActorId: "301",
    acceptedAt,
    acceptedBuildEvidenceDigest: buildEvidenceDigest,
    workBoundaryDigest: digest("reviewed-work-boundary"),
    provenance,
  };
  acceptedLineage.lineageDigest = recordDigest(
    acceptedLineage,
    "lineageDigest",
  );
  const lineageDigest = acceptedLineage.lineageDigest;
  const awardInput: AwardRecord = {
    acceptedPublicationManifestDigest: acceptedManifest.manifestDigest,
    supersedesAwardId: null,
    successorConsentDigest: null,
    predecessorDecisionDigests: [],
    awardId: "award-synthetic-a",
    awardDigest: "",
    bountyId: terms.bountyId,
    submissionId: "submission-synthetic-a",
    workUnitId,
    acceptedLineageDigest: lineageDigest,
    terms: structuredClone(terms),
    beneficiary: structuredClone(beneficiary),
    principalMinor: "10000000",
    feeMinor: "100000",
    sourceInstrumentId,
    capacityReservationId,
    intentId,
    intentDigest,
    requiredHumanDecisionDigests: [
      digest("creator-decision"),
      digest("reviewer-decision"),
    ],
    state: "approved-reserved",
    proposedAt: "2026-10-03T12:00:00.000Z",
    reviewEndsAt: "2026-10-17T12:00:00.000Z",
    disputeEndsAt: "2026-10-20T12:00:00.000Z",
    approvedAt: "2026-10-20T12:01:00.000Z",
    paidAt: null,
  };
  const capacityReservation = {
    capacityReservationId,
    bountyId: terms.bountyId,
    termsDigest: terms.termsDigest,
    sourceInstrumentId,
    fundingObservationDigest: observationDigest,
    principalMinor: "10000000",
    feeMinor: "100000",
    networkCostPolicy: structuredClone(terms.networkCostPolicy),
    expectedRevision: "0",
    awardId: null,
    intentId: null,
    status: "reserved",
    retirementEvidenceDigest: null,
  } as const;
  intentDigest = bountyPaymentPreview(
    awardInput,
    capacityReservation,
    fundingObservation,
  ).intentDigest;
  awardInput.intentDigest = intentDigest;
  const award = { ...awardInput, awardDigest: bountyAwardDigest(awardInput) };
  const initialSnapshot: BountySnapshot = {
    revision: "2",
    terms: [structuredClone(terms)],
    bounties: [
      {
        bountyId: terms.bountyId,
        termsDigest: terms.termsDigest,
        opportunityStatus: "funded-open",
        capacityReservationId,
        acceptedSubmissionIds: [],
        winningAwardId: null,
      },
    ],
    submissions: [],
    awards: [],
    workReservations: [],
    capacityReservations: [capacityReservation],
    nonces: [structuredClone(nonce)],
    settlementAttempts: [],
    refundDecisions: [],
    receipts: [],
  };
  const initialState = state(initialSnapshot);
  const approvedSnapshot: BountySnapshot = {
    ...structuredClone(initialSnapshot),
    revision: "7",
    bounties: [
      {
        ...initialSnapshot.bounties[0],
        opportunityStatus: "awarded",
        acceptedSubmissionIds: [award.submissionId],
        winningAwardId: award.awardId,
      },
    ],
    submissions: [
      {
        decisionDisputeEndsAt: null,
        admittedClaimantActorId: "101",
        attribution: {
          residentId: "resident-a",
          residentRevision: "1",
          controllerActorId: "101",
          controllerRevision: "1",
          repositoryId: "9001",
          prNodeId: attestation.prNodeId,
          submittedCommit,
          submittedTree,
          githubEvidenceDigest: githubSubmission.evidenceDigest,
          buildEvidenceDigest,
          publicationManifestDigest,
        },
        submissionId: award.submissionId,
        bountyId: terms.bountyId,
        termsDigest: terms.termsDigest,
        subject: { kind: "resident", residentId: "resident-a" },
        attestationDigest,
        lineageDigest,
        workUnitId,
        beneficiary: structuredClone(beneficiary),
        submittedAt: now,
        reviewStatus: "approved",
        decisionDigests: [...award.requiredHumanDecisionDigests],
        disputeDigests: [],
      },
    ],
    awards: [structuredClone(award)],
    capacityReservations: [
      {
        ...structuredClone(capacityReservation),
        awardId: award.awardId,
        intentId,
        status: "award-bound",
      },
    ],
    workReservations: [
      {
        workReservationId: "work-reservation-synthetic-a",
        workUnitId,
        repositoryId: "9001",
        workBoundaryDigest: digest("reviewed-work-boundary"),
        submissionIds: [award.submissionId],
        bountyId: terms.bountyId,
        awardId: award.awardId,
        expectedRevision: "2",
        status: "award-bound",
        releaseDecisionDigest: null,
      },
    ],
    nonces: [
      {
        ...structuredClone(nonce),
        acceptedAttestationDigest: attestationDigest,
      },
    ],
    settlementAttempts: [
      {
        attemptId: "settlement-attempt-synthetic-a",
        intentId,
        intentDigest,
        bountyId: terms.bountyId,
        awardId: award.awardId,
        refundDecisionId: null,
        capacityReservationId,
        sourceInstrumentId,
        principalMinor: "10000000",
        feeMinor: "100000",
        status: "non-executable",
        transactionSignatures: [],
        settlementDigest: null,
        retirementEvidenceDigest: null,
      },
    ],
  };
  const context: EvidenceContext = {
    commandAdmissions: [],
    successorConsents: [],
    revision: "2",
    now,
    environment: "test",
    provenance,
    terms: [structuredClone(terms)],
    residents: structuredClone(residents),
    controllers: residents.map((r) => ({
      actorId: r.controllerActorId,
      revision: "1",
      organizationId: null,
      authorizedStewardActorId: r.authorizedStewardActorId,
      residentIds: [r.residentId],
      evidenceDigest: digest(`controller-${r.controllerActorId}`),
      effectiveAt: r.effectiveAt,
      provenance,
    })),
    reviewedPolicies: [structuredClone(policy)],
    reviewedKeys: [
      {
        issuer: "synthetic-p3ts",
        keyId: "test-attester-1",
        publicKey: ed25519.getPublicKey(attesterSeed),
        policyDigest,
        effectiveAt: "2026-09-29T12:00:00.000Z",
        revokedAt: null,
        provenance,
      },
    ],
    githubSubmissions: [structuredClone(githubSubmission)],
    acceptedLineages: [structuredClone(acceptedLineage)],
    buildEvidence: [structuredClone(submittedBuild)],
    publicationManifests: [
      structuredClone(publicationManifest),
      structuredClone(acceptedManifest),
    ],
    verifiedSubmissions: [],
    beneficiaries: [structuredClone(beneficiary)],
    humanDecisions: ["301", "302"].map((actorId, i) => ({
      resolvedDisputeDigests: [],
      decisionId: `decision-${actorId}`,
      decisionDigest: award.requiredHumanDecisionDigests[i],
      authenticatedActorId: actorId,
      role: i === 0 ? "creator" : "reviewer",
      policyDigest,
      bountyId: terms.bountyId,
      termsDigest: terms.termsDigest,
      submissionId: award.submissionId,
      workUnitId,
      awardDigest: award.awardDigest,
      beneficiaryDigest: beneficiary.beneficiaryDigest,
      refundProposalDigest: null,
      workEquivalenceDigest: null,
      intentId: null,
      intentDigest: null,
      sourceInstrumentId,
      principalMinor: "10000000",
      feeMinor: "100000",
      decision: "approve",
      reasonDigest: digest(`reason-${actorId}`),
      relationshipDisclosureDigest: digest(`disclosure-${actorId}`),
      decidedAt: "2026-10-20T12:00:00.000Z",
      provenance,
    })),
    relationshipDisclosures: ["101", "102", "301", "302", "303", "401"].map(
      (actorId) => ({
        disclosureDigest: digest(`disclosure-${actorId}`),
        actorId,
        controllerGroupId: `synthetic-group-${actorId}`,
        relatedActorIds: [],
        roles:
          actorId === "101"
            ? ["controller", "author", "beneficiary"]
            : actorId === "102"
              ? ["controller"]
              : actorId === "301"
                ? ["steward", "creator"]
                : actorId === "302" || actorId === "303"
                  ? ["reviewer"]
                  : ["funder"],
        reviewedByActorId: "303",
        provenance,
      }),
    ),
    advisoryReviews: [
      {
        reviewDigest: digest("alice-advisory"),
        submissionId: award.submissionId,
        personaId: "synthetic-public-alice",
        findingsDigest: digest("advisory-findings"),
        reviewedAt: acceptedAt,
      },
    ],
    disputes: [],
    walletClaims: [
      {
        claimId: challenge.claimId,
        claimDigest: walletClaimDigest,
        authenticatedActorId: "101",
        destination,
        observedAt: issuedAt,
        provenance,
      },
      structuredClone(funderReturnEvidence.destinationControl.claim),
    ],
    walletProofs: [
      {
        proofDigest: walletProofDigest,
        challenge,
        signature: walletSignature,
        authenticatedActorId: "101",
        consumedAt: now,
        provenance,
      },
      structuredClone(funderReturnEvidence.destinationControl.proof),
    ],
    funderReturnEvidence: [structuredClone(funderReturnEvidence)],
    fundingObservations: [structuredClone(fundingObservation)],
    legacyReservations: [],
    legacyWorkAwards: [],
    workEquivalences: [],
    retirementEvidence: [],
    settlementObservations: [],
    verifiedSettlements: [],
  };
  // Derive the usable beneficiary evidence through the real verifier. Earlier
  // phase snapshots retain the same deterministic frozen value and digests.
  const {
    evidenceRevision: _revision,
    frozenAt: _frozenAt,
    beneficiaryDigest: _beneficiaryDigest,
    ...binding
  } = beneficiary;
  context.beneficiaries = [
    freezeBeneficiary(binding, { ...context, beneficiaries: [] }),
  ];
  const contextWithLegacyReservation = structuredClone(context);
  contextWithLegacyReservation.legacyReservations = [
    {
      schemaVersion: "1",
      kind: "payment-reservation",
      projectId: "synthetic-monthly-project",
      cycleId: "2026-09",
      instrumentId: sourceInstrumentId,
      allocationSha256: digest("legacy-allocation"),
      policySha256: digest("legacy-policy"),
      planSha256: digest("legacy-plan"),
      reservedAt: issuedAt,
      principalMinor: "1",
      feeMinor: "0",
      intentIds: ["legacy-monthly-intent"],
    },
  ];
  const privateSentinel = "SYNTHETIC_PRIVATE_CONTEXT_MUST_NEVER_BE_PUBLIC";
  return structuredClone({
    terms,
    residents,
    nonce,
    attestationBytes,
    initialState,
    submitCommand: {
      kind: "submit",
      commandId: "submit-command-synthetic-a",
      expectedRevision: "2",
      actorId: "101",
      evidenceDigest: attestationDigest,
      reason: "Synthetic verified submission",
      submissionId: award.submissionId,
      bountyId: terms.bountyId,
      termsDigest: terms.termsDigest,
      attestationDigest,
      beneficiaryDigest: beneficiary.beneficiaryDigest,
      nonceId: nonce.nonceId,
    },
    award,
    approvedState: state(approvedSnapshot),
    context,
    contextWithLegacyReservation,
    transactionSignature,
    stateWithPrivateContext: {
      ...state(approvedSnapshot),
      privateContext: {
        prompts: privateSentinel,
        rawTraces: privateSentinel,
        credentials: privateSentinel,
        unapprovedPersona: privateSentinel,
      },
    },
    privateSentinel,
  });
}
