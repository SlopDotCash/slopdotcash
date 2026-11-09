// @source src/Earnings.tsx
// @source backend/payments/handler.ts
// @source backend/payments/wallet-registration.ts
// @source backend/http.ts
// @evidence tests/e2e/earnings-wallet-lifetime.spec.ts
// @evidence backend/payments/wallet-replacement.test.ts
// One modeled wallet flow, two actors/family chains, one replacing operation
// token, one explicit session reset and one account read. Replacement-token
// behavior stands for a newer walletStep; its own workflow is modeled by
// ui_earnings_wallet_lifetime. Counters are finite exploration bounds, not
// application caps. Signature/address/schema checks and atomic server writes
// are predicates; this is not an implementation refinement proof.
// depart is committed unmount: layout cleanup retires the wallet token and
// cancels the active reader before a later promise continuation can run. The
// earlier passive-only cleanup did not establish that commit-time boundary.
// Session observation, helper return and synchronous caller consumption are
// distinct transitions. A true result does not freeze operation ownership.
// Every effect consumes it together with a fresh isCurrent check. Server
// admission separately checks the expected actor header. An admitted old
// request can survive departure; it cannot authorize another client effect.
// requestActor is the credential identity of the dispatched HTTP request,
// which a later browser-cookie change does not rewrite. Admission models that
// captured session still being valid; independent server revocation can refuse.
// The account read separates initial identity, data, final identity observation,
// validation and publication. clearAccount aborts the current reader, including
// after its final identity was read. A successful newly validated actor switch
// intentionally calls clearAccount then publishes that new value in the same
// synchronous completion. That self-cancellation is not a stale restoration.
// A failed final identity lookup is an error with prior data retained; an
// observed missing/different identity clears it. These are distinct outcomes.
// Session observations are snapshots, not continuous cookie authority. The
// old unguarded-consumption and uncancelled-read controls are outside step.
// All scenarios were authored without executing a parser, checker or browser.
module ui_earnings_actor_binding {
  type State = { mounted: bool, cookie: int, dataActor: int, actor: int,
    phase: str, next: str, chain: int, currentToken: int, token: int,
    replacementUsed: bool, resetUsed: bool, observedActor: int, requestActor: int, returned: bool,
    registered: Set[int], authorized: Set[int], prompts: Set[int], error: bool,
    connects: int, offeredChange: bool, badEffect: bool, badRestore: bool,
    readUsed: bool, readerAlive: bool, readPhase: str, readInitial: int,
    readActor: int, readFinal: int, reading: bool }
  var s: State
  action init = s' = { mounted: true, cookie: 1, dataActor: 1, actor: 0,
    phase: "idle", next: "none", chain: 1, currentToken: 0, token: 0,
    replacementUsed: false, resetUsed: false, observedActor: -1, requestActor: 0, returned: false,
    registered: Set(), authorized: Set(), prompts: Set(), error: false,
    connects: 0, offeredChange: false, badEffect: false, badRestore: false,
    readUsed: false, readerAlive: false, readPhase: "idle", readInitial: 0,
    readActor: 0, readFinal: -1, reading: false }
  def key(actor: int, chain: int): int = actor * 10 + chain
  val owns = s.mounted and s.actor > 0 and s.token == s.currentToken
  val clearAccount = s.with("currentToken", s.currentToken + 1).with("dataActor", 0)
    .with("readerAlive", false).with("reading", false).with("offeredChange", false)
  val refused = if (owns) clearAccount.with("phase", "stopped").with("error", true)
    else s.with("phase", "stopped")
  action cookieChanges(actor: int): bool = all { Set(0, 1, 2).contains(actor), s' = s.with("cookie", actor) }
  action begin = all { s.mounted, s.dataActor > 0, s.actor == 0, s.phase == "idle",
    s' = s.with("actor", s.dataActor).with("currentToken", s.currentToken + 1)
      .with("token", s.currentToken + 1).with("phase", "connect-check").with("error", false) }
  action querySession = {
    val nextValue = if (s.phase == "connect-check") "connect" else if (s.phase == "register-check") "register"
      else if (s.phase == "challenge-check") "challenge" else if (s.phase == "sign-check") "sign"
      else if (s.phase == "authorize-check") "authorize" else "next"
    all { Set("connect-check", "register-check", "challenge-check", "sign-check", "authorize-check", "next-check").contains(s.phase),
      s' = if (owns) s.with("phase", "check-query").with("next", nextValue).with("returned", false)
        else s.with("phase", "stopped") }
  }
  action observeSession(available: bool): bool = all { s.phase == "check-query",
    s' = s.with("phase", "check-observed").with("observedActor", if (available) s.cookie else -1) }
  action returnCheck = all { s.phase == "check-observed",
    s' = if (not(owns)) s.with("phase", "stopped").with("returned", false)
      else if (s.observedActor == -1) s.with("phase", "stopped").with("error", true).with("returned", false)
      else if (s.observedActor != s.actor) refused.with("returned", false)
      else s.with("phase", "checked").with("returned", true) }
  action checkActor(available: bool): bool = querySession.then(observeSession(available)).then(returnCheck)
  action connectStart = all { s.phase == "checked", s.next == "connect", s.returned,
    s' = if (owns) s.with("phase", "connecting").with("connects", s.connects + 1) else s.with("phase", "stopped") }
  action connectReply = all { s.phase == "connecting",
    s' = s.with("phase", if (owns) "register-check" else "stopped") }
  action offerReplacement = all { s.phase == "checked", s.next == "register", s.returned,
    s' = if (owns) s.with("offeredChange", true).with("phase", "consent") else s.with("phase", "stopped") }
  action requestRegistration = all { s.phase == "checked", s.next == "register", s.returned,
    s' = if (owns) s.with("phase", "register-http").with("requestActor", s.cookie) else s.with("phase", "stopped") }
  action admitRegistration = all { s.phase == "register-http",
    s' = if (s.requestActor == s.actor) s.with("registered", s.registered.union(Set(key(s.actor, s.chain)))).with("phase", "register-reply")
      else s.with("phase", "refused") }
  action registrationReply = all { s.phase == "register-reply",
    s' = s.with("phase", if (owns) "challenge-check" else "stopped") }
  action requestChallenge = all { s.phase == "checked", s.next == "challenge", s.returned,
    s' = if (owns) s.with("phase", "challenge-http").with("requestActor", s.cookie) else s.with("phase", "stopped") }
  action admitChallenge = all { s.phase == "challenge-http",
    s' = if (s.requestActor == s.actor and s.registered.contains(key(s.actor, s.chain))) s.with("phase", "challenge-reply")
      else s.with("phase", "refused") }
  action challengeReply = all { s.phase == "challenge-reply",
    s' = s.with("phase", if (owns) "sign-check" else "stopped") }
  action sign = all { s.phase == "checked", s.next == "sign", s.returned,
    s' = if (owns) s.with("prompts", s.prompts.union(Set(key(s.actor, s.chain)))).with("phase", "signing")
      else s.with("phase", "stopped") }
  action signatureReply = all { s.phase == "signing",
    s' = s.with("phase", if (owns) "authorize-check" else "stopped") }
  action requestAuthorization = all { s.phase == "checked", s.next == "authorize", s.returned,
    s' = if (owns) s.with("phase", "authorize-http").with("requestActor", s.cookie) else s.with("phase", "stopped") }
  action admitAuthorization = all { s.phase == "authorize-http",
    s' = if (s.requestActor == s.actor and s.registered.contains(key(s.actor, s.chain)) and s.prompts.contains(key(s.actor, s.chain)))
      s.with("authorized", s.authorized.union(Set(key(s.actor, s.chain)))).with("phase", "authorize-reply")
      else s.with("phase", "refused") }
  action authorizationReply = all { s.phase == "authorize-reply",
    s' = s.with("phase", if (owns) "next-check" else "stopped") }
  action nextChain = all { s.phase == "checked", s.next == "next", s.returned, s.chain == 1,
    s' = if (owns) s.with("chain", 2).with("phase", "register-check") else s.with("phase", "stopped") }
  action done = all { s.phase == "checked", s.next == "next", s.returned, s.chain == 2,
    s' = s.with("phase", if (owns) "done" else "stopped") }
  action refusalReply = all { s.phase == "refused", s' = refused }
  action depart = all { s.mounted, s' = s.with("mounted", false).with("currentToken", s.currentToken + 1)
    .with("readerAlive", false).with("reading", false) }
  action replacementOperation = all { s.actor > 0, not(s.replacementUsed),
    s' = s.with("replacementUsed", true).with("currentToken", s.currentToken + 1) }
  action explicitSessionReset = all { not(s.resetUsed), s' = clearAccount.with("resetUsed", true) }

  action beginRead = all { s.mounted, not(s.readUsed),
    s' = s.with("readUsed", true).with("readerAlive", true).with("reading", true).with("readPhase", "initial") }
  action initialReadReply(available: bool): bool = all { s.readPhase == "initial",
    s' = if (not(s.readerAlive)) s.with("readPhase", "cancelled")
      else if (available and s.cookie == 0) clearAccount.with("readPhase", "error").with("error", true)
      else s.with("readInitial", if (available) s.cookie else 0).with("readPhase", "account") }
  action accountReadReply = all { s.readPhase == "account",
    s' = if (not(s.readerAlive)) s.with("readPhase", "cancelled")
      else if (s.cookie == 0 or (s.readInitial > 0 and s.cookie != s.readInitial))
        clearAccount.with("readPhase", "error").with("error", true)
      else s.with("readActor", s.cookie).with("readPhase", "final-query") }
  action observeReadSession(available: bool): bool = all { s.readPhase == "final-query",
    s' = s.with("readFinal", if (available) s.cookie else -1).with("readPhase", "final-observed") }
  action validateRead = all { s.readPhase == "final-observed",
    s' = if (not(s.readerAlive)) s.with("readPhase", "cancelled")
      else if (s.readFinal < 0) s.with("readPhase", "error").with("reading", false).with("error", true)
      else if (s.readFinal != s.readActor or s.readFinal == 0
        or (s.readInitial > 0 and s.readFinal != s.readInitial))
        clearAccount.with("readPhase", "error").with("error", true)
      else s.with("readPhase", "ready") }
  action publishRead = all { s.readPhase == "ready",
    s' = if (not(s.readerAlive) or not(s.mounted)) s.with("readPhase", "cancelled")
      else (if (s.dataActor > 0 and s.dataActor != s.readActor) clearAccount else s)
        .with("dataActor", s.readActor).with("readPhase", "published").with("reading", false) }
  action startRead = beginRead.then(initialReadReply(true)).then(accountReadReply)
  action finishRead = observeReadSession(true).then(validateRead)
  // The former caller trusted returned=true without an ownership check, and
  // clearAccount left its old reader live. These controls are not in step.
  action oldConsumeReturnedTrue = all { s.phase == "checked", s.returned, not(owns), s' = s.with("badEffect", true) }
  action oldRestoreCapturedRead = all { s.readPhase == "ready", not(s.readerAlive), s.readActor > 0,
    s' = s.with("dataActor", s.readActor).with("badRestore", true) }
  action step = {
    nondet actor = Set(0, 1, 2).oneOf()
    nondet available = Set(false, true).oneOf()
    any { cookieChanges(actor), begin, querySession, observeSession(available), returnCheck,
      connectStart, connectReply, offerReplacement, requestRegistration, admitRegistration, registrationReply,
      requestChallenge, admitChallenge, challengeReply, sign, signatureReply, requestAuthorization,
      admitAuthorization, authorizationReply, nextChain, done, refusalReply, depart, replacementOperation,
      explicitSessionReset, beginRead, initialReadReply(available), accountReadReply, observeReadSession(available),
      validateRead, publishRead, s' = s }
  }
  val invariant = all { s.chain >= 1 and s.chain <= 2, s.currentToken >= 0 and s.currentToken <= 6,
    not(s.badEffect), not(s.badRestore), s.authorized.subseteq(s.registered), s.authorized.subseteq(s.prompts),
    s.registered.forall(entry => entry == key(s.actor, 1) or entry == key(s.actor, 2)),
    s.connects <= 1, s.offeredChange implies s.actor > 0 }
  action started = begin.then(checkActor(true)).then(connectStart)
  action registered = started.then(connectReply).then(checkActor(true)).then(requestRegistration).then(admitRegistration).then(registrationReply)
  action challenged = registered.then(checkActor(true)).then(requestChallenge).then(admitChallenge).then(challengeReply)
  action signed = challenged.then(checkActor(true)).then(sign).then(signatureReply)

  run connectionReturnAfterActorSwapStopsTest = init.then(started).then(cookieChanges(2)).then(connectReply).then(checkActor(true))
    .expect(s.phase == "stopped" and s.dataActor == 0 and s.registered == Set() and invariant)
  run headerCatchesSwapAfterFreshCheckTest = init.then(started).then(connectReply).then(checkActor(true)).then(cookieChanges(2))
    .then(requestRegistration).then(admitRegistration).then(refusalReply).expect(s.dataActor == 0 and s.registered == Set() and invariant)
  run acceptedRegistrationIsRetainedOnSwapTest = init.then(started).then(connectReply).then(checkActor(true)).then(requestRegistration)
    .then(admitRegistration).then(cookieChanges(2)).then(registrationReply).then(checkActor(true))
    .expect(s.registered == Set(11) and s.prompts == Set() and s.dataActor == 0 and invariant)
  run changedChallengeActorCannotSignTest = init.then(registered).then(checkActor(true)).then(requestChallenge).then(admitChallenge)
    .then(cookieChanges(2)).then(challengeReply).then(checkActor(true)).expect(s.prompts == Set() and s.dataActor == 0 and invariant)
  run lateSignatureCannotAuthorizeBTest = init.then(challenged).then(checkActor(true)).then(sign).then(cookieChanges(2))
    .then(signatureReply).then(checkActor(true)).expect(s.authorized == Set() and s.dataActor == 0 and invariant)
  run acceptedAAuthorizationCannotStartBChainTest = init.then(signed).then(checkActor(true)).then(requestAuthorization)
    .then(admitAuthorization).then(cookieChanges(2)).then(authorizationReply).then(checkActor(true))
    .expect(s.authorized == Set(11) and s.chain == 1 and s.dataActor == 0 and invariant)
  run signOutClearsAccountBeforePromptTest = init.then(begin).then(cookieChanges(0)).then(checkActor(true))
    .expect(s.dataActor == 0 and s.prompts == Set() and s.phase == "stopped" and invariant)
  run unavailableSessionDoesNotAdvanceTest = init.then(begin).then(checkActor(false))
    .expect(s.phase == "stopped" and s.registered == Set() and s.prompts == Set() and invariant)
  run differentAccountReadClearsOldDataTest = init.then(startRead).then(cookieChanges(2)).then(finishRead)
    .expect(s.dataActor == 0 and s.error and invariant)
  run sameAccountMayAuthorizeTest = init.then(signed).then(checkActor(true)).then(requestAuthorization).then(admitAuthorization)
    .then(authorizationReply).then(checkActor(true)).then(nextChain)
    .expect(s.authorized == Set(11) and s.phase == "register-check" and s.chain == 2 and invariant)
  run departureAfterTrueHelperReturnCannotConnectTest = init.then(begin).then(checkActor(true)).then(depart).then(connectStart)
    .expect(s.connects == 0 and s.phase == "stopped" and invariant)
  run replacementAfterTrueHelperReturnCannotRegisterTest = init.then(started).then(connectReply).then(checkActor(true))
    .then(replacementOperation).then(requestRegistration).expect(s.phase == "stopped" and s.registered == Set() and invariant)
  run sessionResetAfterTrueHelperReturnCannotPromptTest = init.then(challenged).then(checkActor(true)).then(explicitSessionReset).then(sign)
    .expect(s.prompts == Set() and s.dataActor == 0 and invariant)
  run departureAfterTrueHelperReturnCannotAuthorizeTest = init.then(signed).then(checkActor(true)).then(depart).then(requestAuthorization)
    .expect(s.phase == "stopped" and s.authorized == Set() and invariant)
  run replacementAfterConnectionCheckCannotOpenConsentTest = init.then(started).then(connectReply).then(checkActor(true))
    .then(replacementOperation).then(offerReplacement).expect(not(s.offeredChange) and invariant)
  run helperObservedBeforeResetCannotReturnAuthorityTest = init.then(begin).then(querySession).then(observeSession(true))
    .then(explicitSessionReset).then(returnCheck).expect(not(s.returned) and s.phase == "stopped" and invariant)
  run callerHeaderStillCatchesCookieChangeAfterObservationTest = init.then(started).then(connectReply).then(querySession)
    .then(observeSession(true)).then(cookieChanges(2)).then(returnCheck).then(requestRegistration).then(admitRegistration).then(refusalReply)
    .expect(s.registered == Set() and s.dataActor == 0 and invariant)
  run oldAcceptedRequestMayFinishAfterDepartureTest = init.then(started).then(connectReply).then(checkActor(true))
    .then(requestRegistration).then(depart).then(admitRegistration).then(registrationReply)
    .expect(s.registered == Set(11) and s.phase == "stopped" and s.prompts == Set() and invariant)
  run requestCookieSnapshotCanFinishBeforeFreshActorRecheckTest = init.then(started).then(connectReply).then(checkActor(true))
    .then(requestRegistration).then(cookieChanges(2)).then(admitRegistration).then(registrationReply).then(checkActor(true))
    .expect(s.registered == Set(11) and s.dataActor == 0 and s.prompts == Set() and invariant)
  run accessLossCancelsAlreadyValidatedAccountReadTest = init.then(startRead).then(finishRead).then(begin).then(cookieChanges(2))
    .then(checkActor(true)).then(publishRead).expect(s.dataActor == 0 and s.readPhase == "cancelled" and invariant)
  run explicitResetCancelsCapturedFinalSessionReadTest = init.then(startRead).then(observeReadSession(true)).then(explicitSessionReset)
    .then(validateRead).expect(s.dataActor == 0 and s.readPhase == "cancelled" and invariant)
  run validatedDifferentActorIsDeliberatelyPublishedTest = init.then(cookieChanges(2)).then(startRead).then(finishRead).then(publishRead)
    .expect(s.dataActor == 2 and not(s.readerAlive) and s.readPhase == "published" and invariant)
  run initialSessionFailureCanRecoverThroughAuthenticatedReadTest = init.then(beginRead).then(initialReadReply(false)).then(accountReadReply)
    .then(finishRead).then(publishRead).expect(s.dataActor == 1 and s.readPhase == "published" and invariant)
  run unavailableFinalSessionReadKeepsPriorDataWithErrorTest = init.then(startRead).then(observeReadSession(false)).then(validateRead)
    .expect(s.dataActor == 1 and s.readPhase == "error" and not(s.reading) and s.error and invariant)
  run readPublicationDoesNotClaimContinuousCookieAuthorityTest = init.then(startRead).then(finishRead).then(cookieChanges(2)).then(publishRead)
    .expect(s.dataActor == 1 and s.cookie == 2 and s.readPhase == "published" and invariant)
  run oldTrueReturnConsumptionNegativeControlTest = init.then(challenged).then(checkActor(true)).then(depart).then(oldConsumeReturnedTrue)
    .expect(s.badEffect and not(invariant))
  run oldUncancelledReadRestorationNegativeControlTest = init.then(startRead).then(finishRead).then(begin).then(cookieChanges(2))
    .then(checkActor(true)).then(oldRestoreCapturedRead).expect(s.dataActor == 1 and s.badRestore and not(invariant))
}
