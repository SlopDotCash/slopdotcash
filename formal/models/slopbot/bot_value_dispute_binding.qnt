// @source workers/slopbot/value-disputes.ts
// A dispute retains its original exact assessment and actor, even when a
// newer joint correction becomes the current score. The actor argument below
// is the stored appellant field checked against the key, not the identity of
// a moderator requesting a decision. This is only the retained-binding
// projection; bot_value_dispute_read, bot_value_dispute_actor and
// bot_value_dispute_draft model lookup, eligibility and triage separately.
// No automatic payment or decision authority is granted by this model.
module bot_value_dispute_binding {
  var s: { current: int, joint: bool, disputed: int, actor: int,
    retained: bool, bindingRead: bool }
  action init = s' = {current: 1, joint: false, disputed: 0, actor: 0,
    retained: false, bindingRead: false}
  action file(actor: int): bool = all { s.disputed == 0,
    s' = s.with("disputed", s.current).with("actor", actor).with("retained", true) }
  action correction = all { s.current < 3,
    s' = s.with("current", s.current + 1).with("joint", true) }
  action readBinding(actor: int): bool = all { s.retained, actor == s.actor,
    s' = s.with("bindingRead", true) }
  action step = { nondet actor = Set(1, 2).oneOf()
    any { file(actor), correction, readBinding(actor), s' = s } }
  val invariant = all { s.retained implies s.disputed > 0 and s.disputed <= s.current,
    s.bindingRead implies s.retained }
  run correctionDoesNotRetargetAppealTest = init.then(file(1)).then(correction)
    .then(readBinding(1)).expect(s.disputed == 1 and s.current == 2 and s.joint and s.bindingRead)
}
