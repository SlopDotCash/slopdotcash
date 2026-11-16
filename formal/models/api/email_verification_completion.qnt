// @source backend/notifications/email.ts
// @source backend/notifications/email-destinations.ts
// @source backend/http.ts
// @source migrations/0111_verified_notification_email.sql
// @source migrations/0116_email_preference_revision.sql
// @evidence backend/notifications/email-enrollment.test.ts
// One previously issued token, its owning account, two Verify POSTs, three
// preference revisions, and clock ranks 0..3 with expiry at rank2. A wrong
// signed-in actor is a refusal class; it never acquires the token owner's row.
// Each request captures preference presence/revision, then a timestamp before
// hashing and awaiting its D1 batch. SQL compares expiry to that captured time,
// not the later execution clock. A missing preference is distinct from rev0.
// The successful batch consumes the token, installs its fresh destination
// version and saves both requested consent values atomically. An opt-out or
// cancellation can interleave; a later failure never reverses committed rows.
// A thrown/lost batch reply, missing changes metadata on a present first
// result, and a failing view are separate from commit. Present counts are
// assumed accurate; no
// fabricated-positive counts, random-version collisions or hash collisions.
// Response 200 follows the view, whose reads are NOT a single snapshot. Only
// one observed preference value is retained here; exact destination/pending
// projection and HTTP transport are outside the bound. A failure after that
// value is read represents a later view query, not network delivery. Session
// authority is captured by requireActor, not continuously rechecked through completion.
// Enrollment rate limiting/provider delivery and unsubscribe capability
// cryptography belong to email_enrollment_delivery and api_email_consent.
// Existing tests cover account binding, cancellation, preference races,
// precommit storage error and captured expiry. Missing-count/lost-reply/view
// failure scenarios below are source-authored, not new execution evidence.
// No tests, parsers or model checkers were run for this refinement.
module email_verification_completion {
  val ids = Set(1, 2)
  val expiry = 2
  type Request = { phase: str, owner: bool, prior: int, stamp: int,
    committed: bool, observedActivity: bool, response: int }
  val unused: Request = { phase: "unused", owner: true, prior: -1, stamp: -1,
    committed: false, observedActivity: false, response: 0 }
  var s: { configured: bool, requestedActivity: bool, requestedSecurity: bool,
    now: int, preferencePresent: bool, revision: int, activity: bool, security: bool,
    tokenConsumed: bool, tokenCancelled: bool, destination: int,
    commits: int, requests: int -> Request }
  action init = s' = { configured: false, requestedActivity: true, requestedSecurity: true,
    now: 0, preferencePresent: false, revision: 0, activity: false, security: false,
    tokenConsumed: false, tokenCancelled: false, destination: 0, commits: 0,
    requests: ids.mapBy(_ => unused) }
  action configure(activity: bool, security: bool): bool = all { not(s.configured),
    s' = s.with("configured", true).with("requestedActivity", activity).with("requestedSecurity", security) }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action begin(id: int, admission: str, owner: bool): bool = {
    val response = if (admission == "anonymous") 401
      else if (admission == "origin" or admission == "actor-changed") 403 else 400
    all { s.configured, ids.contains(id), s.requests.get(id).phase == "unused",
      Set("ready", "anonymous", "origin", "actor-changed", "body").contains(admission),
      s' = s.with("requests", s.requests.set(id, unused.with("owner", owner)
        .with("phase", if (admission == "ready") "preference-read" else "done")
        .with("response", if (admission == "ready") 0 else response))) }
  }
  action readPreference(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "preference-read",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "capture-time")
        .with("prior", if (request.owner and s.preferencePresent) s.revision else -1))) }
  }
  action captureTime(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "capture-time",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "batch").with("stamp", s.now))) }
  }
  action cancelToken = all { not(s.tokenConsumed),
    s' = s.with("tokenCancelled", true) }
  action optOut = all { s.revision < 3,
    s' = s.with("preferencePresent", true)
      .with("revision", if (s.preferencePresent) s.revision + 1 else 0)
      .with("activity", false).with("security", false) }
  action batch(id: int): bool = {
    val request = s.requests.get(id)
    val changed = request.owner and not(s.tokenConsumed) and not(s.tokenCancelled)
      and request.stamp < expiry and request.prior == (if (s.preferencePresent) s.revision else -1)
    all { request.phase == "batch", s.revision < 3,
      s' = s.with("tokenConsumed", s.tokenConsumed or changed)
        .with("destination", if (changed) id else s.destination)
        .with("preferencePresent", s.preferencePresent or changed)
        .with("revision", if (changed and s.preferencePresent) s.revision + 1 else s.revision)
        .with("activity", if (changed) s.requestedActivity else s.activity)
        .with("security", if (changed) s.requestedSecurity else s.security)
        .with("commits", s.commits + (if (changed) 1 else 0))
        .with("requests", s.requests.set(id, request.with("phase", "batch-reply").with("committed", changed))) }
  }
  action batchReply(id: int, received: bool, changesVisible: bool): bool = {
    val request = s.requests.get(id)
    val success = request.committed and changesVisible
    all { request.phase == "batch-reply",
      s' = s.with("requests", s.requests.set(id, request
        .with("phase", if (received and success) "view" else "done")
        .with("response", if (not(received)) 500 else if (success) 0 else 409))) }
  }
  action missingBatch(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "batch",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done").with("response", 503))) }
  }
  action viewPreference(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "view",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "view-reply")
        .with("observedActivity", s.activity))) }
  }
  action viewReply(id: int, available: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "view-reply",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done")
        .with("response", if (available) 200 else 500))) }
  }
  action awaitFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { Set("preference-read", "capture-time", "batch", "view").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done").with("response", 500))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet admission = Set("ready", "anonymous", "origin", "actor-changed", "body").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { configure(yes, other), tick, begin(id, admission, yes), readPreference(id), captureTime(id),
      cancelToken, optOut, batch(id), missingBatch(id), batchReply(id, yes, other), viewPreference(id), viewReply(id, yes),
      awaitFailure(id), s' = s }
  }
  val invariant = all {
    s.commits <= 1, s.revision <= 3,
    s.tokenConsumed == (s.commits == 1),
    (s.destination > 0) == s.tokenConsumed,
    s.tokenConsumed implies s.preferencePresent,
    (s.activity or s.security) implies s.tokenConsumed,
    ids.forall(id => s.requests.get(id).committed implies s.requests.get(id).owner and
      s.requests.get(id).stamp < expiry and s.destination == id),
    ids.forall(id => s.requests.get(id).response == 200 implies s.requests.get(id).committed)
  }
  action ready = configure(true, true)
  action prepared(id: int): bool = begin(id, "ready", true).then(readPreference(id)).then(captureTime(id))
  action committed(id: int): bool = prepared(id).then(batch(id))
  action successful(id: int): bool = batchReply(id, true, true).then(viewPreference(id)).then(viewReply(id, true))

  run sameActorCommitsAllThreeRowsTest = init.then(ready).then(committed(1)).then(successful(1))
    .expect(s.tokenConsumed and s.destination == 1 and s.activity and s.security and invariant)
  run verifiedAddressCanKeepBothPreferencesDisabledTest = init.then(configure(false, false))
    .then(committed(1)).then(successful(1)).expect(s.destination == 1 and not(s.activity) and not(s.security) and invariant)
  run activityAndSecurityConsentStayDistinctTest = init.then(configure(true, false)).then(committed(1))
    .then(successful(1)).expect(s.activity and not(s.security) and invariant)
  run anonymousRequestNeverReadsTokenTest = init.then(ready).then(begin(1, "anonymous", true))
    .expect(s.requests.get(1).response == 401 and s.commits == 0 and invariant)
  run expectedActorMismatchRefusesBeforeBatchTest = init.then(ready).then(begin(1, "actor-changed", true))
    .expect(s.requests.get(1).response == 403 and s.commits == 0 and invariant)
  run crossOriginWriteRefusesBeforeBatchTest = init.then(ready).then(begin(1, "origin", true))
    .expect(s.requests.get(1).response == 403 and s.commits == 0 and invariant)
  run malformedTokenBodyNeverConsumesTest = init.then(ready).then(begin(1, "body", true))
    .expect(s.requests.get(1).response == 400 and not(s.tokenConsumed) and invariant)
  run otherSignedInActorCannotUseTokenTest = init.then(ready).then(begin(1, "ready", false))
    .then(readPreference(1)).then(captureTime(1)).then(batch(1)).then(batchReply(1, true, true))
    .expect(s.requests.get(1).response == 409 and not(s.tokenConsumed) and invariant)
  run concurrentVerificationCommitsOnlyOnceTest = init.then(ready).then(prepared(1)).then(prepared(2))
    .then(batch(2)).then(batch(1)).then(successful(2)).then(batchReply(1, true, true))
    .expect(s.requests.get(1).response == 409 and s.destination == 2 and s.commits == 1 and invariant)
  run cancellationDuringHashAwaitRefusesTest = init.then(ready).then(prepared(1)).then(cancelToken)
    .then(batch(1)).then(batchReply(1, true, true)).expect(s.requests.get(1).response == 409 and invariant)
  run firstOptOutFencesAbsentPreferenceSnapshotTest = init.then(ready).then(prepared(1)).then(optOut)
    .then(batch(1)).then(batchReply(1, true, true)).expect(s.requests.get(1).response == 409 and not(s.tokenConsumed) and invariant)
  run repeatedOptOutFencesExistingRevisionTest = init.then(ready).then(optOut).then(prepared(1)).then(optOut)
    .then(batch(1)).then(batchReply(1, true, true)).expect(s.requests.get(1).response == 409 and invariant)
  run freshVerifyAfterOptOutIsNewConsentTest = init.then(ready).then(optOut).then(committed(1)).then(successful(1))
    .expect(s.activity and s.security and invariant)
  run equalityAtExpiryRefusesTest = init.then(ready).then(tick).then(tick).then(committed(1))
    .then(batchReply(1, true, true)).expect(s.requests.get(1).response == 409 and not(s.tokenConsumed) and invariant)
  run capturedTimeBeforeExpiryCanCommitLaterTest = init.then(ready).then(tick).then(prepared(1))
    .then(tick).then(tick).then(batch(1)).then(successful(1)).expect(s.tokenConsumed and s.now == 3 and invariant)
  run precommitFailureLeavesTokenRecoverableTest = init.then(ready).then(prepared(1)).then(awaitFailure(1))
    .then(committed(2)).then(successful(2)).expect(s.requests.get(1).response == 500 and s.destination == 2 and invariant)
  run lostBatchReplyDoesNotUndoCommittedConsentTest = init.then(ready).then(committed(1))
    .then(batchReply(1, false, true)).expect(s.requests.get(1).response == 500 and s.activity and s.tokenConsumed and invariant)
  run missingChangeCountDoesNotUndoCommittedConsentTest = init.then(ready).then(committed(1))
    .then(batchReply(1, true, false)).expect(s.requests.get(1).response == 409 and s.tokenConsumed and invariant)
  run responseFailureCannotMakeTokenReusableTest = init.then(ready).then(committed(1)).then(batchReply(1, false, true))
    .then(committed(2)).then(batchReply(2, true, true)).expect(s.destination == 1 and s.requests.get(2).response == 409 and invariant)
  run viewReadFailurePreservesCommittedRowsTest = init.then(ready).then(committed(1)).then(batchReply(1, true, true))
    .then(awaitFailure(1)).expect(s.requests.get(1).response == 500 and s.tokenConsumed and invariant)
  run laterViewQueryFailurePreservesCommittedRowsTest = init.then(ready).then(committed(1)).then(batchReply(1, true, true))
    .then(viewPreference(1)).then(viewReply(1, false)).expect(s.requests.get(1).response == 500 and s.tokenConsumed and invariant)
  run laterOptOutCanAppearInSuccessfulVerificationViewTest = init.then(ready).then(committed(1))
    .then(batchReply(1, true, true)).then(optOut).then(viewPreference(1)).then(viewReply(1, true))
    .expect(s.requests.get(1).response == 200 and not(s.requests.get(1).observedActivity) and invariant)
  run optOutAfterViewReadCanPrecedeSuccessfulReplyTest = init.then(ready).then(committed(1)).then(batchReply(1, true, true))
    .then(viewPreference(1)).then(optOut).then(viewReply(1, true))
    .expect(s.requests.get(1).observedActivity and not(s.activity) and invariant)
  run missingTransactionalBindingRefusesBeforeConsumptionTest = init.then(ready).then(prepared(1)).then(missingBatch(1))
    .expect(s.requests.get(1).response == 503 and not(s.tokenConsumed) and invariant)
}
