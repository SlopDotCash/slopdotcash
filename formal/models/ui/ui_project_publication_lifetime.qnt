// @source src/ProjectProposalPage.tsx
// @source src/lib/project-api.ts
// @source backend/projects/handler.ts
// @source backend/http.ts
// @evidence tests/e2e/project-save.spec.ts
// @evidence tests/e2e/project-proposal.spec.ts
// Browser ownership for create/revision publication. Backend actor/revision
// admission is a boundary; full manifest/funding/activation rules live elsewhere.
// Two requests and lifetimes, two actors, three draft identities. Unexecuted.
// Layout cleanup retires each committed editor before promise continuations.
// Session observation, helper return and caller consumption are separate steps;
// an observed actor is not a promise that the next request has the same cookie.
//
// Finite step reductions. Each action has a *With(..., reduce) form; direct
// actions and named scenarios pass false and keep the exact state. step
// passes true, which applies settle to every successor:
// - serverDraft, error, storageError and each request outcome are write-only,
//   so step stores fixed values. After the single remount (lifetime 2) the
//   stored draft fields are never read again, the actor is fixed, and the
//   cookie is compared only with it, so step stores 0/false for them and
//   offers one non-actor cookie.
// - Request ownership is absorbing-false: active only names an unused slot
//   at begin and is cleared by every failure, success and departure, and
//   lifetime and actor change only at remount. An unowned request before
//   admission or after the server write only marks itself done. In
//   admission or server it can still change server state, so it keeps actor,
//   cookie, admitted and expected (its draft feeds only serverDraft). Every
//   other unowned or done request becomes one done record, keeping accepted
//   only for the published id, which the publication conjunct reads.
// - Within an owned request, the captured cookie and observedActor are
//   compared only with its actor (1 or 2), 0 and -1, observedActor is read
//   only in its observed/returned phases and expected only by the server
//   write; unread values are stored in one fixed form.
// - Request IDs are opaque, so step begins the lowest unused slot.
module ui_project_publication_lifetime {
  type Request = { phase: str, actor: int, cookie: int, lifetime: int,
    draft: int, draftEpoch: int, referrer: bool, expected: int, admitted: bool, accepted: bool,
    resultRevision: int, outcome: str, observedActor: int }
  type State = { mode: str, present: bool, mounted: bool, lifetime: int, actor: int, cookie: int,
    active: int, draft: int, draftEpoch: int, referrer: bool, base: int, draftBase: int,
    stored: int, storedBase: int, storedReferrer: bool, storageError: bool,
    serverRevision: int, serverDraft: int, accepted: Set[int], view: str,
    publication: int, error: str, requests: int -> Request }
  val ids = Set(1, 2)
  var s: State
  action init = s' = { mode: "revision", present: true, mounted: true, lifetime: 1, actor: 1, cookie: 1,
    active: 0, draft: 1, draftEpoch: 0, referrer: true, base: 1, draftBase: 1,
    stored: 1, storedBase: 1, storedReferrer: true, storageError: false,
    serverRevision: 1, serverDraft: 0, accepted: Set(), view: "editor", publication: 0,
    error: "none", requests: ids.mapBy(_ => { phase: "unused", actor: 0, cookie: 0,
      lifetime: 1, draft: 0, draftEpoch: 0, referrer: false, expected: 0, admitted: false,
      accepted: false, resultRevision: 0, outcome: "none", observedActor: -1 }) }
  action createModeWith(reduce: bool): bool = all { s.active == 0, s.accepted == Set(),
    ids.forall(id => s.requests.get(id).phase == "unused"),
    s' = settle(reduce, s.with("mode", "create").with("base", 0).with("draftBase", 0)
      .with("storedBase", 0).with("serverRevision", 0)) }
  action createMode = createModeWith(false)
  def ownsIn(st: State, id: int): bool = st.mounted and st.active == id
    and st.requests.get(id).lifetime == st.lifetime and st.requests.get(id).actor == st.actor
  def owns(id: int): bool = ownsIn(s, id)
  // Finite-step canonical form; see the header. Direct actions pass false.
  pure val unusedRequest = { phase: "unused", actor: 0, cookie: 0,
    lifetime: 1, draft: 0, draftEpoch: 0, referrer: false, expected: 0, admitted: false,
    accepted: false, resultRevision: 0, outcome: "none", observedActor: -1 }
  pure def settledRequest(st: State, id: int): Request = {
    val r = st.requests.get(id)
    val observed = Set("preflight-observed", "preflight-returned", "success-observed",
      "success-returned", "failure-observed", "failure-returned").contains(r.phase)
    val beforeServer = Set("preflight", "preflight-observed", "preflight-returned",
      "dispatch", "admission", "server").contains(r.phase)
    val cookie = if (r.cookie != 0 and r.cookie == r.actor) r.cookie else 0
    if (r.phase == "unused") r
    else if (r.phase != "done" and ownsIn(st, id))
      r.with("outcome", "none").with("cookie", cookie)
        .with("expected", if (beforeServer) r.expected else 0)
        .with("observedActor", if (not(observed) or r.observedActor == -1
          or r.observedActor == r.actor) (if (observed) r.observedActor else -1) else 0)
    else if (Set("admission", "server").contains(r.phase))
      unusedRequest.with("phase", r.phase).with("actor", r.actor).with("lifetime", 0)
        .with("cookie", cookie).with("admitted", r.admitted).with("expected", r.expected)
    else unusedRequest.with("phase", "done").with("lifetime", 0)
      .with("accepted", r.accepted and id == st.publication)
  }
  pure def settle(reduce: bool, st: State): State = if (not(reduce)) st
    else st.with("requests", ids.mapBy(id => settledRequest(st, id)))
      .with("serverDraft", 0).with("error", "none").with("storageError", false)
      .with("cookie", if (st.lifetime == 1 or st.cookie == st.actor) st.cookie else 0)
      .with("stored", if (st.lifetime == 1) st.stored else 0)
      .with("storedBase", if (st.lifetime == 1) st.storedBase else 0)
      .with("storedReferrer", st.lifetime == 1 and st.storedReferrer)
  pure def failed(value: State, kind: str): State = value.with("active", 0).with("error", kind)
    .with("view", if (kind == "identity" and value.mode == "revision") "access-check" else "editor")
  pure def done(value: State, id: int): State = value.with("requests",
    value.requests.set(id, value.requests.get(id).with("phase", "done")))
  action cookieChangesWith(actor: int, reduce: bool): bool = all { Set(0, 1, 2).contains(actor),
    s' = settle(reduce, s.with("cookie", actor)) }
  action cookieChanges(actor: int): bool = cookieChangesWith(actor, false)
  // Revision comparison uses object identity, while creation compares the
  // serialized payload. An epoch distinguishes retyping the original text.
  action editWith(value: int, reduce: bool): bool = all { s.mounted, s.draftEpoch < 2,
    Set(1, 2, 3).contains(value),
    s' = settle(reduce, s.with("draft", value).with("draftEpoch", s.draftEpoch + 1)) }
  action edit(value: int): bool = editWith(value, false)
  action persistWith(works: bool, reduce: bool): bool = all { s.mounted,
    s' = settle(reduce, if (works) s.with("stored", s.draft).with("storedBase", s.draftBase)
      .with("storedReferrer", s.referrer).with("storageError", false)
    else s.with("storageError", true)) }
  action persist(works: bool): bool = persistWith(works, false)
  action beginWith(id: int, reduce: bool): bool = all { s.mounted, s.active == 0, s.view != "access-check",
    s.draft != 0, s.mode == "create" or s.draftBase == s.base,
    ids.contains(id), s.requests.get(id).phase == "unused",
    s' = settle(reduce, s.with("active", id).with("error", "none")
      .with("requests", s.requests.set(id, { phase: "preflight", actor: s.actor,
        cookie: 0, lifetime: s.lifetime, draft: s.draft, draftEpoch: s.draftEpoch, referrer: s.referrer,
        expected: s.base, admitted: false, accepted: false, resultRevision: 0,
        outcome: "none", observedActor: -1 }))) }
  action begin(id: int): bool = beginWith(id, false)
  action observePreflightWith(id: int, available: bool, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "preflight",
      s' = settle(reduce, s.with("requests", s.requests.set(id, r.with("phase", "preflight-observed")
        .with("observedActor", if (available) s.cookie else -1)))) }
  }
  action observePreflight(id: int, available: bool): bool = observePreflightWith(id, available, false)
  action returnPreflightWith(id: int, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "preflight-observed",
      s' = settle(reduce, s.with("requests", s.requests.set(id, r.with("phase", "preflight-returned")))) }
  }
  action returnPreflight(id: int): bool = returnPreflightWith(id, false)
  action consumePreflightWith(id: int, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "preflight-returned",
      s' = settle(reduce, if (not(owns(id))) done(s, id)
      else if (r.observedActor == -1) s.with("requests", s.requests.set(id,
        r.with("phase", "failure-check").with("outcome", "identity-unavailable")))
      else if (r.observedActor != r.actor) failed(done(s, id), "identity")
      else s.with("requests", s.requests.set(id, r.with("phase", "dispatch")))) }
  }
  action consumePreflight(id: int): bool = consumePreflightWith(id, false)
  // Convenience sequences retain earlier scenarios. Exploration uses the
  // individual boundaries, allowing departure between observation and use.
  action preflight(id: int, available: bool): bool = observePreflight(id, available)
    .then(returnPreflight(id)).then(consumePreflight(id))
  action dispatchWith(id: int, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { owns(id), r.phase == "dispatch",
      s' = settle(reduce, s.with("requests", s.requests.set(id,
        r.with("phase", "admission").with("cookie", s.cookie)))) }
  }
  action dispatch(id: int): bool = dispatchWith(id, false)
  action admitWith(id: int, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "admission",
      s' = settle(reduce, s.with("requests", s.requests.set(id, r.with("phase", "server")
        .with("admitted", r.cookie != 0 and r.cookie == r.actor)))) }
  }
  action admit(id: int): bool = admitWith(id, false)
  // A valid manifest and repository authority are abstract predicates here.
  // The captured expected revision is checked when the server writes.
  action serverResultWith(id: int, valid: bool, reduce: bool): bool = {
    val r = s.requests.get(id)
    val accepted = valid and r.admitted and r.expected == s.serverRevision
      and s.serverRevision < 3
    val completed = r.with("phase", "http").with("accepted", accepted)
      .with("resultRevision", if (accepted) s.serverRevision + 1 else 0)
    all { r.phase == "server",
      s' = settle(reduce, if (accepted) s.with("requests", s.requests.set(id, completed))
        .with("serverRevision", s.serverRevision + 1).with("serverDraft", r.draft)
        .with("accepted", s.accepted.union(Set(id)))
      else s.with("requests", s.requests.set(id, completed))) }
  }
  action serverResult(id: int, valid: bool): bool = serverResultWith(id, valid, false)
  action responseWith(id: int, outcome: str, reduce: bool): bool = {
    val r = s.requests.get(id)
    val received = s.with("requests", s.requests.set(id,
      r.with("phase", if (outcome == "success") "success-check" else "failure-check")
        .with("outcome", outcome)))
    all { r.phase == "http", Set("success", "temporary", "access").contains(outcome),
      outcome != "success" or r.accepted, outcome != "access" or not(r.accepted),
      s' = settle(reduce, if (not(owns(id))) done(received, id)
      else if (outcome == "access") failed(done(received, id), "identity") else received) }
  }
  action response(id: int, outcome: str): bool = responseWith(id, outcome, false)
  action observeSuccessWith(id: int, available: bool, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "success-check",
      s' = settle(reduce, s.with("requests", s.requests.set(id, r.with("phase", "success-observed")
        .with("observedActor", if (available) s.cookie else -1)))) }
  }
  action observeSuccess(id: int, available: bool): bool = observeSuccessWith(id, available, false)
  action returnSuccessWith(id: int, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "success-observed",
      s' = settle(reduce, s.with("requests", s.requests.set(id, r.with("phase", "success-returned")))) }
  }
  action returnSuccess(id: int): bool = returnSuccessWith(id, false)
  action consumeSuccessWith(id: int, reduce: bool): bool = {
    val r = s.requests.get(id)
    val completed = done(s, id).with("active", 0).with("error", "none").with("publication", id)
    val sameDraft = s.draft == r.draft and
      (if (s.mode == "revision") s.draftEpoch == r.draftEpoch else s.referrer == r.referrer)
    all { r.phase == "success-returned",
      s' = settle(reduce, if (not(owns(id))) done(s, id)
      else if (r.observedActor == -1) s.with("requests", s.requests.set(id,
        r.with("phase", "failure-check").with("outcome", "identity-unavailable")))
      else if (r.observedActor != r.actor) failed(done(s, id), "identity")
      else if (s.mode == "create") completed.with("view", "created")
        .with("referrer", if (sameDraft) false else s.referrer)
      else completed.with("view", "published").with("base", r.resultRevision)
        .with("draftBase", r.resultRevision).with("draft", if (sameDraft) 0 else s.draft)) }
  }
  action consumeSuccess(id: int): bool = consumeSuccessWith(id, false)
  action successCheck(id: int, available: bool): bool = observeSuccess(id, available)
    .then(returnSuccess(id)).then(consumeSuccess(id))
  // The current implementation retains the local editor if even this
  // error-path identity read is unavailable. It cannot publish success.
  action observeFailureWith(id: int, available: bool, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "failure-check",
      s' = settle(reduce, s.with("requests", s.requests.set(id, r.with("phase", "failure-observed")
        .with("observedActor", if (available) s.cookie else -1)))) }
  }
  action observeFailure(id: int, available: bool): bool = observeFailureWith(id, available, false)
  action returnFailureWith(id: int, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "failure-observed",
      s' = settle(reduce, s.with("requests", s.requests.set(id, r.with("phase", "failure-returned")))) }
  }
  action returnFailure(id: int): bool = returnFailureWith(id, false)
  action consumeFailureWith(id: int, reduce: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "failure-returned",
      s' = settle(reduce, if (not(owns(id))) done(s, id)
      else if (r.observedActor != -1 and r.observedActor != r.actor) failed(done(s, id), "identity")
      else failed(done(s, id), if (r.observedActor != -1) "request" else "identity-unavailable")) }
  }
  action consumeFailure(id: int): bool = consumeFailureWith(id, false)
  action failureCheck(id: int, available: bool): bool = observeFailure(id, available)
    .then(returnFailure(id)).then(consumeFailure(id))
  action departWith(reduce: bool): bool = all { s.mounted,
    s' = settle(reduce, s.with("present", false).with("mounted", false).with("active", 0).with("publication", 0)) }
  action depart = departWith(false)
  action remountWith(actor: int, reduce: bool): bool = all { not(s.mounted), s.lifetime == 1,
    Set(1, 2).contains(actor),
    s' = settle(reduce, s.with("present", true).with("mounted", true).with("lifetime", 2).with("actor", actor)
      .with("draft", s.stored).with("draftBase", s.storedBase).with("referrer", s.storedReferrer)
      .with("base", s.serverRevision).with("view", "editor").with("error", "none")) }

  action remount(actor: int): bool = remountWith(actor, false)
  action step = any {
    createModeWith(true),
    // In lifetime 2 the actor is fixed and every other cookie is equivalent.
    { nondet actor = Set(0, 1, 2).oneOf()
      all { s.lifetime == 1 or actor == 0 or actor == s.actor, cookieChangesWith(actor, true) } },
    { nondet draft = Set(1, 2, 3).oneOf() editWith(draft, true) },
    { nondet works = Set(false, true).oneOf() persistWith(works, true) },
    // Request IDs are opaque, so step begins the lowest unused one.
    { nondet id = ids.oneOf() all { id == 1 or s.requests.get(1).phase != "unused", beginWith(id, true) } },
    { nondet id = ids.oneOf() nondet works = Set(false, true).oneOf() observePreflightWith(id, works, true) },
    { nondet id = ids.oneOf() returnPreflightWith(id, true) },
    { nondet id = ids.oneOf() consumePreflightWith(id, true) },
    { nondet id = ids.oneOf() dispatchWith(id, true) },
    { nondet id = ids.oneOf() admitWith(id, true) },
    { nondet id = ids.oneOf() nondet works = Set(false, true).oneOf() serverResultWith(id, works, true) },
    { nondet id = ids.oneOf() nondet outcome = Set("success", "temporary", "access").oneOf()
      responseWith(id, outcome, true) },
    { nondet id = ids.oneOf() nondet works = Set(false, true).oneOf() observeSuccessWith(id, works, true) },
    { nondet id = ids.oneOf() returnSuccessWith(id, true) },
    { nondet id = ids.oneOf() consumeSuccessWith(id, true) },
    { nondet id = ids.oneOf() nondet works = Set(false, true).oneOf() observeFailureWith(id, works, true) },
    { nondet id = ids.oneOf() returnFailureWith(id, true) },
    { nondet id = ids.oneOf() consumeFailureWith(id, true) },
    departWith(true),
    { nondet actor = Set(1, 2).oneOf() remountWith(actor, true) },
    s' = s
  }
  val invariant = all { s.accepted.subseteq(ids), s.serverRevision >= 0, s.serverRevision <= 3,
    not(s.present) implies not(s.mounted),
    if (s.publication == 0) true else s.requests.get(s.publication).accepted,
    ids.forall(id => s.requests.get(id).admitted implies
      s.requests.get(id).cookie == s.requests.get(id).actor) }
  run unchangedRevisionClearsDraftTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(serverResult(1, true)).then(response(1, "success")).then(successCheck(1, true))
    .then(persist(true)).expect(s.draft == 0 and s.stored == 0 and s.base == 2)
  run editDuringSaveIsRebasedTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(serverResult(1, true)).then(edit(2)).then(response(1, "success"))
    .then(successCheck(1, true)).then(persist(true)).expect(s.draft == 2 and s.stored == 2 and s.draftBase == 2)
  run editedDraftCanPublishNextRevisionTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(serverResult(1, true)).then(edit(2)).then(response(1, "success"))
    .then(successCheck(1, true)).then(begin(2)).then(preflight(2, true)).then(dispatch(2)).then(admit(2))
    .then(serverResult(2, true)).then(response(2, "success")).then(successCheck(2, true))
    .expect(s.serverRevision == 3 and s.serverDraft == 2 and s.draft == 0)
  run retypedRevisionStillKeepsItsNewObjectTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(serverResult(1, true)).then(edit(2)).then(edit(1))
    .then(response(1, "success")).then(successCheck(1, true)).expect(s.draft == 1 and s.draftEpoch == 2)
  run departedReplyPreservesNewDraftTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(serverResult(1, true)).then(depart).then(remount(1)).then(edit(2)).then(persist(true))
    .then(response(1, "success")).expect(s.stored == 2 and s.publication == 0 and s.accepted == Set(1))
  run differentActorReplyPreservesAcceptedWriteTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(serverResult(1, true)).then(cookieChanges(2)).then(response(1, "success"))
    .then(successCheck(1, true)).expect(s.serverRevision == 2 and s.publication == 0 and s.view == "access-check")
  run preDispatchActorSwapCannotWriteTest = init.then(begin(1)).then(preflight(1, true)).then(cookieChanges(2))
    .then(dispatch(1)).then(admit(1)).then(serverResult(1, true)).then(response(1, "access"))
    .expect(s.serverRevision == 1 and s.accepted == Set())
  run departedPreflightStartsNoWriteTest = init.then(begin(1)).then(depart).then(remount(1))
    .then(preflight(1, true)).expect(s.serverRevision == 1 and s.requests.get(1).phase == "done")
  run lostReplyDoesNotUndoAcceptedRevisionTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(serverResult(1, true)).then(response(1, "temporary")).then(failureCheck(1, true))
    .expect(s.serverRevision == 2 and s.draft == 1 and s.error == "request" and s.publication == 0)
  run unavailableIdentityKeepsDraftWithoutSuccessTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(serverResult(1, true)).then(response(1, "success")).then(successCheck(1, false))
    .then(failureCheck(1, false)).expect(s.draft == 1 and s.publication == 0 and s.error == "identity-unavailable")
  run failurePathActorChangeRechecksGateTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(serverResult(1, false)).then(response(1, "temporary")).then(cookieChanges(2))
    .then(failureCheck(1, true)).expect(s.view == "access-check" and s.draft == 1)
  run createUnchangedPayloadClearsReferrerTest = init.then(createMode).then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(serverResult(1, true)).then(response(1, "success"))
    .then(successCheck(1, true)).expect(s.view == "created" and not(s.referrer))
  run createEditedPayloadKeepsReferrerTest = init.then(createMode).then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(serverResult(1, true)).then(edit(2)).then(response(1, "success"))
    .then(successCheck(1, true)).expect(s.view == "created" and s.referrer and s.draft == 2)
  run detachedCreateCannotClearNewReferrerTest = init.then(createMode).then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(serverResult(1, true)).then(depart).then(remount(2))
    .then(edit(2)).then(persist(true)).then(response(1, "success"))
    .expect(s.stored == 2 and s.referrer and s.publication == 0)
  run persistenceFailureKeepsCurrentDraftTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(serverResult(1, true)).then(edit(2)).then(response(1, "success"))
    .then(successCheck(1, true)).then(persist(false))
    .expect(s.draft == 2 and s.stored == 1 and s.storageError and s.serverDraft == 1)
  run busyEditorRefusesSecondSubmissionTest = init.then(begin(1)).then(begin(2).fail())
  run departedObservedPreflightCannotDispatchTest = init.then(createMode).then(begin(1))
    .then(observePreflight(1, true)).then(depart).then(returnPreflight(1))
    .then(consumePreflight(1)).then(dispatch(1).fail())
  run departedReturnedPreflightCannotDispatchTest = init.then(begin(1))
    .then(observePreflight(1, true)).then(returnPreflight(1)).then(depart)
    .then(consumePreflight(1)).expect(s.requests.get(1).phase == "done" and s.serverRevision == 1)
  run remountedEditorRejectsOldReturnedPreflightTest = init.then(begin(1))
    .then(observePreflight(1, true)).then(returnPreflight(1)).then(depart).then(remount(2))
    .then(begin(2)).then(consumePreflight(1)).expect(s.active == 2 and s.publication == 0)
  run departureAfterSuccessHelperCannotPublishTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(serverResult(1, true)).then(response(1, "success"))
    .then(observeSuccess(1, true)).then(returnSuccess(1)).then(depart).then(consumeSuccess(1))
    .expect(s.serverRevision == 2 and s.publication == 0 and s.stored == 1)
  run departedFailureHelperCannotReplaceNewStatusTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(serverResult(1, false)).then(response(1, "temporary"))
    .then(observeFailure(1, true)).then(returnFailure(1)).then(depart).then(remount(2))
    .then(begin(2)).then(consumeFailure(1)).expect(s.active == 2 and s.error == "none")
  run cookieChangeAfterObservationStillNeedsServerFenceTest = init.then(createMode).then(begin(1))
    .then(observePreflight(1, true)).then(cookieChanges(2)).then(returnPreflight(1))
    .then(consumePreflight(1)).then(dispatch(1)).then(admit(1)).then(serverResult(1, true))
    .expect(s.serverRevision == 0 and s.accepted == Set())
  // Historical negative control only: a passive cleanup leaves the old mounted
  // ref true after DOM removal. It is deliberately excluded from step.
  action oldPassiveDepart = s' = s.with("present", false)
  run oldPassiveCleanupCanStartCreateTest = init.then(createMode).then(begin(1))
    .then(observePreflight(1, true)).then(oldPassiveDepart).then(returnPreflight(1))
    .then(consumePreflight(1)).then(dispatch(1))
    .expect(not(s.present) and s.requests.get(1).phase == "admission")
}
