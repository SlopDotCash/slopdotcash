// @source src/SponsoredPoolsNotice.tsx
// @source src/lib/sponsored-pools-notice.ts
// @evidence tests/e2e/home-sponsored-pools.spec.ts
// @evidence scripts/sponsored-pools-notice.test.ts
// The home page notice for the sponsored pools round. Time is abstracted to
// before or after the end instant; storage is available or blocked. A notice
// is shown only before the end and only when no stored dismissal exists. A
// dismissal with working storage survives a reload; with blocked storage it
// closes the notice for the current page only. The end is read when the page
// loads, so a page left open past the end keeps the notice until the next load.
module ui_sponsored_pools_notice {
  type View = { beforeEnd: bool, loadedBeforeEnd: bool, storageOk: bool,
    stored: bool, shown: bool }
  var s: View
  pure def render(view: View): bool = view.beforeEnd and not(view.stored)
  action start(storageOk: bool): bool =
    s' = {beforeEnd: true, loadedBeforeEnd: true, storageOk: storageOk,
      stored: false, shown: true}
  action init = { nondet storageOk = Set(true, false).oneOf() start(storageOk) }
  action dismiss = all {
    s.shown,
    s' = s.with("shown", false).with("stored", s.storageOk)
  }
  action reload = s' = s.with("shown", render(s)).with("loadedBeforeEnd", s.beforeEnd)
  action roundEnds = all { s.beforeEnd, s' = s.with("beforeEnd", false) }
  action step = any { dismiss, reload, roundEnds, s' = s }
  val invariant = all {
    s.shown implies s.loadedBeforeEnd,
    s.shown implies not(s.stored),
    s.stored implies s.storageOk
  }
  run shownBeforeEndTest = init.expect(s.shown)
  run dismissalSurvivesReloadTest = start(true).then(dismiss).then(reload).expect(not(s.shown))
  run blockedStorageShowsAgainTest = start(false).then(dismiss).then(reload).expect(s.shown)
  run goneAfterEndTest = init.then(roundEnds).then(reload).expect(not(s.shown))
}
