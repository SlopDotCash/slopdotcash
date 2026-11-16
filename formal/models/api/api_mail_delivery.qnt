// @source migrations/0030_security_notification_outbox.sql
// @source migrations/0033_optional_notification_email.sql
// @source workers/notify/security.ts
// @source workers/notify/activity.ts
// @source workers/notify/verified-delivery.ts
// @source workers/notify/handler.ts
// @source workers/notify/index.ts
// @source backend/notifications/events.ts
// @source backend/notifications/handler.ts
module api_mail_delivery {
  var s: {phase: str, attempts: int, consent: bool, authority: bool, preparedConsent: bool, preparedAuthority: bool, calls: int, reconciled: bool, acknowledged: bool}
  action init = s' = {phase: "queued", attempts: 0, consent: true, authority: true, preparedConsent: false, preparedAuthority: false, calls: 0, reconciled: false, acknowledged: false}
  // Both phases are SQL state=sending. Prepared records the audience and
  // destination/consent reads completed before async token creation/send.
  action claim = all { Set("queued", "retrying").contains(s.phase), s.attempts < 5,
    s' = s.with("phase", "preparing").with("attempts", s.attempts + 1).with("reconciled", false)
      .with("preparedConsent", false).with("preparedAuthority", false) }
  action prepare = all { s.phase == "preparing", s.consent, s.authority,
    s' = s.with("phase", "prepared").with("preparedConsent", s.consent).with("preparedAuthority", s.authority) }
  action prepareDenied = all { s.phase == "preparing", not(s.consent and s.authority), s' = s.with("phase", "suppressed") }
  action accepted = all { s.phase == "prepared",
    s' = s.with("phase", "provider-accepted").with("calls", s.calls + 1) }
  action unknown = all { s.phase == "prepared", s' = s.with("phase", "ambiguous").with("calls", s.calls + 1) }
  action confirmedNotAccepted = all { s.phase == "ambiguous", s' = s.with("reconciled", true) }
  action preparationFailed = all { Set("preparing", "prepared").contains(s.phase),
    s' = s.with("phase", if(s.attempts < 5) "retrying" else "exhausted") }
  action rejected = all { s.phase == "prepared",
    s' = s.with("phase", if(s.attempts < 5) "retrying" else "exhausted").with("calls", s.calls + 1) }
  // Ambiguous sends require independent non-acceptance proof before retry.
  action retry = all { s.phase == "ambiguous", s.reconciled,
    s' = s.with("phase", if(s.attempts < 5) "retrying" else "exhausted") }
  action delivered = all { s.phase == "provider-accepted", s' = s.with("phase", "delivered") }
  action bounced = all { s.phase == "provider-accepted", s' = s.with("phase", "bounced") }
  action revoke = s' = s.with("consent", false)
  action revokeAuthority = s' = s.with("authority", false)
  action acknowledge = s' = s.with("acknowledged", true)
  action step = any { claim, prepare, prepareDenied, accepted, unknown, confirmedNotAccepted, preparationFailed, rejected, retry, delivered, bounced, revoke, revokeAuthority, acknowledge, s' = s }
  val invariant = all { s.attempts <= 5, s.calls <= s.attempts,
    Set("prepared", "provider-accepted", "delivered", "bounced", "ambiguous").contains(s.phase)
      implies (s.preparedConsent and s.preparedAuthority),
    Set("provider-accepted", "delivered", "bounced").contains(s.phase) implies s.calls > 0 }
  run ambiguousTest = init.then(claim).then(prepare).then(unknown).expect(s.phase == "ambiguous" and not(s.reconciled))
    .then(confirmedNotAccepted).then(retry).expect(s.phase == "retrying")
  run optOutTest = init.then(claim).then(revoke).then(prepareDenied).expect(s.calls == 0)
  run authorityLostBeforePreparationRefusesTest = init.then(claim).then(revokeAuthority).then(prepareDenied).expect(s.calls == 0)
  run preparationAfterOptOutRefusedTest = init.then(claim).then(revoke).then(prepare.fail())
  run preparationAfterAuthorityLossRefusedTest = init.then(claim).then(revokeAuthority).then(prepare.fail())
  run inFlightPreparationKeepsObservedConsentTest = init.then(claim).then(prepare).then(revoke).then(accepted)
    .expect(s.calls == 1 and not(s.consent))
  run inFlightPreparationKeepsObservedAuthorityTest = init.then(claim).then(prepare).then(revokeAuthority).then(accepted)
    .expect(s.calls == 1 and not(s.authority))
  run uncertainSendCountsProviderCallTest = init.then(claim).then(prepare).then(unknown)
    .expect(s.calls == 1 and not(s.reconciled))
  run definiteRejectionCountsProviderCallTest = init.then(claim).then(prepare).then(rejected)
    .expect(s.calls == 1 and s.phase == "retrying")
  run preparationFailureDoesNotCountProviderCallTest = init.then(claim).then(prepare).then(preparationFailed)
    .expect(s.calls == 0 and s.phase == "retrying")
  run deliveredTest = init.then(claim).then(prepare).then(accepted).then(delivered).expect(s.phase == "delivered")
}
