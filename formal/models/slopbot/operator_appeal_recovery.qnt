// @source scripts/recover-slopbot-appeal.ts
// Recovery replays only an original completed delivery with unchanged current
// author/comment and no existing appeal. It supplies no new reviewer authority.
// One send per invocation may remain ambiguous; the consumer deduplicates.
module operator_appeal_recovery {
  var s: { original: bool, current: bool, completedReceipt: bool, existingAppeal: bool,
    checked: bool, sendEnabled: bool, calls: int, reported: str }
  action init = s' = {original: false, current: false, completedReceipt: false, existingAppeal: false,
    checked: false, sendEnabled: false, calls: 0, reported: "none"}
  action inspect(original: bool, current: bool, completed: bool, existing: bool): bool = all {
    not(s.checked),
    s' = s.with("original", original).with("current", current).with("completedReceipt", completed).with("existingAppeal", existing) }
  action validate = all { s.original, s.current, s.completedReceipt, not(s.existingAppeal),
    s' = s.with("checked", true).with("reported", "preview") }
  action optIn = s' = s.with("sendEnabled", true)
  action send = all { s.checked, s.sendEnabled, s.calls == 0,
    s' = s.with("calls", 1).with("reported", "unknown") }
  action acknowledge = all { s.calls == 1, s' = s.with("reported", "queued") }
  action step = { nondet o = Set(true, false).oneOf(); nondet c = Set(true, false).oneOf()
    nondet r = Set(true, false).oneOf(); nondet e = Set(true, false).oneOf()
    any { inspect(o, c, r, e), validate, optIn, send, acknowledge, s' = s } }
  val invariant = all { s.calls <= 1, s.calls == 1 implies s.checked and s.sendEnabled,
    s.reported == "queued" implies s.calls == 1 }
  run previewDoesNotSendTest = init.then(inspect(true, true, true, false)).then(validate).expect(s.calls == 0)
  run unknownSendIsNotAcknowledgedTest = init.then(inspect(true, true, true, false)).then(validate).then(optIn).then(send)
    .expect(s.calls == 1 and s.reported == "unknown")
  run unfinishedDeliveryUsesOrdinaryRedeliveryTest = init.then(inspect(true, true, false, false)).then(validate.fail())
}
