// @source src/lib/pool-funding.ts
// @source backend/projects/skill-publication.ts
// @source src/PublicPages.tsx
// @source src/App.tsx
// @source src/lib/home-projects.ts
// @source functions/[[path]].ts
// @evidence src/lib/pool-funding.test.ts
// @evidence backend/projects/discovery-funding.test.ts
// @evidence tests/e2e/unfunded-listing.spec.ts
// `positiveCap` abstracts the resolved current UTC month's amount.
// A positive cap, an external reward or an open bounty qualifies for listing.
// `homeEligible` and `discoveryEligible` abstract existing surface gates for
// registry tier, intake, card kind, restrictions and clearance.
// The homepage waits for funding to label the amount. Funding failures do not
// change the resulting set. Sponsors and agent discovery do not wait.
// Funding display is modeled separately in ui_pool_funding.
// Community pagination abstracts an already eligible, ordered list with unique
// project identities as positions 0..total-1. Bound: 0..5 rows, page size 2
// (production uses 10), and stored requests 0..2. The rendered page is clamped
// after a registry change; the React request itself remains retained. These
// arithmetic ranges do not establish DOM equivalence or change eligibility.
module ui_project_listing {
  type S = {read: str, active: bool, monthly: bool, program: bool, positiveCap: bool, homeEligible: bool, discoveryEligible: bool, retired: bool, homeShown: bool, shownList: bool, discovered: bool, communityTotal: int, requestedPage: int}
  var s: S
  pure def pageCount(total: int): int = (total + 1) / 2
  pure def pageNumbers(total: int): Set[int] = if (total == 0) Set() else 0.to(pageCount(total) - 1)
  pure def eligibleRows(total: int): Set[int] = if (total == 0) Set() else 0.to(total - 1)
  pure def pageRows(total: int, page: int): Set[int] = eligibleRows(total).filter(row => row >= page * 2 and row < (page + 1) * 2)
  pure def currentPage(t: S): int = if (t.communityTotal == 0) 0 else if (t.requestedPage < pageCount(t.communityTotal)) t.requestedPage else pageCount(t.communityTotal) - 1
  pure def eligible(t: S): bool = not(t.retired) and (not(t.monthly) or t.program or t.positiveCap)
  pure def shown(t: S): S =
    t.with("homeShown", t.active and t.homeEligible and t.read != "loading" and eligible(t))
     .with("shownList", eligible(t))
     .with("discovered", t.active and t.discoveryEligible and eligible(t))
  action init = s' = shown({read: "loading", active: true, monthly: true, program: false, positiveCap: false, homeEligible: true, discoveryEligible: true, retired: false, homeShown: false, shownList: false, discovered: false, communityTotal: 0, requestedPage: 0})
  action project(a: bool, m: bool, p: bool, c: bool): bool = all {
    not(s.retired),
    s' = shown(s.with("active", a).with("monthly", m).with("program", p).with("positiveCap", c)),
  }
  action browserRead(ok: bool): bool = s' = shown(s.with("read", if (ok) "ready" else "failed"))
  action surfaceGates(home: bool, discovery: bool): bool =
    s' = shown(s.with("homeEligible", home).with("discoveryEligible", discovery))
  action retire = s' = shown(s.with("retired", true).with("active", false))
  action communityRegistry(total: int): bool = all { 0 <= total and total <= 5, s' = s.with("communityTotal", total) }
  action previousPage = all { currentPage(s) > 0, s' = s.with("requestedPage", currentPage(s) - 1) }
  action nextPage = all { s.communityTotal > 0, currentPage(s) < pageCount(s.communityTotal) - 1, s' = s.with("requestedPage", currentPage(s) + 1) }
  action step = any {
    nondet a = Bool.oneOf()
    nondet m = Bool.oneOf()
    nondet p = Bool.oneOf()
    nondet c = Bool.oneOf()
    project(a, m, p, c),
    nondet ok = Bool.oneOf()
    browserRead(ok),
    nondet home = Bool.oneOf()
    nondet discovery = Bool.oneOf()
    surfaceGates(home, discovery),
    retire,
    nondet total = 0.to(5).oneOf()
    communityRegistry(total),
    previousPage,
    nextPage,
  }
  val invariant = all {
    s.homeShown == (s.active and s.homeEligible and s.read != "loading" and eligible(s)),
    s.shownList == eligible(s),
    s.discovered == (s.active and s.discoveryEligible and eligible(s)),
    s.read == "loading" implies not(s.homeShown),
    s.retired implies not(s.active),
    (s.retired or (s.monthly and not(s.program) and not(s.positiveCap))) implies
      (not(s.homeShown) and not(s.shownList) and not(s.discovered)),
    not(s.active) implies (not(s.homeShown) and not(s.discovered)),
    0 <= s.communityTotal and s.communityTotal <= 5,
    0 <= s.requestedPage and s.requestedPage <= 2,
    if (s.communityTotal == 0) currentPage(s) == 0 else pageNumbers(s.communityTotal).contains(currentPage(s)),
    pageRows(s.communityTotal, currentPage(s)).size() <= 2,
    pageNumbers(s.communityTotal).fold(Set(), (covered, page) => covered.union(pageRows(s.communityTotal, page))) == eligibleRows(s.communityTotal),
    pageNumbers(s.communityTotal).forall(a => pageNumbers(s.communityTotal).forall(b => a == b or pageRows(s.communityTotal, a).intersect(pageRows(s.communityTotal, b)).size() == 0)),
  }
  run pointsOnlyPoolIsHiddenTest = init.then(browserRead(true)).expect(not(s.homeShown) and not(s.shownList) and not(s.discovered) and invariant)
  run configuredPoolIsListedTest = init.then(project(true, true, false, true)).then(browserRead(true)).expect(s.homeShown and s.shownList and s.discovered and invariant)
  run securityProgramStaysListedTest = init.then(project(true, true, true, false)).then(browserRead(true)).expect(s.shownList and s.discovered and invariant)
  run externalPrizeStaysListedTest = init.then(project(true, false, false, false)).then(browserRead(true)).expect(s.homeShown and s.shownList and s.discovered and invariant)
  run pausedPositivePoolRemainsOnSponsorsTest = init.then(project(false, true, false, true)).then(browserRead(true)).expect(s.shownList and not(s.homeShown) and not(s.discovered) and invariant)
  run retiredPoolIsHiddenTest = init.then(project(true, true, false, true)).then(browserRead(true)).then(retire).expect(not(s.homeShown) and not(s.shownList) and not(s.discovered) and invariant)
  run failedFundingReadDoesNotShowPointsOnlyTest = init.then(browserRead(false)).expect(not(s.homeShown) and not(s.shownList) and not(s.discovered) and invariant)
  run failedFundingReadShowsConfiguredPoolTest = init.then(project(true, true, false, true)).then(browserRead(false)).expect(s.homeShown and s.shownList and s.discovered and invariant)
  run homeWaitsForFundingReadTest = init.then(project(true, true, false, true)).expect(not(s.homeShown) and s.shownList and s.discovered and invariant)
  run zeroingTheCurrentCapHidesPoolTest = init.then(project(true, true, false, true)).then(browserRead(true)).then(project(true, true, false, false)).expect(not(s.homeShown) and not(s.shownList) and not(s.discovered) and invariant)
  run existingSurfaceGatesApplyTest = init.then(project(true, true, false, true)).then(surfaceGates(false, false)).then(browserRead(true)).expect(not(s.homeShown) and not(s.discovered) and invariant)
  run emptyCommunityHasNoPreviousPageTest = init.expect(pageRows(s.communityTotal, currentPage(s)) == Set() and invariant).then(previousPage.fail())
  run emptyCommunityHasNoNextPageTest = init.then(nextPage.fail())
  run communityPagesCoverRowsOnceTest = init.then(communityRegistry(5)).then(nextPage).then(nextPage).expect(currentPage(s) == 2 and pageRows(s.communityTotal, currentPage(s)) == Set(4) and invariant).then(nextPage.fail())
  run registryShrinkClampsRenderedPageTest = init.then(communityRegistry(5)).then(nextPage).then(nextPage).then(communityRegistry(3)).expect(s.requestedPage == 2 and currentPage(s) == 1 and pageRows(s.communityTotal, currentPage(s)) == Set(2) and invariant).then(previousPage).expect(s.requestedPage == 0 and invariant)
  run emptiedRegistryKeepsNoVisibleRowsTest = init.then(communityRegistry(5)).then(nextPage).then(nextPage).then(communityRegistry(0)).expect(pageRows(s.communityTotal, currentPage(s)) == Set() and invariant).then(communityRegistry(1)).expect(currentPage(s) == 0 and pageRows(s.communityTotal, currentPage(s)) == Set(0) and invariant)
  run fundingReadsDoNotChangeCommunityPageTest = init.then(communityRegistry(5)).then(nextPage).then(browserRead(true)).then(browserRead(false)).expect(currentPage(s) == 1 and pageRows(s.communityTotal, currentPage(s)) == Set(2, 3) and invariant)
}
