/** Disabled local reducer. Evidence is trusted adapter/fixture output, never an
 * untrusted request body. A durable caller must CAS the exact prior revision. */

import { sha256Hex } from "../sha256";
import { verifyWalletPossession } from "../wallet-possession";
import { residentWorkUnitId } from "./attestations";
import {
  bountyAwardDigest,
  bountyCommandDigest,
  bountyDigest,
  bountyDisputeDigest,
  bountyInteger,
  bountyPaymentPreview,
  bountyRefundPreview,
  bountyRefundProposalDigest,
  bountyUtc,
  canonicalBountyBytes,
  parseResidentAttestationBytes,
} from "./codec";
import type {
  AwardRecord,
  BountyCommand,
  BountyEvent,
  BountyEventDelta,
  BountySettlementPreview,
  BountySnapshot,
  BountyState,
  BountyTerms,
  EvidenceContext,
  DisputeEvidence,
  EvidenceProvenance,
  FrozenBeneficiary,
  HumanDecision,
  SettlementAttempt,
  SubmissionRecord,
  TransitionErrorCode,
  TransitionResult,
} from "./contracts";
import { TransitionError } from "./contracts";
import {
  assertBountyReservations,
  bindAwardReservation,
  reserveBountyCapacity,
  reserveWorkUnit,
} from "./reservations";
import { assertResidentTransition, freezeBeneficiary } from "./residents";
import { assertBountyTerms, bountyObligation } from "./terms";

const hash = (x: unknown) => sha256Hex(canonicalBountyBytes(x));
const same = (a: unknown, b: unknown) => hash(a) === hash(b);
function fail(code: TransitionErrorCode = "invalid"): never {
  throw new TransitionError(code);
}
function one<T>(rows: readonly T[], code: TransitionErrorCode = "invalid"): T {
  if (rows.length !== 1) fail(code);
  return rows[0];
}
function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof TransitionError) throw e;
    return fail();
  }
}
function provenance(p: EvidenceProvenance, c: EvidenceContext): void {
  if (p.kind === "local-synthetic") {
    if (c.environment !== "test" || !p.fixtureId) fail("unauthorized");
  } else if (
    p.kind !== "authenticated-adapter" ||
    !p.adapterId ||
    !p.adapterRevision ||
    bountyUtc(p.observedAt) > c.now
  )
    fail("unauthorized");
}
function record(value: object, key: string, c: EvidenceContext): void {
  const obj = value as Record<string, unknown>;
  const { [key]: digest, ...payload } = obj;
  if (hash(payload) !== digest) fail("unauthorized");
  if ("provenance" in obj) provenance(obj.provenance as EvidenceProvenance, c);
}
function snapshot(s: BountySnapshot): BountySnapshot {
  return structuredClone({
    revision: s.revision,
    terms: s.terms,
    bounties: s.bounties,
    submissions: s.submissions,
    awards: s.awards,
    workReservations: s.workReservations,
    capacityReservations: s.capacityReservations,
    nonces: s.nonces,
    settlementAttempts: s.settlementAttempts,
    refundDecisions: s.refundDecisions,
    receipts: s.receipts,
  });
}
function domainDigest(s: BountySnapshot): string {
  const { receipts: _r, ...data } = snapshot(s);
  return hash(data);
}
function upsert<T>(rows: readonly T[], value: T, key: keyof T): T[] {
  const matches = rows.filter((r) => r[key] === value[key]);
  if (matches.length > 1) fail();
  return matches.length
    ? rows.map((r) => (r[key] === value[key] ? structuredClone(value) : r))
    : [...rows, structuredClone(value)];
}
function delta(s: BountySnapshot, event: BountyEvent): BountySnapshot {
  const next = snapshot(s);
  const submission = (v: SubmissionRecord) => {
    const old = next.submissions.find((x) => x.submissionId === v.submissionId);
    if (old) {
      const {
        decisionDisputeEndsAt: _window,
        reviewStatus: _r,
        decisionDigests: _d,
        disputeDigests: _p,
        ...frozen
      } = old;
      const {
        decisionDisputeEndsAt: _window2,
        reviewStatus: _r2,
        decisionDigests: _d2,
        disputeDigests: _p2,
        ...replacement
      } = v;
      if (!same(frozen, replacement)) fail();
    }
    next.submissions = upsert(next.submissions, v, "submissionId");
  };
  const award = (v: AwardRecord) => {
    const old = next.awards.find((x) => x.awardId === v.awardId);
    if (old && bountyAwardDigest(old) !== bountyAwardDigest(v)) fail();
    if (bountyAwardDigest(v) !== v.awardDigest) fail();
    next.awards = upsert(next.awards, v, "awardId");
  };
  const bounty = (v: BountySnapshot["bounties"][number]) => {
    next.bounties = upsert(next.bounties, v, "bountyId");
  };
  const capacity = (v: BountySnapshot["capacityReservations"][number]) => {
    next.capacityReservations = upsert(
      next.capacityReservations,
      v,
      "capacityReservationId",
    );
  };
  const work = (v: BountySnapshot["workReservations"][number] | null) => {
    if (v)
      next.workReservations = upsert(
        next.workReservations,
        v,
        "workReservationId",
      );
  };
  const attempt = (v: SettlementAttempt) => {
    next.settlementAttempts = upsert(next.settlementAttempts, v, "attemptId");
  };
  const terms = (v: BountyTerms) => {
    const old = next.terms.find((t) => t.termsDigest === v.termsDigest);
    if (old && !same(old, v)) fail();
    next.terms = upsert(next.terms, v, "termsDigest");
  };
  switch (event.kind) {
    case "publish-terms":
      terms(event.delta.terms);
      bounty(event.delta.bounty);
      break;
    case "open-funded":
      bounty(event.delta.bounty);
      capacity(event.delta.capacityReservation);
      break;
    case "issue-nonce":
      next.nonces = upsert(next.nonces, event.delta.nonce, "nonceId");
      break;
    case "submit":
      submission(event.delta.submission);
      work(event.delta.workReservation);
      next.nonces = upsert(next.nonces, event.delta.nonce, "nonceId");
      break;
    case "propose-decision":
      terms(event.delta.terms);
      if (event.delta.predecessor) award(event.delta.predecessor);
      submission(event.delta.submission);
      award(event.delta.award);
      break;
    case "record-review":
      submission(event.delta.submission);
      award(event.delta.award);
      break;
    case "select-award":
      bounty(event.delta.bounty);
      submission(event.delta.submission);
      award(event.delta.award);
      if (event.delta.outcome === "selected") {
        capacity(event.delta.capacityReservation);
        work(event.delta.workReservation);
        attempt(event.delta.settlementAttempt);
      }
      break;
    case "reject-submission":
    case "withdraw-submission":
      submission(event.delta.submission);
      work(event.delta.workReservation);
      for (const a of event.delta.awards) award(a);
      break;
    case "hold":
      bounty(event.delta.bounty);
      if (event.delta.submission) submission(event.delta.submission);
      if (event.delta.award) award(event.delta.award);
      break;
    case "expire-opportunity":
      bounty(event.delta.bounty);
      break;
    case "retire-intent":
      attempt(event.delta.settlementAttempt);
      capacity(event.delta.capacityReservation);
      if (event.delta.award) award(event.delta.award);
      break;
    case "reconcile-payment":
      award(event.delta.award);
      attempt(event.delta.settlementAttempt);
      capacity(event.delta.capacityReservation);
      work(event.delta.workReservation);
      break;
    case "approve-refund":
    case "reconcile-refund":
      next.refundDecisions = upsert(
        next.refundDecisions,
        event.delta.refund,
        "decisionId",
      );
      attempt(event.delta.settlementAttempt);
      capacity(event.delta.capacityReservation);
      break;
    default:
      fail();
  }
  next.revision = event.nextRevision;
  return next;
}
function fold(
  base: BountySnapshot,
  events: readonly BountyEvent[],
): BountyState {
  if (base.receipts.length) fail("replay-conflict");
  bountyInteger(base.revision);
  let current = snapshot(base);
  const ids = new Set<string>();
  const commands = new Set<string>();
  for (const e of events) {
    if (
      e.previousRevision !== current.revision ||
      e.nextRevision !== (BigInt(current.revision) + 1n).toString() ||
      ids.has(e.eventId) ||
      commands.has(e.commandId)
    )
      fail("replay-conflict");
    bountyUtc(e.occurredAt);
    bountyDigest(e.commandDigest);
    const r = e.receipt;
    if (
      r.commandId !== e.commandId ||
      r.commandDigest !== e.commandDigest ||
      r.baseRevision !== e.previousRevision ||
      r.resultRevision !== e.nextRevision ||
      !same(r.eventIds, [e.eventId])
    )
      fail("replay-conflict");
    current = delta(current, e);
    if (domainDigest(current) !== r.resultDigest) fail("replay-conflict");
    current.receipts = [...current.receipts, structuredClone(r)];
    ids.add(e.eventId);
    commands.add(e.commandId);
  }
  return {
    ...current,
    history: { base: snapshot(base), events: structuredClone(events) },
  };
}
function validateHistory(s: BountyState): void {
  const rebuilt = fold(s.history.base, s.history.events);
  if (!same(snapshot(rebuilt), snapshot(s))) fail("replay-conflict");
}
export function foldBountyEvents(
  initial: BountyState,
  events: readonly BountyEvent[],
): BountyState {
  return checked(() => {
    validateHistory(initial);
    return fold(initial.history.base, [...initial.history.events, ...events]);
  });
}
function beneficiary(b: FrozenBeneficiary, c: EvidenceContext): void {
  const {
    beneficiaryDigest: _d,
    evidenceRevision: _r,
    frozenAt: _t,
    ...input
  } = b;
  if (!same(freezeBeneficiary(input, c), b)) fail("unauthorized");
}
function policy(d: HumanDecision, t: BountyTerms, c: EvidenceContext): void {
  record(d, "decisionDigest", c);
  if(new Set(d.resolvedDisputeDigests).size!==d.resolvedDisputeDigests.length||(d.decision!=="resolve-dispute"&&d.resolvedDisputeDigests.length))fail("unauthorized");
  for(const digest of d.resolvedDisputeDigests)bountyDigest(digest);
  bountyInteger(d.authenticatedActorId, true);
  const p = one(
    c.reviewedPolicies.filter((p) => p.policyDigest === d.policyDigest),
    "unauthorized",
  );
  record(p, "policyDigest", c);
  if (
    p.environment !== c.environment ||
    !p.projectIds.includes(t.projectId) ||
    !p.repositoryIds.includes(t.repositoryId) ||
    p.effectiveAt > d.decidedAt ||
    (p.revokedAt !== null && p.revokedAt <= c.now) ||
    bountyUtc(d.decidedAt) > c.now
  )
    fail("unauthorized");
}
function independent(
  d: HumanDecision,
  s: SubmissionRecord,
  a: AwardRecord,
  c: EvidenceContext,
  otherActors: readonly string[] = [],
): void {
  const disclosure = one(
    c.relationshipDisclosures.filter(
      (x) =>
        x.disclosureDigest === d.relationshipDisclosureDigest &&
        x.actorId === d.authenticatedActorId,
    ),
    "unauthorized",
  );
  provenance(disclosure.provenance, c);
  const ids = [
    s.admittedClaimantActorId,
    s.attribution.controllerActorId,
    a.beneficiary.authenticatedActorId,
    ...otherActors,
  ];
  const related = [...new Set(ids)].map((id) =>
    one(
      c.relationshipDisclosures.filter((x) => x.actorId === id),
      "held",
    ),
  );
  for (const row of related) provenance(row.provenance, c);
  if (
    ids.includes(d.authenticatedActorId) ||
    disclosure.relatedActorIds.some((id) => ids.includes(id)) ||
    related.some(
      (x) =>
        x.controllerGroupId === disclosure.controllerGroupId ||
        x.relatedActorIds.includes(d.authenticatedActorId),
    )
  )
    fail("unauthorized");
}
function decision(
  digest: string,
  a: AwardRecord,
  s: SubmissionRecord,
  c: EvidenceContext,
  terms = a.terms,
  otherActors: readonly string[] = [],
): HumanDecision {
  const d = one(
    c.humanDecisions.filter((d) => d.decisionDigest === digest),
    "unauthorized",
  );
  policy(d, terms, c);
  const allowed =
    d.role === "creator"
      ? [terms.authority.creatorActorId]
      : d.role === "reviewer"
        ? terms.authority.reviewerActorIds
        : d.role === "acceptance"
          ? terms.authority.acceptanceActorIds
          : d.role === "dispute"
            ? terms.authority.disputeActorIds
            : [];
  if (
    !allowed.includes(d.authenticatedActorId) ||
    d.bountyId !== a.bountyId ||
    d.termsDigest !== terms.termsDigest ||
    d.submissionId !== s.submissionId ||
    d.workUnitId !== a.workUnitId ||
    d.awardDigest !== a.awardDigest ||
    d.beneficiaryDigest !== a.beneficiary.beneficiaryDigest ||
    d.sourceInstrumentId !== a.sourceInstrumentId ||
    d.principalMinor !== a.principalMinor ||
    d.feeMinor !== a.feeMinor ||
    d.refundProposalDigest !== null ||
    d.workEquivalenceDigest !== null
  )
    fail("unauthorized");
  independent(d, s, a, c, otherActors);
  return d;
}
function independentApprovers(decisions:readonly HumanDecision[],c:EvidenceContext):void {
  const creators=decisions.filter(d=>d.role==="creator");
  const reviewers=decisions.filter(d=>d.role==="reviewer");
  for(const creator of creators)for(const reviewer of reviewers){
    const a=one(c.relationshipDisclosures.filter(d=>d.actorId===creator.authenticatedActorId),"held");
    const b=one(c.relationshipDisclosures.filter(d=>d.actorId===reviewer.authenticatedActorId),"held");
    if(a.actorId===b.actorId||a.controllerGroupId===b.controllerGroupId||a.relatedActorIds.includes(b.actorId)||b.relatedActorIds.includes(a.actorId))fail("unauthorized");
  }
}
function currentEligibility(s: SubmissionRecord, c: EvidenceContext): void {
  const v = one(
    c.verifiedSubmissions.filter(
      (v) => v.attestationDigest === s.attestationDigest,
    ),
    "unauthorized",
  );
  const signed = parseResidentAttestationBytes(v.attestationBytes);
  if (sha256Hex(v.attestationBytes) !== v.attestationDigest)
    fail("unauthorized");
  const rows = assertResidentTransition([], c.residents, c).filter(
    (r) => r.residentId === v.residentId,
  );
  const latest = rows.at(-1);
  const admitted = one(
    rows.filter((r) => r.revision === v.residentRevision),
    "unauthorized",
  );
  const p = one(
    c.reviewedPolicies.filter((p) => p.policyDigest === admitted.policyDigest),
    "unauthorized",
  );
  record(p, "policyDigest", c);
  const key = one(
    c.reviewedKeys.filter(
      (k) => k.issuer === signed.issuer && k.keyId === signed.keyId,
    ),
    "unauthorized",
  );
  provenance(key.provenance, c);
  if (
    latest?.state !== "active" ||
    key.policyDigest !== p.policyDigest ||
    key.effectiveAt > signed.issuedAt ||
    (key.revokedAt !== null && key.revokedAt <= c.now) ||
    p.environment !== c.environment ||
    p.effectiveAt > signed.issuedAt ||
    (p.revokedAt !== null && p.revokedAt <= c.now) ||
    !p.projectIds.includes(signed.projectId) ||
    !p.repositoryIds.includes(signed.repositoryId) ||
    !latest.repositoryIds.includes(signed.repositoryId)
  )
    fail("held");
}
function acceptance(
  a: AwardRecord,
  s: SubmissionRecord,
  c: EvidenceContext,
): void {
  const v = one(
    c.verifiedSubmissions.filter(
      (v) => v.attestationDigest === s.attestationDigest,
    ),
    "unauthorized",
  );
  const l = one(
    c.acceptedLineages.filter(
      (l) => l.lineageDigest === a.acceptedLineageDigest,
    ),
    "held",
  );
  record(l, "lineageDigest", c);
  if (
    (a.supersedesAwardId === null &&
      (!v.acceptance || !same(v.acceptance, l))) ||
    l.repositoryId !== s.attribution.repositoryId ||
    l.prNodeId !== s.attribution.prNodeId ||
    l.submittedCommit !== s.attribution.submittedCommit ||
    l.submittedTree !== s.attribution.submittedTree ||
    l.acceptedAt > c.now ||
    !a.terms.authority.acceptanceActorIds.includes(l.acceptanceActorId)
  )
    fail("held");
  const build = one(
    c.buildEvidence.filter(
      (b) =>
        b.evidenceDigest ===
        (l.acceptedBuildEvidenceDigest ?? v.buildEvidenceDigest),
    ),
    "held",
  );
  record(build, "evidenceDigest", c);
  const attested = parseResidentAttestationBytes(v.attestationBytes);
  const unchanged = l.acceptedTree === l.submittedTree;
  if (
    build.result !== "passed" ||
    build.repositoryId !== l.repositoryId ||
    build.tree !== l.acceptedTree ||
    build.observedAt > c.now ||
    build.toolPolicyRevision !== attested.toolPolicyRevision
  )
    fail("held");
  if (unchanged) {
    if (
      !same(build.artifactDigests, attested.artifactDigests) ||
      build.executionResultDigest !== attested.executionResultDigest ||
      ![l.submittedCommit, l.acceptedCommit].includes(build.commit)
    )
      fail("held");
  } else if (
    build.commit !== l.acceptedCommit ||
    build.evidenceDigest === v.buildEvidenceDigest ||
    l.acceptedBuildEvidenceDigest === null
  )
    fail("held");
  const manifest = one(
    c.publicationManifests.filter(
      (m) => m.manifestDigest === a.acceptedPublicationManifestDigest,
    ),
    "held",
  );
  record(manifest, "manifestDigest", c);
  if (
    manifest.repositoryId !== l.repositoryId ||
    manifest.submittedCommit !== l.acceptedCommit ||
    !same(manifest.artifactDigests, build.artifactDigests) ||
    manifest.licenseDigest !== a.terms.licenseDigest ||
    manifest.inboundTermsDigest !== a.terms.inboundTermsDigest
  )
    fail("held");
  const resident = one(
    c.residents.filter(
      (r) => r.residentId === v.residentId && r.revision === v.residentRevision,
    ),
  );
  const policyRow = one(
    c.reviewedPolicies.filter((p) => p.policyDigest === resident.policyDigest),
    "held",
  );
  record(policyRow, "policyDigest", c);
  if (
    policyRow.toolPolicyRevision !== build.toolPolicyRevision ||
    policyRow.effectiveAt > build.observedAt ||
    (policyRow.revokedAt !== null && policyRow.revokedAt <= c.now)
  )
    fail("held");
}
function active(a: AwardRecord, s: SubmissionRecord, state: BountyState): void {
  if (
    ["withdrawn", "rejected", "superseded", "retired", "paid"].includes(
      a.state,
    ) ||
    ["withdrawn", "rejected"].includes(s.reviewStatus) ||
    state.awards.some((x) => x.supersedesAwardId === a.awardId)
  )
    fail("held");
}
function addTime(at: string, ms: string): string {
  const result = Date.parse(bountyUtc(at)) + Number(bountyInteger(ms));
  if (!Number.isSafeInteger(result)) fail();
  return new Date(result).toISOString();
}
function actor(command: BountyCommand, ids: readonly string[]): void {
  if (!ids.includes(command.actorId)) fail("unauthorized");
}
function terms(state: BountyState, bountyId: string): BountyTerms {
  const b = one(state.bounties.filter((b) => b.bountyId === bountyId));
  return one(state.terms.filter((t) => t.termsDigest === b.termsDigest));
}
type Change = {
  [K in keyof BountyEventDelta]: {
    kind: K;
    delta: BountyEventDelta[K];
    reason?: string;
  };
}[keyof BountyEventDelta];
function change(
  state: BountyState,
  command: BountyCommand,
  c: EvidenceContext,
): Change {
  const getSubmission = (id: string) =>
    one(state.submissions.filter((s) => s.submissionId === id));
  const getAward = (id: string) =>
    one(state.awards.filter((a) => a.awardId === id));
  const getBounty = (id: string) =>
    one(state.bounties.filter((b) => b.bountyId === id));
  switch (command.kind) {
    case "publish-terms": {
      const t = assertBountyTerms(
        one(c.terms.filter((t) => t.termsDigest === command.termsDigest)),
      );
      actor(command, [t.authority.creatorActorId]);
      if (state.bounties.some((b) => b.bountyId === t.bountyId))
        fail("replay-conflict");
      return {
        kind: command.kind,
        delta: {
          terms: t,
          bounty: {
            bountyId: t.bountyId,
            termsDigest: t.termsDigest,
            opportunityStatus: "published-unfunded",
            capacityReservationId: null,
            acceptedSubmissionIds: [],
            winningAwardId: null,
          },
        },
      };
    }
    case "open-funded": {
      const b = getBounty(command.bountyId),
        t = terms(state, b.bountyId);
      actor(command, [t.authority.creatorActorId]);
      if (
        b.opportunityStatus !== "published-unfunded" ||
        t.termsDigest !== command.termsDigest
      )
        fail("held");
      const capacityReservation = reserveBountyCapacity(state, t, c);
      if (
        capacityReservation.fundingObservationDigest !==
        command.fundingObservationDigest
      )
        fail("held");
      returnProofs(t, capacityReservation.fundingObservationDigest, c);
      return {
        kind: command.kind,
        delta: {
          bounty: {
            ...b,
            opportunityStatus: "funded-open",
            capacityReservationId: capacityReservation.capacityReservationId,
          },
          capacityReservation,
        },
      };
    }
    case "issue-nonce": {
      const n = command.nonce,
        b = getBounty(n.bountyId),
        t = terms(state, n.bountyId);
      const residents = assertResidentTransition([], c.residents, c);
      const r = one(
        residents.filter(
          (r) =>
            r.residentId === n.residentId && r.revision === n.residentRevision,
        ),
        "unauthorized",
      );
      const p = one(
        c.reviewedPolicies.filter((p) => p.policyDigest === r.policyDigest),
        "unauthorized",
      );
      record(p, "policyDigest", c);
      actor(command, [r.controllerActorId]);
      if (
        b.opportunityStatus !== "funded-open" ||
        n.termsDigest !== t.termsDigest ||
        n.repositoryId !== t.repositoryId ||
        n.controllerActorId !== r.controllerActorId ||
        n.controllerRevision !== r.controllerRevision ||
        r.state !== "active" ||
        !r.repositoryIds.includes(t.repositoryId) ||
        n.acceptedAttestationDigest !== null ||
        n.issuedAt !== c.now ||
        bountyUtc(n.expiresAt) <= c.now ||
        n.expiresAt > t.submissionDeadline ||
        Date.parse(n.expiresAt) - Date.parse(n.issuedAt) >
          Number(p.maxAdmissionLifetimeMs) ||
        p.environment !== c.environment ||
        !p.projectIds.includes(t.projectId) ||
        !p.repositoryIds.includes(t.repositoryId) ||
        p.effectiveAt > c.now ||
        (p.revokedAt !== null && p.revokedAt <= c.now)
      )
        fail("held");
      if (
        state.nonces.some(
          (x) =>
            x.nonceId === n.nonceId ||
            (x.runId === n.runId && x.attemptId === n.attemptId),
        )
      )
        fail("replay-conflict");
      return { kind: command.kind, delta: { nonce: structuredClone(n) } };
    }
    case "submit": {
      const b = getBounty(command.bountyId),
        t = terms(state, b.bountyId);
      const n = one(state.nonces.filter((n) => n.nonceId === command.nonceId));
      const v = one(
        c.verifiedSubmissions.filter(
          (v) => v.attestationDigest === command.attestationDigest,
        ),
        "unauthorized",
      );
      const ben = one(
        c.beneficiaries.filter(
          (b) => b.beneficiaryDigest === command.beneficiaryDigest,
        ),
        "unauthorized",
      );
      beneficiary(ben, c);
      actor(command, [v.controllerActorId]);
      if (
        command.evidenceDigest !== v.attestationDigest ||
        sha256Hex(v.attestationBytes) !== v.attestationDigest ||
        v.evidenceRevision !== state.revision ||
        v.verifiedAt > c.now ||
        v.bountyId !== b.bountyId ||
        v.termsDigest !== t.termsDigest ||
        command.termsDigest !== t.termsDigest ||
        v.nonceId !== n.nonceId ||
        n.bountyId !== b.bountyId ||
        n.termsDigest !== t.termsDigest ||
        n.repositoryId !== v.repositoryId ||
        n.residentId !== v.residentId ||
        n.residentRevision !== v.residentRevision ||
        n.controllerActorId !== v.controllerActorId ||
        n.controllerRevision !== v.controllerRevision ||
        ben.residentId !== v.residentId ||
        ben.residentRevision !== v.residentRevision ||
        ben.controllerRevision !== v.controllerRevision
      )
        fail("unauthorized");
      if (n.acceptedAttestationDigest !== null) fail("replay-conflict");
      if (
        b.opportunityStatus !== "funded-open" ||
        c.now > t.submissionDeadline ||
        c.now >= n.expiresAt ||
        c.now < n.issuedAt ||
        !t.eligibleSubjectKinds.includes("resident")
      )
        fail("held");
      if (
        state.submissions.some(
          (s) =>
            s.submissionId === command.submissionId ||
            s.attestationDigest === v.attestationDigest,
        )
      )
        fail("replay-conflict");
      const work = reserveWorkUnit(state, v, c);
      const {
        residentId,
        residentRevision,
        controllerActorId,
        controllerRevision,
        repositoryId,
        prNodeId,
        submittedCommit,
        submittedTree,
        githubEvidenceDigest,
        buildEvidenceDigest,
        publicationManifestDigest,
      } = v;
      const submission: SubmissionRecord = {
        decisionDisputeEndsAt: null,
        submissionId: command.submissionId,
        bountyId: b.bountyId,
        termsDigest: t.termsDigest,
        subject: { kind: "resident", residentId: v.residentId },
        admittedClaimantActorId: command.actorId,
        attribution: {
          residentId,
          residentRevision,
          controllerActorId,
          controllerRevision,
          repositoryId,
          prNodeId,
          submittedCommit,
          submittedTree,
          githubEvidenceDigest,
          buildEvidenceDigest,
          publicationManifestDigest,
        },
        attestationDigest: v.attestationDigest,
        lineageDigest: v.acceptance?.lineageDigest ?? null,
        workUnitId: residentWorkUnitId(v.repositoryId, v.prNodeId),
        beneficiary: structuredClone(ben),
        submittedAt: c.now,
        reviewStatus: "submitted",
        decisionDigests: [],
        disputeDigests: [],
      };
      currentEligibility(submission,c);
      return {
        kind: command.kind,
        delta: {
          nonce: { ...n, acceptedAttestationDigest: v.attestationDigest },
          submission,
          workReservation: {
            ...work,
            submissionIds: [...work.submissionIds, submission.submissionId],
          },
        },
      };
    }
    case "propose-decision": {
      const s = getSubmission(command.submissionId),
        a = structuredClone(command.award),
        b = getBounty(s.bountyId);
      currentEligibility(s, c);
      assertBountyTerms(a.terms);
      beneficiary(a.beneficiary, c);
      if (
        b.winningAwardId !== null ||
        state.settlementAttempts.some((x) => x.bountyId === b.bountyId) ||
        ["withdrawn", "rejected", "disputed", "held"].includes(
          s.reviewStatus,
        ) ||
        ["held", "cancelled"].includes(b.opportunityStatus)
      )
        fail("held");
      if (
        state.awards.some(
          (x) => x.awardId === a.awardId || x.intentId === a.intentId,
        )
      )
        fail("replay-conflict");
      if (
        a.submissionId !== s.submissionId ||
        a.bountyId !== s.bountyId ||
        a.workUnitId !== s.workUnitId ||
        a.capacityReservationId !== b.capacityReservationId ||
        a.proposedAt !== c.now ||
        a.reviewEndsAt !== addTime(c.now, a.terms.reviewDurationMs) ||
        a.disputeEndsAt !==
          addTime(a.reviewEndsAt, a.terms.disputeDurationMs) ||
        a.state !== "under-review" ||
        a.approvedAt !== null ||
        a.paidAt !== null ||
        a.requiredHumanDecisionDigests.length ||
        a.predecessorDecisionDigests.length ||
        bountyAwardDigest(a) !== a.awardDigest
      )
        fail("invalid");
      const cap = one(
        state.capacityReservations.filter(
          (r) => r.capacityReservationId === a.capacityReservationId,
        ),
      );
      const original = terms(state, b.bountyId),
        money = bountyObligation(a.terms);
      if (
        a.principalMinor !== money.principalMinor ||
        a.feeMinor !== money.feeMinor ||
        a.sourceInstrumentId !== cap.sourceInstrumentId ||
        a.principalMinor !== cap.principalMinor ||
        a.feeMinor !== cap.feeMinor
      )
        fail("held");
      const o = one(
        c.fundingObservations.filter(
          (o) => o.observationDigest === cap.fundingObservationDigest,
        ),
      );
      if (bountyPaymentPreview(a, cap, o).intentDigest !== a.intentDigest)
        fail("unsafe-settlement");
      let predecessor: AwardRecord | null = null;
      if (a.supersedesAwardId === null) {
        if (
          a.successorConsentDigest !== null ||
          command.successorDecisionDigests.length ||
          state.awards.some((x) => x.submissionId === s.submissionId) ||
          a.terms.termsDigest !== s.termsDigest ||
          !same(a.beneficiary, s.beneficiary)
        )
          fail("held");
      } else {
        predecessor = getAward(a.supersedesAwardId);
        active(predecessor, s, state);
        if (
          predecessor.submissionId !== s.submissionId ||
          predecessor.workUnitId !== a.workUnitId
        )
          fail("held");
        const consent = one(
          c.successorConsents.filter(
            (x) => x.consentDigest === a.successorConsentDigest,
          ),
          "unauthorized",
        );
        record(consent, "consentDigest", c);
        if (
          consent.authenticatedActorId !== s.admittedClaimantActorId ||
          consent.submissionId !== s.submissionId ||
          consent.predecessorAwardId !== predecessor.awardId ||
          consent.predecessorAwardDigest !== predecessor.awardDigest ||
          consent.successorAwardDigest !== a.awardDigest ||
          consent.acceptedAt > c.now
        )
          fail("unauthorized");
        const previousTerms = predecessor.terms;
        const previousBeneficiary = predecessor.beneficiary.authenticatedActorId;
        const decisions = command.successorDecisionDigests.map((d) =>
          decision(d, a, s, c, previousTerms, [previousBeneficiary]),
        );
        if (
          !decisions.some(
            (d) => d.role === "creator" && d.decision === "approve",
          ) ||
          !decisions.some(
            (d) => d.role === "reviewer" && d.decision === "approve",
          )
        )
          fail("unauthorized");
        if (new Set(decisions.map((d) => d.authenticatedActorId)).size < 2)
          fail("unauthorized");
        independentApprovers(decisions,c);
        a.predecessorDecisionDigests = [...command.successorDecisionDigests];
        const changedCriteria =
          predecessor.terms.deliverableDigest !== a.terms.deliverableDigest ||
          predecessor.terms.acceptanceDigest !== a.terms.acceptanceDigest;
        const oldLineage = one(
          c.acceptedLineages.filter(
            (x) => x.lineageDigest === predecessor?.acceptedLineageDigest,
          ),
        );
        const fresh = one(
          c.acceptedLineages.filter(
            (x) => x.lineageDigest === a.acceptedLineageDigest,
          ),
        );
        if (
          (changedCriteria || oldLineage.acceptedTree !== fresh.acceptedTree) &&
          (fresh.lineageDigest === oldLineage.lineageDigest ||
            fresh.acceptedBuildEvidenceDigest ===
              oldLineage.acceptedBuildEvidenceDigest ||
            fresh.acceptedAt < predecessor.proposedAt)
        )
          fail("held");
        if (changedCriteria || oldLineage.acceptedTree !== fresh.acceptedTree) {
          const freshBuild = one(
            c.buildEvidence.filter(
              (b) => b.evidenceDigest === fresh.acceptedBuildEvidenceDigest,
            ),
            "held",
          );
          if (
            freshBuild.acceptanceTermsDigest !== a.terms.termsDigest ||
            freshBuild.observedAt < a.proposedAt ||
            freshBuild.commit !== fresh.acceptedCommit
          )
            fail("held");
        }
        predecessor = { ...predecessor, state: "superseded" };
      }
      // Original capacity remains authoritative; full successor-chain checks run
      // over the atomically assembled next state in reservations projection.
      if (original.sourceInstrumentId !== a.sourceInstrumentId) fail("held");
      acceptance(a, s, c);
      const accepted = decision(command.acceptanceDecisionDigest, a, s, c);
      if (accepted.role !== "acceptance" || accepted.decision !== "approve")
        fail("unauthorized");
      const proposed = decision(command.decisionDigest, a, s, c);
      actor(command, [proposed.authenticatedActorId]);
      if (proposed.role !== "creator" || proposed.decision !== "propose")
        fail("unauthorized");
      a.requiredHumanDecisionDigests = [accepted.decisionDigest];
      return {
        kind: command.kind,
        delta: {
          terms: a.terms,
          predecessor,
          award: a,
          submission: {
            ...s,
            reviewStatus: "under-review",
            decisionDigests: [
              ...s.decisionDigests,
              proposed.decisionDigest,
              accepted.decisionDigest,
              ...command.successorDecisionDigests,
            ],
          },
        },
      };
    }
    case "record-review": {
      const a = getAward(command.awardId),
        s = getSubmission(a.submissionId);
      active(a, s, state);
      const d = decision(command.decisionDigest, a, s, c);
      actor(command, [d.authenticatedActorId]);
      if (
        d.decidedAt < a.proposedAt ||
        a.requiredHumanDecisionDigests.includes(d.decisionDigest)
      )
        fail("replay-conflict");
      if (d.decision === "resolve-dispute") {
        if(d.role!=="dispute"||!same([...d.resolvedDisputeDigests].sort(),[...s.disputeDigests].sort()))fail("unauthorized");
        for(const id of s.disputeDigests) resolves(d,one(c.disputes.filter(x=>x.disputeDigest===id)),c);
      } else if (
        d.decision !== "approve" ||
        !["creator", "reviewer"].includes(d.role) ||
        ["held", "disputed"].includes(a.state)
      )
        fail("held");
      return {
        kind: command.kind,
        delta: {
          award: {
            ...a,
            state: "under-review",
            requiredHumanDecisionDigests: [
              ...a.requiredHumanDecisionDigests,
              d.decisionDigest,
            ],
          },
          submission: {
            ...s,
            reviewStatus: "under-review",
            decisionDigests: [...s.decisionDigests, d.decisionDigest],
          },
        },
      };
    }
    case "select-award": {
      const a = getAward(command.awardId),
        s = getSubmission(a.submissionId),
        b = getBounty(a.bountyId);
      active(a, s, state);
      actor(command, [
        a.terms.authority.creatorActorId,
        ...a.terms.authority.reviewerActorIds,
      ]);
      if (
        b.winningAwardId !== null ||
        state.settlementAttempts.some((x) => x.bountyId === b.bountyId) ||
        ["held", "disputed"].includes(a.state) ||
        ["held", "disputed"].includes(s.reviewStatus)
      )
        fail("held");
      const ds = command.decisionDigests.map((id) => decision(id, a, s, c));
      if (
        ds.some(
          (d) => !a.requiredHumanDecisionDigests.includes(d.decisionDigest),
        )
      )
        fail("unauthorized");
      independentApprovers(ds,c);
      const creators = ds.filter(
        (d) => d.role === "creator" && d.decision === "approve",
      );
      if (
        !creators.length &&
        c.now > a.terms.candidateSelection.decisionDeadline
      )
        return {
          kind: command.kind,
          reason: "Creator decision deadline missed; human escalation required",
          delta: {
            outcome: "held",
            bounty: { ...b, opportunityStatus: "held" },
            submission: { ...s, reviewStatus: "held" },
            award: { ...a, state: "held" },
          },
        };
      if (
        (b.opportunityStatus === "held" &&
          !ds.some(
            (d) => d.role === "dispute" && d.decision === "resolve-dispute",
          )) ||
        !creators.length ||
        !ds.some((d) => d.role === "reviewer" && d.decision === "approve") ||
        new Set(
          ds
            .filter((d) => ["creator", "reviewer"].includes(d.role))
            .map((d) => d.authenticatedActorId),
        ).size < 2 ||
        !ds.some((d) => d.role === "acceptance" && d.decision === "approve") ||
        c.now < a.reviewEndsAt ||
        c.now < a.disputeEndsAt ||
        c.disputes.some(
          (d) =>
            d.submissionId === s.submissionId &&
            d.resolvedByDecisionDigest === null,
        )
      )
        fail("held");
      for(const dispute of c.disputes.filter(d=>d.submissionId===s.submissionId)){
        checkDispute(dispute,c);
        if(dispute.resolvedByDecisionDigest===null||!a.requiredHumanDecisionDigests.includes(dispute.resolvedByDecisionDigest))fail("held");
        resolves(decision(dispute.resolvedByDecisionDigest,a,s,c),dispute,c);
      }
      currentEligibility(s, c);
      acceptance(a, s, c);
      beneficiary(a.beneficiary, c);
      let successor = a;
      while (successor.supersedesAwardId !== null) {
        const previous = getAward(successor.supersedesAwardId);
        for (const id of successor.predecessorDecisionDigests)
          decision(id, successor, s, c, previous.terms, [
            previous.beneficiary.authenticatedActorId,
          ]);
        successor = previous;
      }
      const bound = bindAwardReservation(state, a, c);
      const attempt: SettlementAttempt = {
        attemptId: `attempt-${a.intentId}`,
        intentId: a.intentId,
        intentDigest: a.intentDigest,
        bountyId: a.bountyId,
        awardId: a.awardId,
        refundDecisionId: null,
        capacityReservationId: a.capacityReservationId,
        sourceInstrumentId: a.sourceInstrumentId,
        principalMinor: a.principalMinor,
        feeMinor: a.feeMinor,
        status: "non-executable",
        transactionSignatures: [],
        settlementDigest: null,
        retirementEvidenceDigest: null,
      };
      return {
        kind: command.kind,
        delta: {
          outcome: "selected",
          bounty: {
            ...b,
            opportunityStatus: "awarded",
            winningAwardId: a.awardId,
            acceptedSubmissionIds: [
              ...new Set([...b.acceptedSubmissionIds, s.submissionId]),
            ],
          },
          submission: { ...s, reviewStatus: "approved" },
          award: { ...a, state: "approved-reserved", approvedAt: c.now },
          ...bound,
          settlementAttempt: attempt,
        },
      };
    }
    case "withdraw-submission":
    case "reject-submission": {
      const s = getSubmission(command.submissionId),
        b = getBounty(s.bountyId),
        t = terms(state, b.bountyId);
      if (
        ["withdrawn", "rejected"].includes(s.reviewStatus) ||
        state.awards.some(
          (a) =>
            a.submissionId === s.submissionId && a.awardId === b.winningAwardId,
        )
      )
        fail("held");
      let ds = s.decisionDigests;
      if (command.kind === "withdraw-submission") {
        actor(command, [s.admittedClaimantActorId]);
        if (!same(command.subject, s.subject)) fail("unauthorized");
      } else {
        const d = one(
          c.humanDecisions.filter(
            (d) => d.decisionDigest === command.decisionDigest,
          ),
          "unauthorized",
        );
        policy(d, t, c);
        actor(command, [d.authenticatedActorId]);
        if (
          ![
            t.authority.creatorActorId,
            ...t.authority.reviewerActorIds,
          ].includes(d.authenticatedActorId) ||
          !["creator","reviewer"].includes(d.role) ||
          (d.role === "creator" ? d.authenticatedActorId !== t.authority.creatorActorId : !t.authority.reviewerActorIds.includes(d.authenticatedActorId)) ||
          d.decision !== "reject" ||
          d.bountyId !== s.bountyId ||
          d.termsDigest !== s.termsDigest ||
          d.submissionId !== s.submissionId ||
          d.workUnitId !== s.workUnitId
        )
          fail("unauthorized");
        ds = [...ds, d.decisionDigest];
      }
      const status =
        command.kind === "withdraw-submission" ? "withdrawn" : "rejected";
      const windows=[...(s.decisionDisputeEndsAt?[s.decisionDisputeEndsAt]:[]),...state.awards.filter(a=>a.submissionId===s.submissionId).map(a=>a.disputeEndsAt),...(status==="rejected"?[addTime(c.now,t.disputeDurationMs)]:[])];
      const decisionDisputeEndsAt=windows.sort().at(-1)??null;
      return {
        kind: command.kind,
        delta: {
          submission: { ...s, reviewStatus: status, decisionDigests: ds, decisionDisputeEndsAt },
          workReservation: null,
          awards: state.awards
            .filter(
              (a) =>
                a.submissionId === s.submissionId && a.state !== "superseded",
            )
            .map((a) => ({ ...a, state: status })),
        },
      };
    }
    case "hold": {
      const b = getBounty(command.bountyId),
        t = terms(state, b.bountyId);
      const s = command.submissionId
          ? getSubmission(command.submissionId)
          : null,
        a = command.awardId ? getAward(command.awardId) : null;
      if (
        (s && s.bountyId !== b.bountyId) ||
        (a && (a.bountyId !== b.bountyId || a.submissionId !== s?.submissionId))
      )
        fail();
      let dispute: string | null = null;
      if (command.disputeDigest) {
        const d = one(
          c.disputes.filter((d) => d.disputeDigest === command.disputeDigest),
          "unauthorized",
        );
        checkDispute(d,c);
        actor(command, [d.authenticatedActorId]);
        if (
          !s ||
          d.submissionId !== s.submissionId ||
          d.bountyId !== b.bountyId ||
          d.raisedAt > c.now ||
          d.resolvedByDecisionDigest !== null ||
          ![
            s.admittedClaimantActorId,
            t.authority.creatorActorId,
            ...t.authority.disputeActorIds,
          ].includes(d.authenticatedActorId)
        )
          fail("unauthorized");
        dispute = d.disputeDigest;
      } else
        actor(command, [
          t.authority.creatorActorId,
          ...t.authority.disputeActorIds,
        ]);
      return {
        kind: command.kind,
        delta: {
          bounty: { ...b, opportunityStatus: "held" },
          submission: s
            ? {
                ...s,
                reviewStatus: dispute ? "disputed" : "held",
                disputeDigests: dispute
                  ? [...s.disputeDigests, dispute]
                  : s.disputeDigests,
              }
            : null,
          award:
            a && a.state !== "paid"
              ? { ...a, state: dispute ? "disputed" : "held" }
              : a,
        },
      };
    }
    case "expire-opportunity": {
      const b = getBounty(command.bountyId),
        t = terms(state, b.bountyId);
      actor(command, [
        t.authority.creatorActorId,
        ...t.authority.disputeActorIds,
      ]);
      if (
        t.termsDigest !== command.termsDigest ||
        c.now <= t.submissionDeadline ||
        b.winningAwardId !== null
      )
        fail("held");
      return {
        kind: command.kind,
        delta: { bounty: { ...b, opportunityStatus: "expired" } },
      };
    }
    case "reconcile-payment":
    case "reconcile-refund":
      return reconcile(state, command, c);
    case "approve-refund":
      return refund(state, command, c);
    case "retire-intent": {
      const attempt = one(
        state.settlementAttempts.filter((a) => a.intentId === command.intentId),
      );
      const cap = one(
        state.capacityReservations.filter(
          (r) => r.capacityReservationId === attempt.capacityReservationId,
        ),
      );
      if (protectedDispute(state,attempt.bountyId,c))fail("unsafe-settlement");
      const e = one(
        c.retirementEvidence.filter(
          (e) => e.retirementDigest === command.retirementEvidenceDigest,
        ),
        "unsafe-settlement",
      );
      record(e, "retirementDigest", c);
      const d = one(
        c.humanDecisions.filter(
          (d) => d.decisionDigest === command.decisionDigest,
        ),
        "unauthorized",
      );
      const t = terms(state, attempt.bountyId);
      policy(d, t, c);
      actor(command, [d.authenticatedActorId]);
      if (
        !t.authority.retirementActorIds.includes(d.authenticatedActorId) ||
        d.role !== "retirement" ||
        d.decision !== "retire" ||
        d.intentId !== attempt.intentId ||
        d.intentDigest !== attempt.intentDigest ||
        e.humanDecisionDigest !== d.decisionDigest ||
        e.intentId !== attempt.intentId ||
        e.intentDigest !== attempt.intentDigest ||
        command.intentDigest !== attempt.intentDigest ||
        attempt.status === "paid" ||
        attempt.status === "retired"
      )
        fail("unsafe-settlement");
      // Projection checks exact non-executability and every protected claim.
      return {
        kind: command.kind,
        delta: {
          settlementAttempt: {
            ...attempt,
            status: "retired",
            retirementEvidenceDigest: e.retirementDigest,
          },
          capacityReservation: {
            ...cap,
            status: "retired",
            retirementEvidenceDigest: e.retirementDigest,
          },
          award: attempt.awardId
            ? { ...getAward(attempt.awardId), state: "retired" }
            : null,
        },
      };
    }
  }
}
function returnProofs(
  t: BountyTerms,
  observationDigest: string,
  c: EvidenceContext,
): void {
  const o = one(
    c.fundingObservations.filter(
      (o) => o.observationDigest === observationDigest,
    ),
    "held",
  );
  record(o, "observationDigest", c);
  for (const f of t.funders) {
    const e = one(
      c.funderReturnEvidence.filter(
        (e) => e.proofDigest === f.refundProofDigest,
      ),
      "held",
    );
    record(e, "proofDigest", c);
    const p = one(
      c.reviewedPolicies.filter((p) => p.policyDigest === e.reviewPolicyDigest),
      "unauthorized",
    );
    record(p, "policyDigest", c);
    if (
      e.funderActorId !== f.funderActorId ||
      e.sourceInstrumentId !== t.sourceInstrumentId ||
      e.returnDestination !== f.refundDestination ||
      e.network !== t.network ||
      e.mint !== t.mint ||
      e.fundingObservationDigest !== o.observationDigest ||
      e.sourceControllerConfigurationDigest !==
        o.controllerConfigurationDigest ||
      ![
        ...t.authority.reviewerActorIds,
        ...t.authority.retirementActorIds,
      ].includes(e.reviewedByActorId) ||
      e.reviewedAt > c.now ||
      e.effectiveAt > c.now ||
      (e.revokedAt !== null && e.revokedAt <= c.now) ||
      p.environment !== c.environment ||
      !p.projectIds.includes(t.projectId) ||
      !p.repositoryIds.includes(t.repositoryId) ||
      p.effectiveAt > e.reviewedAt ||
      (p.revokedAt !== null && p.revokedAt <= c.now)
    )
      fail("held");
    const { claim, proof } = e.destinationControl;
    provenance(claim.provenance, c);
    provenance(proof.provenance, c);
    if (
      e.destinationControl.kind !== "wallet-possession" ||
      claim.authenticatedActorId !== f.funderActorId ||
      claim.destination !== f.refundDestination ||
      proof.authenticatedActorId !== f.funderActorId ||
      proof.consumedAt === null ||
      proof.consumedAt > e.reviewedAt ||
      claim.observedAt > proof.consumedAt ||
      hash({ challenge: proof.challenge, signature: proof.signature }) !==
        proof.proofDigest
    )
      fail("held");
    verifyWalletPossession({
      challenge: proof.challenge,
      signature: proof.signature,
      claimId: claim.claimId,
      githubActorId: claim.authenticatedActorId,
      address: claim.destination,
      now: Date.parse(proof.consumedAt),
    });
  }
}
function checkDispute(dispute:DisputeEvidence,c:EvidenceContext):void {
  provenance(dispute.provenance,c);
  if(bountyDisputeDigest(dispute)!==dispute.disputeDigest||bountyUtc(dispute.raisedAt)>c.now)fail("unauthorized");
}
function resolves(d:HumanDecision,dispute:DisputeEvidence,c:EvidenceContext):void {
  checkDispute(dispute,c);
  if(d.decision!=="resolve-dispute"||d.role!=="dispute"||!d.resolvedDisputeDigests.includes(dispute.disputeDigest)||d.bountyId!==dispute.bountyId||d.submissionId!==dispute.submissionId||d.decidedAt<dispute.raisedAt||dispute.resolvedByDecisionDigest!==d.decisionDigest)fail("unauthorized");
}
function protectedDispute(state:BountyState,bountyId:string,c:EvidenceContext):boolean {
  if(state.submissions.some(s=>s.bountyId===bountyId&&s.decisionDisputeEndsAt!==null&&c.now<bountyUtc(s.decisionDisputeEndsAt)))return true;
  for(const dispute of c.disputes.filter(d=>d.bountyId===bountyId)){
    checkDispute(dispute,c);
    if(dispute.resolvedByDecisionDigest===null)return true;
    const submission=one(state.submissions.filter(s=>s.submissionId===dispute.submissionId));
    const t=one(state.terms.filter(t=>t.termsDigest===submission.termsDigest));
    const d=one(c.humanDecisions.filter(d=>d.decisionDigest===dispute.resolvedByDecisionDigest),"unauthorized");policy(d,t,c);resolves(d,dispute,c);
    if(d.role!=="dispute"||d.decision!=="resolve-dispute"||!t.authority.disputeActorIds.includes(d.authenticatedActorId)||d.bountyId!==bountyId||d.submissionId!==submission.submissionId||d.termsDigest!==t.termsDigest||d.workUnitId!==submission.workUnitId||d.sourceInstrumentId!==t.sourceInstrumentId)fail("unauthorized");
  }
  return false;
}
function refund(
  state: BountyState,
  command: Extract<BountyCommand, { kind: "approve-refund" }>,
  c: EvidenceContext,
): Change {
  const r = structuredClone(command.refund),
    b = one(state.bounties.filter((b) => b.bountyId === r.bountyId)),
    t = terms(state, r.bountyId);
  const cap = one(
    state.capacityReservations.filter(
      (x) => x.capacityReservationId === b.capacityReservationId,
    ),
  );
  if (
    protectedDispute(state,b.bountyId,c) ||
    cap.status !== "reserved" ||
    cap.intentId !== null ||
    b.winningAwardId !== null ||
    !["expired", "cancelled"].includes(b.opportunityStatus) ||
    state.settlementAttempts.some((a) => a.bountyId === b.bountyId) ||
    state.submissions.some(
      (s) =>
        s.bountyId === b.bountyId &&
        !["rejected", "withdrawn"].includes(s.reviewStatus),
    ) ||
    state.awards.some(
      (a) =>
        a.bountyId === b.bountyId &&
        !["rejected", "withdrawn", "superseded", "retired"].includes(a.state),
    )
  )
    fail("unsafe-settlement");
  if (
    r.termsDigest !== t.termsDigest ||
    bountyRefundProposalDigest(r) !== r.refundProposalDigest ||
    r.authorityDecisionDigest !== command.decisionDigest ||
    r.feeTreatment !== "no-fee" ||
    r.decidedAt !== c.now ||
    !r.legs.length ||
    state.refundDecisions.some((x) => x.decisionId === r.decisionId) ||
    new Set(r.legs.map((l) => l.funderActorId)).size !== r.legs.length
  )
    fail("unsafe-settlement");
  const d = one(
    c.humanDecisions.filter((d) => d.decisionDigest === command.decisionDigest),
    "unauthorized",
  );
  policy(d, t, c);
  actor(command, [d.authenticatedActorId]);
  const amount = r.legs
    .reduce((n, l) => n + BigInt(bountyInteger(l.amountMinor, true)), 0n)
    .toString();
  if (
    d.role !== "refund" ||
    d.decision !== "refund" ||
    !t.authority.retirementActorIds.includes(d.authenticatedActorId) ||
    d.bountyId !== r.bountyId ||
    d.termsDigest !== t.termsDigest ||
    d.refundProposalDigest !== r.refundProposalDigest ||
    d.awardDigest !== null ||
    d.submissionId !== null ||
    d.sourceInstrumentId !== cap.sourceInstrumentId ||
    d.principalMinor !== amount ||
    d.feeMinor !== "0"
  )
    fail("unauthorized");
  const disclosure = one(
    c.relationshipDisclosures.filter(
      (x) =>
        x.disclosureDigest === d.relationshipDisclosureDigest &&
        x.actorId === d.authenticatedActorId,
    ),
    "unauthorized",
  );
  provenance(disclosure.provenance, c);
  if (
    t.funders.some(
      (f) =>
        f.funderActorId === d.authenticatedActorId ||
        disclosure.relatedActorIds.includes(f.funderActorId),
    )
  )
    fail("unauthorized");
  returnProofs(t, cap.fundingObservationDigest, c);
  const o = one(
    c.fundingObservations.filter(
      (o) => o.observationDigest === cap.fundingObservationDigest,
    ),
  );
  const preview = bountyRefundPreview(r, t, cap, o);
  for (const l of r.legs) {
    const f = one(t.funders.filter((f) => f.funderActorId === l.funderActorId));
    if (
      l.returnDestination === o.sourceOwner ||
      l.sourceInstrumentId !== cap.sourceInstrumentId ||
      l.returnDestination !== f.refundDestination ||
      l.refundProofDigest !== f.refundProofDigest
    )
      fail("unsafe-settlement");
  }
  const attempt: SettlementAttempt = {
    attemptId: `attempt-${preview.intentId}`,
    intentId: preview.intentId,
    intentDigest: preview.intentDigest,
    bountyId: b.bountyId,
    awardId: null,
    refundDecisionId: r.decisionId,
    capacityReservationId: cap.capacityReservationId,
    sourceInstrumentId: cap.sourceInstrumentId,
    principalMinor: amount,
    feeMinor: "0",
    status: "non-executable",
    transactionSignatures: [],
    settlementDigest: null,
    retirementEvidenceDigest: null,
  };
  return {
    kind: command.kind,
    delta: {
      refund: r,
      capacityReservation: {
        ...cap,
        status: "refund-bound",
        intentId: preview.intentId,
        expectedRevision: state.revision,
      },
      settlementAttempt: attempt,
    },
  };
}
function reconcile(
  state: BountyState,
  command: Extract<
    BountyCommand,
    { kind: "reconcile-payment" | "reconcile-refund" }
  >,
  c: EvidenceContext,
): Change {
  const attempt = one(
    state.settlementAttempts.filter((a) => a.intentId === command.intentId),
    "unsafe-settlement",
  );
  const cap = one(
    state.capacityReservations.filter(
      (r) => r.capacityReservationId === attempt.capacityReservationId,
    ),
  );
  const o = one(
    c.fundingObservations.filter(
      (o) => o.observationDigest === cap.fundingObservationDigest,
    ),
  );
  record(o, "observationDigest", c);
  if (attempt.status === "paid" || attempt.status === "retired")
    fail("replay-conflict");
  let expected: BountySettlementPreview;
  const a =
    command.kind === "reconcile-payment"
      ? one(state.awards.filter((a) => a.awardId === command.awardId))
      : null;
  const r =
    command.kind === "reconcile-refund"
      ? one(
          state.refundDecisions.filter(
            (r) => r.decisionId === command.refundDecisionId,
          ),
        )
      : null;
  const t = a?.terms ?? terms(state, attempt.bountyId);
  actor(command, [
    t.authority.creatorActorId,
    ...t.authority.reviewerActorIds,
    ...t.authority.disputeActorIds,
  ]);
  if (a) {
    if (
      attempt.awardId !== a.awardId ||
      attempt.refundDecisionId !== null ||
      cap.awardId !== a.awardId ||
      a.intentId !== attempt.intentId ||
      a.intentDigest !== attempt.intentDigest ||
      one(state.bounties.filter((b) => b.bountyId === a.bountyId))
        .winningAwardId !== a.awardId
    )
      fail("unsafe-settlement");
    expected = bountyPaymentPreview(a, cap, o);
  } else {
    if (
      !r ||
      attempt.refundDecisionId !== r.decisionId ||
      attempt.awardId !== null ||
      r.refundProposalDigest !== bountyRefundProposalDigest(r)
    )
      fail("unsafe-settlement");
    expected = bountyRefundPreview(r, t, cap, o);
  }
  if (
    expected.intentId !== attempt.intentId ||
    expected.intentDigest !== attempt.intentDigest ||
    cap.intentId !== attempt.intentId ||
    o.sourceInstrumentId !== cap.sourceInstrumentId ||
    o.network !== t.network ||
    o.mint !== t.mint
  )
    fail("unsafe-settlement");
  const result = one(
    c.verifiedSettlements.filter(
      (x) => x.settlementDigest === command.settlementDigest,
    ),
    "unsafe-settlement",
  );
  record(result, "settlementDigest", c);
  const total = (kind: string) =>
    expected.legs
      .filter((l) => l.kind === kind)
      .reduce((n, l) => n + BigInt(l.amountMinor), 0n)
      .toString();
  if (
    result.previewDigest !== expected.previewDigest ||
    result.intentId !== expected.intentId ||
    result.intentDigest !== expected.intentDigest ||
    result.sourceInstrumentId !== expected.sourceInstrumentId ||
    result.principalMinor !== total("principal") ||
    result.feeMinor !== total("fee") ||
    result.refundMinor !== total("refund") ||
    bountyUtc(result.settledAt) > c.now ||
    !result.transactionSignatures.length ||
    result.transactionSignatures.length !==
      new Set(result.transactionSignatures).size ||
    result.observationDigests.length !== result.transactionSignatures.length ||
    result.slots.length !== result.transactionSignatures.length
  )
    fail("unsafe-settlement");
  for (let i = 0; i < result.observationDigests.length; i++) {
    const observed = one(
      c.settlementObservations.filter(
        (o) => o.observationDigest === result.observationDigests[i],
      ),
      "unsafe-settlement",
    );
    record(observed, "observationDigest", c);
    if (
      observed.finality !== "finalized" ||
      observed.network !== t.network ||
      observed.mint !== t.mint ||
      observed.transactionSignature !== result.transactionSignatures[i] ||
      observed.slot !== result.slots[i] ||
      observed.observedAt > result.settledAt
    )
      fail("unsafe-settlement");
  }
  if (
    state.settlementAttempts.some(
      (x) =>
        x.intentId !== attempt.intentId &&
        (x.settlementDigest === result.settlementDigest ||
          x.transactionSignatures.some((sig) =>
            result.transactionSignatures.includes(sig),
          )),
    ) ||
    c.verifiedSettlements.some(
      (x) =>
        x.intentId !== result.intentId &&
        x.observationDigests.some((id) =>
          result.observationDigests.includes(id),
        ),
    )
  )
    fail("replay-conflict");
  if (
    attempt.transactionSignatures.some(
      (sig) => !result.transactionSignatures.includes(sig),
    )
  )
    fail("unsafe-settlement");
  const settled = {
    ...attempt,
    status: "paid" as const,
    transactionSignatures: [...result.transactionSignatures],
    settlementDigest: result.settlementDigest,
  };
  if (a) {
    const w = one(
      state.workReservations.filter((w) => w.awardId === a.awardId),
    );
    return {
      kind: "reconcile-payment",
      delta: {
        award: { ...a, state: "paid", paidAt: result.settledAt },
        capacityReservation: { ...cap, status: "paid" },
        workReservation: { ...w, status: "paid" },
        settlementAttempt: settled,
      },
    };
  }
  if (!r) fail();
  return {
    kind: "reconcile-refund",
    delta: {
      refund: r,
      capacityReservation: { ...cap, status: "refunded" },
      settlementAttempt: settled,
    },
  };
}
function commandEvidence(command:BountyCommand,admissionDigest:string):string[] {
  const refs=[admissionDigest,command.evidenceDigest];
  if("decisionDigest" in command)refs.push(command.decisionDigest);
  if("decisionDigests" in command)refs.push(...command.decisionDigests);
  if(command.kind==="propose-decision")refs.push(command.acceptanceDecisionDigest,...command.successorDecisionDigests,command.award.awardDigest,command.award.acceptedLineageDigest,command.award.acceptedPublicationManifestDigest,...(command.award.successorConsentDigest?[command.award.successorConsentDigest]:[]));
  if(command.kind==="submit")refs.push(command.attestationDigest,command.beneficiaryDigest);
  if("settlementDigest" in command)refs.push(command.settlementDigest);
  if("retirementEvidenceDigest" in command)refs.push(command.retirementEvidenceDigest);
  if(command.kind==="hold"&&command.disputeDigest)refs.push(command.disputeDigest);
  return [...new Set(refs)];
}
export function applyBountyCommand(
  state: BountyState,
  command: BountyCommand,
  context: EvidenceContext,
): TransitionResult {
  return checked(() => {
    validateHistory(state);
    const digest = bountyCommandDigest(command),
      priorReceipt = state.receipts.find(
        (r) => r.commandId === command.commandId,
      );
    if (priorReceipt) {
      if (priorReceipt.commandDigest !== digest) fail("replay-conflict");
      const index = state.history.events.findIndex(
        (e) => e.nextRevision === priorReceipt.resultRevision,
      );
      if (index < 0) fail("replay-conflict");
      const events = state.history.events.slice(0, index + 1);
      return {
        state: fold(state.history.base, events),
        events: structuredClone(
          events.filter((e) => e.commandId === command.commandId),
        ),
      };
    }
    bountyUtc(context.now);
    bountyInteger(command.expectedRevision);
    provenance(context.provenance, context);
    if (
      command.expectedRevision !== state.revision ||
      context.revision !== state.revision
    )
      fail("stale-revision");
    const admission = one(
      context.commandAdmissions.filter((a) => a.commandDigest === digest),
      "unauthorized",
    );
    record(admission, "admissionDigest", context);
    if (
      admission.authenticatedActorId !== command.actorId ||
      bountyUtc(admission.authenticatedAt) > context.now
    )
      fail("unauthorized");
    assertBountyReservations(state, context);
    const changed = change(state, command, context);
    const nextRevision = (BigInt(state.revision) + 1n).toString(),
      eventId = `event-${digest}`;
    const receipt = {
      commandId: command.commandId,
      commandDigest: digest,
      baseRevision: state.revision,
      resultRevision: nextRevision,
      eventIds: [eventId],
      resultDigest: "",
    };
    const event = {
      ...changed,
      eventId,
      commandId: command.commandId,
      commandDigest: digest,
      previousRevision: state.revision,
      nextRevision,
      actorId: command.actorId,
      evidenceDigests: commandEvidence(command, admission.admissionDigest),
      occurredAt: context.now,
      reason: changed.reason ?? command.reason,
      receipt,
    } as BountyEvent;
    const candidate = delta(state, event);
    receipt.resultDigest = domainDigest(candidate);
    const next = fold(state.history.base, [...state.history.events, event]);
    assertBountyReservations(next, { ...context, revision: nextRevision });
    return { state: next, events: [structuredClone(event)] };
  });
}
