// @source src/ProjectSetupStatus.tsx
// @source src/PendingProjectApplications.tsx
// @source src/ProjectProposalPage.tsx
// @source src/lib/project-api.ts
// @source backend/projects/handler.ts
// @source backend/http.ts
// @evidence tests/e2e/project-access-retry.spec.ts
// Setup-check request ownership, not the server's setup/activation policy.
// Layout cleanup retires ownership at committed departure, before passive
// effects; a preflight released by that DOM removal cannot dispatch a POST.
// Two actors, projects, request IDs and component lifetimes; unexecuted.
module ui_setup_check_lifetime {
  type Request = { phase: str, actor: int, project: int, lifetime: int,
    cookie: int, admitted: bool, outcome: str, resultProject: int }
  type State = { mounted: bool, lifetime: int, cookie: int, actor: int, project: int,
    active: int, data: bool, dataActor: int, dataProject: int, error: str,
    accepted: Set[int], requests: int -> Request }
  val ids = Set(1, 2)
  var s: State
  // Initial setup is a trusted result supplied by the parent's completed
  // actor-bound create/publish flow. Automatic empty loading is separate.
  action init = s' = { mounted: true, lifetime: 1, cookie: 1, actor: 1, project: 1,
    active: 0, data: true, dataActor: 1, dataProject: 1, error: "none", accepted: Set(),
    requests: ids.mapBy(_ => { phase: "unused", actor: 0, project: 1,
      lifetime: 1, cookie: 0, admitted: false, outcome: "none", resultProject: 1 }) }
  pure def cleared(value: State): State = value.with("data", false).with("dataActor", 0).with("dataProject", 0)
  def owns(id: int): bool = s.mounted and s.active == id
    and s.requests.get(id).lifetime == s.lifetime
    and s.requests.get(id).actor == s.actor and s.requests.get(id).project == s.project
  action emptyInitial = all { s.active == 0,
    ids.forall(id => s.requests.get(id).phase == "unused"), s' = cleared(s) }
  action cookieChanges(actor: int): bool = all { Set(0, 1, 2).contains(actor),
    s' = s.with("cookie", actor) }
  action begin(id: int): bool = all { s.mounted, s.active == 0,
    ids.contains(id), s.requests.get(id).phase == "unused",
    s' = s.with("active", id).with("error", "none")
      .with("requests", s.requests.set(id, { phase: "preflight", actor: s.actor,
        project: s.project, lifetime: s.lifetime, cookie: 0, admitted: false,
        outcome: "none", resultProject: s.project })) }
  action preflight(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "preflight",
      s' = if (not(owns(id))) s.with("requests", s.requests.set(id, r.with("phase", "done")))
      else if (not(available) or s.cookie != r.actor)
        cleared(s).with("active", 0).with("error", "identity")
          .with("requests", s.requests.set(id, r.with("phase", "done")))
      else s.with("requests", s.requests.set(id, r.with("phase", "dispatch"))) }
  }
  action dispatch(id: int): bool = {
    val r = s.requests.get(id)
    all { owns(id), r.phase == "dispatch",
      s' = s.with("requests", s.requests.set(id,
        r.with("phase", "admission").with("cookie", s.cookie))) }
  }
  action admit(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "admission",
      s' = s.with("requests", s.requests.set(id, r.with("phase", "http")
        .with("admitted", r.cookie != 0 and r.cookie == r.actor))) }
  }
  action response(id: int, outcome: str, resultProject: int): bool = {
    val r = s.requests.get(id)
    val done = s.with("requests", s.requests.set(id, r.with("phase", "recheck")
      .with("outcome", outcome).with("resultProject", resultProject)))
      .with("accepted", if (outcome == "success") s.accepted.union(Set(id)) else s.accepted)
    all { r.phase == "http" or (r.phase == "admission" and outcome == "temporary"),
      Set("success", "temporary", "refused").contains(outcome),
      Set(1, 2).contains(resultProject), outcome != "success" or r.admitted,
      s' = if (outcome == "refused") {
        val finished = done.with("requests", done.requests.set(id,
          done.requests.get(id).with("phase", "done")))
        if (owns(id)) cleared(finished).with("active", 0).with("error", "access") else finished
      } else done }
  }
  action recheck(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    val done = s.with("requests", s.requests.set(id, r.with("phase", "done")))
    all { r.phase == "recheck",
      s' = if (not(owns(id))) done
      else if (not(available) or s.cookie != r.actor)
        cleared(done).with("active", 0).with("error", "identity")
      else if (r.outcome == "success" and r.resultProject != r.project)
        cleared(done).with("active", 0).with("error", "invalid")
      else if (r.outcome == "success") done.with("active", 0).with("error", "none")
        .with("data", true).with("dataActor", r.actor).with("dataProject", r.project)
      else done.with("active", 0).with("error", "temporary") }
  }
  action depart = all { s.mounted,
    s' = cleared(s).with("mounted", false).with("active", 0) }
  action remount(actor: int, project: int): bool = all { not(s.mounted), s.lifetime == 1,
    Set(1, 2).contains(actor), Set(1, 2).contains(project),
    s' = s.with("mounted", true).with("lifetime", 2).with("actor", actor)
      .with("project", project).with("error", "none") }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet project = Set(1, 2).oneOf()
    nondet outcome = Set("success", "temporary", "refused").oneOf()
    nondet available = Set(false, true).oneOf()
    any { emptyInitial, cookieChanges(actor), begin(id), preflight(id, available), dispatch(id),
      admit(id), response(id, outcome, project), recheck(id, available), depart,
      remount(actor, project), s' = s }
  }
  val invariant = all { s.data implies (s.mounted and s.dataActor == s.actor and s.dataProject == s.project),
    s.accepted.subseteq(ids), ids.forall(id => s.requests.get(id).admitted implies
      s.requests.get(id).cookie == s.requests.get(id).actor) }
  run initialResultIsPreservedTest = init.expect(s.data and s.active == 0)
  run automaticCheckPublishesTest = init.then(emptyInitial).then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(response(1, "success", 1)).then(recheck(1, true)).expect(s.data)
  run changedActorBeforeRequestCannotCheckTest = init.then(cookieChanges(2)).then(begin(1))
    .then(preflight(1, true)).expect(not(s.data) and s.accepted == Set() and s.active == 0)
  run unknownPreflightClearsTest = init.then(begin(1)).then(preflight(1, false)).expect(not(s.data))
  run swappedDispatchIsRefusedTest = init.then(begin(1)).then(preflight(1, true)).then(cookieChanges(2))
    .then(dispatch(1)).then(admit(1)).then(response(1, "refused", 1)).expect(not(s.data) and s.accepted == Set())
  run acceptedOldActorWorkSurvivesWithoutPublicationTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(cookieChanges(2)).then(admit(1)).then(response(1, "success", 1))
    .then(recheck(1, true)).expect(s.accepted == Set(1) and not(s.data))
  run deniedCheckClearsBeforeAnotherReadTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(response(1, "refused", 1)).expect(not(s.data) and s.error == "access")
  run sameActorOutageKeepsSetupTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(response(1, "temporary", 1)).then(recheck(1, true)).expect(s.data and s.error == "temporary")
  run outageChangedActorClearsSetupTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(response(1, "temporary", 1)).then(cookieChanges(2)).then(recheck(1, true)).expect(not(s.data))
  run unavailableFinalIdentityClearsTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(response(1, "success", 1)).then(recheck(1, false)).expect(not(s.data))
  run differentProjectBodyClearsTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(response(1, "success", 2)).then(recheck(1, true)).expect(not(s.data) and s.error == "invalid")
  run departedAcceptedCheckCannotPublishTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(depart).then(remount(2, 2)).then(response(1, "success", 1))
    .then(recheck(1, true)).expect(s.accepted == Set(1) and not(s.data) and s.actor == 2)
  run departedPreflightStartsNoPostTest = init.then(begin(1)).then(depart).then(remount(1, 1))
    .then(preflight(1, true)).expect(s.requests.get(1).phase == "done" and s.accepted == Set())
  run retryAfterRefusalCanRecoverTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1)).then(response(1, "refused", 1)).then(begin(2)).then(preflight(2, true))
    .then(dispatch(2)).then(admit(2)).then(response(2, "success", 1)).then(recheck(2, true)).expect(s.data)
}
