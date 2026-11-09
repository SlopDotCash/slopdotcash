// @source workers/vetting/bounded-scan.ts
// The package-runner rule reports a finding when a hook runs a package
// runner that installs without asking (`npx -y`, `bunx`, `pnpm dlx`) inside
// the install lifecycle. `runner` is the invocation, `installs` says the
// lifecycle runs it, `pinned` says the version is pinned (which alone does
// not make it safe).
module vetting_package_runner {
  var s: { runner: bool, installs: bool, pinned: bool, finding: bool,
    scanned: int }
  action init = s' = { runner: false, installs: false, pinned: false,
    finding: false, scanned: 0 }
  action scan(runner, installs, pinned) =
    s' = s.with("runner", runner).with("installs", installs)
      .with("pinned", pinned).with("scanned", s.scanned + 1)
      .with("finding", runner and installs)
  action step = {
    nondet runner = Set(false, true).oneOf()
    nondet installs = Set(false, true).oneOf()
    nondet pinned = Set(false, true).oneOf()
    scan(runner, installs, pinned)
  }
  // Read back from the recorded inputs, not from the guard expression.
  val invariant = all {
    s.finding implies (s.runner and s.installs),
    s.scanned >= 0,
  }
  run npxYesInPrepareTest = init.then(scan(true, true, false))
    .expect(s.finding and s.scanned == 1)
  run runnerOutsideInstallTest = init.then(scan(true, false, false))
    .expect(not(s.finding))
  run otherCommandInInstallTest = init.then(scan(false, true, true))
    .expect(not(s.finding))
}
