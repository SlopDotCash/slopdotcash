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
module ui_private_intake {
  type Job = { view: int, owner: int, kind: str, stage: str, payload: int, key: int,
    captured: int, cookie: int, admitted: bool, failure: str, observed: int }
  pure val emptyJob: Job = { view: 0, owner: 0, kind: "none", stage: "new",
    payload: 0, key: 0, captured: 0, cookie: 0, admitted: false,
    failure: "none", observed: -1 }
  var s: { view: int, mounted: bool, owner: int, cookie: int, phase: str,
    payload: int, key: int, storage: int, text: bool, busy: int, posts: int,
    receipt: bool, receiptRaw: int, draftRaw: int, message: str, navigated: bool,
    navigationActor: int, navigationObservation: int, jobs: int -> Job }
  def owns(id) = s.mounted and s.busy == id and s.jobs.get(id).view == s.view
    and s.jobs.get(id).owner == s.owner
  action init = s' = { view: 1, mounted: true, owner: 1, cookie: 1, phase: "draft",
    payload: 1, key: 1, storage: 1, text: true, busy: 0, posts: 0,
    receipt: false, receiptRaw: 0, draftRaw: 0, message: "none", navigated: false,
    navigationActor: 0, navigationObservation: 0, jobs: Map(1 -> emptyJob, 2 -> emptyJob) }
  action review = all { s.mounted, s.busy == 0, s.phase == "draft", s.text,
    s' = s.with("phase", "review") }
  action edit = all { s.mounted, s.busy == 0, s.phase == "draft", not(s.receipt),
    s' = s.with("payload", 2).with("text", true).with("storage", 3) }
  action cookieChanges(actor) = all { Set(0, 1, 2).contains(actor),
    s' = s.with("cookie", actor) }
  action start(id, writeSucceeds) = {
    val isReceipt = s.receipt
    val isRecovery = s.phase == "session"
    val raw = if (isReceipt) s.receiptRaw else if (isRecovery) s.draftRaw else if (writeSucceeds) 2 else
      if (Set(1, 2, 4).contains(s.storage)) s.storage else 0
    val job = { view: s.view, owner: s.owner, kind: if (isReceipt) "receipt" else if (isRecovery) "session" else "submit",
      stage: if (isReceipt) "postflight" else if (isRecovery) "restore" else "preflight", payload: s.payload,
      key: s.key, captured: raw, cookie: 0, admitted: false, failure: "none", observed: -1 }
    all { Set(1, 2).contains(id), s.jobs.get(id).stage == "new", s.mounted, s.busy == 0,
      Set("review", "uncertain", "receipt", "session").contains(s.phase),
      s' = s.with("jobs", s.jobs.set(id, job)).with("busy", id).with("message", "none")
      .with("draftRaw", if (not(isReceipt) and not(isRecovery)) raw else s.draftRaw)
      .with("storage", if (not(isReceipt) and not(isRecovery) and writeSucceeds) 2 else s.storage) }
  }
  action preflight(id, observation) = {
    val job = s.jobs.get(id)
    val same = observation == job.owner
    val current = owns(id)
    all { s.jobs.get(id).stage == "preflight", Set(-1, 0, 1, 2).contains(observation),
      observation == -1 or observation == s.cookie,
      s' = s.with("jobs", s.jobs.set(id, job
        .with("stage", if (current and same) "ready" else if (current and observation == -1) "error-check" else "done")
        .with("failure", if (observation == -1) "transient" else job.failure)))
      .with("phase", if (current and observation != -1 and not(same)) "draft" else s.phase)
      .with("message", if (current and observation != -1 and not(same)) "identity" else s.message)
      .with("text", if (current and observation != -1 and not(same)) false else s.text)
      .with("payload", if (current and observation != -1 and not(same)) 0 else s.payload)
      .with("key", if (current and observation != -1 and not(same)) 2 else s.key)
      .with("storage", if (current and observation != -1 and not(same)
        and job.captured != 0 and s.storage == job.captured) 0 else s.storage) }
  }
  action dispatch(id) = all { s.jobs.get(id).stage == "ready", owns(id),
    s' = s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("stage", "sent").with("cookie", s.cookie)))
      .with("posts", s.posts + 1) }
  action acceptServer(id) = all { s.jobs.get(id).stage == "sent",
    s.jobs.get(id).cookie == s.jobs.get(id).owner,
    s' = s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("admitted", true).with("stage", "accepted"))) }
  action refuseServer(id, failure) = all { s.jobs.get(id).stage == "sent",
    Set("validation", "identity", "transient").contains(failure),
    if (s.jobs.get(id).cookie != s.jobs.get(id).owner) failure == "identity" else true,
    s' = s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("stage", "refused").with("failure", failure))) }
  action receiveAccepted(id) = {
    val current = owns(id)
    all { s.jobs.get(id).stage == "accepted", s.jobs.get(id).admitted,
      s' = s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("stage", if (current) "postflight" else "done")))
      .with("receipt", if (current) true else s.receipt)
      .with("receiptRaw", if (current) s.jobs.get(id).captured else s.receiptRaw)
      .with("phase", if (current) "receipt" else s.phase)
      .with("payload", if (current) 0 else s.payload)
      .with("key", if (current) 2 else s.key)
      .with("text", if (current) false else s.text) }
  }
  // A server acceptance can exist even when the browser loses the response.
  action receiveFailure(id) = all { Set("accepted", "refused").contains(s.jobs.get(id).stage),
    s' = s.with("jobs", s.jobs.set(id, s.jobs.get(id)
      .with("failure", if (s.jobs.get(id).admitted) "transient" else s.jobs.get(id).failure)
      .with("stage", if (owns(id)) "error-check" else "done"))) }
  // A 2xx without the existing usable submission-id shape is uncertain,
  // even if the underlying handler committed. It cannot open receipt mode.
  action malformedReceipt(id) = all { s.jobs.get(id).stage == "accepted",
    s' = s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("failure", "transient")
      .with("stage", if (owns(id)) "error-check" else "done"))) }
  action captureSession(id, observation) = all {
    Set("postflight", "error-check", "restore").contains(s.jobs.get(id).stage),
    Set(-1, 0, 1, 2).contains(observation), observation == -1 or observation == s.cookie,
    s' = s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("observed", observation)
      .with("stage", if (s.jobs.get(id).stage == "postflight") "postflight-response"
        else if (s.jobs.get(id).stage == "restore") "restore-response" else "error-response"))),
  }
  action deliverSession(id) = {
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
      s' = s.with("jobs", s.jobs.set(id, job.with("stage", "done")))
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
      .with("navigationObservation", if (navigate) job.observed else s.navigationObservation) }
  }
  action finish(id) = all { s.jobs.get(id).stage == "done",
    s' = s.with("jobs", s.jobs.set(id, s.jobs.get(id).with("stage", "finished")))
      .with("busy", if (owns(id)) 0 else s.busy) }
  action replaceStoredDraft = all { s' = s.with("storage", 3) }
  action depart = all { s.mounted, s' = s.with("mounted", false) }
  action remount = all { not(s.mounted), s.view == 1, s.cookie != 0,
    s' = s.with("view", 2).with("mounted", true).with("owner", s.cookie)
      .with("phase", "draft").with("payload", 2).with("key", 2).with("storage", 3).with("draftRaw", 0)
      .with("text", true).with("busy", 0).with("receipt", false).with("receiptRaw", 0)
      .with("message", "none").with("navigated", false),
  }
  // This separate observation is what causes the real parent to unmount the
  // actor-keyed form and clear tab drafts; cookieChanges alone does not do so.
  action parentObservesIdentityLoss = all { s.cookie != s.owner,
    s' = s.with("mounted", false).with("text", false).with("storage", 0) }
  action step = {
    nondet id = Set(1, 2).oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet observed = Set(-1, 0, 1, 2).oneOf()
    nondet writes = Set(false, true).oneOf()
    nondet failure = Set("validation", "identity", "transient").oneOf()
    any { review, edit, cookieChanges(actor), start(id, writes), preflight(id, observed), dispatch(id),
      acceptServer(id), refuseServer(id, failure), receiveAccepted(id), receiveFailure(id), malformedReceipt(id),
      captureSession(id, observed), deliverSession(id), finish(id), replaceStoredDraft,
      depart, remount, parentObservesIdentityLoss }
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
