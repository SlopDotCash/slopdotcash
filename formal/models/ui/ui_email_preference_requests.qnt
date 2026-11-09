// @source src/InboxEmail.tsx
// @source src/lib/project-api.ts
// @evidence tests/e2e/email-editor-focus.spec.ts
// Unexecuted request-ownership projection for InboxEmail, not InboxEmailAction.
// Two requests, two component lifetimes, two actors, two draft identities.
// Provider observations, nested helper return, caller use and a mutation's
// captured cookie remain separate. Layout cleanup invalidates generation at
// the committed removal; fetch/status effects stay passive.
// Exhaustive verification explores a reduced `step`; the comment above it
// states each reduction argument. Direct actions and scenarios are unreduced.
module ui_email_preference_requests {
  type Request = { kind: str, phase: str, generation: int, actor: int,
    cookie: int, status: int, accepted: bool, target: bool, observedActor: int }
  type State = { generation: int, life: int, mounted: bool, actor: int,
    cookie: int, view: str, busy: bool, checking: bool, enabled: bool, draft: int,
    editing: bool, key: bool, verificationPending: bool, error: str,
    reads: int, posts: int, sessionReads: int, reloads: int,
    publication: int, publicationGeneration: int,
    requests: int -> Request }
  var s: State
  val ids = Set(1, 2)
  val actors = Set(0, 1, 2)
  val observedActors = Set(-1, 0, 1, 2)
  action init = s' = { generation: 1, life: 1, mounted: true, actor: 1,
    cookie: 1, view: "ready", busy: false, checking: false, enabled: false, draft: 1,
    editing: true, key: false, verificationPending: false, error: "none",
    reads: 0, posts: 0, sessionReads: 0, reloads: 0,
    publication: 0, publicationGeneration: 0,
    requests: ids.mapBy(_ => {kind: "read", phase: "unused", generation: 0,
      actor: 0, cookie: 0, status: 0, accepted: false, target: false, observedActor: 0}) }
  // Step-only compaction (see the step comment). Direct actions pass false.
  pure val retiredRequest = {kind: "read", phase: "done", generation: 0,
    actor: 0, cookie: 0, status: 0, accepted: false, target: false, observedActor: 0}
  pure def compactIf(compact: bool, st: State): State = if (not(compact)) st
    else st.with("requests", ids.mapBy(id => {
      val r = st.requests.get(id)
      val owned = st.mounted and r.generation == st.generation
      if (r.phase == "unused" or id == st.publication) r
      else if (r.phase == "done" or not(owned)) retiredRequest
      else if (Set("dispatch", "http", "body", "failure", "post").contains(r.phase)) r.with("observedActor", 0)
      else r
    }))
  def owns(id: int): bool = s.mounted and s.requests.get(id).generation == s.generation
  pure def done(value: State, id: int): State = value.with("requests",
    value.requests.set(id, value.requests.get(id).with("phase", "done")))
  pure def lost(value: State, id: int, observed: int): State = {
    val finished = done(value, id).with("busy", false).with("checking", false).with("publication", 0)
    if (observed == -1) finished.with("view", "error").with("error", "identity")
    else if (observed == 0) finished.with("view", "signed-out").with("draft", 0)
      .with("editing", false).with("key", false).with("error", "session-expired")
    else if (value.requests.get(id).kind == "read") finished.with("view", "error")
      .with("draft", 0).with("editing", false).with("key", false).with("error", "actor-changed")
    else finished.with("generation", value.generation + 1).with("reloads", value.reloads + 1)
      .with("view", "loading").with("checking", true).with("draft", 0).with("editing", false)
      .with("key", false).with("error", "actor-changed")
  }
  action cookieChanges(actor: int): bool = all {
    actors.contains(actor), s' = s.with("cookie", actor) }
  action editDraft(value: int): bool = all {
    s.mounted, s.editing, ids.contains(value), s' = s.with("draft", value) }
  action beginAction(id: int, kind: str): bool = beginActionAs(id, kind, false)
  action beginActionAs(id: int, kind: str, compact: bool): bool = all {
    s.mounted, s.view == "ready", not(s.busy), not(s.checking), ids.contains(id),
    Set("save", "verify").contains(kind), s.requests.get(id).phase == "unused",
    s' = compactIf(compact, s.with("busy", true).with("error", "none").with("key", s.key or kind == "verify")
      .with("requests", s.requests.set(id, {kind: kind, phase: "pre", generation: s.generation,
        actor: s.actor, cookie: 0, status: 0, accepted: false, target: not(s.enabled), observedActor: 0}))) }
  action beginRead(id: int, background: bool): bool = beginReadAs(id, background, false)
  action beginReadAs(id: int, background: bool, compact: bool): bool = all {
    s.mounted, not(s.busy), ids.contains(id), s.requests.get(id).phase == "unused",
    s' = compactIf(compact, s.with("generation", s.generation + 1).with("error", "none").with("checking", true)
      .with("publication", 0)
      .with("view", if (background and s.view == "ready") "ready" else "loading")
      .with("requests", s.requests.set(id, {kind: "read", phase: "pre", generation: s.generation + 1,
        actor: s.actor, cookie: 0, status: 0, accepted: false, target: s.enabled, observedActor: 0}))) }
  action preflightStart(id: int): bool = preflightStartAs(id, false)
  action preflightStartAs(id: int, compact: bool): bool = all {
    owns(id), s.requests.get(id).phase == "pre",
    s' = compactIf(compact, s.with("sessionReads", s.sessionReads + 1).with("requests",
      s.requests.set(id, s.requests.get(id).with("phase", "pre-wait")))) }
  // -1 is an unreadable session; 0 is a confirmed signed-out response. A
  // session reply is an observation, not a synchronous view of the cookie.
  action preflightObserve(id: int, observed: int): bool = preflightObserveAs(id, observed, false)
  action preflightObserveAs(id: int, observed: int, compact: bool): bool = all {
    s.requests.get(id).phase == "pre-wait", observedActors.contains(observed),
    s' = compactIf(compact, s.with("requests", s.requests.set(id, s.requests.get(id)
      .with("phase", "pre-observed").with("observedActor", observed)))) }
  action preflightReturn(id: int): bool = preflightReturnAs(id, false)
  action preflightReturnAs(id: int, compact: bool): bool = all { s.requests.get(id).phase == "pre-observed",
    s' = compactIf(compact, s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "pre-returned")))) }
  action preflightUse(id: int, observed: int): bool = preflightUseAs(id, observed, false)
  action preflightUseAs(id: int, observed: int, compact: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "pre-returned", observed == r.observedActor, observedActors.contains(observed),
      s' = compactIf(compact, if (not(owns(id))) done(s, id)
      else if (r.kind == "read" and observed == 0)
        s.with("view", "loading").with("draft", 0).with("editing", false).with("key", false)
          .with("requests", s.requests.set(id, r.with("phase", "dispatch").with("actor", 0)))
      else if (observed != r.actor) lost(s, id, observed)
      else s.with("requests", s.requests.set(id, r.with("phase", "dispatch")))) }
  }
  action preflightReply(id: int, observed: int): bool = preflightObserve(id, observed)
    .then(preflightReturn(id)).then(preflightUse(id, observed))
  action dispatch(id: int): bool = dispatchAs(id, false)
  action dispatchAs(id: int, compact: bool): bool = {
    val r = s.requests.get(id)
    all { owns(id), r.phase == "dispatch",
      s' = compactIf(compact, s.with("requests", s.requests.set(id, r.with("phase", "http").with("cookie", s.cookie)))
        .with("reads", s.reads + (if (r.kind == "read") 1 else 0))
        .with("posts", s.posts + (if (r.kind == "read") 0 else 1))) }
  }
  action accepted(id: int): bool = acceptedAs(id, false)
  action acceptedAs(id: int, compact: bool): bool = {
    val r = s.requests.get(id)
    all { r.kind != "read", r.phase == "http", r.cookie == r.actor, r.cookie != 0,
      s' = compactIf(compact, s.with("requests", s.requests.set(id, r.with("accepted", true)))) }
  }
  action httpReply(id: int, status: int): bool = httpReplyAs(id, status, false)
  action httpReplyAs(id: int, status: int, compact: bool): bool = {
    val r = s.requests.get(id)
    val finished = done(s, id).with("busy", false)
    all { r.phase == "http", Set(200, 202, 401, 403, 409, 429, 503).contains(status),
      not((r.kind == "save" and status == 200) or (r.kind == "verify" and status == 202)) or r.accepted,
      s' = compactIf(compact, if (not(owns(id))) done(s, id)
      else if (status == 401) lost(s, id, 0)
      else if (r.kind == "save" and Set(403, 409).contains(status))
        finished.with("generation", s.generation + 1).with("reloads", s.reloads + 1)
          .with("publication", 0)
          .with("view", "loading").with("checking", true).with("draft", if (status == 403) 0 else s.draft)
          .with("editing", status == 409 and s.editing)
          .with("key", status == 409 and s.key)
          .with("error", if (status == 403) "actor-changed" else "destination-changed")
      else if (r.kind == "read" and status != 200)
        finished.with("view", "error").with("checking", false).with("error", "request")
          .with("draft", if (status == 403) 0 else s.draft)
      else s.with("requests", s.requests.set(id,
        r.with("phase", if (r.kind == "save" and status != 200) "failure" else "body")
          .with("status", status)))) }
  }
  action bodyReply(id: int, valid: bool): bool = bodyReplyAs(id, valid, false)
  action bodyReplyAs(id: int, valid: bool, compact: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "body",
      s' = compactIf(compact, if (not(owns(id))) done(s, id)
      else if (r.kind == "read" and (not(valid) or r.actor == 0))
        done(s, id).with("view", "error").with("checking", false).with("error", "request")
      else if (not(valid)) s.with("requests", s.requests.set(id, r.with("phase", "failure")))
      else s.with("requests", s.requests.set(id, r.with("phase", "post")))) }
  }
  action postflightStart(id: int): bool = postflightStartAs(id, false)
  action postflightStartAs(id: int, compact: bool): bool = all {
    owns(id), s.requests.get(id).phase == "post",
    s' = compactIf(compact, s.with("sessionReads", s.sessionReads + 1).with("requests",
      s.requests.set(id, s.requests.get(id).with("phase", "post-wait")))) }
  action postflightObserve(id: int, observed: int): bool = postflightObserveAs(id, observed, false)
  action postflightObserveAs(id: int, observed: int, compact: bool): bool = all {
    s.requests.get(id).phase == "post-wait", observedActors.contains(observed),
    s' = compactIf(compact, s.with("requests", s.requests.set(id, s.requests.get(id)
      .with("phase", "post-observed").with("observedActor", observed)))) }
  action postflightReturn(id: int): bool = postflightReturnAs(id, false)
  action postflightReturnAs(id: int, compact: bool): bool = all { s.requests.get(id).phase == "post-observed",
    s' = compactIf(compact, s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "post-returned")))) }
  action postflightUse(id: int, observed: int): bool = postflightUseAs(id, observed, false)
  action postflightUseAs(id: int, observed: int, compact: bool): bool = {
    val r = s.requests.get(id)
    val finished = done(s, id).with("busy", false).with("requests",
      s.requests.set(id, r.with("phase", "done").with("observedActor", observed)))
    val published = finished.with("publication", id).with("publicationGeneration", s.generation)
    all { r.phase == "post-returned", observed == r.observedActor, observedActors.contains(observed),
      s' = compactIf(compact, if (not(owns(id))) done(s, id)
      else if (observed != r.actor) lost(s, id, observed)
      else if (r.kind == "read") published.with("view", "ready").with("checking", false)
      else if (r.kind == "save" and r.status == 200) published.with("enabled", r.target)
      else if (r.kind == "verify" and r.status == 202) published.with("verificationPending", true)
        .with("editing", false).with("key", false)
      else s.with("requests", s.requests.set(id, r.with("phase", "failure")))) }
  }
  action postflightReply(id: int, observed: int): bool = postflightObserve(id, observed)
    .then(postflightReturn(id)).then(postflightUse(id, observed))
  action requestFailure(id: int): bool = requestFailureAs(id, false)
  action requestFailureAs(id: int, compact: bool): bool = all {
    Set("dispatch", "http", "body").contains(s.requests.get(id).phase),
    s' = compactIf(compact, if (not(owns(id))) done(s, id)
    else if (s.requests.get(id).kind == "read") done(s, id).with("view", "error").with("checking", false).with("error", "request")
    else s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "failure")))) }
  action failureCheckStart(id: int): bool = failureCheckStartAs(id, false)
  action failureCheckStartAs(id: int, compact: bool): bool = all {
    owns(id), s.requests.get(id).phase == "failure",
    s' = compactIf(compact, s.with("sessionReads", s.sessionReads + 1).with("requests",
      s.requests.set(id, s.requests.get(id).with("phase", "failure-wait")))) }
  action failureCheckObserve(id: int, observed: int): bool = failureCheckObserveAs(id, observed, false)
  action failureCheckObserveAs(id: int, observed: int, compact: bool): bool = all {
    s.requests.get(id).phase == "failure-wait", observedActors.contains(observed),
    s' = compactIf(compact, s.with("requests", s.requests.set(id, s.requests.get(id)
      .with("phase", "failure-observed").with("observedActor", observed)))) }
  action failureCheckReturn(id: int): bool = failureCheckReturnAs(id, false)
  action failureCheckReturnAs(id: int, compact: bool): bool = all { s.requests.get(id).phase == "failure-observed",
    s' = compactIf(compact, s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "failure-returned")))) }
  action failureCheckUse(id: int, observed: int): bool = failureCheckUseAs(id, observed, false)
  action failureCheckUseAs(id: int, observed: int, compact: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "failure-returned", observed == r.observedActor, observedActors.contains(observed),
      s' = compactIf(compact, if (not(owns(id))) done(s, id)
      else if (observed != r.actor) lost(s, id, observed)
      else done(s, id).with("busy", false).with("error", if (r.status == 429) "rate-limit" else "request")) }
  }
  action failureCheckReply(id: int, observed: int): bool = failureCheckObserve(id, observed)
    .then(failureCheckReturn(id)).then(failureCheckUse(id, observed))
  action depart = departAs(false)
  action departAs(compact: bool): bool = all { s.mounted,
    s' = compactIf(compact, s.with("mounted", false).with("generation", s.generation + 1)
      .with("publication", 0).with("view", "departed")) }
  action remount = remountAs(false)
  action remountAs(compact: bool): bool = all { not(s.mounted), s.life == 1,
    s' = compactIf(compact, s.with("mounted", true).with("life", 2).with("view", "ready")
      .with("busy", false).with("checking", false).with("draft", 2).with("editing", true).with("key", false).with("error", "none")) }
  // Each nondeterministic choice is scoped to the one action that reads it
  // (formal/README.md, "Scoped nondeterministic choices"). The disjunction of
  // per-action existentials equals the former single existential over every
  // choice, so successors and enabledness are unchanged.
  // Step-only compaction (formal/README.md, "Retired requests" and
  // "Write-only fields and canonical choices"); direct actions and scenarios keep every field:
  // - A request stops being owned for good: the generation only grows. A
  //   request that is not owned changes only its own fields (every use
  //   without ownership only finishes it, and acceptance requires its own
  //   cookie to equal its actor). The invariant reads a request only through
  //   that acceptance conjunct, true by that guard, and as the published
  //   request, which is owned while published. Other actions read a request
  //   only through its phase being unused. Step therefore stores one
  //   canonical finished record for each finished or unowned request except
  //   the published one.
  // - `observedActor` is read only by the uses and by the invariant for the
  //   published request; every later use is preceded by an observation that
  //   overwrites it, so step clears it from dispatch through "post" and in
  //   "failure".
  action step = any {
    cookieChanges(0), cookieChanges(1), cookieChanges(2), { nondet id = ids.oneOf() editDraft(id) },
    { nondet id = ids.oneOf() beginActionAs(id, "save", true) },
    { nondet id = ids.oneOf() beginActionAs(id, "verify", true) },
    { nondet id = ids.oneOf() nondet valid = Set(false, true).oneOf() beginReadAs(id, valid, true) },
    { nondet id = ids.oneOf() preflightStartAs(id, true) },
    { nondet id = ids.oneOf() nondet observed = observedActors.oneOf() preflightObserveAs(id, observed, true) },
    { nondet id = ids.oneOf() preflightReturnAs(id, true) },
    { nondet id = ids.oneOf() nondet observed = observedActors.oneOf() preflightUseAs(id, observed, true) },
    { nondet id = ids.oneOf() dispatchAs(id, true) }, { nondet id = ids.oneOf() acceptedAs(id, true) },
    { nondet id = ids.oneOf() nondet status = Set(200, 202, 401, 403, 409, 429, 503).oneOf() httpReplyAs(id, status, true) },
    { nondet id = ids.oneOf() nondet valid = Set(false, true).oneOf() bodyReplyAs(id, valid, true) },
    { nondet id = ids.oneOf() postflightStartAs(id, true) },
    { nondet id = ids.oneOf() nondet observed = observedActors.oneOf() postflightObserveAs(id, observed, true) },
    { nondet id = ids.oneOf() postflightReturnAs(id, true) },
    { nondet id = ids.oneOf() nondet observed = observedActors.oneOf() postflightUseAs(id, observed, true) },
    { nondet id = ids.oneOf() requestFailureAs(id, true) }, { nondet id = ids.oneOf() failureCheckStartAs(id, true) },
    { nondet id = ids.oneOf() nondet observed = observedActors.oneOf() failureCheckObserveAs(id, observed, true) },
    { nondet id = ids.oneOf() failureCheckReturnAs(id, true) },
    { nondet id = ids.oneOf() nondet observed = observedActors.oneOf() failureCheckUseAs(id, observed, true) },
    departAs(true), remountAs(true), s' = s }
  val invariant = all { s.generation >= 1, s.generation <= 6,
    s.posts <= 2, s.reads <= 2, s.reloads <= 2, s.sessionReads <= 6,
    ids.forall(id => s.requests.get(id).accepted implies
      s.requests.get(id).cookie == s.requests.get(id).actor),
    if (s.publication == 0) true else all {
      s.mounted, s.publicationGeneration == s.generation,
      s.requests.get(s.publication).generation == s.generation,
      s.requests.get(s.publication).observedActor == s.requests.get(s.publication).actor,
      s.requests.get(s.publication).kind == "read" or s.requests.get(s.publication).accepted } }
  action sendSave = beginAction(1, "save").then(preflightStart(1)).then(preflightReply(1, 1)).then(dispatch(1))
  action sendVerification = beginAction(1, "verify").then(preflightStart(1)).then(preflightReply(1, 1)).then(dispatch(1))
  run currentPreferenceSuccessTest = init.then(sendSave).then(accepted(1)).then(httpReply(1, 200))
    .then(bodyReply(1, true)).then(postflightStart(1)).then(postflightReply(1, 1))
    .expect(s.enabled and s.draft == 1 and s.editing)
  run currentVerificationSuccessTest = init.then(sendVerification).then(accepted(1)).then(httpReply(1, 202))
    .then(bodyReply(1, true)).then(postflightStart(1)).then(postflightReply(1, 1))
    .expect(s.verificationPending and not(s.key) and not(s.editing))
  run departedMismatchCannotReloadTest = init.then(beginAction(1, "verify")).then(preflightStart(1))
    .then(depart).then(preflightReply(1, 2)).expect(s.reloads == 0 and s.posts == 0)
  run departed403CannotReloadTest = init.then(sendSave).then(depart).then(httpReply(1, 403)).expect(s.reloads == 0)
  run departed409CannotReloadTest = init.then(sendSave).then(depart).then(httpReply(1, 409)).expect(s.reloads == 0)
  run current409KeepsDraftAndFeedbackTest = init.then(sendSave).then(httpReply(1, 409))
    .expect(s.reloads == 1 and s.draft == 1 and s.error == "destination-changed")
  run current403ClearsPriorDraftTest = init.then(sendSave).then(httpReply(1, 403))
    .expect(s.reloads == 1 and s.draft == 0 and s.error == "actor-changed")
  run departedPostflightCannotResetNewDraftTest = init.then(sendSave).then(accepted(1))
    .then(httpReply(1, 200)).then(bodyReply(1, true)).then(postflightStart(1))
    .then(depart).then(remount).then(postflightReply(1, 2))
    .expect(s.draft == 2 and s.reloads == 0 and not(s.enabled))
  run departedFailureCannotStartCheckTest = init.then(sendSave).then(requestFailure(1)).then(depart)
    .then(failureCheckStart(1).fail())
  run departedBodyCannotStartPostflightTest = init.then(beginRead(1, false)).then(preflightStart(1))
    .then(preflightReply(1, 1)).then(dispatch(1)).then(httpReply(1, 200)).then(depart)
    .then(bodyReply(1, true)).then(postflightStart(1).fail())
  run sameActorFailurePreservesDraftTest = init.then(sendSave).then(requestFailure(1))
    .then(failureCheckStart(1)).then(failureCheckReply(1, 1))
    .expect(s.draft == 1 and s.editing and s.error == "request")
  run changedActorFailureReloadsTest = init.then(sendSave).then(requestFailure(1))
    .then(failureCheckStart(1)).then(failureCheckReply(1, 2)).expect(s.draft == 0 and s.reloads == 1)
  run unknownIdentityKeepsHiddenDraftTest = init.then(sendSave).then(requestFailure(1))
    .then(failureCheckStart(1)).then(failureCheckReply(1, -1))
    .expect(s.draft == 1 and s.view == "error" and s.reloads == 0)
  run backgroundReadRetainsEditedDraftTest = init.then(beginRead(1, true)).then(editDraft(2))
    .then(preflightStart(1)).then(preflightReply(1, 1)).then(dispatch(1)).then(httpReply(1, 200))
    .then(bodyReply(1, true)).then(postflightStart(1)).then(postflightReply(1, 1))
    .expect(s.draft == 2 and s.editing and s.view == "ready")
  run current401EndsSessionTest = init.then(sendSave).then(httpReply(1, 401))
    .expect(s.view == "signed-out" and s.draft == 0)
  run verificationRateLimitKeepsRetryKeyTest = init.then(sendVerification).then(httpReply(1, 429))
    .then(bodyReply(1, true)).then(postflightStart(1)).then(postflightReply(1, 1))
    .then(failureCheckStart(1)).then(failureCheckReply(1, 1))
    .expect(s.key and s.draft == 1 and s.error == "rate-limit")
  run unacceptedSaveCannotPublishTest = init.then(sendSave).then(httpReply(1, 200).fail())
  run unacceptedVerificationCannotPublishTest = init.then(sendVerification).then(httpReply(1, 202).fail())
  run departedObservedPreflightCannotPostTest = init.then(beginAction(1, "verify"))
    .then(preflightStart(1)).then(preflightObserve(1, 1)).then(depart)
    .then(preflightReturn(1)).then(preflightUse(1, 1)).then(dispatch(1).fail())
  run departedReturnedPostflightCannotPublishTest = init.then(sendSave).then(accepted(1))
    .then(httpReply(1, 200)).then(bodyReply(1, true)).then(postflightStart(1))
    .then(postflightObserve(1, 1)).then(postflightReturn(1)).then(depart).then(remount)
    .then(postflightUse(1, 1)).expect(s.publication == 0 and s.draft == 2)
  run departedObservedFailureCannotPublishErrorTest = init.then(sendSave).then(requestFailure(1))
    .then(failureCheckStart(1)).then(failureCheckObserve(1, 1)).then(depart).then(remount)
    .then(failureCheckReturn(1)).then(failureCheckUse(1, 1)).expect(s.error == "none")
  // Historical passive cleanup left generation current after DOM removal.
  // Excluded from step: demonstrates why the committed layout fence matters.
  action oldPassiveCommit = s' = s.with("view", "departed")
  run oldPassiveCommitCouldDispatchVerificationTest = init.then(beginAction(1, "verify"))
    .then(preflightStart(1)).then(preflightObserve(1, 1)).then(oldPassiveCommit)
    .then(preflightReturn(1)).then(preflightUse(1, 1)).then(dispatch(1)).expect(s.posts == 1)
}
