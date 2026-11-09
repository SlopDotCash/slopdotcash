// @source backend/referrals/cache.ts
// @source workers/referral-accrual/chain-logs.ts
// @source contracts/evm/adapter.ts
// @source contracts/evm/src/ReferralDistributor.sol
// @evidence workers/referral-accrual/anvil.integration.ts
// PRD11 deferred referrals; this is a read-only projection, not activation.
// One refresh, two epochs/wallets/root identities, totals 0..4 per root/wallet,
// total claimed 0..8, three finalized block/time classes, at most eight events.
// The event bound is finite exploration only; production scans every configured
// page without an event-count cap. Event bytes, root/period journal identity,
// canonical transaction inclusion and exact last-epoch tuple comparison are
// predicates. The referral_distribution model owns contract-level eligibility.
// This model intentionally adds no claim/void eligibility check absent from
// the projector: canonical receipts and the real contract supply those facts.
// Block IDs also label ordered timestamp classes. The concrete postedAt plus
// 0/604800-second equality is supplied by lastMatches, not arithmetic on these
// labels. Arbitrary event inputs deliberately overapproximate histories the
// real contract could emit; scenarios establish projector behavior, not an
// on-chain construction of every input combination.
//
// Sorted in-range returned logs are an RPC boundary, not proof that a provider
// returned every event. Each log still requires successful canonical receipt,
// exact distributor/log bytes, nonremoved status and a bounded finalized block.
// Local changes remain unpublished until latest-state coverage and a final
// header recheck pass. Latest eth_call can refuse; it is never finality proof.
// Coverage checks epoch count, aggregate claims, pause, exact last epoch,
// current-root tuple, valid current/legacy delay, and unrescued funding. It does
// not establish completeness of every historical event with equivalent state.
// Any observed Rescued event makes the cached ended flag sticky, as in source.
// Legacy Unpaused may extend an epoch; current zero-delay unpause names none.
// Cache write concurrency and failures are in referral_cache_write_order.
// No provider/test/model execution occurred; examples below are unexecuted.
module referral_cache_projection {
  val ids = Set(1, 2)
  val epochs = Set(0, 1)
  val amounts = Set(0, 1, 2, 3, 4)
  type Epoch = { present: bool, root: int, total: int, claimAt: int, voided: bool }
  type Snapshot = { block: int, count: int, epochs: int -> Epoch, claimed: int -> int,
    paused: bool, pauseAt: int, ended: bool }
  val noEpoch: Epoch = { present: false, root: 0, total: 0, claimAt: 0, voided: false }
  val empty: Snapshot = { block: 0, count: 0, epochs: epochs.mapBy(_ => noEpoch),
    claimed: ids.mapBy(_ => 0), paused: false, pauseAt: 0, ended: false }
  var s: { phase: str, saved: Snapshot, base: Snapshot, local: Snapshot, finalBlock: int,
    pendingKind: str, eventBlock: int, eventIndex: int, events: int,
    coverage: bool, finalHeader: bool, published: bool }
  action init = s' = { phase: "idle", saved: empty, base: empty, local: empty, finalBlock: 0,
    pendingKind: "none", eventBlock: 0, eventIndex: 0, events: 0,
    coverage: false, finalHeader: false, published: false }
  action seedPrior = all { s.phase == "idle",
    s' = s.with("saved", empty.with("block", 1).with("count", 1)
      .with("epochs", empty.epochs.set(0, { present: true, root: 1, total: 2, claimAt: 1, voided: false }))
      .with("claimed", empty.claimed.set(1, 1))) }
  action begin(block: int): bool = all { s.phase == "idle", Set(1, 2, 3).contains(block),
    s' = s.with("phase", "admit").with("finalBlock", block).with("base", s.saved).with("local", s.saved)
      .with("eventBlock", s.saved.block).with("eventIndex", 0) }
  action admission(configAndPriorMatch: bool): bool = all { s.phase == "admit",
    s' = s.with("phase", if (configAndPriorMatch and s.finalBlock >= s.saved.block) "logs" else "failed") }
  action eventEvidence(kind: str, block: int, index: int, proof: str): bool = all {
    s.phase == "logs", s.events < 8,
    Set("root", "void", "claim", "pause", "unpause", "rescue").contains(kind),
    Set(1, 2, 3).contains(block), Set(0, 1, 2).contains(index),
    block > s.saved.block, block <= s.finalBlock,
    block > s.eventBlock or (block == s.eventBlock and index >= s.eventIndex),
    Set("canonical", "removed", "failed", "wrong-log", "wrong-block").contains(proof),
    s' = s.with("phase", if (proof == "canonical") "apply" else "failed")
      .with("pendingKind", kind).with("eventBlock", block).with("eventIndex", index).with("events", s.events + 1) }
  action root(epoch: int, rootId: int, total: int, claimAt: int, journalMatches: bool): bool = all {
    s.phase == "apply", s.pendingKind == "root", epochs.contains(epoch), ids.contains(rootId),
    amounts.contains(total), Set(1, 2, 3, 4).contains(claimAt),
    s' = if (journalMatches and epoch == s.local.count)
      s.with("phase", "logs").with("local", s.local.with("count", s.local.count + 1)
        .with("epochs", s.local.epochs.set(epoch, { present: true, root: rootId, total: total, claimAt: claimAt, voided: false })))
      else s.with("phase", "failed") }
  action voidRoot(epoch: int, rootId: int): bool = all { s.phase == "apply", s.pendingKind == "void",
    epochs.contains(epoch), ids.contains(rootId),
    s' = if (s.local.epochs.get(epoch).present and s.local.epochs.get(epoch).root == rootId)
      s.with("phase", "logs").with("local", s.local.with("epochs",
        s.local.epochs.set(epoch, s.local.epochs.get(epoch).with("voided", true))))
      else s.with("phase", "failed") }
  action claim(actor: int, epoch: int, amount: int, cumulative: int): bool = all {
    s.phase == "apply", s.pendingKind == "claim", ids.contains(actor), epochs.contains(epoch),
    amounts.contains(amount), amounts.contains(cumulative),
    s' = if (s.local.epochs.get(epoch).present and amount > 0 and cumulative - s.local.claimed.get(actor) == amount)
      s.with("phase", "logs").with("local", s.local.with("claimed", s.local.claimed.set(actor, cumulative)))
      else s.with("phase", "failed") }
  action pause = all { s.phase == "apply", s.pendingKind == "pause",
    s' = s.with("phase", "logs").with("local", s.local.with("paused", true).with("pauseAt", s.eventBlock)) }
  // Epoch 2 is the uint256 NONE sentinel, not a third epoch.
  action unpause(epoch: int, claimAt: int): bool = {
    val known = if (epoch == 2) true else s.local.epochs.get(epoch).present
    all { s.phase == "apply", s.pendingKind == "unpause",
      Set(0, 1, 2).contains(epoch), Set(1, 2, 3, 4).contains(claimAt),
      s' = if (not(known)) s.with("phase", "failed")
        else s.with("phase", "logs").with("local", s.local.with("paused", false).with("pauseAt", 0)
          .with("epochs", if (epoch == 2) s.local.epochs
            else s.local.epochs.set(epoch, s.local.epochs.get(epoch).with("claimAt", claimAt)))) }
  }
  action rescue = all { s.phase == "apply", s.pendingKind == "rescue",
    s' = s.with("phase", "logs").with("local", s.local.with("ended", true)) }
  action finishLogs = all { s.phase == "logs",
    s' = s.with("phase", "coverage").with("local", s.local.with("block", s.finalBlock)) }
  def eligible(epoch: int): bool = {
    val entry = s.local.epochs.get(epoch)
    entry.present and not(entry.voided) and entry.claimAt <= s.finalBlock
      and not(s.local.paused and entry.claimAt > s.local.pauseAt)
  }
  def activeEpoch: int = if (eligible(1)) 2 else if (eligible(0)) 1 else 0
  def totalClaimed: int = s.local.claimed.get(1) + s.local.claimed.get(2)
  def maximum: int = {
    val first = if (s.local.epochs.get(0).present and not(s.local.epochs.get(0).voided)) s.local.epochs.get(0).total else 0
    val second = if (s.local.epochs.get(1).present and not(s.local.epochs.get(1).voided)) s.local.epochs.get(1).total else 0
    if (first > second) first else second
  }
  action coverage(count: int, claimed: int, paused: bool, active: int, lastMatches: bool, delay: int, balance: int): bool = {
    val verified = count == s.local.count and claimed == totalClaimed and paused == s.local.paused
      and active == activeEpoch and (s.local.count == 0 or lastMatches) and Set(0, 1).contains(delay)
      and (s.local.ended or balance + claimed >= maximum)
    all { s.phase == "coverage", Set(0, 1, 2).contains(count), 0.to(8).contains(claimed),
      Set(0, 1, 2).contains(active), Set(0, 1, 2).contains(delay), 0.to(8).contains(balance),
      s' = s.with("phase", if (verified) "header" else "failed").with("coverage", verified) }
  }
  action finalHeader(matches: bool): bool = all { s.phase == "header",
    s' = s.with("phase", if (matches) "ready" else "failed").with("finalHeader", matches) }
  action publish = all { s.phase == "ready",
    s' = s.with("saved", s.local).with("published", true).with("phase", "done") }
  action unavailable = all { not(Set("idle", "failed", "done").contains(s.phase)), s' = s.with("phase", "failed") }
  action step = {
    nondet id = ids.oneOf()
    nondet epoch = epochs.oneOf()
    nondet count = Set(0, 1, 2).oneOf()
    nondet block = Set(1, 2, 3).oneOf()
    nondet claimAt = Set(1, 2, 3, 4).oneOf()
    nondet amount = amounts.oneOf()
    nondet cumulative = amounts.oneOf()
    nondet total = 0.to(8).oneOf()
    nondet balance = 0.to(8).oneOf()
    nondet active = Set(0, 1, 2).oneOf()
    nondet delay = Set(0, 1, 2).oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet kind = Set("root", "void", "claim", "pause", "unpause", "rescue").oneOf()
    nondet proof = Set("canonical", "removed", "failed", "wrong-log", "wrong-block").oneOf()
    any { seedPrior, begin(block), admission(yes), eventEvidence(kind, block, count, proof), root(epoch, id, amount, claimAt, yes),
      voidRoot(epoch, id), claim(id, epoch, amount, cumulative), pause, unpause(count, claimAt), rescue, finishLogs,
      coverage(count, total, yes, active, other, delay, balance), finalHeader(yes), publish, unavailable, s' = s }
  }
  val invariant = all { s.local.count <= 2, s.saved.count <= 2, s.events <= 8,
    s.published implies s.coverage and s.finalHeader and s.saved == s.local and s.saved.block == s.finalBlock,
    s.phase != "idle" and not(s.published) implies s.saved == s.base,
    s.phase == "failed" implies not(s.published) }
  action started = begin(3).then(admission(true))
  action rootOne = eventEvidence("root", 1, 0, "canonical").then(root(0, 1, 2, 1, true))
  action rootTwo = eventEvidence("root", 2, 0, "canonical").then(root(1, 2, 4, 2, true))
  action accept(count: int, claimed: int, paused: bool, active: int, balance: int): bool =
    finishLogs.then(coverage(count, claimed, paused, active, true, 0, balance)).then(finalHeader(true)).then(publish)
  run completeRootAndClaimProjectionPublishesTest = init.then(started).then(rootOne)
    .then(eventEvidence("claim", 2, 0, "canonical")).then(claim(1, 0, 1, 1)).then(accept(1, 1, false, 1, 1))
    .expect(s.published and s.saved.claimed.get(1) == 1 and invariant)
  run emptyProjectionHasNoLastEpochToCompareTest = init.then(started).then(finishLogs)
    .then(coverage(0, 0, false, 0, false, 0, 0)).then(finalHeader(true)).then(publish)
    .expect(s.published and s.saved.count == 0 and invariant)
  run voidedLatestRootRetainsEarlierRootTest = init.then(started).then(rootOne).then(rootTwo)
    .then(eventEvidence("void", 3, 0, "canonical")).then(voidRoot(1, 2)).then(accept(2, 0, false, 1, 2))
    .expect(s.saved.epochs.get(1).voided and invariant)
  run duplicateRootFailsBeforePublishingPartialStateTest = init.then(started).then(rootOne)
    .then(eventEvidence("root", 1, 0, "canonical")).then(root(0, 1, 2, 1, true))
    .expect(s.phase == "failed" and s.saved.count == 0 and invariant)
  run duplicateClaimCannotDoubleCountTest = init.then(started).then(rootOne)
    .then(eventEvidence("claim", 2, 0, "canonical")).then(claim(1, 0, 1, 1))
    .then(eventEvidence("claim", 2, 0, "canonical")).then(claim(1, 0, 1, 1))
    .expect(s.phase == "failed" and s.saved.claimed.get(1) == 0 and invariant)
  run rootWithoutExactFiledJournalRefusesTest = init.then(started).then(eventEvidence("root", 1, 0, "canonical"))
    .then(root(0, 1, 2, 1, false)).expect(s.phase == "failed" and invariant)
  run removedLogDoesNotMutateProjectionTest = init.then(started).then(eventEvidence("root", 1, 0, "removed"))
    .expect(s.phase == "failed" and s.local.count == 0 and invariant)
  run failedReceiptDoesNotProveEventTest = init.then(started).then(eventEvidence("root", 1, 0, "failed"))
    .expect(s.phase == "failed" and s.local.count == 0 and invariant)
  run exactLogMismatchRefusesTest = init.then(started).then(eventEvidence("root", 1, 0, "wrong-log"))
    .expect(s.phase == "failed" and invariant)
  run missingRootCaughtByLatestCountTest = init.then(started).then(finishLogs).then(coverage(1, 0, false, 1, true, 0, 2))
    .expect(s.phase == "failed" and not(s.published) and invariant)
  run missingClaimCaughtByAggregateCounterTest = init.then(started).then(rootOne).then(finishLogs)
    .then(coverage(1, 1, false, 1, true, 0, 1)).expect(s.phase == "failed" and invariant)
  run latestPauseDisagreementRefusesTest = init.then(started).then(rootOne).then(finishLogs)
    .then(coverage(1, 0, true, 1, true, 0, 2)).expect(s.phase == "failed" and invariant)
  run unknownExtendedEpochRefusesTest = init.then(started).then(eventEvidence("unpause", 2, 0, "canonical"))
    .then(unpause(1, 3)).expect(s.phase == "failed" and invariant)
  run currentUnpauseSentinelDoesNotAddDelayTest = init.then(started).then(rootOne)
    .then(eventEvidence("pause", 2, 0, "canonical")).then(pause)
    .then(eventEvidence("unpause", 3, 0, "canonical")).then(unpause(2, 4)).then(accept(1, 0, false, 1, 2))
    .expect(s.saved.epochs.get(0).claimAt == 1 and not(s.saved.paused) and invariant)
  run pausedFutureEpochDoesNotMatureTest = init.then(started).then(rootOne)
    .then(eventEvidence("root", 1, 1, "canonical")).then(root(1, 2, 4, 2, true))
    .then(eventEvidence("pause", 1, 2, "canonical")).then(pause).then(accept(2, 0, true, 1, 4))
    .expect(activeEpoch == 1 and s.saved.paused and invariant)
  run retainedRescueAllowsUnderfundedEndedProjectionTest = init.then(started).then(rootOne)
    .then(eventEvidence("rescue", 2, 0, "canonical")).then(rescue).then(accept(1, 0, false, 1, 0))
    .expect(s.saved.ended and invariant)
  run unrescuedBalanceMismatchRefusesTest = init.then(started).then(rootOne).then(finishLogs)
    .then(coverage(1, 0, false, 1, true, 0, 0)).expect(s.phase == "failed" and invariant)
  run finalHeaderChangeKeepsPreviousCursorTest = init.then(seedPrior).then(started).then(finishLogs)
    .then(coverage(1, 1, false, 1, true, 0, 1)).then(finalHeader(false))
    .expect(s.phase == "failed" and s.saved.block == 1 and s.saved.claimed.get(1) == 1 and invariant)
  run legacyDelayClassIsAcceptedOnlyWithMatchingLastEpochTest = init.then(started).then(rootOne).then(finishLogs)
    .then(coverage(1, 0, false, 1, true, 1, 2)).then(finalHeader(true)).then(publish)
    .expect(s.published and invariant)
  run legacyUnpauseMayExtendRetainedEpochTest = init.then(started).then(rootOne)
    .then(eventEvidence("pause", 2, 0, "canonical")).then(pause)
    .then(eventEvidence("unpause", 3, 0, "canonical")).then(unpause(0, 4)).then(finishLogs)
    .then(coverage(1, 0, false, 0, true, 1, 2)).then(finalHeader(true)).then(publish)
    .expect(s.saved.epochs.get(0).claimAt == 4 and activeEpoch == 0 and invariant)
  run twoWalletCountersMustMatchTheAggregateTest = init.then(started).then(rootOne).then(rootTwo)
    .then(eventEvidence("claim", 2, 1, "canonical")).then(claim(1, 1, 1, 1))
    .then(eventEvidence("claim", 3, 0, "canonical")).then(claim(2, 1, 1, 1))
    .then(accept(2, 2, false, 2, 2)).expect(s.saved.claimed.get(1) == 1 and s.saved.claimed.get(2) == 1 and invariant)
  run wrongCurrentRootRefusesEvenWithMatchingCountTest = init.then(started).then(rootOne).then(finishLogs)
    .then(coverage(1, 0, false, 0, true, 0, 2)).expect(s.phase == "failed" and invariant)
  run changedLastEpochTupleRefusesTest = init.then(started).then(rootOne).then(finishLogs)
    .then(coverage(1, 0, false, 1, false, 0, 2)).expect(s.phase == "failed" and invariant)
  run unsupportedClaimDelayRefusesTest = init.then(started).then(rootOne).then(finishLogs)
    .then(coverage(1, 0, false, 1, true, 2, 2)).expect(s.phase == "failed" and invariant)
}
