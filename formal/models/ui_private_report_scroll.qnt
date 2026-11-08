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
  var atBottom: bool

  action init = all {
    visible' = false,
    overflowing' = false,
    focused' = false,
    atBottom' = false,
  }

  action open = all {
    not(visible),
    visible' = true,
    overflowing' = false,
    focused' = false,
    atBottom' = false,
  }

  action enlargeLongReport = all {
    visible,
    overflowing' = true,
    visible' = visible,
    focused' = focused,
    atBottom' = atBottom,
  }

  action focusReport = all {
    visible,
    focused' = true,
    visible' = visible,
    overflowing' = overflowing,
    atBottom' = atBottom,
  }

  action pageDown = all {
    visible, focused, overflowing,
    atBottom' = true,
    visible' = visible,
    overflowing' = overflowing,
    focused' = focused,
  }

  action home = all {
    visible, focused,
    atBottom' = false,
    visible' = visible,
    overflowing' = overflowing,
    focused' = focused,
  }

  action tabAway = all {
    visible, focused,
    focused' = false,
    visible' = visible,
    overflowing' = overflowing,
    atBottom' = atBottom,
  }

  action pointerScroll = all {
    visible, overflowing,
    atBottom' = true,
    visible' = visible,
    overflowing' = overflowing,
    focused' = focused,
  }

  action resizeToFit = all {
    visible,
    overflowing' = false,
    atBottom' = false,
    visible' = visible,
    focused' = focused,
  }

  action collapseOrAccountChange = all {
    visible,
    visible' = false,
    overflowing' = false,
    focused' = false,
    atBottom' = false,
  }

  action step = any {
    open, enlargeLongReport, focusReport, pageDown, home,
    tabAway, pointerScroll, resizeToFit, collapseOrAccountChange,
    all { visible' = visible, overflowing' = overflowing,
      focused' = focused, atBottom' = atBottom },
  }

  val invariant = all {
    focused implies visible,
    atBottom implies (visible and overflowing),
    not(visible) implies not(overflowing or focused or atBottom),
  }

  run keyboardReadsOverflowingReportTest = init.then(open)
    .then(enlargeLongReport).then(focusReport).then(pageDown)
    .expect(visible and focused and atBottom)
  run returnToStartTest = init.then(open).then(enlargeLongReport)
    .then(focusReport).then(pageDown).then(home).expect(not(atBottom))
  run blurPreservesScrollTest = init.then(open).then(enlargeLongReport)
    .then(focusReport).then(pageDown).then(tabAway)
    .expect(not(focused) and atBottom)
  run collapseClearsFocusTest = init.then(open).then(enlargeLongReport)
    .then(focusReport).then(pageDown).then(collapseOrAccountChange)
    .expect(not(visible or focused or atBottom))
}
