// @source backend/trace/handler.ts
// @source backend/trace/auth.ts
// @source src/lib/deployment.ts
// @source functions/api/v1/[[path]].ts
// @evidence scripts/trace-upload-attachable.test.ts
// @evidence backend/security/payments.integration.ts
// One request and one actor, with finite route, authority, protocol, Origin,
// Authorization-presence, preflight-header, session and failure classes. Route
// classes stand for the exact method/path-parts predicates in the dispatcher;
// arbitrary URL parsing and every concrete route spelling are not enumerated.
// api-site represents staging, where API and browser origins are identical.
// localhost represents the source hostname exception, not arbitrary loopback.
// The browser wrapper sees the requested preflight method; an OPTIONS request
// reaching the internal dispatcher has no matching application route.
// Bearer verification is an awaited contract: accepted roles are its nonempty
// supported-role result after filtering. trace_bearer_tokens models token shape,
// signature, captured clock, TTL and allowlist details separately. The session
// member and allowlist booleans are observations at their source call/check,
// not a continuously live global authorization fact. No session role is saved
// or bearer issued by the request-local recovery actor construction.
// Delegated means dispatch and the authenticated route's immediate role guard
// passed; those guards execute inside the selected function in source. For a
// public/admission/capability route it means direct dispatch only. Further
// identity/capability/ownership/ban checks, writes, replies and external effects
// are excluded. Public/admission/capability routes bypass this bearer gate;
// that does not mean their own checks passed. Pending phases and self-loops
// represent possible stalls; there is no liveness or response-delivery proof.
// The trace test exercises real signing/handler routing and removed-read 404s
// with migrated SQLite. The --binding-recovery integration path exercises real
// Pages session/allowlist/Origin refusals and accepted recovery dispatch. These
// existing definitions do not establish exhaustive dispatcher conformance and
// were not executed for this source-only model.
module trace_route_authorization {
  val routes = Set("empty", "intake", "public-wallet", "upload", "identity",
    "wallet-current", "wallet-write", "run-write", "fallback", "recovery", "unknown")
  val origins = Set("api", "site", "api-site", "localhost", "foreign")
  val originHeaders = Set("absent", "same", "other-allowed", "untrusted")
  val authHeaders = Set("absent", "empty", "present")
  val supportedRoles = Set("contributor", "project_owner", "operator")
  val roleChoices = Set(Set(), Set("contributor"), Set("project_owner"), Set("operator"),
    Set("contributor", "project_owner"), Set("contributor", "operator"),
    Set("project_owner", "operator"), Set("contributor", "project_owner", "operator"))
  val corsRoutes = Set("public-wallet", "identity", "wallet-current", "wallet-write")
  val authenticatedRoutes = Set("wallet-current", "wallet-write", "run-write", "fallback", "recovery")
  var s: { phase: str, route: str, origin: str, secure: bool, preflight: bool,
    originHeader: str, authHeader: str, requestedHeadersAllowed: bool,
    sessionCandidate: bool, sessionObserved: bool, allowlistObserved: bool,
    roles: Set[str], credential: str, bearerCalls: int, sessionCalls: int,
    lookupDone: bool, delegated: bool, result: str, reason: str }
  action init = s' = { phase: "new", route: "unknown", origin: "foreign", secure: true,
    preflight: false, originHeader: "absent", authHeader: "absent", requestedHeadersAllowed: false,
    sessionCandidate: false, sessionObserved: false, allowlistObserved: false,
    roles: Set(), credential: "none", bearerCalls: 0, sessionCalls: 0,
    lookupDone: false, delegated: false, result: "none", reason: "none" }
  val apiOrigin = Set("api", "api-site").contains(s.origin)
  val browserOrigin = Set("site", "api-site").contains(s.origin)
  val local = s.origin == "localhost"
  val acceptedOriginHeader = s.originHeader == "other-allowed"
    or (s.originHeader == "same" and browserOrigin)
  val recoveryCandidate = not(s.preflight) and s.route == "recovery"
    and s.authHeader == "absent" and (browserOrigin or local)
  def ended(status, reason) = s.with("phase", "done").with("result", status).with("reason", reason)
  def invoked(credential) = s.with("phase", "delegated").with("result", "delegated")
    .with("delegated", true).with("credential", credential)

  action begin(route: str, origin: str, secure: bool, preflight: bool,
    originHeader: str, authHeader: str, headersAllowed: bool): bool = all {
    s.phase == "new", routes.contains(route), origins.contains(origin),
    originHeaders.contains(originHeader), authHeaders.contains(authHeader),
    origin == "api-site" implies originHeader != "other-allowed",
    s' = s.with("phase", "browser-wrapper").with("route", route).with("origin", origin)
      .with("secure", secure).with("preflight", preflight).with("originHeader", originHeader)
      .with("authHeader", authHeader).with("requestedHeadersAllowed", headersAllowed) }
  action browserWrapper = {
    val eligible = corsRoutes.contains(s.route) and (apiOrigin or local) and (s.secure or local)
    val rejectOrigin = s.originHeader != "absent" and not(acceptedOriginHeader)
    all { s.phase == "browser-wrapper",
      s' = if (not(eligible)) s.with("phase", "authority")
        else if (rejectOrigin or (s.preflight and s.originHeader == "absent")) ended("403", "origin_not_allowed")
        else if (s.preflight and not(s.requestedHeadersAllowed)) ended("403", "headers_not_allowed")
        else if (s.preflight) ended("204", "preflight")
        else s.with("phase", "authority") }
  }
  action authority = {
    val effective = if (s.preflight) "unknown" else s.route
    all { s.phase == "authority",
      s' = if (s.route == "empty") ended("404", "not_found")
        else if (not(s.secure or local)) ended("400", "https_required")
        else if (not(apiOrigin or local or recoveryCandidate)) ended("404", "not_found")
        else if (Set("intake", "public-wallet").contains(effective)) invoked("public")
        else if (effective == "upload") invoked("capability")
        else if (effective == "identity") invoked("identity")
        else s.with("phase", "lookup").with("sessionCandidate", recoveryCandidate) }
  }
  action lookup = {
    val effective = if (s.preflight) "unknown" else s.route
    all { s.phase == "lookup",
      s' = (if (not(authenticatedRoutes.contains(effective))) ended("404", "not_found")
        else if (effective == "recovery" and not(s.sessionCandidate)) ended("403", "session_required")
        else s.with("phase", if (s.sessionCandidate) "same-origin" else "bearer"))
        .with("lookupDone", true) }
  }
  action requireSameOrigin = all { s.phase == "same-origin",
    s' = if (s.originHeader == "same") s.with("phase", "session")
      else ended("403", "origin_not_allowed") }
  action readSession(outcome: str): bool = all { s.phase == "session", Set("found", "absent", "error").contains(outcome),
    s' = (if (outcome == "error") ended("500", "session_error")
      else if (outcome == "absent") ended("401", "unauthorized")
      else s.with("phase", "allowlist").with("sessionObserved", true))
      .with("sessionCalls", 1) }
  action observeAllowlist(listed: bool): bool = all { s.phase == "allowlist",
    s' = if (listed) s.with("phase", "session-actor").with("allowlistObserved", true)
      else ended("403", "operator_required") }
  action sessionActor(randomIdSucceeded: bool): bool = all { s.phase == "session-actor",
    s' = if (randomIdSucceeded) s.with("phase", "invoke").with("roles", Set("operator")).with("credential", "session")
      else ended("500", "actor_error") }
  action verifyBearer(outcome: str, roles: Set[str]): bool = all {
    s.phase == "bearer", Set("accepted", "refused", "error").contains(outcome), roles.subseteq(supportedRoles),
    outcome == "accepted" implies s.authHeader == "present" and roles.size() > 0,
    s' = (if (outcome == "error") ended("500", "bearer_error")
      else if (outcome == "refused") ended("401", "unauthorized")
      else s.with("phase", "invoke").with("roles", roles).with("credential", "bearer"))
      .with("bearerCalls", 1) }
  action dispatch = all { s.phase == "invoke",
    s' = if (Set("fallback", "recovery").contains(s.route) and not(s.roles.contains("operator")))
      ended("403", "operator_required") else invoked(s.credential) }
  action step = {
    nondet route = routes.oneOf()
    nondet origin = origins.oneOf()
    nondet header = originHeaders.oneOf()
    nondet auth = authHeaders.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet third = Set(false, true).oneOf()
    nondet session = Set("found", "absent", "error").oneOf()
    nondet verified = Set("accepted", "refused", "error").oneOf()
    nondet roles = roleChoices.oneOf()
    any { begin(route, origin, yes, other, header, auth, third), browserWrapper, authority, lookup,
      requireSameOrigin, readSession(session), observeAllowlist(yes), sessionActor(yes), verifyBearer(verified, roles),
      dispatch, s' = s }
  }
  val pending = not(Set("new", "done", "delegated").contains(s.phase))
  val invariant = all {
    s.bearerCalls <= 1, s.sessionCalls <= 1, s.bearerCalls + s.sessionCalls <= 1,
    s.roles.subseteq(supportedRoles),
    s.bearerCalls == 1 implies s.lookupDone and not(s.sessionCandidate),
    s.sessionCalls == 1 implies s.lookupDone and s.sessionCandidate and s.originHeader == "same",
    s.delegated implies s.result == "delegated",
    s.delegated and authenticatedRoutes.contains(s.route) implies s.lookupDone and s.roles.size() > 0,
    s.delegated and s.route == "fallback" implies s.roles.contains("operator") and s.credential == "bearer",
    s.delegated and s.route == "recovery" implies s.credential == "session" and s.roles == Set("operator")
      and s.authHeader == "absent" and s.originHeader == "same" and (browserOrigin or local)
      and s.sessionObserved and s.allowlistObserved and s.bearerCalls == 0,
    s.credential == "session" implies s.sessionObserved and s.allowlistObserved and s.roles == Set("operator"),
    s.result == "204" implies s.preflight and s.bearerCalls == 0 and s.sessionCalls == 0 and not(s.delegated) }

  action routed(route: str, origin: str, secure: bool, originHeader: str, auth: str): bool =
    begin(route, origin, secure, false, originHeader, auth, true).then(browserWrapper).then(authority)
  action recovery(origin: str, originHeader: str, auth: str): bool =
    routed("recovery", origin, true, originHeader, auth).then(lookup)
  action sessionReady = recovery("site", "same", "absent").then(requireSameOrigin)
    .then(readSession("found")).then(observeAllowlist(true)).then(sessionActor(true))
  action authenticated(route: str, roles: Set[str]): bool = routed(route, "api", true, "absent", "present")
    .then(lookup).then(verifyBearer("accepted", roles)).then(dispatch)

  run publicIntakeBypassesBearerVerificationTest = init.then(routed("intake", "api", true, "untrusted", "present"))
    .expect(s.delegated and s.credential == "public" and s.bearerCalls == 0 and invariant)
  run publicWalletStillUsesBrowserOriginRefusalTest = init
    .then(begin("public-wallet", "api", true, false, "untrusted", "absent", true)).then(browserWrapper)
    .expect(s.result == "403" and not(s.delegated) and invariant)
  run publicWalletWrongAuthorityReturns404Test = init.then(routed("public-wallet", "foreign", true, "absent", "present"))
    .expect(s.result == "404" and s.bearerCalls == 0 and invariant)
  run uploadDelegatesCapabilityBeforeBearerTest = init.then(routed("upload", "api", true, "untrusted", "empty"))
    .expect(s.delegated and s.credential == "capability" and s.bearerCalls == 0 and invariant)
  run identityExchangeDoesNotVerifyBearerTest = init.then(routed("identity", "api", true, "absent", "empty"))
    .expect(s.delegated and s.credential == "identity" and s.bearerCalls == 0 and invariant)
  run emptyPathReturns404BeforeHttpsCheckTest = init.then(routed("empty", "foreign", false, "absent", "present"))
    .expect(s.result == "404" and s.reason == "not_found" and invariant)
  run insecureNonlocalRouteReturns400BeforeLookupTest = init.then(routed("unknown", "api", false, "absent", "present"))
    .expect(s.result == "400" and not(s.lookupDone) and s.bearerCalls == 0 and invariant)
  run removedRouteReturns404BeforeBearerTest = init.then(routed("unknown", "api", true, "absent", "present")).then(lookup)
    .expect(s.result == "404" and s.lookupDone and s.bearerCalls == 0 and invariant)
  run siteOriginCannotUseOrdinaryBearerRouteTest = init.then(routed("run-write", "site", true, "absent", "present"))
    .expect(s.result == "404" and s.bearerCalls == 0 and invariant)
  run missingBearerOnKnownRouteReturns401Test = init.then(routed("run-write", "api", true, "absent", "absent"))
    .then(lookup).then(verifyBearer("refused", Set()))
    .expect(s.result == "401" and s.bearerCalls == 1 and invariant)
  run secretOrCryptoFailureIsNotOrdinaryUnauthorizedTest = init.then(routed("run-write", "api", true, "absent", "absent"))
    .then(lookup).then(verifyBearer("error", Set()))
    .expect(s.result == "500" and s.bearerCalls == 1 and not(s.delegated) and invariant)
  run acceptedBearerCanStillWaitBeforeDispatchTest = init.then(routed("run-write", "api", true, "absent", "present"))
    .then(lookup).then(verifyBearer("accepted", Set("contributor")))
    .expect(pending and s.phase == "invoke" and not(s.delegated) and invariant)
  run contributorBearerAdmitsRunHandlerTest = init.then(authenticated("run-write", Set("contributor")))
    .expect(s.delegated and s.credential == "bearer" and invariant)
  run projectOwnerBearerAdmitsWalletReadTest = init.then(authenticated("wallet-current", Set("project_owner")))
    .expect(s.delegated and invariant)
  run contributorCannotUseOperatorFallbackTest = init.then(authenticated("fallback", Set("contributor")))
    .expect(s.result == "403" and not(s.delegated) and invariant)
  run filteredOperatorBearerAdmitsFallbackTest = init.then(authenticated("fallback", Set("operator")))
    .expect(s.delegated and s.credential == "bearer" and invariant)
  run recoveryRefusesEvenAcceptedOperatorBearerAtApiTest = init.then(recovery("api", "absent", "present"))
    .expect(s.result == "403" and s.bearerCalls == 0 and s.sessionCalls == 0 and invariant)
  run emptyAuthorizationHeaderPreventsSiteSessionPathTest = init.then(routed("recovery", "site", true, "same", "empty"))
    .expect(s.result == "404" and s.sessionCalls == 0 and invariant)
  run emptyAuthorizationHeaderPreventsLocalSessionPathTest = init.then(recovery("localhost", "same", "empty"))
    .expect(s.result == "403" and s.sessionCalls == 0 and invariant)
  run recoveryNeedsExplicitSameOriginHeaderTest = init.then(recovery("site", "absent", "absent")).then(requireSameOrigin)
    .expect(s.result == "403" and s.sessionCalls == 0 and invariant)
  run anotherAllowedBrowserOriginCannotRecoverTest = init.then(recovery("site", "other-allowed", "absent")).then(requireSameOrigin)
    .expect(s.result == "403" and s.sessionCalls == 0 and invariant)
  run missingSiteSessionReturns401Test = init.then(recovery("site", "same", "absent")).then(requireSameOrigin).then(readSession("absent"))
    .expect(s.result == "401" and s.sessionCalls == 1 and invariant)
  run sessionReadFailureReturns500Test = init.then(recovery("site", "same", "absent")).then(requireSameOrigin).then(readSession("error"))
    .expect(s.result == "500" and s.sessionCalls == 1 and invariant)
  run sessionActorStillNeedsAllowlistObservationTest = init.then(recovery("site", "same", "absent")).then(requireSameOrigin)
    .then(readSession("found")).then(observeAllowlist(false))
    .expect(s.result == "403" and s.sessionObserved and not(s.allowlistObserved) and not(s.delegated) and invariant)
  run randomIdFailureDoesNotDispatchRecoveryTest = init.then(recovery("site", "same", "absent")).then(requireSameOrigin)
    .then(readSession("found")).then(observeAllowlist(true)).then(sessionActor(false))
    .expect(s.result == "500" and not(s.delegated) and s.bearerCalls == 0 and invariant)
  run sessionRecoveryCreatesOnlyRequestLocalOperatorRoleTest = init.then(sessionReady).then(dispatch)
    .expect(s.delegated and s.roles == Set("operator") and s.credential == "session" and s.bearerCalls == 0 and invariant)
  run stagingApiAndSiteCanUseSessionRecoveryTest = init.then(recovery("api-site", "same", "absent")).then(requireSameOrigin)
    .then(readSession("found")).then(observeAllowlist(true)).then(sessionActor(true)).then(dispatch)
    .expect(s.delegated and s.credential == "session" and invariant)
  run localSessionRecoveryUsesSameOriginCheckTest = init.then(recovery("localhost", "same", "absent")).then(requireSameOrigin)
    .then(readSession("found")).then(observeAllowlist(true)).then(sessionActor(true)).then(dispatch)
    .expect(s.delegated and s.credential == "session" and invariant)
  run validPreflightReturns204WithoutAnyAuthenticationTest = init
    .then(begin("wallet-write", "api", true, true, "other-allowed", "present", true)).then(browserWrapper)
    .expect(s.result == "204" and s.bearerCalls == 0 and not(s.delegated) and invariant)
  run preflightRejectsUnlistedRequestHeadersTest = init
    .then(begin("wallet-write", "api", true, true, "other-allowed", "absent", false)).then(browserWrapper)
    .expect(s.result == "403" and s.reason == "headers_not_allowed" and invariant)
  run preflightRequiresOriginTest = init
    .then(begin("wallet-write", "api", true, true, "absent", "absent", true)).then(browserWrapper)
    .expect(s.result == "403" and s.reason == "origin_not_allowed" and invariant)
  run nonBrowserRouteOptionsReachesNoApplicationHandlerTest = init
    .then(begin("run-write", "api", true, true, "other-allowed", "present", true))
    .then(browserWrapper).then(authority).then(lookup).expect(s.result == "404" and s.bearerCalls == 0 and invariant)
  run localhostDoesNotJoinProductionCorsAllowlistTest = init
    .then(begin("wallet-write", "localhost", false, false, "same", "present", true)).then(browserWrapper)
    .expect(s.result == "403" and s.bearerCalls == 0 and invariant)
  run localhostHttpBearerRouteRemainsAvailableTest = init.then(routed("run-write", "localhost", false, "absent", "present"))
    .then(lookup).then(verifyBearer("accepted", Set("contributor"))).then(dispatch)
    .expect(s.delegated and s.credential == "bearer" and invariant)
}
