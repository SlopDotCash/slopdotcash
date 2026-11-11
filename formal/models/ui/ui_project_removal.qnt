// @source src/ProjectProposalPage.tsx
// @source src/PendingProjectApplications.tsx
// @source src/lib/project-api.ts
// @evidence tests/e2e/project-removal.spec.ts
// One removal/cancellation, two account identities, one unmount and remount.
// The editor and saved-application component use the same in-flight lock as
// their publication action. A native confirmation precedes the first await.
// Identity reads observe the cookie separately from their continuation; the
// server checks the expected actor again. HTTP, GitHub authority, applicant
// identity and revision validity are input predicates. A lost response never
// reverses a committed server action. Storage, browser event delivery and
// API implementation refinement require separate browser/database evidence.
module ui_project_removal {
  var s: { mode: str, mounted: bool, lifetime: int, actor: int, cookie: int,
    lock: bool, phase: str, requestLifetime: int, requestActor: int,
    observedActor: int, serverTerminal: bool, accepted: bool, view: str }
  action init = s' = { mode: "remove", mounted: true, lifetime: 1, actor: 1,
    cookie: 1, lock: false, phase: "unused", requestLifetime: 0,
    requestActor: 0, observedActor: 0, serverTerminal: false,
    accepted: false, view: "editor" }
  action cancellationMode = all { s.phase == "unused", s.view == "editor",
    s' = s.with("mode", "cancel") }
  val owns = s.mounted and s.lifetime == s.requestLifetime and s.actor == s.requestActor
  action cookieChanges(actor: int): bool = all { actor >= 0, actor <= 2,
    s' = s.with("cookie", actor) }
  action begin = all { s.mounted, not(s.lock), s.view == "editor", s.phase == "unused",
    s' = s.with("lock", true).with("phase", "precheck")
      .with("requestLifetime", s.lifetime).with("requestActor", s.actor) }
  // A second publication/removal cannot start while this request owns the lock.
  action competingPublication = all { s.mounted, not(s.lock), s.view == "editor",
    s' = s.with("view", "publishing") }
  action precheck(available: bool): bool = all { s.phase == "precheck",
    s' = s.with("phase", "prechecked").with("observedActor", if (available) s.cookie else -1) }
  action dispatch = all { s.phase == "prechecked",
    s' = if (not(owns)) s.with("phase", "done")
    else if (s.observedActor != s.requestActor)
      s.with("phase", "done").with("lock", false).with("view", "error")
    else s.with("phase", "server") }
  action server(valid: bool): bool = all { s.phase == "server",
    s' = s.with("phase", "response")
      .with("accepted", valid and s.cookie == s.requestActor)
      .with("serverTerminal", s.serverTerminal or (valid and s.cookie == s.requestActor)) }
  action receive(delivered: bool): bool = all { s.phase == "response",
    s' = if (not(owns)) s.with("phase", "done")
    else if (delivered and s.accepted) s.with("phase", "postcheck")
    else s.with("phase", "done").with("lock", false).with("view", "error") }
  action postcheck(available: bool): bool = all { s.phase == "postcheck",
    s' = s.with("phase", "postchecked").with("observedActor", if (available) s.cookie else -1) }
  action finish = all { s.phase == "postchecked",
    s' = if (not(owns)) s.with("phase", "done")
    else s.with("phase", "done").with("lock", false)
      .with("view", if (s.observedActor == s.requestActor)
        (if (s.mode == "remove") "removed" else "cancelled") else "error") }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("view", "departed").with("lock", false) }
  action remount(actor: int): bool = all { not(s.mounted), s.lifetime == 1,
    Set(1, 2).contains(actor),
    s' = s.with("mounted", true).with("lifetime", 2).with("actor", actor).with("view", "editor") }
  action step = {
    nondet actor = 0.to(2).oneOf()
    nondet yes = Set(false, true).oneOf()
    any { cancellationMode, cookieChanges(actor), begin, competingPublication,
      precheck(yes), dispatch, server(yes), receive(yes), postcheck(yes), finish,
      depart, remount(actor), s' = s }
  }
  val invariant = all {
    Set("removed", "cancelled").contains(s.view) implies
      (s.mounted and s.accepted and s.serverTerminal and owns and s.observedActor == s.requestActor),
    s.accepted implies s.serverTerminal,
    s.lock implies (s.mounted and s.lifetime == s.requestLifetime)
  }
  action submit = begin.then(precheck(true)).then(dispatch)
  action success = server(true).then(receive(true)).then(postcheck(true)).then(finish)
  run removalShowsTerminalAfterCheckedReceiptTest = init.then(submit).then(success)
    .expect(s.view == "removed" and s.serverTerminal)
  run cancellationShowsDistinctTerminalTest = init.then(cancellationMode).then(submit).then(success)
    .expect(s.view == "cancelled" and s.serverTerminal)
  run lockBlocksPublishDuringCancellationTest = init.then(cancellationMode).then(begin)
    .then(competingPublication.fail())
  run departedPrecheckCannotDispatchTest = init.then(begin).then(precheck(true)).then(depart).then(dispatch)
    .expect(s.phase == "done" and not(s.serverTerminal))
  run actorChangesAfterPrecheckRefusedAtServerTest = init.then(begin).then(precheck(true))
    .then(cookieChanges(2)).then(dispatch).then(server(true)).then(receive(true))
    .expect(not(s.serverTerminal) and s.view == "error")
  run actorChangesAfterCommitHidesTerminalTest = init.then(submit).then(server(true)).then(cookieChanges(2))
    .then(receive(true)).then(postcheck(true)).then(finish).expect(s.serverTerminal and s.view == "error")
  run departedResponseDoesNotReplaceNewEditorTest = init.then(submit).then(server(true)).then(depart)
    .then(remount(2)).then(receive(true)).expect(s.view == "editor" and s.serverTerminal)
  run departureAfterIdentityReadCannotShowSuccessTest = init.then(submit).then(server(true))
    .then(receive(true)).then(postcheck(true)).then(depart).then(finish)
    .expect(s.view == "departed" and s.serverTerminal)
  run unavailablePostcheckKeepsCommittedActionTest = init.then(submit).then(server(true))
    .then(receive(true)).then(postcheck(false)).then(finish).expect(s.view == "error" and s.serverTerminal)
  run lostResponseKeepsCommittedActionTest = init.then(submit).then(server(true)).then(receive(false))
    .expect(s.view == "error" and s.serverTerminal)
  run permissionFailureNeverShowsSuccessTest = init.then(submit).then(server(false)).then(receive(true))
    .expect(s.view == "error" and not(s.serverTerminal))
}
