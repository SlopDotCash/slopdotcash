// @source src/OwnerVaultSetup.tsx
// @source src/lib/vault-setup-attempt.ts
// @source src/lib/pending-attempt.ts
// @evidence scripts/vault-setup-attempt.test.ts
// @evidence tests/e2e/vault-actions.spec.ts
// One project tab's saved vault-creation request (one sessionStorage key).
// A view may be replaced while its wallet prompt is open, so a wallet result
// can arrive after the owner cleared the request or after a newer view began
// another one. Bounds: two creation attempts (ids 1 and 2); the slot holds at
// most one record. `cleared`, `ended` and `landed` are ghost sets. Mounting
// affects only on-screen notices, not storage, so it is not modeled. The
// unguarded `legacy*` actions are the pre-fix writes; they are excluded from
// `step` and exist only so scenarios show the violations they caused.
module ui_owner_vault_setup_storage {
  type Flight = str // "none" | "prompt" | "done"
  var slot: { id: int, hash: bool }
  var flight: int -> Flight
  var nextId: int
  var cleared: Set[int]
  var ended: Set[int]
  var landed: Set[int]

  val ids = Set(1, 2)
  action init = all {
    slot' = { id: 0, hash: false },
    flight' = ids.mapBy(_ => "none"),
    nextId' = 1,
    cleared' = Set(),
    ended' = Set(),
    landed' = Set(),
  }
  action keep(sl: { id: int, hash: bool }, f: int -> Flight, c: Set[int], e: Set[int], l: Set[int]): bool = all {
    slot' = sl, flight' = f, nextId' = nextId, cleared' = c, ended' = e, landed' = l,
  }
  // createPendingAttempt: a new attempt saves its record only into an empty slot.
  action begin = all {
    nextId <= 2, slot.id == 0,
    slot' = { id: nextId, hash: false },
    flight' = flight.set(nextId, "prompt"),
    nextId' = nextId + 1,
    cleared' = cleared, ended' = ended, landed' = landed,
  }
  // A (possibly replaced) view's owner clears the unsent record it restored.
  action clearUnsent = all {
    slot.id > 0, not(slot.hash),
    keep({ id: 0, hash: false }, flight, cleared.union(Set(slot.id)), ended.union(Set(slot.id)), landed),
  }
  // Finalized registration clears the record with its hash.
  action registered = all {
    slot.id > 0, slot.hash,
    keep({ id: 0, hash: false }, flight, cleared, ended.union(Set(slot.id)), landed),
  }
  // vaultSetupAttempt.submitted: the hash updates only this attempt's record;
  // otherwise the view shows the hash in a notice and keeps the newer slot.
  action walletHash(id: int): bool = all {
    flight.get(id) == "prompt",
    keep(if (slot.id == id) slot.with("hash", true) else slot,
      flight.set(id, "done"), cleared, ended, landed.union(Set(id))),
  }
  // vaultSetupAttempt.declined: compare-and-remove of the unchanged record.
  action decline(id: int): bool = all {
    flight.get(id) == "prompt",
    val own = slot.id == id and not(slot.hash)
    keep(if (own) { id: 0, hash: false } else slot, flight.set(id, "done"),
      cleared, if (own) ended.union(Set(id)) else ended, landed),
  }
  // Pre-fix writes: unconditional setItem / removeItem.
  action legacyWalletHash(id: int): bool = all {
    flight.get(id) == "prompt",
    keep({ id: id, hash: true }, flight.set(id, "done"), cleared, ended, landed.union(Set(id))),
  }
  action legacyDecline(id: int): bool = all {
    flight.get(id) == "prompt",
    keep({ id: 0, hash: false }, flight.set(id, "done"), cleared,
      if (slot.id == id) ended.union(Set(id)) else ended, landed),
  }
  action step = any {
    begin, clearUnsent, registered,
    nondet id = ids.oneOf()
    any { walletHash(id), decline(id) },
    keep(slot, flight, cleared, ended, landed),
  }

  // A request the owner cleared is never recreated by a late result.
  val noRecreation = not(cleared.contains(slot.id))
  // A saved hash came from that same attempt's wallet result.
  val ownHash = slot.hash implies landed.contains(slot.id)
  // Every begun request is still saved or was removed by its owner, its own
  // decline or registration; nothing else erases it.
  val noLostRequest = ids.forall(id => (id < nextId) implies (slot.id == id or ended.contains(id)))
  val wellFormed = all {
    slot.id >= 0, slot.id < nextId, nextId <= 3,
    slot.id > 0 implies flight.get(slot.id) != "none",
    ended.subseteq(ids), cleared.subseteq(ended),
  }
  val invariant = all { noRecreation, ownHash, noLostRequest, wellFormed }

  run sentAndRegisteredTest = init.then(begin).then(walletHash(1)).then(registered)
    .expect(slot.id == 0 and ended == Set(1) and invariant)
  run declineClearsOwnRequestTest = init.then(begin).then(decline(1))
    .expect(slot.id == 0 and ended == Set(1) and invariant)
  run occupiedSlotRefusesNewAttemptTest = init.then(begin).then(begin.fail())
  run lateHashAfterClearKeepsSlotEmptyTest = init.then(begin).then(clearUnsent).then(walletHash(1))
    .expect(slot.id == 0 and landed == Set(1) and invariant)
  run lateDeclineKeepsNewerRequestTest = init.then(begin).then(clearUnsent).then(begin).then(decline(1))
    .expect(slot == { id: 2, hash: false } and invariant)
  run lateHashKeepsNewerRequestTest = init.then(begin).then(clearUnsent).then(begin).then(walletHash(1))
    .then(walletHash(2)).expect(slot == { id: 2, hash: true } and invariant)
  run legacyLateHashRecreatedClearedSlotTest = init.then(begin).then(clearUnsent).then(legacyWalletHash(1))
    .expect(not(noRecreation))
  run legacyLateDeclineErasedNewerRequestTest = init.then(begin).then(clearUnsent).then(begin)
    .then(legacyDecline(1)).expect(not(noLostRequest))
}
