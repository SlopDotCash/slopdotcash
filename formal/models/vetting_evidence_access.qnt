// @source backend/vetting/evidence.ts
// Operator grants bind actor, assessment, run and exact object. A consumed
// grant stays spent even when object verification or audit prevents delivery.
module vetting_evidence_access {
  var s: { now: int, grant: bool, owner: int, target: int, consumed: bool,
    attemptAudited: bool, bytesVerified: bool, readAudited: bool, delivered: bool }
  action init = s' = {now: 0, grant: false, owner: 0, target: 0, consumed: false,
    attemptAudited: false, bytesVerified: false, readAudited: false, delivered: false}
  action issue = all { not(s.grant), s' = s.with("grant", true).with("owner", 1).with("target", 1) }
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action consume(actor: int, target: int): bool = all { s.grant, not(s.consumed), s.now < 2,
    actor == s.owner, target == s.target, s' = s.with("consumed", true) }
  action auditAttempt = all { s.consumed, s' = s.with("attemptAudited", true) }
  action verifyBytes = all { s.attemptAudited, s' = s.with("bytesVerified", true) }
  action auditRead = all { s.bytesVerified, s' = s.with("readAudited", true) }
  action deliver = all { s.readAudited, s' = s.with("delivered", true) }
  action step = { nondet actor = Set(1, 2).oneOf(); nondet target = Set(1, 2).oneOf()
    any { issue, tick, consume(actor, target), auditAttempt, verifyBytes, auditRead, deliver, s' = s } }
  val invariant = s.delivered implies s.consumed and s.attemptAudited and s.bytesVerified and s.readAudited
  run exactAuditedReadTest = init.then(issue).then(consume(1, 1)).then(auditAttempt)
    .then(verifyBytes).then(auditRead).then(deliver).expect(s.delivered and invariant)
  run expiredGrantTest = init.then(issue).then(tick).then(tick).expect(not(s.consumed))
  run failedReadDoesNotRestoreGrantTest = init.then(issue).then(consume(1, 1)).then(auditAttempt)
    .expect(s.consumed and not(s.delivered))
}
