// @source migrations/0079_slopbot_scam_review_notifications.sql
// @source migrations/0024_notifications.sql
// @source migrations/0029_notification_event_kinds.sql
// @source migrations/0063_account_closure_notification_events.sql
// @source migrations/0065_slopbot_appeal_notifications.sql
// @source backend/notifications/handler.ts
// @source backend/notifications/events.ts
// @evidence backend/notifications/notifications.test.ts
// Two source events, two recipients, three publication attempts and one open.
// Slots 1/2 belong to source 1; slots 3/4 are review notices for source 2.
// Recipients passed to begin are the source writer's eligible SQL result, not
// an untrusted request audience. Detailed query/mark behavior is refined in
// inbox_queries and inbox_mark_read. Mail and acknowledgment are separate APIs.
module api_inbox {
  val actors = Set(1, 2)
  val slots = Set(1, 2, 3, 4)
  def sourceOf(slot: int): int = if (slot <= 2) 1 else 2
  def ownerOf(slot: int): int = if (slot == 1 or slot == 3) 1 else 2
  def audience(event: int, recipients: Set[int]): Set[int] =
    slots.filter(slot => sourceOf(slot) == event and recipients.contains(ownerOf(slot)))

  var s: { sources: Set[int], notices: Set[int], read: Set[int], attempts: int,
    transaction: bool, pendingSource: int, pendingAudience: Set[int], moderators: Set[int],
    openPhase: str, openActor: int, openSlot: int, openModerator: bool, openResult: str }
  action init = s' = { sources: Set(), notices: Set(), read: Set(), attempts: 0,
    transaction: false, pendingSource: 0, pendingAudience: Set(), moderators: Set(1),
    openPhase: "idle", openActor: 0, openSlot: 0, openModerator: false, openResult: "none" }
  action begin(event: int, recipients: Set[int]): bool = all {
    not(s.transaction), s.attempts < 3, Set(1, 2).contains(event), recipients.subseteq(actors),
    s' = s.with("transaction", true).with("attempts", s.attempts + 1)
      .with("pendingSource", event).with("pendingAudience", recipients) }
  action commit = all {
    s.transaction,
    s' = s.with("sources", s.sources.union(Set(s.pendingSource)))
      .with("notices", s.notices.union(audience(s.pendingSource, s.pendingAudience)))
      .with("transaction", false) }
  action rollback = all { s.transaction, s' = s.with("transaction", false) }
  // Summary of a successful ordinary-row read; the atomic statement, hidden
  // review rows, counts, competing attempts and failed replies live separately.
  action markRead(actor: int, slot: int): bool = all {
    slot <= 2, s.notices.contains(slot), ownerOf(slot) == actor,
    s' = s.with("read", s.read.union(Set(slot))) }
  action revokeModerator(actor: int): bool = all {
    actors.contains(actor), s' = s.with("moderators", s.moderators.filter(value => value != actor)) }
  action beginOpen(actor: int, slot: int): bool = all {
    s.openPhase == "idle", actors.contains(actor), slots.contains(slot),
    s' = s.with("openPhase", "waiting").with("openActor", actor).with("openSlot", slot)
      .with("openModerator", s.moderators.contains(actor)) }
  action finishOpen(sourceAllows: bool, targetValid: bool): bool = {
    val allowed = s.openModerator and s.openSlot >= 3 and s.notices.contains(s.openSlot)
      and ownerOf(s.openSlot) == s.openActor and sourceAllows and targetValid
    all { s.openPhase == "waiting",
      s' = s.with("openPhase", "done").with("openResult", if (allowed) "redirect" else "refused") }
  }
  action openFailure = all { s.openPhase == "waiting", s.openModerator,
    s' = s.with("openPhase", "done").with("openResult", "error") }
  action step = {
    nondet event = Set(1, 2).oneOf()
    nondet recipients = Set(Set(), Set(1), Set(2), Set(1, 2)).oneOf()
    nondet actor = actors.oneOf()
    nondet slot = slots.oneOf()
    nondet sourceAllows = Set(false, true).oneOf()
    nondet targetValid = Set(false, true).oneOf()
    any { begin(event, recipients), commit, rollback, markRead(actor, slot), revokeModerator(actor),
      beginOpen(actor, slot), finishOpen(sourceAllows, targetValid), openFailure, s' = s }
  }
  val invariant = all {
    s.attempts <= 3, s.read.subseteq(s.notices),
    s.notices.forall(slot => s.sources.contains(sourceOf(slot))),
    s.openResult == "redirect" implies s.openModerator and s.openSlot >= 3
      and s.notices.contains(s.openSlot) and ownerOf(s.openSlot) == s.openActor }

  run independentReadTest = init.then(begin(1, Set(1))).then(commit).then(markRead(1, 1))
    .expect(s.read == Set(1) and s.sources == Set(1) and s.notices == Set(1) and invariant)
  run replayTest = init.then(begin(1, Set(1))).then(commit).then(markRead(1, 1))
    .then(begin(1, Set(1))).then(commit)
    .expect(s.notices == Set(1) and s.read == Set(1) and invariant)
  run failedBatchPublishesNeitherSourceNorNoticeTest = init.then(begin(1, Set(1, 2))).then(rollback)
    .expect(s.sources == Set() and s.notices == Set() and invariant)
  run sourceWithNoEligibleRecipientHasNoNoticeTest = init.then(begin(1, Set())).then(commit)
    .expect(s.sources == Set(1) and s.notices == Set() and invariant)
  run sameSourceCanNotifyTwoRecipientsOnceTest = init.then(begin(1, Set(1, 2))).then(commit)
    .then(begin(1, Set(1, 2))).then(commit).expect(s.notices == Set(1, 2) and invariant)
  run oneRecipientCannotReadTheOtherCopyTest = init.then(begin(1, Set(1, 2))).then(commit)
    .then(markRead(1, 1)).expect(s.read == Set(1) and invariant).then(markRead(1, 2).fail())
  run differentSourceKeepsPriorReadStateTest = init.then(begin(1, Set(1))).then(commit).then(markRead(1, 1))
    .then(begin(2, Set(1))).then(commit).expect(s.read == Set(1) and s.notices == Set(1, 3) and invariant)
  run ownReviewNoticeAndSourcePermitOpenTest = init.then(begin(2, Set(1))).then(commit)
    .then(beginOpen(1, 3)).then(finishOpen(true, true)).expect(s.openResult == "redirect" and invariant)
  run revokedRoleRefusesNewOpenTest = init.then(begin(2, Set(1))).then(commit).then(revokeModerator(1))
    .then(beginOpen(1, 3)).then(finishOpen(true, true)).expect(s.openResult == "refused" and invariant)
  run roleIsCapturedForTheCurrentOpenTest = init.then(begin(2, Set(1))).then(commit).then(beginOpen(1, 3))
    .then(revokeModerator(1)).then(finishOpen(true, true)).expect(s.openResult == "redirect" and invariant)
  run sourceRefusalPreventsReviewRedirectTest = init.then(begin(2, Set(1))).then(commit)
    .then(beginOpen(1, 3)).then(finishOpen(false, true)).expect(s.openResult == "refused" and invariant)
  run invalidTargetPreventsReviewRedirectTest = init.then(begin(2, Set(1))).then(commit)
    .then(beginOpen(1, 3)).then(finishOpen(true, false)).expect(s.openResult == "refused" and invariant)
  run failedReviewReadDoesNotBecomeRedirectTest = init.then(begin(2, Set(1))).then(commit)
    .then(beginOpen(1, 3)).then(openFailure).expect(s.openResult == "error" and invariant)
}
