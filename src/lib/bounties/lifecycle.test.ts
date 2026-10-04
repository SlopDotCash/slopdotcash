import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { scenario } from "../../../tests/fixtures/bounties/scenario";
import { sha256Hex } from "../sha256";
import { verifyResidentAttestation } from "./attestations";
import {
  bountyAwardDigest,
  bountyCommandDigest,
  bountyDisputeDigest,
  bountyPaymentPreview,
  bountyRefundPreview,
  bountyRefundProposalDigest,
  canonicalBountyBytes,
  parseResidentAttestationBytes,
  residentAttestationSigningBytes,
} from "./codec";
import type {
  AwardRecord,
  BountyCommand,
  BountyState,
  BountyTerms,
  EvidenceContext,
  HumanDecision,
  RefundDecision,
} from "./contracts";
import { applyBountyCommand, foldBountyEvents } from "./lifecycle";
import { assertBountyReservations } from "./reservations";
import { freezeBeneficiary } from "./residents";
import { bountyTermsDigest } from "./terms";

function required<T>(value:T|undefined):T { if(value===undefined)throw new Error("Missing synthetic test evidence");return value; }
const hash = (x: unknown) => sha256Hex(canonicalBountyBytes(x));
function admit(command: BountyCommand, context: EvidenceContext) {
  const payload = {
    commandDigest: bountyCommandDigest(command),
    authenticatedActorId: command.actorId,
    authenticatedAt: context.now,
    provenance: context.provenance,
  };
  context.commandAdmissions = [{ ...payload, admissionDigest: hash(payload) }];
}
async function setup() {
  const f = scenario();
  f.context.verifiedSubmissions = [
    await verifyResidentAttestation(f.attestationBytes, f.nonce, f.context),
  ];
  admit(f.submitCommand, f.context);
  return f;
}
function withdraw(state: BountyState, context: EvidenceContext): BountyCommand {
  const s = state.submissions[0];
  const c: BountyCommand = {
    kind: "withdraw-submission",
    commandId: "withdraw-a",
    expectedRevision: state.revision,
    actorId: "101",
    evidenceDigest: s.attestationDigest,
    reason: "Claimant withdraws",
    submissionId: s.submissionId,
    subject: s.subject,
  };
  context.revision = state.revision;
  admit(c, context);
  return c;
}
describe("reviewed bounty lifecycle", () => {
  it("replays an accepted command without a second economic effect", async () => {
    const f = await setup();
    const first = applyBountyCommand(
      f.initialState,
      f.submitCommand,
      f.context,
    );
    expect(applyBountyCommand(first.state, f.submitCommand, f.context)).toEqual(
      first,
    );
    expect(first.state.nonces[0].acceptedAttestationDigest).toBe(
      f.submitCommand.attestationDigest,
    );
    expect(first.state.submissions[0].attribution.controllerActorId).toBe(
      "101",
    );
    expect(first.state.workReservations[0].submissionIds).toEqual([
      f.submitCommand.submissionId,
    ]);
    expect(f.initialState.nonces[0].acceptedAttestationDigest).toBeNull();
  });
  it("replays the original prefix after later commands, ignoring expired current evidence", async () => {
    const f = await setup();
    const first = applyBountyCommand(
      f.initialState,
      f.submitCommand,
      f.context,
    );
    const later = applyBountyCommand(
      first.state,
      withdraw(first.state, f.context),
      f.context,
    );
    f.context.now = "2030-01-01T00:00:00.000Z";
    f.context.commandAdmissions = [];
    expect(applyBountyCommand(later.state, f.submitCommand, f.context)).toEqual(
      first,
    );
    expect(() =>
      applyBountyCommand(
        later.state,
        { ...f.submitCommand, reason: "changed bytes" },
        f.context,
      ),
    ).toThrow("replay-conflict");
  });
  it("folds exact events without mutating history and rejects a forged result digest", async () => {
    const f = await setup();
    const first = applyBountyCommand(
      f.initialState,
      f.submitCommand,
      f.context,
    );
    const copy = structuredClone(first.events);
    expect(foldBountyEvents(f.initialState, first.events)).toEqual(first.state);
    expect(first.events).toEqual(copy);
    const bad = structuredClone(first.events);
    bad[0].receipt.resultDigest = "0".repeat(64);
    expect(() => foldBountyEvents(f.initialState, bad)).toThrow();
    expect(first.events).toEqual(copy);
  });
  it("rejects stale revision without consuming admission or reserving work", async () => {
    const f = await setup();
    const before = structuredClone(f.initialState);
    const command = { ...f.submitCommand, expectedRevision: "1" };
    admit(command, f.context);
    expect(() =>
      applyBountyCommand(f.initialState, command, f.context),
    ).toThrow("stale-revision");
    expect(f.initialState).toEqual(before);
  });
  it("does not authenticate an actor string or mismatched command admission", async () => {
    const f = await setup();
    const impostor = { ...f.submitCommand, actorId: "102" };
    expect(() =>
      applyBountyCommand(f.initialState, impostor, f.context),
    ).toThrow("unauthorized");
    admit(impostor, f.context);
    expect(() =>
      applyBountyCommand(f.initialState, impostor, f.context),
    ).toThrow("unauthorized");
  });
  it("retains backing and original attribution on losing withdrawal", async () => {
    const f = await setup();
    const first = applyBountyCommand(
      f.initialState,
      f.submitCommand,
      f.context,
    );
    const next = applyBountyCommand(
      first.state,
      withdraw(first.state, f.context),
      f.context,
    );
    expect(next.state.bounties).toEqual(first.state.bounties);
    expect(next.state.capacityReservations).toEqual(
      first.state.capacityReservations,
    );
    expect(next.state.workReservations).toEqual(first.state.workReservations);
    expect(next.state.submissions[0].reviewStatus).toBe("withdrawn");
    expect(next.state.submissions[0].beneficiary).toEqual(
      first.state.submissions[0].beneficiary,
    );
  });
  it("rejects receipts whose original result predates the replay base", async () => {
    const f = await setup();
    const first = applyBountyCommand(
      f.initialState,
      f.submitCommand,
      f.context,
    );
    const { history: _history, ...base } = first.state;
    const orphan = { ...base, history: { base, events: [] } };
    expect(() =>
      applyBountyCommand(orphan, f.submitCommand, f.context),
    ).toThrow();
  });
});

function run(state: BountyState, command: BountyCommand, c: EvidenceContext) {
  c.revision = state.revision;
  admit(command, c);
  return applyBountyCommand(state, command, c).state;
}
function base(
  state: BountyState,
  _c: EvidenceContext,
  id: string,
  actorId = "301",
) {
  return {
    commandId: id,
    expectedRevision: state.revision,
    actorId,
    evidenceDigest: hash(id),
    reason: id,
  };
}
function human(
  f: Awaited<ReturnType<typeof setup>>,
  a: AwardRecord,
  role: HumanDecision["role"],
  value: HumanDecision["decision"],
  actorId = role === "reviewer" ? "302" : "301",
  t = a.terms,
) {
  const d: HumanDecision = {
    ...f.context.humanDecisions[0],
    resolvedDisputeDigests: value === "resolve-dispute" ? f.context.disputes.filter(d=>d.submissionId===a.submissionId).map(d=>d.disputeDigest) : [],
    decisionId: `${role}-${value}-${a.awardId}-${f.context.now}-${actorId}`,
    decisionDigest: "",
    authenticatedActorId: actorId,
    role,
    decision: value,
    termsDigest: t.termsDigest,
    bountyId: a.bountyId,
    submissionId: a.submissionId,
    workUnitId: a.workUnitId,
    awardDigest: a.awardDigest,
    beneficiaryDigest: a.beneficiary.beneficiaryDigest,
    sourceInstrumentId: a.sourceInstrumentId,
    principalMinor: a.principalMinor,
    feeMinor: a.feeMinor,
    relationshipDisclosureDigest:
      f.context.relationshipDisclosures.find((d) => d.actorId === actorId)
        ?.disclosureDigest ?? hash("absent"),
    decidedAt: f.context.now,
  };
  const { decisionDigest: _digest, ...payload } = d;
  d.decisionDigest = hash(payload);
  f.context.humanDecisions = [...f.context.humanDecisions, d];
  return d;
}
function proposal(
  f: Awaited<ReturnType<typeof setup>>,
  state: BountyState,
  overrides: Partial<AwardRecord> = {},
) {
  const c = f.context;
  const a: AwardRecord = {
    ...structuredClone(f.award),
    state: "under-review",
    approvedAt: null,
    paidAt: null,
    requiredHumanDecisionDigests: [],
    predecessorDecisionDigests: [],
    proposedAt: c.now,
    reviewEndsAt: new Date(
      Date.parse(c.now) + Number(f.terms.reviewDurationMs),
    ).toISOString(),
    disputeEndsAt: new Date(
      Date.parse(c.now) +
        Number(f.terms.reviewDurationMs) +
        Number(f.terms.disputeDurationMs),
    ).toISOString(),
    ...overrides,
  };
  a.intentDigest = bountyPaymentPreview(
    a,
    state.capacityReservations[0],
    c.fundingObservations[0],
  ).intentDigest;
  a.awardDigest = bountyAwardDigest(a);
  return a;
}
async function submitted() {
  const f = await setup();
  const state = applyBountyCommand(
    f.initialState,
    f.submitCommand,
    f.context,
  ).state;
  f.context.now = "2026-10-03T12:00:00.000Z";
  f.context.revision = state.revision;
  f.context.verifiedSubmissions = [
    await verifyResidentAttestation(
      f.attestationBytes,
      state.nonces[0],
      f.context,
    ),
  ];
  return { ...f, state };
}
function propose(
  f: Awaited<ReturnType<typeof setup>>,
  state: BountyState,
  a = proposal(f, state),
  successorDecisionDigests: readonly string[] = [],
) {
  const accepted = human(
      f,
      a,
      "acceptance",
      "approve",
      a.terms.authority.acceptanceActorIds[0],
    ),
    d = human(f, a, "creator", "propose");
  return run(
    state,
    {
      ...base(state, f.context, `propose-${a.awardId}`),
      kind: "propose-decision",
      submissionId: a.submissionId,
      award: a,
      decisionDigest: d.decisionDigest,
      acceptanceDecisionDigest: accepted.decisionDigest,
      successorDecisionDigests,
    },
    f.context,
  );
}
function approve(
  f: Awaited<ReturnType<typeof setup>>,
  state: BountyState,
  a = required(state.awards.at(-1)),
) {
  f.context.now = a.disputeEndsAt;
  for (const role of ["creator", "reviewer"] as const) {
    const d = human(f, a, role, "approve");
    state = run(
      state,
      {
        ...base(
          state,
          f.context,
          `record-${d.decisionId}`,
          d.authenticatedActorId,
        ),
        kind: "record-review",
        awardId: a.awardId,
        decisionDigest: d.decisionDigest,
      },
      f.context,
    );
  }
  const current = required(state.awards.find((x) => x.awardId === a.awardId));
  return run(
    state,
    {
      ...base(state, f.context, `select-${a.awardId}`),
      kind: "select-award",
      awardId: a.awardId,
      decisionDigests: current.requiredHumanDecisionDigests,
    },
    f.context,
  );
}
describe("human review, immutable successors and single winner", () => {
  it("requires exact human acceptance and both financial approvals before converting capacity once", async () => {
    const f = await submitted();
    const pending = propose(f, f.state);
    const paidReady = approve(f, pending);
    expect(paidReady.bounties[0].winningAwardId).toBe(f.award.awardId);
    expect(paidReady.awards[0].state).toBe("approved-reserved");
    expect(paidReady.capacityReservations).toHaveLength(1);
    expect(paidReady.capacityReservations[0].principalMinor).toBe(
      f.initialState.capacityReservations[0].principalMinor,
    );
    expect(paidReady.submissions[0].lineageDigest).toBeNull();
    expect(paidReady.workReservations[0].workBoundaryDigest).toBe(
      f.context.verifiedSubmissions[0].acceptance?.workBoundaryDigest,
    );
    expect(foldBountyEvents(f.initialState, paidReady.history.events)).toEqual(
      paidReady,
    );
    const retry = {
      ...base(paidReady, f.context, "second-winner"),
      kind: "select-award" as const,
      awardId: f.award.awardId,
      decisionDigests: paidReady.awards[0].requiredHumanDecisionDigests,
    };
    expect(() => run(paidReady, retry, f.context)).toThrow();
  });
  it("creator silence commits a held escalation without approval or new economic effect", async () => {
    const f = await submitted();
    const pending = propose(f, f.state);
    f.context.now = pending.awards[0].disputeEndsAt;
    const held = run(
      pending,
      {
        ...base(pending, f.context, "silent-creator", "302"),
        kind: "select-award",
        awardId: f.award.awardId,
        decisionDigests: pending.awards[0].requiredHumanDecisionDigests,
      },
      f.context,
    );
    expect(held.awards[0].state).toBe("held");
    expect(held.bounties[0].opportunityStatus).toBe("held");
    expect(held.settlementAttempts).toEqual([]);
    expect(held.capacityReservations).toEqual(pending.capacityReservations);
  });
  it("Alice, owner and related reviewers cannot supply independent approval", async () => {
    const f = await submitted();
    const pending = propose(f, f.state),
      a = pending.awards[0];
    f.context.now = a.disputeEndsAt;
    const advisory = {
      ...base(pending, f.context, "alice-review"),
      kind: "record-review" as const,
      awardId: a.awardId,
      decisionDigest: f.context.advisoryReviews[0].reviewDigest,
    };
    expect(() => run(pending, advisory, f.context)).toThrow("unauthorized");
    const owner = human(f, a, "reviewer", "approve", "101");
    expect(() =>
      run(
        pending,
        {
          ...advisory,
          ...base(pending, f.context, "owner", "101"),
          decisionDigest: owner.decisionDigest,
        },
        f.context,
      ),
    ).toThrow("unauthorized");
    f.context.relationshipDisclosures = f.context.relationshipDisclosures.map(
      (d) => (d.actorId === "302" ? { ...d, relatedActorIds: ["101"] } : d),
    );
    const related = human(f, a, "reviewer", "approve");
    expect(() =>
      run(
        pending,
        {
          ...advisory,
          ...base(pending, f.context, "related", "302"),
          decisionDigest: related.decisionDigest,
        },
        f.context,
      ),
    ).toThrow("unauthorized");
  });
  it("a different accepted lineage or manifest cannot reuse a proposed award's approvals", async () => {
    const f = await submitted();
    const pending = propose(f, f.state);
    const next = {
      ...f.context.acceptedLineages[0],
      acceptedCommit: "d".repeat(40),
      lineageDigest: "",
    };
    const { lineageDigest: _d, ...payload } = next;
    next.lineageDigest = hash(payload);
    f.context.acceptedLineages = [next];
    expect(() => approve(f, pending)).toThrow();
    const g = await submitted(),
      a = proposal(g, g.state, {
        acceptedPublicationManifestDigest:
          g.context.publicationManifests[0].manifestDigest,
      });
    expect(() => propose(g, g.state, a)).toThrow("held");
  });
  it("a consented beneficiary successor resets both windows and preserves original submission and backing", async () => {
    const f = await submitted();
    let state = propose(f, f.state);
    const old = state.awards[0];
    f.context.now = "2026-10-04T12:00:00.000Z";
    f.context.revision = state.revision;
    const {
      beneficiaryDigest: _b,
      evidenceRevision: _r,
      frozenAt: _t,
      ...input
    } = old.beneficiary;
    const ben = freezeBeneficiary(
      { ...input, beneficiaryId: "explicit-successor-beneficiary" },
      f.context,
    );
    f.context.beneficiaries = [...f.context.beneficiaries, ben];
    const a = proposal(f, state, {
      awardId: "successor-a",
      intentId: "successor-intent",
      supersedesAwardId: old.awardId,
      beneficiary: ben,
    });
    const consent = {
      authenticatedActorId: state.submissions[0].admittedClaimantActorId,
      submissionId: a.submissionId,
      predecessorAwardId: old.awardId,
      predecessorAwardDigest: old.awardDigest,
      successorAwardDigest: a.awardDigest,
      acceptedAt: f.context.now,
      provenance: f.context.provenance,
    };
    a.successorConsentDigest = hash(consent);
    f.context.successorConsents = [
      { ...consent, consentDigest: a.successorConsentDigest },
    ];
    const ds = [
      human(f, a, "creator", "approve", "301", old.terms),
      human(f, a, "reviewer", "approve", "302", old.terms),
    ].map((d) => d.decisionDigest);
    const original = structuredClone(state.submissions[0]);
    state = propose(f, state, a, ds);
    expect(state.awards[0].state).toBe("superseded");
    expect(state.awards[0].awardDigest).toBe(old.awardDigest);
    expect(state.awards[1].reviewEndsAt > old.reviewEndsAt).toBe(true);
    expect(state.awards[1].disputeEndsAt > old.disputeEndsAt).toBe(true);
    expect(state.awards[1].requiredHumanDecisionDigests).toHaveLength(1);
    expect(state.submissions[0].beneficiary).toEqual(original.beneficiary);
    state = approve(f, state, state.awards[1]);
    expect(state.capacityReservations[0].termsDigest).toBe(f.terms.termsDigest);
    expect(state.bounties[0].winningAwardId).toBe(a.awardId);
  });
  it("missing claimant consent and changed principal cannot admit a successor", async () => {
    const f = await submitted();
    const state = propose(f, f.state),
      old = state.awards[0];
    f.context.now = "2026-10-04T12:00:00.000Z";
    const a = proposal(f, state, {
      awardId: "missing-consent",
      intentId: "new-intent",
      supersedesAwardId: old.awardId,
    });
    const ds = [
      human(f, a, "creator", "approve"),
      human(f, a, "reviewer", "approve"),
    ].map((d) => d.decisionDigest);
    expect(() => propose(f, state, a, ds)).toThrow("unauthorized");
    const t = { ...a.terms, principalMinor: "11000000" };
    t.termsDigest = bountyTermsDigest(t);
    f.context.terms = [...f.context.terms, t];
    const resized = proposal(f, state, {
      ...a,
      terms: t,
      principalMinor: t.principalMinor,
    });
    expect(() => propose(f, state, resized, ds)).toThrow("held");
  });
  it("expiry closes new admission while retaining the submitted claim and reservations", async () => {
    const f = await submitted();
    const state = run(
      f.state,
      {
        ...base(f.state, f.context, "expire"),
        kind: "expire-opportunity",
        bountyId: f.terms.bountyId,
        termsDigest: f.terms.termsDigest,
      },
      f.context,
    );
    expect(state.bounties[0].opportunityStatus).toBe("expired");
    expect(state.submissions).toEqual(f.state.submissions);
    expect(state.capacityReservations).toEqual(f.state.capacityReservations);
    expect(() => propose(f, state)).not.toThrow();
  });
});

async function secondCandidate(
  f: Awaited<ReturnType<typeof setup>>,
  state: BountyState,
) {
  const nonce = {
    ...f.nonce,
    nonceId: "nonce-candidate-b",
    runId: "run-candidate-b",
    attemptId: "attempt-candidate-b",
    issuedAt: f.context.now,
  };
  state = run(
    state,
    { ...base(state, f.context, "nonce-b", "101"), kind: "issue-nonce", nonce },
    f.context,
  );
  const attestation = {
    ...parseResidentAttestationBytes(f.attestationBytes),
    nonceId: nonce.nonceId,
    runId: nonce.runId,
    attemptId: nonce.attemptId,
    issuedAt: nonce.issuedAt,
    prNodeId: "PR_candidate_b",
  };
  const build = { ...f.context.buildEvidence[0], observedAt: f.context.now };
  const { evidenceDigest: _bd, ...bp } = build;
  build.evidenceDigest = hash(bp);
  f.context.buildEvidence = [...f.context.buildEvidence, build];
  attestation.buildEvidenceDigest = build.evidenceDigest;
  attestation.signature = btoa(
    String.fromCharCode(
      ...ed25519.sign(
        residentAttestationSigningBytes(attestation),
        new Uint8Array(32).fill(17),
      ),
    ),
  );
  const github = {
    ...f.context.githubSubmissions[0],
    prNodeId: attestation.prNodeId,
    evidenceDigest: "",
  };
  const { evidenceDigest: _d, ...payload } = github;
  github.evidenceDigest = hash(payload);
  f.context.githubSubmissions = [...f.context.githubSubmissions, github];
  f.context.revision = state.revision;
  const v = await verifyResidentAttestation(
    canonicalBountyBytes(attestation),
    nonce,
    f.context,
  );
  f.context.verifiedSubmissions = [...f.context.verifiedSubmissions, v];
  const command = {
    ...f.submitCommand,
    ...base(state, f.context, "submit-b", "101"),
    submissionId: "submission-b",
    attestationDigest: v.attestationDigest,
    evidenceDigest: v.attestationDigest,
    nonceId: nonce.nonceId,
  };
  return run(state, command, f.context);
}
describe("candidate isolation and trusted reconciliation", () => {
  it.each(["withdraw-submission", "reject-submission"] as const)(
    "%s leaves another candidate under review and its opportunity intact",
    async (kind) => {
      const f = await setup();
      let state = applyBountyCommand(
        f.initialState,
        f.submitCommand,
        f.context,
      ).state;
      state = await secondCandidate(f, state);
      f.context.now = "2026-10-03T12:00:00.000Z";
      f.context.revision = state.revision;
      const v = await verifyResidentAttestation(
        f.attestationBytes,
        state.nonces[0],
        f.context,
      );
      f.context.verifiedSubmissions = [v, f.context.verifiedSubmissions[1]];
      state = propose(f, state);
      const before = structuredClone(state),
        loser = state.submissions[1];
      let command: BountyCommand;
      if (kind === "withdraw-submission")
        command = {
          ...base(state, f.context, "withdraw-b", "101"),
          kind,
          submissionId: loser.submissionId,
          subject: loser.subject,
        };
      else {
        const d = human(
          f,
          {
            ...state.awards[0],
            submissionId: loser.submissionId,
            workUnitId: loser.workUnitId,
          },
          "reviewer",
          "reject",
        );
        command = {
          ...base(state, f.context, "reject-b", "302"),
          kind,
          submissionId: loser.submissionId,
          decisionDigest: d.decisionDigest,
        };
      }
      state = run(state, command, f.context);
      expect(state.submissions[0]).toEqual(before.submissions[0]);
      expect(state.awards).toEqual(before.awards);
      expect(state.bounties).toEqual(before.bounties);
      expect(state.capacityReservations).toEqual(before.capacityReservations);
      expect(state.submissions[1].reviewStatus).toBe(
        kind === "withdraw-submission" ? "withdrawn" : "rejected",
      );
    },
  );
  it("withdrawal makes its own unselected proposal terminal without releasing backing", async () => {
    const f = await submitted();
    const pending = propose(f, f.state);
    const state = run(pending, withdraw(pending, f.context), f.context);
    expect(state.awards[0].state).toBe("withdrawn");
    expect(state.awards[0].awardDigest).toBe(pending.awards[0].awardDigest);
    expect(state.workReservations).toEqual(pending.workReservations);
    expect(() => approve(f, state)).toThrow("held");
  });
  it.each([null, "original"])(
    "accepts unchanged-tree rebase to a new commit with %s accepted-build reference",
    async (which) => {
      const f = await submitted();
      const lineage = {
        ...f.context.acceptedLineages[0],
        relationship: "rebase" as const,
        acceptedBuildEvidenceDigest:
          which === null ? null : f.context.buildEvidence[0].evidenceDigest,
      };
      const { lineageDigest: _d, ...payload } = lineage;
      lineage.lineageDigest = hash(payload);
      f.context.acceptedLineages = [lineage];
      f.context.verifiedSubmissions = [
        await verifyResidentAttestation(
          f.attestationBytes,
          f.state.nonces[0],
          f.context,
        ),
      ];
      const a = proposal(f, f.state, {
        acceptedLineageDigest: lineage.lineageDigest,
      });
      const state = approve(f, propose(f, f.state, a));
      expect(state.awards[0].state).toBe("approved-reserved");
    },
  );
  it("resolves an explicit silence hold only through named human authority", async () => {
    const f = await submitted();
    let state = propose(f, f.state);
    f.context.now = state.awards[0].disputeEndsAt;
    state = run(
      state,
      {
        ...base(state, f.context, "silence", "302"),
        kind: "select-award",
        awardId: f.award.awardId,
        decisionDigests: state.awards[0].requiredHumanDecisionDigests,
      },
      f.context,
    );
    const d = human(f, state.awards[0], "dispute", "resolve-dispute", "303");
    state = run(
      state,
      {
        ...base(state, f.context, "resolve-silence", "303"),
        kind: "record-review",
        awardId: f.award.awardId,
        decisionDigest: d.decisionDigest,
      },
      f.context,
    );
    state = approve(f, state);
    expect(state.awards[0].state).toBe("approved-reserved");
  });
  it("a result verified for different committed payment bytes cannot mark the selected award paid", async () => {
    const f = await submitted();
    const state = approve(f, propose(f, f.state)),
      a = state.awards[0],
      cap = state.capacityReservations[0];
    f.context.now = "2026-10-21T12:00:00.000Z";
    const expected = bountyPaymentPreview(
      a,
      cap,
      f.context.fundingObservations[0],
    );
    const obs = {
      observationDigest: "",
      transactionSignature: f.transactionSignature,
      network: a.terms.network,
      mint: a.terms.mint,
      slot: "2000",
      finality: "finalized" as const,
      transaction: { synthetic: true },
      observedAt: f.context.now,
      provenance: f.context.provenance,
    };
    const { observationDigest: _o, ...op } = obs;
    obs.observationDigest = hash(op);
    f.context.settlementObservations = [obs];
    const input = {
      previewDigest: expected.previewDigest,
      intentId: a.intentId,
      intentDigest: a.intentDigest,
      sourceInstrumentId: a.sourceInstrumentId,
      principalMinor: a.principalMinor,
      feeMinor: a.feeMinor,
      refundMinor: "0",
      observationDigests: [obs.observationDigest],
      transactionSignatures: [f.transactionSignature],
      slots: ["2000"],
      settledAt: f.context.now,
    };
    const command: BountyCommand = {
      ...base(state, f.context, "reconcile-payment"),
      kind: "reconcile-payment",
      awardId: a.awardId,
      intentId: a.intentId,
      settlementDigest: hash(input),
    };
    // Trusted verifier-output fixture tests only the reducer consumer binding;
    // Task 6 must derive real finalized results rather than this unit fixture.
    for (const changed of [
      { ...input, previewDigest: hash("other-preview") },
      { ...input, principalMinor: "1" },
      { ...input, intentId: "other-intent" },
    ]) {
      f.context.verifiedSettlements = [
        { ...changed, settlementDigest: hash(changed) },
      ];
      expect(() =>
        run(state, { ...command, settlementDigest: hash(changed) }, f.context),
      ).toThrow("unsafe-settlement");
    }
    f.context.verifiedSettlements = [
      { ...input, settlementDigest: hash(input) },
    ];
    const held = run(
      state,
      {
        ...base(state, f.context, "post-signing-hold", "303"),
        kind: "hold",
        bountyId: a.bountyId,
        submissionId: a.submissionId,
        awardId: a.awardId,
        disputeDigest: null,
      },
      f.context,
    );
    const paid = run(
      held,
      { ...command, expectedRevision: held.revision },
      f.context,
    );
    expect(paid.awards[0].state).toBe("paid");
    expect(paid.capacityReservations[0].status).toBe("paid");
    expect(paid.settlementAttempts[0].transactionSignatures).toEqual([
      f.transactionSignature,
    ]);
    expect(() =>
      run(
        paid,
        {
          ...command,
          commandId: "fresh-duplicate",
          expectedRevision: paid.revision,
        },
        f.context,
      ),
    ).toThrow("replay-conflict");
  });
});

async function materialSuccessor(
  binding: "correct" | "missing" | "wrong" = "correct",
  authority = false,
) {
  const f = await submitted();
  const state = propose(f, f.state),
    old = state.awards[0];
  f.context.now = "2026-10-04T12:00:00.000Z";
  f.context.revision = state.revision;
  const t: BountyTerms = {
    ...old.terms,
    acceptanceDigest: hash("new-reviewed-criteria"),
    licenseDigest: hash("new-reviewed-license"),
    authority: authority
      ? { ...old.terms.authority, acceptanceActorIds: ["303"] }
      : old.terms.authority,
  };
  t.termsDigest = bountyTermsDigest(t);
  f.context.terms = [...f.context.terms, t];
  const previous = f.context.acceptedLineages[0];
  const build = {
    ...f.context.buildEvidence[0],
    commit: previous.acceptedCommit,
    observedAt: f.context.now,
    acceptanceTermsDigest:
      binding === "correct"
        ? t.termsDigest
        : binding === "missing"
          ? null
          : old.terms.termsDigest,
  };
  const { evidenceDigest: _b, ...bp } = build;
  build.evidenceDigest = hash(bp);
  f.context.buildEvidence = [...f.context.buildEvidence, build];
  const lineage = {
    ...previous,
    acceptedAt: f.context.now,
    acceptanceActorId: t.authority.acceptanceActorIds[0],
    acceptedBuildEvidenceDigest: build.evidenceDigest,
  };
  const { lineageDigest: _l, ...lp } = lineage;
  lineage.lineageDigest = hash(lp);
  f.context.acceptedLineages = [...f.context.acceptedLineages, lineage];
  const manifest = {
    ...f.context.publicationManifests[1],
    licenseDigest: t.licenseDigest,
  };
  const { manifestDigest: _m, ...mp } = manifest;
  manifest.manifestDigest = hash(mp);
  f.context.publicationManifests = [
    ...f.context.publicationManifests,
    manifest,
  ];
  const a = proposal(f, state, {
    awardId: "material-successor",
    intentId: "material-successor-intent",
    supersedesAwardId: old.awardId,
    terms: t,
    acceptedLineageDigest: lineage.lineageDigest,
    acceptedPublicationManifestDigest: manifest.manifestDigest,
  });
  const consent = {
    authenticatedActorId: state.submissions[0].admittedClaimantActorId,
    submissionId: a.submissionId,
    predecessorAwardId: old.awardId,
    predecessorAwardDigest: old.awardDigest,
    successorAwardDigest: a.awardDigest,
    acceptedAt: f.context.now,
    provenance: f.context.provenance,
  };
  a.successorConsentDigest = hash(consent);
  f.context.successorConsents = [
    { ...consent, consentDigest: a.successorConsentDigest },
  ];
  const ds = [
    human(f, a, "creator", "approve", "301", old.terms),
    human(f, a, "reviewer", "approve", "302", old.terms),
  ].map((d) => d.decisionDigest);
  return { f, state, a, ds };
}
describe("material successor acceptance evidence", () => {
  it("admits changed criteria/license with explicitly bound fresh build and reset windows", async () => {
    const { f, state, a, ds } = await materialSuccessor();
    const proposed = propose(f, state, a, ds);
    const selected = approve(f, proposed, proposed.awards[1]);
    expect(selected.bounties[0].winningAwardId).toBe(a.awardId);
    expect(selected.capacityReservations[0].termsDigest).toBe(
      f.terms.termsDigest,
    );
    expect(selected.awards[1].terms.termsDigest).toBe(a.terms.termsDigest);
    expect(selected.submissions[0].termsDigest).toBe(f.terms.termsDigest);
  });
  it.each(["missing", "wrong"] as const)(
    "refuses fresh-looking build with %s successor criteria binding",
    async (binding) => {
      const { f, state, a, ds } = await materialSuccessor(binding);
      expect(() => propose(f, state, a, ds)).toThrow("held");
    },
  );
  it("supports separately authenticated acceptance under changed successor authority", async () => {
    const { f, state, a, ds } = await materialSuccessor("correct", true);
    expect(f.context.verifiedSubmissions[0].acceptance?.acceptanceActorId).toBe(
      "301",
    );
    const selected = approve(f, propose(f, state, a, ds));
    expect(selected.awards[1].state).toBe("approved-reserved");
    expect(selected.submissions[0].attribution).toEqual(
      state.submissions[0].attribution,
    );
  });
});

function verifiedResult(
  f: Awaited<ReturnType<typeof setup>>,
  preview: ReturnType<typeof bountyPaymentPreview>,
) {
  const observation = {
    observationDigest: "",
    transactionSignature: f.transactionSignature,
    network: preview.network,
    mint: preview.mint,
    slot: "2100",
    finality: "finalized" as const,
    transaction: { synthetic: true },
    observedAt: f.context.now,
    provenance: f.context.provenance,
  };
  const { observationDigest: _od, ...op } = observation;
  observation.observationDigest = hash(op);
  f.context.settlementObservations = [observation];
  const total = (kind: string) =>
    preview.legs
      .filter((l) => l.kind === kind)
      .reduce((n, l) => n + BigInt(l.amountMinor), 0n)
      .toString();
  const result = {
    previewDigest: preview.previewDigest,
    intentId: preview.intentId,
    intentDigest: preview.intentDigest,
    sourceInstrumentId: preview.sourceInstrumentId,
    principalMinor: total("principal"),
    feeMinor: total("fee"),
    refundMinor: total("refund"),
    observationDigests: [observation.observationDigest],
    transactionSignatures: [f.transactionSignature],
    slots: [observation.slot],
    settledAt: f.context.now,
  };
  const verified = { ...result, settlementDigest: hash(result) };
  f.context.verifiedSettlements = [verified];
  return verified;
}
function refundCommand(
  f: Awaited<ReturnType<typeof setup>>,
  state: BountyState,
) {
  const t = f.terms;
  const r: RefundDecision = {
    decisionId: "refund-unused",
    bountyId: t.bountyId,
    termsDigest: t.termsDigest,
    refundProposalDigest: "",
    authorityDecisionDigest: "",
    evidenceDigest: hash("reviewed-refund"),
    legs: [
      {
        ...t.funders[0],
        returnDestination: t.funders[0].refundDestination,
        amountMinor: "10100000",
      },
    ],
    feeTreatment: "no-fee",
    decidedAt: f.context.now,
  };
  r.legs = r.legs.map((l) => ({
    funderActorId: l.funderActorId,
    sourceInstrumentId: l.sourceInstrumentId,
    returnDestination: l.returnDestination,
    amountMinor: l.amountMinor,
    refundProofDigest: l.refundProofDigest,
  }));
  r.refundProposalDigest = bountyRefundProposalDigest(r);
  const d: HumanDecision = {
    ...f.context.humanDecisions[0],
    decisionId: "refund-authority",
    decisionDigest: "",
    authenticatedActorId: "303",
    role: "refund",
    decision: "refund",
    submissionId: null,
    workUnitId: null,
    awardDigest: null,
    beneficiaryDigest: null,
    refundProposalDigest: r.refundProposalDigest,
    principalMinor: "10100000",
    feeMinor: "0",
    relationshipDisclosureDigest: required(f.context.relationshipDisclosures.find(
      (x) => x.actorId === "303",
    )).disclosureDigest,
    decidedAt: f.context.now,
  };
  const { decisionDigest: _d, ...dp } = d;
  d.decisionDigest = hash(dp);
  r.authorityDecisionDigest = d.decisionDigest;
  f.context.humanDecisions = [...f.context.humanDecisions, d];
  return {
    ...base(state, f.context, "approve-unused-refund", "303"),
    kind: "approve-refund" as const,
    refund: r,
    decisionDigest: d.decisionDigest,
  };
}
describe("preserved obligations and current authorization", () => {
  it("publishes, reserves funding and issues admission through authenticated commands from empty state", async () => {
    const f = await setup();
    const empty = {
      revision: "0",
      terms: [],
      bounties: [],
      submissions: [],
      awards: [],
      workReservations: [],
      capacityReservations: [],
      nonces: [],
      settlementAttempts: [],
      refundDecisions: [],
      receipts: [],
    };
    let state: BountyState = {
      ...empty,
      history: { base: structuredClone(empty), events: [] },
    };
    state = run(
      state,
      {
        ...base(state, f.context, "publish"),
        kind: "publish-terms",
        termsDigest: f.terms.termsDigest,
      },
      f.context,
    );
    state = run(
      state,
      {
        ...base(state, f.context, "fund"),
        kind: "open-funded",
        bountyId: f.terms.bountyId,
        termsDigest: f.terms.termsDigest,
        fundingObservationDigest:
          f.context.fundingObservations[0].observationDigest,
      },
      f.context,
    );
    const nonce = { ...f.nonce, issuedAt: f.context.now };
    state = run(
      state,
      {
        ...base(state, f.context, "admit-nonce", "101"),
        kind: "issue-nonce",
        nonce,
      },
      f.context,
    );
    expect(state.bounties[0].opportunityStatus).toBe("funded-open");
    expect(state.capacityReservations).toHaveLength(1);
    expect(state.nonces[0].acceptedAttestationDigest).toBeNull();
    expect(
      foldBountyEvents(
        { ...empty, history: { base: empty, events: [] } },
        state.history.events,
      ),
    ).toEqual(state);
  });
  it("only unencumbered expired capacity reaches separate refund approval and reconciliation", async () => {
    const f = await setup();
    f.context.now = "2026-10-03T12:00:00.000Z";
    let state = run(
      f.initialState,
      {
        ...base(f.initialState, f.context, "expire-unused"),
        kind: "expire-opportunity",
        bountyId: f.terms.bountyId,
        termsDigest: f.terms.termsDigest,
      },
      f.context,
    );
    const approved = refundCommand(f, state);
    state = run(state, approved, f.context);
    expect(state.capacityReservations[0].status).toBe("refund-bound");
    expect(state.settlementAttempts).toHaveLength(1);
    const preview = bountyRefundPreview(
      approved.refund,
      f.terms,
      state.capacityReservations[0],
      f.context.fundingObservations[0],
    );
    f.context.now = "2026-10-04T12:00:00.000Z";
    const result = verifiedResult(f, preview);
    state = run(
      state,
      {
        ...base(state, f.context, "refund-final", "303"),
        kind: "reconcile-refund",
        refundDecisionId: approved.refund.decisionId,
        intentId: preview.intentId,
        settlementDigest: result.settlementDigest,
      },
      f.context,
    );
    expect(state.capacityReservations[0].status).toBe("refunded");
    expect(state.settlementAttempts[0].status).toBe("paid");
    expect(state.refundDecisions[0]).toEqual(approved.refund);
    expect(() =>
      assertBountyReservations(state, {
        ...f.context,
        revision: state.revision,
      }),
    ).not.toThrow();
  });
  it("expiry and unknown/executable attempts never allow a submitted claim to be swept", async () => {
    const f = await submitted();
    const expired = run(
      f.state,
      {
        ...base(f.state, f.context, "expire-claimed"),
        kind: "expire-opportunity",
        bountyId: f.terms.bountyId,
        termsDigest: f.terms.termsDigest,
      },
      f.context,
    );
    expect(() => run(expired, refundCommand(f, expired), f.context)).toThrow(
      "unsafe-settlement",
    );
    const selected = approve(f, propose(f, f.state));
    const a = selected.awards[0];
    const retire = {
      ...base(selected, f.context, "retire-without-proof", "303"),
      kind: "retire-intent" as const,
      intentId: a.intentId,
      intentDigest: a.intentDigest,
      retirementEvidenceDigest: hash("timeout"),
      decisionDigest: hash("timeout-authority"),
    };
    expect(() => run(selected, retire, f.context)).toThrow("unsafe-settlement");
    expect(selected.settlementAttempts).toHaveLength(1);
    expect(selected.capacityReservations[0].status).toBe("award-bound");
    expect(() => run(selected, refundCommand(f, selected), f.context)).toThrow(
      "unsafe-settlement",
    );
  });
  it("current key revocation blocks a new proposal despite retained verified output", async () => {
    const f = await submitted();
    f.context.reviewedKeys = f.context.reviewedKeys.map((k) => ({
      ...k,
      revokedAt: f.context.now,
    }));
    expect(() => propose(f, f.state)).toThrow("held");
  });
  it("scheduled review-policy revocation preserves bound successor reconciliation but blocks new selection", async () => {
    const { f, state, a, ds } = await materialSuccessor();
    const p = {
      ...f.context.reviewedPolicies[0],
      revokedAt: "2026-10-22T00:00:00.000Z",
    };
    const { policyDigest: _p, ...pp } = p;
    p.policyDigest = hash(pp);
    f.context.reviewedPolicies = [...f.context.reviewedPolicies, p];
    f.context.humanDecisions = [
      { ...f.context.humanDecisions[0], policyDigest: p.policyDigest },
      ...f.context.humanDecisions.slice(1),
    ];
    const predecessor = state.awards[0];
    const newDs = [
      human(f, a, "creator", "approve", "301", predecessor.terms),
      human(f, a, "reviewer", "approve", "302", predecessor.terms),
    ].map((d) => d.decisionDigest);
    expect(ds).toHaveLength(2);
    const pending = propose(f, state, a, newDs),
      selected = approve(f, pending);
    f.context.now = "2026-10-23T12:00:00.000Z";
    const cap = selected.capacityReservations[0],
      winner = selected.awards[1];
    const preview = bountyPaymentPreview(
      winner,
      cap,
      f.context.fundingObservations[0],
    );
    const result = verifiedResult(f, preview);
    const paid = run(
      selected,
      {
        ...base(selected, f.context, "settle-after-revocation"),
        kind: "reconcile-payment",
        awardId: winner.awardId,
        intentId: winner.intentId,
        settlementDigest: result.settlementDigest,
      },
      f.context,
    );
    expect(paid.awards[1].state).toBe("paid");
    const preselection = foldBountyEvents(
      f.initialState,
      selected.history.events.slice(0, -1),
    );
    expect(() =>
      run(
        preselection,
        {
          ...base(preselection, f.context, "new-select-after-revocation"),
          kind: "select-award",
          awardId: winner.awardId,
          decisionDigests: preselection.awards[1].requiredHumanDecisionDigests,
        },
        f.context,
      ),
    ).toThrow("unauthorized");
  });
  it("per-actor disclosures cannot be omitted or replaced by duplicates in a successor approval", async () => {
    const { f, state, a, ds } = await materialSuccessor();
    f.context.relationshipDisclosures =
      f.context.relationshipDisclosures.filter((d) => d.actorId !== "101");
    expect(() => propose(f, state, a, ds)).toThrow();
    const g = await submitted();
    const pending = propose(g, g.state);
    const award = pending.awards[0];
    g.context.now = award.disputeEndsAt;
    g.context.relationshipDisclosures = [
      ...g.context.relationshipDisclosures,
      required(g.context.relationshipDisclosures.find((d) => d.actorId === "101")),
    ];
    const d = human(g, award, "reviewer", "approve");
    expect(() =>
      run(
        pending,
        {
          ...base(pending, g.context, "duplicate-disclosure", "302"),
          kind: "record-review",
          awardId: award.awardId,
          decisionDigest: d.decisionDigest,
        },
        g.context,
      ),
    ).toThrow();
  });
});

async function changedPayeeChain() {
  const f=await setup();
  const original=f.context.beneficiaries[0];
  const returnControl=f.context.funderReturnEvidence[0].destinationControl;
  const {beneficiaryDigest:_b,evidenceRevision:_r,frozenAt:_t,...input}=original;
  const oldPayee=freezeBeneficiary({...input,beneficiaryId:"initial-payee-401",authenticatedActorId:"401",destination:returnControl.claim.destination,walletClaimDigest:returnControl.claim.claimDigest,walletProofDigest:returnControl.proof.proofDigest},f.context);
  f.context.beneficiaries=[...f.context.beneficiaries,oldPayee];f.award.beneficiary=oldPayee;f.submitCommand.beneficiaryDigest=oldPayee.beneficiaryDigest;admit(f.submitCommand,f.context);
  let state=applyBountyCommand(f.initialState,f.submitCommand,f.context).state;f.context.now="2026-10-03T12:00:00.000Z";f.context.revision=state.revision;
  f.context.verifiedSubmissions=[await verifyResidentAttestation(f.attestationBytes,state.nonces[0],f.context)];state=propose(f,state);const old=state.awards[0];f.context.now="2026-10-04T12:00:00.000Z";
  const a=proposal(f,state,{awardId:"payee-successor",intentId:"payee-successor-intent",supersedesAwardId:old.awardId,beneficiary:original});
  const consent={authenticatedActorId:"101",submissionId:a.submissionId,predecessorAwardId:old.awardId,predecessorAwardDigest:old.awardDigest,successorAwardDigest:a.awardDigest,acceptedAt:f.context.now,provenance:f.context.provenance};a.successorConsentDigest=hash(consent);f.context.successorConsents=[{...consent,consentDigest:a.successorConsentDigest}];
  const ds=[human(f,a,"creator","approve","301",old.terms),human(f,a,"reviewer","approve","302",old.terms)].map(d=>d.decisionDigest);return {f,state,a,ds};
}
describe("independent predecessor beneficiary",()=>{
  it("retains original controller and admitted claimant separately from the named payee",async()=>{
    const {f,state,a,ds}=await changedPayeeChain();const selected=approve(f,propose(f,state,a,ds));
    expect(selected.submissions[0].beneficiary.authenticatedActorId).toBe("401");expect(selected.submissions[0].attribution.controllerActorId).toBe("101");expect(selected.submissions[0].admittedClaimantActorId).toBe("101");expect(selected.awards[1].beneficiary.authenticatedActorId).toBe("101");
  });
  it.each([false,true])("missing previous-payee disclosure cannot be masked by duplicates=%s",async(duplicate)=>{
    const {f,state,a,ds}=await changedPayeeChain();f.context.relationshipDisclosures=f.context.relationshipDisclosures.filter(d=>d.actorId!=="401");
    if(duplicate)f.context.relationshipDisclosures=[...f.context.relationshipDisclosures,required(f.context.relationshipDisclosures.find(d=>d.actorId==="101"))];
    expect(()=>propose(f,state,a,ds)).toThrow();
  });
});

it("separate creator/reviewer accounts in one disclosed group are not independent approval",async()=>{
  const f=await submitted();const pending=propose(f,f.state);
  const group=required(f.context.relationshipDisclosures.find(d=>d.actorId==="301")).controllerGroupId;
  f.context.relationshipDisclosures=f.context.relationshipDisclosures.map(d=>d.actorId==="302"?{...d,controllerGroupId:group}:d);
  expect(()=>approve(f,pending)).toThrow("unauthorized");
});

it("rejection retains its defined dispute opportunity before any otherwise eligible refund",async()=>{
  const f=await submitted();let state=run(f.state,{...base(f.state,f.context,"expire-before-reject"),kind:"expire-opportunity",bountyId:f.terms.bountyId,termsDigest:f.terms.termsDigest},f.context);
  const d=human(f,f.award,"reviewer","reject");state=run(state,{...base(state,f.context,"reject-last-candidate","302"),kind:"reject-submission",submissionId:f.submitCommand.submissionId,decisionDigest:d.decisionDigest},f.context);
  const immediate=refundCommand(f,state);
  expect(()=>run(state,immediate,f.context)).toThrow("unsafe-settlement");
  f.context.now="2026-10-07T12:00:00.000Z";
  const later=run(state,refundCommand(f,state),f.context);expect(later.capacityReservations[0].status).toBe("refund-bound");expect(later.submissions[0].reviewStatus).toBe("rejected");expect(later.workReservations[0].status).toBe("reserved");
});

it("a named resolution binds exact raised disputes and cannot be reused for a later dispute",async()=>{
  const f=await submitted();let state=propose(f,f.state);const a=state.awards[0];
  const disputed={disputeDigest:"",bountyId:a.bountyId,submissionId:a.submissionId,authenticatedActorId:"101",reasonDigest:hash("specific-acceptance-dispute"),raisedAt:f.context.now,resolvedByDecisionDigest:null,provenance:f.context.provenance};disputed.disputeDigest=bountyDisputeDigest(disputed);f.context.disputes=[disputed];
  state=run(state,{...base(state,f.context,"raise-dispute","101"),kind:"hold",bountyId:a.bountyId,submissionId:a.submissionId,awardId:a.awardId,disputeDigest:disputed.disputeDigest},f.context);
  const d=human(f,a,"dispute","resolve-dispute","303");f.context.disputes=[{...disputed,resolvedByDecisionDigest:d.decisionDigest}];
  state=run(state,{...base(state,f.context,"resolve-exact-dispute","303"),kind:"record-review",awardId:a.awardId,decisionDigest:d.decisionDigest},f.context);
  const resolved=structuredClone(state);const paidReady=approve(f,resolved);expect(paidReady.awards[0].state).toBe("approved-reserved");
  f.context.now="2026-10-21T12:00:00.000Z";
  const later={...disputed,reasonDigest:hash("later-different-dispute"),raisedAt:f.context.now};later.disputeDigest=bountyDisputeDigest(later);f.context.disputes=[{...disputed,resolvedByDecisionDigest:d.decisionDigest},later];
  state=run(resolved,{...base(resolved,f.context,"later-dispute","101"),kind:"hold",bountyId:a.bountyId,submissionId:a.submissionId,awardId:a.awardId,disputeDigest:later.disputeDigest},f.context);
  const stale={...d,decisionId:"reuse-old-resolution-scope",decidedAt:f.context.now};const {decisionDigest:_digest,...payload}=stale;stale.decisionDigest=hash(payload);f.context.humanDecisions=[...f.context.humanDecisions,stale];
  f.context.disputes=f.context.disputes.map(x=>({...x,resolvedByDecisionDigest:stale.decisionDigest}));
  expect(()=>run(state,{...base(state,f.context,"reuse-old-resolution","303"),kind:"record-review",awardId:a.awardId,decisionDigest:stale.decisionDigest},f.context)).toThrow("unauthorized");
});
