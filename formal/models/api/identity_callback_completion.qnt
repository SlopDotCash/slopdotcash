// @source workers/identity/handler.ts
// @source workers/identity/persistence.ts
// @source workers/identity/contracts.ts
// @source migrations/0108_identity_failed_callback.sql
// @evidence workers/identity/failed-callback.test.ts
// @evidence workers/identity/expiry-boundary.test.ts
// One existing flow, two callback requests, one claim, clock ranks 0..3 and
// expiry rank 2. The route is already admitted by the outer handler. Each
// request has a fixed state/cookie/code-validation predicate; authorization
// denial may omit the code. URL parsing and exact error payloads are abstract.
// The SQL claim SELECT and conditional UPDATE are separate. Captured claim and
// completion times, not the later wall clock, are passed to SQL. Expired cleanup
// may delete the row between awaits. No recreation, assertion issuance or poll
// transitions occur here; api_identity abstracts that subsequent protocol.
// Resolver predicates come from github_identity_exchange. A valid basic
// identity is sufficient for private-trace audience; Points also needs node ID.
// Each SQL effect and its observed reply are separate. A thrown/lost reply may
// follow a commit. A resolved reply without meta.changes == 1 fails closed too;
// visible change counts are assumed accurate, never fabricated positive counts.
// Generic errors map to outer-error; exact ApiError payloads,
// browser delivery, crypto correctness, clock rollback and provider behavior
// are outside this bound. No fairness or successful retry is assumed.
// verifierHeld describes only the local string slot, not memory erasure.
module identity_callback_completion {
  val ids = Set(1, 2)
  val expiry = 2
  val identities = Set("thrown", "null", "basic", "node")
  type Callback = { phase: str, claimStamp: int, completionStamp: int,
    denied: bool, snapshotCipher: bool, snapshotIv: bool, claimAccepted: bool,
    verifierHeld: bool, verified: bool, node: bool, failureCause: str,
    failureChanged: bool, completeAccepted: bool, desired: str, response: str,
    clearCookieHeader: bool }
  val unused: Callback = { phase: "unused", claimStamp: -1, completionStamp: -1,
    denied: false, snapshotCipher: false, snapshotIv: false, claimAccepted: false,
    verifierHeld: false, verified: false, node: false, failureCause: "none",
    failureChanged: false, completeAccepted: false, desired: "none", response: "none",
    clearCookieHeader: false }
  def ending(request: Callback, response: str): Callback =
    request.with("phase", "finish").with("desired", response)
  var s: { configured: bool, points: bool, now: int, present: bool,
    rowStatus: str, cipher: bool, iv: bool, claimedBy: int, claims: int,
    completedBy: int, completions: int, storedNode: bool, completedAt: int,
    requests: int -> Callback }
  action init = s' = { configured: false, points: false, now: 0, present: true,
    rowStatus: "pending", cipher: true, iv: true, claimedBy: 0, claims: 0,
    completedBy: 0, completions: 0, storedNode: false, completedAt: -1,
    requests: ids.mapBy(_ => unused) }
  action configure(points: bool, cipher: bool, iv: bool): bool = all {
    not(s.configured), s' = s.with("configured", true).with("points", points)
      .with("cipher", cipher).with("iv", iv) }
  action tick = all { s.configured, s.now < 3, s' = s.with("now", s.now + 1) }
  action cleanup = all { s.configured, s.present, s.now >= expiry,
    s' = s.with("present", false).with("rowStatus", "absent")
      .with("cipher", false).with("iv", false) }
  action begin(id: int, bound: bool, denied: bool): bool = all {
    s.configured, ids.contains(id), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, unused.with("denied", denied)
      .with("phase", if (bound) "hash" else "finish")
      .with("desired", if (bound) "none" else "html-400"))) }
  action hashReply(id: int, ok: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "hash",
      s' = s.with("requests", s.requests.set(id,
        if (ok) request.with("phase", "claim-read").with("claimStamp", s.now)
        else ending(request, "outer-error"))) }
  }
  action claimRead(id: int): bool = {
    val request = s.requests.get(id)
    val found = s.present and s.rowStatus == "pending" and request.claimStamp < expiry
    all { request.phase == "claim-read",
      s' = s.with("requests", s.requests.set(id,
        if (found) request.with("phase", "claim-write")
          .with("snapshotCipher", s.cipher).with("snapshotIv", s.iv)
        else ending(request, "html-410"))) }
  }
  action claimWrite(id: int): bool = {
    val request = s.requests.get(id)
    val accepted = s.present and s.rowStatus == "pending" and request.claimStamp < expiry
    all { request.phase == "claim-write",
      s' = s.with("rowStatus", if (accepted) "callback_processing" else s.rowStatus)
        .with("cipher", if (accepted) false else s.cipher)
        .with("iv", if (accepted) false else s.iv)
        .with("claimedBy", if (accepted) id else s.claimedBy)
        .with("claims", if (accepted) s.claims + 1 else s.claims)
        .with("requests", s.requests.set(id, request.with("phase", "claim-reply")
          .with("claimAccepted", accepted))) }
  }
  action claimReply(id: int, received: bool, changeCountVisible: bool): bool = {
    val request = s.requests.get(id)
    val available = request.claimAccepted and changeCountVisible and request.snapshotCipher and request.snapshotIv
    all { request.phase == "claim-reply",
      s' = s.with("requests", s.requests.set(id,
        if (not(received)) ending(request, "outer-error")
        else if (not(available)) ending(request, "html-410")
        else if (request.denied) request.with("phase", "fail-write")
          .with("failureCause", "authorization").with("desired", "html-400")
        else request.with("phase", "decrypt"))) }
  }
  action decrypt(id: int, ok: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "decrypt",
      s' = s.with("requests", s.requests.set(id,
        if (ok) request.with("phase", "resolve").with("verifierHeld", true)
        else request.with("phase", "fail-write").with("failureCause", "decrypt")
          .with("desired", "outer-error"))) }
  }
  action resolve(id: int, identity: str): bool = {
    val request = s.requests.get(id)
    val thrown = identity == "thrown"
    val refused = identity == "null" or (s.points and identity == "basic")
    all { request.phase == "resolve", identities.contains(identity),
      s' = s.with("requests", s.requests.set(id,
        if (thrown or refused) request.with("phase", "fail-write")
          .with("verifierHeld", thrown)
          .with("failureCause", if (thrown) "resolver" else if (identity == "null") "unverified" else "points-node")
          .with("desired", if (thrown) "outer-error" else "html-502")
        else request.with("phase", "completion-clock").with("verifierHeld", false)
          .with("verified", true).with("node", identity == "node"))) }
  }
  action failureWrite(id: int): bool = {
    val request = s.requests.get(id)
    val changed = s.present and s.rowStatus == "callback_processing"
    all { request.phase == "fail-write",
      s' = s.with("rowStatus", if (changed) "callback_failed" else s.rowStatus)
        .with("requests", s.requests.set(id, request.with("phase", "fail-reply")
          .with("failureChanged", changed))) }
  }
  action failureReply(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "fail-reply",
      s' = s.with("requests", s.requests.set(id,
        ending(request, if (received) request.desired else "outer-error"))) }
  }
  action completionClock(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "completion-clock",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "complete-write")
        .with("completionStamp", s.now))) }
  }
  action completeWrite(id: int): bool = {
    val request = s.requests.get(id)
    val accepted = s.present and s.rowStatus == "callback_processing" and request.completionStamp < expiry
    all { request.phase == "complete-write",
      s' = s.with("rowStatus", if (accepted) "callback_complete" else s.rowStatus)
        .with("completedBy", if (accepted) id else s.completedBy)
        .with("completions", if (accepted) s.completions + 1 else s.completions)
        .with("storedNode", if (accepted) request.node else s.storedNode)
        .with("completedAt", if (accepted) request.completionStamp else s.completedAt)
        .with("requests", s.requests.set(id, request.with("phase", "complete-reply")
          .with("completeAccepted", accepted))) }
  }
  action completeReply(id: int, received: bool, changeCountVisible: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "complete-reply",
      s' = s.with("requests", s.requests.set(id, ending(request,
        if (not(received)) "outer-error" else if (request.completeAccepted and changeCountVisible) "html-200" else "html-409"))) }
  }
  // A rejection before a statement's effect does not roll back earlier effects.
  action awaitFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { Set("claim-read", "claim-write", "fail-write", "completion-clock", "complete-write").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, ending(request, "outer-error"))) }
  }
  action finish(id: int, constructed: bool): bool = {
    val request = s.requests.get(id)
    val response = if (constructed) request.desired else "outer-error"
    all { request.phase == "finish",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done")
        .with("verifierHeld", false).with("response", response)
        .with("clearCookieHeader", response == "html-200"))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet third = Set(false, true).oneOf()
    nondet identity = identities.oneOf()
    any { configure(yes, other, third), tick, cleanup, begin(id, yes, other),
      hashReply(id, yes), claimRead(id), claimWrite(id), claimReply(id, yes, other),
      decrypt(id, yes), resolve(id, identity), failureWrite(id), failureReply(id, yes),
      completionClock(id), completeWrite(id), completeReply(id, yes, other),
      awaitFailure(id), finish(id, yes), s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 3, s.claims >= 0, s.claims <= 1,
    s.completions >= 0, s.completions <= s.claims,
    s.present == (s.rowStatus != "absent"),
    s.rowStatus != "pending" implies not(s.cipher) and not(s.iv),
    s.completions == 1 implies s.completedBy == s.claimedBy and s.completedAt < expiry,
    s.points and s.completions == 1 implies s.storedNode,
    ids.forall(id => {
      val request = s.requests.get(id)
      all {
        request.claimAccepted implies s.claimedBy == id and s.claims == 1,
        request.completeAccepted implies request.claimAccepted and request.verified
          and (not(s.points) or request.node) and request.completionStamp < expiry,
        request.response == "html-200" implies request.completeAccepted,
        request.clearCookieHeader == (request.response == "html-200"),
        request.phase == "done" implies not(request.verifierHeld),
        request.verifierHeld implies request.claimAccepted and request.snapshotCipher and request.snapshotIv }
    }) }

  // Small compositional traces retain each await boundary in step.
  action ready = init.then(configure(false, true, true))
  action pointsReady = init.then(configure(true, true, true))
  action claimed(id: int): bool = begin(id, true, false).then(hashReply(id, true))
    .then(claimRead(id)).then(claimWrite(id)).then(claimReply(id, true, true))
  action resolved(id: int, identity: str): bool = claimed(id).then(decrypt(id, true)).then(resolve(id, identity))
  action completed(id: int): bool = completionClock(id).then(completeWrite(id)).then(completeReply(id, true, true))

  run privateAudienceAcceptsBasicIdentityTest = ready.then(resolved(1, "basic")).then(completed(1)).then(finish(1, true))
    .expect(s.rowStatus == "callback_complete" and not(s.storedNode) and s.requests.get(1).response == "html-200" and invariant)
  run pointsAcceptsNodeIdentityTest = pointsReady.then(resolved(1, "node")).then(completed(1)).then(finish(1, true))
    .expect(s.storedNode and s.requests.get(1).clearCookieHeader and invariant)
  run pointsRejectsBasicIdentityTest = pointsReady.then(resolved(1, "basic")).then(failureWrite(1)).then(failureReply(1, true)).then(finish(1, true))
    .expect(s.rowStatus == "callback_failed" and s.requests.get(1).response == "html-502" and invariant)
  run invalidBindingCannotClaimTest = ready.then(begin(1, false, true)).then(finish(1, true))
    .expect(s.claims == 0 and s.rowStatus == "pending" and s.requests.get(1).response == "html-400" and invariant)
  run authorizationDenialFailsClaimedFlowTest = ready.then(begin(1, true, true)).then(hashReply(1, true)).then(claimRead(1))
    .then(claimWrite(1)).then(claimReply(1, true, true)).then(failureWrite(1)).then(failureReply(1, true)).then(finish(1, true))
    .expect(s.rowStatus == "callback_failed" and s.requests.get(1).response == "html-400" and invariant)
  run decryptErrorEndsClaimedFlowTest = ready.then(claimed(1)).then(decrypt(1, false)).then(failureWrite(1)).then(failureReply(1, true)).then(finish(1, true))
    .expect(s.rowStatus == "callback_failed" and s.requests.get(1).response == "outer-error" and invariant)
  run nullResolverEndsClaimedFlowTest = ready.then(resolved(1, "null")).then(failureWrite(1)).then(failureReply(1, true)).then(finish(1, true))
    .expect(s.rowStatus == "callback_failed" and s.requests.get(1).response == "html-502" and invariant)
  run thrownResolverClearsLocalSlotTest = ready.then(resolved(1, "thrown")).then(failureWrite(1)).then(failureReply(1, true)).then(finish(1, true))
    .expect(s.requests.get(1).response == "outer-error" and not(s.requests.get(1).verifierHeld) and invariant)
  run failureWriteRejectionLeavesProcessingTest = ready.then(resolved(1, "null")).then(awaitFailure(1)).then(finish(1, true))
    .expect(s.rowStatus == "callback_processing" and s.requests.get(1).response == "outer-error" and invariant)
  run failureReplyLossRetainsFailedCommitTest = ready.then(resolved(1, "null")).then(failureWrite(1)).then(failureReply(1, false)).then(finish(1, true))
    .expect(s.rowStatus == "callback_failed" and s.requests.get(1).response == "outer-error" and invariant)
  run expiryDuringExchangeRefusesCompletionTest = ready.then(claimed(1)).then(decrypt(1, true)).then(tick).then(tick)
    .then(resolve(1, "node")).then(completed(1)).then(finish(1, true))
    .expect(s.rowStatus == "callback_processing" and s.requests.get(1).response == "html-409" and invariant)
  run capturedCompletionMayCommitAfterWallClockExpiryTest = ready.then(resolved(1, "node")).then(completionClock(1))
    .then(tick).then(tick).then(completeWrite(1)).then(completeReply(1, true, true)).then(finish(1, true))
    .expect(s.now == expiry and s.completedAt == 0 and s.requests.get(1).response == "html-200" and invariant)
  run cleanupBeforeCompletionRefusesWriteTest = ready.then(resolved(1, "node")).then(completionClock(1))
    .then(tick).then(tick).then(cleanup).then(completeWrite(1)).then(completeReply(1, true, true)).then(finish(1, true))
    .expect(not(s.present) and s.requests.get(1).response == "html-409" and invariant)
  run committedCompletionSurvivesLostReplyTest = ready.then(resolved(1, "node")).then(completionClock(1))
    .then(completeWrite(1)).then(completeReply(1, false, true)).then(finish(1, true))
    .expect(s.rowStatus == "callback_complete" and s.requests.get(1).response == "outer-error" and invariant)
  run cleanupAfterCompletionDoesNotRewriteReplyTest = ready.then(resolved(1, "node")).then(completed(1))
    .then(tick).then(tick).then(cleanup).then(finish(1, true))
    .expect(not(s.present) and s.requests.get(1).response == "html-200" and invariant)
  run responseConstructionFailureKeepsCommitTest = ready.then(resolved(1, "node")).then(completed(1)).then(finish(1, false))
    .expect(s.rowStatus == "callback_complete" and s.requests.get(1).response == "outer-error" and not(s.requests.get(1).clearCookieHeader) and invariant)
  run hashFailureDoesNotClaimTest = ready.then(begin(1, true, false)).then(hashReply(1, false)).then(finish(1, true))
    .expect(s.claims == 0 and s.requests.get(1).response == "outer-error" and invariant)
  run expiredClaimHasNoEffectTest = ready.then(tick).then(tick).then(begin(1, true, false)).then(hashReply(1, true))
    .then(claimRead(1)).then(finish(1, true)).expect(s.claims == 0 and s.requests.get(1).response == "html-410" and invariant)
  run capturedClaimCanStartAfterWallClockExpiryTest = ready.then(begin(1, true, false)).then(hashReply(1, true))
    .then(tick).then(tick).then(claimRead(1)).then(claimWrite(1)).then(claimReply(1, true, true))
    .expect(s.now == expiry and s.claims == 1 and s.requests.get(1).phase == "decrypt" and invariant)
  run cleanupBetweenClaimReadAndWriteTest = ready.then(begin(1, true, false)).then(hashReply(1, true)).then(claimRead(1))
    .then(tick).then(tick).then(cleanup).then(claimWrite(1)).then(claimReply(1, true, true)).then(finish(1, true))
    .expect(s.claims == 0 and s.requests.get(1).response == "html-410" and invariant)
  run concurrentClaimSelectsHaveOneWinnerTest = ready.then(begin(1, true, false)).then(begin(2, true, false))
    .then(hashReply(1, true)).then(hashReply(2, true)).then(claimRead(1)).then(claimRead(2))
    .then(claimWrite(1)).then(claimWrite(2)).then(claimReply(2, true, true)).then(finish(2, true))
    .expect(s.claims == 1 and s.claimedBy == 1 and s.requests.get(2).response == "html-410" and invariant)
  run claimReplyLossConsumesStoredVerifierTest = ready.then(begin(1, true, false)).then(hashReply(1, true)).then(claimRead(1))
    .then(claimWrite(1)).then(claimReply(1, false, true)).then(finish(1, true))
    .expect(s.rowStatus == "callback_processing" and not(s.cipher) and s.requests.get(1).response == "outer-error" and invariant)
  run committedClaimWithoutChangeCountReturnsGoneTest = ready.then(begin(1, true, false)).then(hashReply(1, true)).then(claimRead(1))
    .then(claimWrite(1)).then(claimReply(1, true, false)).then(finish(1, true))
    .expect(s.rowStatus == "callback_processing" and not(s.cipher) and s.requests.get(1).response == "html-410" and invariant)
  run committedCompletionWithoutChangeCountReturnsConflictTest = ready.then(resolved(1, "node")).then(completionClock(1))
    .then(completeWrite(1)).then(completeReply(1, true, false)).then(finish(1, true))
    .expect(s.rowStatus == "callback_complete" and s.requests.get(1).response == "html-409" and invariant)
  run secondCallbackCannotRecoverConsumedClaimTest = ready.then(claimed(1)).then(decrypt(1, false)).then(awaitFailure(1))
    .then(finish(1, true)).then(begin(2, true, false)).then(hashReply(2, true)).then(claimRead(2)).then(finish(2, true))
    .expect(s.claims == 1 and s.requests.get(2).response == "html-410" and invariant)
  run absentStoredCipherReturnsGoneAfterClaimTest = init.then(configure(false, false, true))
    .then(claimed(1)).then(finish(1, true)).expect(s.rowStatus == "callback_processing" and s.requests.get(1).response == "html-410" and invariant)
  run absentStoredIvReturnsGoneAfterClaimTest = init.then(configure(false, true, false))
    .then(claimed(1)).then(finish(1, true)).expect(s.rowStatus == "callback_processing" and s.requests.get(1).response == "html-410" and invariant)
  run failureNoopAfterCleanupStillReturnsRefusalTest = ready.then(resolved(1, "null")).then(tick).then(tick).then(cleanup)
    .then(failureWrite(1)).then(failureReply(1, true)).then(finish(1, true))
    .expect(not(s.requests.get(1).failureChanged) and s.requests.get(1).response == "html-502" and invariant)
  run completeWriteFailureDoesNotInventCompletionTest = ready.then(resolved(1, "node")).then(completionClock(1))
    .then(awaitFailure(1)).then(finish(1, true)).expect(s.completions == 0 and s.rowStatus == "callback_processing" and invariant)
  run claimedResolverMayRemainPendingTest = ready.then(claimed(1)).then(decrypt(1, true)).then(tick).then(tick).then(tick)
    .expect(s.requests.get(1).phase == "resolve" and s.requests.get(1).response == "none" and invariant)
}
