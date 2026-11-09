// @source workers/vetting/bounded-scan.ts
// The environment-dump rule reports a finding only when the whole environment
// leaves the process: a bare `env` command, a print of `process.env`, or a
// spread of it into a body. `dump` is the spelling, `whole` says the whole
// environment travels (not one variable), `installs` says the file is an
// install surface.
module vetting_env_dump {
  var s: { dump: bool, whole: bool, installs: bool, finding: bool, scanned: int }
  action init = s' = { dump: false, whole: false, installs: false,
    finding: false, scanned: 0 }
  action scan(dump, whole, installs) =
    s' = s.with("dump", dump).with("whole", whole).with("installs", installs)
      .with("scanned", s.scanned + 1)
      .with("finding", dump and whole and installs)
  action step = {
    nondet dump = Set(false, true).oneOf()
    nondet whole = Set(false, true).oneOf()
    nondet installs = Set(false, true).oneOf()
    scan(dump, whole, installs)
  }
  // Read back from the recorded inputs, not from the guard expression.
  val invariant = all {
    s.finding implies (s.dump and s.whole and s.installs),
    s.scanned >= 0,
  }
  run bareEnvInInstallTest = init.then(scan(true, true, true))
    .expect(s.finding and s.scanned == 1)
  run singleVariableIsNotADumpTest = init.then(scan(true, false, true))
    .expect(not(s.finding))
  run dumpOutsideInstallTest = init.then(scan(true, true, false))
    .expect(not(s.finding))
  run printenvIsNotBareEnvTest = init.then(scan(false, true, true))
    .expect(not(s.finding))
}
