// @source workers/slopbot/points-disputes.ts
// @source migrations/0114_points_dispute_intake.sql
// @source backend/points/disputes.ts
module api_points_disputes {
  var s: {phase: str, exists: bool, revision: int, originalAward: int, inbox: bool, resolver: int}
  action init = s' = {phase: "absent", exists: false, revision: 0, originalAward: 1, inbox: false, resolver: 0}
  action open(ownsRevision: bool): bool = all { ownsRevision, not(s.exists), s' = s.with("exists", true).with("phase", "triage").with("revision", 1) }
  action escalate = all { s.phase == "triage", s' = s.with("phase", "escalated").with("inbox", true) }
  action resolve(actor: int): bool = all { s.phase == "escalated", actor == 2,
    s' = s.with("phase", "resolved").with("revision", 2).with("resolver", actor) }
  action step = any { open(true), open(false), escalate, resolve(1), resolve(2), s' = s }
  val invariant = all { s.phase == "resolved" implies (s.resolver == 2 and s.inbox), s.originalAward == 1, s.revision <= 2 }
  run escalationTest = init.then(open(true)).then(escalate).then(resolve(2)).expect(s.phase == "resolved" and s.originalAward == 1)
}
