// @source scripts/evidence-bundle.mjs
// @source scripts/evidence-contract.mjs
// @source scripts/record-evidence.mjs
// @source scripts/run-e2e.mjs
// @source scripts/run-e2e-phase.mjs
// A validated complete bundle is published only after clean browser checks.
// Caught rename errors restore the previous directory; process death between
// two directory renames is an explicit gap, not an atomicity claim.
module evidence_capture {
  var s: { phase: str, buildBound: bool, browserClean: bool,
    complete: bool, current: int, previous: int, backup: bool }
  action init = s' = { phase: "new", buildBound: false, browserClean: false,
    complete: false, current: 1, previous: 1, backup: false }
  action stage = all { s.phase == "new", s' = s.with("phase", "staging") }
  action capture(clean) = all { s.phase == "staging",
    s' = s.with("phase", "captured").with("browserClean", clean).with("buildBound", true) }
  action validate = all { s.phase == "captured", s.browserClean, s.buildBound,
    s' = s.with("phase", "validated").with("complete", true) }
  action movePrevious = all { s.phase == "validated", s.complete,
    s' = s.with("phase", "swapping").with("backup", true).with("current", 0) }
  action publish = all { s.phase == "swapping", s.complete,
    s' = s.with("phase", "published").with("current", 2).with("backup", false) }
  action restoreOnError = all { s.phase == "swapping", s.backup,
    s' = s.with("phase", "failed").with("current", s.previous).with("backup", false) }
  action crashBetweenRenames = all { s.phase == "swapping", s' = s.with("phase", "interrupted") }
  action abort = all { s.phase.in(Set("staging", "captured", "validated")), s' = s.with("phase", "aborted") }
  action step = {
    nondet clean = Set(false, true).oneOf()
    any { stage, capture(clean), validate, movePrevious, publish, restoreOnError, crashBetweenRenames, abort }
  }
  val invariant = all {
    s.current == 2 implies (s.complete and s.buildBound and s.browserClean),
    s.current == 0 implies s.backup,
    s.phase == "aborted" implies s.current == 1,
  }
  run cleanCaptureTest = init.then(stage).then(capture(true)).then(validate).then(movePrevious).then(publish)
    .expect(s.current == 2)
  run failedSwapRestoresTest = init.then(stage).then(capture(true)).then(validate).then(movePrevious).then(restoreOnError)
    .expect(s.current == 1)
  run interruptedSwapIsExplicitTest = init.then(stage).then(capture(true)).then(validate).then(movePrevious).then(crashBetweenRenames)
    .expect(s.current == 0 and s.backup)
}
