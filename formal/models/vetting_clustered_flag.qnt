// @source workers/vetting/bounded-scan.ts
// The download-staging rule reports a finding when a download writes a file
// and the script runs it. A path glued to a clustered flag (`-fsSLo out`)
// still writes the file: the flag letters and the destination share one
// argument. `download` is the transfer, `writes` says a destination is bound
// (glued or separate), `installs` says the lifecycle runs the script.
module vetting_clustered_flag {
  var s: { download: bool, writes: bool, installs: bool, finding: bool,
    scanned: int }
  action init = s' = { download: false, writes: false, installs: false,
    finding: false, scanned: 0 }
  action scan(download, writes, installs) =
    s' = s.with("download", download).with("writes", writes)
      .with("installs", installs).with("scanned", s.scanned + 1)
      .with("finding", download and writes and installs)
  action step = {
    nondet download = Set(false, true).oneOf()
    nondet writes = Set(false, true).oneOf()
    nondet installs = Set(false, true).oneOf()
    scan(download, writes, installs)
  }
  // Read back from the recorded inputs, not from the guard expression.
  val invariant = all {
    s.finding implies (s.download and s.writes and s.installs),
    s.scanned >= 0,
  }
  run gluedDestinationTest = init.then(scan(true, true, true))
    .expect(s.finding and s.scanned == 1)
  run downloadWithoutDestinationTest = init.then(scan(true, false, true))
    .expect(not(s.finding))
  run stagedOutsideInstallTest = init.then(scan(true, true, false))
    .expect(not(s.finding))
}
