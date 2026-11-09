// @source scripts/ci-scope.mjs
// @source .github/workflows/deploy.yml
// @source .github/workflows/escrow-tests.yml
// @source .github/workflows/windows-installer.yml
// @source .github/workflows/formal.yml
// A main or development push has no PR file list, but deploys (production or
// staging) and therefore must select the complete gate. Other PRs may select
// checks by their changed surfaces.
module ci_coverage {
  var s: { event: str, branch: str, changedUI: bool, changedAPI: bool,
    changedSolanaFixture: bool, selected: bool, ui: bool, api: bool,
    sandbox: bool, installer: bool, solana: bool }
  action init = {
    nondet event = Set("push", "pull_request", "workflow_dispatch").oneOf()
    nondet branch = Set("main", "development", "feature").oneOf()
    nondet ui = Set(false, true).oneOf()
    nondet api = Set(false, true).oneOf()
    nondet solana = Set(false, true).oneOf()
    s' = { event: event, branch: branch, changedUI: ui, changedAPI: api,
      changedSolanaFixture: solana, selected: false, ui: false, api: false,
      sandbox: false, installer: false, solana: false }
  }
  val release = s.event == "push" and (s.branch == "main" or s.branch == "development")
  action chooseCoverage = all {
    not(s.selected),
    val full = s.event == "workflow_dispatch" or release
    s' = s.with("selected", true).with("ui", full or s.changedUI)
      .with("api", full or s.changedAPI).with("sandbox", full)
      .with("installer", full)
      .with("solana", s.event != "pull_request" or s.changedSolanaFixture),
  }
  action step = chooseCoverage
  val invariant = all {
    (s.selected and release) implies all { s.ui, s.api, s.sandbox, s.installer, s.solana },
    (s.selected and s.changedSolanaFixture) implies s.solana,
  }
  action initMainPush = s' = { event: "push", branch: "main", changedUI: false,
    changedAPI: false, changedSolanaFixture: false, selected: false, ui: false,
    api: false, sandbox: false, installer: false, solana: false }
  run releaseCoverageTest = initMainPush.then(chooseCoverage)
    .expect(s.ui and s.api and s.sandbox and s.installer and s.solana)
  action initDevelopmentPush = s' = { event: "push", branch: "development",
    changedUI: false, changedAPI: false, changedSolanaFixture: false,
    selected: false, ui: false, api: false, sandbox: false, installer: false, solana: false }
  run developmentCoverageTest = initDevelopmentPush.then(chooseCoverage)
    .expect(s.ui and s.api and s.sandbox and s.installer and s.solana)
  action initSolanaFixture = s' = { event: "pull_request", branch: "feature",
    changedUI: false, changedAPI: false, changedSolanaFixture: true,
    selected: false, ui: false, api: false, sandbox: false, installer: false, solana: false }
  run fixtureSelectsChainCoverageTest = initSolanaFixture.then(chooseCoverage)
    .expect(s.solana)
}
