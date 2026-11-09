// @source scripts/generate-jupiter-decoder.mjs
// @source scripts/check-lemmascript.mjs
// @evidence docs/lemmascript-jupiter-research.md
// Three output classes and two input epochs bound partial writes and drift.
// This models command/control behavior, not generator or compiler correctness.
// baselinePresent means readable emission shape, not fresh compiler output.
// Regeneration/body matching and theorem results are separate gate observations.
// The temporary semantics file is grouped with proof output. Writes are
// sequential with no atomic multi-file commit or rollback: a failure may leave
// earlier outputs written and the current one invalid, and only another
// generation/synchronization can clear it. Input drift after capture blocks
// final acceptance in the hash-bound gate even when local outputs agree.
module jupiter_generation {
  type S = { phase: str, mode: str, epoch: int, captured: int,
    source: int, native: int, proof: int, baselinePresent: bool,
    checkPassed: bool, verified: bool }
  var s: S
  action init = s' = { phase: "new", mode: "check", epoch: 1, captured: 0,
    source: 0, native: 0, proof: 0, baselinePresent: false,
    checkPassed: false, verified: false }
  action capture(mode: str): bool = all { s.phase == "new",
    s' = s.with("mode", mode).with("phase", "rendered").with("captured", s.epoch) }
  action invalidSchemaOrFormat = all { s.phase == "new",
    s' = s.with("phase", "failed") }
  action drift = all { s.epoch == 1, not(s.verified), s' = s.with("epoch", 2) }
  action writeSource = all { s.phase == "rendered", s.mode == "write",
    s' = s.with("source", s.captured).with("phase", "source-written") }
  action writeNative = all { s.phase == "source-written", s.mode == "write",
    s' = s.with("native", s.captured).with("phase", "native-written") }
  action finishWrite(hasProof: bool): bool = all { s.phase == "native-written", s.mode == "write",
    // --write may update existing semantics but does not run the compiler.
    s' = s.with("phase", "done").with("proof", if (hasProof) s.captured else s.proof) }
  action partialWriteFailure = all { s.mode == "write",
    Set("rendered", "source-written", "native-written").contains(s.phase),
    s' = s.with("phase", "failed")
      .with("source", if (s.phase == "rendered") 0 else s.source)
      .with("native", if (s.phase == "source-written") 0 else s.native)
      .with("proof", if (s.phase == "native-written") 0 else s.proof) }
  action nextCommand = all { Set("done", "failed", "checked").contains(s.phase),
    s' = s.with("phase", "new").with("checkPassed", false).with("verified", false) }
  action compileBaseline = all { s.phase == "new",
    s.source == s.epoch, s.native == s.epoch, s' = s.with("baselinePresent", true) }
  action syncProof = all { s.phase == "rendered", s.mode == "sync",
    s.source == s.captured, s.native == s.captured, s.baselinePresent,
    s' = s.with("proof", s.captured).with("phase", "done") }
  action syncWriteFailure = all { s.phase == "rendered", s.mode == "sync",
    s.source == s.captured, s.native == s.captured, s.baselinePresent,
    s' = s.with("proof", 0).with("phase", "failed") }
  action refuseStale = all { s.phase == "rendered", s.mode != "write",
    s.source != s.captured or s.native != s.captured or not(s.baselinePresent) or
      (s.mode == "check" and s.proof != s.captured),
    s' = s.with("phase", "failed") }
  action check = all { s.phase == "rendered", s.mode == "check",
    s.source == s.captured, s.native == s.captured, s.proof == s.captured, s.baselinePresent,
    s' = s.with("checkPassed", true).with("phase", "checked") }
  action acceptProof(theoremPassed: bool, bodyMatches: bool): bool = all {
    s.phase == "checked", s.checkPassed, s.epoch == s.captured,
    theoremPassed, bodyMatches, s' = s.with("verified", true) }
  action step = { nondet mode = Set("write", "sync", "check").oneOf()
    nondet theoremPassed = Set(false, true).oneOf()
    nondet bodyMatches = Set(false, true).oneOf()
    any { capture(mode), invalidSchemaOrFormat, drift, writeSource, writeNative,
      finishWrite(theoremPassed), partialWriteFailure, nextCommand, compileBaseline, syncProof,
      syncWriteFailure, refuseStale, check, acceptProof(theoremPassed, bodyMatches), s' = s } }
  val invariant = all {
    s.checkPassed implies s.phase == "checked" and s.source == s.captured and
      s.native == s.captured and s.proof == s.captured and s.baselinePresent,
    s.verified implies s.epoch == s.captured and s.checkPassed,
    s.phase == "source-written" implies s.mode == "write" and not(s.checkPassed),
    s.phase == "native-written" implies s.mode == "write" and not(s.checkPassed),
  }
  run partialWriteIsNotProofTest = init.then(capture("write")).then(writeSource)
    .then(partialWriteFailure).expect(s.source == 1 and s.native == 0 and not(s.verified))
  run repeatedWriteFailureInvalidatesTest = init.then(capture("write"))
    .then(writeSource).then(writeNative).then(finishWrite(true)).then(nextCommand)
    .then(capture("write")).then(writeSource).then(partialWriteFailure)
    .expect(s.source == 1 and s.native == 0 and not(s.verified))
  run writeDoesNotCreateProofTest = init.then(capture("write")).then(writeSource)
    .then(writeNative).then(finishWrite(false)).expect(s.proof == 0 and not(s.verified))
  run invalidSchemaWritesNothingTest = init.then(invalidSchemaOrFormat)
    .expect(s.source == 0 and s.native == 0 and s.proof == 0)
  run staleSourceRefusesSyncTest = init.then(capture("write")).then(writeSource)
    .then(writeNative).then(finishWrite(true)).then(nextCommand).then(drift)
    .then(capture("sync")).then(refuseStale).expect(not(s.verified))
  run missingCompilerBaselineRefusesTest = init.then(capture("write")).then(writeSource)
    .then(writeNative).then(finishWrite(true)).then(nextCommand).then(capture("sync"))
    .then(refuseStale).expect(not(s.verified))
  run syncedProofIsNotTheoremTest = init.then(capture("write")).then(writeSource)
    .then(writeNative).then(finishWrite(true)).then(nextCommand).then(compileBaseline)
    .then(capture("sync")).then(syncProof).expect(not(s.verified))
  run checkedGenerationIsNotTheoremTest = init.then(capture("write")).then(writeSource)
    .then(writeNative).then(finishWrite(true)).then(nextCommand).then(compileBaseline)
    .then(capture("check")).then(check).expect(s.checkPassed and not(s.verified))
  run changedInputCannotCertifyTest = init.then(capture("write")).then(writeSource)
    .then(writeNative).then(finishWrite(true)).then(nextCommand).then(compileBaseline)
    .then(capture("check")).then(drift).then(check)
    .expect(not(s.verified)).then(acceptProof(true, true).fail())
  run failedTheoremCannotCertifyTest = init.then(capture("write")).then(writeSource)
    .then(writeNative).then(finishWrite(true)).then(nextCommand).then(compileBaseline)
    .then(capture("check")).then(check).expect(not(s.verified))
    .then(acceptProof(false, true).fail())
  run staleBaselineCannotCertifyTest = init.then(capture("write")).then(writeSource)
    .then(writeNative).then(finishWrite(true)).then(nextCommand).then(compileBaseline)
    .then(capture("check")).then(check).expect(s.baselinePresent and not(s.verified))
    .then(acceptProof(true, false).fail())
}
