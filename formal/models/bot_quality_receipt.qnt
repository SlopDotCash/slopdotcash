// @source migrations/0040_slopbot_quality_shadow.sql
// @source workers/slopbot/quality.ts
// A verified signature is necessary but insufficient: source, policy, approved
// isolation, exact predicate and a live <=24h receipt must independently hold.
module bot_quality_receipt {
  var s: { now: int, expires: int, signed: bool, bound: bool, isolated: bool,
    complete: bool, predicate: bool, qualified: bool, accepted: bool, closeEligible: bool }
  action init = s' = {now: 0, expires: 2, signed: false, bound: false, isolated: false,
    complete: false, predicate: false, qualified: false, accepted: false, closeEligible: false}
  action verify = s' = s.with("signed", true)
  action inspect(bound: bool, isolated: bool, complete: bool, predicate: bool): bool = all { not(s.accepted),
    s' = s.with("bound", bound).with("isolated", isolated).with("complete", complete).with("predicate", predicate) }
  action qualify = s' = s.with("qualified", true)
  action tick = all { s.now < 2, not(s.accepted), s' = s.with("now", s.now + 1) }
  action accept = all { s.signed, s.bound, s.isolated, s.complete, s.predicate, s.now < s.expires,
    s' = s.with("accepted", true).with("closeEligible", s.qualified) }
  action step = { nondet bound = Set(true, false).oneOf(); nondet isolated = Set(true, false).oneOf()
    nondet complete = Set(true, false).oneOf(); nondet predicate = Set(true, false).oneOf()
    any { verify, inspect(bound, isolated, complete, predicate), qualify, tick, accept, s' = s } }
  val invariant = all { s.accepted implies s.signed and s.bound and s.isolated and s.complete and s.predicate and s.now < s.expires,
    s.closeEligible implies s.qualified and s.accepted }
  run signatureDoesNotProveCoverageTest = init.then(verify).then(inspect(true, true, false, true))
    .expect(not(s.accepted))
  run receiptDoesNotQualifyProfileTest = init.then(verify).then(inspect(true, true, true, true)).then(accept)
    .expect(s.accepted and not(s.closeEligible))
  run expiredReceiptRefusedTest = init.then(verify).then(inspect(true, true, true, true)).then(tick).then(tick)
    .expect(not(s.accepted) and s.now == s.expires)
}
