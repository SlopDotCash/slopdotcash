// @source src/Profiles.tsx
// @source src/Presentation.tsx
// @source src/lib/use-direct-transfers.ts
// @source src/lib/use-vault-payments.ts
// @source src/lib/use-public-resource.ts
// @source src/lib/use-time-boundary.ts
// @evidence tests/e2e/profile-rename.spec.ts
// Source-only refinement; no scenario, simulation or browser execution claimed.
// One already-selected actor, two component lifetimes, two attempts per remote
// source, and four contract-valid archived row classes bound this projection.
// Rows 1/2 are unapproved reviews closing at clock 1/2; row 3 is paid;
// row 4 is a review without a deadline. The parent passes only this actor's
// history; identity selection and normalized route keys belong to
// ui_profile_identity. This model does not assert a same-instance actor change.
// The archive is a prop (possibly absent), while direct and vault histories
// load independently. Each has 0..2 rows. A direct row contributes 2 symbolic
// base units; a USD vault row contributes 3; the archived paid row contributes
// 7. Non-USD vault rows are displayed but excluded from the USD total. Exact
// decimals, asset/network classification, bounded transport, pinned pagination,
// schema checks and canonical identity parsing are external validated inputs.
// Public failures keep other completed sources visible. Missing inputs are not
// zero money. No action approves, pays, signs or mutates the archived records.
// usePublicResource may finish old public I/O after departure, but the new
// instance cannot receive its local state. Timers repaint advice only; passive
// installation and delivery are separate from passage of time. Scheduler
// fairness is an explicit liveness assumption, not an elapsed-time guarantee.
module ui_profile_payment_history {
  type Source = { phase: str, active: int, count: int, usd: int }
  type Read = { phase: str, life: int, source: int, outcome: str, count: int, usd: int }
  type State = { mounted: bool, life: int, now: int, painted: int,
    archive: bool, rows: Set[int], direct: Source, vault: Source,
    target: int, armed: bool, expanded: bool, reads: int -> Read }
  val sources = Set(1, 2)
  val ids = Set(1, 2, 3, 4)
  val rowSets = Set(Set(), Set(1), Set(2), Set(3), Set(4),
    Set(1, 2), Set(1, 3), Set(1, 2, 3, 4))
  val idle: Source = { phase: "loading", active: 0, count: 0, usd: 0 }
  val unused: Read = { phase: "unused", life: 0, source: 0,
    outcome: "none", count: 0, usd: 0 }
  var s: State

  pure def sourceOf(id: int): int = if (id <= 2) 1 else 2
  pure def nextBoundary(rows: Set[int], now: int): int =
    if (rows.contains(1) and now < 1) 1
    else if (rows.contains(2) and now < 2) 2 else 0
  pure def paint(value: State): State = {
    val target = if (value.archive) nextBoundary(value.rows, value.now) else 0
    value.with("painted", value.now).with("target", target)
      .with("armed", value.armed and value.target == target and target > 0)
  }
  pure def put(value: State, source: int, record: Source): State =
    if (source == 1) value.with("direct", record) else value.with("vault", record)
  def resource(source: int): Source = if (source == 1) s.direct else s.vault
  def owns(id: int): bool = s.mounted and s.reads.get(id).life == s.life
    and resource(s.reads.get(id).source).active == id

  val archiveCount = if (s.archive) s.rows.size() else 0
  val directCount = if (s.direct.phase == "ready") s.direct.count else 0
  val vaultCount = if (s.vault.phase == "ready") s.vault.count else 0
  val count = if (s.mounted) archiveCount + directCount + vaultCount else 0
  val total = if (s.mounted and s.archive and s.direct.phase == "ready"
    and s.vault.phase == "ready")
      (if (s.rows.contains(3)) 7 else 0) + 2 * s.direct.count + 3 * s.vault.usd
    else -1
  val totalState = if (not(s.mounted)) "absent" else if (total >= 0) "known"
    else if (s.direct.phase == "error" or s.vault.phase == "error") "unavailable"
    else "loading"
  val emptyMessage = s.mounted and count == 0 and s.direct.phase == "ready"
    and s.vault.phase == "ready"
  val expansionControl = s.mounted and count > 5
  val displayed = if (s.expanded or count <= 5) count else 5
  def label(row: int): str = if (not(s.mounted) or not(s.archive)
    or not(s.rows.contains(row))) "absent" else if (row == 3) "paid"
    else if (row < 3 and s.painted >= row) "awaiting-approval" else "under-review"

  action init = s' = { mounted: true, life: 1, now: 0, painted: 0,
    archive: true, rows: Set(1, 2, 3, 4), direct: idle, vault: idle,
    target: 1, armed: false, expanded: false,
    reads: ids.mapBy(_ => unused) }
  action archiveInput(available: bool, rows: Set[int]): bool = all {
    s.mounted, rowSets.contains(rows), available or rows.size() == 0,
    s' = paint(s.with("archive", available).with("rows", rows))
  }
  action begin(source: int, id: int): bool = all {
    s.mounted, sources.contains(source), ids.contains(id), sourceOf(id) == source,
    s.reads.get(id).phase == "unused", resource(source).active == 0,
    Set("loading", "error").contains(resource(source).phase),
    s' = paint(put(s, source, idle.with("active", id))
      .with("reads", s.reads.set(id, unused.with("phase", "pending")
        .with("life", s.life).with("source", source))))
  }
  action observe(id: int, outcome: str, count: int, usd: int): bool = all {
    s.reads.get(id).phase == "pending",
    Set("valid", "invalid", "transport").contains(outcome),
    0 <= count, count <= 2, 0 <= usd, usd <= count,
    s' = s.with("reads", s.reads.set(id, s.reads.get(id)
      .with("phase", "observed").with("outcome", outcome)
      .with("count", count).with("usd", usd)))
  }
  action complete(id: int): bool = {
    val read = s.reads.get(id)
    val finished = s.with("reads", s.reads.set(id, read.with("phase", "done")))
    val good = read.outcome == "valid"
    all { read.phase == "observed",
      s' = if (owns(id)) paint(put(finished, read.source,
        { phase: if (good) "ready" else "error", active: 0,
          count: if (good) read.count else 0, usd: if (good) read.usd else 0 }))
        else finished }
  }
  action timeout(id: int): bool = all {
    Set("pending", "observed").contains(s.reads.get(id).phase), owns(id),
    s' = paint(put(s, s.reads.get(id).source, idle.with("phase", "error"))
      .with("reads", s.reads.set(id, s.reads.get(id)
        .with("phase", "done").with("outcome", "timeout"))))
  }
  action lateReply(id: int): bool = all { s.reads.get(id).phase == "done", s' = s }
  action installTimer = all { s.mounted, s.target > 0, not(s.armed),
    s' = s.with("armed", true) }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action fireTimer = all { s.mounted, s.armed, s.target > 0, s.now >= s.target,
    s' = paint(s.with("armed", false)) }
  action toggleExpanded = all { expansionControl,
    s' = paint(s.with("expanded", not(s.expanded))) }
  action depart = all { s.mounted, s' = s.with("mounted", false).with("armed", false) }
  action remount = all { not(s.mounted), s.life == 1,
    s' = paint(s.with("mounted", true).with("life", 2).with("direct", idle)
      .with("vault", idle).with("expanded", false).with("armed", false)) }

  action step = {
    nondet source = sources.oneOf()
    nondet id = ids.oneOf()
    nondet outcome = Set("valid", "invalid", "transport").oneOf()
    nondet count = Set(0, 1, 2).oneOf()
    nondet usd = Set(0, 1, 2).oneOf()
    nondet available = Set(false, true).oneOf()
    nondet rows = rowSets.oneOf()
    any { archiveInput(available, rows), begin(source, id), observe(id, outcome, count, usd),
      complete(id), timeout(id), lateReply(id), installTimer, tick, fireTimer,
      toggleExpanded, depart, remount, s' = s }
  }
  val invariant = all {
    s.painted <= s.now, s.now <= 3,
    s.armed implies s.mounted and s.target > 0,
    label(1) == "awaiting-approval" implies s.now >= 1,
    label(2) == "awaiting-approval" implies s.now >= 2,
    label(3) == "paid" implies s.rows.contains(3),
    total >= 0 implies s.archive and s.direct.phase == "ready" and s.vault.phase == "ready",
    total >= 0 implies total <= 17,
    displayed <= count,
    sources.forall(source => resource(source).phase == "ready" implies
      ids.exists(id => s.reads.get(id).source == source and s.reads.get(id).life == s.life
        and s.reads.get(id).phase == "done" and s.reads.get(id).outcome == "valid"))
  }
  temporal deadlineEventuallyPaintsProperty = all {
    installTimer.weakFair(s), fireTimer.weakFair(s)
  }.implies(always(s.mounted and s.archive and s.rows.contains(1) and s.now >= 1
    implies eventually(not(s.mounted) or not(s.archive) or not(s.rows.contains(1))
      or label(1) == "awaiting-approval")))

  run archiveRowsStayVisibleWhilePaymentsLoadTest = init.expect(count == 4 and total == -1)
  run directFailureKeepsArchiveTest = init.then(begin(1, 1))
    .then(observe(1, "transport", 0, 0)).then(complete(1))
    .expect(count == 4 and totalState == "unavailable" and invariant)
  run vaultFailureKeepsDirectRowsTest = init.then(begin(1, 1))
    .then(observe(1, "valid", 2, 2)).then(complete(1)).then(begin(2, 3))
    .then(observe(3, "transport", 0, 0)).then(complete(3))
    .expect(count == 6 and total == -1 and invariant)
  run nonUsdVaultRowsAreDisplayedWithoutUsdCreditTest = init.then(begin(1, 1))
    .then(observe(1, "valid", 0, 0)).then(complete(1)).then(begin(2, 3))
    .then(observe(3, "valid", 2, 0)).then(complete(3)).expect(count == 6 and total == 7 and invariant)
  run completedSourcesCountOnlyArchivedPaidMoneyTest = init.then(begin(1, 1))
    .then(observe(1, "valid", 1, 1)).then(complete(1)).then(begin(2, 3))
    .then(observe(3, "valid", 2, 1)).then(complete(3)).expect(total == 12 and invariant)
  run missingArchiveDoesNotMeanZeroMoneyTest = init.then(archiveInput(false, Set()))
    .then(begin(1, 1)).then(observe(1, "valid", 0, 0)).then(complete(1))
    .then(begin(2, 3)).then(observe(3, "valid", 0, 0)).then(complete(3))
    .expect(total == -1 and totalState == "loading" and emptyMessage)
  run completeEmptyHistoriesAreKnownZeroTest = init.then(archiveInput(true, Set()))
    .then(begin(1, 1)).then(observe(1, "valid", 0, 0)).then(complete(1))
    .then(begin(2, 3)).then(observe(3, "valid", 0, 0)).then(complete(3))
    .expect(total == 0 and emptyMessage and invariant)
  run invalidPageIsNotEmptyHistoryTest = init.then(archiveInput(true, Set()))
    .then(begin(1, 1)).then(observe(1, "invalid", 0, 0)).then(complete(1))
    .expect(total == -1 and not(emptyMessage) and s.direct.phase == "error")
  run retryOneSourcePreservesOtherRowsTest = init.then(begin(2, 3))
    .then(observe(3, "valid", 1, 1)).then(complete(3)).then(begin(1, 1))
    .then(timeout(1)).then(begin(1, 2)).expect(count == 5 and total == -1 and invariant)
  run successfulRetryCompletesTotalTest = init.then(begin(1, 1)).then(timeout(1))
    .then(begin(1, 2)).then(observe(2, "valid", 1, 1)).then(complete(2))
    .then(begin(2, 3)).then(observe(3, "valid", 0, 0)).then(complete(3))
    .expect(total == 9 and invariant)
  run timeoutRejectsLateCompletionTest = init.then(begin(1, 1)).then(timeout(1))
    .then(lateReply(1)).expect(s.direct.phase == "error" and total == -1)
  run departedReadCannotPublishIntoReplacementTest = init.then(begin(1, 1))
    .then(observe(1, "valid", 2, 2)).then(depart).then(remount)
    .then(begin(1, 2)).then(complete(1)).expect(s.direct.phase == "loading" and count == 4 and invariant)
  run replacementReadCanCompleteTest = init.then(begin(1, 1)).then(depart).then(remount)
    .then(begin(1, 2)).then(observe(2, "valid", 1, 1)).then(complete(2))
    .expect(s.direct.phase == "ready" and count == 5 and invariant)
  run clockAloneDoesNotClaimRepaintTest = init.then(installTimer).then(tick)
    .expect(label(1) == "under-review" and s.now == 1)
  run exactFirstDeadlineRepaintsReviewTest = init.then(installTimer).then(tick).then(fireTimer)
    .expect(label(1) == "awaiting-approval" and label(2) == "under-review" and invariant)
  run nextDeadlineIsRearmedTest = init.then(installTimer).then(tick).then(fireTimer)
    .then(installTimer).then(tick).then(fireTimer)
    .expect(label(2) == "awaiting-approval" and s.target == 0 and invariant)
  run earliestIncludedReviewWinsTest = init.then(archiveInput(true, Set(1, 2)))
    .expect(s.target == 1)
  run laterOnlyReviewUsesItsOwnDeadlineTest = init.then(archiveInput(true, Set(2)))
    .expect(s.target == 2)
  run noDeadlineReviewDoesNotArmTimerTest = init.then(archiveInput(true, Set(4)))
    .then(tick).then(tick).expect(s.target == 0 and label(4) == "under-review")
  run paidRecordNeedsNoReviewTimerTest = init.then(archiveInput(true, Set(3)))
    .then(tick).expect(s.target == 0 and label(3) == "paid")
  run alreadyElapsedReviewPaintsOnArrivalTest = init.then(tick)
    .then(archiveInput(true, Set(1))).expect(label(1) == "awaiting-approval" and s.target == 0)
  run timerInstalledAfterDeadlineStillRepaintsTest = init.then(tick).then(installTimer)
    .then(fireTimer).expect(label(1) == "awaiting-approval" and invariant)
  run removedReviewCancelsItsTimerTest = init.then(installTimer)
    .then(archiveInput(true, Set(3))).then(tick).expect(not(s.armed) and s.target == 0)
  run reviewDeadlineDoesNotPayOrApproveTest = init.then(begin(1, 1))
    .then(observe(1, "valid", 0, 0)).then(complete(1)).then(begin(2, 3))
    .then(observe(3, "valid", 0, 0)).then(complete(3))
    .then(installTimer).then(tick).then(fireTimer)
    .expect(total == 7 and label(1) == "awaiting-approval" and label(3) == "paid" and invariant)
  run expandedHistoryShowsEveryCompletedSourceTest = init.then(begin(1, 1))
    .then(observe(1, "valid", 2, 2)).then(complete(1)).then(begin(2, 3))
    .then(observe(3, "valid", 2, 2)).then(complete(3)).then(toggleExpanded)
    .expect(count == 8 and displayed == 8 and expansionControl and invariant)
  run collapsedHistoryShowsFiveRowsTest = init.then(begin(1, 1))
    .then(observe(1, "valid", 2, 2)).then(complete(1)).expect(count == 6 and displayed == 5)
  // Historical negative control, deliberately absent from step: the former
  // component had no review timer. Another event could repaint it, but passage
  // of a midday deadline alone left the old label visible.
  action oldMissingTimer = s' = s.with("target", 0).with("armed", false)
  run oldMissingTimerRetainsOpenReviewTest = init.then(oldMissingTimer).then(tick)
    .expect(s.now == 1 and label(1) == "under-review")
}
