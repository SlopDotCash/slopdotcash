// @source src/SecurityBounty.tsx
// @source src/lib/project-api.ts
// @evidence tests/e2e/private-case-ordering.spec.ts
// @evidence tests/e2e/security-bounty.spec.ts
// Explicit case-list/Open-case selection and filter/Back clearing. Two valid
// case targets, two actors and two focus returns bound this navigation model.
// The URL is a target, never authority. A detail reply is admitted only after
// the existing privateRequest actor/lifetime checks; ui_inbox and
// ui_private_case_revisions cover those request races. Local onCreated callbacks
// remain separate and do not mutate history from a retired content instance.
module ui_security_case_selection {
  var s: { phase: str, actor: int, urlCase: int, selected: int,
    visibleCase: int, visibleActor: int, focuses: int, remembered: bool }
  val cases = Set(1, 2)
  action init = s' = { phase: "checking", actor: 0, urlCase: 0, selected: 0,
    visibleCase: 0, visibleActor: 0, focuses: 0, remembered: true }
  action initialQuery(id: int): bool = all { s.phase == "checking", s.actor == 0,
    s.focuses == 0, Set(0, 1, 2).contains(id), s' = s.with("urlCase", id) }
  action identity(actor: int): bool = all { s.phase == "checking",
    Set(0, 1, 2).contains(actor),
    s' = s.with("actor", actor).with("phase", if (actor == 0) "signed-out" else "ready")
      .with("selected", if (actor == 0) 0 else s.urlCase).with("remembered", true)
      .with("visibleCase", 0).with("visibleActor", 0) }
  action unavailableIdentity = all { s.phase == "checking",
    s' = s.with("actor", 0).with("phase", "error").with("selected", 0)
      .with("visibleCase", 0).with("visibleActor", 0) }
  action selectCase(id: int): bool = all { s.phase == "ready", cases.contains(id),
    s' = s.with("urlCase", id).with("selected", id).with("remembered", true)
      .with("visibleCase", 0).with("visibleActor", 0) }
  action clearCase = all { s.phase == "ready",
    s' = s.with("urlCase", 0).with("selected", 0).with("remembered", true)
      .with("visibleCase", 0).with("visibleActor", 0) }
  // Legacy creation completion selects locally. Preserve that existing
  // behavior and the harmless no-op of a retired content instance; no new
  // global history write is introduced into an asynchronous callback.
  action createdReply(id: int, current: bool): bool =
    s' = if (current and s.phase == "ready" and cases.contains(id))
      s.with("selected", id).with("remembered", false)
        .with("visibleCase", 0).with("visibleActor", 0) else s
  action focus = all { s.phase != "checking", s.focuses < 2,
    s' = s.with("phase", "checking").with("focuses", s.focuses + 1)
      .with("selected", 0).with("visibleCase", 0).with("visibleActor", 0) }
  action detailReply(id: int, actor: int, current: bool): bool =
    s' = if (current and s.phase == "ready" and id == s.selected and actor == s.actor and cases.contains(id))
      s.with("visibleCase", id).with("visibleActor", actor) else s
  action refusedDetail = all { s.phase == "ready", s.selected > 0,
    s' = s.with("phase", "error").with("selected", 0)
      .with("visibleCase", 0).with("visibleActor", 0) }
  action step = any {
    { nondet id = Set(0, 1, 2).oneOf(); initialQuery(id) },
    { nondet actor = Set(0, 1, 2).oneOf(); identity(actor) },
    unavailableIdentity,
    { nondet id = cases.oneOf(); selectCase(id) },
    clearCase, focus,
    { nondet id = cases.oneOf(); nondet current = Set(false, true).oneOf()
      createdReply(id, current) },
    { nondet id = cases.oneOf(); nondet actor = Set(1, 2).oneOf()
      nondet current = Set(false, true).oneOf(); detailReply(id, actor, current) },
    refusedDetail, s' = s }
  val invariant = all {
    s.urlCase.in(0.to(2)), s.focuses.in(0.to(2)),
    s.phase == "ready" implies s.actor > 0,
    s.phase == "ready" and s.remembered implies s.selected == s.urlCase,
    s.phase != "ready" implies (s.selected == 0 and s.visibleCase == 0 and s.visibleActor == 0),
    s.visibleCase > 0 implies (s.phase == "ready" and s.visibleCase == s.selected
      and s.visibleActor == s.actor and s.actor > 0),
    s.visibleCase == 0 implies s.visibleActor == 0 }
  run selectedCaseReopensAfterSameActorFocusTest = init.then(identity(1)).then(selectCase(1))
    .then(detailReply(1, 1, true)).then(focus).expect(s.visibleCase == 0)
    .then(identity(1)).expect(s.selected == 1 and s.visibleCase == 0)
    .then(detailReply(1, 1, true)).expect(s.visibleCase == 1 and s.visibleActor == 1)
  run clearedFilterDoesNotReopenTest = init.then(identity(1)).then(selectCase(1))
    .then(clearCase).then(focus).then(identity(1)).expect(s.urlCase == 0 and s.selected == 0)
  run changedActorNeverRestoresOldBodyTest = init.then(identity(1)).then(selectCase(1))
    .then(detailReply(1, 1, true)).then(focus).then(identity(2))
    .then(detailReply(1, 1, false)).expect(s.selected == 1 and s.visibleCase == 0)
  run refusedCurrentTargetKeepsBodyHiddenTest = init.then(identity(1)).then(selectCase(1))
    .then(focus).then(identity(2)).then(refusedDetail).expect(s.visibleCase == 0 and s.phase == "error")
  run signOutKeepsOnlyNavigationTargetTest = init.then(identity(1)).then(selectCase(1))
    .then(detailReply(1, 1, true)).then(focus).then(identity(0))
    .expect(s.urlCase == 1 and s.selected == 0 and s.visibleCase == 0)
  run identityOutageHidesPrivateBodyTest = init.then(identity(1)).then(selectCase(1))
    .then(detailReply(1, 1, true)).then(focus).then(unavailableIdentity)
    .expect(s.visibleCase == 0 and s.phase == "error")
  run switchCaseDoesNotCarryOldBodyTest = init.then(identity(1)).then(selectCase(1))
    .then(detailReply(1, 1, true)).then(selectCase(2)).expect(s.visibleCase == 0 and s.urlCase == 2)
  run deepLinkStillNeedsVerifiedReadTest = init.then(initialQuery(2)).then(identity(1))
    .expect(s.selected == 2 and s.visibleCase == 0)
  run creationCompletionStaysLocalTest = init.then(identity(1)).then(selectCase(1))
    .then(createdReply(2, true)).expect(s.selected == 2 and s.urlCase == 1 and not(s.remembered))
  run retiredCreationCannotChangeHistoryTest = init.then(identity(1)).then(selectCase(1))
    .then(focus).then(createdReply(2, false)).then(identity(1))
    .expect(s.urlCase == 1 and s.selected == 1)
  // Negative control for the old list button; excluded from production step.
  action oldLocalSelection(id: int): bool = all { s.phase == "ready", cases.contains(id),
    s' = s.with("selected", id).with("remembered", true) }
  run oldLocalSelectionIsLostOnFocusTest = init.then(identity(1)).then(oldLocalSelection(1))
    .expect(not(invariant)).then(focus).then(identity(1)).expect(s.selected == 0)
}
