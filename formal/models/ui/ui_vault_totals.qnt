// @source src/EscrowFunding.tsx
// @source src/lib/use-public-resource.ts
// @evidence tests/e2e/funding-wallet-qa.spec.ts
// useVaultTotals and VaultTotalsView only: two projects, two nonempty values,
// an empty payload, two requests, and representative clock boundaries. HTTP,
// bounded body/JSON validation and request retirement are supplied outcomes;
// ui_resources and ui_bounded_body cover their separate contracts. Last-good
// retention is this caller's own state, independent of hook retention options.
// oldest supplies the parsed minimum observation time of the validated list;
// numeric amount formatting and timestamp parsing/minimum selection are delegated.
// Effects/callback delivery remain explicit: cleanup is not a render-time
// guarantee. No fairness or browser clock precision is assumed. Timers are
// one-shot; a hidden expiry does not itself install another timer. Stale data
// is still a captured observation, never a current balance/payment guarantee.
// New scenarios and browser definitions are source-only and unexecuted.
module ui_vault_totals {
  type State = { project: int, deployed: bool, phase: str, requestProject: int,
    requests: int, payloadProject: int, payload: int, lastProject: int, lastValue: int,
    now: int, oldest: int, staleMs: int, snapshotCount: int,
    timerActive: bool, listeners: bool, due: int, settledAt: int,
    visibility: str, retryRequested: bool, mounted: bool, effectsPending: bool }
  var s: State
  val times = Set(0, 59999, 60000, 61000, 1800000, 1801000, 2147483647)
  action init = s' = { project: 1, deployed: true, phase: "loading", requestProject: 1,
    requests: 1, payloadProject: 0, payload: -1, lastProject: 0, lastValue: -1,
    now: 0, oldest: 0, staleMs: 1800000, snapshotCount: 1,
    timerActive: false, listeners: false, due: 0, settledAt: 0,
    visibility: "visible", retryRequested: false, mounted: true, effectsPending: true }
  // payload -1 means absent, 0 is a successful empty list, 1/2 are distinct
  // nonempty validated lists. A ready result from another project is hidden
  // before the loader-change effect gets a chance to replace it.
  val display = if (not(s.deployed)) "none"
    else if (s.phase == "ready" and s.payloadProject != s.project) "loading"
    else if (s.phase == "ready") (if (s.payload == 0) "empty" else "value")
    else if (s.lastProject == s.project) (if (s.lastValue == 0) "empty" else "value")
    else if (s.phase == "error") "error" else "loading"
  val shownValue = if (display != "value") 0 else
    if (s.phase == "ready") s.payload else s.lastValue
  val refreshing = s.phase == "loading" and s.lastProject == s.project and s.deployed
  val errorVisible = s.phase == "error" and s.deployed
  pure def delay(stale: int, remaining: int): int = {
    val wanted = if (remaining > 0) remaining + 1000 else if (stale > 60000) stale else 60000
    if (wanted < 2147483647) wanted else 2147483647
  }
  action validReply(value: int): bool = all { s.mounted, s.phase == "loading", 0.to(2).contains(value),
    s' = s.with("phase", "ready").with("payloadProject", s.requestProject).with("payload", value)
      .with("snapshotCount", if (value == 0) 0 else if (s.snapshotCount == 0) 1 else s.snapshotCount)
      .with("effectsPending", true) }
  action invalidReply = all { s.mounted, s.phase == "loading", s' = s.with("phase", "error").with("effectsPending", true) }
  action rememberGood = all { s.phase == "ready", s' = s.with("lastProject", s.payloadProject).with("lastValue", s.payload) }
  action changeProject = all { s.project == 1, s' = s.with("project", 2).with("effectsPending", true) }
  action disable = all { s.deployed, s' = s.with("deployed", false).with("effectsPending", true) }
  action enable = all { not(s.deployed), s' = s.with("deployed", true).with("effectsPending", true) }
  action beginRefresh = all { s.mounted, s.deployed, s.requests < 2,
    s' = s.with("phase", "loading").with("requestProject", s.project)
      .with("requests", s.requests + 1).with("retryRequested", false).with("effectsPending", true) }
  action setAge(oldest: int, stale: int, count: int): bool = all {
    s.phase == "loading", Set(-1800000, 0, 60000).contains(oldest),
    Set(-1, 0, 60000, 1800000, 2147483647).contains(stale), 0.to(2).contains(count),
    s' = s.with("oldest", oldest).with("staleMs", stale).with("snapshotCount", count) }
  action advance(time: int): bool = all { times.contains(time), time >= s.now, s' = s.with("now", time) }
  action visibility(value: str): bool = all { Set("visible", "hidden", "prerender").contains(value),
    s' = s.with("visibility", value) }
  val maySchedule = s.mounted and s.deployed and s.phase != "loading"
    and not(s.phase == "ready" and s.payloadProject != s.project)
  action cleanup = all { s.effectsPending or not(s.mounted),
    s' = s.with("timerActive", false).with("listeners", false) }
  action skipSchedule = all { s.effectsPending, not(maySchedule),
    s' = s.with("timerActive", false).with("listeners", false).with("effectsPending", false) }
  action install = {
    val stale = if (s.phase == "ready") s.staleMs else 1800000
    val remaining = if (s.phase == "ready" and s.snapshotCount > 0) s.oldest + stale - s.now else 0
    all { s.effectsPending, maySchedule, s' = s.with("timerActive", true).with("listeners", true)
      .with("settledAt", s.now).with("due", s.now + delay(stale, remaining)).with("effectsPending", false) }
  }
  action fireTimer = all { s.timerActive, s.now >= s.due,
    s' = s.with("timerActive", false).with("retryRequested", s.retryRequested or s.visibility != "hidden") }
  action returnEvent = all { s.listeners,
    s' = s.with("retryRequested", s.retryRequested or (s.visibility == "visible" and s.now - s.settledAt >= 60000)) }
  action manualRetry = all { s.mounted, s.deployed, s' = s.with("retryRequested", true) }
  action depart = s' = s.with("mounted", false).with("effectsPending", true)
  action step = {
    nondet value = 0.to(2).oneOf() nondet time = times.oneOf()
    nondet oldest = Set(-1800000, 0, 60000).oneOf()
    nondet stale = Set(-1, 0, 60000, 1800000, 2147483647).oneOf()
    nondet visibilityState = Set("visible", "hidden", "prerender").oneOf()
    any { validReply(value), invalidReply, rememberGood, changeProject, disable, enable,
      beginRefresh, setAge(oldest, stale, value), advance(time), visibility(visibilityState),
      cleanup, skipSchedule, install, fireTimer, returnEvent, manualRetry, depart, s' = s }
  }
  val invariant = all { s.requests <= 2,
    display == "none" implies not(s.deployed),
    display == "value" implies shownValue > 0,
    display == "empty" implies shownValue == 0,
    s.phase == "ready" and s.payloadProject != s.project and s.deployed implies display == "loading",
    s.lastProject != s.project and s.phase == "error" and s.deployed implies display == "error",
    s.timerActive implies s.due > s.settledAt and s.due - s.settledAt <= 2147483647 }
  action firstGood = validReply(1).then(rememberGood)
  run initialLoadingNeverMeansZeroTest = init.expect(display == "loading" and shownValue == 0 and not(errorVisible) and invariant)
  run emptyReadIsDistinctFromLoadingTest = init.then(validReply(0)).expect(display == "empty" and not(errorVisible) and invariant)
  run initialFailureShowsNoValueTest = init.then(invalidReply).expect(display == "error" and shownValue == 0 and errorVisible and invariant)
  run refreshRetainsPreviousValueTest = init.then(firstGood).then(beginRefresh).expect(display == "value" and shownValue == 1 and refreshing and invariant)
  run refreshFailureKeepsValueAndErrorTest = init.then(firstGood).then(beginRefresh).then(invalidReply).expect(display == "value" and shownValue == 1 and errorVisible and not(refreshing) and invariant)
  run invalidPayloadCannotReplaceLastGoodTest = init.then(firstGood).then(beginRefresh).then(invalidReply).then(rememberGood.fail())
  run successfulEmptyRefreshReplacesPreviousValueTest = init.then(firstGood).then(beginRefresh).then(validReply(0)).then(rememberGood).expect(display == "empty" and s.lastValue == 0 and invariant)
  run emptyLastGoodKeepsFailureVisibleTest = init.then(validReply(0)).then(rememberGood).then(beginRefresh).then(invalidReply).expect(display == "empty" and errorVisible and invariant)
  run otherProjectReadyPayloadHiddenBeforeEffectTest = init.then(firstGood).then(changeProject).expect(display == "loading" and shownValue == 0 and invariant)
  run otherProjectLastGoodCannotHideErrorTest = init.then(firstGood).then(changeProject).then(beginRefresh).then(invalidReply).expect(display == "error" and shownValue == 0 and invariant)
  run currentProjectGoodReplyReplacesPriorProjectTest = init.then(firstGood).then(changeProject).then(beginRefresh).then(validReply(2)).then(rememberGood).expect(display == "value" and shownValue == 2 and s.lastProject == 2 and invariant)
  run undeployedSuppressesRetainedDataTest = init.then(firstGood).then(disable).expect(display == "none" and invariant)
  run freshSnapshotTimerHasOneSecondMarginTest = init.then(firstGood).then(install).expect(s.due == 1801000 and invariant)
  run emptySnapshotUsesStaleWindowTest = init.then(validReply(0)).then(install).expect(s.due == 1800000 and invariant)
  run staleSnapshotUsesFullRetryWindowTest = init.then(setAge(-1800000, 1800000, 1)).then(firstGood).then(install).expect(s.due == 1800000 and invariant)
  run nonpositiveServerWindowStillWaitsOneMinuteTest = init.then(setAge(0, -1, 1)).then(firstGood).then(install).expect(s.due == 60000 and invariant)
  run hugeTimerIsClampedTest = init.then(setAge(60000, 2147483647, 1)).then(firstGood).then(install).expect(s.due == 2147483647 and invariant)
  run returnBeforeCacheWindowDoesNotRetryTest = init.then(firstGood).then(install).then(advance(59999)).then(returnEvent).expect(not(s.retryRequested) and invariant)
  run returnAtCacheWindowRequestsRetryTest = init.then(firstGood).then(install).then(advance(60000)).then(returnEvent).expect(s.retryRequested and invariant)
  run hiddenTimerExpiresWithoutRetryOrRearmTest = init.then(setAge(-1800000, 60000, 1)).then(firstGood).then(install).then(visibility("hidden")).then(advance(60000)).then(fireTimer).expect(not(s.retryRequested) and not(s.timerActive) and s.listeners and invariant)
  run visibleReturnAfterHiddenExpiryRetriesTest = init.then(setAge(-1800000, 60000, 1)).then(firstGood).then(install).then(visibility("hidden")).then(advance(60000)).then(fireTimer).then(visibility("visible")).then(returnEvent).expect(s.retryRequested and invariant)
  run visibilityMustBeVisibleForReturnRetryTest = init.then(firstGood).then(install).then(visibility("prerender")).then(advance(60000)).then(returnEvent).expect(not(s.retryRequested) and invariant)
  run timerOnlyRejectsHiddenVisibilityTest = init.then(setAge(-1800000, 60000, 1)).then(firstGood).then(install).then(visibility("prerender")).then(advance(60000)).then(fireTimer).expect(s.retryRequested and invariant)
  run cleanupRemovesTimerAndReturnListenerTest = init.then(firstGood).then(install).then(depart).then(cleanup).then(advance(2147483647)).expect(not(s.timerActive) and not(s.listeners) and invariant)
  run errorRetryTimerUsesDefaultWindowTest = init.then(invalidReply).then(install).expect(s.due == 1800000 and invariant)
  run mismatchedProjectDoesNotInstallTimerTest = init.then(firstGood).then(changeProject).then(install.fail())
  run unchangedObservationDoesNotRearmTimerTest = init.then(firstGood).then(install).then(advance(60000)).then(install.fail())
}
