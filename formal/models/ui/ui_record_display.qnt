// @source src/CyclePages.tsx
// @source src/SecurityBounty.tsx
// @source src/FundingStatus.tsx
// @source src/PaymentRecords.tsx
// @source src/PayoutRows.tsx
// @source src/ProjectLeaderboard.tsx
// @source src/PointsRules.tsx
// @source src/PublicPages.tsx
// @source src/SecurityOffer.tsx
// @source src/OwnerPresentation.tsx
// @source src/VaultPaymentHistory.tsx
// @source src/ChainIcon.tsx
// @source src/Logo.tsx
// Derived record labels do not promote projected/reserved/submitted money to verified payment.
module ui_record_display {
  var s: { lifecycle: str, evidence: bool, paidLabel: bool, empty: bool, failed: bool, reportVersion:int, reportHistory:List[int] }
  action init = s' = { lifecycle: "projected", evidence: false, paidLabel: false, empty: false, failed: false, reportVersion:1, reportHistory:List(1) }
  action reserve = all { s.lifecycle == "projected", s' = s.with("lifecycle", "reserved") }
  action submit = all { s.lifecycle == "reserved", s' = s.with("lifecycle", "submitted") }
  action finalizedEvidence = all { s.lifecycle == "submitted", s' = s.with("evidence", true) }
  action displayPaid = all { s.evidence, s' = s.with("lifecycle", "paid").with("paidLabel", true) }
  action emptyResult = all { not(s.failed), s' = s.with("empty", true) }
  action readFailure = s' = s.with("failed", true).with("empty", false)
  // A refreshed case projects the immutable report-revised event; it grants no award.
  action reportRevised = all {s.reportVersion==1, s'=s.with("reportVersion",2).with("reportHistory",s.reportHistory.append(2))}
  action step = any { reportRevised, reserve, submit, finalizedEvidence, displayPaid, emptyResult, readFailure, s' = s }
  val invariant = all { s.paidLabel implies s.evidence, s.failed implies not(s.empty), s.reportHistory.nth(s.reportHistory.length()-1)==s.reportVersion }
  run reportRevisionHistoryTest = init.then(reportRevised).expect(s.reportHistory==List(1,2) and not(s.paidLabel))
  run noPrematurePaidTest = init.then(reserve).then(submit).expect(not(s.paidLabel))
  run verifiedTest = init.then(reserve).then(submit).then(finalizedEvidence).then(displayPaid).expect(s.paidLabel)
  run failureNotEmptyTest = init.then(emptyResult).then(readFailure).expect(not(s.empty))
}
