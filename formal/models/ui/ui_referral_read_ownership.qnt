// @source src/ReferralClaims.tsx
// @source src/lib/pending-attempt.ts
// @evidence tests/e2e/referral-claims.spec.ts
// Two reads, component lifetimes and refresh generations; one exact local
// pending slot (empty, two cumulative values, or unreadable), claimed totals
// 0..2. A returned server total is an observation, not continuous chain state.
// Response parsing, local snapshot, asynchronous Web Lock grant and callback
// consumption are distinct. Layout cleanup aborts the old read at commit.
// This model covers automatic local marker cleanup only: no wallet, token
// transfer or referral activation. Exact JSON identity and cross-tab lock
// exclusion are predicates of the storage model. No scenarios were executed.
module ui_referral_read_ownership {
  type Read = { phase: str, life: int, generation: int, snapshot: int, claimed: int,
    cleared: bool, failure: str }
  type State = { present: bool, mounted: bool, life: int, generation: int,
    active: int, scheduled: bool, record: int, reads: int -> Read, clears: int,
    message: str, error: bool }
  val ids = Set(1, 2)
  val unused: Read = { phase: "unused", life: 0, generation: 0, snapshot: 0, claimed: 0,
    cleared: false, failure: "none" }
  var s: State
  action init = s' = { present: true, mounted: true, life: 1, generation: 1,
    active: 0, scheduled: true, record: 1, reads: ids.mapBy(_ => unused), clears: 0,
    message: "none", error: false }
  def owns(id: int): bool = s.mounted and s.active == id
    and s.reads.get(id).life == s.life and s.reads.get(id).generation == s.generation
  pure def valid(record: int): bool = record == 1 or record == 2
  action externalRecord(record: int): bool = all { record >= 0, record <= 3,
    s' = s.with("record", record) }
  action begin(id: int): bool = all { ids.contains(id), s.mounted, s.scheduled,
    s.reads.get(id).phase == "unused",
    s' = s.with("active", id).with("scheduled", false).with("error", false)
      .with("reads", s.reads.set(id, { phase: "http", life: s.life,
        generation: s.generation, snapshot: 0, claimed: 0, cleared: false, failure: "none" })) }
  action response(id: int, available: bool, claimed: int): bool = {
    val r = s.reads.get(id)
    val eligible = available and valid(s.record) and claimed >= s.record
    all { r.phase == "http", claimed >= 0, claimed <= 2,
      s' = s.with("reads", s.reads.set(id,
        r.with("phase", if (owns(id) and eligible) "lock" else "done")
          .with("snapshot", if (owns(id) and available) s.record else 0)
          .with("claimed", claimed)))
        .with("error", if (owns(id)) not(available) else s.error) }
  }
  action grant(id: int, available: bool): bool = all { s.reads.get(id).phase == "lock",
    s' = s.with("reads", s.reads.set(id, s.reads.get(id)
      .with("phase", if (available) "granted" else "refused"))) }
  // The lock callback is synchronous; its completed clear can precede a
  // departure before the awaiting read resumes to publish status.
  action consume(id: int, storageWorks: bool): bool = {
    val r = s.reads.get(id)
    val current = owns(id)
    val clear = current and r.phase == "granted" and storageWorks
      and valid(r.snapshot) and r.claimed >= r.snapshot and s.record == r.snapshot
    all { Set("granted", "refused").contains(r.phase),
      s' = s.with("record", if (clear) 0 else s.record)
        .with("clears", s.clears + (if (clear) 1 else 0))
        .with("reads", s.reads.set(id, r.with("phase", "returned").with("cleared", clear)
          .with("failure", if (not(current)) "cancelled" else if (r.phase == "refused") "lock"
            else if (not(storageWorks)) "storage" else if (not(clear)) "changed" else "none"))) }
  }
  action publish(id: int): bool = {
    val r = s.reads.get(id)
    all { r.phase == "returned",
      s' = s.with("reads", s.reads.set(id, r.with("phase", "done")))
        .with("message", if (owns(id) and (r.cleared or Set("lock", "storage").contains(r.failure))) "verified" else s.message)
        .with("error", if (owns(id)) not(r.cleared) else s.error) }
  }
  action finish(id: int, storageWorks: bool): bool = consume(id, storageWorks).then(publish(id))
  action refresh = all { s.mounted, s.generation == 1,
    s' = s.with("generation", 2).with("active", 0).with("scheduled", true) }
  action depart = all { s.mounted,
    s' = s.with("present", false).with("mounted", false).with("active", 0) }
  action remount = all { not(s.mounted), s.life == 1,
    s' = s.with("present", true).with("mounted", true).with("life", 2)
      .with("generation", 1).with("active", 0).with("scheduled", true)
      .with("message", "none").with("error", false) }
  action step = {
    nondet id = ids.oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet record = 0.to(3).oneOf()
    nondet claimed = 0.to(2).oneOf()
    any { externalRecord(record), begin(id), response(id, flag, claimed),
      grant(id, flag), consume(id, flag), publish(id), refresh, depart, remount, s' = s }
  }
  val invariant = all { not(s.present) implies not(s.mounted),
    s.record >= 0 and s.record <= 3, s.clears <= 2,
    ids.forall(id => s.reads.get(id).phase == "lock" implies
      valid(s.reads.get(id).snapshot) and s.reads.get(id).claimed >= s.reads.get(id).snapshot) }
  action returned(id: int, claimed: int): bool = begin(id).then(response(id, true, claimed))
  run verifiedTotalClearsExactSnapshotTest = init.then(returned(1, 1)).then(grant(1, true)).then(finish(1, true))
    .expect(s.record == 0 and s.clears == 1 and invariant)
  run lowerTotalKeepsPendingTest = init.then(returned(1, 0))
    .expect(s.record == 1 and s.reads.get(1).phase == "done" and invariant)
  run unreadableSnapshotNeverAutoClearsTest = init.then(externalRecord(3)).then(returned(1, 2))
    .expect(s.record == 3 and s.reads.get(1).phase == "done" and invariant)
  run missingPendingNeedsNoLockTest = init.then(externalRecord(0)).then(returned(1, 2))
    .expect(s.reads.get(1).phase == "done" and s.clears == 0 and invariant)
  run unavailableResponseRetainsPendingTest = init.then(begin(1)).then(response(1, false, 2))
    .expect(s.error and s.record == 1 and invariant)
  run changedSnapshotBeforeLockGrantCannotClearTest = init.then(returned(1, 2)).then(externalRecord(2))
    .then(grant(1, true)).then(finish(1, true)).expect(s.record == 2 and s.error and invariant)
  run refusedLockKeepsVerifiedEvidenceSeparateTest = init.then(returned(1, 1)).then(grant(1, false)).then(finish(1, true))
    .expect(s.record == 1 and s.message == "verified" and s.error and invariant)
  run failedStorageKeepsPendingTest = init.then(returned(1, 1)).then(grant(1, true)).then(finish(1, false))
    .expect(s.record == 1 and s.error and invariant)
  run committedDepartureBeforeReplyCannotStartCleanupTest = init.then(begin(1)).then(depart).then(response(1, true, 2))
    .expect(s.reads.get(1).phase == "done" and s.record == 1 and invariant)
  run committedDepartureBeforeGrantCannotClearTest = init.then(returned(1, 1)).then(depart)
    .then(grant(1, true)).then(finish(1, true)).expect(s.record == 1 and s.message == "none" and invariant)
  run committedDepartureAfterGrantCannotClearTest = init.then(returned(1, 1)).then(grant(1, true)).then(depart)
    .then(finish(1, true)).expect(s.record == 1 and s.clears == 0 and invariant)
  run refreshRetiresOldGrantedReadTest = init.then(returned(1, 1)).then(grant(1, true)).then(refresh).then(begin(2))
    .then(finish(1, true)).expect(s.record == 1 and not(s.error) and invariant)
  run oldErrorCannotReplaceNewLifetimeTest = init.then(returned(1, 1)).then(grant(1, false)).then(depart).then(remount)
    .then(finish(1, false)).expect(s.message == "none" and not(s.error) and invariant)
  run laterReadMayClearItsOwnLargerSnapshotTest = init.then(returned(1, 1)).then(refresh).then(externalRecord(2))
    .then(returned(2, 2)).then(grant(2, true)).then(finish(2, true)).then(grant(1, true)).then(finish(1, true))
    .expect(s.record == 0 and s.clears == 1 and invariant)
  run committedClearSurvivesDepartureBeforeStatusTest = init.then(returned(1, 1)).then(grant(1, true))
    .then(consume(1, true)).then(depart).then(publish(1))
    .expect(s.record == 0 and s.clears == 1 and s.message == "none" and invariant)
  run secondReadNeedsRefreshOrRemountTest = init.then(begin(1)).then(begin(2).fail())
  // Historical passive cleanup let an already granted callback clear a local
  // marker after DOM removal. It is excluded from the current step relation.
  action historicalPassiveRemoval = s' = s.with("present", false)
  run historicalPassiveRemovalCouldClearTest = init.then(returned(1, 1)).then(grant(1, true))
    .then(historicalPassiveRemoval).then(finish(1, true))
    .expect(s.record == 0 and not(invariant))
}
