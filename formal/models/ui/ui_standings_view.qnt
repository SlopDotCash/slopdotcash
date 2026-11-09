// @source src/Points.tsx
// @source src/Presentation.tsx
// @source src/lib/use-snapshot.ts
// @evidence tests/e2e/project-standings-navigation.spec.ts
// @evidence tests/e2e/points.spec.ts
// @evidence tests/e2e/points-refresh.spec.ts
// ContributorStandings and its retained PointsPage parent. Source-only: every
// scenario below is unexecuted. No browser, parser or model-checker result.
// Four immutable actors, two registered projects, two UTC months, and one
// renamed actor bound the projection. Page sizes 2/1 stand for full/compact
// 25/10; this checks selection and clamping, not the production row limits.
// Symbolic raw page strings cover absent, invalid, nonpositive, decimal-prefix
// and oversized inputs to parseInt. The large page is 9 rather than unbounded.
// Journal validation/credits, snapshot validation/cache transport, UTC timer
// delivery, URL encoding and the People data source are delegated. Successful
// source publication is modeled separately from pending/error readiness.
// A retained hidden standings view remains mounted. Requested page and the
// clamped displayed page are deliberately distinct; clamping does not rewrite
// filters or URL. Ranking happens before the name query and page slicing.
module ui_standings_view {
  type Location = { period: str, page: str, query: str, project: int,
    people: bool, sort: bool, extra: bool, anchor: bool }
  type Filters = { period: str, page: int, query: str, project: int }
  type State = { mounted: bool, location: Location, filters: Filters,
    projectProp: int, compact: bool, effectPending: bool,
    journal: str, verifiedJournal: bool, snapshot: str,
    snapshotRefreshFailed: bool, month: int,
    peopleVisible: bool, peopleVisited: bool, visitPending: bool }
  val actors = Set(1, 2, 3, 4)
  val slots = List(0, 1, 2, 3)
  val queries = Set("all", "old2", "new2", "actor3", "pair", "missing", "spaces")
  val rawPages = Set("absent", "first", "second", "third", "fourth", "second-suffix", "large", "zero", "negative", "junk")
  val rawPeriods = Set("absent", "month", "lifetime", "new", "calendar", "invalid")
  var s: State

  pure def parsePage(raw: str): int = if (raw == "second" or raw == "second-suffix") 1
    else if (raw == "third") 2 else if (raw == "fourth") 3
    else if (raw == "large") 8 else 0
  pure def parseFilters(url: Location, prop: int): Filters = {
    period: if (url.period == "lifetime" or url.period == "new") "lifetime" else "month",
    page: parsePage(url.page), query: url.query,
    project: if (prop > 0) prop else if (url.project <= 2) url.project else 0
  }
  pure def url(period: str, page: str, query: str, project: int): Location = {
    period: period, page: page, query: query, project: project,
    people: false, sort: true, extra: true, anchor: true
  }
  val selectedProject = if (s.projectProp > 0) s.projectProp else s.filters.project
  val pageSize = if (s.compact) 1 else 2
  val hasJournal = s.journal == "ready" or s.journal == "stale"
  // Fixed accepted-work records all belong to the first modeled UTC month.
  // Their lifetime totals remain when the current month advances.
  pure def firstMonth(actor: int, project: int): int =
    if (project == 1) (if (actor <= 2) 30 else if (actor == 3) 10 else 0)
    else if (project == 2) (if (actor == 2) 20 else if (actor == 4) 5 else 0)
    else if (actor == 1) 30 else if (actor == 2) 50 else if (actor == 3) 10 else 5
  def points(actor: int): int =
    if (not(hasJournal)) 0
    else if (s.filters.period == "lifetime") firstMonth(actor, selectedProject)
    else if (s.month == 1) firstMonth(actor, selectedProject)
    else 0
  def precedes(left: int, right: int): bool = points(left) > points(right)
    or (points(left) == points(right) and left < right)
  val positiveActors = actors.filter(actor => points(actor) > 0)
  val ordered = slots.select(index => index < positiveActors.size()).foldl(List(), (result, index) =>
    result.append(positiveActors.filter(actor =>
      positiveActors.filter(other => precedes(other, actor)).size() == index).getOnlyElement()))
  def rankFor(actor: int): int = positiveActors.filter(other => points(other) > points(actor)).size() + 1
  // A ready current snapshot supplies the current login by immutable actor ID.
  // Loading/error leaves the journal's login in place. Lowercasing is abstract;
  // leading/trailing spaces are not trimmed by ContributorStandings.
  def matches(actor: int): bool = s.filters.query == "all"
    or (s.filters.query == "pair" and Set(1, 2).contains(actor))
    or (s.filters.query == "actor3" and actor == 3)
    or (actor == 2 and ((s.filters.query == "new2" and s.snapshot == "ready")
      or (s.filters.query == "old2" and s.snapshot != "ready")))
  val filtered = ordered.select(actor => matches(actor))
  val pageCount = if (filtered.length() == 0) 1
    else (filtered.length() + pageSize - 1) / pageSize
  val currentPage = if (s.filters.page < pageCount) s.filters.page else pageCount - 1
  val finish = if ((currentPage + 1) * pageSize < filtered.length())
    (currentPage + 1) * pageSize else filtered.length()
  val rows = if (filtered.length() == 0) List()
    else filtered.slice(currentPage * pageSize, finish)
  val pagerVisible = hasJournal and filtered.length() > pageSize
  val standingsVisible = s.mounted and not(s.peopleVisible)
  val view = if (not(s.mounted)) "departed"
    else if (not(standingsVisible)) "hidden"
    else if (not(hasJournal)) s.journal
    else if (filtered.length() == 0) "empty" else "rows"

  action init = s' = { mounted: true, location: url("absent", "absent", "all", 0),
    filters: { period: "month", page: 0, query: "all", project: 0 },
    projectProp: 0, compact: false, effectPending: true,
    journal: "loading", verifiedJournal: false, snapshot: "loading",
    snapshotRefreshFailed: false, month: 1,
    peopleVisible: false, peopleVisited: false, visitPending: false }
  action restore(location: Location): bool = all {
    s.mounted, rawPages.contains(location.page), rawPeriods.contains(location.period),
    queries.contains(location.query), Set(0, 1, 2, 3).contains(location.project),
    s' = s.with("location", location).with("filters", parseFilters(location, s.projectProp))
      .with("effectPending", s.effectPending or parseFilters(location, s.projectProp) != s.filters)
      .with("peopleVisible", location.people)
      .with("visitPending", location.people and not(s.peopleVisited))
  }
  // History/hash restoration of the parent does not replace a hidden child.
  // Native hashchange alone updates the parent; child filters listen to popstate.
  action hashPeople = all { s.mounted,
    s' = s.with("location", s.location.with("people", true)).with("peopleVisible", true)
      .with("visitPending", not(s.peopleVisited)) }
  action mountPeople = all { s.mounted, s.visitPending,
    s' = s.with("peopleVisited", true).with("visitPending", false) }
  action projectRoute(project: int): bool = all { s.mounted, Set(1, 2).contains(project),
    s' = s.with("projectProp", project).with("compact", true).with("effectPending", true) }
  action choosePeriod(period: str): bool = all { standingsVisible, not(s.compact),
    Set("month", "lifetime").contains(period),
    s' = s.with("filters", s.filters.with("period", period).with("page", 0))
      .with("effectPending", s.effectPending or period != s.filters.period or s.filters.page != 0) }
  action choosePage(page: int): bool = all { standingsVisible, pagerVisible,
    page >= 0, page < pageCount, (page == currentPage - 1 or page == currentPage + 1),
    s' = s.with("filters", s.filters.with("page", page)).with("effectPending", true) }
  action replaceUrl = all { s.mounted, s.effectPending,
    s' = s.with("effectPending", false).with("location", s.location
      .with("period", if (s.compact and s.projectProp > 0 and s.location.period == "calendar")
        "calendar" else if (s.filters.period == "month") "absent" else "lifetime")
      .with("page", if (s.filters.page == 0) "absent" else if (s.filters.page == 8) "large"
        else if (s.filters.page == 3) "fourth" else if (s.filters.page == 2) "third" else "second")
      .with("project", if (s.projectProp > 0) 0 else s.filters.project)
      .with("query", s.filters.query).with("sort", false)) }
  action journalLoading = all { s.mounted, s' = s.with("journal", "loading") }
  action journalReady = all { s.mounted,
    s' = s.with("journal", "ready").with("verifiedJournal", true) }
  action journalStale = all { s.mounted, s.verifiedJournal, s' = s.with("journal", "stale") }
  action journalError = all { s.mounted, not(s.verifiedJournal), s' = s.with("journal", "error") }
  action snapshotReady = all { s.mounted,
    s' = s.with("snapshot", "ready").with("snapshotRefreshFailed", false) }
  action snapshotError = all { s.mounted, s.snapshot != "ready",
    s' = s.with("snapshot", "error") }
  // useSnapshot retains the validated current-name overlay when its refresh
  // fails. An outage cannot silently roll names back to the journal spelling.
  action snapshotRefreshFailure = all { s.mounted, s.snapshot == "ready",
    s' = s.with("snapshotRefreshFailed", true) }
  action utcMonthDelivery = all { s.mounted, s.month == 1, s' = s.with("month", 2) }
  action depart = all { s.mounted, s' = s.with("mounted", false).with("effectPending", false)
    .with("visitPending", false) }
  action step = {
    nondet period = rawPeriods.oneOf()
    nondet rawPage = rawPages.oneOf()
    nondet query = queries.oneOf()
    nondet project = Set(0, 1, 2, 3).oneOf()
    nondet page = Set(0, 1, 2, 3).oneOf()
    any { restore(url(period, rawPage, query, project)), hashPeople, mountPeople,
      projectRoute(1), projectRoute(2), choosePeriod("month"), choosePeriod("lifetime"),
      choosePage(page), replaceUrl, journalLoading, journalReady, journalStale,
      journalError, snapshotReady, snapshotError, snapshotRefreshFailure,
      utcMonthDelivery, depart, s' = s }
  }
  val invariant = all {
    s.filters.page >= 0, currentPage >= 0, currentPage < pageCount,
    rows.length() <= pageSize, rows.foldl(true, (valid, actor) => valid and points(actor) > 0 and matches(actor)),
    ordered.foldl(Set(), (seen, actor) => seen.union(Set(actor))) == positiveActors,
    ordered.length() == positiveActors.size(),
    s.projectProp > 0 implies selectedProject == s.projectProp,
    not(hasJournal) implies rows.length() == 0,
    hasJournal implies s.verifiedJournal,
    s.snapshotRefreshFailed implies s.snapshot == "ready",
    s.peopleVisited implies not(s.visitPending),
    actors.forall(actor => positiveActors.contains(actor) implies rankFor(actor) >= 1)
  }

  run initialLoadingHasNoRankedRowsTest = init.expect(view == "loading" and rows.length() == 0)
  run snapshotFailureDoesNotHideVerifiedPointsTest = init.then(snapshotError).then(journalReady)
    .expect(view == "rows" and rows == List(2, 1) and invariant)
  run journalFailureIsNotAnEmptyRankingTest = init.then(journalError)
    .expect(view == "error" and rows.length() == 0)
  run staleVerifiedJournalKeepsRankingTest = init.then(journalReady).then(journalStale)
    .expect(rows == List(2, 1) and s.journal == "stale")
  run retryLoadingHidesOldRowsTest = init.then(journalReady).then(journalLoading)
    .expect(view == "loading" and rows.length() == 0)
  run failedRetryRestoresVerifiedJournalTest = init.then(journalReady).then(journalLoading)
    .then(journalStale).expect(view == "rows" and rows == List(2, 1) and invariant)
  run globalPointsOrderTest = init.then(journalReady).expect(ordered == List(2, 1, 3, 4))
  run projectCompetitionRanksPreserveTieGapsTest = init.then(journalReady)
    .then(restore(url("month", "absent", "all", 1)))
    .expect(ordered == List(1, 2, 3) and rankFor(1) == 1 and rankFor(2) == 1 and rankFor(3) == 3)
  run queryUsesRankBeforeFilteringTest = init.then(journalReady)
    .then(restore(url("month", "absent", "actor3", 0)))
    .expect(rows == List(3) and rankFor(3) == 3 and not(pagerVisible))
  run whitespaceQueryIsNotTrimmedTest = init.then(journalReady)
    .then(restore(url("month", "absent", "spaces", 0))).expect(view == "empty")
  run currentSnapshotNameOverridesJournalNameTest = init.then(journalReady)
    .then(restore(url("month", "absent", "old2", 0))).then(snapshotReady)
    .expect(view == "empty")
  run renamedCurrentActorKeepsPointsAndRankTest = init.then(journalReady).then(snapshotReady)
    .then(restore(url("month", "absent", "new2", 0)))
    .expect(rows == List(2) and points(2) == 50 and rankFor(2) == 1)
  run failedSnapshotUsesJournalNameTest = init.then(journalReady).then(snapshotError)
    .then(restore(url("month", "absent", "old2", 0))).expect(rows == List(2))
  run failedSnapshotRefreshKeepsCurrentNameTest = init.then(journalReady).then(snapshotReady)
    .then(restore(url("month", "absent", "new2", 0))).then(snapshotRefreshFailure)
    .expect(rows == List(2) and s.snapshotRefreshFailed and invariant)
  run nextPageUsesFilteredSliceTest = init.then(journalReady).then(choosePage(1))
    .expect(rows == List(3, 4) and currentPage == 1)
  run oversizedPageClampsWithoutChangingRequestTest = init.then(journalReady)
    .then(restore(url("month", "large", "all", 0))).then(replaceUrl)
    .expect(currentPage == 1 and rows == List(3, 4) and s.filters.page == 8 and s.location.page == "large")
  run previousUsesClampedPageTest = init.then(journalReady)
    .then(restore(url("month", "large", "all", 0))).then(choosePage(0)).then(replaceUrl)
    .expect(currentPage == 0 and s.filters.page == 0 and s.location.page == "absent")
  run narrowedQueryClampsWithoutLosingRequestedPageTest = init.then(journalReady)
    .then(restore(url("month", "large", "actor3", 0)))
    .expect(currentPage == 0 and s.filters.page == 8 and rows == List(3))
  run emptyQueryKeepsValidDisplayPageTest = init.then(journalReady)
    .then(restore(url("month", "large", "missing", 0)))
    .expect(view == "empty" and currentPage == 0 and not(pagerVisible))
  run periodButtonResetsRequestedPageTest = init.then(journalReady)
    .then(restore(url("month", "large", "all", 0))).then(choosePeriod("lifetime"))
    .then(replaceUrl).expect(s.filters.page == 0 and s.location.page == "absent"
      and s.location.period == "lifetime")
  run samePeriodButtonAlsoResetsPageTest = init.then(journalReady).then(choosePage(1))
    .then(choosePeriod("month")).expect(currentPage == 0 and s.filters.page == 0)
  run legacyNewPeriodCanonicalizesToLifetimeTest = init
    .then(restore(url("new", "absent", "all", 0))).then(replaceUrl)
    .expect(s.filters.period == "lifetime" and s.location.period == "lifetime")
  run unknownPeriodCanonicalizesToMonthTest = init
    .then(restore(url("invalid", "absent", "all", 0))).then(replaceUrl)
    .expect(s.filters.period == "month" and s.location.period == "absent")
  run invalidProjectDoesNotBecomeScopeTest = init
    .then(restore(url("month", "absent", "all", 3))).then(replaceUrl)
    .expect(selectedProject == 0 and s.location.project == 0)
  run decimalPrefixPageIsAcceptedTest = init.then(journalReady)
    .then(restore(url("month", "second-suffix", "all", 0))).then(replaceUrl)
    .expect(currentPage == 1 and s.location.page == "second")
  run invalidPageStartsAtFirstPageTest = init
    .then(restore(url("month", "junk", "all", 0))).expect(s.filters.page == 0)
  run zeroPageStartsAtFirstPageTest = init
    .then(restore(url("month", "zero", "all", 0))).expect(s.filters.page == 0)
  run negativePageStartsAtFirstPageTest = init
    .then(restore(url("month", "negative", "all", 0))).expect(s.filters.page == 0)
  run unrelatedUrlFieldsSurviveCanonicalizationTest = init.then(replaceUrl)
    .expect(s.location.extra and s.location.anchor and not(s.location.sort))
  run projectPropWinsBeforeRetainedFiltersResetTest = init.then(journalReady)
    .then(restore(url("month", "absent", "all", 1))).then(projectRoute(2))
    .expect(s.filters.project == 1 and selectedProject == 2 and ordered == List(2, 4))
  run projectUrlDoesNotRetainCompetingProjectQueryTest = init.then(projectRoute(2))
    .then(restore(url("lifetime", "absent", "all", 1))).then(replaceUrl)
    .expect(selectedProject == 2 and s.location.project == 0)
  run compactAwardCalendarMonthSurvivesUrlEffectTest = init.then(projectRoute(1))
    .then(restore(url("calendar", "absent", "all", 2))).then(replaceUrl)
    .expect(s.filters.period == "month" and s.location.period == "calendar")
  run fullStandingsCalendarPeriodFallsBackToMonthTest = init
    .then(restore(url("calendar", "absent", "all", 0))).then(replaceUrl)
    .expect(s.location.period == "absent")
  run hiddenStandingsReadStillCompletesTest = init.then(hashPeople).then(mountPeople)
    .then(journalReady).expect(view == "hidden" and rows == List(2, 1) and s.peopleVisited)
  run returnFromPeopleKeepsLoadedJournalTest = init.then(hashPeople).then(mountPeople)
    .then(journalReady).then(restore(url("month", "absent", "all", 0)))
    .expect(view == "rows" and s.peopleVisited and s.journal == "ready")
  run hashChangeDoesNotRewriteStandingsFiltersTest = init.then(journalReady)
    .then(choosePage(1)).then(hashPeople).expect(s.filters.page == 1 and view == "hidden")
  run monthRolloverRemovesPriorMonthPointsTest = init.then(journalReady).then(utcMonthDelivery)
    .expect(view == "empty" and rows == List() and points(1) == 0)
  run lifetimeSurvivesMonthRolloverTest = init.then(journalReady).then(choosePeriod("lifetime"))
    .then(utcMonthDelivery).expect(ordered == List(2, 1, 3, 4) and points(2) == 50)
  run departureHasNoVisibleRowsTest = init.then(journalReady).then(depart)
    .expect(view == "departed" and not(standingsVisible) and not(s.effectPending))
}
