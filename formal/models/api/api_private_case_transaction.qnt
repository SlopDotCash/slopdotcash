// @source backend/security/handler.ts
// @source backend/security/report-intake.ts
// @source backend/security/verified-intake.ts
// @source backend/security/analysis.ts
// @source migrations/0026_private_security_cases.sql
// @source migrations/0101_durable_security_intake.sql
// @source backend/security/case-store.ts
// Case + intake CAS composition, with report-version, analysis, assigned role,
// human decision, refusal appeal and later funded obligation. Three report
// versions/eight case revisions are bounds. Repository role proof is assumed;
// assigned triager revocation is an actual case mutation, not an external fact.
// Appeals follow handler.ts allowedActions: a duplicate, out-of-scope or
// rejected finding, or a confirmed finding whose award is ineligible or
// capacity-exhausted. The appeal remembers `from` (appeal_from_state); an
// independent reviewer (one is available, `reviewerUsed`) upholds it, which
// restores `from`, or returns it, which reopens triage and turns only an
// ineligible award back into pending. "reserved" is a confirmed case that
// held a reservation before discretionary awards (`legacyReservation`, the
// earlier writer): awardOpen accepts it, an amount approves it, while no
// award, a new decision (planDecision: reserved or approved) and an appeal
// are refused.
module api_private_case_transaction {
  var s: { revision: int, intakeRevision: int, reportVersion: int, events: int,
    receipt: str, award: str, appeal: bool, from: str, assigned: bool, screening: str,
    ownerRead: int, ownerReport: int, reporterRead: int, reporterCase: int,
    triagerRead: int, attemptVersion: int, analysisVersion: int,
    decisionVersion: int, receiptIdentity: int, reviewerUsed: bool }
  action init = s' = {revision: 1, intakeRevision: 1, reportVersion: 1, events: 0,
    receipt: "received", award: "pending", appeal: false, from: "none", assigned: true, screening: "needs-information",
    ownerRead: 0, ownerReport: 0, reporterRead: 0, reporterCase: 0,
    triagerRead: 0, attemptVersion: 0, analysisVersion: 0,
    decisionVersion: 0, receiptIdentity: 1, reviewerUsed: false}
  val open = Set("received", "needs-information", "triaging").contains(s.receipt)
  val refusals = Set("duplicate", "out-of-scope", "rejected")
  val appealable = not(s.appeal) and (refusals.contains(s.receipt)
    or (s.receipt == "confirmed" and Set("ineligible", "capacity-exhausted").contains(s.award)))
  action readOwner = s' = s.with("ownerRead", s.revision).with("ownerReport", s.reportVersion)
  action readReporter = s' = s.with("reporterRead", s.intakeRevision).with("reporterCase", s.revision)
  action readTriager = all { s.assigned, s' = s.with("triagerRead", s.revision) }
  action revise = all { open, not(obligation), s.reportVersion < 3, s.revision < 8, s.intakeRevision < 8,
    Set("needs-information", "spam", "unavailable").contains(s.screening) or s.receipt == "needs-information",
    s.reporterRead == s.intakeRevision, s.reporterCase == s.revision,
    s' = s.with("reportVersion", s.reportVersion + 1).with("intakeRevision", s.intakeRevision + 1)
      .with("revision", s.revision + 1).with("events", s.events + 1).with("analysisVersion", 0).with("decisionVersion", 0).with("screening", "queued") }
  action startScreening = all { s.screening == "queued", s.intakeRevision < 8,
    s' = s.with("screening", "running").with("intakeRevision", s.intakeRevision + 1) }
  action finishScreening(needsInformation: bool): bool = all { s.screening == "running", s.intakeRevision < 8,
    s' = s.with("screening", if (needsInformation) "needs-information" else "legitimate").with("intakeRevision", s.intakeRevision + 1) }
  action startAnalysis = all { open, s' = s.with("attemptVersion", s.reportVersion) }
  action finishAnalysis = all { open, s.attemptVersion == s.reportVersion,
    s' = s.with("analysisVersion", s.reportVersion) }
  val obligation = Set("reserved", "approved").contains(s.award)
  action decide(outcome: str): bool = all { open, not(obligation), s.ownerRead == s.revision,
    s.revision < 8, outcome.in(refusals.union(Set("confirmed"))),
    s' = s.with("receipt", outcome)
      .with("award", if (outcome == "confirmed") "pending" else "ineligible")
      .with("decisionVersion", s.ownerReport).with("revision", s.revision + 1).with("events", s.events + 1) }
  action requestInformation = all { open, s.assigned, s.triagerRead == s.revision, s.revision < 8,
    s' = s.with("receipt", "needs-information").with("revision", s.revision + 1).with("events", s.events + 1) }
  action revokeTriager = all { s.assigned, s.revision < 8,
    s' = s.with("assigned", false).with("revision", s.revision + 1).with("events", s.events + 1) }
  val awardOpen = s.receipt == "confirmed" and Set("pending", "capacity-exhausted", "reserved").contains(s.award)
  // A historical reservation made under the earlier award flow.
  action legacyReservation = all { s.receipt == "confirmed", s.award == "pending", s.revision < 8,
    s' = s.with("award", "reserved").with("revision", s.revision + 1).with("events", s.events + 1) }
  action declineAward = all { awardOpen, s.award != "reserved", s.ownerRead == s.revision, s.revision < 8,
    s' = s.with("award", "ineligible").with("revision", s.revision + 1).with("events", s.events + 1) }
  // An unfunded amount waits for capacity.
  action shortAward = all { awardOpen, s.award == "pending", s.ownerRead == s.revision, s.revision < 8,
    s' = s.with("award", "capacity-exhausted").with("revision", s.revision + 1).with("events", s.events + 1) }
  action appeal = all { appealable, s.revision < 8,
    s' = s.with("appeal", true).with("from", s.receipt).with("receipt", "disputed")
      .with("revision", s.revision + 1).with("events", s.events + 1) }
  action upholdAppeal = all { s.appeal, not(s.reviewerUsed), s.revision < 8,
    s' = s.with("appeal", false).with("receipt", s.from)
      .with("reviewerUsed", true).with("revision", s.revision + 1).with("events", s.events + 1) }
  action returnAppeal = all { s.appeal, not(s.reviewerUsed), s.revision < 8,
    s' = s.with("appeal", false).with("receipt", "triaging")
      .with("award", if (s.award == "ineligible") "pending" else s.award)
      .with("reviewerUsed", true).with("revision", s.revision + 1).with("events", s.events + 1) }
  action award = all { awardOpen, s.ownerRead == s.revision, s.revision < 8,
    s' = s.with("award", "approved").with("revision", s.revision + 1).with("events", s.events + 1) }
  action step = any { readOwner, readReporter, readTriager, revise, startScreening, finishScreening(true), finishScreening(false), startAnalysis, finishAnalysis,
    decide("confirmed"), decide("rejected"), decide("duplicate"), decide("out-of-scope"),
    requestInformation, revokeTriager, legacyReservation, declineAward, shortAward, appeal, upholdAppeal, returnAppeal,
    award, s' = s }
  val invariant = all { s.receiptIdentity == 1, s.revision == s.events + 1,
    s.reportVersion <= s.intakeRevision,
    s.analysisVersion != 0 implies s.analysisVersion == s.reportVersion,
    s.decisionVersion != 0 implies s.decisionVersion == s.reportVersion,
    s.award == "approved" implies s.receipt == "confirmed" and s.decisionVersion == s.reportVersion,
    s.award == "reserved" implies s.receipt == "confirmed",
    (s.appeal) iff (s.receipt == "disputed"),
    s.appeal implies (refusals.contains(s.from) or (s.from == "confirmed"
      and Set("ineligible", "capacity-exhausted").contains(s.award))),
    // A refusal never leaves an award open, and an open receipt has no refusal.
    refusals.contains(s.receipt) implies s.award == "ineligible" }
  run revisedReportWinsDecisionRaceTest = init.then(readOwner).then(readReporter).then(revise).then(decide("confirmed").fail())
  run decisionWinsReportRaceTest = init.then(readOwner).then(readReporter).then(decide("confirmed")).then(revise.fail())
  run staleAnalysisCannotAppearOnNewReportTest = init.then(startAnalysis).then(readReporter).then(revise).then(finishAnalysis.fail())
  run revocationWinsTriagerRaceTest = init.then(readTriager).then(revokeTriager).then(requestInformation.fail())
  run returnedAppealCanReviseButNeedsFreshDecisionTest = init.then(readOwner).then(decide("rejected")).then(appeal).then(returnAppeal)
    .then(readReporter).then(revise).then(readOwner).then(decide("confirmed")).expect(s.decisionVersion == 2 and s.receiptIdentity == 1)
  run screeningInvalidatesOldIntakeReadTest = init.then(readReporter).then(revise).then(readReporter)
    .then(startScreening).then(finishScreening(true)).then(revise.fail())
  run screenedReportNeedsNewInformationRequestTest = init.then(readReporter).then(revise).then(startScreening)
    .then(finishScreening(false)).then(readReporter).then(revise.fail())
  run approvedObligationCannotBeRevisedTest = init.then(readOwner).then(decide("confirmed")).then(readOwner).then(award)
    .then(readReporter).then(revise.fail())
  run duplicateAppealUpheldTest = init.then(readOwner).then(decide("duplicate")).then(appeal)
    .then(upholdAppeal).expect(s.receipt == "duplicate" and not(s.appeal) and s.award == "ineligible")
  run outOfScopeAppealReturnedTest = init.then(readOwner).then(decide("out-of-scope")).then(appeal)
    .then(returnAppeal).expect(s.receipt == "triaging" and s.award == "pending")
  run capacityWaitAppealSurvivesReturnTest = init.then(readOwner).then(decide("confirmed"))
    .then(readOwner).then(shortAward).then(appeal).then(returnAppeal)
    .expect(s.receipt == "triaging" and s.award == "capacity-exhausted")
  run declinedAwardAppealUpheldTest = init.then(readOwner).then(decide("confirmed"))
    .then(readOwner).then(declineAward).then(appeal).then(upholdAppeal)
    .expect(s.receipt == "confirmed" and s.award == "ineligible")
  run pendingAwardNotAppealableTest = init.then(readOwner).then(decide("confirmed")).then(appeal.fail())
  run legacyReservationApprovesOnlyByAmountTest = init.then(readOwner).then(decide("confirmed"))
    .then(legacyReservation).then(readOwner).then(declineAward.fail())
  run legacyReservationNotAppealableTest = init.then(readOwner).then(decide("confirmed"))
    .then(legacyReservation).then(appeal.fail())
  run legacyReservationAwardTest = init.then(readOwner).then(decide("confirmed"))
    .then(legacyReservation).then(readOwner).then(award).expect(s.award == "approved")
  run approvedAwardNotAppealableTest = init.then(readOwner).then(decide("confirmed")).then(readOwner)
    .then(award).then(appeal.fail())
}
