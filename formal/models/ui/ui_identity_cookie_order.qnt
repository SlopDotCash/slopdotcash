// @source workers/identity/handler.ts
// @source workers/identity/persistence.ts
// @source backend/http.ts
// @evidence workers/identity/cookie-order.test.ts
// @evidence workers/identity/failed-callback.test.ts
// @evidence workers/identity/expiry-boundary.test.ts
// Source-only model and scenarios, unexecuted. Two distinct flows/states, one
// authorize request for each flow, three callback requests, and clock 0..6.
// A state has one deterministic scoped cookie name: the fixed __Host prefix
// plus SHA-256(state). Hash collisions, cryptography, exact wire parsing and
// provider identities are external predicates. Two clock units stand for the
// five-minute lifetime. Creation is bounded to clock 0..1; expiry can therefore
// occur during the callback. Authorization lookup/decryption, captured callback
// cookies, claim, provider work, completion and response delivery are separate.
// The detailed D1 and lost-reply protocol remains in identity_callback_completion.
// Scoped cookie presence differs from an empty/wrong value. Only absence allows
// the legacy fixed-cookie fallback. New authorize responses write only their
// own scope, successful callbacks expire only their own scope, and no handler
// response changes the legacy slot. Legacy expiry remains a browser event.
// seedLegacy/seedScoped represent pre-upgrade cookies or untrusted HTTP input,
// not JavaScript access to an HttpOnly cookie. Duplicate authorize requests for
// one flow and native browser cookie storage are outside this finite bound.
module ui_identity_cookie_order {
  type Flow = { phase: str, expiry: int, claimedBy: int }
  type Authorize = { phase: str, stamp: int, status: int }
  type Callback = { phase: str, flow: int, cookie: int, scoped: bool,
    inputValid: bool, denied: bool, stamp: int, claimed: bool,
    verified: bool, completed: bool, status: int }
  type State = { now: int, flows: int -> Flow, authorizations: int -> Authorize,
    callbacks: int -> Callback, scoped: int -> int, present: Set[int],
    expires: int -> int, legacy: int, legacyExpiry: int,
    handlerChangedLegacy: bool, headerExpiries: Set[int] }
  val flows = Set(1, 2)
  val calls = Set(1, 2, 3)
  val noFlow: Flow = { phase: "unused", expiry: 0, claimedBy: 0 }
  val noAuthorize: Authorize = { phase: "unused", stamp: 0, status: 0 }
  val noCallback: Callback = { phase: "unused", flow: 1, cookie: 0,
    scoped: false, inputValid: true, denied: false, stamp: 0,
    claimed: false, verified: false, completed: false, status: 0 }
  var s: State
  def sendsScoped(flow: int): bool = s.present.contains(flow) and s.now < s.expires.get(flow)
  val sentLegacy = if (s.now < s.legacyExpiry) s.legacy else 0

  action init = s' = { now: 0, flows: flows.mapBy(_ => noFlow),
    authorizations: flows.mapBy(_ => noAuthorize), callbacks: calls.mapBy(_ => noCallback),
    scoped: flows.mapBy(_ => 0), present: Set(), expires: flows.mapBy(_ => 0),
    legacy: 0, legacyExpiry: 0, handlerChangedLegacy: false, headerExpiries: Set() }
  action create(flow: int): bool = all { flows.contains(flow), s.now <= 1,
    s.flows.get(flow).phase == "unused",
    s' = s.with("flows", s.flows.set(flow,
      { phase: "pending", expiry: s.now + 2, claimedBy: 0 })) }
  action tick = all { s.now < 6, s' = s.with("now", s.now + 1) }
  action expireRow(flow: int): bool = all { flows.contains(flow),
    s.flows.get(flow).phase != "unused", s.now >= s.flows.get(flow).expiry,
    s' = s.with("flows", s.flows.set(flow, s.flows.get(flow).with("phase", "expired"))) }
  action seedLegacy(value: int): bool = all { flows.contains(value),
    s.legacy == 0, calls.forall(id => s.callbacks.get(id).phase == "unused"),
    s' = s.with("legacy", value).with("legacyExpiry", s.now + 2) }
  action seedScoped(flow: int, value: int): bool = all { flows.contains(flow),
    Set(0, 1, 2).contains(value), s.authorizations.get(flow).phase == "unused",
    calls.forall(id => s.callbacks.get(id).phase == "unused"),
    s' = s.with("scoped", s.scoped.set(flow, value)).with("present", s.present.union(Set(flow)))
      .with("expires", s.expires.set(flow, s.now + 2)) }
  action expireScoped(flow: int): bool = all { s.present.contains(flow), s.now >= s.expires.get(flow),
    s' = s.with("present", s.present.exclude(Set(flow))).with("scoped", s.scoped.set(flow, 0)) }
  action expireLegacy = all { s.legacy > 0, s.now >= s.legacyExpiry,
    s' = s.with("legacy", 0) }

  // Invocation of findAuthorizableFlow after the state-hash await. Hash work
  // itself is delegated; this stamp is not the initial HTTP arrival time.
  action startAuthorize(flow: int): bool = all { flows.contains(flow),
    s.authorizations.get(flow).phase == "unused",
    s' = s.with("authorizations", s.authorizations.set(flow,
      noAuthorize.with("phase", "lookup").with("stamp", s.now))) }
  action readAuthorize(flow: int): bool = {
    val request = s.authorizations.get(flow)
    val valid = s.flows.get(flow).phase == "pending" and s.flows.get(flow).expiry > request.stamp
    all { request.phase == "lookup",
      s' = s.with("authorizations", s.authorizations.set(flow, request
        .with("phase", if (valid) "decrypt" else "response")
        .with("status", if (valid) 0 else 410))) }
  }
  action decryptAuthorize(flow: int, success: bool): bool = all {
    s.authorizations.get(flow).phase == "decrypt",
    s' = s.with("authorizations", s.authorizations.set(flow, s.authorizations.get(flow)
      .with("phase", "response").with("status", if (success) 302 else 500))) }
  action deliverAuthorize(flow: int): bool = {
    val request = s.authorizations.get(flow)
    val success = request.status == 302
    all { request.phase == "response",
      s' = s.with("authorizations", s.authorizations.set(flow, request.with("phase", "done")))
        .with("scoped", if (success) s.scoped.set(flow, flow) else s.scoped)
        .with("present", if (success) s.present.union(Set(flow)) else s.present)
        .with("expires", if (success) s.expires.set(flow, s.now + 2) else s.expires) }
  }
  action authorize(flow: int): bool = startAuthorize(flow).then(readAuthorize(flow))
    .then(decryptAuthorize(flow, true)).then(deliverAuthorize(flow))

  action startCallback(id: int, flow: int, inputValid: bool, denied: bool): bool = all {
    calls.contains(id), flows.contains(flow), s.callbacks.get(id).phase == "unused",
    s' = s.with("callbacks", s.callbacks.set(id, noCallback.with("phase", "binding")
      .with("flow", flow).with("inputValid", inputValid).with("denied", denied)
      .with("scoped", sendsScoped(flow))
      .with("cookie", if (sendsScoped(flow)) s.scoped.get(flow) else sentLegacy))) }
  action validateBinding(id: int): bool = {
    val request = s.callbacks.get(id)
    val valid = request.inputValid and request.cookie == request.flow
    all { request.phase == "binding",
      s' = s.with("callbacks", s.callbacks.set(id, request
        .with("phase", if (valid) "hash" else "response")
        .with("status", if (valid) 0 else 400))) }
  }
  action hashCallback(id: int): bool = all { s.callbacks.get(id).phase == "hash",
    s' = s.with("callbacks", s.callbacks.set(id, s.callbacks.get(id)
      .with("phase", "claim").with("stamp", s.now))) }
  action claim(id: int): bool = {
    val request = s.callbacks.get(id)
    val row = s.flows.get(request.flow)
    val admitted = row.phase == "pending" and row.expiry > request.stamp
    all { request.phase == "claim",
      s' = s.with("flows", if (admitted) s.flows.set(request.flow,
          row.with("phase", "processing").with("claimedBy", id)) else s.flows)
        .with("callbacks", s.callbacks.set(id, request.with("claimed", admitted)
          .with("phase", if (admitted) (if (request.denied) "denial" else "provider") else "response")
          .with("status", if (admitted) 0 else 410))) }
  }
  action deny(id: int): bool = {
    val request = s.callbacks.get(id)
    val row = s.flows.get(request.flow)
    all { request.phase == "denial",
      s' = s.with("callbacks", s.callbacks.set(id, request.with("phase", "response").with("status", 400)))
        .with("flows", if (row.phase == "processing")
          s.flows.set(request.flow, row.with("phase", "failed")) else s.flows) }
  }
  action provider(id: int, outcome: str): bool = {
    val request = s.callbacks.get(id)
    val row = s.flows.get(request.flow)
    val verified = outcome == "verified"
    all { request.phase == "provider", Set("verified", "null", "thrown").contains(outcome),
      s' = s.with("callbacks", s.callbacks.set(id, request.with("verified", verified)
          .with("phase", if (verified) "completion-clock" else "response")
          .with("status", if (verified) 0 else if (outcome == "null") 502 else 500)))
        .with("flows", if (not(verified) and row.phase == "processing")
          s.flows.set(request.flow, row.with("phase", "failed")) else s.flows) }
  }
  action completionClock(id: int): bool = all { s.callbacks.get(id).phase == "completion-clock",
    s' = s.with("callbacks", s.callbacks.set(id, s.callbacks.get(id).with("phase", "complete").with("stamp", s.now))) }
  action complete(id: int): bool = {
    val request = s.callbacks.get(id)
    val row = s.flows.get(request.flow)
    val success = row.phase == "processing" and row.expiry > request.stamp
    all { request.phase == "complete",
      s' = s.with("callbacks", s.callbacks.set(id, request.with("phase", "response")
          .with("completed", success).with("status", if (success) 200 else 410)))
        .with("flows", if (success) s.flows.set(request.flow, row.with("phase", "complete"))
          else if (row.phase == "processing") s.flows.set(request.flow, row.with("phase", "failed")) else s.flows) }
  }
  action deliverCallbackHeaders(id: int): bool = {
    val request = s.callbacks.get(id)
    val success = request.status == 200
    all { request.phase == "response",
      s' = s.with("callbacks", s.callbacks.set(id, request.with("phase", "headers")))
        .with("present", if (success) s.present.exclude(Set(request.flow)) else s.present)
        .with("scoped", if (success) s.scoped.set(request.flow, 0) else s.scoped)
        .with("headerExpiries", if (success) s.headerExpiries.union(Set(request.flow)) else s.headerExpiries) }
  }
  action deliverCallbackBody(id: int): bool = all { s.callbacks.get(id).phase == "headers",
    s' = s.with("callbacks", s.callbacks.set(id, s.callbacks.get(id).with("phase", "done"))) }
  action beginBound(id: int, flow: int): bool = startCallback(id, flow, true, false)
    .then(validateBinding(id)).then(hashCallback(id)).then(claim(id))
  action verifiedResponse(id: int): bool = provider(id, "verified").then(completionClock(id)).then(complete(id))
  action finish(id: int): bool = deliverCallbackHeaders(id).then(deliverCallbackBody(id))
  action step = {
    nondet flow = flows.oneOf()
    nondet id = calls.oneOf()
    nondet valid = Set(false, true).oneOf()
    nondet denied = Set(false, true).oneOf()
    nondet value = Set(0, 1, 2).oneOf()
    nondet outcome = Set("verified", "null", "thrown").oneOf()
    any { create(flow), tick, expireRow(flow), seedLegacy(flow), seedScoped(flow, value),
      expireScoped(flow), expireLegacy, startAuthorize(flow), readAuthorize(flow),
      decryptAuthorize(flow, valid), deliverAuthorize(flow), startCallback(id, flow, valid, denied),
      validateBinding(id), hashCallback(id), claim(id), deny(id), provider(id, outcome),
      completionClock(id), complete(id), deliverCallbackHeaders(id), deliverCallbackBody(id), s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 6, s.present.subseteq(flows), s.headerExpiries.subseteq(flows),
    not(s.handlerChangedLegacy), Set(0, 1, 2).contains(s.legacy),
    calls.forall(id => {
      val request = s.callbacks.get(id)
      all { request.claimed implies request.inputValid and request.cookie == request.flow,
        request.completed implies request.claimed and request.verified,
        request.status == 200 implies request.completed }
    }),
    flows.forall(flow => calls.filter(id => s.callbacks.get(id).flow == flow
      and s.callbacks.get(id).claimed).size() <= 1)
  }

  run oneFlowCompletesAndClearsOnlyItsScopeTest = init.then(create(1)).then(authorize(1))
    .then(beginBound(1, 1)).then(verifiedResponse(1)).then(finish(1))
    .expect(s.flows.get(1).phase == "complete" and not(s.present.contains(1)) and invariant)
  run newAuthorizationsKeepIndependentCookiesTest = init.then(create(1)).then(create(2))
    .then(authorize(1)).then(authorize(2)).expect(s.present == Set(1, 2) and s.scoped.get(1) == 1 and s.scoped.get(2) == 2)
  run outOfOrderAuthorizeHeadersDoNotOverwriteTest = init.then(create(1)).then(create(2))
    .then(startAuthorize(1)).then(readAuthorize(1)).then(decryptAuthorize(1, true))
    .then(authorize(2)).then(deliverAuthorize(1)).expect(s.present == Set(1, 2) and invariant)
  run firstCallbackStillBindsAfterSecondAuthorizationTest = init.then(create(1)).then(create(2))
    .then(authorize(1)).then(authorize(2)).then(beginBound(1, 1)).expect(s.callbacks.get(1).claimed)
  run lateFirstCompletionPreservesSecondFlowCookieTest = init.then(create(1)).then(create(2)).then(authorize(1))
    .then(beginBound(1, 1)).then(provider(1, "verified")).then(authorize(2))
    .then(completionClock(1)).then(complete(1)).then(finish(1))
    .expect(s.present == Set(2) and s.scoped.get(2) == 2 and invariant)
  run lateFirstReplyLetsSecondCallbackCompleteTest = init.then(create(1)).then(create(2)).then(authorize(1))
    .then(beginBound(1, 1)).then(verifiedResponse(1)).then(authorize(2)).then(finish(1))
    .then(beginBound(2, 2)).then(verifiedResponse(2)).then(finish(2))
    .expect(s.flows.get(1).phase == "complete" and s.flows.get(2).phase == "complete" and invariant)
  run reverseCallbackOrderKeepsBothClaimsTest = init.then(create(1)).then(create(2))
    .then(authorize(1)).then(authorize(2)).then(beginBound(1, 1)).then(beginBound(2, 2))
    .then(verifiedResponse(2)).then(finish(2)).then(verifiedResponse(1)).then(finish(1))
    .expect(s.headerExpiries == Set(1, 2) and invariant)
  run retainedLegacyCookieCanCompleteInflightFlowTest = init.then(create(1)).then(seedLegacy(1))
    .then(beginBound(1, 1)).then(verifiedResponse(1)).then(finish(1))
    .expect(s.legacy == 1 and s.headerExpiries == Set(1) and invariant)
  run legacyCompletionPreservesNewScopedAuthorizationTest = init.then(create(1)).then(create(2)).then(seedLegacy(1))
    .then(beginBound(1, 1)).then(authorize(2)).then(verifiedResponse(1)).then(finish(1))
    .expect(s.legacy == 1 and s.present == Set(2) and invariant)
  run presentWrongScopedCookieCannotDowngradeTest = init.then(create(1)).then(seedLegacy(1)).then(seedScoped(1, 2))
    .then(startCallback(1, 1, true, false)).then(validateBinding(1)).then(finish(1))
    .expect(s.callbacks.get(1).status == 400 and s.callbacks.get(1).scoped and s.flows.get(1).phase == "pending")
  run presentEmptyScopedCookieCannotDowngradeTest = init.then(create(1)).then(seedLegacy(1)).then(seedScoped(1, 0))
    .then(startCallback(1, 1, true, false)).then(validateBinding(1)).then(finish(1))
    .expect(s.callbacks.get(1).status == 400 and s.callbacks.get(1).cookie == 0 and invariant)
  run matchingScopedCookieWinsOverDifferentLegacyCookieTest = init.then(create(1)).then(seedLegacy(2)).then(authorize(1))
    .then(beginBound(1, 1)).then(verifiedResponse(1)).then(finish(1)).expect(s.legacy == 2 and invariant)
  run missingBothCookiesCannotClaimTest = init.then(create(1)).then(startCallback(1, 1, true, false))
    .then(validateBinding(1)).then(finish(1)).expect(not(s.callbacks.get(1).claimed) and s.callbacks.get(1).status == 400)
  run capturedBindingDoesNotReadLaterCookieJarTest = init.then(create(1)).then(seedLegacy(1))
    .then(startCallback(1, 1, true, false)).then(tick).then(tick).then(expireLegacy).then(validateBinding(1))
    .expect(s.callbacks.get(1).cookie == 1 and s.callbacks.get(1).phase == "hash")
  run invalidQueryLeavesBothScopesUntouchedTest = init.then(create(1)).then(create(2)).then(authorize(1)).then(authorize(2))
    .then(startCallback(1, 1, false, false)).then(validateBinding(1)).then(finish(1))
    .expect(s.present == Set(1, 2) and s.callbacks.get(1).status == 400 and invariant)
  run providerFailureDoesNotDeleteAnotherFlowTest = init.then(create(1)).then(create(2)).then(authorize(1)).then(authorize(2))
    .then(beginBound(1, 1)).then(provider(1, "null")).then(finish(1))
    .expect(s.present == Set(1, 2) and s.flows.get(1).phase == "failed" and invariant)
  run authorizationDenialFailsOnlyCapturedFlowTest = init.then(create(1)).then(create(2)).then(authorize(1)).then(authorize(2))
    .then(startCallback(1, 1, true, true)).then(validateBinding(1)).then(hashCallback(1)).then(claim(1)).then(deny(1)).then(finish(1))
    .expect(s.flows.get(1).phase == "failed" and s.flows.get(2).phase == "pending" and invariant)
  run completedLegacyFlowCannotReplayTest = init.then(create(1)).then(seedLegacy(1)).then(beginBound(1, 1))
    .then(verifiedResponse(1)).then(finish(1)).then(beginBound(2, 1)).then(finish(2))
    .expect(s.legacy == 1 and s.callbacks.get(2).status == 410 and not(s.callbacks.get(2).claimed))
  run expiredRetainedCookieCannotClaimTest = init.then(create(1)).then(tick).then(authorize(1)).then(tick)
    .then(beginBound(1, 1)).then(finish(1)).expect(s.callbacks.get(1).status == 410 and s.present.contains(1))
  run browserExpiryRemovesOnlyItsScopeTest = init.then(create(1)).then(create(2)).then(authorize(1)).then(tick).then(authorize(2))
    .then(tick).then(expireScoped(1)).expect(s.present == Set(2) and invariant)
  run legacyBrowserExpiryDoesNotRemoveScopedCookieTest = init.then(create(1)).then(seedLegacy(1)).then(tick).then(authorize(1))
    .then(tick).then(expireLegacy).expect(s.legacy == 0 and s.present == Set(1) and invariant)
  run expiryDuringProviderPreventsSuccessTest = init.then(create(1)).then(authorize(1)).then(beginBound(1, 1))
    .then(tick).then(tick).then(verifiedResponse(1)).then(finish(1))
    .expect(s.callbacks.get(1).status == 410 and not(s.callbacks.get(1).completed) and invariant)
  run capturedCompletionStampSurvivesLaterClockTickTest = init.then(create(1)).then(authorize(1)).then(beginBound(1, 1))
    .then(provider(1, "verified")).then(completionClock(1)).then(tick).then(tick).then(complete(1)).then(finish(1))
    .expect(s.callbacks.get(1).completed and invariant)
  run delayedAuthorizeMayRestoreOnlyAnInertConsumedScopeTest = init.then(create(1)).then(seedLegacy(1))
    .then(startAuthorize(1)).then(readAuthorize(1)).then(decryptAuthorize(1, true))
    .then(beginBound(1, 1)).then(verifiedResponse(1)).then(finish(1)).then(deliverAuthorize(1))
    .then(beginBound(2, 1)).then(finish(2)).expect(s.present.contains(1) and s.callbacks.get(2).status == 410)
  run unavailableAuthorizeDoesNotWriteAnyCookieTest = init.then(startAuthorize(1)).then(readAuthorize(1)).then(deliverAuthorize(1))
    .expect(s.present == Set() and s.legacy == 0 and invariant)
  run failedAuthorizeDecryptDoesNotWriteCookieTest = init.then(create(1)).then(startAuthorize(1)).then(readAuthorize(1))
    .then(decryptAuthorize(1, false)).then(deliverAuthorize(1)).expect(s.present == Set() and invariant)

  // Excluded fixed-cookie behavior. It lets one authorize response replace
  // another flow's binding, and one completed callback expire that new binding.
  action oldAuthorizeHeaders(flow: int): bool = all { s.authorizations.get(flow).phase == "response",
    s.authorizations.get(flow).status == 302,
    s' = s.with("legacy", flow).with("legacyExpiry", s.now + 2).with("handlerChangedLegacy", true)
      .with("authorizations", s.authorizations.set(flow, s.authorizations.get(flow).with("phase", "done"))) }
  action oldCallbackHeaders(id: int): bool = all { s.callbacks.get(id).phase == "response", s.callbacks.get(id).status == 200,
    s' = s.with("legacy", 0).with("handlerChangedLegacy", true)
      .with("callbacks", s.callbacks.set(id, s.callbacks.get(id).with("phase", "headers"))) }
  run oldAuthorizeReplacedOtherFlowBindingTest = init.then(create(1)).then(create(2)).then(startAuthorize(1)).then(readAuthorize(1))
    .then(decryptAuthorize(1, true)).then(oldAuthorizeHeaders(1)).then(startAuthorize(2)).then(readAuthorize(2))
    .then(decryptAuthorize(2, true)).then(oldAuthorizeHeaders(2)).then(startCallback(1, 1, true, false)).then(validateBinding(1))
    .expect(s.callbacks.get(1).status == 400 and s.legacy == 2 and not(invariant))
  run oldLateCallbackExpiredNewLegacyAuthorizationTest = init.then(create(1)).then(create(2)).then(seedLegacy(1))
    .then(beginBound(1, 1)).then(verifiedResponse(1)).then(startAuthorize(2)).then(readAuthorize(2)).then(decryptAuthorize(2, true))
    .then(oldAuthorizeHeaders(2)).then(oldCallbackHeaders(1)).then(startCallback(2, 2, true, false)).then(validateBinding(2))
    .expect(s.callbacks.get(2).status == 400 and s.legacy == 0 and not(invariant))
}
