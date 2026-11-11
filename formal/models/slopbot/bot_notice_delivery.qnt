// @source migrations/0085_slopbot_provider_failure_notices.sql
// @source migrations/0122_orbio_provider_failure_notices.sql
// @source workers/notify/contracts.ts
// @source workers/slopbot/failure-alerts.ts
// @source workers/slopbot/spend-alerts.ts
// @source migrations/0049_slopbot_spend_alerts.sql
// At most one notify-service request per durable notice claim, including
// ambiguous transport failure. The service may send to several administrators;
// its provider fan-out and partial results are notification_admin_fanout.
// Three scaled new notices retain all past claims. A newly inserted failed
// Orbio or Surplus call earns one notice; successes and other providers do not.
// Existing cost rows are not reinserted by trigger replacement and earn no
// new notice. Provider-call IDs and database uniqueness are abstracted by one
// fresh-call action per new receipt, separately from delivery claims.
module bot_notice_delivery {
  var s: { earned: int, claimed: int, pending: bool, sent: bool,
    receipts: List[str], calls: int }
  action init = s' = {earned: 0, claimed: 0, pending: false, sent: false, receipts: [], calls: 0}
  action spending = all { s.earned < 3, s' = s.with("earned", s.earned + 1) }
  action freshCall(provider: str, failed: bool): bool = all { s.earned < 3,
    s' = s.with("earned", s.earned + (if (failed and Set("orbio", "surplus").contains(provider)) 1 else 0)) }
  action claim = all { s.claimed < s.earned, not(s.pending),
    s' = s.with("claimed", s.claimed + 1).with("pending", true).with("sent", false) }
  action send = all { s.pending, not(s.sent), s' = s.with("sent", true).with("calls", s.calls + 1) }
  action receipt(outcome: str): bool = all { s.pending, s.sent,
    s' = s.with("pending", false).with("receipts", s.receipts.append(outcome)) }
  action step = {
    nondet provider = Set("orbio", "surplus", "other").oneOf()
    nondet failed = Set(false, true).oneOf()
    any { spending, freshCall(provider, failed), claim, send, receipt("accepted"), receipt("ambiguous"), s' = s }
  }
  val invariant = all { s.calls <= s.claimed, s.claimed <= s.earned,
    s.receipts.length() <= s.calls }
  run primaryAndBackupFailuresBothNotifyTest = init.then(freshCall("orbio", true))
    .then(freshCall("surplus", true)).expect(s.earned == 2).then(claim).then(send)
    .then(receipt("accepted")).then(claim).then(send).then(receipt("accepted"))
    .expect(s.calls == 2 and s.claimed == 2 and invariant)
  run successfulAndOtherCallsNeverNotifyTest = init.then(freshCall("orbio", false))
    .then(freshCall("surplus", false)).then(freshCall("other", true))
    .expect(s.earned == 0 and s.calls == 0).then(claim.fail())
  run historicalCostsCreateNoBacklogTest = init.expect(s.earned == 0).then(claim.fail())
  run ambiguousNeverResendsTest = init.then(spending).then(claim).then(send).then(receipt("ambiguous"))
    .expect(s.calls == 1 and s.claimed == 1 and not(s.pending))
  run retainedMilestonesTest = init.then(spending).then(spending).then(claim).then(send)
    .then(receipt("accepted")).then(claim).then(send).then(receipt("accepted"))
    .expect(s.calls == 2 and s.receipts.length() == 2)
}
