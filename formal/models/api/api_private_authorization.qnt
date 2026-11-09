// @source migrations/0061_security_automatic_intake.sql
// @source backend/security/intake-grant.ts
// @source backend/security/github-advisories.ts
// One authorization, two actor/session/submission identities. Flow and grant
// lifetimes have separate clocks: two and four abstract ticks respectively.
// Actual constants are ten minutes and two hours; no clock-ratio claim.
module api_private_authorization {
  var s: {phase: str, session: int, boundSession: int, actor: int, boundActor: int, submission: int, boundSubmission: int, now: int, flowUntil: int, grantUntil: int, hasGrant: bool, usedSession: int, usedActor: int, usedSubmission: int, usedAt: int}
  action init = s' = {phase: "idle", session: 1, boundSession: 0, actor: 1, boundActor: 0, submission: 1, boundSubmission: 0, now: 0, flowUntil: 0, grantUntil: 0, hasGrant: false, usedSession: 0, usedActor: 0, usedSubmission: 0, usedAt: 0}
  action begin = all { s.phase == "idle", s.session != 0, s.actor != 0, s.now == 0,
    s' = s.with("phase", "authorizing").with("boundSession", s.session).with("boundActor", s.actor).with("boundSubmission", s.submission).with("flowUntil", s.now + 2) }
  // SameSite=Strict commonly omits the site session on GitHub's redirect.
  // The encrypted flow binds the original session; any presented account and
  // the provider's /user must match that original actor. Callback acceptance
  // does not authorize use by a different current site session.
  action finish(providerActor: int, callbackActor: int): bool = all {
    s.phase == "authorizing", s.now < s.flowUntil,
    providerActor == s.boundActor,
    callbackActor == 0 or callbackActor == s.boundActor,
    s' = s.with("phase", "authorized").with("hasGrant", true).with("grantUntil", s.now + 4) }
  action switchSession = s' = s.with("session", 2)
  action switchActor = s' = s.with("actor", 2)
  action switchAccount = s' = s.with("actor", 2).with("session", 2)
  action signOut = s' = s.with("actor", 0).with("session", 0)
  action switchSubmission = s' = s.with("submission", 2)
  // readGrant is reusable during its own lifetime, not a consumed capability.
  action useGrant = all { s.hasGrant, s.now < s.grantUntil, s.session == s.boundSession, s.actor == s.boundActor, s.submission == s.boundSubmission,
    s' = s.with("phase", "used").with("usedSession", s.session).with("usedActor", s.actor).with("usedSubmission", s.submission).with("usedAt", s.now) }
  action tick = all { s.now < 6, s' = s.with("now", s.now + 1) }
  action step = any { begin, finish(1,0), finish(1,1), finish(1,2), finish(2,0), finish(2,2), switchSession, switchActor, switchAccount, signOut, switchSubmission, useGrant, tick, s' = s }
  val invariant = s.phase == "used" implies all {
    s.hasGrant, s.usedSession == s.boundSession, s.usedActor == s.boundActor,
    s.usedSubmission == s.boundSubmission, s.usedAt < s.grantUntil
  }
  run boundGrantTest = init.then(begin).then(finish(1,1)).then(useGrant).expect(s.hasGrant)
  run callbackWithoutSiteCookieTest = init.then(begin).then(finish(1,0)).then(useGrant).expect(s.hasGrant)
  run callbackAfterSignOutCannotReadTest = init.then(begin).then(signOut).then(finish(1,0)).then(useGrant.fail())
  run switchedAccountTest = init.then(begin).then(switchAccount).then(finish(1,0)).then(useGrant.fail())
  run callbackWrongAccountRefusedTest = init.then(begin).then(finish(1,2).fail())
  run providerWrongAccountRefusedTest = init.then(begin).then(finish(2,0).fail())
  run switchedReportTest = init.then(begin).then(finish(1,0)).then(switchSubmission).then(useGrant.fail())
  run sameActorNewSessionRefusedTest = init.then(begin).then(finish(1,0)).then(switchSession).then(useGrant.fail())
  run changedActorRefusedTest = init.then(begin).then(finish(1,0)).then(switchActor).then(useGrant.fail())
  run expiredFlowRefusedTest = init.then(begin).then(tick).then(tick).then(finish(1,0).fail())
  run grantOutlivesFlowTest = init.then(begin).then(tick).then(finish(1,0)).then(tick).then(tick).then(useGrant)
    .expect(s.now >= s.flowUntil and s.usedAt < s.grantUntil)
  run expiredGrantRefusedTest = init.then(begin).then(finish(1,0)).then(tick).then(tick).then(tick).then(tick).then(useGrant.fail())
  run grantReadDoesNotConsumeTest = init.then(begin).then(finish(1,0)).then(useGrant).then(useGrant).expect(s.hasGrant)
}
