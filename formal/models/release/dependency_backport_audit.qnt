// @source scripts/verify-dependency-audit.mjs
// @evidence scripts/verify-dependency-audit.test.ts
// A complete registry report and exact installed backports gate release.
// Byte, path, lock and consumer checks are abstracted as per-copy evidence.
module dependency_backport_audit {
  var s: {phase: str, report: str, v2: bool, v4: bool}

  action init = s' = {phase: "queued", report: "none", v2: false, v4: false}
  action audit(report) = all {
    s.phase == "queued",
    report.in(Set("clean", "known", "unexpected", "invalid")),
    s' = s.with("phase", if (report.in(Set("clean", "known"))) "inspect" else "refused")
      .with("report", report),
  }
  action inspect(v2, v4) = all {
    s.phase == "inspect",
    s' = s.with("v2", v2).with("v4", v4)
      .with("phase", if (v2 and v4) "passed" else "refused"),
  }
  action step = {
    nondet report = Set("clean", "known", "unexpected", "invalid").oneOf()
    nondet v2 = Set(false, true).oneOf()
    nondet v4 = Set(false, true).oneOf()
    any { audit(report), inspect(v2, v4), s' = s }
  }
  val invariant = all {
    s.phase == "passed" implies (s.report.in(Set("clean", "known")) and s.v2 and s.v4),
    s.report.in(Set("unexpected", "invalid")) implies s.phase == "refused",
  }

  run knownFindingNeedsBothCopiesTest = init.then(audit("known")).then(inspect(true, true))
    .expect(s.phase == "passed" and s.report == "known" and invariant)
  run missingV2RefusedTest = init.then(audit("known")).then(inspect(false, true))
    .expect(s.phase == "refused" and invariant)
  run cleanReportStillChecksV4Test = init.then(audit("clean")).then(inspect(true, false))
    .expect(s.phase == "refused" and invariant)
  run newFindingRefusedTest = init.then(audit("unexpected")).then(inspect(true, true).fail())
  run invalidReportRefusedTest = init.then(audit("invalid")).then(inspect(true, true).fail())
}
