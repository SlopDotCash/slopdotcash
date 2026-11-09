// @source migrations/0033_optional_notification_email.sql
// @source migrations/0111_verified_notification_email.sql
// @source migrations/0116_email_preference_revision.sql
// @source backend/notifications/email.ts
// @source backend/notifications/email-destinations.ts
// @source workers/notify/enrollment.ts
module api_email_consent {
  var s: {revision: int, requestedRevision: int, token: str, destination: int, activity: bool, security: bool, requestedActivity: bool, requestedSecurity: bool}
  action init = s' = {revision: 0, requestedRevision: 0, token: "absent", destination: 0, activity: false, security: false, requestedActivity: false, requestedSecurity: false}
  action request(activity: bool, security: bool): bool = all { s.revision < 3,
    s' = s.with("token", "pending").with("requestedRevision", s.revision).with("requestedActivity", activity).with("requestedSecurity", security) }
  action expire = all { s.token == "pending", s' = s.with("token", "expired") }
  action verify(sameAccount: bool): bool = all { sameAccount, s.token == "pending", s.requestedRevision == s.revision, s.revision < 3,
    s' = s.with("token", "consumed").with("destination", s.destination + 1).with("revision", s.revision + 1)
      .with("activity", s.requestedActivity).with("security", s.requestedSecurity) }
  action optOut = all { s.revision < 3, s' = s.with("activity", false).with("security", false).with("revision", s.revision + 1) }
  action step = any { request(true, false), request(false, true), request(true, true), expire, verify(true), verify(false), optOut, s' = s }
  val invariant = all { (s.activity or s.security) implies s.destination > 0, s.destination <= s.revision, s.revision <= 3 }
  run verificationTest = init.then(request(true, false)).then(verify(true)).expect(s.activity and not(s.security) and s.token == "consumed")
  run optOutWinsTest = init.then(request(true, true)).then(optOut).expect(s.requestedRevision != s.revision and not(s.activity) and not(s.security))
  run expiredTokenTest = init.then(request(false, true)).then(expire).expect(s.destination == 0)
}
