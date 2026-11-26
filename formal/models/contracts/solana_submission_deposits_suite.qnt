// @source contracts/solana/scripts/test-submission-deposits.sh
// @source contracts/solana/integration/submission-deposits-preload.mjs
// @source contracts/solana/integration/submission-deposits.mjs
// @conformance contracts/solana/test-program.test.ts
// One run of the submission deposit suites. The program under test is prepared once
// (the retained artifact in CI, a local build otherwise), its IDL must equal the
// committed one, and the host unit tests must pass before any validator starts.
// Then two validators run one after the other, never together, because the reclaim
// delay is fixed once per deployment: stage 1 (rehearsal) is initialized with the
// thirty-day delay and is the only one loaded with the aged deposits and the mint at
// the USDC address; stage 2 runs the lifecycle suite and then, only if that passed,
// the invariant campaign, which relies on the roles the lifecycle suite leaves.
// A failure ends the run after the current validator is stopped, and the first
// failure is the exit status. solana_container_lifecycle owns the container, its
// receipt and its ports; here a validator is only starting, ready or stopped.
// The helpers sign with fixture keys only against a loopback endpoint.
// Not modeled: the host validator choice (it changes how readiness is observed, not
// the order), interruption signals, and what each suite asserts.
module solana_submission_deposits_suite {
  type S = { phase: str, prepared: str, idlMatches: bool, stage: int, validator: str,
    aged: Set[int], started: int, passed: Set[str], loopback: bool, exitCode: int, failure: int }
  var s: S
  action initial(loopback: bool): bool = s' = { phase: "prepare", prepared: "none", idlMatches: false,
    stage: 0, validator: "none", aged: Set(), started: 0, passed: Set(), loopback: loopback,
    exitCode: -1, failure: 0 }
  action init = { nondet loopback = oneOf(Set(true, false)) initial(loopback) }

  def failed(code: int): S = if (s.failure == 0) s.with("failure", code) else s

  // The artifact is refused unless it is this source's build; a local build may fail.
  action prepare(source: str, ok: bool): bool = all { s.phase == "prepare",
    Set("artifact", "local").contains(source),
    s' = if (ok) s.with("phase", "idl").with("prepared", source)
      else failed(2).with("phase", "done").with("exitCode", 2) }
  action compareIdl(matches: bool): bool = all { s.phase == "idl",
    s' = if (matches) s.with("phase", "unit").with("idlMatches", true)
      else failed(3).with("phase", "done").with("exitCode", 3) }
  action unitTests(ok: bool): bool = all { s.phase == "unit",
    s' = if (ok) s.with("phase", "idle") else failed(4).with("phase", "done").with("exitCode", 4) }

  // A stage starts only when no validator is running. Its genesis accounts are the
  // program and, for the rehearsal alone, the aged fixtures.
  action start(ready: bool): bool = all { s.phase == "idle", s.validator == "none", s.stage < 2,
    s' = (if (ready) s else failed(5)).with("stage", s.stage + 1).with("started", s.started + 1)
      .with("validator", if (ready) "ready" else "starting")
      .with("phase", if (ready) "testing" else "stopping")
      .with("aged", if (s.stage == 0) s.aged.union(Set(1)) else s.aged) }

  // A suite signs only against a loopback endpoint; anywhere else it refuses to start.
  action suite(name: str, ok: bool): bool = all { s.phase == "testing", s.validator == "ready",
    (s.stage == 1 and name == "rehearsal") or (s.stage == 2 and name == "lifecycle" and not(s.passed.contains("lifecycle")))
      or (s.stage == 2 and name == "campaign" and s.passed.contains("lifecycle")),
    s' = if (ok and s.loopback) {
        val counted = s.with("passed", s.passed.union(Set(name)))
        if (name == "lifecycle") counted else counted.with("phase", "stopping")
      } else failed(6).with("phase", "stopping") }

  action stop(confirmed: bool): bool = all { s.phase == "stopping", s.validator != "none",
    s' = (if (confirmed) s else failed(1)).with("validator", "none")
      .with("phase", if (s.failure != 0 or not(confirmed) or s.stage == 2) "done" else "idle")
      .with("exitCode", if (s.failure != 0) s.failure else if (not(confirmed)) 1 else if (s.stage == 2) 0 else -1) }

  action step = {
    nondet flag = oneOf(Set(true, false))
    nondet source = oneOf(Set("artifact", "local"))
    nondet name = oneOf(Set("rehearsal", "lifecycle", "campaign"))
    any { prepare(source, flag), compareIdl(flag), unitTests(flag), start(flag), suite(name, flag), stop(flag), s' = s }
  }

  val invariant = all {
    s.stage >= 0 and s.stage <= 2, s.started == s.stage,
    // No validator before the program, its IDL and its unit tests are in order.
    s.validator != "none" implies (s.prepared != "none" and s.idlMatches),
    // Only the rehearsal stage is loaded with the aged fixtures.
    s.aged.subseteq(Set(1)),
    // Each suite ran on its own stage, and the campaign only after the lifecycle suite.
    s.passed.contains("campaign") implies s.passed.contains("lifecycle"),
    s.passed.contains("lifecycle") implies (s.passed.contains("rehearsal") and s.stage == 2),
    // Nothing passes against an endpoint that is not loopback.
    not(s.loopback) implies s.passed == Set(),
    // The run ends with no validator left, and succeeds only when every suite passed.
    s.phase == "done" implies (s.validator == "none" and s.exitCode >= 0),
    s.exitCode == 0 implies (s.passed == Set("rehearsal", "lifecycle", "campaign") and s.failure == 0),
    s.phase != "done" implies s.exitCode == -1 }

  run local = initial(true).then(prepare("local", true)).then(compareIdl(true)).then(unitTests(true))
  run rehearsed = local.then(start(true)).then(suite("rehearsal", true)).then(stop(true))
  run completeRunTest = rehearsed.then(start(true)).then(suite("lifecycle", true)).then(suite("campaign", true))
    .then(stop(true)).expect(s.phase == "done" and s.exitCode == 0 and s.aged == Set(1) and invariant)
  run artifactRunTest = initial(true).then(prepare("artifact", true)).then(compareIdl(true)).then(unitTests(true))
    .then(start(true)).then(suite("rehearsal", true)).then(stop(true)).expect(s.phase == "idle" and s.prepared == "artifact")
  run refusedArtifactStartsNothingTest = initial(true).then(prepare("artifact", false))
    .expect(s.phase == "done" and s.exitCode == 2 and s.started == 0).then(start(true).fail())
  run staleIdlStartsNothingTest = initial(true).then(prepare("local", true)).then(compareIdl(false))
    .expect(s.exitCode == 3 and s.started == 0)
  run failedUnitTestsStartNothingTest = initial(true).then(prepare("local", true)).then(compareIdl(true)).then(unitTests(false))
    .expect(s.exitCode == 4 and s.started == 0)
  run secondValidatorWaitsForTheFirstTest = local.then(start(true)).then(start(true).fail())
  run campaignNeedsTheLifecycleSuiteTest = rehearsed.then(start(true)).then(suite("campaign", true).fail())
  run lifecycleNeverRunsOnTheRehearsalStageTest = local.then(start(true)).then(suite("lifecycle", true).fail())
  run campaignNeverRunsOnTheRehearsalStageTest = local.then(start(true)).then(suite("campaign", true).fail())
  run failedRehearsalEndsTheRunAfterCleanupTest = local.then(start(true)).then(suite("rehearsal", false))
    .expect(s.phase == "stopping").then(stop(true)).expect(s.phase == "done" and s.exitCode == 6 and s.stage == 1)
  run failedLifecycleSkipsTheCampaignTest = rehearsed.then(start(true)).then(suite("lifecycle", false))
    .then(suite("campaign", true).fail())
  run failedLifecycleIsTheExitStatusTest = rehearsed.then(start(true)).then(suite("lifecycle", false))
    .then(stop(true)).expect(s.exitCode == 6 and not(s.passed.contains("campaign")))
  run validatorThatNeverBecomesReadyRunsNothingTest = local.then(start(false)).then(suite("rehearsal", true).fail())
  run validatorThatNeverBecomesReadyFailsTest = local.then(start(false))
    .then(stop(true)).expect(s.phase == "done" and s.exitCode == 5)
  run unconfirmedStopFailsAPassedRunTest = rehearsed.then(start(true)).then(suite("lifecycle", true))
    .then(suite("campaign", true)).then(stop(false)).expect(s.phase == "done" and s.exitCode == 1)
  run firstFailureIsTheExitStatusTest = local.then(start(true)).then(suite("rehearsal", false)).then(stop(false))
    .expect(s.exitCode == 6)
  run remoteEndpointPassesNothingTest = initial(false).then(prepare("local", true)).then(compareIdl(true))
    .then(unitTests(true)).then(start(true)).then(suite("rehearsal", true)).expect(s.passed == Set() and s.failure == 6)
}
