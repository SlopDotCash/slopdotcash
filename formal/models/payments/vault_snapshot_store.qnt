// @source backend/payments/vault-snapshots.ts
// @source backend/payments/verified-evidence.ts
// @evidence backend/payments/vault-snapshots.test.ts
// Two callers, at most two calls each, blocks/timestamps/counters 0..3.
// Two representative cumulative fields stand for the same independent check
// on all five production counters; one nullable current field can decrease.
// Network/vault/asset formats, decimal grammar, Date parsing and valid observedAt
// are supplied predicates/caller assumptions, not proved here. D1 statement
// atomicity and integer text ordering for canonical amounts are assumed.
// Prior comparison, conditional write, reply and no-change readback are separate.
// A lost reply can follow a committed write. A later winner can make an earlier
// conflict report older; neither result says the caller's row is still current.
// The model does not establish chain finality, economic conservation or identity
// authority. New scenarios and regression definitions are unexecuted.
module vault_snapshot_store {
  val callers = Set(1, 2)
  type Row = { present: bool, block: int, at: int, first: int, second: int,
    current: int, asset: int, decimals: int, chain: int, legacy: int }
  type Local = { phase: str, attempt: int, valid: bool, candidate: Row,
    prior: Row, changed: bool, reply: str }
  type State = { started: bool, row: Row, workers: int -> Local,
    monotone: bool, identityPreserved: bool, legacyPreserved: bool }
  var s: State
  val absent: Row = { present: false, block: 0, at: 0, first: 0, second: 0,
    current: -1, asset: 1, decimals: 1, chain: 1, legacy: 0 }
  val base: Row = absent.with("present", true).with("block", 1).with("at", 1)
    .with("first", 1).with("second", 1).with("current", 1).with("legacy", 7)
  val candidate: Row = base.with("block", 2).with("at", 2).with("first", 2)
    .with("second", 2).with("current", 2).with("legacy", 0)
  val emptyLocal: Local = { phase: "idle", attempt: 0, valid: true,
    candidate: candidate, prior: absent, changed: false, reply: "none" }
  action init = s' = { started: false, row: base,
    workers: Map(1 -> emptyLocal, 2 -> emptyLocal), monotone: true,
    identityPreserved: true, legacyPreserved: true }
  def local(who: int): Local = s.workers.get(who)
  pure def ended(w: Local, reply: str): Local = w.with("phase", "done").with("reply", reply)
  pure def sameIdentity(a: Row, b: Row): bool =
    a.asset == b.asset and a.decimals == b.decimals and a.chain == b.chain
  pure def countersDoNotDecrease(a: Row, b: Row): bool = a.first >= b.first and a.second >= b.second
  pure def writeAllowed(a: Row, b: Row): bool = not(b.present) or
    a.block >= b.block and (a.block > b.block or a.at >= b.at)
      and sameIdentity(a, b) and countersDoNotDecrease(a, b)
  action emptySeed = all { not(s.started), s' = s.with("row", absent) }
  action profile(who: int, kind: int): bool = {
    val w = local(who)
    val value = if (kind == 2) candidate.with("block", 0).with("first", 0).with("second", 0)
      else if (kind == 3) candidate.with("asset", 2)
      else if (kind == 4) candidate.with("first", 0)
      else if (kind == 5) candidate.with("block", 1).with("at", 0)
      else if (kind == 6) candidate.with("block", 3).with("at", 0).with("first", 3).with("second", 3).with("current", 0)
      else if (kind == 7) candidate.with("second", 0)
      else if (kind == 8) candidate.with("block", 1).with("at", 1).with("current", -1)
      else if (kind == 9) candidate.with("chain", 2)
      else if (kind == 10) candidate.with("decimals", 2)
      else if (kind == 11) candidate.with("at", 3).with("current", 3)
      else if (kind == 12) candidate.with("block", 3).with("at", 3).with("first", 3).with("second", 3)
      else candidate
    all { Set("idle", "done").contains(w.phase), w.attempt < 2, 0.to(12).contains(kind),
      s' = s.with("workers", s.workers.set(who, w.with("candidate", value).with("valid", kind != 1))) }
  }
  action begin(who: int): bool = {
    val w = local(who)
    all { Set("idle", "done").contains(w.phase), w.attempt < 2,
      s' = s.with("started", true).with("workers", s.workers.set(who,
        w.with("phase", "validate").with("attempt", w.attempt + 1).with("changed", false).with("reply", "none"))) }
  }
  action validate(who: int): bool = {
    val w = local(who)
    all { w.phase == "validate", s' = s.with("workers", s.workers.set(who,
      if (w.valid) w.with("phase", "read") else ended(w, "invalid-totals"))) }
  }
  action readPrior(who: int): bool = {
    val w = local(who)
    all { w.phase == "read", s' = s.with("workers", s.workers.set(who,
      w.with("prior", s.row).with("phase", "compare"))) }
  }
  action comparePrior(who: int): bool = {
    val w = local(who)
    val a = w.candidate
    val b = w.prior
    all { w.phase == "compare", s' = s.with("workers", s.workers.set(who,
      if (b.present and a.block < b.block) ended(w, "older")
      else if (b.present and (a.asset != b.asset or a.decimals != b.decimals)) ended(w, "asset-changed")
      else if (b.present and not(countersDoNotDecrease(a, b))) ended(w, "counter-decreased")
      else w.with("phase", "write"))) }
  }
  action write(who: int): bool = {
    val w = local(who)
    val a = w.candidate
    val b = s.row
    val changed = writeAllowed(a, b)
    val stored = a.with("legacy", if (b.present) b.legacy else 0)
    all { w.phase == "write", s' = s.with("row", if (changed) stored else b)
      .with("monotone", s.monotone and (not(changed) or not(b.present) or a.block >= b.block and countersDoNotDecrease(a, b)))
      .with("identityPreserved", s.identityPreserved and (not(changed) or not(b.present) or sameIdentity(a, b)))
      .with("legacyPreserved", s.legacyPreserved and (not(changed) or stored.legacy == (if (b.present) b.legacy else 0)))
      .with("workers", s.workers.set(who, w.with("changed", changed).with("phase", "ack"))) }
  }
  action acknowledge(who: int, delivered: bool): bool = {
    val w = local(who)
    all { w.phase == "ack", s' = s.with("workers", s.workers.set(who,
      if (not(delivered)) ended(w, "write-error") else if (w.changed) ended(w, "stored") else w.with("phase", "readback"))) }
  }
  action readBack(who: int): bool = {
    val w = local(who)
    val a = w.candidate
    val b = s.row
    all { w.phase == "readback", s' = s.with("workers", s.workers.set(who,
      if (b.present and (a.block < b.block or a.block == b.block and a.at < b.at)) ended(w, "older")
      else ended(w, "conflict"))) }
  }
  action failure(who: int): bool = {
    val w = local(who)
    all { Set("read", "write", "readback").contains(w.phase),
      s' = s.with("workers", s.workers.set(who, ended(w, "io-error"))) }
  }
  action step = {
    nondet who = callers.oneOf() nondet kind = 0.to(12).oneOf() nondet delivered = Set(false, true).oneOf()
    any { emptySeed, profile(who, kind), begin(who), validate(who), readPrior(who), comparePrior(who),
      write(who), acknowledge(who, delivered), readBack(who), failure(who), s' = s }
  }
  val invariant = all { s.monotone, s.identityPreserved, s.legacyPreserved,
    s.row.block <= 3, s.row.first <= 3, s.row.second <= 3,
    callers.forall(who => local(who).attempt <= 2),
    callers.forall(who => local(who).reply == "stored" implies local(who).changed) }
  action ready(who: int) = begin(who).then(validate(who)).then(readPrior(who)).then(comparePrior(who))
  action save(who: int) = ready(who).then(write(who)).then(acknowledge(who, true))
  run normalStoredTest = init.then(save(1)).expect(local(1).reply == "stored" and s.row.block == 2 and invariant)
  run firstWriteStartsLegacyAtZeroTest = init.then(emptySeed).then(save(1)).expect(s.row.legacy == 0 and invariant)
  run updateKeepsHistoricalServiceFeesTest = init.then(save(1)).expect(s.row.legacy == 7 and invariant)
  run invalidTotalsRefuseBeforeReadTest = init.then(profile(1, 1)).then(begin(1)).then(validate(1)).expect(local(1).reply == "invalid-totals" and s.row == base and invariant)
  run olderBlockPrecedesCounterCheckTest = init.then(profile(1, 2)).then(ready(1)).expect(local(1).reply == "older" and invariant)
  run changedAssetRefusedTest = init.then(profile(1, 3)).then(ready(1)).expect(local(1).reply == "asset-changed" and invariant)
  run changedDecimalsRefusedTest = init.then(profile(1, 10)).then(ready(1)).expect(local(1).reply == "asset-changed" and invariant)
  run firstCounterDecreaseRefusedTest = init.then(profile(1, 4)).then(ready(1)).expect(local(1).reply == "counter-decreased" and invariant)
  run secondCounterDecreaseRefusedTest = init.then(profile(1, 7)).then(ready(1)).expect(local(1).reply == "counter-decreased" and invariant)
  run newerBlockWinsDespiteOlderObservationTest = init.then(profile(1, 6)).then(save(1)).expect(s.row.block == 3 and s.row.at == 0 and s.row.current == 0 and invariant)
  run currentCounterMayDecreaseOrBeNullTest = init.then(profile(1, 8)).then(save(1)).expect(s.row.current == -1 and local(1).reply == "stored" and invariant)
  run duplicateExactWriteStillStoredTest = init.then(save(1)).then(save(1)).expect(local(1).reply == "stored" and invariant)
  run sameBlockEarlierObservationReturnsOlderTest = init.then(profile(1, 5)).then(ready(1)).then(write(1)).then(acknowledge(1, true)).then(readBack(1)).expect(local(1).reply == "older" and s.row == base and invariant)
  run writeGuardCatchesConcurrentCounterChangeTest = init.then(emptySeed).then(profile(1, 4)).then(ready(1)).then(save(2)).then(write(1)).then(acknowledge(1, true)).then(readBack(1)).expect(local(1).reply == "conflict" and s.row.first == 2 and invariant)
  run writeGuardChecksChainTest = init.then(profile(1, 9)).then(ready(1)).then(write(1)).then(acknowledge(1, true)).then(readBack(1)).expect(local(1).reply == "conflict" and s.row.chain == 1 and invariant)
  run concurrentLaterObservationWinsTest = init.then(ready(1)).then(profile(2, 11)).then(save(2)).then(write(1)).then(acknowledge(1, true)).then(readBack(1)).expect(local(1).reply == "older" and s.row.at == 3 and invariant)
  run laterReadbackCanReclassifyConflictAsOlderTest = init.then(emptySeed).then(profile(1, 4)).then(ready(1)).then(save(2)).then(write(1)).then(acknowledge(1, true)).then(profile(2, 12)).then(save(2)).then(readBack(1)).expect(local(1).reply == "older" and s.row.block == 3 and invariant)
  run lostWriteReplyKeepsCommittedRowTest = init.then(ready(1)).then(write(1)).then(acknowledge(1, false)).expect(local(1).reply == "write-error" and s.row.block == 2 and invariant)
  run lostWriteReplyAllowsExactRetryTest = init.then(ready(1)).then(write(1)).then(acknowledge(1, false)).then(save(1)).expect(local(1).reply == "stored" and invariant)
  run storedReplyDoesNotProveLatestRowTest = init.then(ready(1)).then(write(1)).then(profile(2, 12)).then(save(2)).then(acknowledge(1, true)).expect(local(1).reply == "stored" and s.row.block == 3 and invariant)
  run failedPriorReadDoesNotWriteTest = init.then(begin(1)).then(validate(1)).then(failure(1)).expect(local(1).reply == "io-error" and s.row == base and invariant)
  run failedReadbackKeepsWinningRowTest = init.then(profile(1, 5)).then(ready(1)).then(write(1)).then(acknowledge(1, true)).then(failure(1)).expect(local(1).reply == "io-error" and s.row == base and invariant)
}
