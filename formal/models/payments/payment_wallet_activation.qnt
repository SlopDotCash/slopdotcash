// @source backend/payments/handler.ts
// @source migrations/0011_payments.sql
// @source migrations/0100_effective_payment_wallets.sql
// @evidence backend/payments/wallet-replacement.test.ts
// One actor/chain, two immutable registry claims, two authorization requests,
// two obligations and every outbox state. Each begin represents an already
// verified, consumed challenge while its claim was current. Signature, input,
// expiry and nonce-consumption failures are in api_payment_wallet_protocol.
// The remaining gap from consumed challenge to authorization is intentional.
// Authorization and outbox eligibility updates commit atomically. The final
// SELECT observes the effective authorized claim, which can differ from the
// newest unsigned intent. Old authorization rows are never rewritten.
// A missing or failed reply is not rollback. Existing metadata, database
// consistency, account binding and signature validity are assumptions here.
// No action dispatches a payment, signs a transaction or changes an obligation
// to paid. Readback success describes one observation, not future currentness.
module payment_wallet_activation {
  val ids = Set(1, 2)
  val states = Set("absent", "ready", "processing", "submitted", "paid", "held")
  type Request = { phase: str, claim: int, admitted: bool, added: bool,
    observedEffective: int, desired: str, response: str }
  val idle: Request = { phase: "unused", claim: 1, admitted: false, added: false,
    observedEffective: 0, desired: "none", response: "none" }
  var s: { configured: bool, tip: int, priorAuthorization: bool,
    authorized: Set[int], witnesses: int -> int,
    outbox: int -> str, initial: int -> str, matching: int -> bool,
    reserved: int -> bool, requests: int -> Request }
  action init = s' = { configured: false, tip: 1, priorAuthorization: false,
    authorized: Set(), witnesses: ids.mapBy(_ => 0),
    outbox: ids.mapBy(_ => "absent"), initial: ids.mapBy(_ => "absent"),
    matching: ids.mapBy(_ => true), reserved: ids.mapBy(_ => true),
    requests: ids.mapBy(_ => idle) }
  def effective(auth: Set[int]): int = if (auth.contains(2)) 2 else if (auth.contains(1)) 1 else s.tip
  action configure(first: str, second: str, secondMatches: bool, secondReserved: bool, authorized: bool): bool = all {
    not(s.configured), states.contains(first), states.contains(second),
    s' = s.with("configured", true).with("priorAuthorization", authorized)
      .with("authorized", if (authorized) Set(1) else Set())
      .with("outbox", Map(1 -> first, 2 -> second)).with("initial", Map(1 -> first, 2 -> second))
      .with("matching", Map(1 -> true, 2 -> secondMatches)).with("reserved", Map(1 -> true, 2 -> secondReserved)) }
  action replacement = all { s.configured, s.tip == 1, s' = s.with("tip", 2) }
  action begin(id: int, claim: int): bool = all {
    s.configured, ids.contains(id), claim == s.tip, s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, idle.with("phase", "batch").with("claim", claim).with("admitted", true))) }
  action batch(id: int): bool = {
    val request = s.requests.get(id)
    val added = request.claim == s.tip and not(s.authorized.contains(request.claim))
    val auth = if (added) s.authorized.union(Set(request.claim)) else s.authorized
    val eligible = auth.contains(request.claim) and effective(auth) == request.claim
    val nextOutbox = ids.mapBy(row => if (eligible and s.matching.get(row) and s.reserved.get(row)
      and Set("absent", "held").contains(s.outbox.get(row))) "ready" else s.outbox.get(row))
    all { request.phase == "batch",
      s' = s.with("authorized", auth).with("outbox", nextOutbox)
        .with("witnesses", if (added) s.witnesses.set(request.claim, id) else s.witnesses)
        .with("requests", s.requests.set(id, request.with("phase", "batch-reply").with("added", added))) }
  }
  action batchFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "batch", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "response").with("desired", "error"))) }
  }
  action batchReply(id: int, successful: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "batch-reply", s' = s.with("requests", s.requests.set(id,
      request.with("phase", if (successful) "readback" else "response")
        .with("desired", if (successful) "none" else "error"))) }
  }
  action readback(id: int, available: bool): bool = {
    val request = s.requests.get(id)
    val current = effective(s.authorized)
    val confirmed = s.authorized.contains(request.claim) and current == request.claim
    all { request.phase == "readback", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "response").with("observedEffective", if (available) current else 0)
        .with("desired", if (not(available)) "error" else if (confirmed) "200" else "409"))) }
  }
  action respond(id: int, delivered: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "response", s' = s.with("requests", s.requests.set(id,
      request.with("phase", "done").with("response", if (delivered) request.desired else "lost"))) }
  }
  action step = {
    nondet first = states.oneOf()
    nondet second = states.oneOf()
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf()
    nondet id = ids.oneOf()
    nondet claim = ids.oneOf()
    any { configure(first, second, a, b, c), replacement, begin(id, claim), batch(id), batchFailure(id),
      batchReply(id, a), readback(id, a), respond(id, a), s' = s }
  }
  val invariant = all {
    ids.contains(s.tip), s.authorized.subseteq(ids),
    ids.forall(row => {
      val originallyMutable = Set("absent", "held").contains(s.initial.get(row))
      all { states.contains(s.outbox.get(row)),
        not(originallyMutable and s.matching.get(row) and s.reserved.get(row)) implies s.outbox.get(row) == s.initial.get(row),
        s.outbox.get(row) != s.initial.get(row) implies s.outbox.get(row) == "ready" }
    }),
    ids.forall(claim => {
      val id = s.witnesses.get(claim)
      val witness = if (ids.contains(id)) s.requests.get(id) else idle
      not(s.authorized.contains(claim)) or (claim == 1 and s.priorAuthorization) or witness.added
    }),
    ids.forall(id => {
      val request = s.requests.get(id)
      all { request.added implies request.admitted and s.authorized.contains(request.claim),
        request.response == "200" implies request.observedEffective == request.claim and s.authorized.contains(request.claim) }
    }) }
  action ready = init.then(configure("held", "absent", true, true, false))
  action finished(id: int): bool = batch(id).then(batchReply(id, true)).then(readback(id, true)).then(respond(id, true))

  run authorizationQueuesEligibleHeldAndAbsentRowsTest = ready.then(begin(1, 1)).then(finished(1))
    .expect(s.authorized == Set(1) and s.outbox == Map(1 -> "ready", 2 -> "ready") and invariant)
  run otherActorOrChainRowIsUnchangedTest = init.then(configure("held", "held", false, true, false)).then(begin(1, 1)).then(finished(1))
    .expect(s.outbox.get(1) == "ready" and s.outbox.get(2) == "held" and invariant)
  run paidObligationDoesNotQueueAgainTest = init.then(configure("held", "absent", true, false, false)).then(begin(1, 1)).then(finished(1))
    .expect(s.outbox.get(2) == "absent" and invariant)
  run processingAndSubmittedOutboxesRemainUnchangedTest = init.then(configure("processing", "submitted", true, true, false)).then(begin(1, 1)).then(finished(1))
    .expect(s.outbox == Map(1 -> "processing", 2 -> "submitted") and invariant)
  run paidAndReadyOutboxesRemainUnchangedTest = init.then(configure("paid", "ready", true, true, false)).then(begin(1, 1)).then(finished(1))
    .expect(s.outbox == Map(1 -> "paid", 2 -> "ready") and invariant)
  run replacementBeforeBatchRejectsUnsignedOldClaimTest = ready.then(begin(1, 1)).then(replacement).then(finished(1))
    .expect(s.authorized == Set() and s.requests.get(1).response == "409" and s.outbox.get(1) == "held" and invariant)
  run unsignedSuccessorKeepsPriorAuthorizedClaimEffectiveTest = init.then(configure("held", "absent", true, true, true))
    .then(begin(1, 1)).then(replacement).then(finished(1))
    .expect(s.authorized == Set(1) and s.requests.get(1).response == "200" and s.outbox.get(1) == "ready" and invariant)
  run replacementAfterAuthorizationDoesNotEraseItTest = ready.then(begin(1, 1)).then(batch(1)).then(replacement)
    .then(batchReply(1, true)).then(readback(1, true)).then(respond(1, true))
    .expect(s.authorized == Set(1) and s.requests.get(1).response == "200" and invariant)
  run authorizedSuccessorChangesReadbackWithoutErasingHistoryTest = ready.then(begin(1, 1)).then(batch(1)).then(batchReply(1, true))
    .then(replacement).then(begin(2, 2)).then(finished(2)).then(readback(1, true)).then(respond(1, true))
    .expect(s.authorized == Set(1, 2) and s.requests.get(1).response == "409" and s.requests.get(2).response == "200" and invariant)
  run batchFailureKeepsOutboxAndAuthorizationUnchangedTest = ready.then(begin(1, 1)).then(batchFailure(1)).then(respond(1, true))
    .expect(s.authorized == Set() and s.outbox.get(1) == "held" and s.requests.get(1).response == "error" and invariant)
  run lostBatchReplyDoesNotUndoAuthorizationOrQueuedWorkTest = ready.then(begin(1, 1)).then(batch(1)).then(batchReply(1, false)).then(respond(1, true))
    .expect(s.authorized == Set(1) and s.outbox.get(1) == "ready" and s.requests.get(1).response == "error" and invariant)
  run failedReadbackDoesNotUndoAtomicBatchTest = ready.then(begin(1, 1)).then(batch(1)).then(batchReply(1, true)).then(readback(1, false)).then(respond(1, true))
    .expect(s.authorized == Set(1) and s.outbox.get(2) == "ready" and s.requests.get(1).response == "error" and invariant)
  run lostSuccessResponseRetainsFirstAuthorizationTest = ready.then(begin(1, 1)).then(batch(1)).then(batchReply(1, true)).then(readback(1, true)).then(respond(1, false))
    .expect(s.authorized == Set(1) and s.requests.get(1).response == "lost" and invariant)
  run secondValidChallengeCannotRewriteFirstAuthorizationTest = ready.then(begin(1, 1)).then(finished(1)).then(begin(2, 1)).then(finished(2))
    .expect(s.witnesses.get(1) == 1 and not(s.requests.get(2).added) and s.requests.get(2).response == "200" and invariant)
  run confirmedSnapshotCanPrecedeAuthorizedReplacementTest = ready.then(begin(1, 1)).then(batch(1)).then(batchReply(1, true)).then(readback(1, true))
    .then(replacement).then(begin(2, 2)).then(finished(2)).then(respond(1, true))
    .expect(effective(s.authorized) == 2 and s.requests.get(1).response == "200" and s.requests.get(1).observedEffective == 1 and invariant)
}
