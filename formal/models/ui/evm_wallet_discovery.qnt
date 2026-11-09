// @source src/lib/use-payout-wallets.ts
// @evidence tests/e2e/payout-wallet-picker.spec.ts
// One hook lifetime, two announcement UUIDs, three provider identities and
// two metadata tuples. Invalid UUID/name/rdns/icon/request shapes collapse to
// valid=false; icon rendering and naming are presentation, not authority.
// One selected provider, one connect (optional account picker), and two later
// provider calls. Conflict sets are sticky until this hook is recreated.
// UUID aliases share provider blocking; legacy choices exclude every provider
// still in the announcement map, including a conflicting retained entry.
// A legacy global can change independently, but its captured wrapper checks
// conflict status, not continued membership in window.ethereum. The caller
// owns its UI lifetime. Cleanup stops discovery; it cannot revoke a provider
// call already made. Account strings are only lowercased here; address validity,
// chain checks, signatures and expected-actor admission belong to callers.
// Connect rechecks trust after account selection. Later calls check before
// invocation and can still return after a conflict. These are observations,
// not trusted wallet branding or atomic provider revocation. No provider call,
// browser test, parser or checker ran for this model. Old connect completion
// without its final trust check is a negative control excluded from step.
module evm_wallet_discovery {
  val ids = Set(1, 2)
  val providers = Set(1, 2, 3)
  type Announcement = { provider: int, metadata: int }
  val absent: Announcement = { provider: 0, metadata: 0 }
  type Call = { phase: str, kind: str, trusted: bool, result: str }
  val idleCall: Call = { phase: "unused", kind: "rpc", trusted: false, result: "none" }
  var s: { listening: bool, announced: int -> Announcement, blockedIds: Set[int],
    blockedProviders: Set[int], legacy: Set[int], selected: int, selectedId: int,
    phase: str, chooseAccount: bool, permissionCalls: int, accountCalls: int,
    addressReady: bool, checkedAccountReply: bool, calls: int -> Call }
  action init = s' = { listening: true, announced: ids.mapBy(_ => absent), blockedIds: Set(),
    blockedProviders: Set(), legacy: Set(), selected: 0, selectedId: 0, phase: "idle",
    chooseAccount: false, permissionCalls: 0, accountCalls: 0, addressReady: false,
    checkedAccountReply: false, calls: ids.mapBy(_ => idleCall) }
  val announcedProviders = ids.map(id => s.announced.get(id).provider).exclude(Set(0))
  val announcedChoices = ids.filter(id => s.announced.get(id).provider > 0
    and not(s.blockedIds.contains(id)) and not(s.blockedProviders.contains(s.announced.get(id).provider)))
  val legacyChoices = s.legacy.exclude(announcedProviders).exclude(s.blockedProviders)
  val trusted = s.selected > 0 and not(s.blockedProviders.contains(s.selected))
    and (s.selectedId == 0 or not(s.blockedIds.contains(s.selectedId)))
  action announce(id: int, provider: int, metadata: int, valid: bool): bool = {
    val previous = s.announced.get(id)
    val conflict = previous.provider > 0 and (previous.provider != provider or previous.metadata != metadata)
    all { s.listening, ids.contains(id), providers.contains(provider), Set(1, 2).contains(metadata),
      s' = if (not(valid)) s
        else if (s.blockedIds.contains(id)) s.with("blockedProviders", s.blockedProviders.union(Set(provider)))
        else if (conflict) s.with("blockedIds", s.blockedIds.union(Set(id)))
          .with("blockedProviders", s.blockedProviders.union(Set(previous.provider, provider)))
        else if (previous.provider == 0) s.with("announced", s.announced.set(id, { provider: provider, metadata: metadata }))
        else s }
  }
  action legacy(providersNow: Set[int]): bool = all { s.listening, providersNow.subseteq(providers), s' = s.with("legacy", providersNow) }
  action cleanup = all { s.listening, s' = s.with("listening", false) }
  action selectAnnounced(id: int): bool = all { s.phase == "idle", announcedChoices.contains(id),
    s' = s.with("selected", s.announced.get(id).provider).with("selectedId", id) }
  action selectLegacy(provider: int): bool = all { s.phase == "idle", legacyChoices.contains(provider),
    s' = s.with("selected", provider).with("selectedId", 0) }
  action connect(picker: bool): bool = all { s.phase == "idle", s.selected > 0,
    s' = if (not(trusted)) s.with("phase", "error")
      else s.with("chooseAccount", picker).with("phase", if (picker) "permissions" else "accounts-pending")
        .with("permissionCalls", if (picker) 1 else 0).with("accountCalls", if (picker) 0 else 1) }
  action permissionReply(outcome: str): bool = all { s.phase == "permissions", Set("ok", "unsupported", "rejected", "other-error").contains(outcome),
    s' = s.with("phase", if (outcome == "rejected" or not(trusted)) "error" else "accounts-pending")
      .with("accountCalls", if (outcome == "rejected" or not(trusted)) 0 else 1) }
  action accountReply(shapeValid: bool): bool = all { s.phase == "accounts-pending",
    s' = if (not(trusted) or not(shapeValid)) s.with("phase", "error")
      else s.with("phase", "connected").with("addressReady", true).with("checkedAccountReply", true) }
  action accountError = all { s.phase == "accounts-pending", s' = s.with("phase", "error") }
  action invoke(id: int, kind: str): bool = {
    val call = s.calls.get(id)
    all { s.addressReady, ids.contains(id), call.phase == "unused", Set("rpc", "sign").contains(kind),
      s' = s.with("calls", s.calls.set(id,
        call.with("kind", kind).with("trusted", trusted).with("phase", if (trusted) "pending" else "done")
          .with("result", if (trusted) "none" else "conflict"))) }
  }
  action reply(id: int, stringResult: bool, failed: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "pending", s' = s.with("calls", s.calls.set(id,
      call.with("phase", "done").with("result", if (failed) "error"
        else if (call.kind == "sign" and not(stringResult)) "invalid-signature" else "returned"))) }
  }
  action oldAccountReply = all { s.phase == "accounts-pending",
    s' = s.with("phase", "connected").with("addressReady", true) }
  action step = {
    nondet id = ids.oneOf()
    nondet provider = providers.oneOf()
    nondet metadata = Set(1, 2).oneOf()
    nondet kind = Set("rpc", "sign").oneOf()
    nondet outcome = Set("ok", "unsupported", "rejected", "other-error").oneOf()
    nondet globals = Set(Set(), Set(1), Set(2), Set(1, 2, 3)).oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { announce(id, provider, metadata, yes), legacy(globals), cleanup,
      selectAnnounced(id), selectLegacy(provider), connect(yes), permissionReply(outcome),
      accountReply(yes), accountError, invoke(id, kind), reply(id, yes, other), s' = s }
  }
  val invariant = all {
    s.blockedIds.subseteq(ids), s.blockedProviders.subseteq(providers),
    announcedChoices.forall(id => not(s.blockedProviders.contains(s.announced.get(id).provider))),
    legacyChoices.intersect(announcedProviders) == Set(),
    s.permissionCalls <= 1, s.accountCalls <= 1,
    s.addressReady implies s.checkedAccountReply,
    ids.forall(id => s.calls.get(id).phase == "pending" implies s.calls.get(id).trusted),
    ids.forall(id => s.calls.get(id).result == "returned" implies s.calls.get(id).trusted) }
  action selected = init.then(announce(1, 1, 1, true)).then(selectAnnounced(1))
  action connected = selected.then(connect(false)).then(accountReply(true))

  run discoveryNeverConnectsTest = init.then(announce(1, 1, 1, true)).then(legacy(Set(2)))
    .expect(s.permissionCalls == 0 and s.accountCalls == 0 and invariant)
  run invalidAnnouncementIsIgnoredTest = init.then(announce(1, 1, 1, false)).expect(announcedProviders == Set() and invariant)
  run exactReannouncementIsIdempotentTest = init.then(announce(1, 1, 1, true)).then(announce(1, 1, 1, true))
    .expect(announcedChoices == Set(1) and s.blockedProviders == Set() and invariant)
  run changedProviderBlocksBothTest = selected.then(announce(1, 2, 1, true))
    .expect(s.blockedIds == Set(1) and s.blockedProviders == Set(1, 2) and invariant)
  run changedMetadataBlocksSameProviderTest = selected.then(announce(1, 1, 2, true))
    .expect(s.blockedProviders == Set(1) and announcedChoices == Set() and invariant)
  run furtherConflictBlocksThirdProviderTest = selected.then(announce(1, 2, 1, true)).then(announce(1, 3, 1, true))
    .expect(s.blockedProviders == providers and invariant)
  run genuineRetryCannotRestoreConflictedIdTest = selected.then(announce(1, 2, 1, true)).then(announce(1, 1, 1, true))
    .expect(announcedChoices == Set() and invariant)
  run providerAliasSharesConflictTest = init.then(announce(1, 1, 1, true)).then(announce(2, 1, 1, true)).then(announce(1, 2, 1, true))
    .expect(announcedChoices == Set() and invariant)
  run legacyDoesNotDuplicateAnnouncedObjectTest = init.then(legacy(Set(1, 2))).then(announce(1, 1, 1, true))
    .expect(legacyChoices == Set(2) and invariant)
  run conflictingAnnouncementCannotReappearAsLegacyTest = selected.then(legacy(Set(1, 2))).then(announce(1, 2, 1, true))
    .expect(legacyChoices == Set() and invariant)
  run legacyChoiceCanConnectTest = init.then(legacy(Set(2))).then(selectLegacy(2)).then(connect(false))
    .then(accountReply(true)).expect(s.selected == 2 and s.addressReady and invariant)
  run staleSelectedProviderRefusesBeforeConnectTest = selected.then(announce(1, 2, 1, true)).then(connect(false))
    .expect(s.phase == "error" and s.accountCalls == 0 and invariant)
  run rejectedPickerStopsBeforeAccountsTest = selected.then(connect(true)).then(permissionReply("rejected"))
    .expect(s.accountCalls == 0 and s.phase == "error" and invariant)
  run unsupportedPickerFallsBackToAccountsTest = selected.then(connect(true)).then(permissionReply("unsupported"))
    .then(accountReply(true)).expect(s.addressReady and invariant)
  run otherPickerErrorRetainsFallbackTest = selected.then(connect(true)).then(permissionReply("other-error"))
    .then(accountReply(true)).expect(s.addressReady and invariant)
  run conflictDuringPickerStopsAccountsTest = selected.then(connect(true)).then(announce(1, 2, 1, true)).then(permissionReply("ok"))
    .expect(s.phase == "error" and s.accountCalls == 0 and invariant)
  run conflictDuringAccountReplyRefusesAddressTest = selected.then(connect(false))
    .then(announce(1, 2, 1, true)).then(accountReply(true)).expect(not(s.addressReady) and s.phase == "error" and invariant)
  run oldConnectCouldReturnConflictedProviderNegativeControlTest = selected.then(connect(false))
    .then(announce(1, 2, 1, true)).then(oldAccountReply).expect(s.addressReady and not(invariant))
  run malformedAccountReplyRefusesTest = selected.then(connect(false)).then(accountReply(false))
    .expect(not(s.addressReady) and invariant)
  run failedAccountRequestRefusesTest = selected.then(connect(false)).then(accountError)
    .expect(not(s.addressReady) and invariant)
  run connectedCallRechecksProviderConflictTest = connected.then(announce(1, 2, 1, true)).then(invoke(1, "sign"))
    .expect(s.calls.get(1).result == "conflict" and invariant)
  run inFlightCallCanReturnAfterConflictTest = connected.then(invoke(1, "sign")).then(announce(1, 2, 1, true)).then(reply(1, true, false))
    .expect(s.calls.get(1).result == "returned" and invariant)
  run nonStringSignatureRefusesTest = connected.then(invoke(1, "sign")).then(reply(1, false, false))
    .expect(s.calls.get(1).result == "invalid-signature" and invariant)
  run rawRpcResponseIsNotSignatureValidatedTest = connected.then(invoke(1, "rpc")).then(reply(1, false, false))
    .expect(s.calls.get(1).result == "returned" and invariant)
  run changingLegacyGlobalDoesNotRevokeCapturedWrapperTest = init.then(legacy(Set(2))).then(selectLegacy(2)).then(legacy(Set()))
    .then(connect(false)).then(accountReply(true)).expect(s.addressReady and invariant)
  run cleanupStopsAnnouncementsTest = selected.then(cleanup).expect(s.blockedProviders == Set() and invariant).then(announce(1, 2, 1, true).fail())
  run cleanupDoesNotCancelProviderPromiseTest = connected.then(invoke(1, "rpc")).then(cleanup).then(reply(1, true, false))
    .expect(s.calls.get(1).result == "returned" and invariant)
}
