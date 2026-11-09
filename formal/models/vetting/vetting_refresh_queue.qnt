// @source backend/vetting/handler.ts
// @source backend/vetting/persistence.ts
// @source backend/projects/edge-cache.ts
// @evidence scripts/vetting-refresh-queue.test.ts
// @evidence scripts/vetting-scan-flags.test.ts
// One signed refresh, three captured projects, two assessments per flagged
// project. The queue-result cap is two here (source:25). Profiles supply
// restriction/clearance, revision/time/pin/flag-coverage and reinstatement-CAS
// predicates. Their underlying ledger rules have separate models. Captured
// project/enforcement lists are not a transaction or a continuous live view.
// Queue helpers and reinstatement can commit before later reads/replies fail.
// Only confirmed queued returns consume the cap; committed-but-lost rows do
// not. Uncaught read failures expose no partial response but retain effects.
// A fresh pending/incomplete assessment suppresses another automatic request.
// Exempt projects only replace an existing pending template assignment; no
// ordinary scan requirement is introduced. Source-only and unexecuted.
module vetting_refresh_queue {
  val ids = Set(1, 2, 3)
  val flagged = Set(4, 5, 6, 7, 13, 15, 16, 20, 21)
  type State = { phase: str, validSignature: bool, exactBody: bool, listWorks: bool,
    profiles: int -> int, cursor: int, visited: List[int], queued: List[int],
    committed: Set[int], reinstated: List[int], attempts: List[int], skipped: List[str],
    fresh: Set[int], candidate: int, cleanIndex: int, reason: str,
    returned: bool, error: str }
  var s: State
  action init = s' = { phase: "input", validSignature: true, exactBody: true, listWorks: true,
    profiles: Map(1 -> 0, 2 -> 0, 3 -> 0), cursor: 1, visited: List(), queued: List(),
    committed: Set(), reinstated: List(), attempts: List(), skipped: List(),
    fresh: Set(), candidate: 1, cleanIndex: 0, reason: "none", returned: false, error: "none" }
  def profile: int = s.profiles.get(if (ids.contains(s.cursor)) s.cursor else 1)
  def failed(reason: str): State = s.with("phase", "done").with("error", reason)
  def skip(reason: str): State = s.with("phase", "advance").with("skipped", s.skipped.append(reason))
  action configure(id: int, value: int): bool = all { s.phase == "input", ids.contains(id), 0.to(22).contains(value),
    s' = s.with("profiles", s.profiles.set(id, value)) }
  action admission(signature: bool, body: bool, lists: bool): bool = all { s.phase == "input",
    s' = s.with("validSignature", signature).with("exactBody", body).with("listWorks", lists) }
  action start = all { s.phase == "input", s' =
    if (not(s.validSignature)) failed("signature") else if (not(s.exactBody)) failed("body") else s.with("phase", "lists") }
  action lists = all { s.phase == "lists", s' = if (s.listWorks) s.with("phase", "select") else failed("lists") }
  action selectProject = all { s.phase == "select", s' =
    if (s.cursor > 3 or s.queued.length() >= 2) s.with("phase", "done").with("returned", true)
    else s.with("visited", s.visited.append(s.cursor))
      .with("phase", if (profile == 2 or profile == 3) "advance" else if (flagged.contains(profile)) "flag-pin" else "clearance") }
  action flagPin = all { s.phase == "flag-pin", s' =
    if (profile == 13) skip("pin_unavailable") else s.with("phase", "flag-read") }
  action flagRead = all { s.phase == "flag-read", s' =
    if (profile == 15) failed("assessment-read") else s.with("phase", "fresh").with("candidate", 1).with("fresh", Set()) }
  action inspectFresh = all { s.phase == "fresh", s' =
    if (s.candidate > 2) s.with("phase", "clean").with("cleanIndex", 0)
    else if (profile == 20 and s.candidate == 2) failed("coverage-read")
    else s.with("candidate", s.candidate + 1)
      .with("fresh", if (Set(6, 7, 16, 20, 21).contains(profile) or (profile == 5 and s.candidate == 1))
        s.fresh.union(Set(s.candidate)) else s.fresh) }
  action clean = all { s.phase == "clean", s' =
    if (s.fresh.size() == 0) s.with("phase", "queue").with("reason", "flag-refresh")
    else if (not(Set(6, 7, 16, 21).contains(profile)) or s.cleanIndex >= 2) s.with("phase", "advance")
    else s.with("phase", "reinstate") }
  action reinstate = {
    val id = 2 - s.cleanIndex
    val succeeds = (Set(6, 16).contains(profile) and id == 2) or (profile == 21 and id == 1)
    all { s.phase == "reinstate", s' = s.with("attempts", s.attempts.append(s.cursor * 10 + id))
      .with("cleanIndex", s.cleanIndex + 1).with("phase", if (succeeds) "cache" else "clean")
      .with("reinstated", if (succeeds) s.reinstated.append(s.cursor * 10 + id) else s.reinstated) }
  }
  action cache = all { s.phase == "cache", s' = if (profile == 16) failed("generation-read") else s.with("phase", "advance") }
  action clearance = all { s.phase == "clearance", s' =
    if (profile == 14) failed("clearance-read")
    else if (Set(0, 17, 18, 19).contains(profile)) s.with("phase", "queue").with("reason", "admission")
    else if (Set(8, 9, 10, 11, 12, 22).contains(profile)) s.with("phase", "pending")
    else s.with("phase", "advance") }
  action pending = all { s.phase == "pending", s' =
    if (profile == 10) skip("queue_changed")
    else if (profile == 12) s.with("phase", "advance") else s.with("phase", "template-pin") }
  action templatePin = all { s.phase == "template-pin", s' =
    if (profile == 22) skip("pin_unavailable")
    else if (profile == 8) s.with("phase", "advance") else s.with("phase", "queue").with("reason", "template-replacement") }
  action queue = all { s.phase == "queue", s' =
    if (profile == 17) s.with("phase", "advance")
    else if (profile == 18) skip("queue_failed")
    else if (profile == 19) skip("queue_failed").with("committed", s.committed.union(Set(s.cursor)))
    else s.with("phase", "advance").with("committed", s.committed.union(Set(s.cursor)))
      .with("queued", s.queued.append(s.cursor)) }
  action advance = all { s.phase == "advance", s' = s.with("phase", "select").with("cursor", s.cursor + 1)
    .with("fresh", Set()).with("reason", "none") }
  action step = {
    nondet id = ids.oneOf() nondet value = 0.to(22).oneOf()
    nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf() nondet c = Set(false, true).oneOf()
    any { configure(id, value), admission(a, b, c), start, lists, selectProject, flagPin, flagRead, inspectFresh,
      clean, reinstate, cache, clearance, pending, templatePin, queue, advance, s' = s }
  }
  val invariant = all { s.cursor <= 4, s.queued.length() <= 2, s.committed.subseteq(ids),
    s.queued.indices().forall(i => s.committed.contains(s.queued.nth(i))),
    s.returned implies s.error == "none", s.error != "none" implies not(s.returned),
    s.returned implies s.cursor == 4 or s.queued.length() == 2 }
  action begin = start.then(lists)
  action ordinary = selectProject.then(clearance).then(queue).then(advance)
  action flags = selectProject.then(flagPin).then(flagRead).then(inspectFresh).then(inspectFresh).then(inspectFresh)
  run exactSignedBodyRequiredTest = init.then(admission(true, false, true)).then(start).expect(s.error == "body" and s.visited == List() and invariant)
  run failedListsPreventWorkTest = init.then(admission(true, true, false)).then(begin).expect(s.error == "lists" and s.committed == Set() and invariant)
  run confirmedQueueCapStopsBeforeNextProjectTest = init.then(begin).then(ordinary).then(ordinary).then(selectProject).expect(s.returned and s.visited == List(1, 2) and invariant)
  run conflictsDoNotConsumeQueueCapTest = init.then(configure(1, 17)).then(begin).then(ordinary).then(ordinary).then(ordinary).then(selectProject).expect(s.queued == List(2, 3) and invariant)
  run lostQueueReplyRetainsEffectWithoutConsumingCapTest = init.then(configure(1, 19)).then(begin).then(ordinary).then(ordinary).then(ordinary).then(selectProject).expect(s.committed == Set(1, 2, 3) and s.queued == List(2, 3) and s.skipped == List("queue_failed") and invariant)
  run caughtQueueFailureContinuesTest = init.then(configure(1, 18)).then(begin).then(ordinary).then(ordinary).then(ordinary).then(selectProject).expect(s.queued == List(2, 3) and not(s.committed.contains(1)) and invariant)
  run restrictedAndRetiredProjectsSkippedTest = init.then(configure(1, 2)).then(configure(2, 3)).then(begin).then(selectProject).then(advance).then(selectProject).then(advance).then(ordinary).then(selectProject).expect(s.visited == List(1, 2, 3) and s.queued == List(3) and invariant)
  run noFreshFlagScanQueuesOneTest = init.then(configure(1, 4)).then(begin).then(flags).then(clean).then(queue).expect(s.queued == List(1) and invariant)
  run freshPendingFlagScanDoesNotQueueAnotherTest = init.then(configure(1, 5)).then(begin).then(flags).then(clean).expect(s.phase == "advance" and s.queued == List() and invariant)
  run newestCleanIsTriedFirstTest = init.then(configure(1, 6)).then(begin).then(flags).then(clean).then(reinstate).then(cache).expect(s.attempts == List(12) and s.reinstated == List(12) and s.queued == List() and invariant)
  run olderCleanTriedAfterNewerCasRefusalTest = init.then(configure(1, 21)).then(begin).then(flags).then(clean).then(reinstate).then(clean).then(reinstate).then(cache).expect(s.attempts == List(12, 11) and s.reinstated == List(11) and invariant)
  run unsuccessfulFreshCleanDoesNotCreateExtraScanTest = init.then(configure(1, 7)).then(begin).then(flags).then(clean).then(reinstate).then(clean).then(reinstate).then(clean).expect(s.phase == "advance" and s.queued == List() and invariant)
  run flagPinFailureIsPerProjectSkipTest = init.then(configure(1, 13)).then(begin).then(selectProject).then(flagPin).then(advance).then(ordinary).expect(s.skipped == List("pin_unavailable") and s.queued == List(2) and invariant)
  run assessmentReadFailureAbortsWholeRefreshTest = init.then(configure(2, 15)).then(begin).then(ordinary).then(selectProject).then(flagPin).then(flagRead).expect(s.error == "assessment-read" and s.committed == Set(1) and invariant)
  run coverageReadFailureReturnsNoPartialResponseTest = init.then(configure(1, 20)).then(begin).then(selectProject).then(flagPin).then(flagRead).then(inspectFresh).then(inspectFresh).expect(s.error == "coverage-read" and not(s.returned) and invariant)
  run generationFailureKeepsReinstatementEffectTest = init.then(configure(1, 16)).then(begin).then(flags).then(clean).then(reinstate).then(cache).expect(s.error == "generation-read" and s.reinstated == List(12) and invariant)
  run currentPendingTemplateDoesNotRequeueTest = init.then(configure(1, 8)).then(begin).then(selectProject).then(clearance).then(pending).then(templatePin).expect(s.phase == "advance" and s.queued == List() and invariant)
  run changedPendingTemplateQueuesReplacementTest = init.then(configure(1, 9)).then(begin).then(selectProject).then(clearance).then(pending).then(templatePin).then(queue).expect(s.queued == List(1) and invariant)
  run vanishedPendingIsQueueChangedTest = init.then(configure(1, 10)).then(begin).then(selectProject).then(clearance).then(pending).expect(s.skipped == List("queue_changed") and invariant)
  run exemptionOnlyReplacesExistingPendingTest = init.then(configure(1, 11)).then(begin).then(selectProject).then(clearance).then(pending).then(templatePin).then(queue).expect(s.queued == List(1) and invariant)
  run exemptWithoutPendingNeedsNoScanTest = init.then(configure(1, 12)).then(begin).then(selectProject).then(clearance).then(pending).expect(s.phase == "advance" and s.queued == List() and invariant)
  run templatePinOutageIsRecoverableSkipTest = init.then(configure(1, 22)).then(begin).then(selectProject).then(clearance).then(pending).then(templatePin).expect(s.skipped == List("pin_unavailable") and invariant)
  run uncaughtClearanceFailureRetainsEarlierQueuedProjectTest = init.then(configure(2, 14)).then(begin).then(ordinary).then(selectProject).then(clearance).expect(s.error == "clearance-read" and s.committed == Set(1) and invariant)
}
