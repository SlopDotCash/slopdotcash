// @source scripts/inspect-value-intake-history.ts
// @evidence scripts/inspect-value-intake-history.test.ts
// Bounded lifecycle abstraction, not a mechanical refinement of the API/parser.
module intake_history_projection {
  var s: { phase: str, authorized: bool, calls: int, dry: bool,
    shape: bool, stable: bool, truncated: bool, outputRows: int, raw: bool }
  action init = s' = { phase: "start", authorized: false, calls: 0, dry: true,
    shape: false, stable: false, truncated: false, outputRows: 0, raw: false }
  action admit(valid) = all { s.phase == "start", s' = s.with("authorized", valid)
    .with("phase", if (valid) "metadata" else "refused") }
  action metadata(ok) = all { s.phase == "metadata", s.authorized,
    s' = s.with("calls", 1).with("phase", if (ok) "query" else "refused") }
  action query(ok, bounded, complete) = all { s.phase == "query", s.authorized, s.dry,
    s' = s.with("calls", 2).with("shape", ok and bounded).with("truncated", not(complete))
      .with("phase", if (ok and bounded) "recheck" else "refused") }
  action recheck(stable) = all { s.phase == "recheck", s.shape,
    s' = s.with("calls", 3).with("stable", stable)
      .with("phase", if (stable and not(s.truncated)) "complete" else "refused")
      .with("outputRows", if (stable) 2 else 0) }
  action step = {
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf()
    any { admit(a), metadata(a), query(a, b, c), recheck(a) }
  }
  val invariant = all { not(s.raw), s.dry, s.calls >= 0 and s.calls <= 3,
    s.calls > 0 implies s.authorized,
    s.outputRows >= 0 and s.outputRows <= 200,
    s.outputRows > 0 implies s.shape and s.stable,
    s.phase == "complete" implies s.authorized and s.shape and s.stable and not(s.truncated) }
  run invalidWindowHasNoCallsTest = init.then(admit(false)).expect(s.calls == 0 and s.outputRows == 0)
  run refusedQueryKeepsNoRowsTest = init.then(admit(true)).then(metadata(true)).then(query(false, true, true))
    .expect(s.outputRows == 0 and s.phase == "refused")
  run changedDeploymentKeepsNoRowsTest = init.then(admit(true)).then(metadata(true)).then(query(true, true, true))
    .then(recheck(false)).expect(s.outputRows == 0 and s.phase == "refused")
  run boundedStableProjectionTest = init.then(admit(true)).then(metadata(true)).then(query(true, true, true))
    .then(recheck(true)).expect(s.phase == "complete" and s.calls == 3 and not(s.raw))
  run truncatedQueryNotCompleteTest = init.then(admit(true)).then(metadata(true)).then(query(true, true, false))
    .then(recheck(true)).expect(s.phase == "refused")
}
