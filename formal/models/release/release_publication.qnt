// @source .github/workflows/deploy.yml
// @source scripts/prepare-publication.mjs
// @source scripts/prepare-site.mjs
// @source scripts/dist-manifest.mjs
// @source scripts/select-pages-deployment.mjs
// @source src/lib/verified-selection.ts
// @source scripts/verify-staging-deployment.mjs
// @source scripts/release-notify.mjs
// @source scripts/release-robinhood-rpc.ts
// @source scripts/rotate-fee-solana-rpc.ts
// @source scripts/qualify-solana-rpc-pair.ts
// @source scripts/check-retained-release-data.ts
// @source scripts/restore-collected-data.py
// @source scripts/github-app-token-refresh.ts
// @source scripts/read-local-leaderboard.ts
// @evidence scripts/check-retained-release-data.test.ts
// @evidence scripts/restore-collected-data.test.ts
// @evidence scripts/read-local-leaderboard.test.ts
// @evidence scripts/pages-secret-inventory.test.ts
// @evidence scripts/release-robinhood-rpc.test.ts
// @evidence scripts/rotate-fee-solana-rpc.test.ts
// @evidence scripts/qualify-solana-rpc-pair.test.ts
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
// The opt-in RPC child never shares the normal service-write branch. It covers
// Robinhood rotation and the disabled-network Solana public-pair binding.
// Solana's canonical witness and quiet journal are qualification inputs here.
// Its data/RPC and identity predicates (including immediate version succession)
// model bounded observations, not a lock
// on the fee journal or guarantees about Cloudflare and the chain.
// A deployment-command failure can precede accepted remote activation. The
// Solana rotation retries metadata reads only: confirmed readback reconciles
// the same candidate; absent confirmation retains uncertainty without another
// deployment. The implementation bounds those reads to ten attempts.
// An enabled normal release checks RPC inheritance before service writes. A
// later change can still stop the fee-converter upload at its own boundary.
// Retained-data freshness is an external validated input at the publication
// boundary. Its logical snapshot timestamps are checked under the shared
// production lock before service writes; the model does not prove transport.
module release_publication {
  type State = { stage: str, main: bool, manual: bool, retainedData: bool,
    proofs: bool, tested: bool, sourceMatches: bool, workers: bool, pages: bool, verified: bool,
    slopbotEnabled: bool, earlierWorker: bool, secretPhase: str, privateFile: bool,
    uploaded: bool, secretIncluded: bool, versionValidated: bool, activation: str,
    rpcRotation: str, converterEnabled: bool, inheritanceChecked: bool }
  var s: State
  action init = s' = { stage: "new", main: false, manual: false, retainedData: false,
    proofs: false, tested: false, sourceMatches: true, workers: false, pages: false, verified: false,
    slopbotEnabled: true, earlierWorker: false, secretPhase: "none", privateFile: false,
    uploaded: false, secretIncluded: false, versionValidated: false, activation: "none", rpcRotation: "normal",
    converterEnabled: true, inheritanceChecked: false }
  pure def failed(value: State): State = value.with("stage",
    if (not(value.pages) and (value.earlierWorker or value.uploaded or value.workers)) "partial-failure" else "failed")
  action disableSlopbot = all { s.stage == "new", s' = s.with("slopbotEnabled", false) }
  action disableConverter = all { s.stage == "new", s' = s.with("converterEnabled", false) }
  action requestRpcRotation = all { s.stage == "new", s.rpcRotation == "normal",
    s' = s.with("rpcRotation", "requested") }
  action prepare(main, manual, retainedData) = all {
    s.stage == "new", retainedData implies manual, s.rpcRotation != "normal" implies (main and manual),
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
  pure def inheritanceReady(value: State): bool = not(value.converterEnabled) or value.inheritanceChecked
  action checkRpcInheritance(ok: bool): bool = all {
    s.stage == "tested", s.main, s.sourceMatches, s.rpcRotation == "normal", s.converterEnabled,
    not(s.inheritanceChecked),
    s' = if (ok) s.with("inheritanceChecked", true) else failed(s) }
  action refuseChangedRpcInheritance = all {
    s.stage == "tested", s.converterEnabled, s.inheritanceChecked,
    s.rpcRotation == "normal", s.earlierWorker,
    s' = failed(s) }
  // The shared publication step may write other services before Slopbot.
  action publishEarlierWorker = all { s.stage == "tested", s.main, s.sourceMatches,
    not(s.earlierWorker), s.rpcRotation == "normal", inheritanceReady(s), s.secretPhase == "none", s' = s.with("earlierWorker", true) }
  action readExistingInventory(valid: bool): bool = all {
    s.stage == "tested", s.main, s.sourceMatches, s.slopbotEnabled, s.rpcRotation == "normal", inheritanceReady(s), s.secretPhase == "none",
    s' = if (valid) s.with("secretPhase", "inventory") else failed(s) }
  action allocateSecretFile = all { s.stage == "tested", s.secretPhase == "inventory",
    s' = s.with("secretPhase", "allocated").with("privateFile", true) }
  action writeProtectedSecret(present: bool): bool = all {
    s.stage == "tested", s.secretPhase == "allocated", s.privateFile,
    s' = if (present) s.with("secretPhase", "prepared") else failed(s) }
  action uploadVersion(included: bool, capturedId: bool): bool = all {
    s.stage == "tested", s.main, s.sourceMatches, s.rpcRotation == "normal", s.secretPhase == "prepared", s.privateFile,
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
    s.stage == "tested", s.main, s.sourceMatches, s.slopbotEnabled, s.rpcRotation == "normal",
    s.activation == "none", s.uploaded, s.secretIncluded, s.versionValidated, not(s.privateFile),
    s' = if (confirmed) s.with("activation", "confirmed") else failed(s.with("activation", "uncertain")) }
  action publishWorkers = all { s.stage == "tested", s.main, s.sourceMatches, s.rpcRotation == "normal", inheritanceReady(s),
    not(s.slopbotEnabled) or (s.activation == "confirmed" and s.uploaded and s.secretIncluded and s.versionValidated and not(s.privateFile)),
    s' = s.with("stage", "workers").with("workers", true) }
  action qualifyRpcRotation(ok: bool): bool = all {
    s.stage == "tested", s.main, s.manual, s.sourceMatches, s.rpcRotation == "requested",
    s' = if (ok) s.with("rpcRotation", "qualified").with("secretPhase", "inventory") else failed(s) }
  action uploadRpcRotation(baseStillActiveAndLatest: bool): bool = all {
    s.stage == "tested", s.sourceMatches, s.rpcRotation == "qualified",
    s.secretPhase == "prepared", s.privateFile,
    s' = if (baseStillActiveAndLatest)
      s.with("rpcRotation", "uploaded").with("uploaded", true).with("secretIncluded", true).with("secretPhase", "uploaded")
      else failed(s) }
  action promoteRpcRotation(baseStillActiveAndCandidateLatest: bool, confirmed: bool): bool = all {
    s.stage == "tested", s.sourceMatches, s.rpcRotation == "uploaded",
    s.versionValidated, not(s.privateFile),
    s' = if (baseStillActiveAndCandidateLatest)
      if (confirmed) s.with("rpcRotation", "confirmed").with("stage", "rpc-confirmed")
      else failed(s.with("rpcRotation", "uncertain"))
      else failed(s) }
  action reconcileRpcRotation(confirmed: bool): bool = all {
    s.stage == "partial-failure", s.rpcRotation == "uncertain",
    s.uploaded, s.versionValidated, not(s.privateFile),
    s' = if (confirmed) s.with("rpcRotation", "confirmed").with("stage", "rpc-confirmed") else s }
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
    requestRpcRotation, disableConverter, disableSlopbot, proofsPass, qualify, advanceSource, supersede, publishEarlierWorker,
    { nondet inheritanceOk = Set(false, true).oneOf()
      checkRpcInheritance(inheritanceOk) },
    refuseChangedRpcInheritance,
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
    { nondet ready = Set(false, true).oneOf()
      qualifyRpcRotation(ready) },
    { nondet prior = Set(false, true).oneOf()
      uploadRpcRotation(prior) },
    { nondet prior = Set(false, true).oneOf()
      nondet confirmed = Set(false, true).oneOf()
      promoteRpcRotation(prior, confirmed) },
    { nondet confirmed = Set(false, true).oneOf()
      reconcileRpcRotation(confirmed) },
    publishWorkers, partialFailure, publishPages, verifyBytesAndMetadata, providerFailure
  }

  val invariant = all {
    s.workers implies (s.main and s.tested),
    (s.workers or s.earlierWorker) implies inheritanceReady(s),
    s.workers and s.slopbotEnabled implies (s.uploaded and s.secretIncluded and s.versionValidated and not(s.privateFile)),
    s.versionValidated implies (s.uploaded and s.secretIncluded),
    s.activation != "none" implies (s.slopbotEnabled and s.uploaded and s.secretIncluded and s.versionValidated and not(s.privateFile)),
    s.tested implies s.proofs,
    s.verified implies (s.workers and s.pages and s.sourceMatches),
    s.stage == "superseded" implies (not(s.pages) and not(s.workers) and not(s.earlierWorker) and not(s.uploaded)),
    s.stage == "partial-failure" implies ((s.workers or s.earlierWorker or s.uploaded) and not(s.pages) and not(s.verified)),
    s.retainedData implies s.manual,
    s.rpcRotation != "normal" implies (not(s.earlierWorker) and not(s.workers) and not(s.pages)),
    s.rpcRotation.in(Set("confirmed", "uncertain")) implies
      (s.main and s.manual and s.tested and s.uploaded and s.versionValidated and not(s.privateFile)),
  }
  action qualifyNormal = qualify.then(checkRpcInheritance(true))
  action prepareSecretFile(inventoryOk: bool, protectedKeyPresent: bool): bool =
    if (inventoryOk) readExistingInventory(true).then(allocateSecretFile).then(writeProtectedSecret(protectedKeyPresent))
    else readExistingInventory(false)
  action preparedVersion = prepareSecretFile(true, true).then(uploadVersion(true, true)).then(cleanupSecretFile)
  action checkedVersion = preparedVersion.then(validateVersion(true, true)).then(promoteSlopbot(true))
  run exactReleaseTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(checkedVersion).then(publishWorkers).then(publishPages).then(verifyBytesAndMetadata).expect(s.verified)
  run supersededBeforeWriteTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualify)
    .then(advanceSource).then(supersede).expect(not(s.workers) and not(s.pages))
  run partialServicePublicationTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(checkedVersion).then(publishWorkers).then(advanceSource).then(partialFailure).expect(not(s.verified))
  run retainedSnapshotIsExplicitTest = init.then(prepare(true, true, true)).then(proofsPass).then(qualifyNormal)
    .then(checkedVersion).then(publishWorkers).then(publishPages).then(verifyBytesAndMetadata).expect(s.retainedData and s.verified)
  // A manual development (staging) release may retain staging's own published data;
  // it still passes every proof and quality gate and never reaches production services.
  run stagingRetainedSnapshotQualifiesTest = init.then(prepare(false, true, true)).then(proofsPass).then(qualify)
    .expect(s.retainedData and not(s.main) and s.tested).then(publishWorkers.fail())
  run retainedSnapshotNeedsManualTest = init.then(prepare(true, false, true).fail())
  run pendingProofCannotQualifyTest = init.then(prepare(true, false, false)).then(qualify.fail())
  run missingProtectedSecretNeverUploadsTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(prepareSecretFile(true, false)).then(cleanupSecretFile)
    .expect(not(s.uploaded) and not(s.workers) and not(s.privateFile) and s.stage == "failed")
  run wrongExistingInventoryNeverUploadsTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(prepareSecretFile(false, true)).expect(not(s.uploaded) and not(s.privateFile))
  run earlierWritesRemainPartialOnSecretRefusalTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(publishEarlierWorker).then(prepareSecretFile(true, false))
    .expect(s.earlierWorker and s.stage == "partial-failure" and not(s.workers) and not(s.verified))
  run missingVersionBindingCannotPromoteTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(prepareSecretFile(true, true)).then(uploadVersion(false, true)).then(cleanupSecretFile)
    .then(validateVersion(true, false)).expect(s.uploaded and not(s.workers) and s.stage == "partial-failure")
  run metadataReadNeedsSecretFileCleanupTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(prepareSecretFile(true, true)).then(uploadVersion(true, true)).then(validateVersion(true, true).fail())
  run wrongVersionOrShaCannotPromoteTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(preparedVersion).then(validateVersion(false, true)).expect(not(s.workers) and not(s.versionValidated))
  run ambiguousUploadKeepsExternalWriteWithoutPromotionTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(prepareSecretFile(true, true)).then(uploadVersion(true, false)).then(cleanupSecretFile)
    .expect(s.uploaded and s.stage == "partial-failure" and not(s.workers) and not(s.privateFile))
  run cleanupFailureDoesNotValidateOrPromoteTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(prepareSecretFile(true, true)).then(uploadVersion(true, true)).then(secretCleanupFailure)
    .expect(s.privateFile and s.stage == "partial-failure" and not(s.versionValidated) and not(s.workers))
  run sourceAdvanceAfterUploadIsPartialTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(preparedVersion).then(advanceSource).then(partialFailure)
    .expect(s.uploaded and s.stage == "partial-failure" and not(s.verified))
  run disabledSlopbotDoesNotNeedOrMutateItsSecretTest = init.then(disableSlopbot).then(prepare(true, false, false))
    .then(proofsPass).then(qualifyNormal).then(publishWorkers).then(publishPages).then(verifyBytesAndMetadata)
    .expect(s.verified and not(s.uploaded) and not(s.privateFile))
  run deployErrorDoesNotInventRollbackOrConfirmationTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(preparedVersion).then(validateVersion(true, true)).then(promoteSlopbot(false))
    .expect(s.activation == "uncertain" and s.stage == "partial-failure" and not(s.workers) and not(s.verified))
  run emptyKeyAllocationStillNeedsExitCleanupTest = init.then(prepare(true, false, false)).then(proofsPass).then(qualifyNormal)
    .then(readExistingInventory(true)).then(allocateSecretFile).then(writeProtectedSecret(false))
    .expect(s.privateFile and s.stage == "failed").then(cleanupSecretFile).expect(not(s.privateFile))

  action rpcRotationIntent = requestRpcRotation.then(prepare(true, true, false)).then(proofsPass).then(qualify)
  action rpcCandidate = rpcRotationIntent.then(qualifyRpcRotation(true)).then(allocateSecretFile)
    .then(writeProtectedSecret(true)).then(uploadRpcRotation(true)).then(cleanupSecretFile)
    .then(validateVersion(true, true))
  run rpcRotationOnlyPublishesCandidateTest = init.then(rpcCandidate).then(promoteRpcRotation(true, true))
    .expect(s.rpcRotation == "confirmed" and not(s.workers) and not(s.pages))
  run rpcRotationMissingPreflightCannotUploadTest = init.then(rpcRotationIntent).then(qualifyRpcRotation(false))
    .expect(s.stage == "failed" and not(s.uploaded)).then(uploadRpcRotation(true).fail())
  run rpcRotationChangedVersionCannotPromoteTest = init.then(rpcCandidate).then(promoteRpcRotation(false, true))
    .expect(s.stage == "partial-failure" and s.rpcRotation == "uploaded")
  run rpcRotationAdvancedSourceCannotPromoteTest = init.then(rpcCandidate).then(advanceSource)
    .then(promoteRpcRotation(true, true).fail())
  run rpcRotationAmbiguousDeployRemainsUncertainTest = init.then(rpcCandidate).then(promoteRpcRotation(true, false))
    .expect(s.rpcRotation == "uncertain" and not(s.verified))
  run rpcRotationCommandFailureThenReadbackConfirmsTest = init.then(rpcCandidate).then(promoteRpcRotation(true, false))
    .then(reconcileRpcRotation(true)).expect(s.rpcRotation == "confirmed" and s.stage == "rpc-confirmed")
    .then(promoteRpcRotation(true, true).fail())
  run rpcRotationUnconfirmedReadbackCannotRedeployTest = init.then(rpcCandidate).then(promoteRpcRotation(true, false))
    .then(reconcileRpcRotation(false)).expect(s.rpcRotation == "uncertain" and s.stage == "partial-failure")
    .then(promoteRpcRotation(true, true).fail())
  run rpcRotationNeedsManualMainTest = init.then(requestRpcRotation).then(prepare(false, true, false).fail())
  run rpcRotationCannotWriteOtherServicesTest = init.then(rpcRotationIntent).then(publishEarlierWorker.fail())

  run inheritedRpcMismatchStopsBeforeWritesTest = init.then(prepare(true, false, false)).then(proofsPass)
    .then(qualify).then(checkRpcInheritance(false)).expect(s.stage == "failed" and not(s.earlierWorker) and not(s.uploaded))
  run changedRpcInheritanceStillStopsUploadTest = init.then(prepare(true, false, false)).then(proofsPass)
    .then(qualifyNormal).then(publishEarlierWorker).then(refuseChangedRpcInheritance)
    .expect(s.stage == "partial-failure" and not(s.workers))
  run disabledConverterDoesNotRequireInheritanceTest = init.then(disableConverter).then(disableSlopbot)
    .then(prepare(true, false, false)).then(proofsPass).then(qualify).then(publishEarlierWorker)
    .expect(s.earlierWorker and not(s.inheritanceChecked))
}
