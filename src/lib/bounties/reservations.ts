/** Pure proposals against one exact revision. Durable atomic admission remains
 * an integration gate; these helpers never commit, sign or release money. */
import { assertPaymentReservationLedger } from "../payment-reservations";
import { SOLANA_MAINNET_USDC_MINT } from "../settlement-plan";
import { sha256Hex } from "../sha256";
import { isSolanaAddress } from "../wallets";
import { residentWorkUnitId } from "./attestations";
import {
  assertExactBountyKeys,
  bountyAwardDigest,
  bountyDigest,
  bountyInteger,
  bountyObject,
  bountyUtc,
  canonicalBountyBytes,
} from "./codec";
import type {
  AwardRecord,
  AwardReservation,
  BountyState,
  BountyTerms,
  CapacityReservation,
  EvidenceContext,
  EvidenceProvenance,
  FundingObservation,
  HumanDecision,
  VerifiedResidentSubmission,
  WorkEquivalence,
  WorkReservation,
} from "./contracts";
import { TransitionError } from "./contracts";
import { assertBountyTerms, bountyObligation } from "./terms";

export type {
  AwardReservation,
  CapacityReservation,
  WorkReservation,
} from "./contracts";

const hash = (v: unknown): string => sha256Hex(canonicalBountyBytes(v));
const same = (a: unknown, b: unknown): boolean => hash(a) === hash(b);
function fail(
  code: ConstructorParameters<typeof TransitionError>[0] = "invalid",
): never {
  throw new TransitionError(code);
}
function one<T>(rows: readonly T[]): T {
  if (rows.length !== 1) fail();
  return rows[0];
}
function boundary<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof TransitionError) throw error;
    return fail();
  }
}
function provenance(p: EvidenceProvenance, context: EvidenceContext): void {
  if (p.kind === "local-synthetic") {
    if (
      context.environment !== "test" ||
      context.provenance.kind !== "local-synthetic" ||
      p.fixtureId !== context.provenance.fixtureId
    )
      fail("unauthorized");
  } else if (p.kind === "authenticated-adapter") {
    bountyDigest(p.sourceDigest);
    if (
      !p.adapterId ||
      !p.adapterRevision ||
      bountyUtc(p.observedAt) > context.now
    )
      fail("unauthorized");
  } else fail("unauthorized");
}
function revision(state: BountyState, context: EvidenceContext): void {
  bountyInteger(state.revision);
  bountyInteger(context.revision);
  bountyUtc(context.now);
  if (state.revision !== context.revision) fail("stale-revision");
  provenance(context.provenance, context);
}
/** Existing v1 instrument IDs encode the physical Solana vault. Unsupported
 * labels cannot prove independent backing and fail closed. Different multisig
 * or vault-index labels for one address still share all available capacity. */
function vault(id: string): string {
  const match =
    /^squads-v4-vault:solana:([1-9A-HJ-NP-Za-km-z]{32,44}):(0|[1-9][0-9]{0,2}):([1-9A-HJ-NP-Za-km-z]{32,44})$/u.exec(
      id,
    );
  if (
    !match ||
    Number(match[2]) > 255 ||
    !isSolanaAddress(match[1]) ||
    !isSolanaAddress(match[3])
  )
    return fail();
  return match[3];
}
function funding(
  o: FundingObservation,
  context: EvidenceContext,
): FundingObservation {
  assertExactBountyKeys(bountyObject(o), [
    "observationDigest",
    "sourceInstrumentId",
    "sourceOwner",
    "instrumentKind",
    "network",
    "mint",
    "availableMinor",
    "networkCostSourceId",
    "networkCostSourceOwner",
    "availableLamports",
    "controllerConfigurationDigest",
    "transactionSignature",
    "slot",
    "finality",
    "observedAt",
    "provenance",
  ]);
  const { observationDigest, ...payload } = o;
  bountyDigest(observationDigest);
  bountyDigest(o.controllerConfigurationDigest);
  if (hash(payload) !== observationDigest) fail();
  provenance(o.provenance, context);
  if (o.finality !== "finalized" || bountyUtc(o.observedAt) > context.now)
    fail("held");
  if (
    o.instrumentKind !== "bounty-squads-v4" ||
    o.network !== "solana-mainnet" ||
    o.mint !== SOLANA_MAINNET_USDC_MINT ||
    o.sourceOwner !== vault(o.sourceInstrumentId) ||
    !isSolanaAddress(o.networkCostSourceOwner) ||
    !/^[1-9A-HJ-NP-Za-km-z]{87,88}$/u.test(o.transactionSignature)
  )
    fail();
  bountyInteger(o.availableMinor);
  bountyInteger(o.availableLamports);
  bountyInteger(o.slot, true);
  return o;
}
function observation(
  r: CapacityReservation,
  context: EvidenceContext,
): FundingObservation {
  const o = funding(
    one(
      context.fundingObservations.filter(
        (o) => o.observationDigest === r.fundingObservationDigest,
      ),
    ),
    context,
  );
  if (
    o.sourceInstrumentId !== r.sourceInstrumentId ||
    o.networkCostSourceId !== r.networkCostPolicy.costSourceId
  )
    fail();
  return o;
}
function termsFor(
  state: BountyState,
  bountyId: string,
  digest: string,
  context: EvidenceContext,
): BountyTerms {
  const t = assertBountyTerms(
    one(
      state.terms.filter(
        (t) => t.bountyId === bountyId && t.termsDigest === digest,
      ),
    ),
  );
  if (
    !same(
      t,
      one(
        context.terms.filter(
          (t) => t.bountyId === bountyId && t.termsDigest === digest,
        ),
      ),
    )
  )
    fail("held");
  return t;
}
function authority(
  d: HumanDecision,
  t: BountyTerms,
  context: EvidenceContext,
  role: "reviewer" | "retirement",
): void {
  provenance(d.provenance, context);
  bountyInteger(d.authenticatedActorId, true);
  const policy = one(
    context.reviewedPolicies.filter((p) => p.policyDigest === d.policyDigest),
  );
  provenance(policy.provenance, context);
  const { policyDigest, ...policyPayload } = policy;
  if (hash(policyPayload) !== policyDigest) fail("unauthorized");
  if (
    policy.environment !== context.environment ||
    !policy.projectIds.includes(t.projectId) ||
    !policy.repositoryIds.includes(t.repositoryId) ||
    bountyUtc(policy.effectiveAt) > d.decidedAt ||
    (policy.revokedAt !== null && policy.revokedAt <= context.now) ||
    d.role !== role ||
    !t.authority[
      role === "reviewer" ? "reviewerActorIds" : "retirementActorIds"
    ].includes(d.authenticatedActorId) ||
    d.bountyId !== t.bountyId ||
    d.termsDigest !== t.termsDigest ||
    d.sourceInstrumentId !== t.sourceInstrumentId ||
    bountyUtc(d.decidedAt) > context.now
  )
    fail("unauthorized");
}
/** Exact union mapping, excluding its digest and approval pointer to avoid a
 * hash cycle. Canonical ID is a member; mappings can only merge identities. */
export function workEquivalenceDigest(m: WorkEquivalence): string {
  return hash({
    workUnitIds: m.workUnitIds,
    canonicalWorkUnitId: m.canonicalWorkUnitId,
  });
}
function equivalences(
  state: BountyState,
  context: EvidenceContext,
): (id: string) => string {
  const parents = new Map<string, string>();
  function root(id: string): string {
    const p = parents.get(id);
    return p === undefined || p === id ? id : root(p);
  }
  const known = new Set([
    ...context.verifiedSubmissions.map((v) => v.workUnitId),
    ...context.legacyWorkAwards.map((v) => v.workUnitId),
    ...state.workReservations.map((v) => v.workUnitId),
  ]);
  for (const m of context.workEquivalences) {
    assertExactBountyKeys(bountyObject(m), [
      "workUnitIds",
      "canonicalWorkUnitId",
      "mappingDigest",
      "decisionDigest",
    ]);
    if (
      m.workUnitIds.length < 2 ||
      new Set(m.workUnitIds).size !== m.workUnitIds.length ||
      !m.workUnitIds.includes(m.canonicalWorkUnitId) ||
      workEquivalenceDigest(m) !== m.mappingDigest
    )
      fail();
    for (const id of m.workUnitIds) {
      bountyDigest(id);
      if (!known.has(id)) fail("unauthorized");
    }
    const d = one(
      context.humanDecisions.filter(
        (d) => d.decisionDigest === m.decisionDigest,
      ),
    );
    const { decisionDigest, ...payload } = d;
    if (
      hash(payload) !== decisionDigest ||
      d.workEquivalenceDigest !== m.mappingDigest ||
      d.decision !== "approve"
    )
      fail("unauthorized");
    const t = termsFor(state, d.bountyId, d.termsDigest, context);
    authority(d, t, context, "reviewer");
    if (d.workUnitId !== null && !m.workUnitIds.includes(d.workUnitId))
      fail("unauthorized");
    const target = root(m.canonicalWorkUnitId);
    for (const id of m.workUnitIds) parents.set(root(id), target);
  }
  return root;
}
function retired(
  r: CapacityReservation,
  state: BountyState,
  context: EvidenceContext,
): boolean {
  if (r.status !== "retired") return false;
  const e = one(
    context.retirementEvidence.filter(
      (e) => e.retirementDigest === r.retirementEvidenceDigest,
    ),
  );
  provenance(e.provenance, context);
  const { retirementDigest, ...retirementPayload } = e;
  if (hash(retirementPayload) !== retirementDigest) fail("unsafe-settlement");
  const attempt = one(
    state.settlementAttempts.filter(
      (a) =>
        a.intentId === e.intentId &&
        a.capacityReservationId === r.capacityReservationId,
    ),
  );
  const d = one(
    context.humanDecisions.filter(
      (d) => d.decisionDigest === e.humanDecisionDigest,
    ),
  );
  const t = termsFor(state, r.bountyId, r.termsDigest, context);
  authority(d, t, context, "retirement");
  const { decisionDigest, ...decisionPayload } = d;
  if (
    hash(decisionPayload) !== decisionDigest ||
    d.principalMinor !== r.principalMinor ||
    d.feeMinor !== r.feeMinor
  )
    fail("unauthorized");
  if (
    e.intentId !== r.intentId ||
    e.intentDigest !== attempt.intentDigest ||
    attempt.status !== "retired" ||
    attempt.retirementEvidenceDigest !== e.retirementDigest ||
    d.intentId !== e.intentId ||
    d.intentDigest !== e.intentDigest ||
    d.decision !== "retire" ||
    bountyUtc(e.retiredAt) > context.now ||
    e.controllerConfigurationDigest !==
      observation(r, context).controllerConfigurationDigest ||
    state.submissions.some(
      (s) =>
        s.bountyId === r.bountyId &&
        !["withdrawn", "rejected"].includes(s.reviewStatus),
    ) ||
    state.awards.some(
      (a) =>
        a.bountyId === r.bountyId &&
        !["retired", "rejected", "withdrawn", "superseded"].includes(a.state),
    ) ||
    state.settlementAttempts.some(
      (a) =>
        a.capacityReservationId === r.capacityReservationId &&
        a.status !== "retired",
    )
  )
    fail("unsafe-settlement");
  if (e.method === "never-executable") {
    if (
      attempt.transactionSignatures.length ||
      e.observationDigest !== r.fundingObservationDigest
    )
      fail("unsafe-settlement");
  } else if (e.method === "on-chain-invalidated") {
    const o = one(
      context.settlementObservations.filter(
        (o) => o.observationDigest === e.observationDigest,
      ),
    );
    provenance(o.provenance, context);
    if (
      o.finality !== "finalized" ||
      o.network !== t.network ||
      o.mint !== t.mint ||
      bountyUtc(o.observedAt) > e.retiredAt
    )
      fail("unsafe-settlement");
  } else fail("unsafe-settlement");
  return true;
}
function pendingBoundary(v: VerifiedResidentSubmission): string {
  return (
    v.acceptance?.workBoundaryDigest ??
    hash({
      repositoryId: v.repositoryId,
      prNodeId: v.prNodeId,
      submittedCommit: v.submittedCommit,
      submittedTree: v.submittedTree,
      artifactDigests: v.artifactDigests,
    })
  );
}
function verified(
  v: VerifiedResidentSubmission,
  context: EvidenceContext,
): void {
  const retained = one(
    context.verifiedSubmissions.filter(
      (r) => r.attestationDigest === v.attestationDigest,
    ),
  );
  // Original wire bytes and the entire verifier output must match trusted data.
  const normalized = (r: VerifiedResidentSubmission) => ({
    ...r,
    attestationBytes: Array.from(r.attestationBytes),
  });
  if (
    !same(normalized(v), normalized(retained)) ||
    sha256Hex(v.attestationBytes) !== v.attestationDigest ||
    residentWorkUnitId(v.repositoryId, v.prNodeId) !== v.workUnitId ||
    v.verifiedAt > context.now
  )
    fail("unauthorized");
}
function conflicts(
  id: string,
  own: WorkReservation | null,
  state: BountyState,
  context: EvidenceContext,
  root: (id: string) => string,
): void {
  if (
    context.legacyWorkAwards.some((r) => root(r.workUnitId) === root(id)) ||
    state.workReservations.some(
      (r) =>
        r !== own && r.status !== "released" && root(r.workUnitId) === root(id),
    )
  )
    fail("duplicate-work");
}
function unique(rows: readonly string[]): void {
  if (new Set(rows).size !== rows.length) fail();
}
interface Balance {
  observation: FundingObservation;
  spent: bigint;
}
function tokenBasis(o: FundingObservation): unknown {
  return {
    owner: o.sourceOwner,
    available: o.availableMinor,
    configuration: o.controllerConfigurationDigest,
    signature: o.transactionSignature,
    slot: o.slot,
    observedAt: o.observedAt,
  };
}
function solBasis(o: FundingObservation): unknown {
  return {
    owner: o.networkCostSourceOwner,
    available: o.availableLamports,
    slot: o.slot,
    observedAt: o.observedAt,
  };
}
function addBalance(
  map: Map<string, Balance>,
  id: string,
  o: FundingObservation,
  amount: bigint,
  sol: boolean,
): void {
  const previous = map.get(id);
  if (
    previous &&
    !same(
      sol ? solBasis(previous.observation) : tokenBasis(previous.observation),
      sol ? solBasis(o) : tokenBasis(o),
    )
  )
    fail("held");
  const total = (previous?.spent ?? 0n) + amount;
  if (total > BigInt(sol ? o.availableLamports : o.availableMinor))
    fail("insufficient-funds");
  map.set(id, { observation: o, spent: total });
}
function projection(
  state: BountyState,
  context: EvidenceContext,
  proposal?: CapacityReservation,
): void {
  revision(state, context);
  const legacy = assertPaymentReservationLedger(context.legacyReservations);
  for (const w of context.legacyWorkAwards) {
    bountyDigest(w.workUnitId);
    bountyDigest(w.workBoundaryDigest);
    bountyDigest(w.allocationDigest);
    bountyInteger(w.repositoryId, true);
    if (!["frozen", "paid"].includes(w.state)) fail();
  }
  const root = equivalences(state, context);
  unique(state.terms.map((t) => t.termsDigest));
  unique(state.bounties.map((b) => b.bountyId));
  unique(state.capacityReservations.map((r) => r.capacityReservationId));
  unique(state.capacityReservations.map((r) => r.bountyId));
  unique(state.workReservations.map((r) => r.workReservationId));
  unique(state.submissions.map((r) => r.submissionId));
  unique(state.awards.map((a) => a.awardId));
  unique(state.settlementAttempts.map((a) => a.intentId));
  // Reverse traversal prevents a retained executable/unknown intent from being
  // hidden by deleting its capacity row or its economic association.
  for (const attempt of state.settlementAttempts) {
    const capacity = one(
      state.capacityReservations.filter(
        (r) => r.capacityReservationId === attempt.capacityReservationId,
      ),
    );
    if (
      attempt.bountyId !== capacity.bountyId ||
      attempt.sourceInstrumentId !== capacity.sourceInstrumentId ||
      attempt.intentId !== capacity.intentId ||
      (attempt.awardId === null) === (attempt.refundDecisionId === null)
    )
      fail("unsafe-settlement");
    if (attempt.awardId !== null) {
      const award = one(
        state.awards.filter((a) => a.awardId === attempt.awardId),
      );
      if (
        award.bountyId !== capacity.bountyId ||
        award.capacityReservationId !== capacity.capacityReservationId ||
        capacity.awardId !== award.awardId ||
        award.intentId !== attempt.intentId ||
        award.intentDigest !== attempt.intentDigest ||
        award.sourceInstrumentId !== attempt.sourceInstrumentId ||
        award.principalMinor !== attempt.principalMinor ||
        award.feeMinor !== attempt.feeMinor
      )
        fail("unsafe-settlement");
    } else {
      const refund = one(
        state.refundDecisions.filter(
          (r) => r.decisionId === attempt.refundDecisionId,
        ),
      );
      if (
        capacity.awardId !== null ||
        refund.bountyId !== capacity.bountyId ||
        refund.termsDigest !== capacity.termsDigest
      )
        fail("unsafe-settlement");
    }
  }
  const tokens = new Map<string, Balance>();
  const sol = new Map<string, Balance>();
  for (const r of [
    ...state.capacityReservations,
    ...(proposal ? [proposal] : []),
  ]) {
    bountyInteger(r.expectedRevision);
    if (BigInt(r.expectedRevision) > BigInt(state.revision))
      fail("stale-revision");
    const t = termsFor(state, r.bountyId, r.termsDigest, context);
    const money = bountyObligation(t);
    if (
      r.sourceInstrumentId !== t.sourceInstrumentId ||
      r.principalMinor !== money.principalMinor ||
      r.feeMinor !== money.feeMinor ||
      !same(r.networkCostPolicy, t.networkCostPolicy) ||
      ![
        "reserved",
        "award-bound",
        "paid",
        "refund-bound",
        "refunded",
        "retired",
      ].includes(r.status)
    )
      fail();
    const o = observation(r, context);
    if (legacy.some((l) => vault(l.instrumentId) === o.sourceOwner))
      fail("insufficient-funds");
    const b = one(state.bounties.filter((b) => b.bountyId === r.bountyId));
    if (
      (!proposal || r !== proposal) &&
      (b.capacityReservationId !== r.capacityReservationId ||
        b.termsDigest !== r.termsDigest)
    )
      fail();
    if (retired(r, state, context)) continue;
    addBalance(tokens, o.sourceOwner, o, BigInt(money.totalUsdcMinor), false);
    addBalance(
      sol,
      o.networkCostSourceOwner,
      o,
      BigInt(t.networkCostPolicy.maxLamports) +
        BigInt(t.networkCostPolicy.tokenAccountRentLamports),
      true,
    );
    if (r.status === "reserved" && (r.awardId !== null || r.intentId !== null))
      fail();
    if (r.awardId !== null) {
      const a = one(state.awards.filter((a) => a.awardId === r.awardId));
      if (
        a.bountyId !== r.bountyId ||
        a.capacityReservationId !== r.capacityReservationId ||
        a.intentId !== r.intentId ||
        a.sourceInstrumentId !== r.sourceInstrumentId ||
        a.principalMinor !== r.principalMinor ||
        a.feeMinor !== r.feeMinor ||
        !awardTermsCompatible(state, a, t, context)
      )
        fail();
    }
    const attempts = state.settlementAttempts.filter(
      (a) => a.capacityReservationId === r.capacityReservationId,
    );
    for (const a of attempts) {
      if (
        a.bountyId !== r.bountyId ||
        a.sourceInstrumentId !== r.sourceInstrumentId ||
        a.intentId !== r.intentId
      )
        fail("unsafe-settlement");
      if (a.refundDecisionId === null) {
        if (
          a.awardId !== r.awardId ||
          a.principalMinor !== r.principalMinor ||
          a.feeMinor !== r.feeMinor
        )
          fail("unsafe-settlement");
      } else {
        const refund = one(
          state.refundDecisions.filter(
            (f) => f.decisionId === a.refundDecisionId,
          ),
        );
        if (
          refund.bountyId !== r.bountyId ||
          refund.termsDigest !== r.termsDigest ||
          a.awardId !== null ||
          r.awardId !== null ||
          !["refund-bound", "refunded"].includes(r.status) ||
          !refund.legs.length ||
          a.feeMinor !== "0" ||
          state.submissions.some(
            (s) =>
              s.bountyId === r.bountyId &&
              !["withdrawn", "rejected"].includes(s.reviewStatus),
          ) ||
          state.awards.some(
            (a) =>
              a.bountyId === r.bountyId &&
              !["retired", "rejected", "withdrawn", "superseded"].includes(
                a.state,
              ),
          )
        )
          fail("unsafe-settlement");
        let amount = 0n;
        for (const leg of refund.legs) {
          const funder = one(
            t.funders.filter((f) => f.funderActorId === leg.funderActorId),
          );
          if (
            leg.sourceInstrumentId !== r.sourceInstrumentId ||
            leg.returnDestination !== funder.refundDestination ||
            leg.refundProofDigest !== funder.refundProofDigest
          )
            fail("unsafe-settlement");
          amount += BigInt(bountyInteger(leg.amountMinor, true));
        }
        if (amount > BigInt(money.totalUsdcMinor)) fail("insufficient-funds");
        if (a.principalMinor !== amount.toString() || attempts.length !== 1)
          fail("unsafe-settlement");
      }
    }
    if (r.intentId !== null && !attempts.length) fail("unsafe-settlement");
    if (r.status !== "reserved" && r.intentId === null)
      fail("unsafe-settlement");
  }
  for (const b of state.bounties) {
    if (
      b.capacityReservationId !== null &&
      !state.capacityReservations.some(
        (r) =>
          r.capacityReservationId === b.capacityReservationId &&
          r.bountyId === b.bountyId,
      )
    )
      fail();
    if (
      ["funded-open", "awarded"].includes(b.opportunityStatus) &&
      b.capacityReservationId === null
    )
      fail();
  }
  for (const a of state.awards) {
    const t = termsFor(state, a.bountyId, a.terms.termsDigest, context);
    const money = bountyObligation(t);
    const originalBounty = one(
      state.bounties.filter((b) => b.bountyId === a.bountyId),
    );
    if (
      !awardTermsCompatible(
        state,
        a,
        termsFor(
          state,
          originalBounty.bountyId,
          originalBounty.termsDigest,
          context,
        ),
        context,
      )
    )
      fail("held");
    const c = one(
      state.capacityReservations.filter(
        (r) =>
          r.capacityReservationId === a.capacityReservationId &&
          r.bountyId === a.bountyId,
      ),
    );
    const w = one(
      state.workReservations.filter(
        (r) =>
          r.bountyId === a.bountyId &&
          r.workUnitId === a.workUnitId &&
          r.submissionIds.includes(a.submissionId),
      ),
    );
    if (
      !same(a.terms, t) ||
      a.sourceInstrumentId !== c.sourceInstrumentId ||
      a.principalMinor !== money.principalMinor ||
      a.feeMinor !== money.feeMinor ||
      w.status === "released"
    )
      fail();
    bountyDigest(a.acceptedLineageDigest);
    const b = one(state.bounties.filter((b) => b.bountyId === a.bountyId));
    const selected =
      ["approved-reserved", "signing-pending", "submitted", "paid"].includes(
        a.state,
      ) ||
      b.winningAwardId === a.awardId ||
      c.awardId === a.awardId ||
      w.awardId === a.awardId ||
      state.settlementAttempts.some((attempt) => attempt.awardId === a.awardId);
    // Holds before selection keep the opportunity's original unbound backing.
    // Any actual selected economic obligation must retain both bound records.
    if (
      selected &&
      !["retired", "rejected", "withdrawn", "superseded"].includes(a.state) &&
      (c.awardId !== a.awardId ||
        c.intentId !== a.intentId ||
        w.awardId !== a.awardId ||
        !["award-bound", "paid"].includes(w.status))
    )
      fail();
  }
  for (const s of state.submissions) {
    if (
      !state.workReservations.some(
        (r) =>
          r.bountyId === s.bountyId &&
          r.workUnitId === s.workUnitId &&
          r.submissionIds.includes(s.submissionId),
      )
    )
      fail();
  }
  for (const r of state.workReservations) {
    bountyDigest(r.workUnitId);
    bountyDigest(r.workBoundaryDigest);
    bountyInteger(r.expectedRevision);
    if (BigInt(r.expectedRevision) > BigInt(state.revision))
      fail("stale-revision");
    if (
      !r.submissionIds.length ||
      new Set(r.submissionIds).size !== r.submissionIds.length
    )
      fail();
    for (const id of r.submissionIds) {
      const s = one(state.submissions.filter((s) => s.submissionId === id));
      const v = one(
        context.verifiedSubmissions.filter(
          (v) => v.attestationDigest === s.attestationDigest,
        ),
      );
      verified(v, context);
      if (
        s.bountyId !== r.bountyId ||
        s.workUnitId !== r.workUnitId ||
        v.workUnitId !== r.workUnitId ||
        v.repositoryId !== r.repositoryId ||
        s.subject.kind !== "resident" ||
        s.subject.residentId !== v.residentId
      )
        fail("unauthorized");
      if (["award-bound", "paid"].includes(r.status)) {
        const a = one(state.awards.filter((a) => a.awardId === r.awardId));
        if (
          a.submissionId === id &&
          awardLineage(a, v, context).workBoundaryDigest !==
            r.workBoundaryDigest
        )
          fail("held");
      }
      if (
        r.status === "released" &&
        !["withdrawn", "rejected"].includes(s.reviewStatus)
      )
        fail("duplicate-work");
    }
    if (r.status === "released") {
      const d = one(
        context.humanDecisions.filter(
          (d) => d.decisionDigest === r.releaseDecisionDigest,
        ),
      );
      const s = one(
        state.submissions.filter((s) => s.submissionId === r.submissionIds[0]),
      );
      authority(
        d,
        termsFor(state, s.bountyId, s.termsDigest, context),
        context,
        "reviewer",
      );
      if (
        d.workUnitId !== r.workUnitId ||
        d.decision !== "reject" ||
        r.awardId !== null ||
        state.awards.some(
          (a) =>
            root(a.workUnitId) === root(r.workUnitId) &&
            !["rejected", "retired", "withdrawn", "superseded"].includes(
              a.state,
            ),
        )
      )
        fail("duplicate-work");
    } else {
      if (!["reserved", "award-bound", "paid"].includes(r.status)) fail();
      conflicts(r.workUnitId, r, state, context, root);
      if (r.awardId !== null) {
        const a = one(state.awards.filter((a) => a.awardId === r.awardId));
        if (
          a.bountyId !== r.bountyId ||
          a.workUnitId !== r.workUnitId ||
          !r.submissionIds.includes(a.submissionId)
        )
          fail();
      } else if (r.status !== "reserved") fail();
    }
  }
}
export function assertBountyReservations(
  state: BountyState,
  context: EvidenceContext,
): void {
  boundary(() => projection(state, context));
}
export function reserveBountyCapacity(
  state: BountyState,
  input: BountyTerms,
  context: EvidenceContext,
): CapacityReservation {
  return boundary(() => {
    projection(state, context);
    const t = assertBountyTerms(input);
    if (!same(t, termsFor(state, t.bountyId, t.termsDigest, context)))
      fail("held");
    const existing = state.capacityReservations.filter(
      (r) => r.bountyId === t.bountyId,
    );
    if (existing.length) {
      const r = one(existing);
      if (r.termsDigest !== t.termsDigest || r.status === "retired")
        fail("held");
      return structuredClone(r);
    }
    const b = one(state.bounties.filter((b) => b.bountyId === t.bountyId));
    if (
      b.opportunityStatus !== "published-unfunded" ||
      b.termsDigest !== t.termsDigest
    )
      fail("held");
    const o = funding(
      one(
        context.fundingObservations.filter(
          (o) => o.sourceInstrumentId === t.sourceInstrumentId,
        ),
      ),
      context,
    );
    const money = bountyObligation(t);
    const r: CapacityReservation = {
      capacityReservationId: `capacity-${hash({ bountyId: t.bountyId, termsDigest: t.termsDigest, revision: state.revision })}`,
      bountyId: t.bountyId,
      termsDigest: t.termsDigest,
      sourceInstrumentId: t.sourceInstrumentId,
      fundingObservationDigest: o.observationDigest,
      principalMinor: money.principalMinor,
      feeMinor: money.feeMinor,
      networkCostPolicy: structuredClone(t.networkCostPolicy),
      expectedRevision: state.revision,
      awardId: null,
      intentId: null,
      status: "reserved",
      retirementEvidenceDigest: null,
    };
    projection(state, context, r);
    return r;
  });
}
export function reserveWorkUnit(
  state: BountyState,
  v: VerifiedResidentSubmission,
  context: EvidenceContext,
): WorkReservation {
  return boundary(() => {
    projection(state, context);
    verified(v, context);
    if (v.evidenceRevision !== state.revision) fail("stale-revision");
    const t = termsFor(state, v.bountyId, v.termsDigest, context);
    const b = one(state.bounties.filter((b) => b.bountyId === v.bountyId));
    if (
      t.repositoryId !== v.repositoryId ||
      b.termsDigest !== v.termsDigest ||
      b.opportunityStatus !== "funded-open"
    )
      fail("held");
    const root = equivalences(state, context);
    const existing = state.workReservations.filter(
      (r) =>
        root(r.workUnitId) === root(v.workUnitId) && r.status !== "released",
    );
    const own = existing.length ? one(existing) : null;
    if (
      own &&
      (own.bountyId !== v.bountyId ||
        own.workUnitId !== v.workUnitId ||
        own.status !== "reserved" ||
        own.awardId !== null)
    )
      fail("duplicate-work");
    conflicts(v.workUnitId, own, state, context, root);
    return {
      workReservationId:
        own?.workReservationId ??
        `work-${hash({ bountyId: v.bountyId, workUnitId: v.workUnitId, revision: state.revision })}`,
      workUnitId: v.workUnitId,
      repositoryId: v.repositoryId,
      workBoundaryDigest: pendingBoundary(v),
      submissionIds: own ? [...own.submissionIds] : [],
      bountyId: v.bountyId,
      awardId: null,
      expectedRevision: state.revision,
      status: "reserved",
      releaseDecisionDigest: null,
    };
  });
}
export function bindAwardReservation(
  state: BountyState,
  award: AwardRecord,
  context: EvidenceContext,
): AwardReservation {
  return boundary(() => {
    projection(state, context);
    const t = termsFor(state, award.bountyId, award.terms.termsDigest, context);
    const capacity = one(
      state.capacityReservations.filter(
        (r) => r.capacityReservationId === award.capacityReservationId,
      ),
    );
    const work = one(
      state.workReservations.filter(
        (r) =>
          r.workUnitId === award.workUnitId &&
          r.bountyId === award.bountyId &&
          r.submissionIds.includes(award.submissionId),
      ),
    );
    const submission = one(
      state.submissions.filter((s) => s.submissionId === award.submissionId),
    );
    const v = one(
      context.verifiedSubmissions.filter(
        (v) => v.attestationDigest === submission.attestationDigest,
      ),
    );
    verified(v, context);
    const originalTerms = termsFor(
      state,
      capacity.bountyId,
      capacity.termsDigest,
      context,
    );
    const accepted = awardLineage(award, v, context);
    if (
      bountyAwardDigest(award) !== award.awardDigest ||
      !same(t, award.terms) ||
      capacity.bountyId !== award.bountyId ||
      !awardTermsCompatible(state, award, originalTerms, context) ||
      award.sourceInstrumentId !== capacity.sourceInstrumentId ||
      award.principalMinor !== capacity.principalMinor ||
      award.feeMinor !== capacity.feeMinor ||
      (award.supersedesAwardId === null &&
        (!same(award.beneficiary, submission.beneficiary) ||
          submission.termsDigest !== t.termsDigest)) ||
      v.workUnitId !== award.workUnitId ||
      (award.supersedesAwardId === null &&
        (!v.acceptance ||
          award.acceptedLineageDigest !== v.acceptance.lineageDigest)) ||
      (work.status !== "reserved" &&
        work.workBoundaryDigest !== accepted.workBoundaryDigest) ||
      !["reserved", "award-bound"].includes(capacity.status) ||
      !["reserved", "award-bound"].includes(work.status)
    )
      fail("held");
    if (
      (capacity.awardId !== null &&
        (capacity.awardId !== award.awardId ||
          capacity.intentId !== award.intentId)) ||
      (work.awardId !== null && work.awardId !== award.awardId) ||
      state.awards.some(
        (a) => a.awardId === award.awardId && !same(a, award),
      ) ||
      context.legacyReservations.some((r) =>
        r.intentIds.includes(award.intentId),
      ) ||
      state.settlementAttempts.some(
        (a) =>
          a.intentId === award.intentId &&
          (a.awardId !== award.awardId ||
            a.intentDigest !== award.intentDigest),
      )
    )
      fail("replay-conflict");
    conflicts(
      work.workUnitId,
      work,
      state,
      context,
      equivalences(state, context),
    );
    return {
      capacityReservation: {
        ...structuredClone(capacity),
        awardId: award.awardId,
        intentId: award.intentId,
        status: "award-bound",
        expectedRevision: state.revision,
      },
      workReservation: {
        ...structuredClone(work),
        workBoundaryDigest: accepted.workBoundaryDigest,
        awardId: award.awardId,
        status: "award-bound",
        expectedRevision: state.revision,
      },
    };
  });
}

/** A successor preserves the original backing. All historical links and exact
 * consent/old-authority approvals must remain available to every consumer. */
function awardTermsCompatible(
  state: BountyState,
  award: AwardRecord,
  original: BountyTerms,
  context: EvidenceContext,
): boolean {
  const economic = (t: BountyTerms) => ({
    bountyId: t.bountyId,
    projectId: t.projectId,
    repositoryId: t.repositoryId,
    sourceInstrumentId: t.sourceInstrumentId,
    principalMinor: t.principalMinor,
    feeRule: t.feeRule,
    feeRecipient: t.feeRecipient,
    network: t.network,
    mint: t.mint,
    decimals: t.decimals,
    networkCostPolicy: t.networkCostPolicy,
    funders: t.funders,
  });
  if (!same(economic(award.terms), economic(original))) return false;
  const seen = new Set<string>();
  let current = award;
  const submission = one(
    state.submissions.filter((s) => s.submissionId === award.submissionId),
  );
  while (current.supersedesAwardId !== null) {
    if (seen.has(current.awardId)) return false;
    seen.add(current.awardId);
    const previous = one(
      state.awards.filter((a) => a.awardId === current.supersedesAwardId),
    );
    if (
      previous.state !== "superseded" ||
      previous.submissionId !== current.submissionId ||
      previous.workUnitId !== current.workUnitId ||
      previous.bountyId !== current.bountyId ||
      !same(economic(previous.terms), economic(original)) ||
      bountyAwardDigest(current) !== current.awardDigest
    )
      return false;
    const consent = one(
      context.successorConsents.filter(
        (c) => c.consentDigest === current.successorConsentDigest,
      ),
    );
    const { consentDigest, ...payload } = consent;
    provenance(consent.provenance, context);
    if (
      hash(payload) !== consentDigest ||
      consent.authenticatedActorId !== submission.admittedClaimantActorId ||
      consent.submissionId !== submission.submissionId ||
      consent.predecessorAwardId !== previous.awardId ||
      consent.predecessorAwardDigest !== previous.awardDigest ||
      consent.successorAwardDigest !== current.awardDigest ||
      consent.acceptedAt > context.now
    )
      return false;
    const roles = new Set<string>();
    for (const digest of current.predecessorDecisionDigests) {
      const d = one(
        context.humanDecisions.filter((d) => d.decisionDigest === digest),
      );
      const { decisionDigest, ...decisionPayload } = d;
      provenance(d.provenance, context);
      const ids =
        d.role === "creator"
          ? [previous.terms.authority.creatorActorId]
          : previous.terms.authority.reviewerActorIds;
      if (
        !["creator", "reviewer"].includes(d.role) ||
        !ids.includes(d.authenticatedActorId) ||
        d.termsDigest !== previous.terms.termsDigest ||
        d.awardDigest !== current.awardDigest ||
        d.submissionId !== submission.submissionId ||
        d.bountyId !== current.bountyId ||
        d.workUnitId !== current.workUnitId ||
        d.beneficiaryDigest !== current.beneficiary.beneficiaryDigest ||
        d.sourceInstrumentId !== current.sourceInstrumentId ||
        d.principalMinor !== current.principalMinor ||
        d.feeMinor !== current.feeMinor ||
        d.decision !== "approve" ||
        d.decidedAt > context.now ||
        hash(decisionPayload) !== decisionDigest
      )
        return false;
      const disclosure = one(
        context.relationshipDisclosures.filter(
          (x) =>
            x.disclosureDigest === d.relationshipDisclosureDigest &&
            x.actorId === d.authenticatedActorId,
        ),
      );
      const conflicts = [
        submission.admittedClaimantActorId,
        submission.attribution.controllerActorId,
        current.beneficiary.authenticatedActorId,
        previous.beneficiary.authenticatedActorId,
      ];
      const relationships = [...new Set(conflicts)].map((id) =>
        one(context.relationshipDisclosures.filter((x) => x.actorId === id)),
      );
      for (const row of relationships) provenance(row.provenance, context);
      if (
        conflicts.includes(d.authenticatedActorId) ||
        disclosure.relatedActorIds.some((id) => conflicts.includes(id)) ||
        relationships.some(
          (x) =>
            x.controllerGroupId === disclosure.controllerGroupId ||
            x.relatedActorIds.includes(d.authenticatedActorId),
        )
      )
        return false;
      const policy = one(
        context.reviewedPolicies.filter(
          (p) => p.policyDigest === d.policyDigest,
        ),
      );
      if (
        policy.environment !== context.environment ||
        !policy.projectIds.includes(original.projectId) ||
        !policy.repositoryIds.includes(original.repositoryId) ||
        policy.effectiveAt > d.decidedAt ||
        (policy.revokedAt !== null && policy.revokedAt <= d.decidedAt)
      )
        return false;
      roles.add(d.role);
    }
    if (!roles.has("creator") || !roles.has("reviewer")) return false;
    current = previous;
  }
  return (
    same(current.terms, original) &&
    same(current.beneficiary, submission.beneficiary) &&
    current.successorConsentDigest === null
  );
}

function awardLineage(
  a: AwardRecord,
  v: VerifiedResidentSubmission,
  c: EvidenceContext,
) {
  const l = one(
    c.acceptedLineages.filter(
      (l) => l.lineageDigest === a.acceptedLineageDigest,
    ),
  );
  const { lineageDigest, ...payload } = l;
  provenance(l.provenance, c);
  if (
    hash(payload) !== lineageDigest ||
    l.repositoryId !== v.repositoryId ||
    l.prNodeId !== v.prNodeId ||
    l.submittedCommit !== v.submittedCommit ||
    l.submittedTree !== v.submittedTree ||
    !a.terms.authority.acceptanceActorIds.includes(l.acceptanceActorId) ||
    l.acceptedAt > c.now
  )
    fail("held");
  return l;
}
