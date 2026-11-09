// @source src/CyclePages.tsx
// @source src/App.tsx
// @source src/lib/use-cycle-index.ts
// @source src/lib/use-time-boundary.ts
// @evidence tests/e2e/site.spec.ts
// @evidence tests/e2e/ui-clock-transitions.spec.ts
// Two historical projects/records, two months, one retired project, one absent
// target, two independent index reads, one abstract snapshot bundle, and four
// ordered clock positions. Both records are
// review records; their deadlines are 1 and 3, and index staleness starts at 2.
// Zero means All/no timer; 3 is an unavailable filter value. Amounts, immutable
// file validation, provider transport and full registry validation are outside
// this model (ui_cycle_publication and ui_resources cover other boundaries).
// URL synchronization and timer delivery are separate from a render. These
// source-authored scenarios have not been executed.
// Exhaustive verification explores a reduced `step`; the comment above it
// states each reduction argument. Direct actions and scenarios are unreduced.
module ui_cycle_archive {
  type Filters = { project: int, month: int, state: int }
  var s: { mounted: bool, route: str, target: int, index: str, generation: int,
    records: Set[int], bundledRecords: Set[int], requested: Filters, url: Filters, snapshot: str,
    retired: Set[int], now: int, paintedAt: int, scheduled: int }

  pure val allFilters = { project: 0, month: 0, state: 0 }
  pure val ids = Set(1, 2)
  pure def deadline(id: int): int = if (id == 1) 1 else 3
  pure def retain(value: int, offered: Set[int]): int =
    if (offered.contains(value)) value else 0
  val filters = if (s.index == "ready") {
    project: retain(s.requested.project, s.records),
    month: retain(s.requested.month, s.records),
    state: retain(s.requested.state, if (s.records.size() > 0) Set(1) else Set())
  } else s.requested
  val shown = if (s.index != "ready") Set() else s.records.filter(id =>
    (filters.project == 0 or filters.project == id) and
    (filters.month == 0 or filters.month == id) and
    (filters.state == 0 or filters.state == 1))
  def nextTimer(at: int): int = {
    val future = s.records.map(id => deadline(id)).union(Set(2)).filter(time => time > at)
    if (future.size() == 0) 0 else future.fold(4, (first, time) => if (time < first) time else first)
  }
  val elapsedReviews = s.records.filter(id => deadline(id) <= s.now)
  val displayedReviews = s.records.filter(id => deadline(id) <= s.paintedAt)
  val displayedStale = s.paintedAt >= 2
  val needsSnapshot = s.mounted and s.route == "detail" and s.index == "ready"
    and not(s.records.contains(s.target))
  val projectLink = if (s.retired.contains(s.target)) "filtered-archive" else "project"
  val display = if (not(s.mounted)) "departed"
    else if (s.route == "project") (if (s.retired.contains(s.target)) "not-found" else "project")
    else if (s.route == "archive") s.index
    else if (not(ids.contains(s.target))) "not-found"
    else if (s.index != "ready") s.index
    else if (s.records.contains(s.target) or s.bundledRecords.contains(s.target)) "record"
    else if (s.snapshot == "ready") (if (s.retired.contains(s.target)) "not-found" else "live")
    else s.snapshot

  action init = s' = { mounted: true, route: "archive", target: 1,
    index: "loading", generation: 1, records: Set(), bundledRecords: Set(), requested: allFilters,
    url: allFilters, snapshot: "loading", retired: Set(), now: 0,
    paintedAt: 0, scheduled: 0 }
  action indexReady(generation: int, records: Set[int]): bool = all {
    s.mounted, s.index == "loading", generation == s.generation,
    records.subseteq(ids), s' = s.with("index", "ready").with("records", records)
  }
  action indexFailure(generation: int): bool = all {
    s.mounted, s.index == "loading", generation == s.generation,
    s' = s.with("index", "error")
  }
  action refresh = all { s.mounted, s.generation == 1,
    s' = s.with("generation", 2).with("index", "loading").with("scheduled", 0) }
  action requestFilters(project: int, month: int, state: int): bool = all {
    s.mounted, s.route == "archive", Set(0, 1, 2, 3).contains(project),
    Set(0, 1, 2, 3).contains(month), Set(0, 1, 2, 3).contains(state),
    s' = s.with("requested", { project: project, month: month, state: state })
      .with("url", { project: project, month: month, state: state })
  }
  action synchronizeFilters = all { s.mounted, s.route == "archive",
    s' = s.with("requested", filters).with("url", filters) }
  action renderArchive = all { s.mounted, s.route == "archive", s.index == "ready",
    s' = s.with("paintedAt", s.now).with("scheduled", nextTimer(s.now)) }
  action advanceClock = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action deliverTimer = all { s.mounted, s.route == "archive", s.index == "ready",
    s.scheduled > 0, s.now >= s.scheduled,
    s' = s.with("paintedAt", s.now).with("scheduled", nextTimer(s.now)) }
  action retire(id: int): bool = all { ids.contains(id),
    s' = s.with("retired", s.retired.union(Set(id))) }
  action openDetail(id: int): bool = all { s.mounted, Set(1, 2, 3).contains(id),
    s' = s.with("route", "detail").with("target", id).with("scheduled", 0) }
  action openProject(id: int): bool = all { s.mounted, ids.contains(id),
    s' = s.with("route", "project").with("target", id).with("scheduled", 0) }
  // Navigating to the archive while it is already shown keeps the mounted
  // page and its boundary effect; useTimeBoundary clears its timer only on
  // unmount or a changed timestamp. Arriving from another route mounts a page
  // without a timer until it renders.
  action openArchive = openArchiveAs(false)
  action openArchiveAs(compact: bool): bool = all { s.mounted,
    s' = s.with("route", "archive").with("target", if (compact) 1 else s.target)
      .with("scheduled", if (s.route == "archive") s.scheduled else 0) }
  action snapshotReady = all { needsSnapshot, s' = s.with("snapshot", "ready") }
  action publishedDuringSnapshot = all { needsSnapshot, ids.contains(s.target),
    s' = s.with("snapshot", "ready").with("bundledRecords", Set(s.target)) }
  action snapshotFailure = all { needsSnapshot, s' = s.with("snapshot", "error") }
  action depart = departAs(false)
  action departAs(compact: bool): bool = s' = if (not(compact)) s.with("mounted", false).with("scheduled", 0)
    else { mounted: false, route: "archive", target: 1, index: "loading", generation: 1, records: Set(),
      bundledRecords: Set(), requested: allFilters, url: allFilters, snapshot: "loading", retired: Set(),
      now: 0, paintedAt: 0, scheduled: 0 }
  // Each nondeterministic choice is scoped to the one action that reads it
  // (formal/README.md, "Scoped nondeterministic choices"). The disjunction of
  // per-action existentials equals the former single existential over every
  // choice, so successors and enabledness are unchanged.
  // Further step-only reductions (formal/README.md, "Write-only fields and
  // canonical choices"); direct actions and scenarios are unchanged:
  // - Requested filter values are read only through `filters` (and copied to
  //   the write-only `url`). Records are subsets of {1, 2}, so project or
  //   month 3 retains to 0 exactly as 0 does, and state 2 or 3 retains to 0
  //   exactly as 0 does. Step requests only representatives 0..2 and 0..1.
  //   After the second index read (`generation == 2`) records never change:
  //   when it is ready, a value outside its records retains to 0, so step
  //   offers only records and 0 (state 1 only with records); when it failed,
  //   `filters` is never read again and step offers only all-zero filters.
  // - The target is read only on detail and project routes, and opening
  //   either route overwrites it, so step stores target 1 when it opens the
  //   archive.
  // - A departed page enables no action that reads or changes its fields
  //   except the clock and retirement, and no departed state can make an
  //   invariant conjunct false that held just before departure (records,
  //   generation, filters and paint time are copied; `display` becomes
  //   "departed"). The temporal property's consequent holds once unmounted.
  //   Step therefore stores one canonical departed state.
  // None of these reductions changes a guard of a mounted state, the
  // invariant's truth or the atoms and fairness condition of the temporal
  // property.
  val finalIndex = s.generation == 2 and s.index != "loading"
  val filterChoices = if (not(finalIndex)) Set(0, 1, 2)
    else if (s.index == "ready") s.records.union(Set(0)) else Set(0)
  val stateChoices = if (not(finalIndex)) Set(0, 1)
    else if (s.index == "ready" and s.records.size() > 0) Set(0, 1) else Set(0)
  action step = any {
    { nondet records = Set(Set(), Set(1), Set(2), ids).oneOf() indexReady(s.generation, records) },
    indexFailure(s.generation), refresh,
    { nondet projectFilter = filterChoices.oneOf() nondet monthFilter = filterChoices.oneOf()
      nondet stateFilter = stateChoices.oneOf() requestFilters(projectFilter, monthFilter, stateFilter) },
    synchronizeFilters, renderArchive, advanceClock, deliverTimer, { nondet id = ids.oneOf() retire(id) },
    { nondet target = Set(1, 2, 3).oneOf() openDetail(target) }, { nondet id = ids.oneOf() openProject(id) },
    openArchiveAs(true), snapshotReady, publishedDuringSnapshot, snapshotFailure, departAs(true), s' = s }
  val invariant = all {
    s.records.subseteq(ids), s.generation >= 1, s.generation <= 2,
    s.now >= 0, s.now <= 3, s.paintedAt <= s.now,
    displayedReviews.subseteq(elapsedReviews),
    display == "record" implies s.index == "ready" and
      (s.records.contains(s.target) or s.bundledRecords.contains(s.target)),
    display == "live" implies needsSnapshot and not(s.retired.contains(s.target)),
    s.index == "ready" implies (filters.project == 0 or s.records.contains(filters.project)),
    s.index == "ready" implies (filters.month == 0 or s.records.contains(filters.month)),
    s.index == "ready" implies (filters.state == 0 or filters.state == 1)
  }
  temporal deadlineDeliveryProperty = deliverTimer.weakFair(s).implies(
    always(s.mounted and s.route == "archive" and s.index == "ready" and s.scheduled > 0 and s.now >= s.scheduled
      implies eventually(s.paintedAt == s.now or not(s.mounted) or s.route != "archive" or s.index != "ready")))

  // Old implementations are deliberate negative controls outside step.
  val oldSelectShowsAll = s.requested.state != 0 and s.requested.state != 1
  val oldRowsEmpty = s.requested.state != 0 and s.requested.state != 1
  val oldDetailNeedsSnapshot = s.snapshot != "ready"
  val oldRetiredLinkFails = s.retired.contains(s.target)
  action oldArchiveWithoutTimer = s' = s.with("paintedAt", s.now).with("scheduled", 0)

  run invalidFilterNormalizesTest = init.then(indexReady(1, ids)).then(requestFilters(3, 0, 3))
    .then(synchronizeFilters).expect(filters == allFilters and s.url == allFilters and shown == ids)
  run validMonthSurvivesOtherInvalidFiltersTest = init.then(indexReady(1, ids)).then(requestFilters(3, 1, 3))
    .then(synchronizeFilters).expect(filters.month == 1 and shown == Set(1) and s.url == filters)
  run combinedValidFiltersCanHaveNoMatchesTest = init.then(indexReady(1, ids)).then(requestFilters(1, 2, 0))
    .then(synchronizeFilters).expect(shown == Set() and filters.project == 1 and filters.month == 2)
  run refreshRemovesMissingSelectionTest = init.then(indexReady(1, ids)).then(requestFilters(2, 0, 0))
    .then(synchronizeFilters).then(refresh).then(indexReady(2, Set(1))).then(synchronizeFilters)
    .expect(shown == Set(1) and filters == allFilters and s.url == allFilters)
  run emptyIndexClearsSelectionTest = init.then(indexReady(1, Set())).then(requestFilters(1, 1, 1))
    .then(synchronizeFilters).expect(shown == Set() and s.url == allFilters)
  run loadingPreservesRequestedFilterTest = init.then(requestFilters(1, 0, 0)).then(synchronizeFilters)
    .expect(s.url.project == 1 and shown == Set()).then(indexReady(1, ids)).expect(shown == Set(1))
  run firstReviewDeadlineTest = init.then(indexReady(1, ids)).then(renderArchive).then(advanceClock).then(deliverTimer)
    .expect(displayedReviews == Set(1) and not(displayedStale) and s.scheduled == 2)
  run staleThenSecondReviewDeadlineTest = init.then(indexReady(1, ids)).then(renderArchive)
    .then(advanceClock).then(deliverTimer).then(advanceClock).then(deliverTimer)
    .expect(displayedStale and s.scheduled == 3).then(advanceClock).then(deliverTimer)
    .expect(displayedReviews == ids and s.scheduled == 0)
  run delayedTimerCatchesAllBoundariesTest = init.then(indexReady(1, ids)).then(renderArchive)
    .then(advanceClock).then(advanceClock).then(advanceClock).then(deliverTimer)
    .expect(displayedReviews == ids and displayedStale)
  run retiredRecordLinkResolvesTest = init.then(indexReady(1, ids)).then(retire(2)).then(openDetail(2))
    .expect(display == "record" and not(needsSnapshot) and projectLink == "filtered-archive")
  run listedRecordKeepsProjectLinkTest = init.then(indexReady(1, ids)).then(openDetail(1))
    .expect(display == "record" and projectLink == "project")
  run retirementDoesNotRestoreProjectPageTest = init.then(retire(2)).then(openProject(2))
    .expect(display == "not-found")
  run retiredMissingRecordWaitsForSnapshotTest = init.then(indexReady(1, Set())).then(retire(2)).then(openDetail(2))
    .expect(display == "loading" and needsSnapshot).then(snapshotFailure)
    .expect(display == "error").then(snapshotReady).expect(display == "not-found")
  run unknownRouteStillTriggersMissingIndexSnapshotTest = init.then(indexReady(1, Set())).then(openDetail(3))
    .expect(display == "not-found" and needsSnapshot)
  run recordNeedsNoSnapshotTest = init.then(indexReady(1, ids)).then(openDetail(1))
    .expect(display == "record" and s.snapshot == "loading" and not(needsSnapshot))
  run failedIndexCannotUseLiveSnapshotTest = init.then(indexReady(1, Set())).then(openDetail(1))
    .then(snapshotReady).then(refresh).then(indexFailure(2))
    .expect(display == "error" and not(needsSnapshot))
  run indexRetryRestoresRecordTest = init.then(indexFailure(1)).then(openDetail(1)).then(refresh)
    .then(indexReady(2, Set(1))).expect(display == "record" and not(needsSnapshot))
  run knownMissingRecordAllowsLiveFallbackTest = init.then(indexReady(1, Set())).then(openDetail(1))
    .expect(needsSnapshot and display == "loading").then(snapshotReady).expect(display == "live")
  run failedLiveFallbackStaysErrorTest = init.then(indexReady(1, Set())).then(openDetail(1))
    .then(snapshotFailure).expect(display == "error")
  run recordReplacesFailedLiveFallbackTest = init.then(indexReady(1, Set())).then(openDetail(1)).then(snapshotFailure)
    .then(refresh).then(indexReady(2, Set(1))).expect(display == "record" and not(needsSnapshot))
  run publicationDuringLiveFallbackKeepsFrozenRecordTest = init.then(indexReady(1, Set())).then(openDetail(1))
    .then(publishedDuringSnapshot).expect(display == "record" and s.records == Set() and s.bundledRecords == Set(1))
  run staleIndexReplyRefusesTest = init.then(refresh).expect(s.index == "loading" and s.records == Set())
    .then(indexReady(1, ids).fail())
  run reopeningShownArchiveKeepsDeadlineTimerTest = init.then(indexReady(1, ids)).then(renderArchive)
    .then(advanceClock).then(openArchive).expect(s.scheduled == 1).then(deliverTimer)
    .expect(displayedReviews == Set(1) and s.paintedAt == 1)
  run timerCannotFireAfterDepartureTest = init.then(indexReady(1, ids)).then(renderArchive).then(advanceClock)
    .then(depart).expect(s.paintedAt == 0).then(deliverTimer.fail())
  run oldUnknownFilterMismatchNegativeControlTest = init.then(indexReady(1, ids)).then(requestFilters(0, 0, 3))
    .expect(oldSelectShowsAll and oldRowsEmpty and shown == ids)
  run oldNoTimerNegativeControlTest = init.then(indexReady(1, ids)).then(oldArchiveWithoutTimer)
    .then(advanceClock).then(advanceClock).expect(elapsedReviews == Set(1) and not(displayedStale) and displayedReviews == Set())
  run oldRetiredAndSnapshotDependencyNegativeControlTest = init.then(indexReady(1, ids)).then(retire(2)).then(openDetail(2))
    .expect(display == "record" and oldDetailNeedsSnapshot and oldRetiredLinkFails)
}
