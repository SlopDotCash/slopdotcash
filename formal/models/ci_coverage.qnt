// @source scripts/ci-scope.mjs
// @source .github/workflows/deploy.yml
// @source .github/workflows/escrow-tests.yml
// @source .github/workflows/windows-installer.yml
// @source .github/workflows/formal.yml
// A main push has no PR file list, but can publish and therefore must select
// the complete gate. Other PRs may select checks by their changed surfaces.
module ci_coverage {
  var s: { event: str, branch: str, changedUI: bool, changedAPI: bool,
    selected: bool, ui: bool, api: bool, sandbox: bool, installer: bool }
  action init = {
    nondet event = Set("push", "pull_request", "workflow_dispatch").oneOf()
    nondet branch = Set("main", "development", "feature").oneOf()
    nondet ui = Set(false, true).oneOf()
    nondet api = Set(false, true).oneOf()
    s' = { event: event, branch: branch, changedUI: ui, changedAPI: api,
      selected: false, ui: false, api: false, sandbox: false, installer: false }
  }
  val release = s.event == "push" and s.branch == "main"
  action chooseCoverage = all {
    not(s.selected),
    val full = s.event == "workflow_dispatch" or release
    s' = s.with("selected", true).with("ui", full or s.changedUI)
      .with("api", full or s.changedAPI).with("sandbox", full)
      .with("installer", full),
  }
  action step = chooseCoverage
  val invariant = (s.selected and release) implies all { s.ui, s.api, s.sandbox, s.installer }
  action initMainPush = s' = { event: "push", branch: "main", changedUI: false,
    changedAPI: false, selected: false, ui: false, api: false, sandbox: false, installer: false }
  run releaseCoverageTest = initMainPush.then(chooseCoverage)
    .expect(s.ui and s.api and s.sandbox and s.installer)
}
