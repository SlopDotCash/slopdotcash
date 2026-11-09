// @source migrations/0085_slopbot_provider_failure_notices.sql
// @source workers/notify/contracts.ts
// @source workers/slopbot/failure-alerts.ts
// @source workers/slopbot/spend-alerts.ts
// @source migrations/0049_slopbot_spend_alerts.sql
// At most one notify-service request per durable notice claim, including
// ambiguous transport failure. The service may send to several administrators;
// its provider fan-out and partial results are notification_admin_fanout.
// Three scaled spending milestones retain all past claims.
module bot_notice_delivery {
  var s: { earned: int, claimed: int, pending: bool, sent: bool,
    receipts: List[str], calls: int }
  action init = s' = {earned: 0, claimed: 0, pending: false, sent: false, receipts: [], calls: 0}
  action spending = all { s.earned < 3, s' = s.with("earned", s.earned + 1) }
  action claim = all { s.claimed < s.earned, not(s.pending),
    s' = s.with("claimed", s.claimed + 1).with("pending", true).with("sent", false) }
  action send = all { s.pending, not(s.sent), s' = s.with("sent", true).with("calls", s.calls + 1) }
  action receipt(outcome: str): bool = all { s.pending, s.sent,
    s' = s.with("pending", false).with("receipts", s.receipts.append(outcome)) }
  action step = any { spending, claim, send, receipt("accepted"), receipt("ambiguous"), s' = s }
  val invariant = all { s.calls <= s.claimed, s.claimed <= s.earned,
    s.receipts.length() <= s.calls }
  run ambiguousNeverResendsTest = init.then(spending).then(claim).then(send).then(receipt("ambiguous"))
    .expect(s.calls == 1 and s.claimed == 1 and not(s.pending))
  run retainedMilestonesTest = init.then(spending).then(spending).then(claim).then(send)
    .then(receipt("accepted")).then(claim).then(send).then(receipt("accepted"))
    .expect(s.calls == 2 and s.receipts.length() == 2)
}
