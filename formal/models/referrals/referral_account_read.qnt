// @source backend/referrals/claims.ts
// @source backend/referrals/cache.ts
// @source src/lib/referral-claims.ts
// @source workers/referral-accrual/merkle.ts
// @source migrations/0086_referral_accruals.sql
// @evidence backend/referrals/claims.test.ts
// PRD11 referrals remain deferred. No action activates or funds the program.
// One HTTP read, two actors and immutable wallet pins, two epochs/root files,
// two cache snapshots, amounts 0..6 and time classes 0..4. An age of two means
// exactly48h; only an age greater than two is stale. Full integer/schema/hash
// grammar and Merkle arithmetic are supplied predicates, not proved here.
//
// Session actor, cache row, latest live file, wallet pin and matching root file
// are separate awaited reads. Actor is captured once; a later cookie change
// does not retarget this response. Pins and filed records cannot be rewritten.
// A later cache or file append does not mutate this read's captured snapshot.
// Freshness is checked before the root-file await, not at HTTP completion.
// Both snapshot observation time and finalized block time must pass that check.
// activeClaimEpoch uses captured finalized time, not the moving server clock.
//
// Unknown body means null monetary evidence, not zero. No row or no live file
// hides the program. With a body, stale/paused/ended evidence still reports
// verified historical amounts and a proof. Those are display data, not claim
// authorization: reviewReferralClaim also requires fresh ready, unpaused,
// unended, positive evidence and performs independent live wallet/RPC checks.
// Existing referral_claim_review/UI models own those later actions.
//
// The current-root file matches period/root/total; its selected record must
// match captured actor AND pinned wallet. Only a positive unclaimed cumulative
// leaf creates a claim. Missing files, invalid proof/schema, or totals beyond
// accrued refuse the entire known-body response. No API/storage mutation is
// represented. All scenarios and related regression definitions are unexecuted.
module referral_account_read {
  val actors = Set(1, 2)
  val epochIds = Set(0, 1)
  type Epoch = { claimAt: int, voided: bool }
  type Snapshot = { identity: int, body: bool, observed: int, finalized: int,
    error: bool, paused: bool, latestPaused: bool, pauseAt: int, ended: bool,
    epochs: int -> Epoch, claimed: int -> int }
  val baseline: Snapshot = { identity: 1, body: true, observed: 1, finalized: 1,
    error: false, paused: false, latestPaused: false, pauseAt: 0, ended: false,
    epochs: epochIds.mapBy(epoch => { claimAt: if (epoch == 0) 1 else 3, voided: false }),
    claimed: actors.mapBy(actor => if (actor == 1) 1 else 0) }
  type State = { phase: str, clock: int, cookie: int, cachePresent: bool, cache: Snapshot,
    live: bool, accrued: int -> int, pins: int -> int, fileExists: bool,
    recordMatches: bool, leaf: bool, proofValid: bool, schemaValid: bool, cumulative: int,
    actor: int, captured: Snapshot, capturedAccrued: int, wallet: int, checkedAt: int,
    root: int, pendingRoot: bool, claimed: int, claimable: int, pending: int,
    claim: bool, proofWallet: int, paused: bool, ended: bool, latestVoided: bool,
    status: str, http: int, delivered: bool }
  var s: State
  action init = s' = { phase: "idle", clock: 1, cookie: 1, cachePresent: true, cache: baseline,
    live: true, accrued: actors.mapBy(actor => if (actor == 1) 4 else 2), pins: actors.mapBy(actor => actor), fileExists: true,
    recordMatches: true, leaf: true, proofValid: true, schemaValid: true, cumulative: -1,
    actor: 0, captured: baseline, capturedAccrued: 0, wallet: 0, checkedAt: 0,
    root: 0, pendingRoot: false, claimed: -1, claimable: -1, pending: -1,
    claim: false, proofWallet: 0, paused: false, ended: false, latestVoided: false,
    status: "none", http: 0, delivered: false }
  def failed: State = s.with("phase", "reply").with("http", 500).with("status", "error").with("claim", false)
  action noCache = all { s.phase == "idle", s' = s.with("cachePresent", false) }
  action unknownBody = all { s.phase == "idle", s' = s.with("cache", s.cache.with("body", false)) }
  action noLiveFile = all { s.phase == "idle", s' = s.with("live", false) }
  action walletless = all { s.phase == "idle", s' = s.with("pins", s.pins.set(1, 0)) }
  action sourceFlags(error: bool, paused: bool, latestPaused: bool, ended: bool): bool = all { s.phase == "idle",
    s' = s.with("cache", s.cache.with("error", error).with("paused", paused)
      .with("latestPaused", latestPaused).with("pauseAt", if (paused) 1 else 0).with("ended", ended)) }
  action timestamps(observed: int, finalized: int): bool = all { s.phase == "idle",
    0.to(3).contains(observed), 0.to(3).contains(finalized),
    s' = s.with("cache", s.cache.with("observed", observed).with("finalized", finalized)) }
  action voidLatest = all { s.phase == "idle", s' = s.with("cache", s.cache.with("epochs",
    s.cache.epochs.set(1, s.cache.epochs.get(1).with("voided", true)))) }
  action voidAll = all { s.phase == "idle", s' = s.with("cache", s.cache
    .with("epochs", epochIds.mapBy(epoch => s.cache.epochs.get(epoch).with("voided", true)))
    .with("claimed", actors.mapBy(_ => 0))) }
  action fileInput(fileAvailable: bool, matches: bool, leaf: bool, proof: bool, schema: bool, cumulative: int): bool = all {
    s.phase == "idle", (-1).to(6).contains(cumulative),
    s' = s.with("fileExists", fileAvailable).with("recordMatches", matches).with("leaf", leaf)
      .with("proofValid", proof).with("schemaValid", schema).with("cumulative", cumulative) }
  action lowAccrued = all { s.phase == "idle", s' = s.with("accrued", s.accrued.set(1, 1)) }
  action advanceClock = all { s.clock < 4, s' = s.with("clock", s.clock + 1) }
  action cookie(actor: int): bool = all { Set(0, 1, 2).contains(actor), s' = s.with("cookie", actor) }
  action appendLiveFile = s' = s.with("accrued", actors.mapBy(actor => if (actor == 1) 6 else 3))
  action replaceCache = all { s.clock >= 3, s.cache.identity == 1,
    s' = s.with("cache", s.cache.with("identity", 2).with("observed", 3).with("finalized", 3)
      .with("claimed", actors.mapBy(actor => if (actor == 1) 2 else 1))) }
  action begin(routeMatches: bool, isGet: bool): bool = all { s.phase == "idle",
    s' = if (not(routeMatches)) s.with("phase", "done").with("status", "not-handled")
      else if (not(isGet)) s.with("phase", "reply").with("http", 405).with("status", "method")
      else s.with("phase", "session") }
  action session = all { s.phase == "session",
    s' = if (s.cookie == 0) s.with("phase", "reply").with("http", 401).with("status", "signed-out")
      else s.with("actor", s.cookie).with("phase", "cache") }
  action readCache = all { s.phase == "cache",
    s' = if (not(s.cachePresent)) s.with("phase", "reply").with("http", 200).with("status", "disabled")
      else s.with("captured", s.cache).with("phase", "latest") }
  action readLatest = all { s.phase == "latest",
    s' = if (not(s.live)) s.with("phase", "reply").with("http", 200).with("status", "disabled")
      else s.with("capturedAccrued", s.accrued.get(s.actor)).with("phase", "pin") }
  action readPin = all { s.phase == "pin",
    s' = s.with("wallet", s.pins.get(s.actor))
      .with("phase", if (s.captured.body) "snapshot" else "reply")
      .with("http", if (s.captured.body) 0 else 200)
      .with("status", if (s.captured.body) "none" else "unknown") }
  def eligible(epoch: int): bool = {
    val entry = s.captured.epochs.get(epoch)
    not(entry.voided) and entry.claimAt <= s.captured.finalized
      and not(s.captured.paused and entry.claimAt > s.captured.pauseAt)
  }
  def activeRoot: int = if (eligible(1)) 2 else if (eligible(0)) 1 else 0
  action snapshot = {
    val root = activeRoot
    val paused = s.captured.paused or s.captured.latestPaused
    all { s.phase == "snapshot", s' = s.with("checkedAt", s.clock).with("root", root)
      .with("status", if (s.captured.error or s.clock - s.captured.observed > 2
        or s.clock - s.captured.finalized > 2) "stale" else "ready")
      .with("paused", paused).with("ended", s.captured.ended)
      .with("latestVoided", s.captured.epochs.get(1).voided)
      .with("pendingRoot", not(s.captured.epochs.get(1).voided) and root != 2 and not(paused))
      .with("claimed", if (s.wallet == 0) 0 else s.captured.claimed.get(s.wallet))
      .with("claimable", 0).with("phase", if (root != 0 and s.wallet != 0) "file" else "amounts") }
  }
  action readFile = {
    val ordinary = if (s.actor == 1) (if (s.root == 1) 2 else 4) else (if (s.root == 1) 1 else 2)
    val cumulative = if (s.cumulative == -1) ordinary else s.cumulative
    val positive = s.recordMatches and s.leaf and cumulative > s.claimed
    all { s.phase == "file", s' = if (not(s.fileExists)) failed
      else s.with("phase", "amounts").with("claim", positive)
        .with("proofWallet", if (positive) s.wallet else 0)
        .with("claimable", if (positive) cumulative - s.claimed else 0) }
  }
  action amounts = all { s.phase == "amounts",
    s' = if (s.claimed + s.claimable > s.capturedAccrued) failed
      else s.with("pending", s.capturedAccrued - s.claimed - s.claimable).with("phase", "parse") }
  action parse = all { s.phase == "parse",
    s' = if (not(s.schemaValid) or (s.claim and not(s.proofValid))) failed
      else s.with("phase", "reply").with("http", 200) }
  action databaseError = all { Set("session", "cache", "latest", "pin", "file").contains(s.phase), s' = failed }
  action reply(received: bool): bool = all { s.phase == "reply", s' = s.with("phase", "done").with("delivered", received) }
  val cachedReviewPrerequisites = s.delivered and s.http == 200 and s.status == "ready" and not(s.paused) and not(s.ended)
    and s.claim and s.claimable > 0 and s.clock - s.captured.observed <= 2 and s.clock - s.captured.finalized <= 2
  action step = {
    nondet yes = Set(false, true).oneOf()
    nondet second = Set(false, true).oneOf()
    nondet third = Set(false, true).oneOf()
    nondet fourth = Set(false, true).oneOf()
    nondet fifth = Set(false, true).oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet time = 0.to(3).oneOf()
    nondet otherTime = 0.to(3).oneOf()
    nondet value = (-1).to(6).oneOf()
    any { noCache, unknownBody, noLiveFile, walletless, sourceFlags(yes, second, third, fourth),
      timestamps(time, otherTime), voidLatest, voidAll, fileInput(yes, second, third, fourth, fifth, value), lowAccrued,
      advanceClock, cookie(actor), appendLiveFile, replaceCache, begin(yes, second), session,
      readCache, readLatest, readPin, snapshot, readFile, amounts, parse, databaseError, reply(yes), s' = s }
  }
  val invariant = all {
    s.status == "unknown" implies s.claimed == -1 and s.claimable == -1 and s.pending == -1 and not(s.claim),
    s.http == 200 and Set("ready", "stale").contains(s.status) and s.phase == "done" implies
      s.actor != 0 and s.claimed >= 0 and s.claimable >= 0 and s.pending >= 0
        and s.claimed + s.claimable + s.pending == s.capturedAccrued,
    s.delivered and s.http == 200 and s.claim implies s.wallet != 0 and s.proofWallet == s.wallet and s.proofValid,
    cachedReviewPrerequisites implies s.status == "ready" and not(s.paused) and not(s.ended) }
  action captured = begin(true, true).then(session).then(readCache).then(readLatest).then(readPin)
  action known = captured.then(snapshot)
  action finishFile = readFile.then(amounts).then(parse).then(reply(true))
  action readKnown = known.then(finishFile)
  run readyResponseConservesAmountsTest = init.then(readKnown)
    .expect(s.claimed == 1 and s.claimable == 1 and s.pending == 2 and cachedReviewPrerequisites and invariant)
  run missingCacheHidesProgramTest = init.then(noCache).then(begin(true, true)).then(session).then(readCache).then(reply(true))
    .expect(s.status == "disabled" and s.claimed == -1 and invariant)
  run missingLiveFileHidesProgramTest = init.then(noLiveFile).then(begin(true, true)).then(session).then(readCache).then(readLatest).then(reply(true))
    .expect(s.status == "disabled" and invariant)
  run bodylessCacheKeepsAmountsUnknownTest = init.then(unknownBody).then(captured).then(reply(true))
    .expect(s.status == "unknown" and s.wallet == 1 and s.capturedAccrued == 4 and invariant)
  run walletlessAccrualHasNoAddressInferenceTest = init.then(walletless).then(known).then(amounts).then(parse).then(reply(true))
    .expect(s.wallet == 0 and s.claimed == 0 and s.claimable == 0 and s.pending == 4 and not(s.claim) and invariant)
  run secondActorOnlyReceivesItsOwnPinnedLeafTest = init.then(cookie(2)).then(readKnown)
    .expect(s.actor == 2 and s.wallet == 2 and s.claimable == 1 and s.capturedAccrued == 2 and invariant)
  run cookieChangeDoesNotRetargetAdmittedReadTest = init.then(begin(true, true)).then(session).then(cookie(2))
    .then(readCache).then(readLatest).then(readPin).then(snapshot).then(finishFile)
    .expect(s.actor == 1 and s.wallet == 1 and s.cookie == 2 and invariant)
  run exactAgeBoundaryRemainsReadyTest = init.then(advanceClock).then(advanceClock).then(readKnown)
    .expect(s.clock == 3 and s.status == "ready" and s.root == 1 and invariant)
  run olderFinalizedClockAloneMakesResponseStaleTest = init.then(timestamps(1, 0)).then(advanceClock).then(advanceClock).then(readKnown)
    .expect(s.status == "stale" and s.claim and not(cachedReviewPrerequisites) and invariant)
  run olderObservedClockAloneMakesResponseStaleTest = init.then(timestamps(0, 1)).then(advanceClock).then(advanceClock).then(readKnown)
    .expect(s.status == "stale" and s.claim and invariant)
  run movingClockDoesNotMatureUnrefreshedRootTest = init.then(advanceClock).then(advanceClock).then(readKnown)
    .expect(s.root == 1 and s.pendingRoot and invariant)
  run pausedEndedStaleEvidenceStillDisplaysProofTest = init.then(sourceFlags(true, true, false, true)).then(readKnown)
    .expect(s.status == "stale" and s.paused and s.ended and s.claim and not(cachedReviewPrerequisites) and invariant)
  run latestPausePreventsReviewWithoutErasingClaimTest = init.then(sourceFlags(false, false, true, false)).then(readKnown)
    .expect(s.status == "ready" and s.paused and s.claim and not(s.pendingRoot) and not(cachedReviewPrerequisites) and invariant)
  run voidedLatestFallsBackToOlderRootTest = init.then(voidLatest).then(readKnown)
    .expect(s.root == 1 and s.latestVoided and not(s.pendingRoot) and invariant)
  run allVoidedRootsSkipFileAndKeepAccruedPendingTest = init.then(voidAll).then(known).then(amounts).then(parse).then(reply(true))
    .expect(s.root == 0 and not(s.claim) and s.claimed == 0 and s.pending == 4 and invariant)
  run missingMatchingRootFileRefusesResponseTest = init.then(fileInput(false, true, true, true, true, -1)).then(known).then(readFile).then(reply(true))
    .expect(s.http == 500 and not(s.claim) and invariant)
  run unmatchedActorWalletRecordCreatesNoClaimTest = init.then(fileInput(true, false, true, true, true, -1)).then(readKnown)
    .expect(not(s.claim) and s.claimable == 0 and s.pending == 3 and invariant)
  run absentLeafCreatesNoClaimTest = init.then(fileInput(true, true, false, true, true, -1)).then(readKnown)
    .expect(not(s.claim) and s.claimable == 0 and invariant)
  run alreadyClaimedCumulativeLeafCreatesNoClaimTest = init.then(fileInput(true, true, true, true, true, 1)).then(readKnown)
    .expect(not(s.claim) and s.claimable == 0 and s.pending == 3 and invariant)
  run invalidMerkleProofRefusesWholeResponseTest = init.then(fileInput(true, true, true, false, true, -1)).then(readKnown)
    .expect(s.http == 500 and not(s.claim) and invariant)
  run amountsBeyondAccrualRefuseResponseTest = init.then(lowAccrued).then(known).then(readFile).then(amounts).then(reply(true))
    .expect(s.http == 500 and not(s.claim) and invariant)
  run lateCacheReplacementCannotMixClaimedTotalsTest = init.then(known).then(advanceClock).then(advanceClock).then(replaceCache).then(finishFile)
    .expect(s.cache.identity == 2 and s.captured.identity == 1 and s.claimed == 1 and s.claimable == 1 and invariant)
  run latestFileAppendDoesNotReplaceCapturedAccrualTest = init.then(known).then(appendLiveFile).then(finishFile)
    .expect(s.capturedAccrued == 4 and s.accrued.get(1) == 6 and s.pending == 2 and invariant)
  run responseMayAgeAfterCapturedFreshnessCheckTest = init.then(known).then(advanceClock).then(advanceClock).then(advanceClock).then(finishFile)
    .expect(s.status == "ready" and not(cachedReviewPrerequisites) and invariant)
  run signedOutReadRefusesBeforePrivateCacheTest = init.then(cookie(0)).then(begin(true, true)).then(session).then(reply(true))
    .expect(s.http == 401 and s.actor == 0 and invariant)
  run wrongMethodRefusesBeforeSessionTest = init.then(begin(true, false)).then(reply(true))
    .expect(s.http == 405 and s.actor == 0 and invariant)
}
