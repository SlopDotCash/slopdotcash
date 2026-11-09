// @source workers/payments/index.ts
// @source workers/payments/deployments.ts
// @evidence workers/payments/attempt-observation.test.ts
// runPaymentDispatch + its executor wrapper. Three candidates, batch bound two
// (source LIMIT 50), captured selection time 2, fresh child times 0..4. Candidate
// IDs already encode updated_at order; tied timestamps may have either order.
// The lease/journal/payment transitions inside dispatchPayment are delegated to
// payment_dispatch; unavailable is not a thrown error. Registry is reread for
// each actual submission; unrelated registry failures do not reject a unique
// matching deployment. Vault/network match is exact. A service transaction ID
// is a submission response, never payment finality. Source-only, unexecuted.
module payment_dispatch_queue {
  type Candidate = { network: int, state: str, leaseUntil: int, updated: int }
  type State = { phase: str, configured: bool, networksValid: bool, selected: List[int],
    rows: int -> Candidate, profile: int -> str, offset: int, current: int,
    at: int, childTimes: List[int], visited: List[int], registryReads: List[int],
    serviceCalls: List[int], submitted: Set[int], unavailable: Set[int],
    errors: List[int], response: str, paid: bool }
  var s: State
  val ids = Set(1, 2, 3)
  val outcomes = Set("submit", "unavailable", "child-error", "registry-error", "missing-deployment",
    "duplicate-deployment", "service-missing", "service-http", "service-json", "missing-tx", "unrelated-registry-errors")
  val row: Candidate = { network: 1, state: "ready", leaseUntil: 0, updated: 1 }
  action init = s' = { phase: "input", configured: true, networksValid: true,
    selected: List(), rows: Map(1 -> row, 2 -> row.with("updated", 2), 3 -> row.with("updated", 3)),
    profile: Map(1 -> "submit", 2 -> "submit", 3 -> "submit"), offset: 0, current: 0, at: 2,
    childTimes: List(), visited: List(), registryReads: List(), serviceCalls: List(),
    submitted: Set(), unavailable: Set(), errors: List(), response: "none", paid: false }
  pure def eligible(candidate: Candidate): bool = candidate.network == 1 and
    (candidate.state == "ready" or (candidate.state == "processing" and candidate.leaseUntil < 2))
  def currentProfile: str = s.profile.get(if (ids.contains(s.current)) s.current else 1)
  def reject: State = s.with("phase", "advance").with("errors", s.errors.append(s.current))
  action setup(configured: bool, valid: bool): bool = all { s.phase == "input",
    s' = s.with("configured", configured).with("networksValid", valid) }
  action configure(id: int, candidate: Candidate, profile: str): bool = all {
    s.phase == "input", ids.contains(id), outcomes.contains(profile), Set(1, 2).contains(candidate.network),
    Set("ready", "processing", "held", "submitted", "paid").contains(candidate.state),
    0.to(4).contains(candidate.leaseUntil), candidate.updated == id,
    s' = s.with("rows", s.rows.set(id, candidate)).with("profile", s.profile.set(id, profile)) }
  action begin = all { s.phase == "input", s' = if (not(s.configured)) s.with("phase", "done").with("response", "service-config-error")
    else if (not(s.networksValid)) s.with("phase", "done").with("response", "network-error") else s.with("phase", "select") }
  action selectRows = {
    val selected = List(1, 2, 3).select(id => eligible(s.rows.get(id)))
    all { s.phase == "select", s' = s.with("selected", if (selected.length() > 2) selected.slice(0, 2) else selected).with("phase", "loop") }
  }
  action selectionFailure = all { s.phase == "select", s' = s.with("phase", "done").with("response", "selection-error") }
  action visit(at: int): bool = all { s.phase == "loop", 0.to(4).contains(at), s' =
    if (s.offset == s.selected.length()) s.with("phase", "done").with("response", if (s.errors.length() == 0) "returned" else "aggregate-error")
    else s.with("current", s.selected.nth(s.offset)).with("at", at).with("phase", "child")
      .with("visited", s.visited.append(s.selected.nth(s.offset))).with("childTimes", s.childTimes.append(at)) }
  action dispatch = all { s.phase == "child", s' =
    if (currentProfile == "unavailable") s.with("phase", "advance").with("unavailable", s.unavailable.union(Set(s.current)))
    else if (currentProfile == "child-error") reject
    else s.with("phase", "registry").with("registryReads", s.registryReads.append(s.current)) }
  action registry = all { s.phase == "registry", s' =
    if (Set("registry-error", "missing-deployment", "duplicate-deployment").contains(currentProfile)) reject
    else s.with("phase", "service") }
  action service = all { s.phase == "service", s' =
    if (currentProfile == "service-missing") reject
    else s.with("phase", "reply").with("serviceCalls", s.serviceCalls.append(s.current)) }
  action reply = all { s.phase == "reply", s' =
    if (Set("service-http", "service-json", "missing-tx").contains(currentProfile)) reject
    else s.with("phase", "advance").with("submitted", s.submitted.union(Set(s.current))) }
  action advance = all { s.phase == "advance", s' = s.with("offset", s.offset + 1).with("phase", "loop") }
  action step = {
    nondet id = ids.oneOf() nondet outcome = outcomes.oneOf() nondet at = 0.to(4).oneOf()
    nondet yes = Set(false, true).oneOf()
    any { setup(yes, yes), configure(id, row.with("updated", id), outcome), begin, selectRows,
      selectionFailure, visit(at), dispatch, registry, service, reply, advance, s' = s }
  }
  val invariant = all { not(s.paid), s.selected.length() <= 2, s.offset <= s.selected.length(),
    s.visited.length() <= 2, s.childTimes.length() == s.visited.length(),
    s.submitted.intersect(s.unavailable) == Set(), s.errors.length() <= 2,
    s.response == "returned" implies s.errors.length() == 0,
    s.response == "aggregate-error" implies s.errors.length() > 0 }
  action selected = begin.then(selectRows)
  action one(at: int): bool = visit(at).then(dispatch).then(registry).then(service).then(reply).then(advance)
  run configuredExecutorRequiredBeforeSelectionTest = init.then(setup(false, true)).then(begin)
    .expect(s.response == "service-config-error" and s.visited == List() and invariant)
  run malformedNetworksRefuseBeforeSelectionTest = init.then(setup(true, false)).then(begin)
    .expect(s.response == "network-error" and invariant)
  run batchLimitLeavesLaterCandidateForAnotherRunTest = init.then(selected).then(one(2)).then(one(2)).then(visit(2))
    .expect(s.selected == List(1, 2) and s.submitted == Set(1, 2) and s.response == "returned" and invariant)
  run leaseAtSelectionInstantIsNotExpiredTest = init.then(configure(1, row.with("state", "processing").with("leaseUntil", 2), "submit")).then(selected)
    .expect(s.selected == List(2, 3) and invariant)
  run expiredLeaseIsSelectedTest = init.then(configure(1, row.with("state", "processing").with("leaseUntil", 1), "submit")).then(selected)
    .expect(s.selected == List(1, 2) and invariant)
  run otherNetworkNotSelectedTest = init.then(configure(1, row.with("network", 2), "submit")).then(selected)
    .expect(s.selected == List(2, 3) and invariant)
  run unavailableChildIsNotAggregateFailureTest = init.then(configure(1, row, "unavailable")).then(selected)
    .then(visit(2)).then(dispatch).then(advance).then(one(3)).then(visit(4))
    .expect(s.unavailable == Set(1) and s.response == "returned" and invariant)
  run oneChildFailureDoesNotStopNextTest = init.then(configure(1, row, "child-error")).then(selected)
    .then(visit(2)).then(dispatch).then(advance).then(one(3)).then(visit(4))
    .expect(s.errors == List(1) and s.submitted == Set(2) and s.response == "aggregate-error" and invariant)
  run exactUniqueDeploymentRequiredTest = init.then(configure(1, row, "duplicate-deployment")).then(selected)
    .then(visit(2)).then(dispatch).then(registry).expect(s.errors == List(1) and s.serviceCalls == List() and invariant)
  run unrelatedRegistryFailuresDoNotRejectMatchedSubmissionTest = init.then(configure(1, row, "unrelated-registry-errors")).then(selected).then(one(2))
    .expect(s.submitted == Set(1) and s.errors == List() and invariant)
  run registryRereadForEachSubmissionTest = init.then(selected).then(one(2)).then(one(3))
    .expect(s.registryReads == List(1, 2) and invariant)
  run selectedWorkGetsFreshClockTest = init.then(selected).then(one(0)).then(one(4))
    .expect(s.childTimes == List(0, 4) and invariant)
  run serviceFailureContinuesToLaterWorkTest = init.then(configure(1, row, "service-http")).then(selected)
    .then(one(2)).then(one(3)).then(visit(4)).expect(s.errors == List(1) and s.submitted == Set(2) and invariant)
  run malformedTransactionDoesNotBecomeSubmissionTest = init.then(configure(1, row, "missing-tx")).then(selected).then(one(2))
    .expect(s.submitted == Set() and s.errors == List(1) and invariant)
  run unavailableChildDoesNotReadRegistryTest = init.then(configure(1, row, "unavailable")).then(selected)
    .then(visit(2)).then(dispatch).expect(s.registryReads == List() and invariant)
  run submittedResponseDoesNotProvePaymentTest = init.then(selected).then(one(2)).expect(s.submitted == Set(1) and not(s.paid) and invariant)
  run selectionFailureStartsNoChildTest = init.then(begin).then(selectionFailure)
    .expect(s.response == "selection-error" and s.visited == List() and invariant)
}
