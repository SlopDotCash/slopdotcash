// @source workers/identity/index.ts
// @source workers/identity/handler.ts
// @evidence workers/identity/failed-callback.test.ts
// One resolveGithubIdentity invocation, at most one token request and one user
// request, with finite HTTP/body/value classes. No retries. Token classes
// abstract object shape, string length 16..512 and exact bearer/Bearer types;
// user classes abstract positive safe-integer id, login syntax, and optional
// type User + node-id syntax. readBoundedJson's 64KiB/error behavior is a
// predicate. Existing callback tests inject the resolver: they do not execute
// these real token/user fetch and parser branches.
// Fixed provider URLs, configured callback/form/PKCE binding, TLS, redirects,
// GitHub truth and the two
// 10-second fetch abort signals are external transport assumptions. There is
// no wall-clock or liveness proof. Identity return is not callback persistence.
// localTokenHeld records one accessToken variable only. Finally clears that
// variable, not other token references, process memory, or server validity.
// otherReferencesPossible supplies a surviving-reference witness after an
// accepted token; false is not a claim that no other heap reference exists.
module github_identity_exchange {
  val validTokens = Set("lower-bearer", "capital-bearer")
  val tokenClasses = Set("non-object", "missing-or-non-string", "short", "long", "wrong-type", "lower-bearer", "capital-bearer")
  val userClasses = Set("non-object", "bad-id", "bad-login", "valid")
  val nodeClasses = Set("missing", "invalid", "non-user", "valid-user")
  var s: { phase: str, tokenRequests: int, userRequests: int, tokenClass: str,
    userClass: str, nodeClass: str, localTokenHeld: bool, otherReferencesPossible: bool,
    clearedAfterHeaders: bool, finallyRan: bool, settlements: int,
    result: str, reason: str, fields: Set[str] }
  action init = s' = { phase: "config", tokenRequests: 0, userRequests: 0, tokenClass: "none",
    userClass: "none", nodeClass: "none", localTokenHeld: false, otherReferencesPossible: false,
    clearedAfterHeaders: false, finallyRan: false, settlements: 0,
    result: "pending", reason: "none", fields: Set() }
  action configure(valid: bool): bool = all { s.phase == "config",
    s' = if (valid) s.with("phase", "token-fetch").with("tokenRequests", 1)
      else s.with("phase", "finally").with("result", "error").with("reason", "config") }
  action tokenResponse(ok: bool): bool = all { s.phase == "token-fetch",
    s' = if (ok) s.with("phase", "token-body")
      else s.with("phase", "finally").with("result", "null").with("reason", "token-http") }
  action tokenFetchFailure = all { s.phase == "token-fetch",
    s' = s.with("phase", "finally").with("result", "error").with("reason", "token-fetch") }
  action readBody(decoded: bool): bool = {
    val token = s.phase == "token-body"
    all { Set("token-body", "user-body").contains(s.phase),
      s' = if (decoded) s.with("phase", if (token) "token-value" else "user-value")
        else s.with("phase", "finally").with("result", "error")
          .with("reason", if (token) "token-body" else "user-body") }
  }
  action validateToken(kind: str): bool = all { s.phase == "token-value", tokenClasses.contains(kind),
    s' = if (validTokens.contains(kind)) s.with("tokenClass", kind).with("phase", "user-fetch")
        .with("localTokenHeld", true).with("otherReferencesPossible", true).with("userRequests", 1)
      else s.with("tokenClass", kind).with("phase", "finally").with("result", "null").with("reason", "token-value") }
  action userResponse(ok: bool): bool = all { s.phase == "user-fetch",
    s' = s.with("localTokenHeld", false).with("clearedAfterHeaders", true)
      .with("phase", if (ok) "user-body" else "finally")
      .with("result", if (ok) "pending" else "null").with("reason", if (ok) "none" else "user-http") }
  action userFetchFailure = all { s.phase == "user-fetch",
    s' = s.with("phase", "finally").with("result", "error").with("reason", "user-fetch") }
  action validateUser(kind: str, node: str): bool = {
    val basic = kind == "valid"
    val fieldValues = if (basic) Set("githubActorId", "githubLogin").union(
      if (node == "valid-user") Set("githubNodeId") else Set()) else Set()
    all { s.phase == "user-value", userClasses.contains(kind), nodeClasses.contains(node),
      s' = s.with("userClass", kind).with("nodeClass", node).with("fields", fieldValues)
        .with("phase", "finally").with("result", if (basic) "identity" else "null")
        .with("reason", if (basic) "none" else "user-value") }
  }
  action settle = all { s.phase == "finally",
    s' = s.with("phase", "done").with("localTokenHeld", false).with("finallyRan", true).with("settlements", 1) }
  action step = {
    nondet ok = Set(false, true).oneOf()
    nondet token = tokenClasses.oneOf()
    nondet user = userClasses.oneOf()
    nondet node = nodeClasses.oneOf()
    any { configure(ok), tokenResponse(ok), tokenFetchFailure, readBody(ok), validateToken(token),
      userResponse(ok), userFetchFailure, validateUser(user, node), settle, s' = s }
  }
  val returnedBasic = s.phase == "done" and s.result == "identity"
  // The Points callback requires githubNodeId; this flag does not execute that
  // callback, confer an audience, or turn a returned identity into a login.
  val returnedPointsEligible = returnedBasic and s.fields.contains("githubNodeId")
  val invariant = all {
    s.tokenRequests >= 0, s.tokenRequests <= 1, s.userRequests >= 0, s.userRequests <= 1,
    s.userRequests == 1 implies s.tokenRequests == 1 and validTokens.contains(s.tokenClass),
    s.localTokenHeld implies s.userRequests == 1 and not(s.clearedAfterHeaders) and not(s.finallyRan),
    s.clearedAfterHeaders implies not(s.localTokenHeld),
    s.phase == "done" implies s.finallyRan and not(s.localTokenHeld) and s.settlements == 1,
    s.settlements <= 1,
    s.fields.subseteq(Set("githubActorId", "githubLogin", "githubNodeId")),
    returnedBasic implies s.userClass == "valid" and s.fields.contains("githubActorId") and s.fields.contains("githubLogin"),
    s.fields.contains("githubNodeId") implies s.userClass == "valid" and s.nodeClass == "valid-user",
    s.result != "identity" implies s.fields == Set() }

  run configurationFailureSendsNoRequestTest = init.then(configure(false)).then(settle)
    .expect(s.result == "error" and s.reason == "config" and s.tokenRequests == 0 and s.userRequests == 0 and invariant)
  run tokenFetchFailureThrowsAndFinalizesTest = init.then(configure(true)).then(tokenFetchFailure).then(settle)
    .expect(s.result == "error" and s.reason == "token-fetch" and s.userRequests == 0 and invariant)
  run nonOkTokenResponseReturnsNullTest = init.then(configure(true)).then(tokenResponse(false)).then(settle)
    .expect(s.result == "null" and s.reason == "token-http" and s.userRequests == 0 and invariant)
  run tokenBodyFailureThrowsInsteadOfReturningNullTest = init.then(configure(true)).then(tokenResponse(true))
    .then(readBody(false)).then(settle).expect(s.result == "error" and s.reason == "token-body" and invariant)
  run nonObjectTokenBodyReturnsNullTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("non-object")).then(settle).expect(s.result == "null" and s.userRequests == 0 and invariant)
  run absentOrNonStringTokenReturnsNullTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("missing-or-non-string")).then(settle).expect(s.result == "null" and invariant)
  run tooShortTokenReturnsNullTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("short")).then(settle).expect(s.result == "null" and invariant)
  run tooLongTokenReturnsNullTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("long")).then(settle).expect(s.result == "null" and invariant)
  run unsupportedTokenTypeReturnsNullTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("wrong-type")).then(settle).expect(s.result == "null" and s.userRequests == 0 and invariant)
  run lowerBearerCanReturnBasicIdentityTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(true)).then(readBody(true))
    .then(validateUser("valid", "missing")).then(settle)
    .expect(returnedBasic and not(returnedPointsEligible) and invariant)
  run capitalBearerCanReturnPointsEligibleIdentityTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("capital-bearer")).then(userResponse(true)).then(readBody(true))
    .then(validateUser("valid", "valid-user")).then(settle).expect(returnedPointsEligible and invariant)
  run userFetchFailureKeepsLocalTokenUntilFinallyTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userFetchFailure)
    .expect(s.localTokenHeld and not(s.finallyRan)).then(settle)
    .expect(s.result == "error" and not(s.localTokenHeld) and invariant)
  run nonOkUserResponseClearsLocalTokenBeforeFinallyTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(false))
    .expect(not(s.localTokenHeld) and s.clearedAfterHeaders and not(s.finallyRan)).then(settle)
    .expect(s.result == "null" and s.reason == "user-http" and invariant)
  run userBodyFailureOccursAfterLocalClearTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(true)).then(readBody(false)).then(settle)
    .expect(s.result == "error" and s.reason == "user-body" and s.clearedAfterHeaders and invariant)
  run nonObjectUserBodyReturnsNullTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(true)).then(readBody(true))
    .then(validateUser("non-object", "missing")).then(settle).expect(s.result == "null" and invariant)
  run invalidNumericIdReturnsNullTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(true)).then(readBody(true))
    .then(validateUser("bad-id", "valid-user")).then(settle).expect(s.result == "null" and invariant)
  run invalidLoginReturnsNullTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(true)).then(readBody(true))
    .then(validateUser("bad-login", "valid-user")).then(settle).expect(s.result == "null" and invariant)
  run invalidOptionalNodeStillReturnsBasicIdentityTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(true)).then(readBody(true))
    .then(validateUser("valid", "invalid")).then(settle).expect(returnedBasic and not(returnedPointsEligible) and invariant)
  run nonUserTypeOmitsEvenAValidNodeIdTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(true)).then(readBody(true))
    .then(validateUser("valid", "non-user")).then(settle).expect(returnedBasic and not(returnedPointsEligible) and invariant)
  run returnedIdentityExposesOnlyProjectedFieldsTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(true)).then(readBody(true))
    .then(validateUser("valid", "valid-user")).then(settle)
    .expect(s.fields == Set("githubActorId", "githubLogin", "githubNodeId") and invariant)
  run localClearDoesNotClaimTokenErasureTest = init.then(configure(true)).then(tokenResponse(true)).then(readBody(true))
    .then(validateToken("lower-bearer")).then(userResponse(false)).then(settle)
    .expect(not(s.localTokenHeld) and s.otherReferencesPossible and invariant)
  run completedInvocationCannotRetryTest = init.then(configure(true)).then(tokenFetchFailure).then(settle)
    .expect(s.tokenRequests == 1 and invariant).then(configure(true).fail())
}
