// @source workers/slopbot/value-disputes.ts
// A dispute retains its original exact assessment and actor, even when a
// newer joint correction becomes the current score. No automatic payment.
module bot_value_dispute_binding {
  var s: { current: int, joint: bool, disputed: int, actor: int,
    retained: bool, decision: str }
  action init = s' = {current: 1, joint: false, disputed: 0, actor: 0,
    retained: false, decision: "none"}
  action file(actor: int): bool = all { s.disputed == 0,
    s' = s.with("disputed", s.current).with("actor", actor).with("retained", true) }
  action correction = all { s.current < 3,
    s' = s.with("current", s.current + 1).with("joint", true) }
  action decide(actor: int): bool = all { s.retained, actor == s.actor,
    s' = s.with("decision", "recorded") }
  action step = { nondet actor = Set(1, 2).oneOf()
    any { file(actor), correction, decide(actor), s' = s } }
  val invariant = all { s.retained implies s.disputed > 0 and s.disputed <= s.current,
    s.decision == "recorded" implies s.retained }
  run correctionDoesNotRetargetAppealTest = init.then(file(1)).then(correction)
    .then(decide(1)).expect(s.disputed == 1 and s.current == 2 and s.joint)
}
