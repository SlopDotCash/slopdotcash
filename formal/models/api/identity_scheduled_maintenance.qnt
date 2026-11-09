// @source workers/identity/index.ts
// @source workers/identity/persistence.ts
// @source workers/identity/rate-limit.ts
// @evidence scripts/identity-maintenance.test.ts
// Two later invocations, six ordered DELETE statements and one representative
// expired-row effect per stage: OAuth flows, assertions, X flows, historical
// Telegram flows, sessions, rate counters. Commit and reply are separate; a
// rejected reply may follow deletion. The boolean delete effect abstracts the
// current SQL expiry predicate, not an ability to delete live rows.
// Canonical origin runs cleanup + renewal; another valid origin runs cleanup
// only; invalid configuration rejects maintenance before cleanup. Reporting
// is an independent optional branch. Each allSettled join waits for both of
// its own children. No fairness, automatic retry, RPC freshness or host-cron
// guarantee is assumed. A second start is a separately invoked later job.
// Renewal's HTTP/token/conditional-write details live in identity_intake_renewal.
module identity_scheduled_maintenance {
  val stages = Set(1, 2, 3, 4, 5, 6)
  val origins = Set("canonical", "other", "invalid")
  var s: { invocations: int, running: bool, origin: str, cleanupPhase: str, next: int,
    committed: Set[int], completed: Set[int], deleted: Set[int], renewal: str,
    intakeEnabled: bool, intakeWrites: int, maintenance: str, reporting: str,
    reportCalls: int, result: str }
  action init = s' = { invocations: 0, running: false, origin: "other", cleanupPhase: "idle", next: 1,
    committed: Set(), completed: Set(), deleted: Set(), renewal: "absent",
    intakeEnabled: true, intakeWrites: 0, maintenance: "none", reporting: "absent", reportCalls: 0, result: "none" }
  action start(origin: str, binding: bool): bool = all {
    not(s.running), s.invocations < 2, origins.contains(origin),
    s' = s.with("invocations", s.invocations + 1).with("running", true).with("origin", origin)
      .with("cleanupPhase", if (origin == "invalid") "not-started" else "ready")
      .with("next", 1).with("committed", Set()).with("completed", Set())
      .with("renewal", if (origin == "canonical") "pending" else "absent")
      .with("maintenance", if (origin == "invalid") "failed" else "pending")
      .with("reporting", if (binding) "pending" else "absent")
      .with("reportCalls", s.reportCalls + (if (binding) 1 else 0)).with("result", "pending") }
  action cleanupCommit(removesExpiredRow: bool): bool = all {
    s.running, s.cleanupPhase == "ready", stages.contains(s.next),
    s' = s.with("cleanupPhase", "reply").with("committed", s.committed.union(Set(s.next)))
      .with("deleted", if (removesExpiredRow) s.deleted.union(Set(s.next)) else s.deleted) }
  action cleanupReply(received: bool): bool = all {
    s.running, s.cleanupPhase == "reply",
    s' = if (not(received)) s.with("cleanupPhase", "failed")
      else s.with("completed", s.completed.union(Set(s.next)))
        .with("cleanupPhase", if (s.next == 6) "done" else "ready")
        .with("next", if (s.next == 6) 6 else s.next + 1) }
  action cleanupFailure = all { s.running, s.cleanupPhase == "ready",
    s' = s.with("cleanupPhase", "failed") }
  action renewalWrite(isEnabled: bool): bool = all { s.running, s.renewal == "pending",
    s' = s.with("renewal", "committed").with("intakeEnabled", isEnabled).with("intakeWrites", s.intakeWrites + 1) }
  action renewalReply(received: bool): bool = all { s.running, s.renewal == "committed",
    s' = s.with("renewal", if (received) "renewed" else "rejected") }
  // An equal/older candidate can return renewed without replacing the existing
  // observation. This model starts with one retained observation available.
  action renewalNoop = all { s.running, s.renewal == "pending", s' = s.with("renewal", "renewed") }
  action renewalSkip = all { s.running, s.renewal == "pending", s' = s.with("renewal", "skipped") }
  action renewalFailure = all { s.running, s.renewal == "pending", s' = s.with("renewal", "rejected") }
  action joinMaintenance = all {
    s.running, s.maintenance == "pending", Set("done", "failed").contains(s.cleanupPhase),
    Set("absent", "renewed", "skipped", "rejected").contains(s.renewal),
    s' = s.with("maintenance", if (s.cleanupPhase == "done" and Set("absent", "renewed").contains(s.renewal)) "success" else "failed") }
  action reportingReply(outcome: str): bool = all {
    s.running, s.reporting == "pending", Set("ok", "failed-count", "rejected").contains(outcome),
    s' = s.with("reporting", outcome) }
  action joinOuter = all {
    s.running, Set("success", "failed").contains(s.maintenance),
    Set("absent", "ok", "failed-count", "rejected").contains(s.reporting),
    s' = s.with("running", false).with("result",
      if (s.maintenance == "success" and Set("absent", "ok").contains(s.reporting)) "success" else "failed") }
  action step = {
    nondet origin = origins.oneOf()
    nondet ok = Set(false, true).oneOf()
    nondet outcome = Set("ok", "failed-count", "rejected").oneOf()
    any { start(origin, ok), cleanupCommit(ok), cleanupReply(ok), cleanupFailure,
      renewalWrite(ok), renewalReply(ok), renewalNoop, renewalSkip, renewalFailure,
      joinMaintenance, reportingReply(outcome), joinOuter, s' = s }
  }
  val invariant = all {
    s.invocations <= 2, s.next >= 1, s.next <= 6, s.reportCalls <= s.invocations,
    s.intakeWrites <= s.invocations, s.committed.subseteq(stages), s.completed.subseteq(s.committed), s.deleted.subseteq(stages),
    s.committed.forall(stage => stages.filter(prior => prior < stage).subseteq(s.completed)),
    s.cleanupPhase == "done" implies s.completed == stages,
    s.origin != "canonical" implies s.renewal == "absent",
    s.origin == "invalid" implies s.cleanupPhase == "not-started" and s.committed == Set(),
    s.maintenance == "success" implies s.cleanupPhase == "done" and Set("absent", "renewed").contains(s.renewal),
    s.result == "success" implies not(s.running) and s.maintenance == "success" and Set("absent", "ok").contains(s.reporting) }

  run validDisabledRenewalCanCompleteScheduledJobTest = init.then(start("canonical", false))
    .then(renewalWrite(false)).then(renewalReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(joinMaintenance).then(joinOuter)
    .expect(s.result == "success" and not(s.intakeEnabled) and s.reportCalls == 0 and invariant)
  run otherOriginOnlyCleansIdentityStateTest = init.then(start("other", false))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(joinMaintenance).then(joinOuter)
    .expect(s.result == "success" and s.renewal == "absent" and s.intakeWrites == 0 and invariant)
  run invalidOriginStillLetsReportingSettleTest = init.then(start("invalid", true))
    .then(reportingReply("ok")).then(joinOuter)
    .expect(s.result == "failed" and s.committed == Set() and s.reportCalls == 1 and invariant)
  run cleanupFailureDoesNotStopRenewalCommitTest = init.then(start("canonical", false)).then(cleanupFailure)
    .then(renewalWrite(false)).then(renewalReply(true)).then(joinMaintenance).then(joinOuter)
    .expect(s.result == "failed" and s.intakeWrites == 1 and not(s.intakeEnabled) and invariant)
  run skippedRenewalDoesNotStopCleanupTest = init.then(start("canonical", false)).then(renewalSkip)
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(joinMaintenance).then(joinOuter).expect(s.result == "failed" and s.deleted == stages and invariant)
  run rejectedRenewalDoesNotStopCleanupTest = init.then(start("canonical", false)).then(renewalFailure)
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(joinMaintenance).then(joinOuter).expect(s.result == "failed" and s.deleted == stages and invariant)
  run reportingFailureDoesNotStopMaintenanceTest = init.then(start("canonical", true)).then(reportingReply("rejected"))
    .then(renewalNoop).then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(joinMaintenance).then(joinOuter)
    .expect(s.maintenance == "success" and s.result == "failed" and s.deleted == stages and invariant)
  run nonzeroReportingFailureCountFailsTheOuterJobTest = init.then(start("invalid", true))
    .then(reportingReply("failed-count")).then(joinOuter)
    .expect(s.result == "failed" and s.reporting == "failed-count" and invariant)
  run innerJoinWaitsForRenewalEvenAfterCleanupFailsTest = init.then(start("canonical", false)).then(cleanupFailure)
    .expect(s.maintenance == "pending" and s.renewal == "pending" and invariant).then(joinMaintenance.fail())
  run outerJoinWaitsForReportingEvenAfterMaintenanceFailsTest = init.then(start("invalid", true))
    .expect(s.maintenance == "failed" and s.reporting == "pending" and invariant).then(joinOuter.fail())
  run cleanupFailurePreservesCommittedPrefixTest = init.then(start("other", false))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupFailure).then(joinMaintenance).then(joinOuter)
    .expect(s.deleted == Set(1, 2) and s.committed == Set(1, 2) and s.result == "failed" and invariant)
  run lostDeleteReplyCanLeaveItsEffectCommittedTest = init.then(start("other", false))
    .then(cleanupCommit(true)).then(cleanupReply(false)).then(joinMaintenance).then(joinOuter)
    .expect(s.deleted == Set(1) and s.completed == Set() and s.result == "failed" and invariant)
  run laterInvocationRetriesAfterPartialCleanupTest = init.then(start("other", false))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupFailure).then(joinMaintenance).then(joinOuter)
    .then(start("other", false)).then(cleanupCommit(false)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(cleanupCommit(true)).then(cleanupReply(true))
    .then(cleanupCommit(true)).then(cleanupReply(true)).then(joinMaintenance).then(joinOuter)
    .expect(s.invocations == 2 and s.result == "success" and s.deleted == stages and invariant)
  run failedRenewalReplyRetainsTheCommittedObservationTest = init.then(start("canonical", false)).then(cleanupFailure)
    .then(renewalWrite(false)).then(renewalReply(false)).then(joinMaintenance).then(joinOuter)
    .expect(s.result == "failed" and s.renewal == "rejected" and not(s.intakeEnabled) and s.intakeWrites == 1 and invariant)
  run noopRenewalPreservesTheStoredObservationTest = init.then(start("canonical", false)).then(cleanupFailure)
    .then(renewalNoop).then(joinMaintenance).then(joinOuter)
    .expect(s.renewal == "renewed" and s.intakeEnabled and s.intakeWrites == 0 and invariant)
  run emptyOrLiveCleanupStageCanSucceedWithoutDeletionTest = init.then(start("other", false))
    .then(cleanupCommit(false)).then(cleanupReply(true)).then(cleanupFailure).then(joinMaintenance).then(joinOuter)
    .expect(s.completed == Set(1) and s.deleted == Set() and invariant)
  run laterInvocationRequiresFreshReportingSettlementTest = init.then(start("invalid", true))
    .then(reportingReply("ok")).then(joinOuter).then(start("invalid", true))
    .expect(s.reporting == "pending" and s.reportCalls == 2 and invariant).then(joinOuter.fail())
  run otherOriginDoesNotRunFixedSiteRenewalTest = init.then(start("other", false))
    .expect(s.renewal == "absent" and invariant).then(renewalWrite(true).fail())
}
