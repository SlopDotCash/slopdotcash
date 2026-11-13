// @source .github/workflows/deploy.yml
// @source scripts/prepare-publication.mjs
// @source scripts/prepare-site.mjs
// @source scripts/dist-manifest.mjs
// @source scripts/select-pages-deployment.mjs
// @source src/lib/verified-selection.ts
// @source scripts/verify-staging-deployment.mjs
// @source scripts/release-notify.mjs
// @evidence scripts/pages-secret-inventory.test.ts
// Source advancement before service writes supersedes; advancement afterward
// is an explicit partial-publication failure, never a verified release.
// proofsPass is the successful same-SHA result modeled by release_proof_gate.
// The Slopbot child captures the reviewed secret-upload boundary: existing
// App/Surplus inventory, a nonempty protected key in a private temporary file,
// upload into the immutable version, cleanup before metadata readback, exact
// version/SHA and typed-name validation before promotion. No action mutates a
// secret on the live old version. Names do not prove secret values or provider
// readiness; file permissions, credential bytes and metadata accuracy are input
// predicates exercised by the deployment shell tests, not cryptographic proofs.
// Earlier services can already have changed before Slopbot refuses. An inactive
// uploaded version is also a retained external write, not a verified release.
// One version attempt and one secret temporary file bound the model; optional Slopbot-disabled
// releases bypass only this child gate. Cleanup failure is explicit and cannot
// promote. This safety model makes no eventual-cleanup or provider guarantee.
// sourceMatches is an existing workflow recheck's retained observation, not a
// continuous lock on live main or a new check between file preparation/upload.
module release_publication {
  type State = { stage: str, main: bool, manual: bool, retainedData: bool,
    proofs: bool, tested: bool, sourceMatches: bool, workers: bool, pages: bool, verified: bool,
    slopbotEnabled: bool, earlierWorker: bool, secretPhase: str, privateFile: bool,
    uploaded: bool, secretIncluded: bool, versionValidated: bool, activation: str }
  var s: State
  action init = s' = { stage: "new", main: false, manual: false, retainedData: false,
    proofs: false, tested: false, sourceMatches: true, workers: false, pages: false, verified: false,
    slopbotEnabled: true, earlierWorker: false, secretPhase: "none", privateFile: false,
    uploaded: false, secretIncluded: false, versionValidated: false, activation: "none" }
  pure def failed(value: State): State = value.with("stage",
    if (not(value.pages) and (value.earlierWorker or value.uploaded or value.workers)) "partial-failure" else "failed")
  action disableSlopbot = all { s.stage == "new", s' = s.with("slopbotEnabled", false) }
  action prepare(main, manual, retainedData) = all {
    s.stage == "new", retainedData implies manual,
    s' = s.with("stage", "prepared").with("main", main).with("manual", manual).with("retainedData", retainedData),
  }
  action proofsPass = all {s.stage == "prepared", s' = s.with("proofs", true)}
  action qualify = all { s.stage == "prepared", s.proofs, s' = s.with("stage", "tested").with("tested", true) }
  // Observe advancement at an existing workflow source-check boundary.
  action advanceSource = all { s.stage.in(Set("prepared", "tested", "workers")),
    s' = s.with("sourceMatches", false) }
  action supersede = all { s.stage == "tested", not(s.sourceMatches),
    not(s.earlierWorker), not(s.uploaded),
    s' = s.with("stage", "superseded") }
  // The shared publication step may write other services before Slopbot.
  action publishEarlierWorker = all { s.stage == "tested", s.main, s.sourceMatches,
    not(s.earlierWorker), s.secretPhase == "none", s' = s.with("earlierWorker", true) }
  action readExistingInventory(valid: bool): bool = all {
    s.stage == "tested", s.main, s.sourceMatches, s.slopbotEnabled, s.secretPhase == "none",
    s' = if (valid) s.with("secretPhase", "inventory") else failed(s) }
  action allocateSecretFile = all { s.stage == "tested", s.secretPhase == "inventory",
    s' = s.with("secretPhase", "allocated").with("privateFile", true) }
  action writeProtectedSecret(present: bool): bool = all {
    s.stage == "tested", s.secretPhase == "allocated", s.privateFile,
    s' = if (present) s.with("secretPhase", "prepared") else failed(s) }
  action uploadVersion(included: bool, capturedId: bool): bool = all {
    s.stage == "tested", s.main, s.sourceMatches, s.secretPhase == "prepared", s.privateFile,
    s' = if (capturedId) s.with("uploaded", true).with("secretIncluded", included).with("secretPhase", "uploaded")
      else failed(s.with("uploaded", true).with("secretIncluded", included).with("secretPhase", "unidentified")) }
  action cleanupSecretFile = all { s.privateFile,
    s.uploaded or Set("failed", "partial-failure", "superseded").contains(s.stage),
    s' = s.with("privateFile", false) }
  action secretCleanupFailure = all { s.privateFile, s' = failed(s) }
  action validateVersion(identityAndSha: bool, completeTypedNames: bool): bool = all {
    s.stage == "tested", s.secretPhase == "uploaded", not(s.privateFile),
    // A complete, accurate metadata read cannot claim absent bindings exist.
    completeTypedNames implies s.secretIncluded,
    s' = if (identityAndSha and completeTypedNames) s.with("secretPhase", "validated").with("versionValidated", true)
      else failed(s.with("secretPhase", "invalid")) }
  // An errored deploy may have committed remotely. Never infer rollback or
  // mark that outcome as a confirmed active version without its readback.
  action promoteSlopbot(confirmed: bool): bool = all {
    s.stage == "tested", s.main, s.sourceMatches, s.slopbotEnabled,
    s.activation == "none", s.uploaded, s.secretIncluded, s.versionValidated, not(s.privateFile),
    s' = if (confirmed) s.with("activation", "confirmed") else failed(s.with("activation", "uncertain")) }
  action publishWorkers = all { s.stage == "tested", s.main, s.sourceMatches,
    not(s.slopbotEnabled) or (s.activation == "confirmed" and s.uploaded and s.secretIncluded and s.versionValidated and not(s.privateFile)),
    s' = s.with("stage", "workers").with("workers", true) }
  action partialFailure = all { Set("tested", "workers").contains(s.stage), not(s.sourceMatches),
    s.earlierWorker or s.uploaded or s.workers,
    s' = s.with("stage", "partial-failure") }
  action publishPages = all { s.stage == "workers", s.sourceMatches,
    s' = s.with("stage", "pages").with("pages", true) }
  action verifyBytesAndMetadata = all { s.stage == "pages", s.pages, s.tested,
    s' = s.with("stage", "verified").with("verified", true) }
  action providerFailure = all { s.stage.in(Set("prepared", "tested", "workers", "pages")),
    s' = failed(s) }
  action step = any {
    { nondet main = Set(false, true).oneOf()
      nondet manual = Set(false, true).oneOf()
      nondet retainedData = Set(false, true).oneOf()
      prepare(main, manual, retainedData) },
    disableSlopbot, proofsPass, qualify, advanceSource, supersede, publishEarlierWorker,
    { nondet inventory = Set(false, true).oneOf()
      readExistingInventory(inventory) },
    allocateSecretFile,
    { nondet present = Set(false, true).oneOf()
      writeProtectedSecret(present) },
    { nondet included = Set(false, true).oneOf()
      nondet captured = Set(false, true).oneOf()
      uploadVersion(included, captured) },
    cleanupSecretFile, secretCleanupFailure,
    { nondet identity = Set(false, true).oneOf()
      nondet names = Set(false, true).oneOf()
      validateVersion(identity, names) },
    { nondet confirmed = Set(false, true).oneOf()
      promoteSlopbot(confirmed) },
    publishWorkers, partialFailure, publishPages, verifyBytesAndMetadata, providerFailure
  }

  val invariant = all {
    s.workers implies (s.main and s.tested),
    s.workers and s.slopbotEnabled implies (s.uploaded and s.secretIncluded and s.versionValidated and not(s.privateFile)),
    s.versionValidated implies (s.uploaded and s.secretIncluded),
    s.activation != "none" implies (s.slopbotEnabled and s.uploaded and s.secretIncluded and s.versionValidated and not(s.privateFile)),
    s.tested implies s.proofs,
    s.verified implies (s.workers and s.pages and s.sourceMatches),
    s.stage == "superseded" implies (not(s.pages) and not(s.workers) and not(s.earlierWorker) and not(s.uploaded)),
    s.stage == "partial-failure" implies ((s.workers or s.earlierWorker or s.uploaded) and not(s.pages) and not(s.verified)),
    s.retainedData implies s.manual,
  }
  action prepareSecretFile(inventoryOk: bool, protectedKeyPresent: bool): bool =
    if (inventoryOk) readExistingInventory(true).then(allocateSecretFile).then(writeProtectedSecret(protectedKeyPresent))
    else readExistingInventory(false)
  action preparedVersion = prepareSecretFile(true, true).then(uploadVersion(true, true)).then(cleanupSecretFile)
  action checkedVersion = preparedVersion.then(validateVersion(true, true)).then(promoteSlopbot(true))
  run exactReleaseTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(checkedVersion).then(publishWorkers).then(publishPages).then(verifyBytesAndMetadata).expect(s.verified)
  run supersededBeforeWriteTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(advanceSource).then(supersede).expect(not(s.workers) and not(s.pages))
  run partialServicePublicationTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(checkedVersion).then(publishWorkers).then(advanceSource).then(partialFailure).expect(not(s.verified))
  run retainedSnapshotIsExplicitTest = init.then(prepare(true, true, true)).then(proofsPass).then(qualify)
    .then(checkedVersion).then(publishWorkers).then(publishPages).then(verifyBytesAndMetadata).expect(s.retainedData and s.verified)
  // A manual development (staging) release may retain staging's own published data;
  // it still passes every proof and quality gate and never reaches production services.
  run stagingRetainedSnapshotQualifiesTest = init.then(prepare(false, true, true)).then(proofsPass).then(qualify)
    .expect(s.retainedData and not(s.main) and s.tested).then(publishWorkers.fail())
  run retainedSnapshotNeedsManualTest = init.then(prepare(true, false, true).fail())
  run pendingProofCannotQualifyTest = init.then(prepare(true, false, false)).then(qualify.fail())
  run missingProtectedSecretNeverUploadsTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(prepareSecretFile(true, false)).then(cleanupSecretFile)
    .expect(not(s.uploaded) and not(s.workers) and not(s.privateFile) and s.stage == "failed")
  run wrongExistingInventoryNeverUploadsTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(prepareSecretFile(false, true)).expect(not(s.uploaded) and not(s.privateFile))
  run earlierWritesRemainPartialOnSecretRefusalTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(publishEarlierWorker).then(prepareSecretFile(true, false))
    .expect(s.earlierWorker and s.stage == "partial-failure" and not(s.workers) and not(s.verified))
  run missingVersionBindingCannotPromoteTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(prepareSecretFile(true, true)).then(uploadVersion(false, true)).then(cleanupSecretFile)
    .then(validateVersion(true, false)).expect(s.uploaded and not(s.workers) and s.stage == "partial-failure")
  run metadataReadNeedsSecretFileCleanupTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(prepareSecretFile(true, true)).then(uploadVersion(true, true)).then(validateVersion(true, true).fail())
  run wrongVersionOrShaCannotPromoteTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(preparedVersion).then(validateVersion(false, true)).expect(not(s.workers) and not(s.versionValidated))
  run ambiguousUploadKeepsExternalWriteWithoutPromotionTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(prepareSecretFile(true, true)).then(uploadVersion(true, false)).then(cleanupSecretFile)
    .expect(s.uploaded and s.stage == "partial-failure" and not(s.workers) and not(s.privateFile))
  run cleanupFailureDoesNotValidateOrPromoteTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(prepareSecretFile(true, true)).then(uploadVersion(true, true)).then(secretCleanupFailure)
    .expect(s.privateFile and s.stage == "partial-failure" and not(s.versionValidated) and not(s.workers))
  run sourceAdvanceAfterUploadIsPartialTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(preparedVersion).then(advanceSource).then(partialFailure)
    .expect(s.uploaded and s.stage == "partial-failure" and not(s.verified))
  run disabledSlopbotDoesNotNeedOrMutateItsSecretTest = init.then(disableSlopbot).then(prepare(true, false, false))
    .then(proofsPass).then(qualify).then(publishWorkers).then(publishPages).then(verifyBytesAndMetadata)
    .expect(s.verified and not(s.uploaded) and not(s.privateFile))
  run deployErrorDoesNotInventRollbackOrConfirmationTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(preparedVersion).then(validateVersion(true, true)).then(promoteSlopbot(false))
    .expect(s.activation == "uncertain" and s.stage == "partial-failure" and not(s.workers) and not(s.verified))
  run emptyKeyAllocationStillNeedsExitCleanupTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(readExistingInventory(true)).then(allocateSecretFile).then(writeProtectedSecret(false))
    .expect(s.privateFile and s.stage == "failed").then(cleanupSecretFile).expect(not(s.privateFile))

}
