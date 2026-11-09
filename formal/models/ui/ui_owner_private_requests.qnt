// @source src/OwnerAwards.tsx
// @source src/OwnerBountyVault.tsx
// @source backend/http.ts
// @evidence tests/e2e/owner-awards.spec.ts
// @evidence tests/e2e/vault-actions.spec.ts
// Two lifetimes, two actors and two requests. Session observation, helper return
// and caller use are separate. Funds and awards readers retire in layout
// cleanup, before a returned session can resume its caller after removal.
// Source-only: all scenarios are unexecuted. Money rules remain in other models.
// Backend slice: requireActor's optional expected-actor header guard only.
module ui_owner_private_requests {
  type Request = { phase: str, kind: str, actor: int, cookie: int, admitted: bool,
    lifetime: int, outcome: str, setup: bool, observed: int, available: bool }
  type State = { mode: str, present: bool, mounted: bool, lifetime: int, session: int,
    knownActor: int, data: bool, draft: bool, stale: bool, canSetup: bool,
    error: str, active: int, requests: int -> Request, accepted: Set[int] }
  val ids = Set(1, 2)
  var s: State
  action init = s' = { mode: "awards", present: true, mounted: true, lifetime: 1,
    session: 1, knownActor: 1, data: true, draft: true, stale: false,
    canSetup: false, error: "none", active: 0,
    requests: ids.mapBy(_ => { phase: "unused", kind: "read", actor: 0, cookie: 0, admitted: false,
      lifetime: 1, outcome: "success", setup: false, observed: 0, available: false }), accepted: Set() }
  def owns(id: int): bool = s.mounted and s.active == id
    and s.requests.get(id).lifetime == s.lifetime
  pure def clearPrivate(value: State): State = value.with("data", false)
    .with("draft", false).with("knownActor", 0).with("canSetup", false).with("stale", false)
  action fundsMode = all { s.active == 0, s' = s.with("mode", "funds")
    .with("draft", false).with("canSetup", true) }
  action sessionChanges(actor: int): bool = all {
    Set(0, 1, 2).contains(actor), s' = s.with("session", actor) }
  action begin(id: int, kind: str): bool = all {
    s.mounted, ids.contains(id), Set("read", "mutation").contains(kind),
    kind == "read" or (s.mode == "awards" and s.data),
    s.requests.get(id).phase == "unused",
    s' = s.with("active", id).with("error", "none")
      .with("data", if (s.mode == "awards" and kind == "read") false else s.data)
      .with("requests", s.requests.set(id, { phase: "preflight", kind: kind,
        actor: if (kind == "mutation") s.knownActor else 0, lifetime: s.lifetime,
        cookie: 0, admitted: false, outcome: "success", setup: false, observed: 0, available: false })) }
  action observePreflight(id: int, available: bool): bool = all {
    s.requests.get(id).phase == "preflight",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id)
      .with("observed", s.session).with("available", available).with("phase", "preflight-observed"))) }
  action returnPreflight(id: int): bool = all { s.requests.get(id).phase == "preflight-observed",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "preflight-returned"))) }
  action usePreflight(id: int): bool = {
    val r = s.requests.get(id)
    val refused = not(r.available) or r.observed == 0
      or (r.kind == "mutation" and r.actor != r.observed)
    val finished = s.with("requests", s.requests.set(id, r.with("phase", "done")))
    all { r.phase == "preflight-returned",
      s' = if (not(owns(id))) finished
      else if (refused) clearPrivate(finished).with("error", "identity")
      else {
        val current = if (s.knownActor != 0 and s.knownActor != r.observed)
          clearPrivate(s) else s
        current.with("requests", s.requests.set(id,
          r.with("phase", "dispatch").with("actor", r.observed)))
      } }
  }
  action preflight(id: int, available: bool): bool = observePreflight(id, available)
    .then(returnPreflight(id)).then(usePreflight(id))
  // fetch captures the cookie and expected-actor header at dispatch. A later
  // browser cookie change cannot rewrite this request's server identity.
  action dispatch(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "dispatch", owns(id),
      s' = s.with("requests", s.requests.set(id,
        r.with("phase", "admission").with("cookie", s.session))) }
  }
  action admit(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "admission",
      s' = s.with("requests", s.requests.set(id,
        r.with("phase", "http").with("admitted", r.cookie != 0 and r.cookie == r.actor))) }
  }
  action response(id: int, outcome: str, setup: bool): bool = {
    val r = s.requests.get(id)
    val finished = s.with("requests", s.requests.set(id,
      r.with("phase", "recheck").with("outcome", outcome).with("setup", setup)))
      .with("accepted", if (r.kind == "mutation" and outcome == "success")
        s.accepted.union(Set(id)) else s.accepted)
    all { r.phase == "http" or (r.phase == "admission" and outcome == "temporary"),
      Set("success", "temporary", "refused", "invalid").contains(outcome),
      outcome != "success" or r.admitted,
      s' = if (owns(id) and outcome == "refused") clearPrivate(finished) else finished }
  }
  action observeRecheck(id: int, available: bool): bool = all {
    s.requests.get(id).phase == "recheck",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id)
      .with("observed", s.session).with("available", available).with("phase", "recheck-observed"))) }
  action returnRecheck(id: int): bool = all { s.requests.get(id).phase == "recheck-observed",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "recheck-returned"))) }
  action useRecheck(id: int): bool = {
    val r = s.requests.get(id)
    val finished = s.with("requests", s.requests.set(id, r.with("phase", "done")))
    all { r.phase == "recheck-returned",
      s' = if (not(owns(id))) finished
      else if (not(r.available) or r.observed != r.actor)
        clearPrivate(finished).with("error", "identity")
      else if (r.outcome == "success") finished.with("data", true)
        .with("knownActor", r.actor).with("draft", if (r.kind == "mutation") false else s.draft).with("stale", false)
        .with("canSetup", s.mode == "funds" and r.setup)
      else if (r.outcome == "temporary" and s.mode == "funds" and s.data)
        finished.with("canSetup", false).with("stale", true).with("error", "request")
      else if (s.mode == "funds" or r.outcome == "refused")
        clearPrivate(finished).with("error", "request")
      else finished.with("error", "request") }
  }
  action recheck(id: int, available: bool): bool = observeRecheck(id, available)
    .then(returnRecheck(id)).then(useRecheck(id))
  action depart = all { s.mounted, s' = clearPrivate(s).with("present", false).with("mounted", false) }
  action remount = all { not(s.mounted), s.lifetime == 1,
    s' = clearPrivate(s).with("present", true).with("mounted", true).with("lifetime", 2).with("active", 0)
      .with("error", "none") }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet kind = Set("read", "mutation").oneOf()
    nondet outcome = Set("success", "temporary", "refused", "invalid").oneOf()
    nondet available = Set(false, true).oneOf()
    nondet setup = Set(false, true).oneOf()
    any { fundsMode, sessionChanges(actor), begin(id, kind), observePreflight(id, available), returnPreflight(id), usePreflight(id), dispatch(id), admit(id),
      response(id, outcome, setup), observeRecheck(id, available), returnRecheck(id), useRecheck(id), depart, remount, s' = s }
  }
  val invariant = all { not(s.present) implies not(s.mounted), s.data implies s.knownActor > 0,
    s.stale implies (s.mode == "funds" and s.data and not(s.canSetup)),
    not(s.mounted) implies not(s.data), s.accepted.subseteq(ids),
    ids.forall(id => all { s.requests.get(id).actor >= 0, s.requests.get(id).actor <= 2,
      s.requests.get(id).admitted implies s.requests.get(id).cookie == s.requests.get(id).actor }) }
  run mutationRefusalClearsBeforeRecheckTest = init.then(begin(1, "mutation"))
    .then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "refused", false))
    .expect(not(s.data) and not(s.draft) and s.requests.get(1).phase == "recheck")
  run mutationErrorRechecksChangedActorTest = init.then(begin(1, "mutation"))
    .then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "temporary", false))
    .then(sessionChanges(2)).then(recheck(1, true)).expect(not(s.data) and not(s.draft))
  run acceptedWriteSurvivesChangedActorTest = init.then(begin(1, "mutation"))
    .then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "success", false))
    .then(sessionChanges(2)).then(recheck(1, true))
    .expect(s.accepted == Set(1) and not(s.data) and s.error == "identity")
  run sameActorMutationOutageRetainsDraftTest = init.then(begin(1, "mutation"))
    .then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "temporary", false))
    .then(recheck(1, true)).expect(s.data and s.draft and s.error == "request")
  run wrongActorBeforeWriteStartsNoRequestTest = init.then(sessionChanges(2))
    .then(begin(1, "mutation")).then(preflight(1, true))
    .expect(s.requests.get(1).phase == "done" and s.accepted == Set() and not(s.draft))
  run newReadActorDropsOldDraftTest = init.then(sessionChanges(2)).then(begin(1, "read"))
    .then(preflight(1, true)).expect(not(s.draft) and not(s.data))
  run detachedAcceptedWriteCannotPublishTest = init.then(begin(1, "mutation"))
    .then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(depart).then(remount)
    .then(response(1, "success", false)).then(recheck(1, true))
    .expect(s.accepted == Set(1) and not(s.data) and s.error == "none")
  run supersededReadCannotPublishTest = init.then(begin(1, "read")).then(preflight(1, true)).then(dispatch(1)).then(admit(1))
    .then(begin(2, "read")).then(response(1, "success", false)).then(recheck(1, true))
    .expect(not(s.data) and s.active == 2)
  run unknownSessionClearsOldPrivateDataTest = init.then(begin(1, "mutation"))
    .then(preflight(1, false)).expect(not(s.data) and not(s.draft))
  run fundsChangedActorCannotPublishOldResponseTest = init.then(fundsMode)
    .then(begin(1, "read")).then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "success", true))
    .then(sessionChanges(2)).then(recheck(1, true)).expect(not(s.data) and not(s.canSetup))
  run fundsSameActorOutageRetainsChildTest = init.then(fundsMode)
    .then(begin(1, "read")).then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "temporary", true))
    .then(recheck(1, true)).expect(s.data and s.stale and not(s.canSetup))
  run fundsUnknownSessionCannotRetainStaleDataTest = init.then(fundsMode)
    .then(begin(1, "read")).then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "temporary", true))
    .then(recheck(1, false)).expect(not(s.data) and not(s.stale))
  run fundsRefusalRemovesChildBeforeRecheckTest = init.then(fundsMode)
    .then(begin(1, "read")).then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "refused", false))
    .expect(not(s.data) and not(s.canSetup))
  run fundsMalformedResponseDoesNotRetainBalanceTest = init.then(fundsMode)
    .then(begin(1, "read")).then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "invalid", false))
    .then(recheck(1, true)).expect(not(s.data))
  run swapBeforeDispatchFailsAdmissionTest = init.then(begin(1, "mutation"))
    .then(preflight(1, true)).then(sessionChanges(2)).then(dispatch(1)).then(admit(1))
    .then(response(1, "refused", false)).then(recheck(1, true))
    .expect(s.accepted == Set() and not(s.requests.get(1).admitted) and not(s.data))
  run swapAfterDispatchKeepsOriginalAdmissionTest = init.then(begin(1, "mutation"))
    .then(preflight(1, true)).then(dispatch(1)).then(sessionChanges(2)).then(admit(1))
    .then(response(1, "success", false)).then(recheck(1, true))
    .expect(s.accepted == Set(1) and s.requests.get(1).cookie == 1 and not(s.data))
  run transportFailureBeforeAdmissionRetainsOwnDraftTest = init.then(begin(1, "mutation"))
    .then(preflight(1, true)).then(dispatch(1)).then(response(1, "temporary", false))
    .then(recheck(1, true)).expect(s.data and s.draft and s.accepted == Set())
  run fundsReturnedPreflightCannotReadAfterCommittedRemovalTest = init.then(fundsMode).then(begin(1, "read"))
    .then(observePreflight(1, true)).then(returnPreflight(1)).then(depart).then(usePreflight(1))
    .expect(not(s.data) and invariant).then(dispatch(1).fail())
  run fundsObservedPreflightCannotReadAfterCommittedRemovalTest = init.then(fundsMode).then(begin(1, "read"))
    .then(observePreflight(1, true)).then(depart).then(returnPreflight(1)).then(usePreflight(1))
    .expect(s.requests.get(1).phase == "done" and invariant)
  run awardsReturnedPreflightCannotReadAfterCommittedRemovalTest = init.then(begin(1, "read"))
    .then(observePreflight(1, true)).then(returnPreflight(1)).then(depart).then(usePreflight(1))
    .expect(not(s.data) and invariant).then(dispatch(1).fail())
  run awardsObservedPreflightCannotWriteAfterCommittedRemovalTest = init.then(begin(1, "mutation"))
    .then(observePreflight(1, true)).then(depart).then(returnPreflight(1)).then(usePreflight(1))
    .expect(s.accepted == Set() and not(s.draft) and invariant).then(dispatch(1).fail())
  run detachedIdentityFailureCannotClearReplacementReadTest = init.then(fundsMode).then(begin(1, "read"))
    .then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(response(1, "temporary", false))
    .then(observeRecheck(1, false)).then(returnRecheck(1)).then(depart).then(remount)
    .then(begin(2, "read")).then(useRecheck(1)).expect(s.active == 2 and s.error == "none" and invariant)
  run sessionObservationIsNotDispatchAuthorityTest = init.then(fundsMode).then(begin(1, "read"))
    .then(observePreflight(1, true)).then(sessionChanges(2)).then(returnPreflight(1)).then(usePreflight(1))
    .then(dispatch(1)).then(admit(1)).expect(not(s.requests.get(1).admitted) and invariant)
  // The old passive cleanup left a departed reader able to start a request.
  action historicalPassiveDepart = s' = s.with("present", false)
  run historicalPassiveCleanupCouldStartPrivateReadTest = init.then(fundsMode).then(begin(1, "read"))
    .then(observePreflight(1, true)).then(historicalPassiveDepart).then(returnPreflight(1)).then(usePreflight(1))
    .then(dispatch(1)).expect(s.requests.get(1).phase == "admission" and not(invariant))

}
