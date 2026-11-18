// @source src/lib/pool-funding.ts
// @source backend/projects/pool-funding.ts
// @source backend/projects/skill-publication.ts
// @source src/PublicPages.tsx
// @source src/App.tsx
// @source src/lib/home-projects.ts
// @source functions/[[path]].ts
// @evidence src/lib/pool-funding.test.ts
// @evidence backend/projects/discovery-funding.test.ts
// @evidence tests/e2e/unfunded-listing.spec.ts
// `listedThisMonth` keeps an active monthly pool on /sponsors and agent
// discovery only while `poolFunded` holds (16 November 2026). Home cards
// instead retain every project admitted by `homeProjects`, independent of
// the funding read (owner decision, 17 November 2026). `homeEligible` abstracts
// that registry/tier/card-kind predicate; it never grants contribution access.
// An
// open security program, any other reward kind and a paused project stay
// listed. The pages never wait for the browser funding read: while it loads,
// and when it fails, every project is listed as before. Discovery reads the same cached vault rows on the
// server; a failed read lists every cleared project, and the response is
// no-store, so the next request reads again. The project page shows the
// ordinary unfunded notice only after a successful read that leaves it out
// of funding discovery. A visible honor-system promise uses its own warning.
// The
// funding rule itself is modelled in ui_pool_funding; here `funded` is an
// input. Points, collection and scoring are outside this model.
// Community pagination abstracts an already eligible, ordered list with unique
// project identities as positions 0..total-1. Bound: 0..5 rows, page size 2
// (production uses 10), and stored requests 0..2. The rendered page is clamped
// after a registry change; the React request itself remains retained. These
// arithmetic ranges do not establish DOM equivalence or change eligibility.
module ui_project_listing {
  type S = {read: str, server: str, active: bool, monthly: bool, program: bool, funded: bool, promise: bool, homeEligible: bool, homeShown: bool, shownList: bool, discovered: bool, pageNotice: bool, communityTotal: int, requestedPage: int}
  var s: S
  pure def pageCount(total: int): int = (total + 1) / 2
  pure def pageNumbers(total: int): Set[int] = if (total == 0) Set() else 0.to(pageCount(total) - 1)
  pure def eligibleRows(total: int): Set[int] = if (total == 0) Set() else 0.to(total - 1)
  pure def pageRows(total: int, page: int): Set[int] = eligibleRows(total).filter(row => row >= page * 2 and row < (page + 1) * 2)
  pure def currentPage(t: S): int = if (t.communityTotal == 0) 0 else if (t.requestedPage < pageCount(t.communityTotal)) t.requestedPage else pageCount(t.communityTotal) - 1
  pure def rule(t: S, known: bool): bool = not(known) or not(t.active) or not(t.monthly) or t.program or t.funded
  pure def shown(t: S): S =
    t.with("homeShown", t.homeEligible)
     .with("shownList", rule(t, t.read == "ready"))
     .with("discovered", rule(t, t.server == "ready"))
     .with("pageNotice", t.read == "ready" and not(rule(t, true)) and not(t.promise))
  action init = s' = shown({read: "loading", server: "ready", active: true, monthly: true, program: false, funded: false, promise: false, homeEligible: true, homeShown: false, shownList: false, discovered: false, pageNotice: false, communityTotal: 0, requestedPage: 0})
  // The registry and the cached vault rows change between reads.
  action project(a: bool, m: bool, p: bool, f: bool): bool =
    s' = shown(s.with("active", a).with("monthly", m).with("program", p).with("funded", f))
  action browserRead(ok: bool): bool = s' = shown(s.with("read", if (ok) "ready" else "failed"))
  action serverRead(ok: bool): bool = s' = shown(s.with("server", if (ok) "ready" else "failed"))
  action homeEligibility(eligible: bool): bool = s' = shown(s.with("homeEligible", eligible))
  action showPromise(visible: bool): bool = s' = shown(s.with("promise", visible))
  action communityRegistry(total: int): bool = all { 0 <= total and total <= 5, s' = s.with("communityTotal", total) }
  action previousPage = all { currentPage(s) > 0, s' = s.with("requestedPage", currentPage(s) - 1) }
  action nextPage = all { s.communityTotal > 0, currentPage(s) < pageCount(s.communityTotal) - 1, s' = s.with("requestedPage", currentPage(s) + 1) }
  action step = any {
    nondet a = Bool.oneOf()
    nondet m = Bool.oneOf()
    nondet p = Bool.oneOf()
    nondet f = Bool.oneOf()
    project(a, m, p, f),
    nondet ok = Bool.oneOf()
    browserRead(ok),
    nondet ok2 = Bool.oneOf()
    serverRead(ok2),
    nondet eligible = Bool.oneOf()
    homeEligibility(eligible),
    nondet visible = Bool.oneOf()
    showPromise(visible),
    nondet total = 0.to(5).oneOf()
    communityRegistry(total),
    previousPage,
    nextPage,
  }
  pure def hidden(t: S): bool = t.active and t.monthly and not(t.program) and not(t.funded)
  val invariant = all {
    s.homeShown == s.homeEligible,
    s.read == "loading" implies s.shownList,
    (s.read == "ready" and hidden(s)) implies (not(s.shownList) and (s.pageNotice == not(s.promise))),
    (s.server == "ready" and hidden(s)) implies not(s.discovered),
    s.read == "failed" implies s.shownList,
    s.server == "failed" implies s.discovered,
    not(hidden(s)) implies (s.discovered and not(s.pageNotice)),
    s.pageNotice implies not(s.shownList),
    0 <= s.communityTotal and s.communityTotal <= 5,
    0 <= s.requestedPage and s.requestedPage <= 2,
    if (s.communityTotal == 0) currentPage(s) == 0 else pageNumbers(s.communityTotal).contains(currentPage(s)),
    pageRows(s.communityTotal, currentPage(s)).size() <= 2,
    pageNumbers(s.communityTotal).fold(Set(), (covered, page) => covered.union(pageRows(s.communityTotal, page))) == eligibleRows(s.communityTotal),
    pageNumbers(s.communityTotal).forall(a => pageNumbers(s.communityTotal).forall(b => a == b or pageRows(s.communityTotal, a).intersect(pageRows(s.communityTotal, b)).size() == 0)),
  }
  run unfundedPoolStaysOnHomeTest = init.then(browserRead(true)).expect(s.homeShown and not(s.shownList) and not(s.discovered) and s.pageNotice and invariant)
  run fundedPoolIsListedTest = init.then(project(true, true, false, true)).then(browserRead(true)).expect(s.shownList and s.discovered and not(s.pageNotice) and invariant)
  run securityProgramStaysListedTest = init.then(project(true, true, true, false)).then(browserRead(true)).expect(s.shownList and s.discovered and invariant)
  run externalPrizeStaysListedTest = init.then(project(true, false, false, false)).then(browserRead(true)).expect(s.shownList and s.discovered and invariant)
  run pausedProjectKeepsItsListingTest = init.then(project(false, true, false, false)).then(browserRead(true)).expect(s.shownList and not(s.pageNotice) and invariant)
  run failedReadsListAsBeforeTest = init.then(browserRead(false)).then(serverRead(false)).expect(s.shownList and s.discovered and not(s.pageNotice) and invariant)
  run loadingListsAsBeforeTest = init.expect(s.shownList and not(s.pageNotice) and invariant)
  run fundingTheMonthListsItTest = init.then(browserRead(true)).then(project(true, true, false, true)).expect(s.shownList and s.discovered and invariant)
  run fundingLossKeepsHomeCardTest = init.then(project(true, true, false, true)).then(browserRead(true)).then(project(true, true, false, false)).expect(s.homeShown and not(s.shownList) and not(s.discovered) and invariant)
  run failedFundingReadKeepsHomeCardTest = init.then(browserRead(true)).then(browserRead(false)).expect(s.homeShown and invariant)
  run registryEligibilityStillGatesHomeTest = init.then(homeEligibility(false)).then(browserRead(true)).expect(not(s.homeShown) and invariant)
  run honorSystemDoesNotQualifyForDiscoveryTest = init.then(showPromise(true)).then(browserRead(true)).expect(s.homeShown and not(s.shownList) and not(s.discovered) and not(s.pageNotice) and invariant)
  run emptyCommunityHasNoPreviousPageTest = init.expect(pageRows(s.communityTotal, currentPage(s)) == Set() and invariant).then(previousPage.fail())
  run emptyCommunityHasNoNextPageTest = init.then(nextPage.fail())
  run communityPagesCoverRowsOnceTest = init.then(communityRegistry(5)).then(nextPage).then(nextPage).expect(currentPage(s) == 2 and pageRows(s.communityTotal, currentPage(s)) == Set(4) and invariant).then(nextPage.fail())
  run registryShrinkClampsRenderedPageTest = init.then(communityRegistry(5)).then(nextPage).then(nextPage).then(communityRegistry(3)).expect(s.requestedPage == 2 and currentPage(s) == 1 and pageRows(s.communityTotal, currentPage(s)) == Set(2) and invariant).then(previousPage).expect(s.requestedPage == 0 and invariant)
  run emptiedRegistryKeepsNoVisibleRowsTest = init.then(communityRegistry(5)).then(nextPage).then(nextPage).then(communityRegistry(0)).expect(pageRows(s.communityTotal, currentPage(s)) == Set() and invariant).then(communityRegistry(1)).expect(currentPage(s) == 0 and pageRows(s.communityTotal, currentPage(s)) == Set(0) and invariant)
  run fundingReadsDoNotChangeCommunityPageTest = init.then(communityRegistry(5)).then(nextPage).then(browserRead(true)).then(serverRead(false)).expect(currentPage(s) == 1 and pageRows(s.communityTotal, currentPage(s)) == Set(2, 3) and s.homeShown and invariant)
}
