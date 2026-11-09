// @source backend/points/handler.ts
// @source src/Points.tsx
// @source src/lib/project-api.ts
// @evidence backend/points/session-cookie-order.test.ts
// @evidence scripts/account-sessions.test.ts
// @evidence scripts/account-closure.test.ts
// Source-only, unexecuted. One browser cookie jar shared by two tabs, two
// captured ordinary requests, one fresh join, two actors and two token values.
// Only a successful join writes __Host-slop_points. Invalid reads, expired
// requests, signout, session revocation and closure retain any browser cookie.
// They still enforce D1 authority and revoke the captured session(s).
// A retained revoked/expired cookie is inert and can disappear at its existing
// browser expiry or be replaced by the one modeled join. No browser timer,
// network stack or native cookie implementation is proved here.
// Signature/identity exchange, exact expiry timestamps, request-start time,
// body validation and atomic DB execution are assumed/covered elsewhere.
// This model excludes ordering multiple successful join cookies; it also does
// not prove client detection of another tab's same-actor login. JSON delivery
// does not mutate the jar, and UI ownership is modeled in ui_account_menu.
module ui_points_cookie_order {
  type Request = { phase: str, kind: str, token: int, target: int,
    actor: int, status: int, oldExpiry: bool, tab: int }
  type State = { jar: int, live: Set[int], closed: Set[int],
    joinPhase: str, joinActor: int, joinReopen: bool,
    latestJoin: int, browserExpired: bool, requests: int -> Request,
    bodies: Set[int], oldCookieMutation: bool }
  val ids = Set(1, 2)
  val actors = Set(1, 2)
  val kinds = Set("me", "signout", "revoke", "close")
  val unused: Request = { phase: "unused", kind: "me", token: 0,
    target: 0, actor: 0, status: 0, oldExpiry: false, tab: 1 }
  var s: State

  def actorOf(token: int): int = if (token == 1) 1
    else if (token == 2) s.joinActor else 0
  def authorized(token: int): bool = token > 0 and s.live.contains(token)
    and not(s.closed.contains(actorOf(token)))
  val browserActor = if (authorized(s.jar)) actorOf(s.jar) else 0
  val retainedInert = s.jar > 0 and not(authorized(s.jar))
  def sameActorTokens(actor: int): Set[int] = s.live.filter(token => actorOf(token) == actor)

  action init = s' = { jar: 1, live: Set(1), closed: Set(), joinPhase: "unused",
    joinActor: 2, joinReopen: false, latestJoin: 0, browserExpired: false,
    requests: ids.mapBy(_ => unused), bodies: Set(), oldCookieMutation: false }
  action capture(id: int, kind: str, target: int, tab: int): bool = all {
    ids.contains(id), kinds.contains(kind), Set(0, 1, 2).contains(target),
    Set(1, 2).contains(tab), s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, unused.with("phase", "captured")
      .with("kind", kind).with("token", s.jar).with("target", target).with("tab", tab))) }
  // The request's cookie stays fixed even when a later join replaces the jar.
  // A successful member lookup is the authority at this source boundary; it
  // does not promise that the session remains present until response delivery.
  action lookup(id: int): bool = {
    val request = s.requests.get(id)
    val actor = if (authorized(request.token)) actorOf(request.token) else 0
    val isRead = request.kind == "me"
    all { request.phase == "captured",
      s' = s.with("requests", s.requests.set(id, request.with("actor", actor)
        .with("status", if (isRead or actor > 0) 200 else 401)
        .with("oldExpiry", request.token > 0 and actor == 0)
        .with("phase", if (isRead or actor == 0) "decided" else "admitted"))) }
  }
  action revoke(id: int): bool = {
    val request = s.requests.get(id)
    val ownTarget = request.target > 0 and actorOf(request.target) == request.actor
    val removed = if (request.kind == "signout") Set(request.token)
      else if (request.kind == "close") sameActorTokens(request.actor)
      else if (ownTarget) Set(request.target) else Set()
    all { request.phase == "admitted",
      s' = s.with("live", s.live.exclude(removed))
        .with("closed", if (request.kind == "close") s.closed.union(Set(request.actor)) else s.closed)
        .with("requests", s.requests.set(id, request.with("phase", "decided")
          .with("oldExpiry", request.kind == "signout" or request.kind == "close"
            or (request.kind == "revoke" and request.target == request.token)))) }
  }
  action responseFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { Set("captured", "admitted").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, request.with("phase", "decided")
        .with("status", 503).with("oldExpiry", false))) }
  }
  action deliverHeaders(id: int): bool = all { s.requests.get(id).phase == "decided",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "headers"))) }
  action deliverBody(id: int): bool = all { s.requests.get(id).phase == "headers",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "done")))
      .with("bodies", s.bodies.union(Set(id))) }
  action loseReply(id: int): bool = all { s.requests.get(id).phase == "decided",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "lost"))) }
  action expireServerToken(token: int): bool = all { ids.contains(token),
    s' = s.with("live", s.live.exclude(Set(token))) }
  // One existing browser timer firing, never a server Set-Cookie response.
  action naturalBrowserExpiry = all { s.jar > 0,
    s' = s.with("jar", 0).with("browserExpired", true) }
  action beginJoin(actor: int, reopen: bool): bool = all {
    actors.contains(actor), s.joinPhase == "unused",
    s' = s.with("joinPhase", "pending").with("joinActor", actor).with("joinReopen", reopen) }
  action commitJoin = all { s.joinPhase == "pending",
    not(s.closed.contains(s.joinActor)) or s.joinReopen,
    s' = s.with("joinPhase", "committed").with("live", s.live.union(Set(2)))
      .with("closed", s.closed.exclude(Set(s.joinActor))) }
  action refuseJoin = all { s.joinPhase == "pending", s.closed.contains(s.joinActor), not(s.joinReopen),
    s' = s.with("joinPhase", "refused") }
  action deliverJoinCookie = all { s.joinPhase == "committed",
    s' = s.with("joinPhase", "headers").with("jar", 2).with("latestJoin", 2)
      .with("browserExpired", false) }
  action deliverJoinBody = all { s.joinPhase == "headers", s' = s.with("joinPhase", "done") }
  action join(actor: int, reopen: bool): bool = beginJoin(actor, reopen)
    .then(commitJoin).then(deliverJoinCookie).then(deliverJoinBody)
  action complete(id: int): bool = lookup(id).then(revoke(id)).then(deliverHeaders(id)).then(deliverBody(id))
  action readComplete(id: int): bool = lookup(id).then(deliverHeaders(id)).then(deliverBody(id))
  action step = {
    nondet id = ids.oneOf()
    nondet kind = kinds.oneOf()
    nondet target = Set(0, 1, 2).oneOf()
    nondet actor = actors.oneOf()
    nondet tab = Set(1, 2).oneOf()
    nondet reopen = Set(false, true).oneOf()
    any { capture(id, kind, target, tab), lookup(id), revoke(id), responseFailure(id),
      deliverHeaders(id), deliverBody(id), loseReply(id), expireServerToken(id),
      naturalBrowserExpiry, beginJoin(actor, reopen), commitJoin, refuseJoin,
      deliverJoinCookie, deliverJoinBody, s' = s }
  }
  val invariant = all {
    s.live.subseteq(ids), s.closed.subseteq(actors),
    Set(0, 1, 2).contains(s.jar), s.bodies.subseteq(ids), not(s.oldCookieMutation),
    s.latestJoin == 2 and not(s.browserExpired) implies s.jar == 2,
    browserActor > 0 implies s.live.contains(s.jar) and not(s.closed.contains(browserActor)),
    s.jar == 0 implies browserActor == 0,
    ids.forall(id => s.requests.get(id).phase != "unused" implies
      Set(0, 1, 2).contains(s.requests.get(id).token))
  }

  run validCookieAuthenticatesTest = init.expect(browserActor == 1 and invariant)
  run signoutRevokesCapturedTokenWithoutCookieMutationTest = init.then(capture(1, "signout", 0, 1))
    .then(complete(1)).expect(s.jar == 1 and retainedInert and s.live == Set() and invariant)
  run expiryKeepsInertCookieTest = init.then(expireServerToken(1)).then(capture(1, "me", 0, 1))
    .then(readComplete(1)).expect(s.requests.get(1).status == 200 and s.requests.get(1).actor == 0
      and s.jar == 1 and retainedInert and invariant)
  run expiredWriteRefusesWithoutCookieMutationTest = init.then(expireServerToken(1))
    .then(capture(1, "signout", 0, 1)).then(readComplete(1))
    .expect(s.requests.get(1).status == 401 and retainedInert and invariant)
  run naturalExpiryRemovesRetainedTokenTest = init.then(capture(1, "signout", 0, 1))
    .then(complete(1)).then(naturalBrowserExpiry).expect(s.jar == 0 and browserActor == 0 and invariant)
  run joinReplacesRevokedTokenTest = init.then(capture(1, "signout", 0, 1)).then(complete(1))
    .then(join(2, false)).expect(s.jar == 2 and browserActor == 2 and s.live == Set(2) and invariant)
  run delayedSignoutHeadersPreserveNewJoinTest = init.then(capture(1, "signout", 0, 1))
    .then(lookup(1)).then(revoke(1)).then(join(2, false)).then(deliverHeaders(1)).then(deliverBody(1))
    .expect(s.jar == 2 and browserActor == 2 and invariant)
  run delayedExpiredReadHeadersPreserveNewJoinTest = init.then(expireServerToken(1))
    .then(capture(1, "me", 0, 1)).then(lookup(1)).then(join(2, false))
    .then(deliverHeaders(1)).then(deliverBody(1)).expect(s.jar == 2 and browserActor == 2 and invariant)
  run capturedOldTokenDoesNotRevokeNewTokenTest = init.then(capture(1, "signout", 0, 1))
    .then(join(2, false)).then(complete(1)).expect(s.requests.get(1).token == 1
      and s.live == Set(2) and browserActor == 2 and invariant)
  run otherTabSignoutPreservesNewJoinTest = init.then(capture(1, "signout", 0, 2))
    .then(join(2, false)).then(complete(1)).expect(s.jar == 2 and browserActor == 2 and invariant)
  run delayedInvalidWriteHeadersPreserveNewJoinTest = init.then(expireServerToken(1))
    .then(capture(1, "close", 0, 1)).then(lookup(1)).then(join(2, false))
    .then(deliverHeaders(1)).expect(s.requests.get(1).status == 401 and browserActor == 2 and invariant)
  run selfRevocationRetainsInertCookieTest = init.then(capture(1, "revoke", 1, 1))
    .then(complete(1)).expect(s.jar == 1 and retainedInert and invariant)
  run oldSelfRevocationReplyPreservesReplacementTest = init.then(capture(1, "revoke", 1, 1))
    .then(lookup(1)).then(revoke(1)).then(join(2, false)).then(deliverHeaders(1))
    .expect(browserActor == 2 and invariant)
  run cannotRevokeAnotherActorTokenTest = init.then(join(2, false))
    .then(capture(1, "revoke", 1, 2)).then(complete(1))
    .expect(s.live == Set(1, 2) and s.jar == 2 and invariant)
  run closureRetainsInertCookieTest = init.then(capture(1, "close", 0, 1))
    .then(complete(1)).expect(s.closed == Set(1) and retainedInert and s.jar == 1 and invariant)
  run oldClosureReplyPreservesAnotherActorJoinTest = init.then(capture(1, "close", 0, 1))
    .then(lookup(1)).then(revoke(1)).then(join(2, false)).then(deliverHeaders(1))
    .expect(s.jar == 2 and browserActor == 2 and s.closed == Set(1) and invariant)
  run oldClosureReplyPreservesExplicitReopenTest = init.then(capture(1, "close", 0, 1))
    .then(lookup(1)).then(revoke(1)).then(join(1, true)).then(deliverHeaders(1))
    .expect(s.jar == 2 and browserActor == 1 and s.closed == Set() and invariant)
  run closureBeforeOrdinaryJoinStillRefusesTest = init.then(capture(1, "close", 0, 1)).then(complete(1))
    .then(beginJoin(1, false)).then(refuseJoin).expect(s.joinPhase == "refused" and retainedInert)
  run lostRevocationReplyDoesNotRestoreAuthorityTest = init.then(capture(1, "signout", 0, 1))
    .then(lookup(1)).then(revoke(1)).then(loseReply(1))
    .expect(retainedInert and s.live == Set() and invariant)
  run failedRequestDoesNotRotateCookieTest = init.then(capture(1, "signout", 0, 1))
    .then(responseFailure(1)).then(deliverHeaders(1)).then(deliverBody(1))
    .expect(s.requests.get(1).status == 503 and browserActor == 1 and invariant)
  run sameActorNewTokenSurvivesOldSignoutTest = init.then(capture(1, "signout", 0, 1))
    .then(join(1, false)).then(complete(1)).expect(s.jar == 2 and browserActor == 1 and s.live == Set(2))
  run delayedBodyCannotChangeAlreadyInstalledCookieTest = init.then(capture(1, "signout", 0, 1))
    .then(lookup(1)).then(revoke(1)).then(deliverHeaders(1)).then(join(2, false)).then(deliverBody(1))
    .expect(browserActor == 2 and invariant)
  run missingCookieReadRemainsAnonymousTest = init.then(naturalBrowserExpiry)
    .then(capture(1, "me", 0, 1)).then(readComplete(1))
    .expect(s.requests.get(1).actor == 0 and s.jar == 0 and invariant)
  run revokedCookieNeverRevivesOnRepeatedReadTest = init.then(capture(1, "signout", 0, 1)).then(complete(1))
    .then(capture(2, "me", 0, 2)).then(readComplete(2))
    .expect(retainedInert and s.requests.get(2).actor == 0 and invariant)

  // Excluded old behavior: the browser applies a fixed-name expiry when the
  // headers arrive; the server cannot compare against the jar's current token.
  action oldExpiryHeaders(id: int): bool = all { s.requests.get(id).phase == "decided",
    s.requests.get(id).oldExpiry,
    s' = s.with("jar", 0).with("oldCookieMutation", true)
      .with("requests", s.requests.set(id, s.requests.get(id).with("phase", "headers"))) }
  run oldSignoutHeadersErasedNewJoinTest = init.then(capture(1, "signout", 0, 1))
    .then(lookup(1)).then(revoke(1)).then(join(2, false)).then(oldExpiryHeaders(1))
    .expect(s.live == Set(2) and s.jar == 0 and not(invariant))
  run oldExpiredReadHeadersErasedNewJoinTest = init.then(expireServerToken(1))
    .then(capture(1, "me", 0, 1)).then(lookup(1)).then(join(2, false)).then(oldExpiryHeaders(1))
    .expect(s.live == Set(2) and s.jar == 0 and not(invariant))
  run oldClosureHeadersErasedExplicitReopenTest = init.then(capture(1, "close", 0, 1))
    .then(lookup(1)).then(revoke(1)).then(join(1, true)).then(oldExpiryHeaders(1))
    .expect(s.closed == Set() and s.live == Set(2) and s.jar == 0 and not(invariant))
}
