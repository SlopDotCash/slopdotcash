// @source backend/points/dependencies.ts
// @source backend/points/handler.ts
// @source backend/pages.ts
// @source backend/projects/handler.ts
// @source functions/api/v1/[[path]].ts
// @source migrations/0008_points.sql
// @source wrangler.toml
// @evidence backend/points/publication.test.ts
// @evidence scripts/account-sessions.test.ts
// @evidence scripts/account-closure.test.ts
// One presented browser token for one account. The authority inputs describe
// the immutable GitHub ID's match to the configured owner and current admin
// roster. The assertion, token and atomic join checks are abstracted; OAuth
// exchange and concurrent sessions are covered separately. Age is measured
// from issuance at exact second boundaries. Cookie delivery and clock skew
// are abstracted, and a presented cookie must still pass the D1 expiry check.
module api_points_session_lifetime {
  val memberSeconds = 3600
  val ownerSeconds = 604800
  val ages = Set(memberSeconds - 1, memberSeconds, ownerSeconds - 1, ownerSeconds)

  var s: { matchesOwnerId: bool, admin: bool, closed: bool, issuedForOwner: bool,
    age: int, rowSeconds: int, cookieSeconds: int }
  action init = s' = { matchesOwnerId: false, admin: false, closed: false,
    issuedForOwner: false, age: 0, rowSeconds: 0, cookieSeconds: 0 }
  action authority(matchesOwnerId: bool, admin: bool): bool =
    s' = s.with("matchesOwnerId", matchesOwnerId).with("admin", admin)
  action join(verified: bool, reopen: bool): bool = {
    val forOwner = s.matchesOwnerId and s.admin
    val seconds = if (forOwner) ownerSeconds else memberSeconds
    s' = if (verified and (not(s.closed) or reopen))
      s.with("closed", false).with("issuedForOwner", forOwner).with("age", 0)
        .with("rowSeconds", seconds).with("cookieSeconds", seconds)
    else s
  }
  action advance(age: int): bool = all {
    ages.contains(age), age > s.age, s' = s.with("age", age)
  }
  val authenticated = s.age < s.rowSeconds
  val browserSendsCookie = s.age < s.cookieSeconds
  val permitsAdminAction = authenticated and s.admin
  action revokeFromOtherSession = s' = s.with("rowSeconds", 0)
  action signout = all {
    authenticated, s' = s.with("rowSeconds", 0).with("cookieSeconds", 0)
  }
  action close = all {
    authenticated, s' = s.with("closed", true).with("rowSeconds", 0).with("cookieSeconds", 0)
  }
  action step = any {
    { nondet ownerIdMatches = Set(false, true).oneOf()
      nondet admin = Set(false, true).oneOf()
      authority(ownerIdMatches, admin) },
    { nondet verified = Set(false, true).oneOf() nondet reopen = Set(false, true).oneOf()
      join(verified, reopen) },
    { nondet age = ages.oneOf() advance(age) },
    revokeFromOtherSession, signout, close, s' = s
  }
  val invariant = all {
    s.closed implies (s.rowSeconds == 0 and s.cookieSeconds == 0),
    s.rowSeconds != 0 implies s.rowSeconds == s.cookieSeconds,
    s.cookieSeconds != 0 implies
      s.cookieSeconds == (if (s.issuedForOwner) ownerSeconds else memberSeconds)
  }

  run owner = init.then(authority(true, true)).then(join(true, false))
  run ownerExpiresAtSevenDaysTest = owner.then(advance(ownerSeconds - 1))
    .expect(authenticated and browserSendsCookie and permitsAdminAction)
    .then(advance(ownerSeconds)).expect(not(authenticated) and not(browserSendsCookie))
  run otherAdminExpiresAtOneHourTest = init.then(authority(false, true)).then(join(true, false))
    .then(advance(memberSeconds - 1)).expect(authenticated and browserSendsCookie)
    .then(advance(memberSeconds)).expect(not(authenticated) and not(browserSendsCookie))
  run configuredNonAdminGetsOneHourTest = init.then(authority(true, false)).then(join(true, false))
    .expect(s.rowSeconds == memberSeconds and s.cookieSeconds == memberSeconds)
  run eligibilityOnlyExtendsFreshSignInTest = init.then(join(true, false)).then(authority(true, true))
    .then(advance(memberSeconds)).expect(not(authenticated))
    .then(join(true, false)).expect(authenticated and s.rowSeconds == ownerSeconds)
  run currentAdminRoleStillRequiredTest = owner.then(advance(memberSeconds)).then(authority(true, false))
    .expect(authenticated and browserSendsCookie and not(permitsAdminAction))
  run unverifiedJoinCannotIssueSessionTest = init.then(authority(true, true)).then(join(false, false))
    .expect(not(authenticated) and not(browserSendsCookie))
  run revokedSessionRefusesPresentedCookieTest = owner.then(revokeFromOtherSession)
    .expect(browserSendsCookie and not(authenticated) and not(permitsAdminAction))
  run signoutClearsOwnerSessionTest = owner.then(signout)
    .expect(not(authenticated) and not(browserSendsCookie))
  run closedOwnerMustReopenTest = owner.then(close).then(join(true, false))
    .expect(s.closed and not(authenticated) and not(browserSendsCookie))
    .then(join(true, true)).expect(not(s.closed) and authenticated)
}
