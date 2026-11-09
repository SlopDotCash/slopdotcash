// @source src/ProfilePage.tsx
// @source src/Profiles.tsx
// @source src/Points.tsx
// @evidence tests/e2e/profile-rename.spec.ts
// Public identity selection and current-wallet key ownership. Fourteen source
// representatives cover the selector's branches; they are not arbitrary full
// ledger contents. Two requests and two lifetimes bound async wallet outcomes.
module ui_profile_identity {
  type Sources = { ledgerReady: bool, directoryReady: bool, sessionPending: bool,
    memberPending: bool, member: int, matches: Set[int], renamed: Set[int],
    directory: Set[int], directoryRenamed: Set[int] }
  type Request = { phase: str, actor: int, life: int, source: int }
  var s: { source: int, mounted: bool, life: int, effectActor: int,
    active: int, requests: int -> Request, walletActor: int, wallet: str }
  val ids = Set(1, 2)
  val sourceIds = 1.to(14)
  pure def sources(id: int): Sources = {
    val ordinary = { ledgerReady: true, directoryReady: true, sessionPending: false,
      memberPending: false, member: 1, matches: Set(1), renamed: Set(),
      directory: Set(1), directoryRenamed: Set() }
    if (id == 1) ordinary.with("directoryReady", false)
    else if (id == 2) ordinary
    else if (id == 3) ordinary.with("member", 2).with("directory", Set(2))
    else if (id == 4) ordinary.with("directory", Set()).with("directoryRenamed", Set(1))
    else if (id == 5) ordinary.with("member", 0).with("matches", Set()).with("directory", Set(2))
    else if (id == 6) ordinary.with("member", 0).with("matches", Set()).with("directory", Set(1, 2))
    else if (id == 7) ordinary.with("memberPending", true)
    else if (id == 8) ordinary.with("sessionPending", true)
    else if (id == 9) ordinary.with("member", 0).with("matches", Set())
    else if (id == 10) ordinary.with("member", 0).with("matches", Set()).with("renamed", Set(1))
    else if (id == 11) ordinary.with("member", 0).with("matches", Set()).with("directory", Set())
    else if (id == 12) ordinary.with("member", 0).with("matches", Set(2)).with("directory", Set(2))
    else if (id == 13) ordinary.with("member", 0).with("memberPending", true)
    else ordinary.with("ledgerReady", false)
  }
  pure def first(values: Set[int]): int = if (values.contains(1)) 1
    else if (values.contains(2)) 2 else 0
  pure def selectRequest(source: Sources): int = {
    val candidate = if (source.member > 0) source.member
      else if (source.matches.size() > 0) first(source.matches)
      else if (source.directory.size() == 1) first(source.directory) else 0
    val conflict = source.renamed.contains(candidate)
      or source.matches.exists(id => id != candidate)
      or source.directoryRenamed.contains(candidate)
      or source.directory.exists(id => id != candidate)
    if (not(source.ledgerReady) or not(source.directoryReady) or source.sessionPending
      or (source.member == 0 and source.memberPending) or candidate == 0 or conflict) 0
    else candidate
  }
  val actor = selectRequest(sources(s.source))
  val visibleWallet = s.mounted and actor > 0 and s.wallet == "ready" and s.walletActor == actor
  action init = s' = { source: 1, mounted: true, life: 1, effectActor: 0,
    active: 0, requests: ids.mapBy(_ => {phase: "unused", actor: 0, life: 0, source: 0}),
    walletActor: 0, wallet: "loading" }
  action sourceChanges(id: int): bool = all { s.mounted, sourceIds.contains(id),
    s' = s.with("source", id) }
  action noActorEffect = all { s.mounted, actor == 0,
    s' = s.with("effectActor", 0).with("active", 0).with("walletActor", 0).with("wallet", "none") }
  action requestWallet(id: int): bool = all { s.mounted, actor > 0,
    actor != s.effectActor, ids.contains(id), s.requests.get(id).phase == "unused",
    s' = s.with("effectActor", actor).with("active", id).with("wallet", "loading")
      .with("requests", s.requests.set(id,
        {phase: "pending", actor: actor, life: s.life, source: s.source})) }
  // A completed old effect may have produced cache state before passive cleanup.
  // The render key still hides its wallet from a different selected actor.
  action walletReply(id: int, outcome: str): bool = {
    val r = s.requests.get(id)
    val done = s.with("requests", s.requests.set(id, r.with("phase", "done")))
    all { r.phase == "pending", Set("ready", "none", "error").contains(outcome),
      s' = if (s.mounted and s.active == id and r.life == s.life)
        done.with("walletActor", r.actor).with("wallet", outcome) else done }
  }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("active", 0) }
  action remount = all { not(s.mounted), s.life == 1,
    s' = s.with("mounted", true).with("life", 2).with("effectActor", 0)
      .with("active", 0).with("walletActor", 0).with("wallet", "loading") }
  action step = {
    nondet source = sourceIds.oneOf()
    nondet id = ids.oneOf()
    nondet outcome = Set("ready", "none", "error").oneOf()
    any { sourceChanges(source), noActorEffect, requestWallet(id), walletReply(id, outcome),
      depart, remount, s' = s }
  }
  val invariant = all { actor == 0 or ids.contains(actor),
    visibleWallet implies s.walletActor == actor,
    visibleWallet implies ids.exists(id => s.requests.get(id).phase == "done"
      and s.requests.get(id).actor == s.walletActor and s.requests.get(id).life == s.life),
    actor == 0 implies not(visibleWallet),
    not(s.mounted) implies not(visibleWallet),
    ids.forall(id => s.requests.get(id).phase != "unused" implies
      s.requests.get(id).actor == selectRequest(sources(s.requests.get(id).source))),
    s.wallet == "ready" implies ids.exists(id => s.requests.get(id).phase == "done"
      and s.requests.get(id).actor == s.walletActor) }
  run pendingDirectoryCannotNameActorTest = init.expect(actor == 0)
  run compatibleSourcesSelectMemberTest = init.then(sourceChanges(2)).expect(actor == 1)
  run conflictingSourcesVetoMemberTest = init.then(sourceChanges(3)).expect(actor == 0)
  run directoryRenameVetoesLedgerTest = init.then(sourceChanges(4)).expect(actor == 0)
  run directoryOnlyIdentityTest = init.then(sourceChanges(5)).expect(actor == 2)
  run ambiguousDirectoryDoesNotChooseTest = init.then(sourceChanges(6)).expect(actor == 0)
  run ownMemberBypassesOnlyMemberLookupTest = init.then(sourceChanges(7)).expect(actor == 1)
  run pendingSessionStillBlocksOwnMemberTest = init.then(sourceChanges(8)).expect(actor == 0)
  run directoryDoesNotRequirePrivateMembershipTest = init.then(sourceChanges(9)).expect(actor == 1)
  run knownRenameVetoesDirectoryFallbackTest = init.then(sourceChanges(10)).expect(actor == 0)
  run absentContributorStaysAbsentTest = init.then(sourceChanges(11)).expect(actor == 0)
  run pendingMemberLookupBlocksFallbackTest = init.then(sourceChanges(13)).expect(actor == 0)
  run unavailableLedgerCannotNameActorTest = init.then(sourceChanges(14)).expect(actor == 0)
  run currentWalletMatchesSelectedIdentityTest = init.then(sourceChanges(2)).then(requestWallet(1))
    .then(walletReply(1, "ready")).expect(visibleWallet and s.walletActor == 1)
  run changedActorHidesCachedWalletBeforeEffectTest = init.then(sourceChanges(2)).then(requestWallet(1))
    .then(walletReply(1, "ready")).then(sourceChanges(12)).expect(actor == 2 and not(visibleWallet))
  run oldPendingWalletCannotReplaceCurrentRequestTest = init.then(sourceChanges(2)).then(requestWallet(1))
    .then(sourceChanges(12)).then(requestWallet(2)).then(walletReply(2, "ready"))
    .then(walletReply(1, "ready")).expect(visibleWallet and s.walletActor == 2)
  run malformedWalletRemainsErrorTest = init.then(sourceChanges(2)).then(requestWallet(1))
    .then(walletReply(1, "error")).expect(s.wallet == "error" and not(visibleWallet))
  run missingWalletRemainsNoneTest = init.then(sourceChanges(2)).then(requestWallet(1))
    .then(walletReply(1, "none")).expect(s.wallet == "none" and not(visibleWallet))
  run departedWalletReplyCannotShowTest = init.then(sourceChanges(2)).then(requestWallet(1))
    .then(depart).then(walletReply(1, "ready")).expect(not(visibleWallet))
  run remountedLookupOwnsItsWalletTest = init.then(sourceChanges(2)).then(requestWallet(1)).then(depart)
    .then(remount).then(sourceChanges(12)).then(requestWallet(2)).then(walletReply(1, "ready"))
    .then(walletReply(2, "ready")).expect(visibleWallet and s.walletActor == 2)
}
