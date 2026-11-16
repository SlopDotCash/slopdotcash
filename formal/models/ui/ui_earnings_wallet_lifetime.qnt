// @source src/Earnings.tsx
// @evidence tests/e2e/earnings-wallet-lifetime.spec.ts
// @evidence tests/e2e/payout-wallet-picker.spec.ts
// Source-only refinement: API acceptance and UI ownership are separate.
// Every named scenario is unexecuted. Two operations and two family chains.
// depart denotes the committed layout cleanup. The separate
// ui_earnings_actor_binding model refines nested helper-return consumption and
// cancellation of a captured account read before publication.
module ui_earnings_wallet_lifetime {
  type Operation = { phase: str, instance: int, chain: int }
  type State = { instance: int, mounted: bool, current: int, busy: int,
    error: int, success: int, operations: int -> Operation,
    registrationRequests: int -> Set[int], registered: int -> Set[int],
    signatureRequests: int -> Set[int], signatures: int -> Set[int],
    authorizationRequests: int -> Set[int], authorized: int -> Set[int],
    refreshed: Set[int], saved: Set[int] }
  val ids = Set(1, 2)
  val chains = Set(1, 2)
  var s: State
  action init = s' = { instance: 1, mounted: true, current: 0, busy: 0,
    error: 0, success: 0,
    operations: ids.mapBy(_ => {phase: "unused", instance: 1, chain: 1}),
    registrationRequests: ids.mapBy(_ => Set()), registered: ids.mapBy(_ => Set()),
    signatureRequests: ids.mapBy(_ => Set()), signatures: ids.mapBy(_ => Set()),
    authorizationRequests: ids.mapBy(_ => Set()), authorized: ids.mapBy(_ => Set()),
    refreshed: Set(), saved: Set() }
  def owns(id: int): bool = s.mounted and s.current == id
    and s.operations.get(id).instance == s.instance
  // An already confirmed matching address does not need a new signature.
  action existingConfirmed(chain: int): bool = all {
    s.current == 0, chains.contains(chain), s' = s.with("saved", s.saved.union(Set(chain)))
  }
  action connect(id: int): bool = all {
    s.mounted, ids.contains(id), s.operations.get(id).phase == "unused",
    s' = s.with("current", id).with("busy", id).with("error", 0).with("success", 0)
      .with("operations", s.operations.set(id, {phase: "connecting", instance: s.instance, chain: 1}))
  }
  action connectReply(id: int, different: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "connecting",
      s' = if (not(owns(id)))
        s.with("operations", s.operations.set(id, op.with("phase", "stopped")))
      else if (different) s.with("busy", 0)
        .with("operations", s.operations.set(id, op.with("phase", "consent")))
      else s.with("operations", s.operations.set(id, op.with("phase", "ready"))) }
  }
  // Existing replacement consent starts a fresh walletStep after connection.
  action confirmReplacement = all {
    owns(1), s.operations.get(1).phase == "consent", s.operations.get(2).phase == "unused",
    s' = s.with("current", 2).with("busy", 2).with("error", 0).with("success", 0)
      .with("operations", s.operations.set(1, s.operations.get(1).with("phase", "done"))
        .set(2, {phase: "ready", instance: s.instance, chain: 1}))
  }
  action keepSaved = all {
    owns(1), s.operations.get(1).phase == "consent",
    s' = s.with("operations", s.operations.set(1, s.operations.get(1).with("phase", "done")))
  }
  action register(id: int): bool = {
    val op = s.operations.get(id)
    all { owns(id), op.phase == "ready", not(s.saved.contains(op.chain)),
      s' = s.with("operations", s.operations.set(id, op.with("phase", "registering")))
        .with("registrationRequests", s.registrationRequests.set(id,
          s.registrationRequests.get(id).union(Set(op.chain)))) }
  }
  action skipConfirmed(id: int): bool = {
    val op = s.operations.get(id)
    all { owns(id), op.phase == "ready", s.saved.contains(op.chain),
      s' = if (op.chain == 1)
        s.with("operations", s.operations.set(id, op.with("chain", 2)))
      else s.with("operations", s.operations.set(id, op.with("phase", "done")))
        .with("busy", 0).with("success", id).with("refreshed", s.refreshed.union(Set(id))) }
  }
  // Server acceptance can occur even after a client error or departure. It
  // is not rolled back, nor treated as permission for a following UI step.
  action acceptRegistration(id: int, chain: int): bool = all {
    s.registrationRequests.get(id).contains(chain), not(s.registered.get(id).contains(chain)),
    s' = s.with("registered", s.registered.set(id, s.registered.get(id).union(Set(chain))))
  }
  action registrationReply(id: int): bool = {
    val op = s.operations.get(id)
    all { op.phase == "registering", s.registered.get(id).contains(op.chain),
      s' = s.with("operations", s.operations.set(id,
        op.with("phase", if (owns(id)) "challenge-ready" else "stopped"))) }
  }
  action requestChallenge(id: int): bool = {
    val op = s.operations.get(id)
    all { owns(id), op.phase == "challenge-ready",
      s' = s.with("operations", s.operations.set(id, op.with("phase", "challenging"))) }
  }
  action challengeReply(id: int, valid: bool): bool = {
    val op = s.operations.get(id)
    all { op.phase == "challenging",
      s' = if (not(owns(id)))
        s.with("operations", s.operations.set(id, op.with("phase", "stopped")))
      else if (valid) s.with("operations", s.operations.set(id, op.with("phase", "sign-ready")))
      else s.with("operations", s.operations.set(id, op.with("phase", "error")))
        .with("busy", 0).with("error", id).with("refreshed", s.refreshed.union(Set(id))) }
  }
  action requestSignature(id: int): bool = {
    val op = s.operations.get(id)
    all { owns(id), op.phase == "sign-ready",
      s' = s.with("operations", s.operations.set(id, op.with("phase", "signing")))
        .with("signatureRequests", s.signatureRequests.set(id,
          s.signatureRequests.get(id).union(Set(op.chain)))) }
  }
  action signatureReply(id: int): bool = {
    val op = s.operations.get(id)
    all { op.phase == "signing",
      s' = s.with("signatures", s.signatures.set(id, s.signatures.get(id).union(Set(op.chain))))
        .with("operations", s.operations.set(id,
          op.with("phase", if (owns(id)) "authorize-ready" else "stopped"))) }
  }
  action requestAuthorization(id: int): bool = {
    val op = s.operations.get(id)
    all { owns(id), op.phase == "authorize-ready",
      s' = s.with("operations", s.operations.set(id, op.with("phase", "authorizing")))
        .with("authorizationRequests", s.authorizationRequests.set(id,
          s.authorizationRequests.get(id).union(Set(op.chain)))) }
  }
  action acceptAuthorization(id: int, chain: int): bool = all {
    s.authorizationRequests.get(id).contains(chain), not(s.authorized.get(id).contains(chain)),
    s' = s.with("authorized", s.authorized.set(id, s.authorized.get(id).union(Set(chain))))
  }
  action authorizationReply(id: int): bool = {
    val op = s.operations.get(id)
    all { op.phase == "authorizing", s.authorized.get(id).contains(op.chain),
      s' = if (not(owns(id)))
        s.with("operations", s.operations.set(id, op.with("phase", "stopped")))
      else if (op.chain == 1)
        s.with("operations", s.operations.set(id, op.with("chain", 2).with("phase", "ready")))
      else s.with("operations", s.operations.set(id, op.with("phase", "done")))
        .with("busy", 0).with("success", id).with("refreshed", s.refreshed.union(Set(id))) }
  }
  action failure(id: int): bool = {
    val op = s.operations.get(id)
    all { Set("connecting", "registering", "challenging", "signing", "authorizing").contains(op.phase),
      s' = if (not(owns(id)))
        s.with("operations", s.operations.set(id, op.with("phase", "stopped")))
      else s.with("operations", s.operations.set(id, op.with("phase", "error")))
        .with("busy", 0).with("error", id)
        .with("refreshed", if (op.phase == "connecting") s.refreshed else s.refreshed.union(Set(id))) }
  }
  action depart = all { s.mounted, s' = s.with("mounted", false) }
  action remount = all { not(s.mounted), s.instance == 1,
    s' = s.with("instance", 2).with("mounted", true).with("current", 0)
      .with("busy", 0).with("error", 0).with("success", 0) }
  action step = {
    nondet id = ids.oneOf()
    nondet chain = chains.oneOf()
    nondet valid = Set(false, true).oneOf()
    any { existingConfirmed(chain), connect(id), connectReply(id, valid), confirmReplacement, keepSaved,
      register(id), skipConfirmed(id), acceptRegistration(id, chain), registrationReply(id),
      requestChallenge(id), challengeReply(id, valid), requestSignature(id),
      signatureReply(id), requestAuthorization(id), acceptAuthorization(id, chain),
      authorizationReply(id), failure(id), depart, remount, s' = s }
  }
  val invariant = all {
    ids.contains(s.instance), Set(0, 1, 2).contains(s.current),
    ids.forall(id => all {
      s.registered.get(id).subseteq(s.registrationRequests.get(id)),
      s.signatures.get(id).subseteq(s.signatureRequests.get(id)),
      s.authorizationRequests.get(id).subseteq(s.signatures.get(id)),
      s.authorized.get(id).subseteq(s.authorizationRequests.get(id)),
      s.signatureRequests.get(id).subseteq(s.registered.get(id)),
      chains.contains(s.operations.get(id).chain)
    }),
    s.mounted and s.busy > 0 implies owns(s.busy)
  }

  run currentTwoChainSuccessTest = init.then(connect(1)).then(connectReply(1, false))
    .then(register(1)).then(acceptRegistration(1, 1)).then(registrationReply(1))
    .then(requestChallenge(1)).then(challengeReply(1, true)).then(requestSignature(1))
    .then(signatureReply(1)).then(requestAuthorization(1)).then(acceptAuthorization(1, 1))
    .then(authorizationReply(1)).then(register(1)).then(acceptRegistration(1, 2))
    .then(registrationReply(1)).then(requestChallenge(1)).then(challengeReply(1, true))
    .then(requestSignature(1)).then(signatureReply(1)).then(requestAuthorization(1))
    .then(acceptAuthorization(1, 2)).then(authorizationReply(1))
    .expect(s.success == 1 and s.authorized.get(1) == chains and invariant)
  run departedConnectionStopsRegistrationTest = init.then(connect(1)).then(depart)
    .then(connectReply(1, false)).expect(s.registrationRequests.get(1) == Set()
      and s.operations.get(1).phase == "stopped")
  run departedBeforeRegistrationRefusesStartTest = init.then(connect(1))
    .then(connectReply(1, false)).then(depart).then(register(1).fail())
  run departedRegistrationKeepsAcceptedRowTest = init.then(connect(1)).then(connectReply(1, false))
    .then(register(1)).then(depart).then(acceptRegistration(1, 1)).then(registrationReply(1))
    .expect(s.registered.get(1) == Set(1) and s.signatureRequests.get(1) == Set())
  run departedChallengeCannotPromptTest = init.then(connect(1)).then(connectReply(1, false))
    .then(register(1)).then(acceptRegistration(1, 1)).then(registrationReply(1))
    .then(requestChallenge(1)).then(depart).then(challengeReply(1, true))
    .expect(s.signatureRequests.get(1) == Set() and s.operations.get(1).phase == "stopped")
  run departedSignatureCannotAuthorizeTest = init.then(connect(1)).then(connectReply(1, false))
    .then(register(1)).then(acceptRegistration(1, 1)).then(registrationReply(1))
    .then(requestChallenge(1)).then(challengeReply(1, true)).then(requestSignature(1))
    .then(depart).then(signatureReply(1)).expect(s.signatures.get(1) == Set(1)
      and s.authorizationRequests.get(1) == Set())
  run acceptedAuthorizationSurvivesDepartureTest = init.then(connect(1)).then(connectReply(1, false))
    .then(register(1)).then(acceptRegistration(1, 1)).then(registrationReply(1))
    .then(requestChallenge(1)).then(challengeReply(1, true)).then(requestSignature(1))
    .then(signatureReply(1)).then(requestAuthorization(1)).then(depart)
    .then(acceptAuthorization(1, 1)).then(authorizationReply(1))
    .expect(s.authorized.get(1) == Set(1) and not(s.registrationRequests.get(1).contains(2)))
  run oldConnectionCannotResetNewInstanceBusyTest = init.then(connect(1)).then(depart)
    .then(remount).then(connect(2)).then(connectReply(1, false))
    .expect(s.busy == 2 and s.current == 2 and s.registrationRequests.get(1) == Set())
  run replacedOperationCannotResetBusyTest = init.then(connect(1)).then(connect(2))
    .then(failure(1)).expect(s.busy == 2 and s.error == 0)
  run currentConnectionFailureTest = init.then(connect(1)).then(failure(1))
    .expect(s.error == 1 and s.busy == 0 and s.refreshed == Set())
  run invalidChallengeRefusesSignatureTest = init.then(connect(1)).then(connectReply(1, false))
    .then(register(1)).then(acceptRegistration(1, 1)).then(registrationReply(1))
    .then(requestChallenge(1)).then(challengeReply(1, false))
    .expect(s.error == 1 and s.signatureRequests.get(1) == Set() and s.refreshed == Set(1))
  run acceptedRegistrationSurvivesLostResponseTest = init.then(connect(1)).then(connectReply(1, false))
    .then(register(1)).then(failure(1)).then(acceptRegistration(1, 1))
    .expect(s.registered.get(1) == Set(1) and s.error == 1)
  run replacementNeedsConsentTest = init.then(connect(1)).then(connectReply(1, true))
    .then(register(1).fail())
  run replacementConsentStartsNewOperationTest = init.then(connect(1)).then(connectReply(1, true))
    .then(confirmReplacement).then(register(2)).expect(s.current == 2
      and s.registrationRequests.get(2) == Set(1))
  run keepSavedStartsNoRegistrationTest = init.then(connect(1)).then(connectReply(1, true))
    .then(keepSaved).expect(s.registrationRequests.get(1) == Set())
  run confirmedMatchingWalletSkipsNewSignaturesTest = init.then(existingConfirmed(1))
    .then(existingConfirmed(2)).then(connect(1)).then(connectReply(1, false))
    .then(skipConfirmed(1)).then(skipConfirmed(1)).expect(s.success == 1
      and s.registrationRequests.get(1) == Set() and s.signatureRequests.get(1) == Set())
}
