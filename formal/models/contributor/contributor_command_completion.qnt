// @source skills/project-contributor-template/scripts/live-report.mjs
// @evidence scripts/contributor-discovery-lifetime.test.ts
// @evidence scripts/contributor-discovery-startup.test.ts
// One helper result, request cleanup and outer report release. Error identities
// are finite representatives; arbitrary text, OS failures and stdout are external.
module contributor_command_completion {
  var s: { phase: str, command: str, primary: int, outputRetained: bool,
    requestCleanupFailed: bool, releaseFailed: bool, reportPublished: bool, result: str }
  action init = s' = { phase: "running", command: "pending", primary: 0,
    outputRetained: false, requestCleanupFailed: false, releaseFailed: false, reportPublished: false,
    result: "pending" }
  action command(outcome: str): bool = all {
    s.phase == "running", Set("success", "nonzero", "throw").contains(outcome),
    s' = s.with("phase", "cleanup").with("command", outcome)
      .with("primary", if (outcome == "success") 0 else 1)
      .with("outputRetained", outcome == "nonzero") }
  action cleanupRequest(fails: bool): bool = all { s.phase == "cleanup",
    s' = s.with("phase", "classify").with("requestCleanupFailed", fails)
      .with("primary", if (fails and s.primary == 0) 2 else s.primary) }
  // A nonzero helper result is delivered to the report's normal failure handler.
  action classify = all { s.phase == "classify",
    s' = s.with("phase", "release").with("reportPublished", s.primary == 0) }
  action release(fails: bool): bool = all { s.phase == "release",
    s' = s.with("phase", "done").with("releaseFailed", fails)
      .with("primary", if (fails and s.primary == 0) 3 else s.primary)
      .with("result", if (s.primary != 0 or fails) "failure" else "success") }
  action step = {
    nondet outcome = Set("success", "nonzero", "throw").oneOf()
    nondet fails = Set(false, true).oneOf()
    any { command(outcome), cleanupRequest(fails), classify, release(fails), s' = s }
  }
  val invariant = all {
    Set("nonzero", "throw").contains(s.command) implies s.primary == 1,
    s.command == "nonzero" implies s.outputRetained,
    s.result == "success" implies all { s.command == "success",
      not(s.requestCleanupFailed), not(s.releaseFailed), s.primary == 0, s.reportPublished },
    s.reportPublished implies s.command == "success" and not(s.requestCleanupFailed),
    s.phase == "done" and s.result == "failure" implies s.primary != 0 }
  run cleanSuccessTest = init.then(command("success")).then(cleanupRequest(false))
    .then(classify).then(release(false)).expect(s.result == "success")
  run nonzeroCommandSurvivesRequestCleanupTest = init.then(command("nonzero"))
    .then(cleanupRequest(true)).then(classify).then(release(false))
    .expect(s.primary == 1 and s.outputRetained and s.result == "failure")
  run thrownCommandSurvivesRequestCleanupTest = init.then(command("throw"))
    .then(cleanupRequest(true)).then(classify).then(release(false)).expect(s.primary == 1)
  run primaryDiscoveryErrorSurvivesReleaseTest = init.then(command("nonzero"))
    .then(cleanupRequest(false)).then(classify).then(release(true)).expect(s.primary == 1)
  run bothCleanupsPreserveCommandFailureTest = init.then(command("nonzero"))
    .then(cleanupRequest(true)).then(classify).then(release(true))
    .expect(s.primary == 1 and s.outputRetained)
  run successfulCommandFailsOnRequestCleanupTest = init.then(command("success"))
    .then(cleanupRequest(true)).then(classify).then(release(false))
    .expect(s.primary == 2 and s.result == "failure")
  run successfulReportFailsOnReleaseTest = init.then(command("success"))
    .then(cleanupRequest(false)).then(classify).then(release(true))
    .expect(s.primary == 3 and s.result == "failure" and s.reportPublished)
  run earlierCleanupErrorSurvivesReleaseTest = init.then(command("success"))
    .then(cleanupRequest(true)).then(classify).then(release(true)).expect(s.primary == 2)
}
