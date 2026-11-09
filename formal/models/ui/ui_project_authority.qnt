// @source src/lib/project-api.ts
// @source src/ProjectProposalPage.tsx
// @source src/Presentation.tsx
// @source src/EscrowFunding.tsx
// @source backend/projects/handler.ts
// @source backend/http.ts
// @evidence tests/e2e/project-access-retry.spec.ts
// Only useProjectMaintainer, its caller gates, and expected-actor admission.
// Two actors, projects, requests and lifetimes. Source-only; not executed.
//
// Finite step reductions (direct actions and scenarios keep exact requests):
// - Retired requests. After begin, ownership of a request is absorbing-false:
//   active only names an unused id at begin, and every change of mounted,
//   lifetime, project or actor also clears active. A request that is not
//   owned, or is done, can no longer change any other field: dispatch needs
//   ownership and recheck of an unowned request only marks it done. Its
//   own fields are read only by the admitted conjunct of the invariant, which
//   admit establishes from the same cookie and actor and nothing later
//   changes. stepSettle therefore replaces such a request by one fixed done
//   record (admitted false) in the actions that can retire a request.
// - Request IDs are opaque and symmetric, so step begins the lowest unused id.
// - A response viewer is read only for a success, and only by comparison with
//   the request actor (1 or 2), so step offers viewer 0 for every non-success
//   and the actor or 0 for a success.
module ui_project_authority {
  type Request = { phase: str, actor: int, project: int, lifetime: int,
    cookie: int, admitted: bool, outcome: str, viewer: int }
  type State = { mounted: bool, lifetime: int, cookie: int, actor: int,
    project: int, active: int, verified: int, status: str,
    requests: int -> Request }
  val ids = Set(1, 2)
  var s: State
  action init = s' = { mounted: true, lifetime: 1, cookie: 1, actor: 0,
    project: 1, active: 0, verified: 0, status: "checking",
    requests: ids.mapBy(_ => { phase: "unused", actor: 0, project: 1,
      lifetime: 1, cookie: 0, admitted: false, outcome: "none", viewer: 0 }) }
  def ownsIn(st: State, id: int): bool = st.mounted and st.active == id
    and st.requests.get(id).lifetime == st.lifetime
    and st.requests.get(id).project == st.project
    and st.requests.get(id).actor == st.actor
  def owns(id: int): bool = ownsIn(s, id)
  pure val retired = { phase: "done", actor: 0, project: 0, lifetime: 0,
    cookie: 0, admitted: false, outcome: "none", viewer: 0 }
  def stepSettle(reduce: bool, st: State): State = if (not(reduce)) st
    else st.with("requests", ids.mapBy(id => {
      val r = st.requests.get(id)
      if (r.phase == "unused" or (r.phase != "done" and ownsIn(st, id))) r else retired
    }))
  action cookieChanges(actor: int): bool = all { Set(0, 1, 2).contains(actor),
    s' = s.with("cookie", actor) }
  // useProjectSession observations and focus invalidation precede the
  // separately authenticated maintainer request.
  action sessionObservedWith(actor: int, reduce: bool): bool = all { s.mounted,
    Set(0, 1, 2).contains(actor),
    s' = stepSettle(reduce, s.with("actor", actor).with("verified", 0).with("active", 0)
      .with("status", if (actor == 0) "signed-out" else "checking")) }
  action sessionObserved(actor: int): bool = sessionObservedWith(actor, false)
  action focusWith(reduce: bool): bool = all { s.mounted,
    s' = stepSettle(reduce, s.with("actor", 0).with("verified", 0).with("active", 0)
      .with("status", "checking")) }
  action focus = focusWith(false)
  action beginWith(id: int, reduce: bool): bool = all { s.mounted, s.actor != 0,
    ids.contains(id), s.requests.get(id).phase == "unused",
    s' = stepSettle(reduce, s.with("active", id).with("verified", 0).with("status", "checking")
      .with("requests", s.requests.set(id, { phase: "dispatch", actor: s.actor,
        project: s.project, lifetime: s.lifetime, cookie: 0, admitted: false,
        outcome: "none", viewer: 0 }))) }
  action begin(id: int): bool = beginWith(id, false)
  action dispatch(id: int): bool = {
    val r = s.requests.get(id)
    all { owns(id), r.phase == "dispatch",
      s' = s.with("requests", s.requests.set(id,
        r.with("phase", "admission").with("cookie", s.cookie))) }
  }
  // A browser cookie change after dispatch does not alter this snapshot.
  action admit(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "admission",
      s' = s.with("requests", s.requests.set(id, r.with("phase", "http")
        .with("admitted", r.cookie != 0 and r.cookie == r.actor))) }
  }
  action response(id: int, outcome: str, viewer: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "http", Set("success", "refused", "temporary").contains(outcome),
      outcome != "success" or r.admitted, Set(0, 1, 2).contains(viewer),
      s' = s.with("requests", s.requests.set(id, r.with("phase", "recheck")
        .with("outcome", outcome).with("viewer", viewer))) }
  }
  action recheck(id: int, available: bool): bool = recheckWith(id, available, false)
  action recheckWith(id: int, available: bool, reduce: bool): bool = {
    val r = s.requests.get(id)
    val done = s.with("requests", s.requests.set(id, r.with("phase", "done")))
    val identityMatches = available and s.cookie == r.actor
    all { r.phase == "recheck",
      s' = stepSettle(reduce, if (not(owns(id))) done
      else if (not(identityMatches) or (r.outcome == "success" and r.viewer != r.actor))
        done.with("verified", 0).with("status", "error")
      else if (r.outcome == "success") done.with("verified", r.actor).with("status", "allowed")
      else done.with("verified", 0).with("status",
        if (r.outcome == "refused") "refused" else "error")) }
  }
  action changeProjectWith(reduce: bool): bool = all { s.mounted, s.project == 1,
    s' = stepSettle(reduce, s.with("project", 2).with("active", 0).with("verified", 0)
      .with("status", "checking")) }
  action changeProject = changeProjectWith(false)
  action departWith(reduce: bool): bool = all { s.mounted,
    s' = stepSettle(reduce, s.with("mounted", false).with("verified", 0).with("active", 0)) }
  action depart = departWith(false)
  action remount = all { not(s.mounted), s.lifetime == 1,
    s' = s.with("mounted", true).with("lifetime", 2).with("actor", 0)
      .with("status", "checking") }
  val controls = s.mounted and s.actor != 0 and s.verified == s.actor
  action step = any {
    { nondet actor = Set(0, 1, 2).oneOf() cookieChanges(actor) },
    { nondet actor = Set(0, 1, 2).oneOf() sessionObservedWith(actor, true) },
    focusWith(true),
    { nondet id = ids.oneOf() all { id == 1 or s.requests.get(1).phase != "unused", beginWith(id, true) } },
    { nondet id = ids.oneOf() dispatch(id) },
    { nondet id = ids.oneOf() admit(id) },
    { nondet id = ids.oneOf() nondet viewer = Set(0, 1, 2).oneOf()
      nondet outcome = Set("success", "refused", "temporary").oneOf()
      all { viewer == 0 or (outcome == "success" and viewer == s.requests.get(id).actor),
        response(id, outcome, viewer) } },
    { nondet id = ids.oneOf() nondet available = Set(false, true).oneOf() recheckWith(id, available, true) },
    changeProjectWith(true),
    departWith(true),
    remount,
    s' = s,
  }
  val invariant = all { controls implies s.status == "allowed",
    not(s.mounted) implies not(controls),
    ids.forall(id => s.requests.get(id).admitted implies
      s.requests.get(id).cookie == s.requests.get(id).actor) }
  run matchingActorGrantsTest = init.then(sessionObserved(1)).then(begin(1)).then(dispatch(1))
    .then(admit(1)).then(response(1, "success", 1)).then(recheck(1, true)).expect(controls)
  run cookieSwapBeforeDispatchRefusesTest = init.then(sessionObserved(1)).then(begin(1))
    .then(cookieChanges(2)).then(dispatch(1)).then(admit(1)).then(response(1, "refused", 2))
    .then(recheck(1, true)).expect(not(controls) and s.status == "error")
  run cookieSwapAfterDispatchCannotPublishTest = init.then(sessionObserved(1)).then(begin(1))
    .then(dispatch(1)).then(cookieChanges(2)).then(admit(1)).then(response(1, "success", 1))
    .then(recheck(1, true)).expect(s.requests.get(1).admitted and not(controls))
  run wrongViewerCannotGrantTest = init.then(sessionObserved(1)).then(begin(1)).then(dispatch(1))
    .then(admit(1)).then(response(1, "success", 2)).then(recheck(1, true)).expect(not(controls))
  run refusedSameActorIsNotGrantedTest = init.then(sessionObserved(1)).then(begin(1)).then(dispatch(1))
    .then(admit(1)).then(response(1, "refused", 1)).then(recheck(1, true))
    .expect(s.status == "refused" and not(controls))
  run failedRequestStillChecksIdentityTest = init.then(sessionObserved(1)).then(begin(1)).then(dispatch(1))
    .then(admit(1)).then(response(1, "temporary", 0)).then(cookieChanges(2))
    .then(recheck(1, true)).expect(s.status == "error" and not(controls))
  run unknownFinalIdentityCannotGrantTest = init.then(sessionObserved(1)).then(begin(1)).then(dispatch(1))
    .then(admit(1)).then(response(1, "success", 1)).then(recheck(1, false)).expect(not(controls))
  run focusInvalidatesOldAuthorityTest = init.then(sessionObserved(1)).then(begin(1)).then(dispatch(1))
    .then(admit(1)).then(focus).then(response(1, "success", 1)).then(recheck(1, true))
    .expect(not(controls) and s.status == "checking")
  run oldProjectReplyCannotGrantTest = init.then(sessionObserved(1)).then(begin(1)).then(dispatch(1))
    .then(admit(1)).then(changeProject).then(response(1, "success", 1)).then(recheck(1, true))
    .expect(not(controls) and s.project == 2)
  run departedReplyCannotGrantTest = init.then(sessionObserved(1)).then(begin(1)).then(dispatch(1))
    .then(admit(1)).then(depart).then(remount).then(response(1, "success", 1)).then(recheck(1, true))
    .expect(not(controls) and s.lifetime == 2)
  run newerActorOwnsGrantTest = init.then(sessionObserved(1)).then(begin(1)).then(dispatch(1)).then(admit(1))
    .then(focus).then(cookieChanges(2)).then(sessionObserved(2)).then(begin(2)).then(dispatch(2)).then(admit(2))
    .then(response(2, "success", 2)).then(recheck(2, true))
    .then(response(1, "success", 1)).then(recheck(1, true)).expect(controls and s.verified == 2)
}
