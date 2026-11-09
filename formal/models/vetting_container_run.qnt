// @source workers/vetting/bounded-scan.ts
// The container-run rule reports a finding only when a container engine is
// invoked to run, inside a file the install lifecycle executes. `engine` is
// the invocation spelling, `runs` says the subcommand is `run`, `installs`
// says the file is an install surface. A flag between the engine and `run`
// keeps both conditions.
module vetting_container_run {
  var s: { engine: bool, runs: bool, installs: bool, finding: bool,
    scanned: int }
  action init = s' = { engine: false, runs: false, installs: false,
    finding: false, scanned: 0 }
  // One action covers both outcomes so removing a condition moves the state
  // instead of only disabling the step.
  action scan(engine, runs, installs) =
    s' = s.with("engine", engine).with("runs", runs).with("installs", installs)
      .with("scanned", s.scanned + 1)
      .with("finding", engine and runs and installs)
  action step = {
    nondet engine = Set(false, true).oneOf()
    nondet runs = Set(false, true).oneOf()
    nondet installs = Set(false, true).oneOf()
    scan(engine, runs, installs)
  }
  // Written from the inputs the scan recorded, not from the guard expression.
  val invariant = all {
    s.finding implies (s.engine and s.runs and s.installs),
    s.scanned >= 0,
  }
  run dockerRunInInstallTest = init.then(scan(true, true, true))
    .expect(s.finding and s.scanned == 1)
  run dockerPsIsNotARunTest = init.then(scan(true, false, true))
    .expect(not(s.finding))
  run dockerRunOutsideInstallTest = init.then(scan(true, true, false))
    .expect(not(s.finding))
  run composeUpIsNotRunTest = init.then(scan(true, false, true))
    .expect(not(s.finding) and s.scanned == 1)
}
