// @source migrations/0079_slopbot_scam_review_notifications.sql
// @source migrations/0024_notifications.sql
// @source migrations/0029_notification_event_kinds.sql
// @source migrations/0063_account_closure_notification_events.sql
// @source migrations/0065_slopbot_appeal_notifications.sql
// @source backend/notifications/handler.ts
// @source backend/notifications/events.ts
module api_inbox {
  var s: {sourceCommitted: bool, notice: bool, read: bool, acknowledged: bool, outbox: bool, moderator: bool}
  action init = s' = {sourceCommitted: false, notice: false, read: false, acknowledged: false, outbox: false, moderator: true}
  action commit = s' = s.with("sourceCommitted", true).with("notice", true).with("outbox", true)
  action markRead(ownsNotice: bool): bool = all { ownsNotice, s.notice, s' = s.with("read", true) }
  action acknowledge(authorized: bool): bool = all { authorized, s.notice, s' = s.with("acknowledged", true) }
  action revokeModerator = s' = s.with("moderator", false)
  action step = any { commit, markRead(true), markRead(false), acknowledge(true), acknowledge(false), revokeModerator, s' = s }
  val invariant = all { s.notice implies s.sourceCommitted, s.read implies s.notice, s.acknowledged implies s.notice, s.outbox implies s.notice }
  run independentReadTest = init.then(commit).then(markRead(true)).expect(s.read and not(s.acknowledged))
  run replayTest = init.then(commit).then(commit).expect(s.notice and s.outbox)
}
