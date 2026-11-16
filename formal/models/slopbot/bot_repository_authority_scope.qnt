// @source workers/slopbot/repository-access.ts
// @source backend/projects/repository-access.ts
// @source src/lib/project-contracts.ts
// @evidence scripts/project-renamed-repository-authority.test.ts
// One internal authority request and one retry; two immutable repositories in
// the SAME installation, two possible holders of the queried login, four base
// permission levels and optional full repository facts. The requested numeric
// repository ID is positive/safe or an invalid-number class; lexical URL input
// validation is separate. No token bytes, credential material or HTTP calls.
// GitHub's documented repository_ids and permissions restrictions are assumed:
// https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
// https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user
// The authority token contains only expected repository1 and metadata:read.
// A path that moves to repository2 cannot use repository1's token to read its
// permission. 404 means none; other failed permission reads are unavailable.
// Current facts and permission bodies remain independently validated. This
// model does not prove GitHub's implementation, JWT cryptography, transport
// timeouts, or continuous ownership after the observed permission.
// Public-content reads use a separate public-only credential. The former
// handleRepositoryRead installation-token relay has been retired.
// legacyToken models the former installation-wide token as a negative control
// outside step. All named scenarios are authored and manually reviewed only.
module bot_repository_authority_scope {
  val repos = Set(1, 2)
  val levels = Set("none", "read", "write", "admin")
  var s: { phase: str, attempt: int, path: int, loginActor: int,
    permissions: int -> str, includeFacts: bool, factsValid: bool,
    tokenRequested: bool, token: bool, scope: Set[int], metadataOnly: bool,
    factsRepo: int, permissionRepo: int, permissionActor: int,
    observed: str, status: int, answer: str }
  action init = s' = { phase: "idle", attempt: 0, path: 1, loginActor: 1,
    permissions: Map(1 -> "write", 2 -> "admin"), includeFacts: true, factsValid: true,
    tokenRequested: false, token: false, scope: Set(), metadataOnly: false,
    factsRepo: 0, permissionRepo: 0, permissionActor: 0, observed: "none", status: 0, answer: "none" }
  action begin(shape: bool, safeId: bool, includeFacts: bool): bool = all {
    Set("idle", "done").contains(s.phase), s.attempt < 2,
    s' = s.with("attempt", s.attempt + 1).with("includeFacts", includeFacts)
      .with("tokenRequested", false).with("token", false).with("scope", Set()).with("metadataOnly", false)
      .with("factsRepo", 0).with("permissionRepo", 0).with("permissionActor", 0).with("observed", "none")
      .with("phase", if (shape and safeId) "installation" else "done")
      .with("status", if (not(shape)) 400 else if (not(safeId)) 503 else 0).with("answer", "none") }
  action movePath(repo: int): bool = all { Set(0, 1, 2).contains(repo), s' = s.with("path", repo) }
  action reuseLogin = s' = s.with("loginActor", 2)
  action permissionChanges(repo: int, level: str): bool = all { repos.contains(repo), levels.contains(level),
    s' = s.with("permissions", s.permissions.set(repo, level)) }
  action installation(outcome: str): bool = all { s.phase == "installation",
    Set("installed", "missing", "suspended", "invalid", "error").contains(outcome),
    s' = if (outcome == "installed") s.with("phase", "token")
      else s.with("phase", "done").with("status", if (Set("missing", "suspended").contains(outcome)) 200 else 503)
        .with("answer", if (Set("missing", "suspended").contains(outcome)) outcome else "unavailable") }
  action issue(ok: bool): bool = all { s.phase == "token",
    s' = s.with("tokenRequested", true).with("token", ok).with("scope", if (ok) Set(1) else Set())
      .with("metadataOnly", true).with("phase", if (ok) "facts" else "done")
      .with("status", if (ok) 0 else 503).with("answer", if (ok) "none" else "unavailable") }
  // Old omitted scope/permissions: GitHub gives the installation-wide grant.
  action legacyToken = all { s.phase == "token", s' = s.with("tokenRequested", true).with("token", true)
    .with("scope", repos).with("metadataOnly", false).with("phase", "facts") }
  action facts(identityMatches: bool, fullShape: bool): bool = {
    val readable = s.token and s.scope.contains(s.path)
    val accepted = readable and identityMatches and s.path == 1
    all { s.phase == "facts", s' = s.with("factsRepo", if (accepted) 1 else 0).with("factsValid", fullShape)
      .with("phase", if (accepted) "permission" else "done").with("status", if (accepted) 0 else 503)
      .with("answer", if (accepted) "none" else "unavailable") }
  }
  action permission(outcome: str): bool = {
    val allowed = s.token and s.scope.contains(s.path)
    val missing = outcome == "missing" or not(allowed)
    val unavailable = outcome == "error" or outcome == "invalid" or (not(missing) and s.loginActor != 1)
    val observed = if (missing) "none" else if (repos.contains(s.path)) s.permissions.get(s.path) else "none"
    all { s.phase == "permission", Set("ok", "missing", "invalid", "error").contains(outcome),
      s' = s.with("permissionRepo", s.path).with("permissionActor", if (missing) 0 else s.loginActor)
        .with("observed", observed).with("phase", if (unavailable) "done" else "response")
        .with("status", if (unavailable) 503 else 0).with("answer", if (unavailable) "unavailable" else "none") }
  }
  action respond = all { s.phase == "response", s' = s.with("phase", "done")
    .with("status", if (s.includeFacts and not(s.factsValid)) 503 else 200)
    .with("answer", if (s.includeFacts and not(s.factsValid)) "unavailable" else s.observed) }
  action step = {
    nondet repo = Set(0, 1, 2).oneOf()
    nondet level = levels.oneOf()
    nondet installed = Set("installed", "missing", "suspended", "invalid", "error").oneOf()
    nondet outcome = Set("ok", "missing", "invalid", "error").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { begin(yes, other, yes), movePath(repo), reuseLogin, permissionChanges(repo, level),
      installation(installed), issue(yes), facts(yes, other), permission(outcome), respond, s' = s }
  }
  val positiveAuthority = Set("write", "admin").contains(s.answer)
  val scopedAuthority = not(positiveAuthority) or all {
    s.status == 200, s.token, s.scope == Set(1), s.metadataOnly,
    s.factsRepo == 1, s.permissionRepo == 1, s.permissionActor == 1 }
  val invariant = all { s.attempt <= 2, scopedAuthority,
    s.token implies s.tokenRequested,
    s.status == 400 implies not(s.tokenRequested),
    Set("missing", "suspended").contains(s.answer) implies not(s.tokenRequested),
    positiveAuthority implies not(s.includeFacts) or s.factsValid }
  action start = begin(true, true, true).then(installation("installed"))
  action identified = start.then(issue(true)).then(facts(true, true))

  run matchingRepositoryRetainsPermissionTest = init.then(identified).then(permission("ok")).then(respond)
    .expect(s.answer == "write" and invariant)
  run tokenHasOnlyExpectedRepositoryAndMetadataTest = init.then(start).then(issue(true))
    .expect(s.scope == Set(1) and s.metadataOnly and invariant)
  run pathReuseBeforeFactsCannotPassIdentityTest = init.then(start).then(movePath(2)).then(issue(true)).then(facts(true, true))
    .expect(s.status == 503 and s.factsRepo == 0 and invariant)
  run pathReuseBetweenReadsCannotLendPermissionTest = init.then(identified).then(movePath(2)).then(permission("ok")).then(respond)
    .expect(s.status == 200 and s.answer == "none" and s.permissionRepo == 2 and invariant)
  run missingInstallationReturnsMissingTest = init.then(begin(true, true, true)).then(installation("missing"))
    .expect(s.answer == "missing" and invariant)
  run suspendedInstallationRequestsNoTokenTest = init.then(begin(true, true, true)).then(installation("suspended"))
    .expect(s.answer == "suspended" and not(s.tokenRequested) and invariant)
  run invalidInstallationIsUnavailableTest = init.then(begin(true, true, true)).then(installation("invalid"))
    .expect(s.status == 503 and invariant)
  run failedTokenDoesNotReadRepositoryTest = init.then(start).then(issue(false))
    .expect(s.status == 503 and s.factsRepo == 0 and invariant)
  run unsafeNumericIdRequestsNoTokenTest = init.then(begin(true, false, true))
    .expect(s.status == 503 and not(s.tokenRequested) and invariant)
  run malformedRouteRequestsNoTokenTest = init.then(begin(false, true, true))
    .expect(s.status == 400 and not(s.tokenRequested) and invariant)
  run mismatchedRepositoryIdStillRefusesTest = init.then(start).then(issue(true)).then(facts(false, true))
    .expect(s.status == 503 and invariant)
  run failedPermissionReadDoesNotClaimNoneTest = init.then(identified).then(permission("error"))
    .expect(s.status == 503 and s.answer == "unavailable" and invariant)
  run missingCollaboratorIsNoPermissionTest = init.then(identified).then(permission("missing")).then(respond)
    .expect(s.answer == "none" and s.status == 200 and invariant)
  run reusedLoginStillFailsActorIdentityTest = init.then(identified).then(reuseLogin).then(permission("ok"))
    .expect(s.status == 503 and invariant)
  run invalidPermissionLevelIsUnavailableTest = init.then(identified).then(permission("invalid"))
    .expect(s.status == 503 and invariant)
  run requestedFullFactsRemainValidatedTest = init.then(start).then(issue(true)).then(facts(true, false)).then(permission("ok")).then(respond)
    .expect(s.status == 503 and invariant)
  run omittedFullFactsStillChecksRepositoryIdTest = init.then(begin(true, true, false)).then(installation("installed"))
    .then(issue(true)).then(facts(true, false)).then(permission("ok")).then(respond).expect(s.answer == "write" and invariant)
  run laterRevocationDoesNotRewriteObservedPermissionTest = init.then(identified).then(permission("ok"))
    .then(permissionChanges(1, "none")).then(movePath(2)).then(respond)
    .expect(s.answer == "write" and s.permissions.get(1) == "none" and invariant)
  run restoredPathAllowsIndependentRetryTest = init.then(identified).then(movePath(2)).then(permission("ok")).then(respond)
    .then(movePath(1)).then(identified).then(permission("ok")).then(respond).expect(s.attempt == 2 and s.answer == "write" and invariant)
  run oldInstallationWideTokenLendsReplacementPermissionNegativeControlTest = init.then(start).then(legacyToken)
    .then(facts(true, true)).then(movePath(2)).then(permission("ok")).then(respond)
    .expect(s.answer == "admin" and not(scopedAuthority))
}
