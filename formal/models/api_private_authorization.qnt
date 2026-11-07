// @source migrations/0061_security_automatic_intake.sql
// @source backend/security/intake-grant.ts
// @source backend/security/github-advisories.ts
module api_private_authorization {
  var s: {phase: str, session: int, boundSession: int, actor: int, boundActor: int, submission: int, boundSubmission: int, now: int, hasGrant: bool}
  action init = s' = {phase: "idle", session: 1, boundSession: 0, actor: 1, boundActor: 0, submission: 1, boundSubmission: 0, now: 0, hasGrant: false}
  action begin = all { s.phase == "idle", s.session != 0,
    s' = s.with("phase", "authorizing").with("boundSession", s.session).with("boundActor", s.actor).with("boundSubmission", s.submission) }
  action finish(providerActor: int): bool = all { s.phase == "authorizing", s.now < 3,
    providerActor == s.boundActor, s.session == s.boundSession, s.actor == s.boundActor,
    s' = s.with("phase", "authorized").with("hasGrant", true) }
  action switchAccount = s' = s.with("actor", 2).with("session", 2)
  action switchSubmission = s' = s.with("submission", 2)
  action useGrant = all { s.hasGrant, s.now < 3, s.session == s.boundSession, s.actor == s.boundActor, s.submission == s.boundSubmission,
    s' = s.with("phase", "used") }
  action tick = all { s.now < 4, s' = s.with("now", s.now + 1) }
  action step = any { begin, finish(1), finish(2), switchAccount, switchSubmission, useGrant, tick, s' = s }
  val invariant = s.phase == "used" implies s.hasGrant
  run boundGrantTest = init.then(begin).then(finish(1)).then(useGrant).expect(s.hasGrant)
  run switchedAccountTest = init.then(begin).then(switchAccount).expect(s.session != s.boundSession)
  run switchedReportTest = init.then(begin).then(finish(1)).then(switchSubmission).expect(s.submission != s.boundSubmission)
}
