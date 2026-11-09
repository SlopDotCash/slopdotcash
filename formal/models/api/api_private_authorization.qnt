// @source migrations/0061_security_automatic_intake.sql
// @source backend/security/intake-grant.ts
// @source backend/security/github-advisories.ts
// @evidence backend/security/submissions.test.ts
// Two flow nonces, callbacks, actors, sessions and submissions. One code per
// flow; one shared grant cookie; clock positions 0..8, flow starts at 0..2.
// Flow/grant lifetimes are two/four ticks, not a real clock ratio.
// Capture, validation, exchange, /user, seal and cookie delivery are separate.
// Expiry uses the callback's captured now argument, not a renewed async lease.
// Callbacks never mutate FLOW_COOKIE; its encrypted verifier expires by TTL.
// Provider code single-use is an external OAuth assumption, not a property
// supplied by flow-cookie deletion: RFC 6749 section 4.1.2.
// https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2
// AES-GCM, PKCE, parsed fields and cookie attributes are predicates here.
// The caller owns session-read availability. A later successful response may
// replace the one grant cookie, including for another submission. These
// source-authored scenarios have not been parsed, simulated or executed.
module api_private_authorization {
  val ids = Set(1, 2)
  type Flow = { exists: bool, session: int, actor: int, submission: int, until: int }
  type Callback = { phase: str, flow: int, nonce: int, actor: int, at: int, result: str }
  val noFlow: Flow = { exists: false, session: 0, actor: 0, submission: 0, until: 0 }
  val noCallback: Callback = { phase: "unused", flow: 0, nonce: 0, actor: 0, at: 0, result: "none" }
  var s: { phase: str, session: int, actor: int, submission: int, now: int,
    flowCookie: int, flowUntil: int, flows: int -> Flow, callbacks: int -> Callback,
    consumedCodes: Set[int], hasGrant: bool, grant: int, grantUntil: int, grantIntact: bool,
    usedFlow: int, usedSession: int, usedActor: int, usedSubmission: int, usedAt: int, usedUntil: int }
  def flow(id: int): Flow = if (ids.contains(id)) s.flows.get(id) else noFlow
  def response(c: Callback, result: str): Callback = c.with("phase", "response").with("result", result)
  action init = s' = { phase: "idle", session: 1, actor: 1, submission: 1, now: 0,
    flowCookie: 0, flowUntil: 0, flows: ids.mapBy(_ => noFlow), callbacks: ids.mapBy(_ => noCallback),
    consumedCodes: Set(), hasGrant: false, grant: 0, grantUntil: 0, grantIntact: true,
    usedFlow: 0, usedSession: 0, usedActor: 0, usedSubmission: 0, usedAt: 0, usedUntil: 0 }
  action beginFlow(id: int): bool = all { ids.contains(id), not(flow(id).exists), s.now <= 2,
    s.session != 0, s.actor != 0,
    s' = s.with("phase", "authorizing").with("flowCookie", id).with("flowUntil", s.now + 2)
      .with("flows", s.flows.set(id, { exists: true, session: s.session, actor: s.actor, submission: s.submission, until: s.now + 2 })) }
  action begin = all { s.phase == "idle", s.now == 0, beginFlow(1) }
  action capture(id: int, nonce: int, actor: int): bool = all {
    ids.contains(id), ids.contains(nonce), Set(0, 1, 2).contains(actor), s.callbacks.get(id).phase == "unused",
    s' = s.with("callbacks", s.callbacks.set(id, { phase: "validate", flow: s.flowCookie, nonce: nonce, actor: actor, at: s.now, result: "none" })) }
  action validate(id: int, authenticated: bool, codeSyntax: bool): bool = {
    val c = s.callbacks.get(id)
    val f = flow(c.flow)
    all { c.phase == "validate",
      s' = s.with("callbacks", s.callbacks.set(id,
        if (not(authenticated) or not(f.exists) or c.at >= f.until) response(c, "flow-missing")
        else if (c.nonce != c.flow or not(codeSyntax)) response(c, "state-mismatch")
        else c.with("phase", "exchange"))) }
  }
  action exchange(id: int, success: bool): bool = {
    val c = s.callbacks.get(id)
    val accepted = success and not(s.consumedCodes.contains(c.flow))
    all { c.phase == "exchange",
      s' = s.with("consumedCodes", if (accepted) s.consumedCodes.union(Set(c.flow)) else s.consumedCodes)
        .with("callbacks", s.callbacks.set(id,
          if (accepted) c.with("phase", "identity") else response(c, "exchange-failed"))) }
  }
  action identify(id: int, providerActor: int, available: bool): bool = {
    val c = s.callbacks.get(id)
    val f = flow(c.flow)
    all { c.phase == "identity", ids.contains(providerActor),
      s' = s.with("callbacks", s.callbacks.set(id,
        if (not(available)) response(c, "exchange-failed")
        else if (providerActor != f.actor or (c.actor != 0 and c.actor != f.actor)) response(c, "identity-mismatch")
        else c.with("phase", "seal"))) }
  }
  action seal(id: int, success: bool): bool = {
    val c = s.callbacks.get(id)
    all { c.phase == "seal", s' = s.with("callbacks", s.callbacks.set(id, response(c, if (success) "ok" else "error"))) }
  }
  action deliver(id: int): bool = {
    val c = s.callbacks.get(id)
    val accepted = c.result == "ok"
    all { c.phase == "response",
      s' = s.with("callbacks", s.callbacks.set(id, c.with("phase", "done")))
        .with("phase", if (accepted) "authorized" else "callback-error")
        .with("hasGrant", s.hasGrant or accepted).with("grant", if (accepted) c.flow else s.grant)
        .with("grantUntil", if (accepted) c.at + 4 else s.grantUntil)
        .with("grantIntact", if (accepted) true else s.grantIntact) }
  }
  // Former callback deletion is excluded from step.
  action oldDeliverAndClear(id: int): bool = deliver(id).then(s' = s.with("flowCookie", 0))
  action switchSession = s' = s.with("session", 2)
  action switchActor = s' = s.with("actor", 2)
  action switchAccount = s' = s.with("actor", 2).with("session", 2)
  action signOut = s' = s.with("actor", 0).with("session", 0)
  action switchSubmission = s' = s.with("submission", 2)
  action tamperGrant = s' = s.with("grantIntact", false)
  action expireCookie = all { s.flowCookie != 0, s.now >= flow(s.flowCookie).until, s' = s.with("flowCookie", 0) }
  action useGrant = {
    val f = flow(s.grant)
    all { s.hasGrant, s.grantIntact, s.now < s.grantUntil,
      s.session == f.session, s.actor == f.actor, s.submission == f.submission,
      s' = s.with("phase", "used").with("usedFlow", s.grant).with("usedSession", s.session)
        .with("usedActor", s.actor).with("usedSubmission", s.submission).with("usedAt", s.now).with("usedUntil", s.grantUntil) }
  }
  action tick = all { s.now < 8, s' = s.with("now", s.now + 1) }
  // Preserve the earlier one-flow success/refusal scenarios.
  action finishAllowed(providerActor: int, callbackActor: int): bool = all {
    flow(s.flowCookie).exists, s.now < flow(s.flowCookie).until, providerActor == flow(s.flowCookie).actor,
    callbackActor == 0 or callbackActor == flow(s.flowCookie).actor, s' = s }
  action finish(providerActor: int, callbackActor: int): bool = finishAllowed(providerActor, callbackActor)
    .then(capture(1, 1, callbackActor)).then(validate(1, true, true)).then(exchange(1, true))
    .then(identify(1, providerActor, true)).then(seal(1, true)).then(deliver(1))
  action validCallback(id: int, nonce: int): bool = capture(id, nonce, 0).then(validate(id, true, true))
  action complete(id: int): bool = exchange(id, true).then(identify(id, 1, true)).then(seal(id, true)).then(deliver(id))
  action step = {
    nondet id = ids.oneOf()
    nondet nonce = ids.oneOf()
    nondet callbackActor = Set(0, 1, 2).oneOf()
    nondet providerActor = ids.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { beginFlow(id), capture(id, nonce, callbackActor), validate(id, yes, other), exchange(id, yes),
      identify(id, providerActor, yes), seal(id, yes), deliver(id), switchSession, switchActor, switchAccount,
      signOut, switchSubmission, tamperGrant, expireCookie, useGrant, tick, s' = s }
  }
  val invariant = all {
    s.consumedCodes.subseteq(ids), s.flowCookie == 0 or flow(s.flowCookie).exists,
    s.hasGrant implies flow(s.grant).exists and s.consumedCodes.contains(s.grant),
    s.phase == "used" implies (s.usedSession == flow(s.usedFlow).session and s.usedActor == flow(s.usedFlow).actor
      and s.usedSubmission == flow(s.usedFlow).submission and s.usedAt < s.usedUntil)
  }
  run boundGrantTest = init.then(begin).then(finish(1,1)).then(useGrant).expect(s.hasGrant)
  run callbackWithoutSiteCookieTest = init.then(begin).then(finish(1,0)).then(useGrant).expect(s.hasGrant)
  run callbackAfterSignOutCannotReadTest = init.then(begin).then(signOut).then(finish(1,0)).then(useGrant.fail())
  run switchedAccountTest = init.then(begin).then(switchAccount).then(finish(1,0)).then(useGrant.fail())
  run callbackWrongAccountRefusedTest = init.then(begin).then(finishAllowed(1,2).fail())
  run providerWrongAccountRefusedTest = init.then(begin).then(finishAllowed(2,0).fail())
  run switchedReportTest = init.then(begin).then(finish(1,0)).then(switchSubmission).then(useGrant.fail())
  run sameActorNewSessionRefusedTest = init.then(begin).then(finish(1,0)).then(switchSession).then(useGrant.fail())
  run changedActorRefusedTest = init.then(begin).then(finish(1,0)).then(switchActor).then(useGrant.fail())
  run expiredFlowRefusedTest = init.then(begin).then(tick).then(tick).then(finishAllowed(1,0).fail())
  run grantOutlivesFlowTest = init.then(begin).then(tick).then(finish(1,0)).then(tick).then(tick).then(useGrant)
    .expect(s.now >= s.flowUntil and s.usedAt < s.grantUntil)
  run expiredGrantRefusedTest = init.then(begin).then(finish(1,0)).then(tick).then(tick).then(tick).then(tick).then(useGrant.fail())
  run grantReadDoesNotConsumeTest = init.then(begin).then(finish(1,0)).then(useGrant).then(useGrant).expect(s.hasGrant)
  run malformedFlowIsRefusedWithoutClearingCookieTest = init.then(begin).then(capture(1,1,0)).then(validate(1,false,true)).then(deliver(1))
    .expect(not(s.hasGrant) and s.flowCookie == 1 and s.callbacks.get(1).result == "flow-missing")
  run expiredFlowServerRefusalTest = init.then(begin).then(tick).then(tick).then(capture(1,1,0)).then(validate(1,true,true)).then(deliver(1))
    .expect(not(s.hasGrant) and s.consumedCodes == Set() and s.callbacks.get(1).result == "flow-missing")
  run invalidCodeSyntaxNeverExchangesTest = init.then(begin).then(capture(1,1,0)).then(validate(1,true,false)).then(deliver(1))
    .expect(s.consumedCodes == Set() and s.callbacks.get(1).result == "state-mismatch")
  run exchangeFailureKeepsFlowTest = init.then(begin).then(validCallback(1,1)).then(exchange(1,false)).then(deliver(1))
    .expect(not(s.hasGrant) and s.flowCookie == 1)
  run userReadFailureKeepsFlowTest = init.then(begin).then(validCallback(1,1)).then(exchange(1,true)).then(identify(1,1,false)).then(deliver(1))
    .expect(not(s.hasGrant) and s.flowCookie == 1 and s.consumedCodes == Set(1))
  run providerMismatchDoesNotMintGrantTest = init.then(begin).then(validCallback(1,1)).then(exchange(1,true)).then(identify(1,2,true)).then(deliver(1))
    .expect(not(s.hasGrant) and s.callbacks.get(1).result == "identity-mismatch")
  run presentedActorMismatchDoesNotMintGrantTest = init.then(begin).then(capture(1,1,2)).then(validate(1,true,true))
    .then(exchange(1,true)).then(identify(1,1,true)).then(deliver(1)).expect(not(s.hasGrant))
  run sealingFailureKeepsFlowTest = init.then(begin).then(validCallback(1,1)).then(exchange(1,true)).then(identify(1,1,true)).then(seal(1,false)).then(deliver(1))
    .expect(not(s.hasGrant) and s.flowCookie == 1)
  run usedCodeCannotMintAgainTest = init.then(begin).then(finish(1,0)).then(validCallback(2,1)).then(exchange(2,true)).then(deliver(2))
    .expect(s.hasGrant and s.grant == 1 and s.callbacks.get(2).result == "exchange-failed")
  run tamperedGrantNeverReadsTest = init.then(begin).then(finish(1,0)).then(tamperGrant).then(useGrant.fail())
  run staleNonceCannotClearNewFlowTest = init.then(begin).then(switchSubmission).then(beginFlow(2))
    .then(validCallback(1,1)).then(deliver(1)).expect(s.flowCookie == 2 and not(s.hasGrant))
    .then(validCallback(2,2)).then(complete(2)).then(useGrant).expect(s.usedFlow == 2 and invariant)
  run inFlightSuccessCannotClearNewFlowTest = init.then(begin).then(validCallback(1,1)).then(switchSubmission).then(beginFlow(2))
    .then(complete(1)).expect(s.flowCookie == 2 and s.grant == 1)
    .then(validCallback(2,2)).then(complete(2)).then(useGrant).expect(s.grant == 2 and invariant)
  run inFlightFailureCannotClearNewFlowTest = init.then(begin).then(validCallback(1,1)).then(switchSubmission).then(beginFlow(2))
    .then(exchange(1,false)).then(deliver(1)).expect(s.flowCookie == 2 and not(s.hasGrant))
    .then(validCallback(2,2)).then(complete(2)).then(useGrant).expect(s.usedFlow == 2)
  run inFlightFlowUsesCapturedDeadlineTest = init.then(begin).then(validCallback(1,1)).then(tick).then(tick).then(complete(1))
    .then(useGrant).expect(s.now >= s.flowUntil and s.usedAt < s.usedUntil)
  run grantCookieStillUsesLastSuccessfulResponseTest = init.then(begin).then(validCallback(1,1)).then(exchange(1,true)).then(identify(1,1,true))
    .then(switchSubmission).then(beginFlow(2)).then(validCallback(2,2)).then(complete(2)).then(seal(1,true)).then(deliver(1))
    .expect(s.flowCookie == 2 and s.grant == 1).then(useGrant.fail())
  run browserMayExpireOnlyCurrentFlowTest = init.then(begin).then(tick).then(tick).then(expireCookie)
    .expect(s.flowCookie == 0 and not(s.hasGrant))
  run oldMismatchClearDestroysNewFlowNegativeControlTest = init.then(begin).then(switchSubmission).then(beginFlow(2))
    .then(validCallback(1,1)).then(oldDeliverAndClear(1)).expect(s.flowCookie == 0)
  run oldInFlightClearDestroysNewFlowNegativeControlTest = init.then(begin).then(validCallback(1,1)).then(switchSubmission).then(beginFlow(2))
    .then(exchange(1,false)).then(oldDeliverAndClear(1)).expect(s.flowCookie == 0)
}
