// @source workers/vetting/bounded-scan.ts
// The download-staging rule links a download to the run that consumes the
// file. A destination held in a variable still links when the same variable
// is assigned a path in the script and is used bare, braced (`${OUT}`) or
// prefixed (`./$OUT`). `download` is the transfer, `bound` says the variable
// was assigned in the script, `same` says the run uses that variable,
// `installs` says the lifecycle runs the script.
module vetting_variable_destination {
  var s: { download: bool, bound: bool, same: bool, installs: bool,
    finding: bool, scanned: int }
  action init = s' = { download: false, bound: false, same: false,
    installs: false, finding: false, scanned: 0 }
  action scan(download, bound, same, installs) =
    s' = s.with("download", download).with("bound", bound).with("same", same)
      .with("installs", installs).with("scanned", s.scanned + 1)
      .with("finding", download and bound and same and installs)
  action step = {
    nondet download = Set(false, true).oneOf()
    nondet bound = Set(false, true).oneOf()
    nondet same = Set(false, true).oneOf()
    nondet installs = Set(false, true).oneOf()
    scan(download, bound, same, installs)
  }
  // Read back from the recorded inputs, not from the guard expression.
  val invariant = all {
    s.finding implies (s.download and s.bound and s.same and s.installs),
    s.scanned >= 0,
  }
  run bracedVariableTest = init.then(scan(true, true, true, true))
    .expect(s.finding and s.scanned == 1)
  run unassignedVariableTest = init.then(scan(true, false, true, true))
    .expect(not(s.finding))
  run differentVariableInRunTest = init.then(scan(true, true, false, true))
    .expect(not(s.finding))
  run stagedOutsideInstallTest = init.then(scan(true, true, true, false))
    .expect(not(s.finding))
}
