// @source workers/vetting/bounded-scan.ts
// The credential-store rule reports a finding when an install hook reads a
// stored secret: a cloud credential directory, a vault token, a password file,
// or a secret-manager read verb. `store` is the recognised source, `reads`
// says the hook reads it (a bare mention is not enough), `installs` says the
// lifecycle runs the hook.
module vetting_credential_store {
  var s: { store: bool, reads: bool, installs: bool, finding: bool,
    scanned: int }
  action init = s' = { store: false, reads: false, installs: false,
    finding: false, scanned: 0 }
  action scan(store, reads, installs) =
    s' = s.with("store", store).with("reads", reads).with("installs", installs)
      .with("scanned", s.scanned + 1)
      .with("finding", store and reads and installs)
  action step = {
    nondet store = Set(false, true).oneOf()
    nondet reads = Set(false, true).oneOf()
    nondet installs = Set(false, true).oneOf()
    scan(store, reads, installs)
  }
  // Read back from the recorded inputs, not from the guard expression.
  val invariant = all {
    s.finding implies (s.store and s.reads and s.installs),
    s.scanned >= 0,
  }
  run ssmReadInPostinstallTest = init.then(scan(true, true, true))
    .expect(s.finding and s.scanned == 1)
  run mentionWithoutReadTest = init.then(scan(true, false, true))
    .expect(not(s.finding))
  run readOutsideInstallTest = init.then(scan(true, true, false))
    .expect(not(s.finding))
}
