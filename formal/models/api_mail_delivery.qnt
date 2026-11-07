// @source migrations/0030_security_notification_outbox.sql
// @source migrations/0033_optional_notification_email.sql
// @source workers/notify/security.ts
// @source workers/notify/activity.ts
// @source workers/notify/handler.ts
// @source workers/notify/index.ts
// @source backend/notifications/events.ts
// @source backend/notifications/handler.ts
module api_mail_delivery {
  var s: {phase: str, attempts: int, consent: bool, authority: bool, calls: int, reconciled: bool, acknowledged: bool}
  action init = s' = {phase: "queued", attempts: 0, consent: true, authority: true, calls: 0, reconciled: false, acknowledged: false}
  action claim = all { Set("queued", "retrying").contains(s.phase), s.attempts < 5,
    s' = s.with("phase", "sending").with("attempts", s.attempts + 1).with("reconciled", false) }
  action prepareDenied = all { s.phase == "sending", not(s.consent and s.authority), s' = s.with("phase", "suppressed") }
  action accepted = all { s.phase == "sending", s.consent, s.authority,
    s' = s.with("phase", "provider-accepted").with("calls", s.calls + 1) }
  action unknown = all { s.phase == "sending", s' = s.with("phase", "ambiguous") }
  action confirmedNotAccepted = all { s.phase == "ambiguous", s' = s.with("reconciled", true) }
  action retry = all { s.phase == "sending" or (s.phase == "ambiguous" and s.reconciled),
    s' = s.with("phase", if(s.attempts < 5) "retrying" else "exhausted") }
  action delivered = all { s.phase == "provider-accepted", s' = s.with("phase", "delivered") }
  action bounced = all { s.phase == "provider-accepted", s' = s.with("phase", "bounced") }
  action revoke = s' = s.with("consent", false)
  action acknowledge = s' = s.with("acknowledged", true)
  action step = any { claim, prepareDenied, accepted, unknown, confirmedNotAccepted, retry, delivered, bounced, revoke, acknowledge, s' = s }
  val invariant = all { s.attempts <= 5, s.calls <= s.attempts,
    Set("provider-accepted", "delivered", "bounced").contains(s.phase) implies s.calls > 0 }
  run ambiguousTest = init.then(claim).then(unknown).expect(s.phase == "ambiguous" and not(s.reconciled))
    .then(confirmedNotAccepted).then(retry).expect(s.phase == "retrying")
  run optOutTest = init.then(claim).then(revoke).then(prepareDenied).expect(s.calls == 0)
  run deliveredTest = init.then(claim).then(accepted).then(delivered).expect(s.phase == "delivered")
}
