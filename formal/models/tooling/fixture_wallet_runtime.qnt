// @source scripts/run-e2e.mjs
// @evidence tests/direct-bounty-chain.ts
// @evidence tests/e2e/bounty-full-flow.spec.ts
// @evidence tests/authorize-fixture-wallet.ts
// Wallet fixture lifecycle only: one disposable database/chain and two API
// changes. api_payment_wallet_protocol owns registration, challenge, signature,
// consumption and authorization details. Other test fixtures are not covered.
module fixture_wallet_runtime {
  var s: {
    phase: str, directory: bool, databaseReady: bool, chain: bool,
    seedWrites: int, requests: int, acknowledged: int, pending: bool, uncertain: bool,
    failed: bool, cleanupError: bool, chainCloseTried: bool,
    directoryRemoveTried: bool, passed: bool
  }

  action init = s' = {
    phase: "allocated", directory: true, databaseReady: false, chain: false,
    seedWrites: 0, requests: 0, acknowledged: 0, pending: false, uncertain: false,
    failed: false, cleanupError: false, chainCloseTried: false,
    directoryRemoveTried: false, passed: false
  }
  action prepareDatabase = all { s.phase == "allocated",
    s' = s.with("phase", "database").with("databaseReady", true) }
  action startChain = all { s.phase == "database",
    s' = s.with("phase", "chain").with("chain", true) }
  // This is the only direct wallet database write in these helpers.
  val canSeed = s.phase == "chain"
  action seedWallets = all { canSeed,
    s' = s.with("phase", "seeded").with("seedWrites", 1) }
  action startPages = all { s.phase == "seeded",
    s' = s.with("phase", "serving") }
  action requestWalletChange = all {
    s.phase == "serving", not(s.pending), s.requests < 2,
    s' = s.with("requests", s.requests + 1).with("pending", true)
  }
  // The API submodel decides whether the supplied signature authorizes the
  // current claim. A refusal fails the browser scenario rather than editing D1.
  action apiResult(accepted: bool): bool = all {
    s.phase == "serving", s.pending,
    s' = s.with("pending", false)
      .with("acknowledged", s.acknowledged + (if (accepted) 1 else 0))
      .with("failed", s.failed or not(accepted))
  }
  // runE2ePhase owns stopping Pages and draining its process group before the
  // fixture's finally block closes chain services and removes its directory.
  // A canceled pending call may already have changed its disposable database.
  // Closing the fixture does not convert the missing response into a refusal.
  action finishPages(success: bool): bool = all { s.phase == "serving",
    not(success) or not(s.pending),
    s' = s.with("phase", "cleanup").with("pending", false)
      .with("uncertain", s.uncertain or s.pending)
      .with("failed", s.failed or not(success)) }
  action setupFails = all {
    Set("allocated", "database", "chain", "seeded").contains(s.phase),
    s' = s.with("phase", "cleanup").with("failed", true)
  }
  action closeChain(success: bool): bool = all {
    s.phase == "cleanup", s.chain, not(s.chainCloseTried),
    s' = s.with("chainCloseTried", true).with("chain", not(success))
      .with("cleanupError", s.cleanupError or not(success))
  }
  // Promise.allSettled attempts directory removal after service-close attempts
  // even if a close failed. A cleanup error is retained in the final outcome.
  action removeDirectory(success: bool): bool = all {
    s.phase == "cleanup", not(s.directoryRemoveTried),
    not(s.chain) or s.chainCloseTried,
    s' = s.with("directoryRemoveTried", true).with("directory", not(success))
      .with("cleanupError", s.cleanupError or not(success))
  }
  action finish = all { s.phase == "cleanup", s.directoryRemoveTried,
    s' = s.with("phase", "done").with("passed",
      not(s.failed) and not(s.cleanupError) and not(s.uncertain) and
      not(s.directory) and not(s.chain)) }
  action step = any {
    prepareDatabase, startChain, seedWallets, startPages, requestWalletChange,
    apiResult(true), apiResult(false), finishPages(true), finishPages(false),
    setupFails, closeChain(true), closeChain(false),
    removeDirectory(true), removeDirectory(false), finish, s' = s
  }
  val invariant = all {
    s.seedWrites >= 0 and s.seedWrites <= 1,
    s.requests >= 0 and s.requests <= 2,
    s.acknowledged >= 0 and s.acknowledged <= s.requests,
    s.pending implies s.phase == "serving",
    s.phase == "serving" implies
      (s.seedWrites == 1 and s.databaseReady and s.chain and s.directory and not(canSeed)),
    s.passed implies
      (s.phase == "done" and not(s.failed) and not(s.cleanupError) and not(s.uncertain) and
       not(s.directory) and not(s.chain))
  }
  run seedPrecedesEveryServingTimeChangeTest = init.then(prepareDatabase)
    .then(startChain).then(seedWallets).then(startPages).expect(not(canSeed))
    .then(requestWalletChange).then(apiResult(true))
    .then(requestWalletChange).then(apiResult(true))
    .expect(s.seedWrites == 1 and s.acknowledged == 2)
  run completedWalletFlowCleansOwnedResourcesTest = init.then(prepareDatabase)
    .then(startChain).then(seedWallets).then(startPages)
    .then(requestWalletChange).then(apiResult(true)).then(finishPages(true))
    .then(closeChain(true)).then(removeDirectory(true)).then(finish)
    .expect(s.passed and not(s.directory) and not(s.chain))
  run refusedWalletCannotFallBackToDirectWriteTest = init.then(prepareDatabase)
    .then(startChain).then(seedWallets).then(startPages)
    .then(requestWalletChange).then(apiResult(false)).then(finishPages(false))
    .then(closeChain(true)).then(removeDirectory(true)).then(finish)
    .expect(not(s.passed) and s.acknowledged == 0 and s.seedWrites == 1)
  run pendingRequestDoesNotKeepPagesAliveTest = init.then(prepareDatabase)
    .then(startChain).then(seedWallets).then(startPages).then(requestWalletChange)
    .then(finishPages(false)).then(closeChain(true)).then(removeDirectory(true))
    .then(finish).expect(not(s.pending) and not(s.passed) and s.uncertain)
  run lostResponseDoesNotClaimRefusalTest = init.then(prepareDatabase)
    .then(startChain).then(seedWallets).then(startPages).then(requestWalletChange)
    .then(finishPages(false)).expect(s.uncertain and s.acknowledged == 0)
  run databaseSetupFailureStillRemovesDirectoryTest = init.then(setupFails)
    .then(removeDirectory(true)).then(finish).expect(not(s.directory) and not(s.passed))
  run failedSeedSetupClosesChainTest = init.then(prepareDatabase).then(startChain)
    .then(setupFails).then(closeChain(true)).then(removeDirectory(true)).then(finish)
    .expect(not(s.chain) and not(s.passed) and s.seedWrites == 0)
  run failedChainCloseRemainsAnErrorTest = init.then(prepareDatabase).then(startChain)
    .then(seedWallets).then(startPages).then(finishPages(true))
    .then(closeChain(false)).then(removeDirectory(true)).then(finish)
    .expect(not(s.passed) and s.cleanupError and s.chain)
  run failedDirectoryRemovalCannotPassTest = init.then(prepareDatabase)
    .then(startChain).then(seedWallets).then(startPages).then(finishPages(true))
    .then(closeChain(true)).then(removeDirectory(false)).then(finish)
    .expect(not(s.passed) and s.cleanupError and s.directory)
}
