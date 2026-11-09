// @source src/Inbox.tsx
// @source src/lib/notifications.ts
// @source src/lib/project-api.ts
// @evidence tests/e2e/inbox-response-owner.spec.ts
// @evidence tests/e2e/inbox-report-account-change.spec.ts
// Three read generations, two actors and two cursor positions. Session value
// 3 means unavailable; 0 means signed out. Cookie state is not continuous
// authority knowledge: only a completed session observation can be compared.
// Draft cleanup records the call, not guaranteed deletion from unavailable storage.
module ui_inbox_reads {
  type State = { mounted: bool, cookie: int, generation: int, request: int,
    staleRequest: int, ignored: bool, stage: str, phase: str, firstActor: int,
    responseActor: int, responseHasRows: bool, responseHasNext: bool, finalActor: int, reply: str, recipient: int,
    previousRecipient: int, listOwner: int, cursor: int, draftClearRequested: bool }
  var s: State
  action init = s' = { mounted: true, cookie: 1, generation: 0, request: 0,
    staleRequest: 0, ignored: false, stage: "idle", phase: "loading",
    firstActor: 3, responseActor: 0, responseHasRows: false, responseHasNext: false, finalActor: 0, reply: "none",
    recipient: 0, previousRecipient: 0, listOwner: 0, cursor: 0, draftClearRequested: false }

  def acceptActor(state: State, actor: int): State =
    state.with("recipient", actor).with("previousRecipient", actor)
      .with("cursor", if (actor == 0 or (state.previousRecipient > 0 and state.previousRecipient != actor)) 0 else state.cursor)
      .with("draftClearRequested", state.draftClearRequested or actor == 0 or (state.previousRecipient > 0 and state.previousRecipient != actor))

  action start = all { s.mounted, s.generation < 3,
    s' = s.with("staleRequest", s.request).with("generation", s.generation + 1)
      .with("request", s.generation + 1).with("stage", "first-session")
      .with("phase", "loading").with("listOwner", 0).with("reply", "none")
      .with("firstActor", 3).with("responseActor", 0).with("responseHasRows", false).with("responseHasNext", false).with("finalActor", 0) }
  action firstSession(actor: int): bool = all { s.stage == "first-session", actor >= 0, actor <= 3,
    s' = s.with("firstActor", actor)
      .with("stage", if (actor == 0) "reply" else "fetch")
      .with("reply", if (actor == 0) "signed-out" else "none") }
  action http(status: str): bool = all { s.stage == "fetch", Set("ok", "401", "failure").contains(status),
    s' = s.with("stage", if (status == "ok") "body" else if (status == "401") "reply" else "recovery-session")
      .with("reply", if (status == "401") "signed-out" else "none") }
  action body(actor: int, valid: bool, hasRows: bool, hasNext: bool): bool = all { s.stage == "body", actor >= 1, actor <= 2,
    s' = s.with("responseActor", actor).with("responseHasRows", hasRows).with("responseHasNext", hasNext).with("stage", if (valid) "final-session" else "recovery-session") }
  action finalSession(actor: int): bool = {
    val matches = actor > 0 and actor < 3 and actor == s.responseActor
      and (s.firstActor == 3 or s.firstActor == actor)
    all { s.stage == "final-session", actor >= 0, actor <= 3,
      s' = s.with("finalActor", actor)
        .with("stage", if (actor == 0 or matches) "reply" else "recovery-session")
        .with("reply", if (actor == 0) "signed-out" else if (matches) "ready" else "none") }
  }
  action receive = {
    val actor = if (s.reply == "ready") s.responseActor else 0
    val changedPage = s.reply == "ready" and s.previousRecipient > 0
      and s.previousRecipient != actor and s.cursor == 1
    val accepted = acceptActor(s, actor)
    all { s.mounted, s.stage == "reply", s.request == s.generation,
      s' = accepted.with("stage", if (changedPage) "restart" else "idle")
        .with("phase", if (changedPage) "loading" else s.reply)
        .with("listOwner", if (s.reply == "ready" and not(changedPage)) actor else 0) }
  }
  action recoverSession(actor: int): bool = all { s.mounted, s.stage == "recovery-session",
    s.request == s.generation, actor >= 0, actor <= 3,
    s' = if (actor == 3) s.with("recipient", 0).with("listOwner", 0)
        .with("phase", "error").with("stage", "idle")
      else acceptActor(s, actor).with("listOwner", 0).with("stage", "idle")
        .with("phase", if (actor == 0) "signed-out" else "error") }
  action olderPage = all { s.mounted, s.phase == "ready", s.cursor == 0, s.responseHasNext,
    s' = s.with("cursor", 1).with("stage", "restart").with("phase", "loading").with("listOwner", 0) }
  action cookieChanges(actor: int): bool = all { actor >= 0, actor <= 2, s' = s.with("cookie", actor) }
  action staleReply = all { s.staleRequest > 0, s.staleRequest != s.generation,
    s' = s.with("ignored", true) }
  action signOut = all { s.mounted,
    s' = acceptActor(s, 0).with("cookie", 0).with("generation", 4)
      .with("stage", "cancelled").with("phase", "signed-out").with("listOwner", 0) }
  action depart = s' = s.with("mounted", false).with("generation", 4)
    .with("stage", "cancelled").with("phase", "departed").with("listOwner", 0)
  action step = {
    nondet actor = Set(0, 1, 2, 3).oneOf()
    nondet owner = Set(1, 2).oneOf()
    nondet valid = Set(false, true).oneOf()
    nondet hasRows = Set(false, true).oneOf()
    nondet hasNext = Set(false, true).oneOf()
    nondet status = Set("ok", "401", "failure").oneOf()
    any { start, firstSession(actor), http(status), body(owner, valid, hasRows, hasNext), finalSession(actor),
      receive, recoverSession(actor), olderPage, cookieChanges(0), cookieChanges(1),
      cookieChanges(2), staleReply, signOut, depart, s' = s }
  }
  val invariant = all {
    s.generation >= 0, s.generation <= 4, s.cursor >= 0, s.cursor <= 1,
    s.listOwner > 0 implies s.mounted and s.phase == "ready" and s.recipient == s.listOwner,
    s.phase == "signed-out" implies s.recipient == 0 and s.draftClearRequested,
    not(s.mounted) implies s.listOwner == 0,
    s.stage == "reply" and s.reply == "ready" implies s.responseActor == s.finalActor
      and (s.firstActor == 3 or s.firstActor == s.finalActor) }

  run initialSignedOutSkipsInboxFetchTest = init.then(start).then(firstSession(0)).then(receive)
    .expect(s.phase == "signed-out" and s.draftClearRequested and invariant)
  run matchingReadPublishesTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, true, true)).then(finalSession(1)).then(receive).expect(s.listOwner == 1 and invariant)
  run unavailableFirstSessionNeedsMatchingFinalSessionTest = init.then(start).then(firstSession(3))
    .then(http("ok")).then(body(2, true, true, true)).then(finalSession(2)).then(receive)
    .expect(s.listOwner == 2 and invariant)
  run changedSessionRefusesOldEnvelopeTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, true, true)).then(finalSession(2)).then(recoverSession(2))
    .expect(s.listOwner == 0 and s.recipient == 2 and s.phase == "error" and invariant)
  run changedInitialIdentityCannotReassignEnvelopeTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(2, true, true, true)).then(finalSession(2)).then(recoverSession(2))
    .expect(s.listOwner == 0 and s.phase == "error" and invariant)
  run signedOutFinalSessionRequestsDraftCleanupTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, true, true)).then(finalSession(0)).then(receive)
    .expect(s.recipient == 0 and s.draftClearRequested and invariant)
  run unauthorizedReadClearsCurrentInboxTest = init.then(start).then(firstSession(1)).then(http("401")).then(receive)
    .expect(s.phase == "signed-out" and s.listOwner == 0 and invariant)
  run failedReadWithKnownSessionIsExplicitErrorTest = init.then(start).then(firstSession(1))
    .then(http("failure")).then(recoverSession(1)).expect(s.phase == "error" and s.recipient == 1 and invariant)
  run failedReadWithUnknownSessionHidesPrivateChildrenTest = init.then(start).then(firstSession(1))
    .then(http("failure")).then(recoverSession(3)).expect(s.recipient == 0 and not(s.draftClearRequested) and invariant)
  run invalidEnvelopeDoesNotBecomeEmptyInboxTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, false, true, true)).then(recoverSession(1)).expect(s.phase == "error" and s.listOwner == 0 and invariant)
  run failedFinalSessionNeedsAnotherObservationTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, true, true)).then(finalSession(3)).then(recoverSession(1))
    .expect(s.phase == "error" and s.recipient == 1 and invariant)
  run supersededResponseCannotPublishTest = init.then(start).then(firstSession(1)).then(start).then(staleReply)
    .expect(s.ignored and s.generation == 2 and s.listOwner == 0 and invariant)
  run signedOutSupersedesReadTest = init.then(start).then(firstSession(1)).then(signOut)
    .expect(s.phase == "signed-out" and s.draftClearRequested and invariant).then(receive.fail())
  run departureSuppressesReadTest = init.then(start).then(firstSession(1)).then(depart)
    .expect(not(s.mounted) and s.listOwner == 0 and invariant).then(receive.fail())
  run changedRecipientResetsOlderCursorBeforePublishingTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, true, true)).then(finalSession(1)).then(receive).then(olderPage).then(start).then(firstSession(2))
    .then(http("ok")).then(body(2, true, true, true)).then(finalSession(2)).then(receive)
    .expect(s.cursor == 0 and s.phase == "loading" and s.stage == "restart" and s.draftClearRequested and invariant)
  run sameRecipientKeepsOlderCursorTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, true, true)).then(finalSession(1)).then(receive).then(olderPage).then(start).then(firstSession(1))
    .then(http("ok")).then(body(1, true, true, true)).then(finalSession(1)).then(receive)
    .expect(s.cursor == 1 and s.listOwner == 1 and not(s.draftClearRequested) and invariant)
  run changedRecipientReloadsFirstPageTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, true, true)).then(finalSession(1)).then(receive).then(olderPage).then(start).then(firstSession(2))
    .then(http("ok")).then(body(2, true, true, true)).then(finalSession(2)).then(receive).then(start).then(firstSession(2))
    .then(http("ok")).then(body(2, true, true, true)).then(finalSession(2)).then(receive)
    .expect(s.cursor == 0 and s.phase == "ready" and s.listOwner == 2 and invariant)
  run failedReadCanRetryWithoutReusingOldEnvelopeTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(2, true, true, true)).then(finalSession(1)).then(recoverSession(1)).then(start).then(firstSession(1))
    .then(http("ok")).then(body(1, true, true, true)).then(finalSession(1)).then(receive)
    .expect(s.generation == 2 and s.listOwner == 1 and s.phase == "ready" and invariant)
  run emptyEnvelopeIsReadyNotUnavailableTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, false, false)).then(finalSession(1)).then(receive)
    .expect(s.phase == "ready" and s.listOwner == 1 and not(s.responseHasRows) and invariant)
  run noNextCursorDisablesOlderControlTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, true, false)).then(finalSession(1)).then(receive)
    .expect(s.phase == "ready" and not(s.responseHasNext) and invariant).then(olderPage.fail())
  run cookieChangeIsNotContinuousSessionKnowledgeTest = init.then(start).then(firstSession(1)).then(http("ok"))
    .then(body(1, true, true, true)).then(finalSession(1)).then(receive).then(cookieChanges(2))
    .expect(s.cookie == 2 and s.listOwner == 1 and invariant)
}
