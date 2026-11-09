// @source workers/vetting/bounded-scan.ts
// The redirect-config rule reports a finding when an install surface is a
// registry configuration that can redirect where packages come from
// (`.npmrc`, `.yarnrc`, `.pnpmfile`, registry entries). `redirect` is the
// recognised config, `installs` says the lifecycle reads it.
module vetting_redirect_config {
  var s: { redirect: bool, installs: bool, finding: bool, scanned: int }
  action init = s' = { redirect: false, installs: false, finding: false,
    scanned: 0 }
  action scan(redirect, installs) =
    s' = s.with("redirect", redirect).with("installs", installs)
      .with("scanned", s.scanned + 1)
      .with("finding", redirect and installs)
  action step = {
    nondet redirect = Set(false, true).oneOf()
    nondet installs = Set(false, true).oneOf()
    scan(redirect, installs)
  }
  // Read back from the recorded inputs, not from the guard expression.
  val invariant = all {
    s.finding implies (s.redirect and s.installs),
    s.scanned >= 0,
  }
  run registryRedirectInInstallTest = init.then(scan(true, true))
    .expect(s.finding and s.scanned == 1)
  run registryConfigOutsideInstallTest = init.then(scan(true, false))
    .expect(not(s.finding))
  run otherConfigIsNotARedirectTest = init.then(scan(false, true))
    .expect(not(s.finding))
}
