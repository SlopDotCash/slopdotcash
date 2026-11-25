// @source migrations/0153_security_advisory_states.sql
// @source src/lib/security-advisory-state.ts
// @source backend/security/handler.ts
// One advisory behind one case. GitHub holds its real state; Slop keeps the
// state GitHub last listed and shows it on the case. Slop never writes the
// state to GitHub, and the close link is offered only to a maintainer, only
// after a closing decision here, only while the kept state is open.
module api_security_advisory_state {
  // github: 0 triage, 1 closed. kept: -1 not read, else the listed state.
  // decided: a closing decision was recorded on Slop. writes: GitHub writes.
  var s: { github: int, kept: int, decided: bool, available: bool,
    writes: int, runs: int }
  action init = s' = {github: 0, kept: -1, decided: false, available: true,
    writes: 0, runs: 0}
  action closeOnGithub = all { s.github == 0, s' = s.with("github", 1) }
  action decide = all { not(s.decided), s' = s.with("decided", true) }
  action outage = all { s.available, s' = s.with("available", false) }
  action recover = all { not(s.available), s' = s.with("available", true) }
  // The scheduled import lists the repository and keeps what GitHub says.
  action importRun = all { s.runs < 4,
    s' = (if (s.available) s.with("kept", s.github) else s)
      .with("runs", s.runs + 1) }
  action step = any { closeOnGithub, decide, outage, recover, importRun }
  def offered(maintainer: bool): bool =
    maintainer and s.decided and s.kept == 0
  val invariant = all { s.writes == 0, s.kept <= s.github,
    not(offered(false)), s.kept == -1 implies not(offered(true)) }
  run decidedStillOpenTest = init.then(importRun).then(decide)
    .expect(offered(true) and not(offered(false)))
  run closedOnGithubClearsTest = init.then(importRun).then(decide)
    .then(closeOnGithub).then(importRun).expect(s.kept == 1 and not(offered(true)))
  run outageKeepsLastStateTest = init.then(importRun).then(closeOnGithub)
    .then(outage).then(importRun).expect(s.kept == 0)
  run unreadShowsNothingTest = init.then(decide)
    .expect(s.kept == -1 and not(offered(true)))
}
