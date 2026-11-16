// @source scripts/ci-scope.mjs
// @source .github/workflows/deploy.yml
// @source .github/workflows/escrow-tests.yml
// @source .github/workflows/windows-installer.yml
// @source .github/workflows/formal.yml
// @source .github/workflows/lemmascript.yml
// A main or development push has no PR file list, but deploys (production or
// staging) and therefore must select the complete gate. Other PRs may select
// checks by their changed surfaces. Every non-PR run checks every state model
// and LemmaScript proof; a PR checks the models whose file or sources it
// changes, and the proofs when it changes a proof input. Two exemptions, each
// only on a manual run: skip_proofs repeats neither the models nor the proofs,
// and skip_browser_tests runs the browser smoke lane instead of the complete
// UI and API lanes. Neither removes another gate, and a push can never skip.
// Scheduled nightly runs of formal.yml and lemmascript.yml check every model
// and proof without this selector.
module ci_coverage {
  var s: { event: str, branch: str, changedUI: bool, changedAPI: bool,
    changedSolanaFixture: bool, changedModelInputs: bool,
    changedProofInputs: bool, selected: bool, ui: bool, api: bool,
    sandbox: bool, installer: bool, solana: bool, allModels: bool,
    affectedModels: bool, proofs: bool, skipProofs: bool,
    skipBrowserTests: bool }
  action init = {
    nondet event = Set("push", "pull_request", "workflow_dispatch").oneOf()
    nondet branch = Set("main", "development", "feature").oneOf()
    nondet ui = Set(false, true).oneOf()
    nondet api = Set(false, true).oneOf()
    nondet solana = Set(false, true).oneOf()
    nondet models = Set(false, true).oneOf()
    nondet proofs = Set(false, true).oneOf()
    nondet skip = Set(false, true).oneOf()
    nondet skipBrowsers = Set(false, true).oneOf()
    s' = { event: event, branch: branch, changedUI: ui, changedAPI: api,
      changedSolanaFixture: solana, changedModelInputs: models,
      changedProofInputs: proofs, selected: false, ui: false, api: false,
      sandbox: false, installer: false, solana: false, allModels: false,
      affectedModels: false, proofs: false, skipProofs: skip,
      skipBrowserTests: skipBrowsers }
  }
  // The inputs exist only on a manual run; any other event ignores them.
  val skipped = s.event == "workflow_dispatch" and s.skipProofs
  val browsersSkipped = s.event == "workflow_dispatch" and s.skipBrowserTests
  val release = s.event == "push" and (s.branch == "main" or s.branch == "development")
  action chooseCoverage = all {
    not(s.selected),
    val full = s.event == "workflow_dispatch" or release
    s' = s.with("selected", true)
      .with("ui", not(browsersSkipped) and (full or s.changedUI))
      .with("api", not(browsersSkipped) and (full or s.changedAPI))
      .with("sandbox", full)
      .with("installer", full)
      .with("solana", s.event != "pull_request" or s.changedSolanaFixture)
      .with("allModels", s.event != "pull_request" and not(skipped))
      .with("affectedModels", not(skipped) and
        (s.event != "pull_request" or s.changedModelInputs))
      .with("proofs", not(skipped) and
        (s.event != "pull_request" or s.changedProofInputs)),
  }
  action step = chooseCoverage
  val invariant = all {
    (s.selected and release) implies all { s.ui, s.api, s.sandbox, s.installer,
      s.solana, s.allModels, s.affectedModels, s.proofs },
    (s.selected and s.changedSolanaFixture) implies s.solana,
    (s.selected and s.changedModelInputs and not(skipped)) implies s.affectedModels,
    (s.selected and s.changedProofInputs and not(skipped)) implies s.proofs,
    s.allModels implies s.affectedModels,
    // Only a manual run can leave the proof stages out, and it leaves nothing
    // else out.
    (s.selected and s.event != "pull_request" and not(s.allModels and s.proofs))
      implies skipped,
    (s.selected and skipped) implies all { s.sandbox, s.installer,
      s.solana, not(s.allModels), not(s.affectedModels), not(s.proofs) },
    // Only a manual run can replace the complete browser lanes, and it
    // replaces nothing else.
    (s.selected and (s.event == "workflow_dispatch" or release)
      and not(s.ui and s.api)) implies browsersSkipped,
    (s.selected and browsersSkipped) implies all { s.sandbox, s.installer,
      s.solana, not(s.ui), not(s.api) },
    (s.selected and browsersSkipped and not(skipped)) implies
      (s.allModels and s.proofs),
  }
  action initMainPush = s' = { event: "push", branch: "main", changedUI: false,
    changedAPI: false, changedSolanaFixture: false, changedModelInputs: false, changedProofInputs: false,
    selected: false, ui: false,
    api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false, skipProofs: false,
    skipBrowserTests: false }
  run releaseCoverageTest = initMainPush.then(chooseCoverage)
    .expect(s.ui and s.api and s.sandbox and s.installer and s.solana
      and s.allModels and s.proofs)
  action initDevelopmentPush = s' = { event: "push", branch: "development",
    changedUI: false, changedAPI: false, changedSolanaFixture: false,
    changedModelInputs: false, changedProofInputs: false,
    selected: false, ui: false, api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false, skipProofs: false,
    skipBrowserTests: false }
  run developmentCoverageTest = initDevelopmentPush.then(chooseCoverage)
    .expect(s.ui and s.api and s.sandbox and s.installer and s.solana)
  action initSolanaFixture = s' = { event: "pull_request", branch: "feature",
    changedUI: false, changedAPI: false, changedSolanaFixture: true,
    changedModelInputs: false, changedProofInputs: false,
    selected: false, ui: false, api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false, skipProofs: false,
    skipBrowserTests: false }
  run fixtureSelectsChainCoverageTest = initSolanaFixture.then(chooseCoverage)
    .expect(s.solana and not(s.affectedModels) and not(s.proofs))
  // A push carries no inputs; a stray true value changes nothing.
  action initMainPushWithSkip = s' = { event: "push", branch: "main", changedUI: false,
    changedAPI: false, changedSolanaFixture: false, changedModelInputs: false, changedProofInputs: false,
    selected: false, ui: false,
    api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false, skipProofs: true,
    skipBrowserTests: true }
  run pushCannotSkipTest = initMainPushWithSkip.then(chooseCoverage)
    .expect(s.ui and s.api and s.allModels and s.affectedModels and s.proofs)
  action initManualSkip = s' = { event: "workflow_dispatch", branch: "main",
    changedUI: false, changedAPI: false, changedSolanaFixture: false,
    changedModelInputs: true, changedProofInputs: true,
    selected: false, ui: false, api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false, skipProofs: true,
    skipBrowserTests: true }
  run manualRunSkipsProofsAndBrowserLanesTest = initManualSkip.then(chooseCoverage)
    .expect(s.sandbox and s.installer and s.solana and not(s.ui) and not(s.api)
      and not(s.allModels) and not(s.affectedModels) and not(s.proofs))
  action initManualSkipProofsOnly = s' = { event: "workflow_dispatch", branch: "main",
    changedUI: false, changedAPI: false, changedSolanaFixture: false,
    changedModelInputs: false, changedProofInputs: false,
    selected: false, ui: false, api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false, skipProofs: true,
    skipBrowserTests: false }
  run manualRunSkipsOnlyProofsTest = initManualSkipProofsOnly.then(chooseCoverage)
    .expect(s.ui and s.api and s.sandbox and s.installer and s.solana
      and not(s.allModels) and not(s.proofs))
  action initManualFull = s' = { event: "workflow_dispatch", branch: "main",
    changedUI: false, changedAPI: false, changedSolanaFixture: false,
    changedModelInputs: false, changedProofInputs: false,
    selected: false, ui: false, api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false, skipProofs: false,
    skipBrowserTests: false }
  run manualRunIsCompleteByDefaultTest = initManualFull.then(chooseCoverage)
    .expect(s.ui and s.api and s.allModels and s.proofs)
  action initModelSource = s' = { event: "pull_request", branch: "feature",
    changedUI: false, changedAPI: true, changedSolanaFixture: false,
    changedModelInputs: true, changedProofInputs: false, selected: false,
    ui: false, api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false, skipProofs: false,
    skipBrowserTests: false }
  run modelSourceSelectsAffectedModelsTest = initModelSource.then(chooseCoverage)
    .expect(s.affectedModels and not(s.allModels) and not(s.proofs))
}
