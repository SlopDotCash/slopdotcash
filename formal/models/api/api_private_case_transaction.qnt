// @source backend/security/handler.ts
// @source backend/security/report-intake.ts
// @source backend/security/analysis.ts
// @source migrations/0026_private_security_cases.sql
// @source migrations/0101_durable_security_intake.sql
// Case + intake CAS composition, with report-version, analysis, assigned role,
// human decision, refusal appeal and later funded obligation. Three report
// versions/eight case revisions are bounds. Repository role proof is assumed;
// assigned triager revocation is an actual case mutation, not an external fact.
module api_private_case_transaction {
  var s: { revision: int, intakeRevision: int, reportVersion: int, events: int,
    receipt: str, award: str, appeal: bool, assigned: bool, screening: str,
    ownerRead: int, ownerReport: int, reporterRead: int, reporterCase: int,
    triagerRead: int, attemptVersion: int, analysisVersion: int,
    decisionVersion: int, receiptIdentity: int, reviewerUsed: bool }
  action init = s' = {revision: 1, intakeRevision: 1, reportVersion: 1, events: 0,
    receipt: "received", award: "pending", appeal: false, assigned: true, screening: "needs-information",
    ownerRead: 0, ownerReport: 0, reporterRead: 0, reporterCase: 0,
    triagerRead: 0, attemptVersion: 0, analysisVersion: 0,
    decisionVersion: 0, receiptIdentity: 1, reviewerUsed: false}
  val open = Set("received", "needs-information", "triaging").contains(s.receipt)
  action readOwner = s' = s.with("ownerRead", s.revision).with("ownerReport", s.reportVersion)
  action readReporter = s' = s.with("reporterRead", s.intakeRevision).with("reporterCase", s.revision)
  action readTriager = all { s.assigned, s' = s.with("triagerRead", s.revision) }
  action revise = all { open, s.award != "approved", s.reportVersion < 3, s.revision < 8, s.intakeRevision < 8,
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
  action decide(confirmed: bool): bool = all { open, s.ownerRead == s.revision, s.revision < 8,
    s' = s.with("receipt", if (confirmed) "confirmed" else "rejected")
      .with("award", if (confirmed) "pending" else "ineligible")
      .with("decisionVersion", s.ownerReport).with("revision", s.revision + 1).with("events", s.events + 1) }
  action requestInformation = all { open, s.assigned, s.triagerRead == s.revision, s.revision < 8,
    s' = s.with("receipt", "needs-information").with("revision", s.revision + 1).with("events", s.events + 1) }
  action revokeTriager = all { s.assigned, s.revision < 8,
    s' = s.with("assigned", false).with("revision", s.revision + 1).with("events", s.events + 1) }
  action declineAward = all { s.receipt == "confirmed", s.award == "pending", s.ownerRead == s.revision, s.revision < 8,
    s' = s.with("award", "ineligible").with("revision", s.revision + 1).with("events", s.events + 1) }
  action appeal = all { not(s.appeal), s.receipt == "rejected" or (s.receipt == "confirmed" and s.award == "ineligible"), s.revision < 8,
    s' = s.with("appeal", true).with("receipt", "disputed").with("revision", s.revision + 1).with("events", s.events + 1) }
  action returnAppeal = all { s.appeal, not(s.reviewerUsed), s.revision < 8,
    s' = s.with("appeal", false).with("receipt", "triaging").with("award", "pending")
      .with("reviewerUsed", true).with("revision", s.revision + 1).with("events", s.events + 1) }
  action award = all { s.receipt == "confirmed", s.award == "pending", s.ownerRead == s.revision, s.revision < 8,
    s' = s.with("award", "approved").with("revision", s.revision + 1).with("events", s.events + 1) }
  action step = any { readOwner, readReporter, readTriager, revise, startScreening, finishScreening(true), finishScreening(false), startAnalysis, finishAnalysis,
    decide(true), decide(false), requestInformation, revokeTriager, declineAward, appeal, returnAppeal, award, s' = s }
  val invariant = all { s.receiptIdentity == 1, s.revision == s.events + 1,
    s.reportVersion <= s.intakeRevision,
    s.analysisVersion != 0 implies s.analysisVersion == s.reportVersion,
    s.decisionVersion != 0 implies s.decisionVersion == s.reportVersion,
    s.award == "approved" implies s.receipt == "confirmed" and s.decisionVersion == s.reportVersion }
  run revisedReportWinsDecisionRaceTest = init.then(readOwner).then(readReporter).then(revise).then(decide(true).fail())
  run decisionWinsReportRaceTest = init.then(readOwner).then(readReporter).then(decide(true)).then(revise.fail())
  run staleAnalysisCannotAppearOnNewReportTest = init.then(startAnalysis).then(readReporter).then(revise).then(finishAnalysis.fail())
  run revocationWinsTriagerRaceTest = init.then(readTriager).then(revokeTriager).then(requestInformation.fail())
  run returnedAppealCanReviseButNeedsFreshDecisionTest = init.then(readOwner).then(decide(false)).then(appeal).then(returnAppeal)
    .then(readReporter).then(revise).then(readOwner).then(decide(true)).expect(s.decisionVersion == 2 and s.receiptIdentity == 1)
  run screeningInvalidatesOldIntakeReadTest = init.then(readReporter).then(revise).then(readReporter)
    .then(startScreening).then(finishScreening(true)).then(revise.fail())
  run screenedReportNeedsNewInformationRequestTest = init.then(readReporter).then(revise).then(startScreening)
    .then(finishScreening(false)).then(readReporter).then(revise.fail())
  run approvedObligationCannotBeRevisedTest = init.then(readOwner).then(decide(true)).then(readOwner).then(award)
    .then(readReporter).then(revise.fail())
}
