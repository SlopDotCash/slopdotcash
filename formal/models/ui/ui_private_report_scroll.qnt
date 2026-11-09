// @source src/SecurityBounty.tsx
// @evidence src/private-report-design.css
// @evidence tests/e2e/security-bounty.spec.ts
// Browser-control abstraction for the loaded PrivateReportDetail region only.
// Long text at 200% can overflow its retained viewport. Layout and the browser's
// keyboard implementation remain external; the actual browser test checks both.
module ui_private_report_scroll {
  var visible: bool
  var overflowing: bool
  var focused: bool
  var scrolledFromTop: bool

  action init = all {
    visible' = false,
    overflowing' = false,
    focused' = false,
    scrolledFromTop' = false,
  }

  action open = all {
    not(visible),
    visible' = true,
    overflowing' = false,
    focused' = false,
    scrolledFromTop' = false,
  }

  action enlargeLongReport = all {
    visible,
    overflowing' = true,
    visible' = visible,
    focused' = focused,
    scrolledFromTop' = scrolledFromTop,
  }

  action focusReport = all {
    visible,
    focused' = true,
    visible' = visible,
    overflowing' = overflowing,
    scrolledFromTop' = scrolledFromTop,
  }

  action pageDown = all {
    visible, focused, overflowing,
    scrolledFromTop' = true,
    visible' = visible,
    overflowing' = overflowing,
    focused' = focused,
  }

  action home = all {
    visible, focused,
    scrolledFromTop' = false,
    visible' = visible,
    overflowing' = overflowing,
    focused' = focused,
  }

  action tabAway = all {
    visible, focused,
    focused' = false,
    visible' = visible,
    overflowing' = overflowing,
    scrolledFromTop' = scrolledFromTop,
  }

  action pointerScroll = all {
    visible, overflowing,
    scrolledFromTop' = true,
    visible' = visible,
    overflowing' = overflowing,
    focused' = focused,
  }

  action resizeToFit = all {
    visible,
    overflowing' = false,
    scrolledFromTop' = false,
    visible' = visible,
    focused' = focused,
  }

  action collapseOrAccountChange = all {
    visible,
    visible' = false,
    overflowing' = false,
    focused' = false,
    scrolledFromTop' = false,
  }

  action step = any {
    open, enlargeLongReport, focusReport, pageDown, home,
    tabAway, pointerScroll, resizeToFit, collapseOrAccountChange,
    all { visible' = visible, overflowing' = overflowing,
      focused' = focused, scrolledFromTop' = scrolledFromTop },
  }

  val invariant = all {
    focused implies visible,
    scrolledFromTop implies (visible and overflowing),
    not(visible) implies not(overflowing or focused or scrolledFromTop),
  }

  run keyboardScrollsOverflowingReportTest = init.then(open)
    .then(enlargeLongReport).then(focusReport).then(pageDown)
    .expect(visible and focused and scrolledFromTop)
  run returnToStartTest = init.then(open).then(enlargeLongReport)
    .then(focusReport).then(pageDown).then(home).expect(not(scrolledFromTop))
  run blurPreservesScrollTest = init.then(open).then(enlargeLongReport)
    .then(focusReport).then(pageDown).then(tabAway)
    .expect(not(focused) and scrolledFromTop)
  run collapseClearsFocusTest = init.then(open).then(enlargeLongReport)
    .then(focusReport).then(pageDown).then(collapseOrAccountChange)
    .expect(not(visible or focused or scrolledFromTop))
}
