// @source src/SecurityBounty.tsx
// @source src/lib/use-action.ts
// @source backend/security/submissions.ts
// @source migrations/0059_private_security_submissions.sql
// @evidence tests/e2e/security-report-links.spec.ts
// Source-only, unexecuted DirectVerifyForm refinement. Two projects/advisories,
// two reporter/component lifetimes, three request slots and four distinct UUID
// representatives bound this model. Project + trimmed advisory identify an
// intent; origin is constant "direct". requestKey()/UUID outputs are assumed
// unique across the bounded trace, including different component lifetimes.
// The backend key is reporter-scoped and immutable with respect to project,
// origin and advisory. A committed row may outlive a failed authorization or
// lost response. Matching retries reuse that row; changing intent needs a key.
// The key map is in-memory for one mounted form, not durable across refresh,
// navigation or a same-actor remount. The parent keys its content by actor.
// Full private-request pre/postflight checks, native form pattern validation,
// GitHub authorization URLs, transport and navigation are bounded predicates.
module ui_direct_report_intents {
  type Row = { actor: int, key: int, intent: int }
  type Request = { phase: str, life: int, actor: int, intent: int, key: int,
    durable: bool, replayed: bool, outcome: str }
  type State = { mounted: bool, life: int, actor: int, project: int, advisory: int,
    keysByIntent: int -> int, nextKey: int, phase: str, active: int,
    requests: int -> Request, rows: Set[Row], error: str, unavailable: bool,
    navigationIntent: int, navigationLife: int }
  val ids = Set(1, 2, 3)
  val intents = Set(1, 2, 3, 4)
  val noRequest: Request = { phase: "unused", life: 0, actor: 0, intent: 0,
    key: 0, durable: false, replayed: false, outcome: "none" }
  var s: State
  val intent = if (s.advisory == 0) 0 else (s.project - 1) * 2 + s.advisory
  val controls = s.mounted and s.phase == "idle"
  def owns(id: int): bool = s.mounted and s.requests.get(id).life == s.life
    and s.requests.get(id).actor == s.actor
  action init = s' = { mounted: true, life: 1, actor: 1, project: 1, advisory: 0,
    keysByIntent: intents.mapBy(_ => 0), nextKey: 1, phase: "idle", active: 0,
    requests: ids.mapBy(_ => noRequest), rows: Set(), error: "none", unavailable: false,
    navigationIntent: 0, navigationLife: 0 }
  action edit(project: int, advisory: int): bool = all { s.mounted,
    Set(1, 2).contains(project), Set(0, 1, 2).contains(advisory),
    s' = s.with("project", project).with("advisory", advisory) }
  action submit(id: int): bool = {
    val previous = if (intent == 0) 0 else s.keysByIntent.get(intent)
    val key = if (previous == 0) s.nextKey else previous
    all { controls, intent > 0, ids.contains(id), s.requests.get(id).phase == "unused",
      previous > 0 or s.nextKey <= 4,
      s' = s.with("keysByIntent", s.keysByIntent.set(intent, key))
        .with("nextKey", if (previous == 0) s.nextKey + 1 else s.nextKey)
        .with("phase", "busy").with("active", id).with("error", "none")
        .with("requests", s.requests.set(id, noRequest.with("phase", "preflight")
          .with("life", s.life).with("actor", s.actor).with("intent", intent).with("key", key))) }
  }
  action preflight(id: int, valid: bool): bool = {
    val r = s.requests.get(id)
    val current = owns(id)
    all { r.phase == "preflight",
      s' = s.with("requests", s.requests.set(id, r.with("phase", if (current and valid) "server" else "done")))
        .with("phase", if (current and not(valid)) "idle" else s.phase)
        .with("error", if (current and not(valid)) "identity" else s.error) }
  }
  action commit(id: int): bool = {
    val r = s.requests.get(id)
    val prior = s.rows.filter(row => row.actor == r.actor and row.key == r.key)
    val conflict = prior.exists(row => row.intent != r.intent)
    val accepted = not(conflict)
    all { r.phase == "server",
      s' = s.with("rows", if (accepted) s.rows.union(Set({ actor: r.actor, key: r.key, intent: r.intent })) else s.rows)
        .with("requests", s.requests.set(id, r.with("phase", "committed")
          .with("durable", accepted).with("replayed", accepted and prior.size() > 0)
          .with("outcome", if (conflict) "conflict" else "none"))) }
  }
  action returnResponse(id: int, outcome: str): bool = {
    val r = s.requests.get(id)
    all { Set("server", "committed").contains(r.phase),
      Set("success", "failure", "unavailable", "conflict").contains(outcome),
      outcome != "success" or r.durable,
      outcome != "conflict" or r.outcome == "conflict",
      outcome != "unavailable" or not(r.durable),
      s' = s.with("requests", s.requests.set(id, r.with("phase", "returned").with("outcome", outcome))) }
  }
  action deliver(id: int, identity: bool): bool = {
    val r = s.requests.get(id)
    val current = owns(id)
    val success = identity and r.outcome == "success"
    all { r.phase == "returned",
      s' = s.with("requests", s.requests.set(id, r.with("phase", if (current and success) "navigate" else "done")))
        .with("phase", if (not(current)) s.phase else if (success) "busy" else "idle")
        .with("error", if (not(current) or success) s.error else if (not(identity)) "identity" else r.outcome)
        .with("unavailable", s.unavailable or (current and identity and r.outcome == "unavailable")) }
  }
  action navigate(id: int, succeeds: bool): bool = {
    val r = s.requests.get(id)
    val current = owns(id)
    all { r.phase == "navigate",
      s' = s.with("requests", s.requests.set(id, r.with("phase", "done")))
        .with("phase", if (not(current)) s.phase else if (succeeds) "navigating" else "idle")
        .with("error", if (current and not(succeeds)) "navigation" else s.error)
        .with("navigationIntent", if (current and succeeds) r.intent else s.navigationIntent)
        .with("navigationLife", if (current and succeeds) r.life else s.navigationLife) }
  }
  action depart = all { s.mounted, s' = s.with("mounted", false) }
  action remount(actor: int): bool = all { not(s.mounted), s.life == 1, Set(1, 2).contains(actor),
    s' = s.with("mounted", true).with("life", 2).with("actor", actor).with("project", 1)
      .with("advisory", 0).with("keysByIntent", intents.mapBy(_ => 0))
      .with("phase", "idle").with("active", 0).with("error", "none").with("unavailable", false)
      .with("navigationIntent", 0).with("navigationLife", 0) }
  action failed(id: int): bool = preflight(id, true).then(commit(id))
    .then(returnResponse(id, "failure")).then(deliver(id, true))
  action step = {
    nondet id = ids.oneOf()
    nondet project = Set(1, 2).oneOf()
    nondet advisory = Set(0, 1, 2).oneOf()
    nondet valid = Set(false, true).oneOf()
    nondet outcome = Set("success", "failure", "unavailable", "conflict").oneOf()
    any { edit(project, advisory), submit(id), preflight(id, valid), commit(id),
      returnResponse(id, outcome), deliver(id, valid), navigate(id, valid), depart,
      remount(1), remount(2), s' = s }
  }
  val invariant = all {
    s.nextKey >= 1, s.nextKey <= 5,
    ids.forall(a => ids.forall(b => {
      val first = s.requests.get(a)
      val second = s.requests.get(b)
      first.actor > 0 and first.actor == second.actor and first.key == second.key
        implies first.intent == second.intent
    })),
    s.rows.forall(a => s.rows.forall(b => a.actor == b.actor and a.key == b.key implies a.intent == b.intent)),
    s.phase == "navigating" implies s.navigationLife == s.life
  }

  run nativeInvalidInputMakesNoIntentTest = init.expect(intent == 0 and s.nextKey == 1)
  run firstValidIntentAllocatesOneKeyTest = init.then(edit(1, 1)).then(submit(1))
    .expect(s.requests.get(1).intent == 1 and s.requests.get(1).key == 1 and s.nextKey == 2)
  run sameIntentRetryKeepsKeyTest = init.then(edit(1, 1)).then(submit(1)).then(failed(1))
    .then(submit(2)).expect(s.requests.get(2).key == 1 and s.nextKey == 2 and invariant)
  run changedAdvisoryAllocatesDifferentKeyTest = init.then(edit(1, 1)).then(submit(1)).then(failed(1))
    .then(edit(1, 2)).then(submit(2)).expect(s.requests.get(2).key == 2 and invariant)
  run changedProjectAllocatesDifferentKeyTest = init.then(edit(1, 1)).then(submit(1)).then(failed(1))
    .then(edit(2, 1)).then(submit(2)).expect(s.requests.get(2).key == 2 and s.requests.get(2).intent == 3)
  run returningToEarlierIntentKeepsOriginalKeyTest = init.then(edit(1, 1)).then(submit(1)).then(failed(1))
    .then(edit(1, 2)).then(submit(2)).then(failed(2)).then(edit(1, 1)).then(submit(3))
    .expect(s.requests.get(3).key == 1 and s.nextKey == 3 and invariant)
  run unchangedRetryReusesCommittedDraftTest = init.then(edit(1, 1)).then(submit(1)).then(failed(1))
    .then(submit(2)).then(preflight(2, true)).then(commit(2))
    .expect(s.rows.size() == 1 and s.requests.get(2).replayed and invariant)
  run changedIntentCanCommitAfterEarlierUncertainDraftTest = init.then(edit(1, 1)).then(submit(1)).then(failed(1))
    .then(edit(2, 2)).then(submit(2)).then(preflight(2, true)).then(commit(2))
    .expect(s.rows.size() == 2 and s.requests.get(2).outcome != "conflict" and invariant)
  run inputEditsDoNotRewritePendingRequestTest = init.then(edit(1, 1)).then(submit(1)).then(edit(2, 2))
    .expect(intent == 4 and s.requests.get(1).intent == 1 and s.requests.get(1).key == 1)
  run busyButtonPreventsSecondNativeSubmitTest = init.then(edit(1, 1)).then(submit(1)).then(submit(2).fail())
  run preflightFailureKeepsIntentKeyTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, false)).then(submit(2))
    .expect(s.requests.get(2).key == 1 and s.rows.size() == 0)
  run unavailableIntakeOffersFallbackWithoutRedirectTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, true))
    .then(returnResponse(1, "unavailable")).then(deliver(1, true))
    .expect(s.unavailable and controls and s.navigationIntent == 0)
  run authorizationSuccessNavigatesCapturedIntentTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, true))
    .then(commit(1)).then(returnResponse(1, "success")).then(deliver(1, true)).then(navigate(1, true))
    .expect(s.phase == "navigating" and s.navigationIntent == 1 and invariant)
  run successfulNavigationCanUnmountTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, true))
    .then(commit(1)).then(returnResponse(1, "success")).then(deliver(1, true)).then(navigate(1, true)).then(depart)
    .expect(not(s.mounted) and s.navigationLife == s.life and invariant)
  run navigationFailureKeepsRetryKeyTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, true)).then(commit(1))
    .then(returnResponse(1, "success")).then(deliver(1, true)).then(navigate(1, false)).then(submit(2))
    .expect(s.error == "none" and s.requests.get(2).key == 1)
  run identityPostflightFailureCannotNavigateTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, true))
    .then(commit(1)).then(returnResponse(1, "success")).then(deliver(1, false))
    .expect(s.navigationIntent == 0 and s.error == "identity" and s.rows.size() == 1)
  run departedPreflightCannotDispatchTest = init.then(edit(1, 1)).then(submit(1)).then(depart).then(preflight(1, true))
    .expect(s.requests.get(1).phase == "done" and s.rows.size() == 0)
  run acceptedDepartedResultKeepsServerDraftOnlyTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, true))
    .then(commit(1)).then(depart).then(returnResponse(1, "success")).then(deliver(1, true))
    .expect(s.rows.size() == 1 and s.navigationIntent == 0)
  run sameActorRemountCannotReceiveOldNavigationTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, true)).then(commit(1))
    .then(returnResponse(1, "success")).then(depart).then(remount(1)).then(deliver(1, true))
    .expect(s.mounted and controls and s.navigationIntent == 0 and invariant)
  run cleanupBetweenHelperAndNavigationStillRefusesTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, true)).then(commit(1))
    .then(returnResponse(1, "success")).then(deliver(1, true)).then(depart).then(remount(1)).then(navigate(1, true))
    .expect(controls and s.navigationIntent == 0 and invariant)
  run newActorStartsWithFreshKeyMapTest = init.then(edit(1, 1)).then(submit(1)).then(failed(1))
    .then(depart).then(remount(2)).then(edit(1, 1)).then(submit(2))
    .expect(s.requests.get(2).actor == 2 and s.requests.get(2).key != s.requests.get(1).key)
  run remountDoesNotPretendDurableClientKeysTest = init.then(edit(1, 1)).then(submit(1)).then(failed(1))
    .then(depart).then(remount(1)).then(edit(1, 1)).then(submit(2))
    .expect(s.requests.get(2).key != s.requests.get(1).key and s.rows.size() == 1)

  // Excluded pre-fix behavior: one key for every payload in the form, and
  // parent-only lifetime checks before redirecting a remounted child.
  action oldSubmit(id: int): bool = all { controls, intent > 0, s.requests.get(id).phase == "unused",
    s' = s.with("phase", "busy").with("active", id).with("requests", s.requests.set(id,
      noRequest.with("phase", "preflight").with("life", s.life).with("actor", s.actor).with("intent", intent).with("key", 1))) }
  action oldNavigate(id: int): bool = all { s.mounted, s.requests.get(id).actor == s.actor,
    s.requests.get(id).phase == "returned", s.requests.get(id).outcome == "success",
    s' = s.with("phase", "navigating").with("navigationIntent", s.requests.get(id).intent)
      .with("navigationLife", s.requests.get(id).life) }
  run oldKeyConflictsAfterAdvisoryEditTest = init.then(edit(1, 1)).then(oldSubmit(1)).then(failed(1))
    .then(edit(1, 2)).then(oldSubmit(2)).then(preflight(2, true)).then(commit(2))
    .expect(s.requests.get(2).outcome == "conflict" and not(invariant))
  run oldResultRedirectedSameActorNewFormTest = init.then(edit(1, 1)).then(submit(1)).then(preflight(1, true)).then(commit(1))
    .then(returnResponse(1, "success")).then(depart).then(remount(1)).then(oldNavigate(1))
    .expect(s.navigationLife == 1 and s.life == 2 and not(invariant))
}
