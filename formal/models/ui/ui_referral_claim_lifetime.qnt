// @source src/ReferralClaims.tsx
// @source src/lib/pending-attempt.ts
// @evidence tests/e2e/referral-claims.spec.ts
// Two same-origin views, two UUIDs, two cumulative amounts. Web Lock request,
// grant, final wallet observation and caller use are distinct transitions.
// Layout cleanup retires the view at committed removal. Already-open wallet
// tails may still update their own exact slot. Unexecuted.
module ui_referral_claim_lifetime {
  // record: 0 empty, 1 legacy, 2/3 A unknown/hash, 4/5 B unknown/hash,
  // 6 unreadable. Values also represent exact captured JSON versions.
  type State = { present: Set[int], mounted: Set[int], supported: bool, writeWorks: bool,
    lock: int, phase: int -> str, record: int, captured: int -> int, target: int -> int,
    memoryHash: Set[int], errors: Set[int], sent: Set[int], claimed: int }
  val views = Set(1, 2)
  var s: State
  action init = s' = { present: views, mounted: views, supported: true, writeWorks: true,
    lock: 0, phase: views.mapBy(_ => "reviewed"), record: 0,
    captured: views.mapBy(_ => 0), target: views.mapBy(_ => 0), memoryHash: Set(), errors: Set(),
    sent: Set(), claimed: 0 }
  pure def unknown(id: int): int = if (id == 1) 2 else 4
  pure def hashed(id: int): int = if (id == 1) 3 else 5
  pure def owner(record: int): int = if (record == 2 or record == 3) 1
    else if (record == 4 or record == 5) 2 else 0
  pure def amount(record: int): int = if (record == 4 or record == 5) 2 else 1
  action unavailableLocks = all { s.lock == 0, s.sent == Set(), s' = s.with("supported", false) }
  action storageFails = s' = s.with("writeWorks", false)
  action storageRecovers = s' = s.with("writeWorks", true)
  action restoreLegacy = all { s.record == 0, s.lock == 0, s.sent == Set(), s' = s.with("record", 1) }
  action restoreUnreadable = all { s.record == 0, s.lock == 0, s.sent == Set(), s' = s.with("record", 6) }
  action observe(id: int): bool = all { s.mounted.contains(id),
    s' = s.with("captured", s.captured.set(id, s.record))
      .with("target", s.target.set(id, if (s.record == 0 or s.record == 6) 0
        else if (s.record == 1 and s.target.get(id) > 1) s.target.get(id)
        else amount(s.record))) }
  action requestLock(id: int): bool = all {
    s.mounted.contains(id), s.supported, s.phase.get(id) == "reviewed",
    s' = s.with("phase", s.phase.set(id, "locking")) }
  action grantLock(id: int): bool = {
    val allowed = s.mounted.contains(id) and s.lock == 0
    all { s.phase.get(id) == "locking",
      s' = s.with("lock", if (allowed) id else s.lock)
        .with("phase", s.phase.set(id, if (allowed) "preflight" else "done"))
        .with("errors", if (not(allowed) and s.mounted.contains(id)) s.errors.union(Set(id)) else s.errors) }
  }
  action beginSend(id: int): bool = requestLock(id).then(grantLock(id))
  action observePreflight(id: int): bool = all {
    s.lock == id, s.phase.get(id) == "preflight",
    s' = s.with("phase", s.phase.set(id, "observed")) }
  action returnPreflight(id: int): bool = all {
    s.lock == id, s.phase.get(id) == "observed",
    s' = s.with("phase", s.phase.set(id, "returned")) }
  action dispatchWallet(id: int): bool = all {
    s.mounted.contains(id), s.lock == id, s.phase.get(id) == "returned",
    s.record == 0, s.writeWorks,
    s' = s.with("record", unknown(id)).with("captured", s.captured.set(id, unknown(id)))
      .with("target", s.target.set(id, id))
      .with("phase", s.phase.set(id, "wallet")).with("sent", s.sent.union(Set(id))) }
  action requestWallet(id: int): bool = observePreflight(id).then(returnPreflight(id)).then(dispatchWallet(id))
  action preflightRefuses(id: int): bool = all {
    s.lock == id, Set("preflight", "observed", "returned").contains(s.phase.get(id)),
    s' = s.with("lock", 0).with("phase", s.phase.set(id, "done"))
      .with("errors", if (s.mounted.contains(id)) s.errors.union(Set(id)) else s.errors) }
  action depart(id: int): bool = all {
    s.mounted.contains(id), s' = s.with("present", s.present.exclude(Set(id)))
      .with("mounted", s.mounted.exclude(Set(id))) }
  // SPA departure retains the lock until the existing wallet request settles.
  action walletHash(id: int): bool = all {
    s.lock == id, s.phase.get(id) == "wallet",
    s' = s.with("lock", 0).with("phase", s.phase.set(id, "done"))
      .with("record", if (owner(s.record) == id and s.writeWorks) hashed(id) else s.record)
      .with("captured", if (owner(s.record) == id and s.writeWorks)
        s.captured.set(id, hashed(id)) else s.captured)
      .with("memoryHash", if (s.mounted.contains(id) and owner(s.record) == id)
        s.memoryHash.union(Set(id)) else s.memoryHash) }
  action walletDeclines(id: int): bool = all {
    s.lock == id, s.phase.get(id) == "wallet",
    s' = s.with("lock", 0).with("phase", s.phase.set(id, "done"))
      .with("record", if (s.record == s.captured.get(id) and s.writeWorks) 0 else s.record) }
  action walletUnknown(id: int): bool = all {
    s.lock == id, s.phase.get(id) == "wallet",
    s' = s.with("lock", 0).with("phase", s.phase.set(id, "done")) }
  // Browser-context termination releases a Web Lock. It does not prove whether
  // the external transaction was sent, and it does not clear the marker.
  action terminate(id: int): bool = all {
    s.lock == id, s' = s.with("lock", 0).with("present", s.present.exclude(Set(id)))
      .with("mounted", s.mounted.exclude(Set(id)))
      .with("phase", s.phase.set(id, "terminated")) }
  action reset(id: int): bool = all {
    s.mounted.contains(id), s.supported, s.lock == 0, s.writeWorks,
    s.record == s.captured.get(id), s.record != 0,
    s' = s.with("record", 0).with("captured", s.captured.set(id, 0))
      .with("target", s.target.set(id, 0)) }
  action refuseBusyOrUnsupported(id: int): bool = all {
    s.mounted.contains(id), not(s.supported) or s.lock != 0,
    s' = s.with("errors", s.errors.union(Set(id))) }
  action observeClaimed(total: int): bool = all {
    total >= s.claimed, total <= 2, s' = s.with("claimed", total) }
  action clearVerified(id: int): bool = all {
    s.mounted.contains(id), s.supported, s.lock == 0, s.writeWorks,
    s.record == s.captured.get(id), s.record > 0, s.record < 6,
    s.target.get(id) > 0, s.claimed >= s.target.get(id),
    s' = s.with("record", 0).with("captured", s.captured.set(id, 0)) }
  // An older, uncoordinated bundle or external writer is not protected by this
  // bundle's Web Lock. CAS still must not overwrite its different UUID/bytes.
  action externalReplacement(record: int): bool = all {
    Set(1, 3, 5, 6).contains(record), s' = s.with("record", record) }
  action step = {
    nondet id = views.oneOf()
    nondet total = Set(0, 1, 2).oneOf()
    nondet record = Set(1, 3, 5, 6).oneOf()
    any { unavailableLocks, storageFails, storageRecovers, restoreLegacy,
      restoreUnreadable, observe(id), requestLock(id), grantLock(id), observePreflight(id), returnPreflight(id), dispatchWallet(id), preflightRefuses(id),
      depart(id), walletHash(id), walletDeclines(id), walletUnknown(id), terminate(id),
      reset(id), refuseBusyOrUnsupported(id), observeClaimed(total), clearVerified(id),
      externalReplacement(record), s' = s }
  }
  val invariant = all {
    s.mounted.subseteq(s.present),
    if (s.lock == 0) true else Set("preflight", "observed", "returned", "wallet").contains(s.phase.get(s.lock)),
    views.filter(id => s.phase.get(id) == "wallet").size() <= 1,
    s.sent.subseteq(views), s.memoryHash.subseteq(s.sent),
    s.record >= 0, s.record <= 6,
    views.forall(id => s.phase.get(id) == "wallet" implies s.sent.contains(id))
  }
  run departedPreflightCannotPromptTest = init.then(beginSend(1)).then(depart(1))
    .then(preflightRefuses(1)).expect(s.sent == Set() and s.record == 0 and s.lock == 0)
  run departedPreflightPromptRefusesTest = init.then(beginSend(1)).then(depart(1))
    .then(requestWallet(1).fail())
  run secondViewCannotOverlapPreflightTest = init.then(beginSend(1))
    .then(refuseBusyOrUnsupported(2)).expect(s.lock == 1 and s.sent == Set())
  run activeWalletBlocksResetTest = init.then(beginSend(1)).then(requestWallet(1))
    .then(observe(2)).then(refuseBusyOrUnsupported(2)).expect(s.record == 2 and s.lock == 1)
  run activeWalletResetRefusesTest = init.then(beginSend(1)).then(requestWallet(1))
    .then(observe(2)).then(reset(2).fail())
  run lateOwnedHashPersistsTest = init.then(beginSend(1)).then(requestWallet(1))
    .then(depart(1)).then(walletHash(1)).expect(s.record == 3 and s.lock == 0 and invariant)
  run lateDeclineClearsOwnMarkerTest = init.then(beginSend(1)).then(requestWallet(1))
    .then(depart(1)).then(walletDeclines(1)).expect(s.record == 0 and s.lock == 0)
  run unknownResultRetainsMarkerTest = init.then(beginSend(1)).then(requestWallet(1))
    .then(walletUnknown(1)).expect(s.record == 2 and s.lock == 0)
  run terminatedContextAllowsExplicitRecoveryTest = init.then(beginSend(1)).then(requestWallet(1))
    .then(terminate(1)).then(observe(2)).then(reset(2)).then(beginSend(2))
    .then(requestWallet(2)).expect(s.record == 4 and s.sent == views and invariant)
  run replacedUuidRejectsLateHashTest = init.then(beginSend(1)).then(requestWallet(1))
    .then(externalReplacement(5)).then(walletHash(1)).expect(s.record == 5)
  run changedBytesRejectLateDeclineTest = init.then(beginSend(1)).then(requestWallet(1))
    .then(externalReplacement(3)).then(walletDeclines(1)).expect(s.record == 3)
  run failedHashWriteRetainsCapturedMarkerTest = init.then(beginSend(1)).then(requestWallet(1))
    .then(storageFails).then(walletHash(1)).then(storageRecovers).then(observeClaimed(1))
    .then(clearVerified(1)).expect(s.memoryHash.contains(1) and s.record == 0)
  run newerCapturedBytesRefuseOldVerificationTest = init.then(restoreLegacy).then(observe(1))
    .then(externalReplacement(5)).then(observeClaimed(2)).then(clearVerified(1).fail())
  run legacyMarkerCanBeVerifiedTest = init.then(restoreLegacy).then(observe(1))
    .then(observeClaimed(1)).then(clearVerified(1)).expect(s.record == 0)
  run unreadableMarkerRequiresExplicitResetTest = init.then(restoreUnreadable).then(observe(1))
    .then(reset(1)).expect(s.record == 0)
  run unreadableMarkerCannotStartSendTest = init.then(restoreUnreadable)
    .then(beginSend(1)).then(requestWallet(1).fail())
  run unsupportedLocksRefuseMutationTest = init.then(unavailableLocks)
    .then(refuseBusyOrUnsupported(1)).expect(s.sent == Set() and s.errors.contains(1))
  run failedInitialStorageCannotPromptTest = init.then(beginSend(1)).then(storageFails)
    .then(requestWallet(1).fail())
  run insufficientClaimedAmountCannotClearTest = init.then(beginSend(2)).then(requestWallet(2))
    .then(walletHash(2)).then(observeClaimed(1)).then(clearVerified(2).fail())
  run olderLegacyCannotConfirmNewerLocalClaimTest = init.then(beginSend(2)).then(requestWallet(2))
    .then(walletHash(2)).then(externalReplacement(1)).then(observe(2))
    .then(observeClaimed(1)).then(clearVerified(2).fail())
  run departedBeforeLockGrantNeverStartsPreflightTest = init.then(requestLock(1)).then(depart(1)).then(grantLock(1))
    .expect(s.lock == 0 and s.sent == Set() and invariant)
  run departedObservedPreflightCannotDispatchTest = init.then(beginSend(1)).then(observePreflight(1))
    .then(depart(1)).then(returnPreflight(1)).then(dispatchWallet(1).fail())
  run departedObservedPreflightReleasesReservationTest = init.then(beginSend(1)).then(observePreflight(1))
    .then(depart(1)).then(returnPreflight(1)).then(preflightRefuses(1))
    .expect(s.record == 0 and s.sent == Set() and invariant)
  run departedReturnedPreflightCannotDispatchTest = init.then(beginSend(1)).then(observePreflight(1))
    .then(returnPreflight(1)).then(depart(1)).then(dispatchWallet(1).fail())
  run competingLockGrantRefusesWithoutReleasingOwnerTest = init.then(requestLock(1)).then(requestLock(2))
    .then(grantLock(1)).then(grantLock(2)).expect(s.lock == 1 and s.errors.contains(2) and invariant)
  // Historical passive cleanup was later than the DOM-removal observation.
  // This action is excluded from step.
  action historicalPassiveRemoval(id: int): bool = all { s.present.contains(id),
    s' = s.with("present", s.present.exclude(Set(id))) }
  run historicalPassiveRemovalCouldPromptTest = init.then(beginSend(1)).then(observePreflight(1))
    .then(returnPreflight(1)).then(historicalPassiveRemoval(1)).then(dispatchWallet(1))
    .expect(s.sent == Set(1) and not(invariant))
}
