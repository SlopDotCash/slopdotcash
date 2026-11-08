// @source backend/vetting/evidence.ts
// @source backend/http.ts
// @evidence scripts/vetting-api.test.ts
// Operator grants bind actor, assessment, run and exact object. A consumed
// grant stays spent even when object verification or audit prevents delivery.
// Two authenticated actors plus no session. Expected actor -1 is an absent
// optional header, 0 is malformed, and 1/2 are valid actor IDs. This models
// the admission order of requireActor followed by the operator allowlist;
// it does not make an expected actor header a source of authority.
// This admission refinement is source-authored and unexecuted.
module vetting_evidence_access {
  var s: { now: int, admission: str, actor: int, expected: int,
    designated: bool, refusal: str, grant: bool, owner: int, target: int, consumed: bool,
    attemptAudited: bool, bytesVerified: bool, readAudited: bool, delivered: bool }
  action init = s' = {now: 0, admission: "none", actor: 0, expected: -1,
    designated: false, refusal: "none", grant: false, owner: 0, target: 0, consumed: false,
    attemptAudited: false, bytesVerified: false, readAudited: false, delivered: false}
  action admit(actor: int, expected: int, designated: bool): bool = {
    val refusal = if (actor == 0) "unauthorized"
      else if (expected == 0) "invalid_expected_actor"
      else if (expected > 0 and expected != actor) "actor_changed"
      else if (not(designated)) "forbidden" else "none"
    all { s.admission == "none", actor >= 0, actor <= 2, expected >= -1, expected <= 2,
      s' = s.with("actor", actor).with("expected", expected).with("designated", designated)
        .with("refusal", refusal).with("admission", if (refusal == "none") "admitted" else "refused") }
  }
  action issue = all { s.admission == "admitted", not(s.grant),
    s' = s.with("grant", true).with("owner", s.actor).with("target", 1) }
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action consume(actor: int, target: int): bool = all { s.grant, not(s.consumed), s.now < 2,
    actor == s.owner, target == s.target, s' = s.with("consumed", true) }
  action auditAttempt = all { s.consumed, s' = s.with("attemptAudited", true) }
  action verifyBytes = all { s.attemptAudited, s' = s.with("bytesVerified", true) }
  action auditRead = all { s.bytesVerified, s' = s.with("readAudited", true) }
  action deliver = all { s.readAudited, s' = s.with("delivered", true) }
  action step = { nondet actor = Set(0, 1, 2).oneOf(); nondet target = Set(1, 2).oneOf()
    nondet expected = Set(-1, 0, 1, 2).oneOf(); nondet designated = Set(false, true).oneOf()
    any { admit(actor, expected, designated), issue, tick, consume(actor, target),
      auditAttempt, verifyBytes, auditRead, deliver, s' = s } }
  val invariant = all {
    s.grant implies (s.admission == "admitted" and s.actor > 0 and s.designated
      and s.refusal == "none" and (s.expected == -1 or s.expected == s.actor) and s.owner == s.actor),
    s.delivered implies (s.consumed and s.attemptAudited and s.bytesVerified and s.readAudited) }
  run exactAuditedReadTest = init.then(admit(1, 1, true)).then(issue).then(consume(1, 1)).then(auditAttempt)
    .then(verifyBytes).then(auditRead).then(deliver).expect(s.delivered and invariant)
  run expiredGrantTest = init.then(admit(1, 1, true)).then(issue).then(tick).then(tick).expect(not(s.consumed))
  run failedReadDoesNotRestoreGrantTest = init.then(admit(1, 1, true)).then(issue).then(consume(1, 1)).then(auditAttempt)
    .expect(s.consumed and not(s.delivered))
  run matchingExpectedActorIssuesGrantTest = init.then(admit(2, 2, true)).then(issue)
    .expect(s.grant and s.owner == 2 and s.refusal == "none")
  run mismatchedExpectedActorRefusesGrantTest = init.then(admit(2, 1, true))
    .expect(s.refusal == "actor_changed" and not(s.grant)).then(issue.fail())
  run absentExpectedActorLegacyGrantTest = init.then(admit(2, -1, true)).then(issue)
    .expect(s.grant and s.owner == 2 and s.expected == -1)
  run invalidExpectedActorRefusesGrantTest = init.then(admit(1, 0, true))
    .expect(s.refusal == "invalid_expected_actor" and not(s.grant)).then(issue.fail())
  run nonOperatorCannotIssueGrantTest = init.then(admit(1, 1, false))
    .expect(s.refusal == "forbidden" and not(s.grant)).then(issue.fail())
  run anonymousCannotIssueGrantTest = init.then(admit(0, 1, true))
    .expect(s.refusal == "unauthorized" and not(s.grant)).then(issue.fail())
}
