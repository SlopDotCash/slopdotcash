import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { scenario } from "../../../tests/fixtures/bounties/scenario";
import { sha256Hex } from "../sha256";
import { residentWorkUnitId, verifyResidentAttestation } from "./attestations";
import {
  bountyAwardDigest,
  canonicalBountyBytes,
  parseResidentAttestationBytes,
  residentAttestationSigningBytes,
} from "./codec";
import type {
  BountyState,
  BountyTerms,
  EvidenceContext,
  FundingObservation,
  WorkEquivalence,
} from "./contracts";
import {
  assertBountyReservations,
  bindAwardReservation,
  reserveBountyCapacity,
  reserveWorkUnit,
  workEquivalenceDigest,
} from "./reservations";
import { bountyTermsDigest } from "./terms";

async function setup(accepted = false) {
  const f = scenario();
  if (accepted) {
    f.context.now = "2026-10-20T12:01:00.000Z";
    f.nonce.acceptedAttestationDigest = f.submitCommand.attestationDigest;
  }
  const verified = await verifyResidentAttestation(
    f.attestationBytes,
    f.nonce,
    f.context,
  );
  f.context.verifiedSubmissions = [verified];
  return { ...f, verified };
}
async function equivalentSubmission(
  f: Awaited<ReturnType<typeof setup>>,
  prNodeId: string,
) {
  const a = parseResidentAttestationBytes(f.attestationBytes);
  a.prNodeId = prNodeId;
  a.signature = btoa(
    String.fromCharCode(
      ...ed25519.sign(
        residentAttestationSigningBytes(a),
        new Uint8Array(32).fill(17),
      ),
    ),
  );
  const g = { ...f.context.githubSubmissions[0], prNodeId, evidenceDigest: "" };
  const { evidenceDigest: _digest, ...payload } = g;
  g.evidenceDigest = sha256Hex(canonicalBountyBytes(payload));
  f.context.githubSubmissions = [...f.context.githubSubmissions, g];
  const v = await verifyResidentAttestation(
    canonicalBountyBytes(a),
    f.nonce,
    f.context,
  );
  f.context.verifiedSubmissions = [...f.context.verifiedSubmissions, v];
  return v;
}
function observed(o: FundingObservation): FundingObservation {
  const { observationDigest: _digest, ...payload } = o;
  return { ...o, observationDigest: sha256Hex(canonicalBountyBytes(payload)) };
}
function unfunded(state: BountyState): BountyState {
  const copy = structuredClone(state);
  copy.capacityReservations = [];
  copy.bounties = copy.bounties.map((b) => ({
    ...b,
    opportunityStatus: "published-unfunded",
    capacityReservationId: null,
  }));
  return copy;
}
function secondTerms(
  terms: BountyTerms,
  sourceInstrumentId = terms.sourceInstrumentId,
): BountyTerms {
  const t = structuredClone(terms);
  t.bountyId = "bounty-second";
  t.sourceInstrumentId = sourceInstrumentId;
  t.funders = t.funders.map((f) => ({ ...f, sourceInstrumentId }));
  t.termsDigest = bountyTermsDigest(t);
  return t;
}
function addTerms(
  state: BountyState,
  context: EvidenceContext,
  terms: BountyTerms,
): void {
  state.terms = [...state.terms, terms];
  context.terms = [...context.terms, terms];
  state.bounties = [
    ...state.bounties,
    {
      bountyId: terms.bountyId,
      termsDigest: terms.termsDigest,
      opportunityStatus: "published-unfunded",
      capacityReservationId: null,
      acceptedSubmissionIds: [],
      winningAwardId: null,
    },
  ];
}
function mapping(context: EvidenceContext, ids: string[]): WorkEquivalence {
  const m: WorkEquivalence = {
    workUnitIds: ids,
    canonicalWorkUnitId: ids[0],
    mappingDigest: "",
    decisionDigest: "",
  };
  m.mappingDigest = workEquivalenceDigest(m);
  const d = {
    ...context.humanDecisions[1],
    workUnitId: ids[0],
    decisionId: "equivalence-review",
    workEquivalenceDigest: m.mappingDigest,
    decisionDigest: "",
    decidedAt: context.now,
  };
  const { decisionDigest: _digest, ...payload } = d;
  d.decisionDigest = sha256Hex(canonicalBountyBytes(payload));
  m.decisionDigest = d.decisionDigest;
  context.humanDecisions = [...context.humanDecisions, d];
  return m;
}

describe("global bounty economic reservations", () => {
  it("cannot open a bounty on backing already reserved for monthly rewards", () => {
    const f = scenario();
    expect(() =>
      reserveBountyCapacity(
        f.initialState,
        f.terms,
        f.contextWithLegacyReservation,
      ),
    ).toThrow();
  });
  it("funded-open consumes backing immediately and an exact helper retry has no second debit", async () => {
    const f = await setup();
    const state = unfunded(f.initialState);
    const capacity = reserveBountyCapacity(state, f.terms, f.context);
    expect(capacity.principalMinor).toBe("10000000");
    state.capacityReservations = [capacity];
    state.bounties = state.bounties.map((b) => ({
      ...b,
      opportunityStatus: "funded-open",
      capacityReservationId: capacity.capacityReservationId,
    }));
    expect(reserveBountyCapacity(state, f.terms, f.context)).toEqual(capacity);
    const t = secondTerms(f.terms);
    addTerms(state, f.context, t);
    expect(() => reserveBountyCapacity(state, t, f.context)).toThrow();
    expect(state.capacityReservations).toHaveLength(1);
  });
  it("selecting an award binds the exact existing capacity and work without a second debit", async () => {
    const f = await setup(true);
    f.context.revision = f.approvedState.revision;
    f.context.verifiedSubmissions = [
      await verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
    ];
    const state = structuredClone(f.approvedState);
    state.capacityReservations = state.capacityReservations.map((r) => ({
      ...r,
      status: "reserved",
      awardId: null,
      intentId: null,
    }));
    state.workReservations = state.workReservations.map((r) => ({
      ...r,
      status: "reserved",
      awardId: null,
    }));
    state.awards = [];
    state.settlementAttempts = [];
    state.bounties = state.bounties.map((b) => ({
      ...b,
      opportunityStatus: "funded-open",
      winningAwardId: null,
    }));
    const result = bindAwardReservation(state, f.award, f.context);
    expect(result.capacityReservation.capacityReservationId).toBe(
      f.award.capacityReservationId,
    );
    expect(result.capacityReservation.principalMinor).toBe("10000000");
    expect(result.workReservation.awardId).toBe(f.award.awardId);
    expect(state.capacityReservations[0].awardId).toBeNull();
  });
  it.each(["held", "disputed"])(
    "prewinner %s proposals preserve unbound reservations but selected obligations cannot lose bindings",
    async (status) => {
      const f = await setup(true);
      f.context.revision = f.approvedState.revision;
      const state = structuredClone(f.approvedState);
      state.bounties = state.bounties.map((b) => ({
        ...b,
        opportunityStatus: "held",
        winningAwardId: null,
      }));
      state.capacityReservations = state.capacityReservations.map((c) => ({
        ...c,
        status: "reserved",
        awardId: null,
        intentId: null,
      }));
      state.workReservations = state.workReservations.map((w) => ({
        ...w,
        status: "reserved",
        awardId: null,
      }));
      state.awards = state.awards.map((a) => ({
        ...a,
        state: status as "held" | "disputed",
      }));
      state.settlementAttempts = [];
      expect(() => assertBountyReservations(state, f.context)).not.toThrow();
      state.bounties = state.bounties.map((b) => ({
        ...b,
        winningAwardId: f.award.awardId,
      }));
      expect(() => assertBountyReservations(state, f.context)).toThrow();
    },
  );
  it("pending admission stays frozen while refreshed exact acceptance binds the award and work boundary", async () => {
    const f = await setup();
    const originalSubmission = {
      ...structuredClone(f.approvedState.submissions[0]),
      lineageDigest: null,
    };
    const pending = reserveWorkUnit(f.initialState, f.verified, f.context);
    const state = structuredClone(f.initialState);
    state.submissions = [originalSubmission];
    state.workReservations = [
      { ...pending, submissionIds: [originalSubmission.submissionId] },
    ];
    const before = structuredClone(state);
    expect(() => assertBountyReservations(state, f.context)).not.toThrow();
    f.context.now = "2026-10-20T12:01:00.000Z";
    f.nonce.acceptedAttestationDigest = f.verified.attestationDigest;
    const accepted = await verifyResidentAttestation(
      f.attestationBytes,
      f.nonce,
      f.context,
    );
    f.context.verifiedSubmissions = [accepted];
    if (!accepted.acceptance)
      throw new Error("Expected refreshed exact acceptance");
    const award = {
      ...f.award,
      acceptedLineageDigest: accepted.acceptance.lineageDigest,
    };
    award.awardDigest = bountyAwardDigest(award);
    const bound = bindAwardReservation(state, award, f.context);
    expect(bound.workReservation.workBoundaryDigest).toBe(
      accepted.acceptance.workBoundaryDigest,
    );
    expect(state).toEqual(before);
    state.awards = [award];
    state.capacityReservations = [bound.capacityReservation];
    state.workReservations = [bound.workReservation];
    state.bounties = state.bounties.map((b) => ({
      ...b,
      opportunityStatus: "awarded",
      winningAwardId: award.awardId,
    }));
    state.settlementAttempts = [
      structuredClone(f.approvedState.settlementAttempts[0]),
    ];
    expect(() => assertBountyReservations(state, f.context)).not.toThrow();
    expect(state.submissions[0].lineageDigest).toBeNull();
    expect(state.history).toEqual(before.history);
    const wrong = { ...award, acceptedLineageDigest: "f".repeat(64) };
    wrong.awardDigest = bountyAwardDigest(wrong);
    expect(() => bindAwardReservation(before, wrong, f.context)).toThrow();
  });
  it.each(["principal", "fee", "intent", "beneficiary", "source", "terms"])(
    "rejects changed %s in an award binding",
    async (field) => {
      const f = await setup(true);
      f.context.revision = f.approvedState.revision;
      const a = structuredClone(f.award);
      if (field === "principal") a.principalMinor = "9999999";
      if (field === "fee") a.feeMinor = "0";
      if (field === "intent") a.intentId = "different-intent";
      if (field === "beneficiary")
        a.beneficiary.destination = f.terms.feeRecipient;
      if (field === "source") a.sourceInstrumentId = "different-source";
      if (field === "terms") a.terms = secondTerms(a.terms);
      expect(() =>
        bindAwardReservation(f.approvedState, a, f.context),
      ).toThrow();
    },
  );
  it.each(["unknown", "confirmed"])(
    "refuses %s funding evidence",
    async (finality) => {
      const f = await setup();
      f.context.fundingObservations = f.context.fundingObservations.map((o) =>
        observed({ ...o, finality: finality as "unknown" | "confirmed" }),
      );
      expect(() =>
        reserveBountyCapacity(unfunded(f.initialState), f.terms, f.context),
      ).toThrow();
    },
  );
  it.each(["USDC", "SOL", "rent"])(
    "requires backing for the complete %s obligation",
    async (kind) => {
      const f = await setup();
      f.context.fundingObservations = f.context.fundingObservations.map((o) =>
        observed({
          ...o,
          availableMinor: kind === "USDC" ? "10000000" : o.availableMinor,
          availableLamports:
            kind === "SOL"
              ? "0"
              : kind === "rent"
                ? "2039279"
                : o.availableLamports,
        }),
      );
      expect(() =>
        reserveBountyCapacity(unfunded(f.initialState), f.terms, f.context),
      ).toThrow();
    },
  );
  it("aggregates canonical instrument aliases over the same actual vault", async () => {
    const f = await setup();
    const parts = f.terms.sourceInstrumentId.split(":");
    parts[3] = "1";
    const t = secondTerms(f.terms, parts.join(":"));
    addTerms(f.initialState, f.context, t);
    f.context.fundingObservations = [
      ...f.context.fundingObservations,
      observed({
        ...f.context.fundingObservations[0],
        sourceInstrumentId: t.sourceInstrumentId,
      }),
    ];
    expect(() => reserveBountyCapacity(f.initialState, t, f.context)).toThrow(
      "insufficient-funds",
    );
    const legacy = structuredClone(f.contextWithLegacyReservation);
    legacy.legacyReservations[0].instrumentId = t.sourceInstrumentId;
    expect(() =>
      reserveBountyCapacity(f.initialState, f.terms, legacy),
    ).toThrow();
  });
  it("distinct USDC vaults sharing one physical SOL account cannot double-reserve its balance", async () => {
    const f = await setup();
    const t = secondTerms(
      f.terms,
      `squads-v4-vault:solana:${f.terms.feeRecipient}:0:${f.terms.feeRecipient}`,
    );
    t.networkCostPolicy.costSourceId = "another-label-for-same-SOL-account";
    t.termsDigest = bountyTermsDigest(t);
    addTerms(f.initialState, f.context, t);
    f.context.fundingObservations = [
      ...f.context.fundingObservations,
      observed({
        ...f.context.fundingObservations[0],
        sourceInstrumentId: t.sourceInstrumentId,
        sourceOwner: f.terms.feeRecipient,
        networkCostSourceId: t.networkCostPolicy.costSourceId,
      }),
    ];
    expect(() => reserveBountyCapacity(f.initialState, t, f.context)).toThrow(
      "insufficient-funds",
    );
    f.context.fundingObservations = [
      f.context.fundingObservations[0],
      observed({
        ...f.context.fundingObservations[1],
        networkCostSourceOwner: f.terms.feeRecipient,
      }),
    ];
    expect(() =>
      reserveBountyCapacity(f.initialState, t, f.context),
    ).not.toThrow();
  });
  it("rejects a caller-selected source label or observation whose owner differs from its vault", async () => {
    const f = await setup();
    const t = secondTerms(f.terms, "caller-selected-alias");
    addTerms(f.initialState, f.context, t);
    f.context.fundingObservations = [
      ...f.context.fundingObservations,
      {
        ...f.context.fundingObservations[0],
        sourceInstrumentId: t.sourceInstrumentId,
      },
    ];
    expect(() => reserveBountyCapacity(f.initialState, t, f.context)).toThrow();
    f.context.fundingObservations = [
      {
        ...f.context.fundingObservations[0],
        sourceOwner: f.terms.feeRecipient,
      },
    ];
    expect(() => assertBountyReservations(f.initialState, f.context)).toThrow();
  });
  it("a newer balance observation alone cannot roll forward consumed backing", async () => {
    const f = await setup();
    const t = secondTerms(f.terms);
    addTerms(f.initialState, f.context, t);
    f.context.fundingObservations = [
      ...f.context.fundingObservations,
      {
        ...f.context.fundingObservations[0],
        observationDigest: "b".repeat(64),
        availableMinor: "20200000",
        slot: "1001",
      },
    ];
    expect(() => reserveBountyCapacity(f.initialState, t, f.context)).toThrow();
  });
  it.each([
    "held",
    "disputed",
    "signing-pending",
    "submitted",
    "unknown",
    "partial",
    "paid",
  ])("retains backing while obligations are %s", async (status) => {
    const f = await setup(true);
    const state = structuredClone(f.approvedState);
    f.context.revision = state.revision;
    f.context.now = "2026-10-20T12:01:00.000Z";
    if (status === "held" || status === "disputed")
      state.awards = state.awards.map((a) => ({ ...a, state: status }));
    else
      state.settlementAttempts = state.settlementAttempts.map((a) => ({
        ...a,
        status: status as
          | "signing-pending"
          | "submitted"
          | "unknown"
          | "partial"
          | "paid",
      }));
    const t = secondTerms(f.terms);
    addTerms(state, f.context, t);
    expect(() => reserveBountyCapacity(state, t, f.context)).toThrow();
  });
  it("status-only retirement and refunds cannot release backing or overdraw a refund", async () => {
    const f = await setup();
    f.context.revision = f.approvedState.revision;
    const retired = structuredClone(f.approvedState);
    retired.capacityReservations = retired.capacityReservations.map((r) => ({
      ...r,
      status: "retired",
      retirementEvidenceDigest: "c".repeat(64),
    }));
    retired.settlementAttempts = retired.settlementAttempts.map((a) => ({
      ...a,
      status: "retired",
      retirementEvidenceDigest: "c".repeat(64),
    }));
    expect(() => assertBountyReservations(retired, f.context)).toThrow();
    const refund = structuredClone(f.approvedState);
    refund.settlementAttempts = [
      ...refund.settlementAttempts,
      {
        ...refund.settlementAttempts[0],
        attemptId: "refund-attempt",
        intentId: "refund-intent",
        awardId: null,
        refundDecisionId: "refund",
        principalMinor: "1",
        feeMinor: "0",
      },
    ];
    expect(() => assertBountyReservations(refund, f.context)).toThrow();
  });
  it("exact authorized never-executable retirement releases unused capacity while protected claims prevent release", async () => {
    const f = await setup(true);
    const state = structuredClone(f.approvedState);
    f.context.revision = state.revision;
    state.submissions = state.submissions.map((s) => ({
      ...s,
      reviewStatus: "withdrawn",
    }));
    state.awards = state.awards.map((a) => ({ ...a, state: "retired" }));
    state.workReservations = state.workReservations.map((w) => ({
      ...w,
      status: "reserved",
      awardId: null,
    }));
    const d = {
      ...f.context.humanDecisions[1],
      decisionId: "retirement-approval",
      decisionDigest: "",
      authenticatedActorId: "303",
      role: "retirement" as const,
      decision: "retire" as const,
      intentId: f.award.intentId,
      intentDigest: f.award.intentDigest,
      decidedAt: f.context.now,
    };
    const { decisionDigest: _decision, ...decisionPayload } = d;
    d.decisionDigest = sha256Hex(canonicalBountyBytes(decisionPayload));
    f.context.humanDecisions = [...f.context.humanDecisions, d];
    const e = {
      retirementDigest: "",
      intentId: f.award.intentId,
      intentDigest: f.award.intentDigest,
      method: "never-executable" as const,
      controllerConfigurationDigest:
        f.context.fundingObservations[0].controllerConfigurationDigest,
      observationDigest: f.context.fundingObservations[0].observationDigest,
      humanDecisionDigest: d.decisionDigest,
      retiredAt: f.context.now,
      provenance: f.context.provenance,
    };
    const { retirementDigest: _retirement, ...retirementPayload } = e;
    e.retirementDigest = sha256Hex(canonicalBountyBytes(retirementPayload));
    f.context.retirementEvidence = [e];
    state.capacityReservations = state.capacityReservations.map((r) => ({
      ...r,
      status: "retired",
      retirementEvidenceDigest: e.retirementDigest,
    }));
    state.settlementAttempts = state.settlementAttempts.map((a) => ({
      ...a,
      status: "retired",
      retirementEvidenceDigest: e.retirementDigest,
    }));
    const t = secondTerms(f.terms);
    addTerms(state, f.context, t);
    expect(() => reserveBountyCapacity(state, t, f.context)).not.toThrow();
    state.submissions = state.submissions.map((s) => ({
      ...s,
      reviewStatus: "disputed",
    }));
    expect(() => reserveBountyCapacity(state, t, f.context)).toThrow(
      "unsafe-settlement",
    );
    state.submissions = state.submissions.map((s) => ({
      ...s,
      reviewStatus: "withdrawn",
    }));
    state.settlementAttempts = state.settlementAttempts.map((a) => ({
      ...a,
      status: "unknown",
    }));
    expect(() => reserveBountyCapacity(state, t, f.context)).toThrow(
      "unsafe-settlement",
    );
  });
  it("refund amounts cannot exceed unencumbered capacity and refund-bound backing remains consumed", async () => {
    const f = await setup();
    const state = structuredClone(f.initialState);
    const capacity = state.capacityReservations[0];
    state.capacityReservations = [
      { ...capacity, status: "refund-bound", intentId: "refund-intent" },
    ];
    state.refundDecisions = [
      {
        decisionId: "refund",
        bountyId: f.terms.bountyId,
        termsDigest: f.terms.termsDigest,
        refundProposalDigest: "b".repeat(64),
        authorityDecisionDigest: "c".repeat(64),
        evidenceDigest: "d".repeat(64),
        legs: [
          {
            ...f.terms.funders[0],
            funderActorId: f.terms.funders[0].funderActorId,
            returnDestination: f.terms.funders[0].refundDestination,
            amountMinor: "10100000",
          },
        ],
        feeTreatment: "no-fee",
        decidedAt: f.context.now,
      },
    ];
    state.settlementAttempts = [
      {
        attemptId: "refund-attempt",
        intentId: "refund-intent",
        intentDigest: "a".repeat(64),
        bountyId: f.terms.bountyId,
        awardId: null,
        refundDecisionId: "refund",
        capacityReservationId: capacity.capacityReservationId,
        sourceInstrumentId: f.terms.sourceInstrumentId,
        principalMinor: "10100000",
        feeMinor: "0",
        status: "non-executable",
        transactionSignatures: [],
        settlementDigest: null,
        retirementEvidenceDigest: null,
      },
    ];
    expect(() => assertBountyReservations(state, f.context)).not.toThrow();
    state.refundDecisions = state.refundDecisions.map((r) => ({
      ...r,
      legs: r.legs.map((l) => ({ ...l, amountMinor: "10100001" })),
    }));
    state.settlementAttempts = state.settlementAttempts.map((r) => ({
      ...r,
      principalMinor: "10100001",
    }));
    expect(() => assertBountyReservations(state, f.context)).toThrow(
      "insufficient-funds",
    );
    state.refundDecisions = state.refundDecisions.map((r) => ({
      ...r,
      legs: r.legs.map((l) => ({ ...l, amountMinor: "10100000" })),
    }));
    state.settlementAttempts = state.settlementAttempts.map((r) => ({
      ...r,
      principalMinor: "10100000",
    }));
    const t = secondTerms(f.terms);
    addTerms(state, f.context, t);
    expect(() => reserveBountyCapacity(state, t, f.context)).toThrow(
      "insufficient-funds",
    );
  });
  it("verified submission reserves work before acceptance, without inventing a submission ID", async () => {
    const f = await setup();
    const r = reserveWorkUnit(f.initialState, f.verified, f.context);
    expect(r.workUnitId).toBe(
      residentWorkUnitId(f.terms.repositoryId, f.verified.prNodeId),
    );
    expect(r.submissionIds).toEqual([]);
    expect(r.awardId).toBeNull();
    expect(f.initialState.workReservations).toEqual([]);
  });
  it("unauthenticated or edited verifier outputs cannot reserve someone else's work", async () => {
    const f = await setup();
    expect(() =>
      reserveWorkUnit(f.initialState, f.verified, {
        ...f.context,
        verifiedSubmissions: [],
      }),
    ).toThrow();
    expect(() =>
      reserveWorkUnit(
        f.initialState,
        { ...f.verified, residentId: "resident-b" },
        f.context,
      ),
    ).toThrow();
    expect(() =>
      reserveWorkUnit(
        f.initialState,
        { ...f.verified, workUnitId: "f".repeat(64) },
        f.context,
      ),
    ).toThrow();
  });
  it.each(["frozen", "paid"])(
    "blocks %s monthly work regardless of bounty/resident/cycle labels",
    async (state) => {
      const f = await setup();
      f.context.legacyWorkAwards = [
        {
          workUnitId: f.verified.workUnitId,
          repositoryId: f.verified.repositoryId,
          workBoundaryDigest: "d".repeat(64),
          state: state as "frozen" | "paid",
          allocationDigest: "e".repeat(64),
        },
      ];
      expect(() =>
        reserveWorkUnit(f.initialState, f.verified, f.context),
      ).toThrow();
    },
  );
  it("cross-bounty ownership and paid work cannot be evaded by association labels", async () => {
    const f = await setup();
    const r = reserveWorkUnit(f.initialState, f.verified, f.context);
    f.initialState.workReservations = [
      { ...r, bountyId: "bounty-other", submissionIds: ["other-submission"] },
    ];
    expect(() =>
      reserveWorkUnit(f.initialState, f.verified, f.context),
    ).toThrow();
    f.initialState.workReservations = [
      { ...r, status: "paid", submissionIds: ["already-paid"] },
    ];
    expect(() =>
      reserveWorkUnit(f.initialState, f.verified, f.context),
    ).toThrow();
  });
  it("reviewed equivalence retains transitive paid conflicts and rejects naked or tampered mappings", async () => {
    const f = await setup();
    const b = (await equivalentSubmission(f, "PR_equivalent_b")).workUnitId;
    const c = (await equivalentSubmission(f, "PR_equivalent_c")).workUnitId;
    f.context.legacyWorkAwards = [
      {
        workUnitId: c,
        repositoryId: "9001",
        workBoundaryDigest: "d".repeat(64),
        state: "paid",
        allocationDigest: "e".repeat(64),
      },
    ];
    const ab = mapping(f.context, [f.verified.workUnitId, b]);
    const bc = mapping(f.context, [b, c]);
    f.context.workEquivalences = [ab, bc];
    expect(() =>
      reserveWorkUnit(f.initialState, f.verified, f.context),
    ).toThrow();
    f.context.legacyWorkAwards = [];
    expect(() =>
      reserveWorkUnit(f.initialState, f.verified, f.context),
    ).not.toThrow();
    f.context.workEquivalences = [{ ...ab, canonicalWorkUnitId: c }];
    expect(() =>
      reserveWorkUnit(f.initialState, f.verified, f.context),
    ).toThrow();
    f.context.workEquivalences = [
      { ...ab, decisionDigest: f.context.humanDecisions[0].decisionDigest },
    ];
    expect(() =>
      reserveWorkUnit(f.initialState, f.verified, f.context),
    ).toThrow();
  });
  it.each(["payment", "refund"])(
    "orphaned unknown %s attempts reject accounting and new capacity",
    async (kind) => {
      const f = await setup();
      const state = unfunded(f.initialState);
      state.settlementAttempts = [
        {
          ...structuredClone(f.approvedState.settlementAttempts[0]),
          status: "unknown",
          awardId: kind === "payment" ? f.award.awardId : null,
          refundDecisionId: kind === "refund" ? "orphan-refund" : null,
        },
      ];
      expect(() => assertBountyReservations(state, f.context)).toThrow();
      expect(() => reserveBountyCapacity(state, f.terms, f.context)).toThrow();
      const associated = await setup(true);
      associated.context.revision = associated.approvedState.revision;
      expect(() =>
        assertBountyReservations(associated.approvedState, associated.context),
      ).not.toThrow();
    },
  );
  it("payment and refund attempts require exactly one valid economic association", async () => {
    const f = await setup();
    const state = structuredClone(f.initialState);
    const a = structuredClone(f.approvedState.settlementAttempts[0]);
    state.capacityReservations = state.capacityReservations.map((c) => ({
      ...c,
      status: "award-bound",
      intentId: a.intentId,
    }));
    state.settlementAttempts = [
      { ...a, awardId: null, refundDecisionId: null },
    ];
    expect(() => assertBountyReservations(state, f.context)).toThrow();
    state.settlementAttempts = [
      { ...a, awardId: null, refundDecisionId: "missing-refund" },
    ];
    expect(() => assertBountyReservations(state, f.context)).toThrow();
    const selected = await setup(true);
    selected.context.revision = selected.approvedState.revision;
    selected.approvedState.settlementAttempts =
      selected.approvedState.settlementAttempts.map((a) => ({
        ...a,
        refundDecisionId: "also-a-refund",
      }));
    expect(() =>
      assertBountyReservations(selected.approvedState, selected.context),
    ).toThrow();
  });
  it("persisted reservations require real submission references and exact revision proposals", async () => {
    const f = await setup();
    const r = reserveWorkUnit(f.initialState, f.verified, f.context);
    expect(() =>
      assertBountyReservations(
        { ...f.initialState, workReservations: [r] },
        f.context,
      ),
    ).toThrow();
    expect(() =>
      reserveBountyCapacity(f.initialState, f.terms, {
        ...f.context,
        revision: "1",
      }),
    ).toThrow();
    expect(() =>
      reserveWorkUnit(f.initialState, f.verified, {
        ...f.context,
        revision: "1",
      }),
    ).toThrow();
  });
  it("local compare-and-swap accepts only one of two capacity proposals from the same revision", async () => {
    const f = await setup();
    let stored = unfunded(f.initialState);
    const a = reserveBountyCapacity(stored, f.terms, f.context);
    const b = reserveBountyCapacity(stored, f.terms, f.context);
    function commit(proposal: typeof a): boolean {
      if (proposal.expectedRevision !== stored.revision) return false;
      stored = {
        ...stored,
        revision: (BigInt(stored.revision) + 1n).toString(),
        capacityReservations: [proposal],
        bounties: stored.bounties.map((row) => ({
          ...row,
          opportunityStatus: "funded-open",
          capacityReservationId: proposal.capacityReservationId,
        })),
      };
      return true;
    }
    expect(commit(a)).toBe(true);
    expect(commit(b)).toBe(false);
    expect(stored.capacityReservations).toHaveLength(1);
    expect(() => reserveBountyCapacity(stored, f.terms, f.context)).toThrow();
  });
});
