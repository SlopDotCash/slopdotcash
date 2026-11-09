// @source scripts/check-referral-roots.ts
// @source workers/referral-accrual/config.ts
// @evidence scripts/check-referral-roots.test.ts
// One-shot CLI, not a watch loop. Four deployment facts absent with literal
// off/default mode bypass parseConfig and produce inactive, not qualification.
// Otherwise public configuration is parsed under local live/true overrides;
// no environment flag, key, transaction, accrual or root is changed.
// Output and summary append may fail after an earlier result was printed.
// Error category is fixed locally; the raw provider error is never printed.
module referral_watch_cli {
  type State = { phase: str, fileValid: bool, inactive: bool, configValid: bool,
    observation: str, summary: bool, result: str, printed: str, errorPrinted: str,
    summaryText: str, exitCode: int, uncaught: bool, activated: bool }
  var s: State
  action init = s' = { phase: "input", fileValid: true, inactive: false,
    configValid: true, observation: "verified", summary: false, result: "none",
    printed: "none", errorPrinted: "none", summaryText: "none", exitCode: 0,
    uncaught: false, activated: false }
  action configure(fileValid: bool, inactive: bool, configValid: bool, observation: str, summary: bool): bool = all {
    s.phase == "input", Set("verified", "pending", "category-error", "provider-error").contains(observation),
    s' = s.with("fileValid", fileValid).with("inactive", inactive).with("configValid", configValid)
      .with("observation", observation).with("summary", summary) }
  action load = all { s.phase == "input", s' =
    if (not(s.fileValid)) s.with("phase", "catch").with("result", "unavailable")
    else if (s.inactive) s.with("phase", "print").with("result", "inactive")
    else if (not(s.configValid)) s.with("phase", "catch").with("result", "unavailable")
    else s.with("phase", "observe") }
  action observe = all { s.phase == "observe", s' =
    if (s.observation == "category-error") s.with("phase", "catch").with("result", "fixed-category")
    else if (s.observation == "provider-error") s.with("phase", "catch").with("result", "unavailable")
    else s.with("phase", "print").with("result", s.observation) }
  action printResult = all { s.phase == "print", s' = s.with("printed", s.result)
    .with("phase", if (s.summary) "summary" else "done") }
  action printFailure = all { s.phase == "print", s' = s.with("phase", "catch").with("result", "unavailable") }
  action appendSummary(ok: bool): bool = all { s.phase == "summary", s' =
    if (ok) s.with("summaryText", s.result).with("phase", "done")
    else s.with("phase", "catch").with("result", "unavailable") }
  action catchError = all { s.phase == "catch", s' = s.with("errorPrinted", s.result)
    .with("phase", if (s.summary) "error-summary" else "set-exit") }
  action appendError(ok: bool): bool = all { s.phase == "error-summary", s' =
    if (ok) s.with("summaryText", s.result).with("phase", "set-exit")
    else s.with("uncaught", true).with("phase", "host-exit") }
  action setExit = all { s.phase == "set-exit", s' = s.with("exitCode", 1).with("phase", "done") }
  // Uncaught append failure occurs before explicit exitCode=1. Nonzero process
  // termination is the host's responsibility, not a successful summary write.
  action hostExit = all { s.phase == "host-exit", s' = s.with("exitCode", 1).with("phase", "done") }
  action step = {
    nondet observation = Set("verified", "pending", "category-error", "provider-error").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { configure(true, yes, true, observation, yes), load, observe, printResult,
      printFailure, appendSummary(yes), catchError, appendError(yes), setExit, hostExit, s' = s }
  }
  val invariant = all { not(s.activated),
    Set("none", "inactive", "pending", "verified").contains(s.printed),
    Set("none", "fixed-category", "unavailable").contains(s.errorPrinted),
    s.phase == "done" and s.errorPrinted != "none" implies s.exitCode == 1,
    s.printed == "inactive" implies s.inactive }
  run inactiveDoesNotQualifyOrActivateTest = init.then(configure(true, true, false, "provider-error", false)).then(load).then(printResult).expect(s.printed == "inactive" and s.exitCode == 0 and invariant)
  run configuredOffStillObservesWithoutActivationTest = init.then(load).then(observe).then(printResult).expect(s.printed == "verified" and invariant)
  run pendingReportExitsSuccessfullyTest = init.then(configure(true, false, true, "pending", false)).then(load).then(observe).then(printResult).expect(s.printed == "pending" and s.exitCode == 0 and invariant)
  run configurationReadFailureIsSanitizedTest = init.then(configure(false, false, true, "verified", false)).then(load).then(catchError).then(setExit).expect(s.errorPrinted == "unavailable" and invariant)
  run malformedConfigDoesNotObserveTest = init.then(configure(true, false, false, "verified", false)).then(load).then(catchError).then(setExit).expect(s.printed == "none" and invariant)
  run providerDetailNotPrintedTest = init.then(configure(true, false, true, "provider-error", false)).then(load).then(observe).then(catchError).then(setExit).expect(s.errorPrinted == "unavailable" and invariant)
  run localCategoryPreservedTest = init.then(configure(true, false, true, "category-error", false)).then(load).then(observe).then(catchError).then(setExit).expect(s.errorPrinted == "fixed-category" and invariant)
  run summaryRecordedAfterResultTest = init.then(configure(true, false, true, "verified", true)).then(load).then(observe).then(printResult).then(appendSummary(true)).expect(s.summaryText == "verified" and invariant)
  run summaryFailureKeepsEarlierPrintedResultTest = init.then(configure(true, false, true, "verified", true)).then(load).then(observe).then(printResult).then(appendSummary(false)).then(catchError).then(appendError(true)).then(setExit).expect(s.printed == "verified" and s.errorPrinted == "unavailable" and s.exitCode == 1 and invariant)
  run failedErrorSummaryCanPrecedeExplicitExitCodeTest = init.then(configure(false, false, true, "verified", true)).then(load).then(catchError).then(appendError(false)).expect(s.uncaught and s.exitCode == 0 and invariant).then(hostExit).expect(s.exitCode == 1 and invariant)
  run outputFailureDoesNotImplyReportedSuccessTest = init.then(load).then(observe).then(printFailure).then(catchError).then(setExit).expect(s.printed == "none" and s.exitCode == 1 and invariant)
}
