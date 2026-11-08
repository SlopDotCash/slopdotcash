// @source src/lib/project-api.ts
// @source src/ProjectProposalPage.tsx
// @source src/Presentation.tsx
// @source src/EscrowFunding.tsx
// @source backend/projects/handler.ts
// @source backend/http.ts
// @evidence tests/e2e/project-access-retry.spec.ts
// Only useProjectMaintainer, its caller gates, and expected-actor admission.
// Two actors, projects, requests and lifetimes. Source-only; not executed.
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
  def owns(id: int): bool = s.mounted and s.active == id
    and s.requests.get(id).lifetime == s.lifetime
    and s.requests.get(id).project == s.project
    and s.requests.get(id).actor == s.actor
  action cookieChanges(actor: int): bool = all { Set(0, 1, 2).contains(actor),
    s' = s.with("cookie", actor) }
  // useProjectSession observations and focus invalidation precede the
  // separately authenticated maintainer request.
  action sessionObserved(actor: int): bool = all { s.mounted,
    Set(0, 1, 2).contains(actor),
    s' = s.with("actor", actor).with("verified", 0).with("active", 0)
      .with("status", if (actor == 0) "signed-out" else "checking") }
  action focus = all { s.mounted,
    s' = s.with("actor", 0).with("verified", 0).with("active", 0)
      .with("status", "checking") }
  action begin(id: int): bool = all { s.mounted, s.actor != 0,
    ids.contains(id), s.requests.get(id).phase == "unused",
    s' = s.with("active", id).with("verified", 0).with("status", "checking")
      .with("requests", s.requests.set(id, { phase: "dispatch", actor: s.actor,
        project: s.project, lifetime: s.lifetime, cookie: 0, admitted: false,
        outcome: "none", viewer: 0 })) }
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
  action recheck(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    val done = s.with("requests", s.requests.set(id, r.with("phase", "done")))
    val identityMatches = available and s.cookie == r.actor
    all { r.phase == "recheck",
      s' = if (not(owns(id))) done
      else if (not(identityMatches) or (r.outcome == "success" and r.viewer != r.actor))
        done.with("verified", 0).with("status", "error")
      else if (r.outcome == "success") done.with("verified", r.actor).with("status", "allowed")
      else done.with("verified", 0).with("status",
        if (r.outcome == "refused") "refused" else "error") }
  }
  action changeProject = all { s.mounted, s.project == 1,
    s' = s.with("project", 2).with("active", 0).with("verified", 0).with("status", "checking") }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("verified", 0).with("active", 0) }
  action remount = all { not(s.mounted), s.lifetime == 1,
    s' = s.with("mounted", true).with("lifetime", 2).with("actor", 0)
      .with("status", "checking") }
  val controls = s.mounted and s.actor != 0 and s.verified == s.actor
  action step = {
    nondet id = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet outcome = Set("success", "refused", "temporary").oneOf()
    nondet available = Set(false, true).oneOf()
    any { cookieChanges(actor), sessionObserved(actor), focus, begin(id), dispatch(id), admit(id),
      response(id, outcome, actor), recheck(id, available), changeProject, depart, remount, s' = s }
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
