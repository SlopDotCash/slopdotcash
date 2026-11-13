// @source src/Inbox.tsx
// @source src/IncompleteAssessments.tsx
// @source src/PointsDisputes.tsx
// @source src/SecurityBounty.tsx
// @source src/lib/use-action.ts
// Two actors/pages/epochs bound the read and action races. The epoch abstracts
// Inbox.generation and SecurityInbox's active scope. useAction is not a mutex;
// this caller removes/disables controls and rechecks actor/epoch around effects.
module ui_inbox {
  var s: { actor: int, requestedActor: int, visibleActor: int, phase: str,
    page: int, marked: Set[int], privateDraft: bool, epoch: int,
    requestedEpoch: int, mounted: bool, actionPhase: str,
    actionActor: int, actionEpoch: int }
  action init = s' = { actor: 1, requestedActor: 0, visibleActor: 0,
    phase: "idle", page: 0, marked: Set(), privateDraft: true, epoch: 1,
    requestedEpoch: 0, mounted: true, actionPhase: "idle",
    actionActor: 0, actionEpoch: 0 }
  action requestPage = all { s.mounted, s.actor > 0, s.actionPhase == "idle",
    s' = s.with("requestedActor", s.actor).with("requestedEpoch", s.epoch)
      .with("phase", "loading").with("visibleActor", 0) }
  action publish = all { s.mounted, s.phase == "loading",
    s.actor == s.requestedActor, s.epoch == s.requestedEpoch,
    s' = s.with("visibleActor", s.actor).with("phase", "ready") }
  action refreshPrivateReports = all { s.mounted, s.phase == "ready",
    s' = s.with("requestedActor", s.actor).with("requestedEpoch", s.epoch)
      .with("phase", "refreshing") }
  action verifiedOutage = all { s.mounted, s.phase == "refreshing",
    s.actor == s.requestedActor, s.epoch == s.requestedEpoch,
    s' = s.with("phase", "ready") }
  // 401/403/404/410 remove the child tree; a transport outage can retain only
  // after a fresh matching session. A session outage hides private content.
  action accessLost = s' = s.with("visibleActor", 0).with("phase", "error")
  action accountChange = s' = s.with("actor", 2).with("epoch", 2)
    .with("visibleActor", 0).with("phase", "idle").with("page", 0)
    .with("privateDraft", false).with("actionPhase", "idle")
  action signOut = s' = s.with("actor", 0).with("epoch", 2)
    .with("visibleActor", 0).with("phase", "signed-out")
    .with("privateDraft", false).with("actionPhase", "cancelled")
  action more = all { s.phase == "ready", s.actionPhase == "idle", s.page == 0,
    s' = s.with("page", 1).with("phase", "idle").with("visibleActor", 0) }
  action beginMark = all { s.mounted, s.phase == "ready", s.epoch == 1,
    s.actionPhase == "idle", s.visibleActor == s.actor,
    s' = s.with("epoch", 2).with("actionEpoch", 2).with("actionActor", s.actor)
      .with("actionPhase", "checking").with("phase", "loading").with("visibleActor", 0) }
  action sendMark = all { s.mounted, s.actionPhase == "checking",
    s.actor == s.actionActor, s.epoch == s.actionEpoch,
    s' = s.with("actionPhase", "sending") }
  action duplicateClick = all { s.actionPhase != "idle", s' = s }
  action finishMark = all { s.mounted, s.actionPhase == "sending",
    s.actor == s.actionActor, s.epoch == s.actionEpoch,
    s' = s.with("marked", s.marked.union(Set(s.page))).with("actionPhase", "done")
      .with("phase", "ready").with("visibleActor", s.actor) }
  action depart = s' = s.with("mounted", false).with("epoch", 2)
    .with("visibleActor", 0).with("phase", "departed")
  action newViewDraft = all { not(s.mounted),
    s' = s.with("actor", 2).with("privateDraft", true) }
  action departedResponse = all { not(s.mounted), s' = s }
  action step = any { requestPage, publish, refreshPrivateReports, verifiedOutage,
    accessLost, accountChange, signOut, more, beginMark, sendMark, duplicateClick,
    finishMark, depart, newViewDraft, departedResponse, s' = s }
  val invariant = all {
    s.visibleActor > 0 implies s.actor == s.visibleActor and s.mounted,
    s.actor == 0 implies not(s.privateDraft),
    s.phase == "signed-out" implies s.visibleActor == 0,
    s.actionPhase == "done" implies s.marked.contains(s.page),
    s.page >= 0, s.page <= 1
  }
  // No fairness assumption is needed for this safety property: departure
  // invalidates every later completion, even when no new read succeeds.
  temporal departedViewsStayHiddenProperty = always(not(s.mounted) implies always(s.visibleActor == 0))
  run actorChangeTest = init.then(requestPage).then(publish).then(accountChange)
    .expect(s.visibleActor == 0 and not(s.privateDraft))
  run crossTabReturnTest = init.then(requestPage).then(publish).then(accountChange).then(requestPage).then(publish).expect(s.visibleActor == 2 and not(s.privateDraft))
  run duplicateMarkTest = init.then(requestPage).then(publish).then(beginMark)
    .then(duplicateClick).then(sendMark).then(duplicateClick).then(finishMark)
    .expect(s.marked == Set(0))
  run pagingTest = init.then(requestPage).then(publish).then(more)
    .then(requestPage).then(publish).expect(s.page == 1)
  run accessLossTest = init.then(requestPage).then(publish).then(refreshPrivateReports)
    .then(accessLost).expect(s.visibleActor == 0)
  run sameActorOutageTest = init.then(requestPage).then(publish)
    .then(refreshPrivateReports).then(verifiedOutage).expect(s.visibleActor == 1)
  run departedActionTest = init.then(requestPage).then(publish).then(beginMark)
    .then(sendMark).then(depart).then(newViewDraft).then(departedResponse)
    .expect(s.privateDraft and s.marked == Set() and s.visibleActor == 0)
}
