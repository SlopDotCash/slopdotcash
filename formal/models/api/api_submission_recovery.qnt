// @source backend/security/submissions.ts
// @source backend/security/report-intake.ts
// @source migrations/0059_private_security_submissions.sql
// @source migrations/0101_durable_security_intake.sql
// Optional GitHub forwarding after admission/consent. Two send attempts and
// eight revisions bound this model, not the service. Age classes: 0=start,
// 1=exactly60s,2=>60s,3=<300s,4=>=300s,5=>24h. Idle expiry is separate.
// GitHub may expose an old copy after an empty listing; receipt binding picks
// the earliest visible copy and never rebinds it. No exactly-once POST claim.
module api_submission_recovery {
  var s: { phase: str, revision: int, readerRevision: int, sendRevision: int,
    attempts: int, age: int, idleExpired: bool, copies: Set[int], advisory: int,
    terminalFailure: bool, saved: bool, caseCount: int, receiptVerified: bool,
    contactsVerified: bool, absenceObserved: bool }
  action init = s' = {phase: "draft", revision: 1, readerRevision: 0, sendRevision: 0,
    attempts: 0, age: 0, idleExpired: false, copies: Set(), advisory: 0,
    terminalFailure: false, saved: false, caseCount: 0, receiptVerified: false,
    contactsVerified: false, absenceObserved: false}
  action save = all { s.phase == "draft", s.attempts == 0,
    s' = s.with("saved", true).with("caseCount", 1) }
  action read = s' = s.with("readerRevision", s.revision)
  action claimSend = all { s.revision < 8, s.readerRevision == s.revision,
    Set("draft", "failed").contains(s.phase), not(s.terminalFailure), s.advisory == 0, s.attempts < 2,
    s' = s.with("phase", "submitting").with("revision", s.revision + 1)
      .with("sendRevision", s.revision + 1).with("attempts", s.attempts + 1)
      .with("age", 0).with("idleExpired", false).with("absenceObserved", false) }
  action age = all { s.attempts > 0, s.age < 5, s' = s.with("age", s.age + 1) }
  action idleExpires = s' = s.with("idleExpired", true)
  action land(copy: int): bool = all { copy <= s.attempts,
    s' = s.with("copies", s.copies.union(Set(copy))) }
  action interrupted = all { s.phase == "submitting", s.age >= 2, s.revision < 8,
    s' = s.with("phase", "uncertain").with("revision", s.revision + 1).with("idleExpired", false) }
  action uncertain = all { s.phase == "submitting", s.sendRevision == s.revision, s.revision < 8,
    s' = s.with("phase", "uncertain").with("revision", s.revision + 1).with("idleExpired", false) }
  action providerRejected(terminal: bool): bool = all { s.phase == "submitting", s.sendRevision == s.revision, s.revision < 8,
    s' = s.with("phase", "failed").with("terminalFailure", terminal).with("revision", s.revision + 1).with("idleExpired", false) }
  action throttled = all { s.phase == "submitting", s.sendRevision == s.revision, s.revision < 8,
    s' = s.with("phase", "draft").with("revision", s.revision + 1).with("idleExpired", false) }
  val earliest = if (s.copies.contains(1)) 1 else 2
  action recordProviderReceipt = all { s.phase == "submitting", s.sendRevision == s.revision,
    s.copies.size() > 0, s.revision < 8, s.advisory == 0,
    s' = s.with("phase", "submitted").with("advisory", earliest).with("revision", s.revision + 1) }
  action staleProviderReceipt = all { s.sendRevision != s.revision, s' = s }
  action reconcileFound = all { s.phase == "uncertain", s.advisory == 0, s.copies.size() > 0, s.revision < 8,
    s' = s.with("phase", "submitted").with("advisory", earliest).with("revision", s.revision + 1) }
  action reconcileEmpty = all { s.phase == "uncertain", s.advisory == 0, s.copies.size() == 0,
    s.age >= 4, s.revision < 8,
    s' = s.with("phase", "draft").with("revision", s.revision + 1)
      .with("absenceObserved", true).with("idleExpired", false) }
  action contactsUnavailable = all { s.phase == "submitted", s.advisory != 0,
    s' = s.with("contactsVerified", true) }
  action verify = all { s.phase == "submitted", s.advisory != 0, s.revision < 8,
    s' = s.with("phase", "receipt-verified").with("revision", s.revision + 1)
      .with("receiptVerified", true).with("caseCount", 1) }
  action verificationExpires = all { s.phase == "submitted", s.age == 5,
    not(s.contactsVerified), s.revision < 8,
    s' = s.with("phase", "failed").with("terminalFailure", true).with("revision", s.revision + 1).with("idleExpired", false) }
  action abandon = all { Set("draft", "failed").contains(s.phase), s.idleExpired, not(s.saved),
    not(s.phase == "draft" and s.advisory != 0 and s.contactsVerified), s.revision < 8,
    s' = s.with("phase", "abandoned").with("revision", s.revision + 1) }
  action step = any { save, read, claimSend, age, idleExpires, land(1), land(2), interrupted, uncertain,
    providerRejected(true), providerRejected(false), throttled, recordProviderReceipt, staleProviderReceipt,
    reconcileFound, reconcileEmpty, contactsUnavailable, verify, verificationExpires, abandon, s' = s }
  val invariant = all { s.attempts <= 2, s.caseCount <= 1,
    s.saved implies s.caseCount == 1 and s.phase != "abandoned",
    s.receiptVerified implies s.phase == "receipt-verified" and s.advisory != 0 and s.caseCount == 1,
    s.advisory != 0 implies s.copies.contains(s.advisory) }
  run competingSendCannotUseOldRevisionTest = init.then(read).then(claimSend).then(claimSend.fail())
  run interruptWinsOverLateReceiptTest = init.then(save).then(read).then(claimSend).then(age).then(age)
    .then(interrupted).then(land(1)).then(staleProviderReceipt).expect(s.advisory == 0)
    .then(reconcileFound).then(verify).expect(s.receiptVerified and s.caseCount == 1)
  run earlyEmptyCannotRetryTest = init.then(read).then(claimSend).then(uncertain).then(age).then(age).then(age)
    .then(reconcileEmpty.fail())
  run lateCopyWinsAfterEmptyRetryTest = init.then(read).then(claimSend).then(uncertain)
    .then(age).then(age).then(age).then(age).then(reconcileEmpty).then(read).then(claimSend)
    .then(land(1)).then(land(2)).then(recordProviderReceipt).then(verify)
    .expect(s.advisory == 1 and s.attempts == 2 and s.caseCount == 1)
  run verifiedContactsKeepSubmittedRecoveryTest = init.then(read).then(claimSend).then(land(1)).then(recordProviderReceipt)
    .then(contactsUnavailable).then(age).then(age).then(age).then(age).then(age).then(verificationExpires.fail())
  run savedFailureNeverExpiresAwayTest = init.then(save).then(read).then(claimSend).then(providerRejected(true))
    .then(idleExpires).then(abandon.fail())
  run optionalDraftExpiresTest = init.then(idleExpires).then(abandon).expect(s.phase == "abandoned" and s.caseCount == 0)
}
