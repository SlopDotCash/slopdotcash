// @source migrations/0033_optional_notification_email.sql
// @source migrations/0111_verified_notification_email.sql
// @source migrations/0116_email_preference_revision.sql
// @source backend/notifications/email.ts
// @source backend/notifications/email-destinations.ts
// @source workers/notify/enrollment.ts
// Preference revision is captured when Verify is pressed, not when the
// enrollment email was requested. A fresh Verify after an opt-out is new consent.
// One token at a time, three preference revisions; token entropy is abstract.
module api_email_consent {
  var s: {revision: int, checkedRevision: int, checking: bool, token: str,
    destination: int, activity: bool, security: bool,
    requestedActivity: bool, requestedSecurity: bool}
  action init = s' = {revision: 0, checkedRevision: 0, checking: false,
    token: "absent", destination: 0, activity: false, security: false,
    requestedActivity: false, requestedSecurity: false}
  action request(activity: bool, security: bool): bool = all { s.revision < 3,
    s' = s.with("token", "pending").with("checking", false)
      .with("requestedActivity", activity).with("requestedSecurity", security) }
  action expire = all { s.token == "pending", s' = s.with("token", "expired") }
  action beginVerification(sameAccount: bool): bool = all { sameAccount,
    s.token == "pending", s.revision < 3,
    s' = s.with("checkedRevision", s.revision).with("checking", true) }
  action verify = all { s.checking, s.checkedRevision == s.revision,
    Set("pending", "expired").contains(s.token), s.revision < 3,
    s' = s.with("token", "consumed").with("checking", false)
      .with("destination", s.destination + 1).with("revision", s.revision + 1)
      .with("activity", s.requestedActivity).with("security", s.requestedSecurity) }
  action optOut = all { s.revision < 3,
    s' = s.with("activity", false).with("security", false).with("revision", s.revision + 1) }
  action step = any { request(true, false), request(false, true), request(true, true),
    expire, beginVerification(true), beginVerification(false), verify, optOut, s' = s }
  val invariant = all { (s.activity or s.security) implies s.destination > 0,
    s.destination <= s.revision, s.revision <= 3 }
  run verificationTest = init.then(request(true, false)).then(beginVerification(true)).then(verify)
    .expect(s.activity and not(s.security) and s.token == "consumed")
  run optOutWinsTest = init.then(request(true, true)).then(beginVerification(true)).then(optOut)
    .expect(s.checkedRevision != s.revision and not(s.activity) and not(s.security)).then(verify.fail())
  run expiredTokenTest = init.then(request(false, true)).then(expire)
    .expect(s.destination == 0).then(beginVerification(true).fail())
  run freshVerificationAfterOptOutTest = init.then(request(true, true)).then(optOut)
    .then(beginVerification(true)).then(verify).expect(s.activity and s.security)
  run consumedTokenCannotVerifyAgainTest = init.then(request(true, false))
    .then(beginVerification(true)).then(verify).then(beginVerification(true).fail())
  run anotherActorCannotVerifyTest = init.then(request(true, false)).then(beginVerification(false).fail())
  run admittedBeforeExpiryCanFinishTest = init.then(request(false, true))
    .then(beginVerification(true)).then(expire).then(verify).expect(s.security)
}
