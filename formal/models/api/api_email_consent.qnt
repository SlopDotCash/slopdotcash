// @source migrations/0033_optional_notification_email.sql
// @source migrations/0111_verified_notification_email.sql
// @source migrations/0116_email_preference_revision.sql
// @source migrations/0121_email_unsubscribe_token_expiry.sql
// @source backend/notifications/email.ts
// @source backend/notifications/email-destinations.ts
// @source workers/notify/enrollment.ts
// Preference revision is captured when Verify is pressed, not when the
// enrollment email was requested. A fresh Verify after an opt-out is new consent.
// One token at a time, three preference revisions; token entropy is abstract.
// An issued unsubscribe capability likewise expires 30 days after its own
// issue and is spent on first use; every mail issues a new, independent
// random token, so a spent token stays spent. The expiry and single-use
// transitions are encoded below as issueUnsub, useUnsub(generation), and
// expireUnsub; the generation is bounded at 2, and presenting an older
// generation after a reissue fails.
module api_email_consent {
  var s: {revision: int, checkedRevision: int, checking: bool, token: str,
    destination: int, activity: bool, security: bool,
    requestedActivity: bool, requestedSecurity: bool,
    unsub: str, unsubGen: int}
  action init = s' = {revision: 0, checkedRevision: 0, checking: false,
    token: "absent", destination: 0, activity: false, security: false,
    requestedActivity: false, requestedSecurity: false,
    unsub: "none", unsubGen: 0}
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
  action issueUnsub = all { s.destination > 0, s.activity or s.security,
    s.unsubGen < 2,
    s' = s.with("unsub", "issued").with("unsubGen", s.unsubGen + 1) }
  action useUnsub(g: int): bool = all { g == s.unsubGen, s.unsub == "issued",
    s' = s.with("unsub", "consumed").with("activity", false).with("security", false) }
  action expireUnsub = all { s.unsub == "issued", s' = s.with("unsub", "expired") }
  action step = any { request(true, false), request(false, true), request(true, true),
    expire, beginVerification(true), beginVerification(false), verify, optOut,
    issueUnsub, expireUnsub, useUnsub(0), useUnsub(1), useUnsub(2), s' = s }
  val invariant = all { (s.activity or s.security) implies s.destination > 0,
    s.destination <= s.revision, s.revision <= 3,
    (s.unsub != "none") implies s.destination > 0, s.unsubGen <= 2 }
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
  run unsubSingleUseTest = init.then(request(true, true)).then(beginVerification(true)).then(verify)
    .then(issueUnsub).then(useUnsub(1))
    .expect(not(s.activity) and not(s.security) and s.unsub == "consumed").then(useUnsub(1).fail())
  run unsubExpiryTest = init.then(request(true, true)).then(beginVerification(true)).then(verify)
    .then(issueUnsub).then(expireUnsub).expect(s.unsub == "expired").then(useUnsub(1).fail())
  run oldUnsubGenerationDeadAfterReissueTest = init.then(request(true, true)).then(beginVerification(true)).then(verify)
    .then(issueUnsub).then(useUnsub(1)).then(request(true, true)).then(beginVerification(true)).then(verify)
    .then(issueUnsub).then(useUnsub(1).fail())
  run newUnsubGenerationWorksAfterReissueTest = init.then(request(true, true)).then(beginVerification(true)).then(verify)
    .then(issueUnsub).then(useUnsub(1)).then(request(true, true)).then(beginVerification(true)).then(verify)
    .then(issueUnsub).then(useUnsub(2))
    .expect(s.unsub == "consumed" and not(s.activity) and not(s.security))
}
