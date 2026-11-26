// @source backend/payments/protected-point-months.ts
// @source functions/api/v1/[[path]].ts
// @source scripts/generate-points.ts
// @source scripts/points-protection-read.ts
// @source scripts/points-protection-sql.ts
// @evidence backend/payments/protected-point-months.test.ts
// @evidence scripts/points-protection-read.test.ts
// @evidence scripts/points-protected-hold.test.ts
// @evidence scripts/pages-secret-inventory.test.ts
// The private protected-point-months route and the points generator's read of
// it (operator decision, 21 November 2026; PRD section 7). One candidate
// revision changes an award of one project month. `record` is the settlement
// state of that month: none, a record of its own month (run, allocation
// change or direct transfer), or an obligation that protects its whole
// project. The route answers only a request whose bearer token equals a
// configured Pages secret; anything else is the API's not-found answer. Its
// answer names the month or the project and nothing else (the model has no
// amount or recipient). The generator asks once, and only when the release
// gave it both the address and a token. A good answer is added to the
// committed list; a refused or failed read is one warning and the committed
// list alone. The generator holds the candidate when either list covers it.
// The import guard reads the settlement tables itself, after the read, and
// refuses a batch that still changes a protected award, so a payment recorded
// after the read, a missing secret and a failed read all fail closed there.
// Asking never changes a settlement record. The model does not prove that
// the SQL statements bind these meanings; the route's test compares its
// answer with the import predicate on migrated tables.
module api_protected_point_months {
  type S = {
    // Pages secret configured; the release holds the address and a token,
    // and whether that token is the configured one.
    secret: bool, configured: bool, tokenRight: bool,
    // Settlement record of the candidate's month: none, month, project.
    record: str,
    // The committed list names the month.
    committed: bool,
    // The generator's run: start, read, held, imported.
    phase: str,
    // The read: none, skipped, answer, failed; and what a good answer named.
    read: str, named: str, warnings: int,
    // The candidate change is held back from the batch.
    held: bool,
    // The import: none, accepted, refused; and whether the published award
    // changed while a settlement record protected it.
    imported: str, changedProtected: bool
  }
  var s: S
  action init = s' = {
    secret: false, configured: false, tokenRight: false, record: "none",
    committed: false, phase: "start", read: "none", named: "none", warnings: 0,
    held: false, imported: "none", changedProtected: false
  }
  // The operator creates or removes the Pages secret, and the Actions secret
  // the release passes on; the two can differ.
  action configureSecret(on: bool): bool = all {
    s.phase != "imported", s' = s.with("secret", on) }
  action configureRelease(on: bool, right: bool): bool = all {
    s.phase == "start",
    s' = s.with("configured", on).with("tokenRight", on and right) }
  // A payment is recorded at any time before the import; records are permanent.
  action recordPayment(kind: str): bool = all {
    s.phase != "imported", s.record == "none", s' = s.with("record", kind) }
  // A maintainer adds the month to the committed list before the release.
  action commitMonth = all { s.phase == "start", s' = s.with("committed", true) }
  // The generator's single read. `transport` is false for a timeout, a
  // redirect, a server failure or an invalid answer.
  action readRoute(transport: bool): bool = all {
    s.phase == "start",
    if (not(s.configured))
      s' = s.with("phase", "read").with("read", "skipped")
    else if (s.secret and s.tokenRight and transport)
      s' = s.with("phase", "read").with("read", "answer").with("named", s.record)
    else
      s' = s.with("phase", "read").with("read", "failed")
        .with("warnings", s.warnings + 1)
  }
  // The hold uses the committed list and, when the read answered, its answer.
  action hold = all {
    s.phase == "read",
    s' = s.with("phase", "held")
      .with("held", s.committed or s.named != "none")
  }
  // The atomic import reads the settlement record itself.
  action importBatch = all {
    s.phase == "held",
    if (s.held)
      s' = s.with("phase", "imported").with("imported", "accepted")
    else if (s.record != "none")
      s' = s.with("phase", "imported").with("imported", "refused")
    else
      s' = s.with("phase", "imported").with("imported", "accepted")
  }
  // Negative control only: an import without its guard.
  action unguardedImport = all {
    s.phase == "held",
    s' = s.with("phase", "imported").with("imported", "accepted")
      .with("changedProtected", not(s.held) and s.record != "none")
  }
  action step = any {
    nondet on = Bool.oneOf()
    configureSecret(on),
    nondet on = Bool.oneOf()
    nondet right = Bool.oneOf()
    configureRelease(on, right),
    nondet kind = Set("month", "project").oneOf()
    recordPayment(kind),
    commitMonth,
    nondet transport = Bool.oneOf()
    readRoute(transport),
    hold,
    importBatch,
  }
  val invariant = all {
    // A protected award never changes in the published journal.
    not(s.changedProtected),
    // The route names something only in an answer, and an answer needs the
    // configured release; a skipped or failed read names nothing.
    s.named != "none" implies s.read == "answer",
    s.read == "answer" implies s.configured and s.tokenRight,
    // One warning for a failed read, none otherwise.
    s.warnings == (if (s.read == "failed") 1 else 0),
    // Without the release configuration nothing is asked or warned.
    not(s.configured) implies (s.read == "none" or s.read == "skipped"),
    // The candidate is held only by one of the two lists.
    s.held implies (s.committed or s.named != "none"),
    // A refusal means an unheld change met a settlement record.
    s.imported == "refused" implies (not(s.held) and s.record != "none"),
    Set(0, 1).contains(s.warnings),
  }
  run fileOnlyWithoutConfigurationTest = init.then(recordPayment("month")).then(commitMonth)
    .then(readRoute(true)).expect(s.read == "skipped" and s.warnings == 0)
    .then(hold).expect(s.held).then(importBatch)
    .expect(s.imported == "accepted" and invariant)
  run routeNamesAnUncommittedMonthTest = init.then(configureSecret(true))
    .then(configureRelease(true, true)).then(recordPayment("month"))
    .then(readRoute(true)).expect(s.read == "answer" and s.named == "month")
    .then(hold).expect(s.held).then(importBatch)
    .expect(s.imported == "accepted" and s.warnings == 0 and invariant)
  run routeNamesAWholeProjectTest = init.then(configureSecret(true))
    .then(configureRelease(true, true)).then(recordPayment("project"))
    .then(readRoute(true)).expect(s.named == "project")
    .then(hold).expect(s.held).then(importBatch)
    .expect(s.imported == "accepted" and invariant)
  run unprotectedMonthPublishesTest = init.then(configureSecret(true))
    .then(configureRelease(true, true)).then(readRoute(true))
    .expect(s.read == "answer" and s.named == "none")
    .then(hold).expect(not(s.held)).then(importBatch)
    .expect(s.imported == "accepted" and invariant)
  run unsetSecretIsNotFoundAndOneWarningTest = init.then(configureRelease(true, true))
    .then(recordPayment("month")).then(readRoute(true))
    .expect(s.read == "failed" and s.named == "none" and s.warnings == 1)
    .then(hold).expect(not(s.held)).then(importBatch)
    .expect(s.imported == "refused" and invariant)
  run wrongTokenIsNotFoundTest = init.then(configureSecret(true))
    .then(configureRelease(true, false)).then(recordPayment("project"))
    .then(readRoute(true)).expect(s.read == "failed" and s.named == "none")
    .then(hold).then(importBatch).expect(s.imported == "refused" and invariant)
  run failedReadFallsBackToTheCommittedListTest = init.then(configureSecret(true))
    .then(configureRelease(true, true)).then(recordPayment("month")).then(commitMonth)
    .then(readRoute(false)).expect(s.read == "failed" and s.warnings == 1)
    .then(hold).expect(s.held).then(importBatch)
    .expect(s.imported == "accepted" and invariant)
  run paymentRecordedAfterTheReadIsRefusedByTheImportTest = init.then(configureSecret(true))
    .then(configureRelease(true, true)).then(readRoute(true)).expect(s.named == "none")
    .then(recordPayment("month")).then(hold).expect(not(s.held))
    .then(importBatch).expect(s.imported == "refused" and invariant)
  run removedSecretClosesTheRouteTest = init.then(configureSecret(true))
    .then(configureRelease(true, true)).then(configureSecret(false))
    .then(recordPayment("month")).then(readRoute(true))
    .expect(s.read == "failed" and s.named == "none" and invariant)
  run askingChangesNoSettlementRecordTest = init.then(configureSecret(true))
    .then(configureRelease(true, true)).then(recordPayment("project"))
    .then(readRoute(true)).expect(s.record == "project" and not(s.committed) and invariant)
  run unguardedImportNegativeControlTest = init.then(configureRelease(true, true))
    .then(recordPayment("month")).then(readRoute(true)).then(hold)
    .then(unguardedImport).expect(not(invariant))
}
