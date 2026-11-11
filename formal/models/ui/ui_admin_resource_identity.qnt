// @source src/Admin.tsx
// @source src/lib/use-public-resource.ts
// @source src/lib/project-api.ts
// @source backend/projects/handler.ts
// @source backend/fee-conversions/handler.ts
// @source backend/http.ts
// @evidence tests/e2e/admin-refresh-retention.spec.ts
// Only private list/fee reads and retention, not editor/fee execution semantics.
// Two actors, requests and lifetimes; source-only and unexecuted.
module ui_admin_resource_identity {
  type Request = { phase: str, actor: int, cookie: int, lifetime: int,
    admitted: bool, outcome: str, settled: bool }
  type State = { mounted: bool, lifetime: int, actor: int, cookie: int, admin: bool,
    active: int, retain: bool, data: bool, dataActor: int, status: str, error: str,
    requests: int -> Request }
  val ids = Set(1, 2)
  var s: State
  action init = s' = { mounted: true, lifetime: 1, actor: 1, cookie: 1, admin: true,
    active: 0, retain: true, data: false, dataActor: 0, status: "loading", error: "none",
    requests: ids.mapBy(_ => { phase: "unused", actor: 0, cookie: 0,
      lifetime: 1, admitted: false, outcome: "none", settled: false }) }
  def owns(id: int): bool = s.mounted and s.active == id
    and s.requests.get(id).lifetime == s.lifetime and not(s.requests.get(id).settled)
  pure def clear(value: State, error: str): State = value.with("data", false).with("dataActor", 0)
    .with("status", "error").with("error", error)
  pure def done(value: State, id: int): State = value.with("requests", value.requests.set(id,
    value.requests.get(id).with("phase", "done").with("settled", true)))
  action observedSession(actor: int, admin: bool): bool = all { Set(0, 1, 2).contains(actor),
    s' = s.with("cookie", actor).with("admin", admin and actor != 0) }
  action feeMode = all { s.active == 0, not(s.data),
    ids.forall(id => s.requests.get(id).phase == "unused"), s' = s.with("retain", false) }
  action begin(id: int): bool = all { s.mounted, ids.contains(id),
    s.requests.get(id).phase == "unused",
    s' = s.with("active", id).with("status", if (s.retain and s.data) s.status else "loading")
      .with("data", s.retain and s.data).with("dataActor", if (s.retain) s.dataActor else 0)
      .with("requests", s.requests.set(id,
      { phase: "preflight", actor: s.actor, cookie: 0, lifetime: s.lifetime,
        admitted: false, outcome: "none", settled: false })) }
  action preflight(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "preflight",
      s' = if (not(owns(id))) done(s, id)
      else if (not(available) or s.cookie != r.actor or not(s.admin)) clear(done(s, id), "identity")
      else s.with("requests", s.requests.set(id, r.with("phase", "dispatch"))) }
  }
  action dispatch(id: int): bool = {
    val r = s.requests.get(id)
    all { owns(id), r.phase == "dispatch",
      s' = s.with("requests", s.requests.set(id, r.with("phase", "admission").with("cookie", s.cookie))) }
  }
  // Server permission is checked independently; later browser cookie changes
  // do not change the actor already captured by this request.
  action admit(id: int, permitted: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "admission",
      s' = s.with("requests", s.requests.set(id, r.with("phase", "http")
        .with("admitted", permitted and r.cookie != 0 and r.cookie == r.actor))) }
  }
  action response(id: int, outcome: str): bool = {
    val r = s.requests.get(id)
    all { r.phase == "http", Set("success", "transient", "refused", "invalid").contains(outcome),
      outcome != "success" or r.admitted,
      s' = if (not(owns(id))) done(s, id)
      else if (outcome == "refused") clear(done(s, id), "access")
      else s.with("requests", s.requests.set(id, r.with("phase", "recheck").with("outcome", outcome))) }
  }
  action recheck(id: int, available: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "recheck",
      s' = if (not(owns(id))) done(s, id)
      else if (not(available) or s.cookie != r.actor or not(s.admin)) clear(done(s, id), "identity")
      else if (r.outcome == "success") done(s, id).with("data", true).with("dataActor", r.actor)
        .with("status", "ready").with("error", "none")
      else if (r.outcome == "transient" and s.retain and s.data)
        done(s, id).with("status", "ready").with("error", "rechecked-transient")
      else clear(done(s, id), "request") }
  }
  action timeout(id: int): bool = all { owns(id),
    s' = clear(done(s, id), "timeout") }
  action lateOutcome(id: int): bool = all { s.requests.get(id).settled, s' = s }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("active", 0).with("data", false).with("dataActor", 0) }
  action remount(actor: int): bool = all { not(s.mounted), s.lifetime == 1,
    Set(1, 2).contains(actor), s' = s.with("mounted", true).with("lifetime", 2)
      .with("actor", actor).with("status", "loading").with("error", "none") }
  action step = {
    nondet id = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet outcome = Set("success", "transient", "refused", "invalid").oneOf()
    any { feeMode, observedSession(actor, flag), begin(id), preflight(id, flag), dispatch(id), admit(id, flag),
      response(id, outcome), recheck(id, flag), timeout(id), lateOutcome(id), depart, remount(actor), s' = s }
  }
  val invariant = all { s.data implies (s.mounted and s.dataActor == s.actor and s.status == "ready"),
    s.error == "timeout" implies not(s.data),
    ids.forall(id => s.requests.get(id).admitted implies
      s.requests.get(id).cookie == s.requests.get(id).actor) }
  run matchingAdminLoadsPrivateDataTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "success")).then(recheck(1, true))
    .expect(s.data and s.dataActor == 1)
  run preflightChangeStartsNoPrivateGetTest = init.then(begin(1)).then(observedSession(2, true))
    .then(preflight(1, true)).expect(not(s.data) and s.requests.get(1).phase == "done")
  run capturedRequestSurvivesCookieChangeButCannotPublishTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(observedSession(2, false)).then(admit(1, true))
    .then(response(1, "success")).then(recheck(1, true)).expect(not(s.data))
  run changedBeforeDispatchFailsAdmissionTest = init.then(begin(1)).then(preflight(1, true))
    .then(observedSession(2, true)).then(dispatch(1)).then(admit(1, true)).then(response(1, "refused"))
    .expect(not(s.data) and not(s.requests.get(1).admitted))
  run recheckedTransientErrorKeepsOwnRecordTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "success")).then(recheck(1, true))
    .then(begin(2)).then(preflight(2, true))
    .then(dispatch(2)).then(admit(2, true)).then(response(2, "transient")).then(recheck(2, true))
    .expect(s.data and s.error == "rechecked-transient")
  run failedIdentityReadCannotRetainRecordTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "success")).then(recheck(1, true))
    .then(begin(2)).then(preflight(2, true))
    .then(dispatch(2)).then(admit(2, true)).then(response(2, "transient")).then(recheck(2, false))
    .expect(not(s.data) and s.error == "identity")
  run timeoutDuringIdentityReadDropsRecordTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "success")).then(recheck(1, true))
    .then(begin(2)).then(preflight(2, true))
    .then(dispatch(2)).then(admit(2, true)).then(response(2, "transient")).then(timeout(2)).then(lateOutcome(2))
    .expect(not(s.data) and s.error == "timeout")
  run accessRefusalDropsRecordImmediatelyTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "success")).then(recheck(1, true))
    .then(begin(2)).then(preflight(2, true))
    .then(dispatch(2)).then(admit(2, false)).then(response(2, "refused")).expect(not(s.data))
  run nonTransientErrorIsNotRetainedTest = init.then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "success")).then(recheck(1, true))
    .then(begin(2)).then(preflight(2, true))
    .then(dispatch(2)).then(admit(2, true)).then(response(2, "invalid")).then(recheck(2, true)).expect(not(s.data))
  run detachedReplyCannotFillNewActorViewTest = init.then(begin(1)).then(preflight(1, true)).then(dispatch(1))
    .then(admit(1, true)).then(depart).then(remount(2)).then(response(1, "success")).expect(not(s.data))
  run feeRefreshDoesNotRetainPriorResultTest = init.then(feeMode).then(begin(1)).then(preflight(1, true))
    .then(dispatch(1)).then(admit(1, true)).then(response(1, "success")).then(recheck(1, true))
    .then(begin(2)).then(preflight(2, true)).then(dispatch(2)).then(admit(2, true))
    .then(response(2, "transient")).then(recheck(2, true)).expect(not(s.data) and s.status == "error")
}
