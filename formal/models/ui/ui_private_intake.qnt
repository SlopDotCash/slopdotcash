// @source src/PrivateReportForm.tsx
// @source src/lib/intake-drafts.ts
// @source src/SecurityBounty.tsx
// @source backend/security/report-intake.ts
// Two form lifetimes, two request lifetimes, two actors, two payload/key classes.
// Storage values: 0 absent, 1 original draft, 2 original attempted record,
// 3 a replacement's different exact bytes, 4 the owned corrected draft after
// validation refusal. Cookie capture at dispatch differs
// from later session-response observation. No instantaneous privacy guarantee
// is inferred between browser observations of an external cookie change.
//
// Finite step reductions. Each action has a *With(..., reduce) form; direct
// actions and named scenarios pass false and keep the exact state. step
// passes true, which applies settle to every successor:
// - message, the form payload/key and every job payload/key are write-only
//   (job payload and key are never read), so step stores fixed values.
// - Job ownership is absorbing-false: start needs busy == 0 and a new slot,
//   finish clears busy only for its owner, and remount moves to view 2 with
//   busy 0, after which an unmounted form never remounts. An unowned job
//   changes no field outside itself: storage, text, phase, receipt and
//   navigation updates all require ownership. Its own fields are read only by
//   the invariant's admitted and receipt conjuncts, so step keeps a finished
//   record with only admitted and, when admitted, view, owner and cookie.
//   Server admission of an unowned sent job only adds a receipt witness that
//   the current owner never needs (receipt is set only by an owned admitted
//   job) and is guarded by cookie == owner, so it is not explored.
// - An owned job's captured cookie and observed actor are compared only with
//   its owner (1 or 2) and -1, and in view 2 the form cookie is compared only
//   with the fixed owner, so other values are stored as 0 and cookie choices
//   are offered once. Request IDs are opaque, so step starts the lowest
//   unused one.
module ui_private_intake {
  type Job = { view: int, owner: int, kind: str, stage: str, payload: int, key: int,
    captured: int, cookie: int, admitted: bool, failure: str, observed: int }
  pure val emptyJob: Job = { view: 0, owner: 0, kind: "none", stage: "new",
    payload: 0, key: 0, captured: 0, cookie: 0, admitted: false,
    failure: "none", observed: -1 }
  type State = { view: int, mounted: bool, owner: int, cookie: int, phase: str,
    payload: int, key: int, storage: int, text: bool, busy: int, posts: int,
    receipt: bool, receiptRaw: int, draftRaw: int, message: str, navigated: bool,
    navigationActor: int, navigationObservation: int, jobs: int -> Job }
  var s: State
  // Finite-step canonical form; see the header. Direct actions pass false.
  pure def settledJob(st: State, id: int): Job = {
    val job = st.jobs.get(id)
    val owned = st.mounted and st.busy == id and job.view == st.view and job.owner == st.owner
    if (job.stage == "new") job
    else if (not(owned) or job.stage == "finished")
      emptyJob.with("stage", "finished").with("admitted", job.admitted)
        .with("view", if (job.admitted) job.view else 0)
        .with("owner", if (job.admitted) job.owner else 0)
        .with("cookie", if (job.admitted) job.cookie else 0)
    else job.with("payload", 0).with("key", 0)
      .with("cookie", if (job.cookie == job.owner) job.cookie else 0)
      .with("observed", if (job.observed == -1 or job.observed == job.owner) job.observed else 0)
  }
  pure def settle(reduce: bool, st: State): State = if (not(reduce)) st
    else st.with("jobs", Map(1 -> settledJob(st, 1), 2 -> settledJob(st, 2)))
      .with("payload", 0).with("key", 0).with("message", "none")
      .with("cookie", if (st.view == 1 or st.cookie == st.owner) st.cookie else 0)
  def owns(id) = s.mounted and s.busy == id and s.jobs.get(id).view == s.view
    and s.jobs.get(id).owner == s.owner
  action init = s' = { view: 1, mounted: true, owner: 1, cookie: 1, phase: "draft",
    payload: 1, key: 1, storage: 1, text: true, busy: 0, posts: 0,
    receipt: false, receiptRaw: 0, draftRaw: 0, message: "none", navigated: false,
    navigationActor: 0, navigationObservation: 0, jobs: Map(1 -> emptyJob, 2 -> emptyJob) }
  action reviewWith(reduce) = all { s.mounted, s.busy == 0, s.phase == "draft", s.text,
    s' = settle(reduce, s.with("phase", "review")) }
  action review = reviewWith(false)
  action editWith(reduce) = all { s.mounted, s.busy == 0, s.phase == "draft", not(s.receipt),
    s' = settle(reduce, s.with("payload", 2).with("text", true).with("storage", 3)) }
  action edit = editWith(false)
  action cookieChangesWith(actor, reduce) = all { Set(0, 1, 2).contains(actor),
    s' = settle(reduce, s.with("cookie", actor)) }
  action cookieChanges(actor) = cookieChangesWith(actor, false)
  action startWith(id, writeSucceeds, reduce) = {
    val isReceipt = s.receipt
    val isRecovery = s.phase == "session"
    val raw = if (isReceipt) s.receiptRaw else if (isRecovery) s.draftRaw else if (writeSucceeds) 2 else
      if (Set(1, 2, 4).contains(s.storage)) s.storage else 0
    val job = { view: s.view, owner: s.owner, kind: if (isReceipt) "receipt" else if (isRecovery) "session" else "submit",
      stage: if (isReceipt) "postflight" else if (isRecovery) "restore" else "preflight", payload: s.payload,
      key: s.key, captured: raw, cookie: 0, admitted: false, failure: "none", observed: -1 }
    all { Set(1, 2).contains(id), s.jobs.get(id).stage == "new", s.mounted, s.busy == 0,
      Set("review", "uncertain", "receipt", "session").contains(s.phase),
      s' = settle(reduce, s.with("jobs", s.jobs.set(id, job)).with("busy", id).with("message", "none")
      .with("draftRaw", if (not(isReceipt) and not(isRecovery)) raw else s.draftRaw)
      .with("storage", if (not(isReceipt) and not(isRecovery) and writeSucceeds) 2 else s.storage)) }
  }
  action start(id, writeSucceeds) = startWith(id, writeSucceeds, false)
  action preflightWith(id, observation, reduce) = {
    val job = s.jobs.get(id)
    val same = observation == job.owner
    val current = owns(id)
    all { s.jobs.get(id).stage == "preflight", Set(-1, 0, 1, 2).contains(observation),
      observation == -1 or observation == s.cookie,
      s' = settle(reduce, s.with("jobs", s.jobs.set(id, job
        .with("stage", if (current and same) "ready" else if (current and observation == -1) "error-check" else "done")
        .with("failure", if (observation == -1) "transient" else job.failure)))
      .with("phase", if (current and observation != -1 and not(same)) "draft" else s.phase)
      .with("message", if (current and observation != -1 and not(same)) "identity" else s.message)
      .with("text", if (current and observation != -1 and not(same)) false else s.text)
      .with("payload", if (current and observation != -1 and not(same)) 0 else s.payload)
      .with("key", if (current and observation != -1 and not(same)) 2 else s.key)
      .with("storage", if (current and observation != -1 and not(same)
        and job.captured != 0 and s.storage == job.captured) 0 else s.storage)) }
  }
  action preflight(id, observation) = preflightWith(id, observation, false)
  action dispatchWith(id, reduce) = all { s.jobs.get(id).stage == "ready", owns(id),
    s' = settle(reduce, s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("stage", "sent").with("cookie", s.cookie)))
      .with("posts", s.posts + 1)) }
  action dispatch(id) = dispatchWith(id, false)
  action acceptServerWith(id, reduce) = all { s.jobs.get(id).stage == "sent",
    s.jobs.get(id).cookie == s.jobs.get(id).owner,
    s' = settle(reduce, s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("admitted", true).with("stage", "accepted")))) }
  action acceptServer(id) = acceptServerWith(id, false)
  action refuseServerWith(id, failure, reduce) = all { s.jobs.get(id).stage == "sent",
    Set("validation", "identity", "transient").contains(failure),
    if (s.jobs.get(id).cookie != s.jobs.get(id).owner) failure == "identity" else true,
    s' = settle(reduce, s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("stage", "refused").with("failure", failure)))) }
  action refuseServer(id, failure) = refuseServerWith(id, failure, false)
  action receiveAcceptedWith(id, reduce) = {
    val current = owns(id)
    all { s.jobs.get(id).stage == "accepted", s.jobs.get(id).admitted,
      s' = settle(reduce, s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("stage", if (current) "postflight" else "done")))
      .with("receipt", if (current) true else s.receipt)
      .with("receiptRaw", if (current) s.jobs.get(id).captured else s.receiptRaw)
      .with("phase", if (current) "receipt" else s.phase)
      .with("payload", if (current) 0 else s.payload)
      .with("key", if (current) 2 else s.key)
      .with("text", if (current) false else s.text)) }
  }
  action receiveAccepted(id) = receiveAcceptedWith(id, false)
  // A server acceptance can exist even when the browser loses the response.
  action receiveFailureWith(id, reduce) = all { Set("accepted", "refused").contains(s.jobs.get(id).stage),
    s' = settle(reduce, s.with("jobs", s.jobs.set(id, s.jobs.get(id)
      .with("failure", if (s.jobs.get(id).admitted) "transient" else s.jobs.get(id).failure)
      .with("stage", if (owns(id)) "error-check" else "done")))) }
  action receiveFailure(id) = receiveFailureWith(id, false)
  // A 2xx without the existing usable submission-id shape is uncertain,
  // even if the underlying handler committed. It cannot open receipt mode.
  action malformedReceiptWith(id, reduce) = all { s.jobs.get(id).stage == "accepted",
    s' = settle(reduce, s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("failure", "transient")
      .with("stage", if (owns(id)) "error-check" else "done")))) }
  action malformedReceipt(id) = malformedReceiptWith(id, false)
  action captureSessionWith(id, observation, reduce) = all {
    Set("postflight", "error-check", "restore").contains(s.jobs.get(id).stage),
    Set(-1, 0, 1, 2).contains(observation), observation == -1 or observation == s.cookie,
    s' = settle(reduce, s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("observed", observation)
      .with("stage", if (s.jobs.get(id).stage == "postflight") "postflight-response"
        else if (s.jobs.get(id).stage == "restore") "restore-response" else "error-response")))),
  }
  action captureSession(id, observation) = captureSessionWith(id, observation, false)
  action deliverSessionWith(id, reduce) = {
    val job = s.jobs.get(id)
    val current = owns(id)
    val same = job.observed == job.owner
    val mismatch = job.observed != -1 and not(same)
    val accepted = job.stage == "postflight-response"
    val restoring = job.stage == "restore-response"
    val refusedIdentity = not(accepted) and not(restoring) and job.failure == "identity" and job.observed != -1
    val remove = current and (same and accepted or mismatch or refusedIdentity)
      and job.captured != 0 and s.storage == job.captured
    val corrected = current and not(accepted) and not(restoring) and same
      and job.failure == "validation" and job.captured != 0 and s.storage == job.captured
    val navigate = current and same and accepted
    all { Set("postflight-response", "error-response", "restore-response").contains(job.stage),
      s' = settle(reduce, s.with("jobs", s.jobs.set(id, job.with("stage", "done")))
      .with("storage", if (remove) 0 else if (corrected) 4 else s.storage)
      .with("text", if (current and (accepted or mismatch or refusedIdentity or job.observed == -1)) false
        else if (current and restoring and same) true else s.text)
      .with("receiptRaw", if (current and accepted and mismatch) 0 else s.receiptRaw)
      .with("phase", if (not(current)) s.phase else if (accepted)
        (if (same) "opened" else "receipt") else if (job.observed == -1) "session"
        else if (mismatch or refusedIdentity or job.failure == "validation") "draft" else "uncertain")
      .with("payload", if (current and (mismatch or refusedIdentity)) 0 else s.payload)
      .with("key", if (current and (mismatch or refusedIdentity or
        (not(accepted) and same and job.failure == "validation"))) 2 else s.key)
      .with("message", if (not(current)) s.message else if (mismatch or refusedIdentity) "identity"
        else if (job.observed == -1) "unknown" else if (accepted) "none" else job.failure)
      .with("navigated", s.navigated or navigate)
      .with("navigationActor", if (navigate) job.owner else s.navigationActor)
      .with("navigationObservation", if (navigate) job.observed else s.navigationObservation)) }
  }
  action deliverSession(id) = deliverSessionWith(id, false)
  action finishWith(id, reduce) = all { s.jobs.get(id).stage == "done",
    s' = settle(reduce, s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("stage", "finished")))
      .with("busy", if (owns(id)) 0 else s.busy)) }
  action finish(id) = finishWith(id, false)
  action replaceStoredDraftWith(reduce) = all { s' = settle(reduce, s.with("storage", 3)) }
  action replaceStoredDraft = replaceStoredDraftWith(false)
  action departWith(reduce) = all { s.mounted, s' = settle(reduce, s.with("mounted", false)) }
  action depart = departWith(false)
  action remountWith(reduce) = all { not(s.mounted), s.view == 1, s.cookie != 0,
    s' = settle(reduce, s.with("view", 2).with("mounted", true).with("owner", s.cookie)
      .with("phase", "draft").with("payload", 2).with("key", 2).with("storage", 3).with("draftRaw", 0)
      .with("text", true).with("busy", 0).with("receipt", false).with("receiptRaw", 0)
      .with("message", "none").with("navigated", false)),
  }
  action remount = remountWith(false)
  // This separate observation is what causes the real parent to unmount the
  // actor-keyed form and clear tab drafts; cookieChanges alone does not do so.
  action parentObservesIdentityLossWith(reduce) = all { s.cookie != s.owner,
    s' = settle(reduce, s.with("mounted", false).with("text", false).with("storage", 0)) }

  action parentObservesIdentityLoss = parentObservesIdentityLossWith(false)
  action step = any {
    reviewWith(true), editWith(true),
    // In view 2 the owner is fixed and every non-owner cookie is equivalent.
    { nondet actor = Set(0, 1, 2).oneOf()
      all { s.view == 1 or actor == 0 or actor == s.owner, cookieChangesWith(actor, true) } },
    // Request IDs are opaque, so step starts the lowest unused one.
    { nondet id = Set(1, 2).oneOf() nondet writes = Set(false, true).oneOf()
      all { id == 1 or s.jobs.get(1).stage != "new", startWith(id, writes, true) } },
    { nondet id = Set(1, 2).oneOf() nondet observed = Set(-1, 0, 1, 2).oneOf() preflightWith(id, observed, true) },
    { nondet id = Set(1, 2).oneOf() dispatchWith(id, true) },
    { nondet id = Set(1, 2).oneOf() acceptServerWith(id, true) },
    { nondet id = Set(1, 2).oneOf() nondet failure = Set("validation", "identity", "transient").oneOf()
      refuseServerWith(id, failure, true) },
    { nondet id = Set(1, 2).oneOf() receiveAcceptedWith(id, true) },
    { nondet id = Set(1, 2).oneOf() receiveFailureWith(id, true) },
    { nondet id = Set(1, 2).oneOf() malformedReceiptWith(id, true) },
    { nondet id = Set(1, 2).oneOf() nondet observed = Set(-1, 0, 1, 2).oneOf() captureSessionWith(id, observed, true) },
    { nondet id = Set(1, 2).oneOf() deliverSessionWith(id, true) },
    { nondet id = Set(1, 2).oneOf() finishWith(id, true) },
    replaceStoredDraftWith(true), departWith(true), remountWith(true), parentObservesIdentityLossWith(true)
  }
  val invariant = all {
    s.posts <= 2,
    s.receipt implies not(s.text),
    s.phase == "session" implies not(s.text),
    s.navigated implies s.navigationActor == s.navigationObservation and s.navigationActor != 0,
    Set(1, 2).forall(id => s.jobs.get(id).admitted implies
      s.jobs.get(id).cookie == s.jobs.get(id).owner),
    s.receipt implies Set(1, 2).exists(id => s.jobs.get(id).admitted
      and s.jobs.get(id).view == s.view and s.jobs.get(id).owner == s.owner),
  }

  run acceptedTest = init.then(review).then(start(1, true)).then(preflight(1, 1))
    .then(dispatch(1)).then(acceptServer(1)).then(receiveAccepted(1))
    .then(captureSession(1, 1)).then(deliverSession(1)).then(finish(1))
    .expect(s.receipt and s.navigated and s.storage == 0 and s.posts == 1)
  run uncertainRetryTest = init.then(review).then(start(1, true)).then(preflight(1, 1))
    .then(dispatch(1)).then(acceptServer(1)).then(receiveFailure(1))
    .then(captureSession(1, 1)).then(deliverSession(1)).then(finish(1)).then(start(2, true))
    .expect(s.jobs.get(2).key == 1 and s.jobs.get(2).payload == 1 and not(s.receipt))
  run accountChangeTest = init.then(review).then(start(1, true)).then(cookieChanges(2))
    .then(parentObservesIdentityLoss).expect(not(s.text) and s.storage == 0)
  run silentCookieSwapDoesNotPretendImmediateUnmountTest = init.then(cookieChanges(2))
    .expect(s.mounted and s.text and s.owner == 1)
  run swappedDispatchCannotBeAcceptedForOriginalActorTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(cookieChanges(2)).then(dispatch(1)).then(acceptServer(1).fail())
  run acceptedThenChangedActorCannotNavigateTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(cookieChanges(2))
    .then(receiveAccepted(1)).then(captureSession(1, 2)).then(deliverSession(1)).then(finish(1))
    .expect(s.receipt and not(s.navigated) and not(s.text) and s.storage == 0 and s.message == "identity")
  run acceptedSessionFailureKeepsReceiptTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(receiveAccepted(1))
    .then(captureSession(1, -1)).then(deliverSession(1)).then(finish(1))
    .expect(s.receipt and s.phase == "receipt" and s.message == "unknown" and s.storage == 2)
  run receiptRetryDoesNotDispatchAgainTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(receiveAccepted(1))
    .then(captureSession(1, -1)).then(deliverSession(1)).then(finish(1)).then(start(2, true))
    .then(captureSession(2, 1)).then(deliverSession(2)).then(finish(2))
    .expect(s.posts == 1 and s.navigated and s.storage == 0)
  run replacementBytesSurviveAcceptedCompletionTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(replaceStoredDraft)
    .then(receiveAccepted(1)).then(captureSession(1, 1)).then(deliverSession(1)).then(finish(1))
    .expect(s.storage == 3 and s.receipt)
  run changedActorCannotClearReplacementBytesTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(replaceStoredDraft)
    .then(cookieChanges(2)).then(receiveAccepted(1)).then(captureSession(1, 2))
    .then(deliverSession(1)).then(finish(1)).expect(s.storage == 3 and not(s.navigated))
  run departedAcceptedResponseCannotPublishTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(depart).then(remount)
    .then(receiveAccepted(1)).then(finish(1))
    .expect(not(s.receipt) and s.storage == 3 and s.text and s.view == 2)
  run departedPostflightCannotClearOrNavigateTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(receiveAccepted(1))
    .then(captureSession(1, 1)).then(depart).then(remount).then(deliverSession(1)).then(finish(1))
    .expect(s.storage == 3 and not(s.navigated) and s.text)
  run oldFinallyCannotReleaseNewActionTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(receiveAccepted(1))
    .then(captureSession(1, 1)).then(depart).then(remount).then(review).then(start(2, true))
    .then(deliverSession(1)).then(finish(1)).expect(s.busy == 2)
  run lostReceiptAndIdentityLossHidePrivateDraftTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(receiveFailure(1))
    .then(cookieChanges(2)).then(captureSession(1, 2)).then(deliverSession(1)).then(finish(1))
    .expect(not(s.receipt) and not(s.text) and s.storage == 0 and s.jobs.get(1).admitted)
  run validationRefusalCanCorrectPayloadTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(refuseServer(1, "validation"))
    .then(receiveFailure(1)).then(captureSession(1, 1)).then(deliverSession(1)).then(finish(1))
    .expect(s.phase == "draft" and s.key == 2 and not(s.receipt))
  run failedAttemptWriteCanClearCapturedPriorDraftTest = init.then(review).then(start(1, false))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(receiveAccepted(1))
    .then(captureSession(1, 1)).then(deliverSession(1)).then(finish(1))
    .expect(s.storage == 0 and s.jobs.get(1).captured == 1)
  run unknownPreflightHidesDraftUntilSessionOnlyRetryTest = init.then(review).then(start(1, true))
    .then(preflight(1, -1)).then(captureSession(1, -1)).then(deliverSession(1)).then(finish(1)).then(start(2, true))
    .then(captureSession(2, 1)).then(deliverSession(2)).then(finish(2))
    .expect(s.posts == 0 and s.text and s.key == 1 and s.payload == 1 and s.phase == "uncertain")
  run unknownFailureHidesOriginalWithoutLosingRetryIdentityTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(receiveFailure(1))
    .then(captureSession(1, -1)).then(deliverSession(1)).then(finish(1))
    .expect(not(s.text) and s.phase == "session" and s.storage == 2 and s.key == 1 and s.payload == 1)
  run sessionRecoveryIdentityChangeCannotClearReplacementTest = init.then(review).then(start(1, true))
    .then(preflight(1, -1)).then(captureSession(1, -1)).then(deliverSession(1)).then(finish(1))
    .then(replaceStoredDraft).then(cookieChanges(2))
    .then(start(2, true)).then(captureSession(2, 2)).then(deliverSession(2)).then(finish(2))
    .expect(not(s.text) and s.storage == 3 and s.posts == 0)
  run malformedReceiptRetainsOriginalRetryTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(acceptServer(1)).then(malformedReceipt(1))
    .then(captureSession(1, 1)).then(deliverSession(1)).then(finish(1))
    .expect(not(s.receipt) and s.key == 1 and s.payload == 1 and s.storage == 2)
  run validationRefusalCannotOverwriteReplacementTest = init.then(review).then(start(1, true))
    .then(preflight(1, 1)).then(dispatch(1)).then(refuseServer(1, "validation"))
    .then(replaceStoredDraft).then(receiveFailure(1)).then(captureSession(1, 1))
    .then(deliverSession(1)).then(finish(1))
    .expect(s.storage == 3 and s.key == 2 and s.phase == "draft")
}
