// @source migrations/0069_security_appeal_triages.sql
// @source migrations/0110_security_analysis_report_version.sql
// @source backend/security/analysis.ts
// @source backend/security/report-analysis.ts
// @source backend/security/report-intake.ts
module api_private_assessment {
  var s: {reportVersion: int, attemptVersion: int, state: str, humanDecision: bool, publishedVersion: int, attempts: int}
  action init = s' = {reportVersion: 1, attemptVersion: 0, state: "queued", humanDecision: false, publishedVersion: 0, attempts: 0}
  action start = all { Set("queued", "failed", "unavailable").contains(s.state), s.attempts < 2, not(s.humanDecision),
    s' = s.with("attemptVersion", s.reportVersion).with("state", "running").with("attempts", s.attempts + 1) }
  action revise = all { s.reportVersion == 1, s' = s.with("reportVersion", 2).with("state", "queued").with("publishedVersion", 0).with("humanDecision", false) }
  action complete = all { s.state == "running", s.attemptVersion == s.reportVersion, not(s.humanDecision),
    s' = s.with("state", "complete").with("publishedVersion", s.reportVersion) }
  action unavailable = all { s.state == "running", s' = s.with("state", "unavailable") }
  action humanDecision = s' = s.with("humanDecision", true).with("state", "reviewed")
  action obsolete = s' = s
  action step = any { start, revise, complete, unavailable, humanDecision, obsolete, s' = s }
  val invariant = all { s.publishedVersion != 0 implies s.publishedVersion == s.reportVersion,
    s.humanDecision implies s.state == "reviewed", s.attempts <= 2 }
  run staleResultTest = init.then(start).then(revise).then(obsolete).expect(s.publishedVersion == 0)
  run humanWinsTest = init.then(start).then(humanDecision).then(obsolete).expect(s.state == "reviewed")
  run retryTest = init.then(start).then(unavailable).then(start).then(complete).expect(s.publishedVersion == 1)
}
