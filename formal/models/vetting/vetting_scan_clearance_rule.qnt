// @source scripts/qualify-vetting-review.ts
// @source workers/vetting/review-coverage.ts
// @source workers/vetting/review-plan.ts
// @source workers/vetting/scanners.ts
// @source workers/vetting/bounded-scan.ts
// @source backend/vetting/scan-result.ts
// Admission clearance (PRD section 8, operator decision of 19 November 2026).
// One reviewer reason at a time is resolved against what the scanner supplied:
// content supplied to the call and not reviewed keeps the area partial, content
// another batch or a deterministic check covered resolves it, and content
// outside the acquired revision is advisory. A partial area with no reason, or a
// missing area, never resolves. Clean needs no scanner gap, no unreleased
// artifact, no deterministic high finding, a completed primary, a completed
// specialist when escalated, no suspected malice or high/critical model
// finding, and every area complete or outside the revision. Info, low and
// medium findings are advisory. Severities: 0 none, 1 info, 2 low, 3 medium,
// 4 high, 5 critical. Coverage: 0 complete, 1 outside, 2 partial, 3 missing.
module vetting_scan_clearance_rule {
  var s: { scannerGap: bool, unreleased: bool, deterministicHigh: bool,
    flagged: bool, primary: int, primaryMalice: bool, primarySeverity: int,
    primaryCoverage: int, specialist: int, specialistMalice: bool,
    specialistSeverity: int, specialistCoverage: int, result: str }
  // Review stage: 0 not run, 1 completed, 2 failed.
  action init = s' = { scannerGap: false, unreleased: false,
    deterministicHigh: false, flagged: false, primary: 0, primaryMalice: false,
    primarySeverity: 0, primaryCoverage: 0, specialist: 0,
    specialistMalice: false, specialistSeverity: 0, specialistCoverage: 0,
    result: "none" }
  // How one reason resolves: kind 0 supplied here and unreviewed, 1 reviewed
  // elsewhere or deterministic, 2 outside the revision. No reason is -1.
  pure def resolvedCoverage(state: int, reason: int): int =
    if (state == 0) 0
    else if (state == 3) 3
    else if (reason == -1 or reason == 0) 2
    else if (reason == 1) 0
    else 1
  val escalated = s.flagged or s.unreleased or s.deterministicHigh
    or s.primarySeverity > 0 or s.primaryMalice or s.primaryCoverage > 0
  pure def serious(malice: bool, severity: int): bool = malice or severity >= 4
  val clearable = all {
    not(s.scannerGap), not(s.unreleased), not(s.deterministicHigh),
    s.primary == 1, not(serious(s.primaryMalice, s.primarySeverity)),
    s.primaryCoverage <= 1,
    escalated implies all { s.specialist == 1,
      not(serious(s.specialistMalice, s.specialistSeverity)),
      s.specialistCoverage <= 1 },
  }
  action inspect(gap: bool, unreleased: bool, high: bool, flagged: bool): bool = all {
    s.result == "none", s.primary == 0,
    s' = s.with("scannerGap", gap).with("unreleased", unreleased)
      .with("deterministicHigh", high).with("flagged", flagged or high) }
  action reviewPrimary(completed: bool, malice: bool, severity: int, state: int, reason: int): bool = all {
    s.result == "none", s.primary == 0,
    s' = s.with("primary", if (completed) 1 else 2).with("primaryMalice", malice)
      .with("primarySeverity", severity)
      .with("primaryCoverage", resolvedCoverage(state, reason)) }
  action reviewSpecialist(completed: bool, malice: bool, severity: int, state: int, reason: int): bool = all {
    s.result == "none", s.primary == 1, s.specialist == 0, escalated,
    s' = s.with("specialist", if (completed) 1 else 2).with("specialistMalice", malice)
      .with("specialistSeverity", severity)
      .with("specialistCoverage", resolvedCoverage(state, reason)) }
  action publish = all { s.result == "none", s.primary > 0,
    s' = s.with("result", if (clearable) "clean" else "incomplete") }
  action step = {
    nondet completed = Set(false, true).oneOf()
    nondet malice = Set(false, true).oneOf()
    // Low and info share one advisory class (2); high and critical one
    // blocking class (4). Coverage 1 is only ever a resolved state.
    nondet severity = Set(0, 2, 3, 4).oneOf()
    nondet state = Set(0, 2, 3).oneOf()
    nondet reason = (-1).to(2).oneOf()
    nondet gap = Set(false, true).oneOf()
    nondet unreleased = Set(false, true).oneOf()
    nondet high = Set(false, true).oneOf()
    nondet flagged = Set(false, true).oneOf()
    any { inspect(gap, unreleased, high, flagged), reviewPrimary(completed, malice, severity, state, reason),
      reviewSpecialist(completed, malice, severity, state, reason), publish, s' = s }
  }
  val invariant = s.result == "clean" implies all {
    not(s.scannerGap), not(s.unreleased), not(s.deterministicHigh),
    s.primary == 1, not(s.primaryMalice), s.primarySeverity <= 3,
    s.primaryCoverage <= 1,
    escalated implies all { s.specialist == 1, not(s.specialistMalice),
      s.specialistSeverity <= 3, s.specialistCoverage <= 1 },
  }
  run advisoryFindingsAndOutsideCoverageClearTest = init
    .then(reviewPrimary(true, false, 2, 0, -1))
    .then(reviewSpecialist(true, false, 3, 2, 2))
    .then(publish).expect(s.result == "clean" and s.specialistCoverage == 1)
  run specialistHighFindingBlocksTest = init
    .then(reviewPrimary(true, false, 2, 0, -1))
    .then(reviewSpecialist(true, false, 4, 0, -1))
    .then(publish).expect(s.result == "incomplete")
  run primaryCriticalFindingBlocksTest = init
    .then(reviewPrimary(true, false, 5, 0, -1))
    .then(reviewSpecialist(true, false, 0, 0, -1))
    .then(publish).expect(s.result == "incomplete")
  run unexplainedPartialCoverageBlocksTest = init
    .then(reviewPrimary(true, false, 2, 0, -1))
    .then(reviewSpecialist(true, false, 0, 2, -1))
    .then(publish).expect(s.result == "incomplete")
  run suppliedUnreviewedContentBlocksTest = init
    .then(reviewPrimary(true, false, 0, 2, 0))
    .then(reviewSpecialist(true, false, 0, 0, -1))
    .then(publish).expect(s.result == "incomplete")
  run otherBatchCoverageResolvesTest = init
    .then(reviewPrimary(true, false, 0, 2, 1))
    .expect(s.primaryCoverage == 0)
  run missingCoverageNeverResolvesTest = init
    .then(reviewPrimary(true, false, 0, 3, 2))
    .expect(s.primaryCoverage == 3)
  // A scanner gap alone does not call the specialist; it blocks clearance.
  run scannerGapBlocksTest = init.then(inspect(true, false, false, false))
    .then(reviewPrimary(true, false, 0, 0, -1))
    .then(publish).expect(s.result == "incomplete" and s.specialist == 0)
  run maliceBlocksTest = init
    .then(reviewPrimary(true, false, 2, 0, -1))
    .then(reviewSpecialist(true, true, 2, 0, -1))
    .then(publish).expect(s.result == "incomplete")
}
