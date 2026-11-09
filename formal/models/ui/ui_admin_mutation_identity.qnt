// @source src/Admin.tsx
// @source src/AdminProjectEnforcement.tsx
// @source src/lib/admin-request.ts
// @source src/lib/project-api.ts
// @source backend/projects/handler.ts
// @source backend/http.ts
// @evidence tests/e2e/admin-editor-lifetime.spec.ts
// Save and non-editor mutation ownership; backend revision rules are separate.
// Two actors/requests/lifetimes, three draft values. Source-only, unexecuted.
module ui_admin_mutation_identity {
  type Request = { phase: str, kind: str, actor: int, cookie: int, lifetime: int,
    draft: int, admitted: bool, accepted: bool }
  type State = { mounted: bool, lifetime: int, actor: int, cookie: int, admin: bool,
    data: bool, draft: int, stored: int, active: int, error: str,
    accepted: Set[int], callbacks: Set[int], requests: int -> Request,
    didClear: bool, clearExpected: int, clearObserved: int }
  val ids = Set(1, 2)
  var s: State
  action init = s' = { mounted: true, lifetime: 1, actor: 1, cookie: 1, admin: true,
    data: true, draft: 1, stored: 1, active: 0, error: "none", accepted: Set(), callbacks: Set(),
    requests: ids.mapBy(_ => { phase: "unused", kind: "save", actor: 0, cookie: 0,
      lifetime: 1, draft: 0, admitted: false, accepted: false }),
    didClear: false, clearExpected: 0, clearObserved: 0 }
  def owns(id: int): bool = s.mounted and s.active == id
    and s.requests.get(id).lifetime == s.lifetime
  pure def done(value: State, id: int): State = value.with("requests",
    value.requests.set(id, value.requests.get(id).with("phase", "done")))
  pure def denied(value: State): State = value.with("data", false).with("active", 0).with("error", "identity")
  action sessionChanges(actor: int, admin: bool): bool = all { Set(0, 1, 2).contains(actor),
    s' = s.with("cookie", actor).with("admin", admin and actor != 0) }
  action edit(value: int): bool = all { s.mounted, s.data, Set(1, 2, 3).contains(value),
    s' = s.with("draft", value).with("stored", value) }
  action begin(id: int, kind: str): bool = all { s.mounted, s.data, s.active == 0,
    ids.contains(id), s.requests.get(id).phase == "unused", Set("save", "action").contains(kind),
    s' = s.with("active", id).with("error", "none").with("requests", s.requests.set(id,
      { phase: "preflight", kind: kind, actor: s.actor, cookie: 0, lifetime: s.lifetime,
        draft: s.draft, admitted: false, accepted: false })) }
  action preflight(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "preflight", s' = if (not(owns(id))) done(s, id)
      else if (not(available) or s.cookie != r.actor or not(s.admin)) denied(done(s, id))
      else s.with("requests", s.requests.set(id, r.with("phase", "dispatch"))) }
  }
  action dispatch(id: int): bool = {
    val r = s.requests.get(id)
    all { owns(id), r.phase == "dispatch",
      s' = s.with("requests", s.requests.set(id, r.with("phase", "admission").with("cookie", s.cookie))) }
  }
  action admit(id: int, permitted: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "admission", s' = s.with("requests", s.requests.set(id,
      r.with("phase", "http").with("admitted", permitted and r.cookie != 0 and r.cookie == r.actor))) }
  }
  action commit(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "http", r.admitted, not(r.accepted),
      s' = s.with("accepted", s.accepted.union(Set(id))).with("requests",
        s.requests.set(id, r.with("accepted", true))) }
  }
  action response(id: int, outcome: str, storageWorks: bool): bool = {
    val r = s.requests.get(id)
    val clear = outcome == "success" and r.kind == "save" and s.stored == r.draft and storageWorks
    val received = s.with("stored", if (clear) 0 else s.stored).with("didClear", clear)
      .with("clearExpected", r.draft).with("clearObserved", s.stored)
      .with("requests", s.requests.set(id, r.with("phase", "recheck")))
    all { r.phase == "http", Set("success", "temporary", "refused").contains(outcome),
      outcome != "success" or r.accepted,
      s' = if (not(owns(id))) done(received, id)
      else if (outcome == "refused") denied(done(received, id))
      else received.with("error", if (outcome == "temporary") "request" else "none") }
  }
  action recheck(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    val completed = done(s, id).with("active", 0)
    all { r.phase == "recheck", s' = if (not(owns(id))) done(s, id)
      else if (not(available) or s.cookie != r.actor or not(s.admin)) denied(completed)
      else if (s.error == "request") completed
      else if (r.kind == "save" and s.draft != r.draft) completed.with("error", "newer-draft")
      else completed.with("callbacks", s.callbacks.union(Set(id))) }
  }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("data", false).with("active", 0) }
  action remount(actor: int): bool = all { not(s.mounted), s.lifetime == 1, Set(1, 2).contains(actor),
    s' = s.with("mounted", true).with("lifetime", 2).with("actor", actor)
      .with("data", true).with("draft", s.stored).with("error", "none") }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet draft = Set(1, 2, 3).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet kind = Set("save", "action").oneOf()
    nondet outcome = Set("success", "temporary", "refused").oneOf()
    any { sessionChanges(actor, flag), edit(draft), begin(id, kind), preflight(id, flag), dispatch(id),
      admit(id, flag), commit(id), response(id, outcome, flag), recheck(id, flag), depart, remount(actor), s' = s }
  }
  val invariant = all { s.callbacks.subseteq(s.accepted), s.didClear implies s.clearExpected == s.clearObserved,
    ids.forall(id => s.requests.get(id).admitted implies s.requests.get(id).cookie == s.requests.get(id).actor) }
  run ordinarySaveClearsMatchingDraftTest = init.then(begin(1, "save")).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(commit(1)).then(response(1, "success", true))
    .then(recheck(1, true)).expect(s.stored == 0 and s.callbacks == Set(1))
  run changedDraftStaysOpenTest = init.then(begin(1, "save")).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(edit(2)).then(commit(1)).then(response(1, "success", true))
    .then(recheck(1, true)).expect(s.stored == 2 and s.error == "newer-draft" and s.callbacks == Set())
  run departedAcceptedSaveCannotClearNewDraftTest = init.then(begin(1, "save")).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(depart).then(remount(1)).then(edit(2))
    .then(commit(1)).then(response(1, "success", true)).expect(s.stored == 2 and s.callbacks == Set())
  run departedAcceptedSaveCanClearUnchangedBytesTest = init.then(begin(1, "save")).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(depart).then(commit(1)).then(response(1, "success", true))
    .expect(s.stored == 0 and s.accepted == Set(1) and s.callbacks == Set())
  run knownRefusalHidesPrivateViewKeepsDraftTest = init.then(begin(1, "save")).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, false)).then(response(1, "refused", true))
    .expect(not(s.data) and s.stored == 1)
  run temporaryErrorNeedsMatchingActorTest = init.then(begin(1, "action")).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "temporary", true))
    .then(sessionChanges(2, false)).then(recheck(1, true)).expect(not(s.data) and s.stored == 1)
  run unknownErrorIdentityHidesPrivateViewTest = init.then(begin(1, "save")).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "temporary", true))
    .then(recheck(1, false)).expect(not(s.data))
  run sameActorFailurePreservesDraftTest = init.then(begin(1, "save")).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "temporary", true))
    .then(recheck(1, true)).expect(s.data and s.stored == 1 and s.callbacks == Set())
  run swapBeforeDispatchCannotCommitTest = init.then(begin(1, "action")).then(preflight(1, true))
    .then(sessionChanges(2, true)).then(dispatch(1)).then(admit(1, true)).then(response(1, "refused", true))
    .expect(s.accepted == Set() and not(s.data))
  run swapAfterCommitCannotPublishSuccessTest = init.then(begin(1, "action")).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(commit(1)).then(sessionChanges(2, false))
    .then(response(1, "success", true)).then(recheck(1, true)).expect(s.accepted == Set(1) and s.callbacks == Set())
  run departedPreflightStartsNoMutationTest = init.then(begin(1, "save")).then(depart).then(preflight(1, true))
    .expect(s.requests.get(1).phase == "done" and s.accepted == Set())
  run busyCallerRefusesSecondMutationTest = init.then(begin(1, "save")).then(begin(2, "save").fail())
}
