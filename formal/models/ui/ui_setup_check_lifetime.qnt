// @source src/ProjectSetupStatus.tsx
// @source src/PendingProjectApplications.tsx
// @source src/ProjectProposalPage.tsx
// @source src/lib/project-api.ts
// @source backend/projects/handler.ts
// @source backend/http.ts
// @evidence tests/e2e/project-access-retry.spec.ts
// @evidence tests/e2e/project-setup-resume.spec.ts
// Setup-check request ownership, not the server's setup/activation policy.
// Layout cleanup retires ownership at committed departure, before passive
// effects; a preflight released by that DOM removal cannot dispatch a POST.
// Two actors, projects, request IDs and component lifetimes; one Suspense
// hide/reveal cycle. Hiding retires request ownership but retains component
// state. Reveal restarts the layout auto-check only without a supplied initial
// result. A replacement uses the other unused request slot; this is the
// two-request bound, not a production retry limit. True departure and remount
// remain distinct from hiding a committed component. A supplied-initial manual
// check is not automatically replaced on reveal; its retained busy state is an
// explicit remaining limitation, not a claim of recovery by this fix.
module ui_setup_check_lifetime {
  type Request = { phase: str, actor: int, project: int, lifetime: int,
    cookie: int, admitted: bool, outcome: str, resultProject: int }
  type State = { mounted: bool, hidden: bool, hiddenOnce: bool, suppliedInitial: bool, resumed: bool, busy: bool,
    lifetime: int, cookie: int, actor: int, project: int,
    active: int, data: bool, dataActor: int, dataProject: int, error: str,
    accepted: Set[int], requests: int -> Request }
  val ids = Set(1, 2)
  var s: State
  // Initial setup is a trusted result supplied by the parent's completed
  // actor-bound create/publish flow. Automatic empty loading is separate.
  action init = s' = { mounted: true, hidden: false, hiddenOnce: false, suppliedInitial: true, resumed: false, busy: false,
    lifetime: 1, cookie: 1, actor: 1, project: 1,
    active: 0, data: true, dataActor: 1, dataProject: 1, error: "none", accepted: Set(),
    requests: ids.mapBy(_ => { phase: "unused", actor: 0, project: 1,
      lifetime: 1, cookie: 0, admitted: false, outcome: "none", resultProject: 1 }) }
  pure def cleared(value: State): State = value.with("data", false).with("dataActor", 0).with("dataProject", 0)
  def owns(id: int): bool = s.mounted and s.active == id
    and s.requests.get(id).lifetime == s.lifetime
    and s.requests.get(id).actor == s.actor and s.requests.get(id).project == s.project
  action emptyInitial = all { s.active == 0, not(s.hiddenOnce), s.lifetime == 1,
    ids.forall(id => s.requests.get(id).phase == "unused"), s' = cleared(s).with("suppliedInitial", false).with("busy", true) }
  action cookieChanges(actor: int): bool = all { Set(0, 1, 2).contains(actor),
    s' = s.with("cookie", actor) }
  action begin(id: int): bool = all { s.mounted, s.active == 0,
    ids.contains(id), s.requests.get(id).phase == "unused",
    s' = s.with("active", id).with("busy", true).with("error", "none")
      .with("requests", s.requests.set(id, { phase: "preflight", actor: s.actor,
        project: s.project, lifetime: s.lifetime, cookie: 0, admitted: false,
        outcome: "none", resultProject: s.project })) }
  action preflight(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "preflight",
      s' = if (not(owns(id))) s.with("requests", s.requests.set(id, r.with("phase", "done")))
      else if (not(available) or s.cookie != r.actor)
        cleared(s).with("active", 0).with("busy", false).with("error", "identity")
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
        if (owns(id)) cleared(finished).with("active", 0).with("busy", false).with("error", "access") else finished
      } else done }
  }
  action recheck(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    val done = s.with("requests", s.requests.set(id, r.with("phase", "done")))
    all { r.phase == "recheck",
      s' = if (not(owns(id))) done
      else if (not(available) or s.cookie != r.actor)
        cleared(done).with("active", 0).with("busy", false).with("error", "identity")
      else if (r.outcome == "success" and r.resultProject != r.project)
        cleared(done).with("active", 0).with("busy", false).with("error", "invalid")
      else if (r.outcome == "success") done.with("active", 0).with("busy", false).with("error", "none")
        .with("data", true).with("dataActor", r.actor).with("dataProject", r.project)
      else done.with("active", 0).with("busy", false).with("error", "temporary") }
  }
  action depart = all { s.mounted,
    s' = cleared(s).with("mounted", false).with("active", 0).with("busy", false) }
  // React hides the committed subtree and retires layout effects without
  // deleting its hook state. No retained setup is exposed while hidden.
  action hide = all { s.mounted, not(s.hiddenOnce),
    s' = s.with("mounted", false).with("hidden", true).with("hiddenOnce", true).with("active", 0) }
  action reveal(id: int): bool = all { s.hidden, ids.contains(id),
    s.suppliedInitial or s.requests.get(id).phase == "unused",
    s' = if (s.suppliedInitial) s.with("mounted", true).with("hidden", false).with("resumed", true)
    else s.with("mounted", true).with("hidden", false).with("resumed", true).with("active", id).with("busy", true).with("error", "none")
      .with("requests", s.requests.set(id, { phase: "preflight", actor: s.actor,
        project: s.project, lifetime: s.lifetime, cookie: 0, admitted: false,
        outcome: "none", resultProject: s.project })) }
  action remount(actor: int, project: int): bool = all { not(s.mounted), s.lifetime == 1,
    not(s.hidden),
    Set(1, 2).contains(actor), Set(1, 2).contains(project),
    s' = s.with("mounted", true).with("lifetime", 2).with("actor", actor)
      .with("project", project).with("error", "none") }
  // Bind choices inside the branch that reads them. Every original domain
  // is nonempty, so distributing existential choice over this disjunction
  // preserves enabledness and full-state successors while avoiding duplicate
  // Cartesian enumeration. Invariants, direct actions and finite bounds stay.
  action step = any {
    emptyInitial,
    { nondet actor = Set(0, 1, 2).oneOf()
      cookieChanges(actor) },
    { nondet id = ids.oneOf()
      begin(id) },
    { nondet id = ids.oneOf()
      nondet available = Set(false, true).oneOf()
      preflight(id, available) },
    { nondet id = ids.oneOf()
      dispatch(id) },
    { nondet id = ids.oneOf()
      admit(id) },
    { nondet id = ids.oneOf()
      nondet project = Set(1, 2).oneOf()
      nondet outcome = Set("success", "temporary", "refused").oneOf()
      response(id, outcome, project) },
    { nondet id = ids.oneOf()
      nondet available = Set(false, true).oneOf()
      recheck(id, available) },
    depart,
    hide,
    { nondet id = ids.oneOf()
      reveal(id) },
    { nondet actor = Set(0, 1, 2).oneOf()
      nondet project = Set(1, 2).oneOf()
      remount(actor, project) },
    s' = s
  }

  val invariant = all { s.data implies ((s.mounted or s.hidden) and s.dataActor == s.actor and s.dataProject == s.project),
    s.hidden implies (not(s.mounted) and s.active == 0),
    s.resumed and not(s.suppliedInitial) and s.mounted and s.busy implies s.active > 0,
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
  run hiddenCompletionIsReplacedOnRevealTest = init.then(emptyInitial).then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(hide).then(response(1, "success", 1)).then(recheck(1, true))
    .expect(s.hidden and not(s.data) and s.active == 0)
    .then(reveal(2)).expect(s.active == 2 and s.requests.get(2).phase == "preflight")
    .then(preflight(2, true)).then(dispatch(2)).then(admit(2)).then(response(2, "success", 1))
    .then(recheck(2, true)).expect(s.data and not(s.busy) and s.active == 0 and not(s.hidden) and s.lifetime == 1)
  run hiddenLateReplyCannotRetireReplacementTest = init.then(emptyInitial).then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(hide).then(reveal(2)).then(response(1, "success", 1))
    .then(recheck(1, true)).expect(s.active == 2 and not(s.data) and s.requests.get(2).phase == "preflight")
  run hiddenSuppliedInitialIsPreservedWithoutCheckTest = init.then(hide).expect(s.hidden and s.data)
    .then(reveal(1)).expect(s.data and s.active == 0 and s.requests.get(1).phase == "unused" and invariant)
  run hiddenPreflightCannotDispatchAfterRevealTest = init.then(emptyInitial).then(begin(1)).then(hide)
    .then(reveal(2)).then(preflight(1, true))
    .expect(s.requests.get(1).phase == "done" and s.active == 2 and s.accepted == Set())
  // The previous passive auto-check did not rerun on reveal. Keep its stuck
  // busy state as a negative control, never as a production transition.
  action oldRevealWithoutAutomaticCheck = all { s.hidden,
    s' = s.with("mounted", true).with("hidden", false).with("resumed", true) }
  run oldRevealLeavesCheckingWithoutRequestTest = init.then(emptyInitial).then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1)).then(hide).then(response(1, "success", 1)).then(recheck(1, true))
    .then(oldRevealWithoutAutomaticCheck).expect(s.busy and s.active == 0 and not(invariant))
  // The parent removal view unmounts this child before the remote removal
  // outcome is known. Accepted setup work remains server history, while no
  // delayed response can restore the retired child or start its final read.
  run parentRemovalRetiresAcceptedSetupCheckTest = init.then(emptyInitial).then(begin(1))
    .then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(depart)
    .then(response(1, "success", 1)).then(recheck(1, true))
    .expect(not(s.mounted) and not(s.data) and s.active == 0 and not(s.busy) and s.accepted == Set(1))
  run revealedSetupIsRetiredByParentRemovalTest = init.then(emptyInitial).then(begin(1))
    .then(preflight(1, true)).then(dispatch(1)).then(admit(1)).then(hide).then(reveal(2))
    .then(preflight(2, true)).then(dispatch(2)).then(admit(2)).then(depart)
    .then(response(2, "success", 1)).then(recheck(2, true))
    .expect(not(s.mounted) and not(s.data) and s.active == 0 and not(s.busy))
}
