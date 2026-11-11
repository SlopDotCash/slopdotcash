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
// changes, and the proofs when it changes a proof input.
module ci_coverage {
  var s: { event: str, branch: str, changedUI: bool, changedAPI: bool,
    changedSolanaFixture: bool, changedModelInputs: bool,
    changedProofInputs: bool, selected: bool, ui: bool, api: bool,
    sandbox: bool, installer: bool, solana: bool, allModels: bool,
    affectedModels: bool, proofs: bool }
  action init = {
    nondet event = Set("push", "pull_request", "workflow_dispatch").oneOf()
    nondet branch = Set("main", "development", "feature").oneOf()
    nondet ui = Set(false, true).oneOf()
    nondet api = Set(false, true).oneOf()
    nondet solana = Set(false, true).oneOf()
    nondet models = Set(false, true).oneOf()
    nondet proofs = Set(false, true).oneOf()
    s' = { event: event, branch: branch, changedUI: ui, changedAPI: api,
      changedSolanaFixture: solana, changedModelInputs: models,
      changedProofInputs: proofs, selected: false, ui: false, api: false,
      sandbox: false, installer: false, solana: false, allModels: false,
      affectedModels: false, proofs: false }
  }
  val release = s.event == "push" and (s.branch == "main" or s.branch == "development")
  action chooseCoverage = all {
    not(s.selected),
    val full = s.event == "workflow_dispatch" or release
    s' = s.with("selected", true).with("ui", full or s.changedUI)
      .with("api", full or s.changedAPI).with("sandbox", full)
      .with("installer", full)
      .with("solana", s.event != "pull_request" or s.changedSolanaFixture)
      .with("allModels", s.event != "pull_request")
      .with("affectedModels", s.event != "pull_request" or s.changedModelInputs)
      .with("proofs", s.event != "pull_request" or s.changedProofInputs),
  }
  action step = chooseCoverage
  val invariant = all {
    (s.selected and release) implies all { s.ui, s.api, s.sandbox, s.installer,
      s.solana, s.allModels, s.affectedModels, s.proofs },
    (s.selected and s.changedSolanaFixture) implies s.solana,
    (s.selected and s.changedModelInputs) implies s.affectedModels,
    (s.selected and s.changedProofInputs) implies s.proofs,
    s.allModels implies s.affectedModels,
  }
  action initMainPush = s' = { event: "push", branch: "main", changedUI: false,
    changedAPI: false, changedSolanaFixture: false, changedModelInputs: false, changedProofInputs: false,
    selected: false, ui: false,
    api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false }
  run releaseCoverageTest = initMainPush.then(chooseCoverage)
    .expect(s.ui and s.api and s.sandbox and s.installer and s.solana
      and s.allModels and s.proofs)
  action initDevelopmentPush = s' = { event: "push", branch: "development",
    changedUI: false, changedAPI: false, changedSolanaFixture: false,
    changedModelInputs: false, changedProofInputs: false,
    selected: false, ui: false, api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false }
  run developmentCoverageTest = initDevelopmentPush.then(chooseCoverage)
    .expect(s.ui and s.api and s.sandbox and s.installer and s.solana)
  action initSolanaFixture = s' = { event: "pull_request", branch: "feature",
    changedUI: false, changedAPI: false, changedSolanaFixture: true,
    changedModelInputs: false, changedProofInputs: false,
    selected: false, ui: false, api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false }
  run fixtureSelectsChainCoverageTest = initSolanaFixture.then(chooseCoverage)
    .expect(s.solana and not(s.affectedModels) and not(s.proofs))
  action initModelSource = s' = { event: "pull_request", branch: "feature",
    changedUI: false, changedAPI: true, changedSolanaFixture: false,
    changedModelInputs: true, changedProofInputs: false, selected: false,
    ui: false, api: false, sandbox: false, installer: false, solana: false,
    allModels: false, affectedModels: false, proofs: false }
  run modelSourceSelectsAffectedModelsTest = initModelSource.then(chooseCoverage)
    .expect(s.affectedModels and not(s.allModels) and not(s.proofs))
}
