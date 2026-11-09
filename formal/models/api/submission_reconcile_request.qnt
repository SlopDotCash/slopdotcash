// @source backend/security/submissions.ts
// @source backend/security/submission-store.ts
// @source backend/security/github-advisories.ts
// @evidence backend/security/submissions.test.ts
// Two reconciliation requests, one already-settled owned submission, at most
// two matching advisories, revisions1..6. Age0 is below five minutes, age1 is
// the exact quiet boundary, and age2 is later. Listing failure is not emptiness.
// The first-event lookup supplies the first-send minus ten-minute window;
// the empty-listing quiet check instead samples the latest attempt's age after
// listing. Advisory parsing/repository/marker checks are supplied by the real
// adapter; author filtering and earliest-created/GHSA ordering remain explicit.
// Settlement before state-checking and full receipt/case verification have
// separate models. Their admissible outputs are composed here, not re-proved.
// Delegated verification uses responseRevision0: its final revision is omitted.
// Its failed-state CAS may return the captured submitted row; rendering can
// also fail after receipt effects. No local state update claims those effects.
// SQL CAS, write reply and exact readback are separate. Empty/inconclusive CAS
// losers return the captured row with200/202; matched CAS losers return409.
// No route in this model posts a report or grants authority to retry by itself.
// Provider/DB/browser execution and unbounded refinement remain unverified.
module submission_reconcile_request {
  val ids = Set(1, 2)
  val states = Set("uncertain", "submitted", "submitting", "draft", "receipt-verified", "failed")
  type Request = { phase: str, readState: str, readRevision: int, readAdvisory: int,
    firstWindow: bool, listed: bool, matched: Set[int], chosen: int,
    nextState: str, kind: str, plannedStatus: int, nextRevision: int,
    committed: bool, exactReadback: bool, verifyStarted: bool,
    status: int, responseState: str, responseRevision: int }
  val unused: Request = { phase: "unused", readState: "none", readRevision: 0, readAdvisory: 0,
    firstWindow: false, listed: false, matched: Set(), chosen: 0,
    nextState: "none", kind: "none", plannedStatus: 0, nextRevision: 0,
    committed: false, exactReadback: false, verifyStarted: false,
    status: 0, responseState: "none", responseRevision: 0 }
  var s: { state: str, revision: int, advisory: int, age: int, firstCopy: int,
    events: int, requests: int -> Request }
  action init = s' = { state: "uncertain", revision: 1, advisory: 0, age: 0, firstCopy: 1,
    events: 0, requests: ids.mapBy(_ => unused) }
  def error(r: Request, status: int): Request = r.with("phase", "done").with("status", status)
  action configure(state: str, advisory: int): bool = all {
    s.requests.get(1).phase == "unused", s.requests.get(2).phase == "unused",
    states.contains(state), Set(0, 1, 2).contains(advisory),
    Set("submitted", "receipt-verified").contains(state) implies advisory != 0,
    s' = s.with("state", state).with("advisory", advisory) }
  action clock = all { s.age < 2, s' = s.with("age", s.age + 1) }
  action reverseCreationOrder = all { s.firstCopy == 1, s' = s.with("firstCopy", 2) }
  action begin(id: int, owner: bool, validBody: bool, expected: int): bool = {
    val r = unused.with("readState", s.state).with("readRevision", s.revision).with("readAdvisory", s.advisory)
    all { s.requests.get(id).phase == "unused", s' = s.with("requests", s.requests.set(id,
      if (not(owner)) error(r, 404) else if (not(validBody)) error(r, 400)
      else if (expected != s.revision) error(r, 409) else r.with("phase", "state"))) }
  }
  action stateCheck(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "state", s' = s.with("requests", s.requests.set(id,
      if (Set("uncertain", "submitted").contains(r.readState)) r.with("phase", "grant") else error(r, 409))) }
  }
  action grant(id: int, valid: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "grant", s' = s.with("requests", s.requests.set(id,
      if (not(valid)) error(r, 409)
      else if (r.readState == "submitted" or r.readAdvisory != 0) r.with("phase", "verify").with("verifyStarted", true)
        .with("responseState", r.readState).with("responseRevision", r.readRevision)
      else r.with("phase", "first-attempt"))) }
  }
  action firstAttempt(id: int, readable: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "first-attempt", s' = s.with("requests", s.requests.set(id,
      if (readable) r.with("phase", "listing").with("firstWindow", true) else error(r, 500))) }
  }
  // 0 complete-empty;1/2 matching copy;3 both;4 foreign-author only;5 error.
  action listing(id: int, outcome: int): bool = {
    val r = s.requests.get(id)
    val matches = if (outcome == 1) Set(1) else if (outcome == 2) Set(2) else if (outcome == 3) ids else Set()
    val chosen = if (matches.size() == 2) s.firstCopy else if (matches.contains(1)) 1 else 2
    all { r.phase == "listing", 0.to(5).contains(outcome), s' = s.with("requests", s.requests.set(id,
      if (outcome == 5) r.with("phase", "write").with("nextState", "uncertain")
        .with("kind", "reconcile-inconclusive").with("plannedStatus", 202)
      else if (matches.size() == 0) r.with("phase", "quiet").with("listed", true)
      else r.with("phase", "write").with("listed", true).with("matched", matches).with("chosen", chosen)
        .with("nextState", "submitted").with("kind", if (matches.size() > 1) "duplicate-advisories" else "reconcile-matched"))) }
  }
  action quiet(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "quiet", s' = s.with("requests", s.requests.set(id,
      r.with("phase", "write").with("nextState", if (s.age < 1) "uncertain" else "draft")
        .with("kind", if (s.age < 1) "reconcile-too-early" else "reconcile-empty")
        .with("plannedStatus", if (s.age < 1) 202 else 200))) }
  }
  action write(id: int): bool = {
    val r = s.requests.get(id)
    val matches = s.state == r.readState and s.revision == r.readRevision
    all { r.phase == "write", s.revision < 6,
      s' = s.with("state", if (matches) r.nextState else s.state)
        .with("advisory", if (matches and r.chosen != 0) r.chosen else s.advisory)
        .with("revision", if (matches) s.revision + 1 else s.revision)
        .with("events", if (matches) s.events + 1 else s.events)
        .with("requests", s.requests.set(id, r.with("phase", "write-reply")
          .with("committed", matches).with("nextRevision", r.readRevision + 1))) }
  }
  def fallback(r: Request): Request = if (r.chosen != 0) error(r, 409)
    else error(r, r.plannedStatus).with("responseState", r.readState).with("responseRevision", r.readRevision)
  action writeReply(id: int, outcome: str): bool = {
    val r = s.requests.get(id)
    all { r.phase == "write-reply", Set("ok", "missing-count", "lost").contains(outcome),
      s' = s.with("requests", s.requests.set(id,
        if (outcome == "lost") error(r, 500)
        else if (outcome == "missing-count" or not(r.committed)) fallback(r) else r.with("phase", "readback"))) }
  }
  action writeFailure(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "write", s' = s.with("requests", s.requests.set(id, error(r, 500))) }
  }
  action readback(id: int, readable: bool): bool = {
    val r = s.requests.get(id)
    val exact = s.state == r.nextState and s.revision == r.nextRevision
    all { r.phase == "readback", s' = s.with("requests", s.requests.set(id,
      if (not(readable)) error(r, 500) else if (not(exact)) fallback(r)
      else r.with("exactReadback", true).with("responseState", s.state).with("responseRevision", s.revision)
        .with("phase", if (r.chosen == 0) "done" else "verify").with("verifyStarted", r.chosen != 0)
        .with("status", if (r.chosen == 0) r.plannedStatus else 0))) }
  }
  action verify(id: int, outcome: str): bool = {
    val r = s.requests.get(id)
    all { r.phase == "verify", Set("accepted", "inconclusive", "failed", "failed-stale", "conflict", "error").contains(outcome),
      s' = s.with("requests", s.requests.set(id, r.with("phase", "done")
        .with("responseRevision", 0)
        .with("status", if (outcome == "inconclusive") 202 else if (outcome == "conflict") 409 else if (outcome == "error") 500 else 200)
        .with("responseState", if (outcome == "accepted") "receipt-verified" else if (outcome == "failed") "failed" else r.responseState))) }
  }
  action advance(state: str, advisory: int): bool = all { states.contains(state), Set(0, 1, 2).contains(advisory),
    s.revision < 6, s.advisory == 0 or advisory == s.advisory,
    Set("submitted", "receipt-verified").contains(state) implies advisory != 0,
    s' = s.with("state", state).with("advisory", advisory).with("revision", s.revision + 1) }
  action step = {
    nondet id = ids.oneOf() nondet yes = Set(false, true).oneOf()
    nondet state = states.oneOf() nondet advisory = Set(0, 1, 2).oneOf()
    nondet outcome = 0.to(5).oneOf()
    nondet reply = Set("ok", "missing-count", "lost").oneOf()
    nondet verification = Set("accepted", "inconclusive", "failed", "failed-stale", "conflict", "error").oneOf()
    any { configure(state, advisory), clock, reverseCreationOrder, begin(id, yes, true, s.revision), begin(id, true, false, s.revision),
      begin(id, true, true, 0), stateCheck(id), grant(id, yes), firstAttempt(id, yes), listing(id, outcome), quiet(id),
      write(id), writeFailure(id), writeReply(id, reply), readback(id, yes), verify(id, verification), advance(state, advisory), s' = s }
  }
  val invariant = all { s.revision <= 6,
    ids.forall(id => { val r = s.requests.get(id)
      all { r.listed implies r.firstWindow,
        r.chosen != 0 implies r.matched.contains(r.chosen),
        r.exactReadback implies r.committed,
        r.verifyStarted implies r.readState == "submitted" or r.readAdvisory != 0 or (r.chosen != 0 and r.exactReadback),
        r.kind == "reconcile-empty" implies r.listed and r.matched == Set(),
        r.responseRevision == r.nextRevision and r.nextRevision != 0 implies r.exactReadback } }) }
  action admitted(id: int): bool = begin(id, true, true, s.revision).then(stateCheck(id)).then(grant(id, true))
  action listed(id: int, outcome: int): bool = admitted(id).then(firstAttempt(id, true)).then(listing(id, outcome))
  action committed(id: int): bool = write(id).then(writeReply(id, "ok")).then(readback(id, true))
  run wrongOwnerCannotReadListingTest = init.then(begin(1, false, true, 1)).expect(s.requests.get(1).status == 404 and not(s.requests.get(1).firstWindow) and invariant)
  run staleRevisionCannotReadListingTest = init.then(begin(1, true, true, 0)).expect(s.requests.get(1).status == 409 and invariant)
  run malformedBodyCannotReadListingTest = init.then(begin(1, true, false, 1)).expect(s.requests.get(1).status == 400 and invariant)
  run submittingRefusesBeforeGrantTest = init.then(configure("submitting", 0)).then(begin(1, true, true, 1)).then(stateCheck(1)).expect(s.requests.get(1).status == 409 and invariant)
  run draftRefusesReconciliationTest = init.then(configure("draft", 0)).then(begin(1, true, true, 1)).then(stateCheck(1)).expect(s.requests.get(1).status == 409 and invariant)
  run missingGrantPreventsListingTest = init.then(begin(1, true, true, 1)).then(stateCheck(1)).then(grant(1, false)).expect(s.requests.get(1).status == 409 and not(s.requests.get(1).firstWindow) and invariant)
  run firstAttemptReadFailureDoesNotTransitionTest = init.then(admitted(1)).then(firstAttempt(1, false)).expect(s.requests.get(1).status == 500 and s.revision == 1 and invariant)
  run inconclusiveListingCannotReopenDraftTest = init.then(listed(1, 5)).then(committed(1)).expect(s.state == "uncertain" and s.requests.get(1).status == 202 and invariant)
  run earlyEmptyListingStaysUncertainTest = init.then(listed(1, 0)).then(quiet(1)).then(committed(1)).expect(s.state == "uncertain" and s.requests.get(1).status == 202 and invariant)
  run exactQuietBoundaryReopensDraftTest = init.then(clock).then(listed(1, 0)).then(quiet(1)).then(committed(1)).expect(s.state == "draft" and s.requests.get(1).status == 200 and invariant)
  run timeDuringListingCountsTowardQuietTest = init.then(admitted(1)).then(firstAttempt(1, true)).then(clock).then(listing(1, 0)).then(quiet(1)).then(committed(1)).expect(s.state == "draft" and invariant)
  run foreignAuthorOnlyIsEmptyTest = init.then(clock).then(listed(1, 4)).then(quiet(1)).then(committed(1)).expect(s.state == "draft" and invariant)
  run matchingCopySkipsQuietWaitTest = init.then(listed(1, 1)).then(committed(1)).expect(s.state == "submitted" and s.requests.get(1).verifyStarted and invariant)
  run multipleCopiesChooseEarliestTest = init.then(listed(1, 3)).then(committed(1)).expect(s.advisory == 1 and s.requests.get(1).kind == "duplicate-advisories" and invariant)
  run creationTimeAndGhsaOrderCanChooseSecondTest = init.then(reverseCreationOrder).then(listed(1, 3)).then(committed(1)).expect(s.advisory == 2 and invariant)
  run chosenSnapshotDoesNotChangeWithLaterOrderingTest = init.then(listed(1, 3)).then(reverseCreationOrder).then(committed(1)).expect(s.advisory == 1 and invariant)
  run emptyCasLoserReturnsCapturedRowTest = init.then(clock).then(listed(1, 0)).then(quiet(1)).then(advance("draft", 0)).then(committed(1)).expect(s.requests.get(1).status == 200 and s.requests.get(1).responseState == "uncertain" and s.requests.get(1).responseRevision == 1 and invariant)
  run matchedCasLoserIsStaleTest = init.then(listed(1, 1)).then(advance("submitted", 2)).then(committed(1)).expect(s.requests.get(1).status == 409 and not(s.requests.get(1).verifyStarted) and invariant)
  run missingChangeCountKeepsCommittedDraftButReturnsCapturedRowTest = init.then(clock).then(listed(1, 0)).then(quiet(1)).then(write(1)).then(writeReply(1, "missing-count")).expect(s.state == "draft" and s.requests.get(1).responseState == "uncertain" and invariant)
  run lostWriteReplyDoesNotUndoAdoptionTest = init.then(listed(1, 1)).then(write(1)).then(writeReply(1, "lost")).expect(s.state == "submitted" and s.advisory == 1 and s.requests.get(1).status == 500 and invariant)
  run failedWriteDoesNotInventAdoptionTest = init.then(listed(1, 1)).then(writeFailure(1)).expect(s.state == "uncertain" and s.advisory == 0 and s.revision == 1 and invariant)
  run changedReadbackCannotAuthorizeVerificationTest = init.then(listed(1, 1)).then(write(1)).then(writeReply(1, "ok")).then(advance("receipt-verified", 1)).then(readback(1, true)).expect(s.requests.get(1).status == 409 and not(s.requests.get(1).verifyStarted) and invariant)
  run submittedSkipsListingAndRetriesOnlyVerificationTest = init.then(configure("submitted", 1)).then(admitted(1)).then(verify(1, "accepted")).expect(not(s.requests.get(1).listed) and s.requests.get(1).status == 200 and invariant)
  run unavailableVerificationPreservesSubmittedResponseTest = init.then(listed(1, 1)).then(committed(1)).then(verify(1, "inconclusive")).expect(s.requests.get(1).status == 202 and s.requests.get(1).responseState == "submitted" and invariant)
  run failedVerificationCasCanReturnCapturedSubmissionTest = init.then(listed(1, 1)).then(committed(1)).then(verify(1, "failed-stale")).expect(s.requests.get(1).status == 200 and s.requests.get(1).responseState == "submitted" and invariant)
  run concurrentEmptyListingsHaveOneStateTransitionTest = init.then(clock).then(listed(1, 0)).then(listed(2, 0)).then(quiet(1)).then(quiet(2)).then(committed(1)).then(committed(2)).expect(s.events == 1 and s.requests.get(2).responseRevision == 1 and invariant)
}
