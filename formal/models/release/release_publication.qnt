// @source .github/workflows/deploy.yml
// @source scripts/prepare-publication.mjs
// @source scripts/prepare-site.mjs
// @source scripts/dist-manifest.mjs
// @source scripts/select-pages-deployment.mjs
// @source src/lib/verified-selection.ts
// @source scripts/verify-staging-deployment.mjs
// @source scripts/release-notify.mjs
// Source advancement before service writes supersedes; advancement afterward
// is an explicit partial-publication failure, never a verified release.
// proofsPass is the successful same-SHA result modeled by release_proof_gate.
module release_publication {
  var s: { stage: str, main: bool, manual: bool, retainedData: bool,
    proofs: bool, tested: bool, sourceMatches: bool, workers: bool, pages: bool, verified: bool }
  action init = s' = { stage: "new", main: false, manual: false, retainedData: false,
    proofs: false, tested: false, sourceMatches: true, workers: false, pages: false, verified: false }
  action prepare(main, manual, retainedData) = all {
    s.stage == "new", retainedData implies (main and manual),
    s' = s.with("stage", "prepared").with("main", main).with("manual", manual).with("retainedData", retainedData),
  }
  action proofsPass = all {s.stage == "prepared", s' = s.with("proofs", true)}
  action qualify = all { s.stage == "prepared", s.proofs, s' = s.with("stage", "tested").with("tested", true) }
  action advanceSource = all { s.stage.in(Set("prepared", "tested", "workers")),
    s' = s.with("sourceMatches", false) }
  action supersede = all { s.stage == "tested", not(s.sourceMatches),
    s' = s.with("stage", "superseded") }
  action publishWorkers = all { s.stage == "tested", s.main, s.sourceMatches,
    s' = s.with("stage", "workers").with("workers", true) }
  action partialFailure = all { s.stage == "workers", not(s.sourceMatches),
    s' = s.with("stage", "partial-failure") }
  action publishPages = all { s.stage == "workers", s.sourceMatches,
    s' = s.with("stage", "pages").with("pages", true) }
  action verifyBytesAndMetadata = all { s.stage == "pages", s.pages, s.tested,
    s' = s.with("stage", "verified").with("verified", true) }
  action providerFailure = all { s.stage.in(Set("prepared", "tested", "workers", "pages")),
    s' = s.with("stage", "failed") }
  action step = {
    nondet main = Set(false, true).oneOf()
    nondet manual = Set(false, true).oneOf()
    nondet retainedData = Set(false, true).oneOf()
    any { prepare(main, manual, retainedData), proofsPass, qualify, advanceSource, supersede,
      publishWorkers, partialFailure, publishPages, verifyBytesAndMetadata, providerFailure }
  }
  val invariant = all {
    s.workers implies (s.main and s.tested),
    s.tested implies s.proofs,
    s.verified implies (s.workers and s.pages and s.sourceMatches),
    s.stage == "superseded" implies (not(s.pages) and not(s.workers)),
    s.stage == "partial-failure" implies (s.workers and not(s.pages) and not(s.verified)),
    s.retainedData implies (s.main and s.manual),
  }
  run exactReleaseTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(publishWorkers).then(publishPages).then(verifyBytesAndMetadata).expect(s.verified)
  run supersededBeforeWriteTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(advanceSource).then(supersede).expect(not(s.workers) and not(s.pages))
  run partialServicePublicationTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(publishWorkers).then(advanceSource).then(partialFailure).expect(not(s.verified))
  run retainedSnapshotIsExplicitTest = init.then(prepare(true, true, true)).then(proofsPass).then(qualify)
    .then(publishWorkers).then(publishPages).then(verifyBytesAndMetadata).expect(s.retainedData and s.verified)
  run pendingProofCannotQualifyTest = init.then(prepare(true, false, false)).then(qualify.fail())
}
