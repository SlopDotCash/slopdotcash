// @source src/lib/browser-json.ts
// @source src/lib/project-api.ts
// One read with at most one repeat. A GET the server answers with 500, 502 or
// 503 is asked once more after a wait; the second answer is final. A write, a
// refusal, a timeout and a cancelled request are never repeated.
module ui_read_retry {
  // kind: 0 read, 1 write. answer: 0 none yet, 1 success, 2 server failure,
  // 3 refusal or timeout. phase: 0 idle, 1 first sent, 2 waiting, 3 second
  // sent, 4 returned, 5 cancelled.
  var s: { kind: int, phase: int, sent: int, answer: int }
  action init = { nondet kind = Set(0, 1).oneOf()
    s' = {kind: kind, phase: 0, sent: 0, answer: 0} }
  action send = all { s.phase == 0, s' = s.with("phase", 1).with("sent", 1) }
  action first(answer: int): bool = all { s.phase == 1,
    s' = if (answer == 2 and s.kind == 0) s.with("phase", 2)
      else s.with("phase", 4).with("answer", answer) }
  action cancel = all { s.phase == 2, s' = s.with("phase", 5) }
  action resend = all { s.phase == 2,
    s' = s.with("phase", 3).with("sent", 2) }
  action second(answer: int): bool = all { s.phase == 3,
    s' = s.with("phase", 4).with("answer", answer) }
  action step = { nondet answer = Set(1, 2, 3).oneOf()
    any { send, first(answer), cancel, resend, second(answer), s' = s } }
  val invariant = all { s.sent <= 2,
    s.kind == 1 implies s.sent <= 1,
    s.phase == 5 implies s.sent == 1,
    (s.phase == 4 and s.sent == 2) implies s.kind == 0 }
  run failedReadIsAskedOnceMoreTest = init.then(send).then(first(2))
    .then(any { all { s.kind == 0, resend }, all { s.kind == 1, s' = s } })
    .expect(invariant and (s.kind == 0 implies s.sent == 2)
      and (s.kind == 1 implies (s.sent == 1 and s.phase == 4 and s.answer == 2)))
  run secondFailureIsFinalTest = init.then(send).then(first(2))
    .then(any { all { s.kind == 0, resend }, all { s.kind == 1, s' = s } })
    .then(any { second(2), all { s.phase == 4, s' = s } })
    .expect(s.phase == 4 and s.answer == 2 and s.sent <= 2)
  run refusalIsNotRepeatedTest = init.then(send).then(first(3))
    .expect(s.phase == 4 and s.sent == 1 and s.answer == 3)
  run cancelledWaitSendsNothingTest = init.then(send).then(first(2))
    .then(any { all { s.kind == 0, cancel }, all { s.kind == 1, s' = s } })
    .expect(s.sent == 1)
}
