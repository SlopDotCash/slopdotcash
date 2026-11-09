// @source workers/payment-executor/monthly-release.ts
// @source workers/payment-executor/index.ts
// @source workers/payment-executor/entrypoint.ts
// @source workers/payment-executor/binding-shared.ts
// @source backend/payments/monthly-reserve-release.ts
// @source contracts/evm/monthly-reserve.ts
// @source contracts/solana/monthly-reserve.ts
// @source contracts/solana/wallet-transactions.ts
// @evidence backend/payments/monthly.test.ts
// PRD sections 6, 11 (wrong-total reserve repair), and 12 STATE-02.
// Two overlapping requests to the same hosted signer DO; one project, month,
// network and deployment. Two registry/retained versions, message identities,
// chain observations and Solana lifetimes. The previous prepare/check models
// supply exact chain, cryptographic, candidate-selection and transaction rules.
// A message identity denotes the full (authority, message) journal key. Equal
// identity means equal authority and signed-message bytes; no hash collision
// is represented.
//
// Hosted storage contract: default Durable Object input gates isolate the
// get/initial-put sequence. index.ts supplies only local noble/viem signing and
// verification, with no external I/O before the signed-record put. Therefore
// hostedSign is one non-interleaving segment, not a whole-request mutex. A
// crash/refusal after the intent and a committed write with a lost reply are
// separate outcomes. Injected asynchronous/remote signers or stores without
// those gates are outside this hosted model, not allowed by its step relation.
// https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction
// https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#get
//
// Shared signature metadata is last-writer state, not an append-only proof
// history or a monotonically newest chain observation. Each completed owner
// plan is separately addressed by all its serialized bytes. Plan tuples below
// are byte-equivalence classes: message, selected capture, request manifest,
// builder evidence and (for Solana) fresh transaction lifetime. EVM lifetime
// is fixed. There are 32 possible tuples and at most two stored plans.
// Equal tuples coalesce; distinct tuples coexist. Initial signing evidence is
// not substituted for the builder's later evidence in the retained plan.
//
// GitHub/Pages admission, signer custody, hash/crypto truth, arbitrary candidate
// lists, malformed storage, and the actual chain are outside these bounds.
// Project/retained reads remain separate observations, not a continuous lock.
// No action broadcasts, pays, or releases funds. These scenarios are authored
// source projections only: no parser, test, simulation or verifier was run.
// The named existing test file is contextual source evidence; no concurrent
// hosted-DO conformance test or exact-source runtime result is claimed here.
module monthly_release_concurrent {
  val ids = Set(1, 2)
  type Plan = { message: int, capture: int, manifest: int, evidence: int, lifetime: int }
  type Metadata = { writer: int, manifest: int, evidence: int }
  type Request = { phase: str, expected: int, manifest: int, retained: int, capture: int,
    message: int, signingEvidence: int, builderMessage: int, builderEvidence: int,
    lifetime: int, reused: bool, signed: bool, finalProject: int, finalRetained: int,
    committed: bool, outcome: str }
  val empty: Request = { phase: "unused", expected: 1, manifest: 0, retained: 0, capture: 0,
    message: 0, signingEvidence: 0, builderMessage: 0, builderEvidence: 0,
    lifetime: 0, reused: false, signed: false, finalProject: 0, finalRetained: 0,
    committed: false, outcome: "none" }
  val noMetadata: Metadata = { writer: 0, manifest: 0, evidence: 0 }
  type State = { rail: str, project: int, retained: int, message: int,
    evidence: int, chain: str, requests: int -> Request, intents: Set[int],
    signatures: Set[int], metadata: int -> Metadata, signCount: int -> int,
    plans: Set[Plan], returned: Set[Plan] }
  var s: State
  def ended(request: Request, result: str): Request =
    request.with("phase", "done").with("outcome", result)
  pure def planFor(request: Request): Plan = { message: request.message, capture: request.capture,
    manifest: request.manifest, evidence: request.builderEvidence, lifetime: request.lifetime }
  action init = s' = { rail: "evm", project: 1, retained: 1, message: 1,
    evidence: 1, chain: "wrong-sum", requests: ids.mapBy(_ => empty),
    intents: Set(), signatures: Set(), metadata: ids.mapBy(_ => noMetadata),
    signCount: ids.mapBy(_ => 0), plans: Set(), returned: Set() }
  action chooseSolana = all { ids.forall(id => s.requests.get(id).phase == "unused"),
    s' = s.with("rail", "solana") }
  action reviseProject = all { s.project == 1, s' = s.with("project", 2) }
  action reviseRetained = all { s.retained == 1, s' = s.with("retained", 2) }
  action advanceEvidence = all { s.evidence == 1, s' = s.with("evidence", 2) }
  action changeMessage = all { s.message == 1, s' = s.with("message", 2) }
  action chainState(kind: str): bool = all { Set("wrong-sum", "held", "unavailable").contains(kind),
    s' = s.with("chain", kind) }
  action begin(id: int, expected: int): bool = all {
    ids.contains(id), ids.contains(expected), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, empty.with("phase", "project").with("expected", expected))) }
  action readProject(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "project",
      s' = s.with("requests", s.requests.set(id,
        if (s.project == request.expected) request.with("manifest", s.project).with("phase", "retained")
        else ended(request, "project-changed"))) }
  }
  // Capture byte identity is distinct from the complete retained-list epoch:
  // a later list may still select the same capture. Cryptographic acceptance
  // of a selected capture is part of the supplied inspection predicate.
  action readRetained(id: int, capture: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "retained", ids.contains(capture), s' = s.with("requests", s.requests.set(id,
      request.with("retained", s.retained).with("capture", capture).with("phase", "inspect"))) }
  }
  // A positive completed chain inspection, including the chain-specific reread
  // rules, is supplied by monthly_release_prepare. It may precede later RPCs.
  action inspect(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "inspect", s' = s.with("requests", s.requests.set(id,
      if (s.chain == "wrong-sum") request.with("message", s.message)
        .with("signingEvidence", s.evidence).with("phase", "sign-project")
      else ended(request, if (s.chain == "held") "held" else "evidence-error"))) }
  }
  action signProject(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "sign-project", s' = s.with("requests", s.requests.set(id,
      if (s.project == request.manifest) request.with("phase", "sign-retained")
      else ended(request, "project-changed"))) }
  }
  action signRetained(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "sign-retained", s' = s.with("requests", s.requests.set(id,
      if (s.retained == request.retained) request.with("phase", "local-sign")
      else ended(request, "allocation-changed"))) }
  }
  // No request can read an absent journal entry, yield to a competing signing
  // request, then publish its obsolete empty intent in this hosted segment.
  action hostedSign(id: int, delivered: bool): bool = {
    val request = s.requests.get(id)
    val reused = s.signatures.contains(request.message)
    val metadata: Metadata = { writer: id, manifest: request.manifest, evidence: request.signingEvidence }
    all { request.phase == "local-sign",
      s' = s.with("intents", s.intents.union(Set(request.message)))
        .with("signatures", s.signatures.union(Set(request.message)))
        .with("metadata", s.metadata.set(request.message, metadata))
        .with("signCount", if (reused) s.signCount else s.signCount.set(request.message, s.signCount.get(request.message) + 1))
        .with("requests", s.requests.set(id,
          request.with("signed", true).with("reused", reused)
            .with("phase", if (delivered) "build-inspect" else "done")
            .with("outcome", if (delivered) "none" else "signature-reply-lost"))) }
  }
  // Models interrupted/failed signing after the intent was stored. The local
  // computation may have completed before interruption; its unrecorded result
  // can be computed again on retry. This is not an exactly-once signing claim.
  // Once a verified signature exists this branch cannot replace it with an intent.
  action interruptedAfterIntent(id: int, computed: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "local-sign", not(s.signatures.contains(request.message)),
      s' = s.with("intents", s.intents.union(Set(request.message)))
        .with("signCount", if (computed) s.signCount.set(request.message, s.signCount.get(request.message) + 1) else s.signCount)
        .with("requests", s.requests.set(id, ended(request, "sign-error"))) }
  }
  action buildInspect(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "build-inspect", s' = s.with("requests", s.requests.set(id,
      if (s.chain == "wrong-sum") request.with("builderMessage", s.message)
        .with("builderEvidence", s.evidence).with("phase", "builder-signature")
      else ended(request, "builder-refused"))) }
  }
  action builderSignature(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "builder-signature", s' = s.with("requests", s.requests.set(id,
      if (request.builderMessage == request.message) request.with("phase", "simulate")
      else ended(request, "authority-or-message-changed"))) }
  }
  action simulate(id: int, succeeds: bool, lifetime: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "simulate", ids.contains(lifetime), s.rail == "solana" or lifetime == 1,
      s' = s.with("requests", s.requests.set(id,
        if (succeeds) request.with("lifetime", lifetime).with("phase", "final-project")
        else ended(request, "simulation-refused"))) }
  }
  action finalProject(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "final-project", s' = s.with("requests", s.requests.set(id,
      if (s.project == request.manifest) request.with("finalProject", s.project).with("phase", "final-retained")
      else ended(request, "project-changed"))) }
  }
  action finalRetained(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "final-retained", s' = s.with("requests", s.requests.set(id,
      if (s.retained == request.retained) request.with("finalRetained", s.retained).with("phase", "plan-write")
      else ended(request, "allocation-changed"))) }
  }
  action commitPlan(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "plan-write", s' = s.with("plans", s.plans.union(Set(planFor(request))))
      .with("requests", s.requests.set(id, request.with("committed", true).with("phase", "plan-reply"))) }
  }
  action planReply(id: int, delivered: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "plan-reply", s' = s.with("returned",
      if (delivered) s.returned.union(Set(planFor(request))) else s.returned)
      .with("requests", s.requests.set(id, ended(request, if (delivered) "ready" else "plan-reply-lost"))) }
  }
  action operationError(id: int): bool = {
    val request = s.requests.get(id)
    all { not(Set("unused", "done", "plan-reply").contains(request.phase)),
      s' = s.with("requests", s.requests.set(id, ended(request, "operation-error"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet version = ids.oneOf()
    nondet lifetime = ids.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet kind = Set("wrong-sum", "held", "unavailable").oneOf()
    any { chooseSolana, reviseProject, reviseRetained, advanceEvidence, changeMessage, chainState(kind),
      begin(id, version), readProject(id), readRetained(id, version), inspect(id), signProject(id), signRetained(id),
      hostedSign(id, yes), interruptedAfterIntent(id, yes), buildInspect(id), builderSignature(id), simulate(id, yes, lifetime),
      finalProject(id), finalRetained(id), commitPlan(id), planReply(id, yes), operationError(id), s' = s }
  }
  val invariant = all {
    s.signatures.subseteq(s.intents), s.returned.subseteq(s.plans), s.plans.size() <= 2,
    ids.forall(message => s.signCount.get(message) <= 2
      and (s.signatures.contains(message) implies s.signCount.get(message) >= 1)
      and (s.signatures.contains(message) == (s.metadata.get(message).writer != 0))),
    s.plans.forall(plan => s.signatures.contains(plan.message)
      and ids.contains(plan.capture) and ids.contains(plan.manifest) and ids.contains(plan.evidence) and ids.contains(plan.lifetime)),
    ids.forall(id => {
      val request = s.requests.get(id)
      all {
        request.signed implies s.signatures.contains(request.message),
        request.committed implies request.signed and request.builderMessage == request.message
          and request.finalProject == request.manifest and request.finalRetained == request.retained
          and s.plans.contains(planFor(request)),
        request.outcome == "ready" implies request.committed and s.returned.contains(planFor(request))
      }
    }) }
  action toLocalSign(id: int, version: int): bool = begin(id, version).then(readProject(id))
    .then(readRetained(id, 1)).then(inspect(id)).then(signProject(id)).then(signRetained(id))
  action signed(id: int): bool = toLocalSign(id, 1).then(hostedSign(id, true))
  action build(id: int, lifetime: int): bool = buildInspect(id).then(builderSignature(id)).then(simulate(id, true, lifetime))
  action save(id: int): bool = finalProject(id).then(finalRetained(id)).then(commitPlan(id))
  action complete(id: int): bool = build(id, 1).then(save(id)).then(planReply(id, true))

  run laterRequestReusesSignatureWhileFirstBuilderWaitsTest = init.then(signed(1)).then(advanceEvidence)
    .then(signed(2)).expect(s.requests.get(2).reused and s.metadata.get(1).writer == 2
      and s.requests.get(1).phase == "build-inspect" and s.signCount.get(1) == 1 and invariant)
  run lateOlderObservationRefreshesOnlySharedMetadataTest = init.then(toLocalSign(1, 1)).then(advanceEvidence)
    .then(signed(2)).then(hostedSign(1, true)).expect(s.metadata.get(1).writer == 1
      and s.metadata.get(1).evidence == 1 and s.requests.get(1).reused and s.signCount.get(1) == 1 and invariant)
  run equalCompletedPlanBytesCoalesceTest = init.then(signed(1)).then(signed(2))
    .then(complete(1)).then(complete(2)).expect(s.plans.size() == 1 and s.returned.size() == 1 and invariant)
  run distinctBuilderEvidencePlansCoexistTest = init.then(signed(1)).then(build(1, 1))
    .then(advanceEvidence).then(signed(2)).then(complete(2)).then(save(1)).then(planReply(1, true))
    .expect(s.plans.size() == 2 and s.metadata.get(1).writer == 2 and invariant)
  run solanaLifetimeChangesRetainBothOwnerPlansTest = init.then(chooseSolana).then(signed(1)).then(signed(2))
    .then(build(1, 1)).then(save(1)).then(planReply(1, true)).then(build(2, 2)).then(save(2)).then(planReply(2, true))
    .expect(s.plans.size() == 2 and s.signCount.get(1) == 1 and invariant)
  run distinctSelectedCaptureBytesRetainBothPlansTest = init.then(signed(1))
    .then(begin(2, 1)).then(readProject(2)).then(readRetained(2, 2)).then(inspect(2))
    .then(signProject(2)).then(signRetained(2)).then(hostedSign(2, true)).then(complete(1)).then(complete(2))
    .expect(s.plans.size() == 2 and s.requests.get(2).reused and invariant)
  run lostSignedRecordReplyStillAllowsReuseTest = init.then(toLocalSign(1, 1)).then(hostedSign(1, false))
    .then(signed(2)).expect(s.requests.get(1).outcome == "signature-reply-lost"
      and s.requests.get(2).reused and s.signCount.get(1) == 1 and invariant)
  run interruptedIntentDoesNotBlockLaterSigningTest = init.then(toLocalSign(1, 1)).then(interruptedAfterIntent(1, false))
    .then(signed(2)).expect(s.requests.get(1).outcome == "sign-error" and not(s.requests.get(2).reused)
      and s.signatures == Set(1) and invariant)
  run interruptedComputedSignatureMayBeRecomputedTest = init.then(toLocalSign(1, 1)).then(interruptedAfterIntent(1, true))
    .then(signed(2)).expect(s.signCount.get(1) == 2 and s.signatures == Set(1)
      and not(s.requests.get(2).reused) and invariant)
  run laterHeldInspectionPreservesEarlierSignatureTest = init.then(signed(1)).then(chainState("held"))
    .then(begin(2, 1)).then(readProject(2)).then(readRetained(2, 1)).then(inspect(2))
    .expect(s.requests.get(2).outcome == "held" and s.signatures == Set(1) and invariant)
  run changedMessageUsesSeparateSignatureAndPlanTest = init.then(signed(1)).then(build(1, 1)).then(changeMessage)
    .then(signed(2)).then(complete(2)).then(save(1)).then(planReply(1, true))
    .expect(s.signatures == Set(1, 2) and s.plans.size() == 2 and invariant)
  run projectChangeBeforeLocalSigningRefusesTest = init.then(begin(1, 1)).then(readProject(1)).then(readRetained(1, 1))
    .then(inspect(1)).then(reviseProject).then(signProject(1))
    .expect(s.requests.get(1).outcome == "project-changed" and s.signatures == Set() and invariant)
  run allocationChangeBeforeLocalSigningRefusesTest = init.then(begin(1, 1)).then(readProject(1)).then(readRetained(1, 1))
    .then(inspect(1)).then(signProject(1)).then(reviseRetained).then(signRetained(1))
    .expect(s.requests.get(1).outcome == "allocation-changed" and s.signatures == Set() and invariant)
  run failedFinalFenceCannotEraseAnotherReadyPlanTest = init.then(signed(1)).then(signed(2)).then(complete(2))
    .then(build(1, 1)).then(reviseProject).then(finalProject(1))
    .expect(s.requests.get(1).outcome == "project-changed" and s.requests.get(2).outcome == "ready"
      and s.plans.size() == 1 and s.signatures == Set(1) and invariant)
  run lostPlanReplyRetainsExactPlanForEqualRetryTest = init.then(signed(1)).then(build(1, 1)).then(save(1))
    .then(planReply(1, false)).then(signed(2)).then(complete(2))
    .expect(s.requests.get(1).outcome == "plan-reply-lost" and s.plans.size() == 1
      and s.requests.get(2).reused and invariant)
  run currentManifestRetryKeepsPriorExactPlanTest = init.then(signed(1)).then(build(1, 1)).then(save(1))
    .then(reviseProject).then(toLocalSign(2, 2)).then(hostedSign(2, true)).then(complete(2)).then(planReply(1, true))
    .expect(s.plans.size() == 2 and s.requests.get(2).reused and s.metadata.get(1).manifest == 2 and invariant)
  run responsesMayArriveInReverseOrderTest = init.then(signed(1)).then(signed(2)).then(build(1, 1)).then(save(1))
    .then(build(2, 1)).then(save(2)).then(planReply(2, true)).then(planReply(1, true))
    .expect(s.requests.get(1).outcome == "ready" and s.requests.get(2).outcome == "ready" and invariant)
  run laterMessageRefusesOldBuilderWithoutErasingSignaturesTest = init.then(signed(1)).then(changeMessage)
    .then(signed(2)).then(buildInspect(1)).then(builderSignature(1))
    .expect(s.requests.get(1).outcome == "authority-or-message-changed" and s.signatures == Set(1, 2) and invariant)
  run lastRegistryReadDoesNotLockPlanPublicationTest = init.then(signed(1)).then(build(1, 1))
    .then(finalProject(1)).then(finalRetained(1)).then(reviseProject).then(commitPlan(1)).then(planReply(1, true))
    .expect(s.project == 2 and s.requests.get(1).outcome == "ready" and invariant)
}
