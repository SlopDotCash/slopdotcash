// @source src/ProjectRiskFlag.tsx
// Own flag status, submission/withdrawal, and observed pause remain distinct.
// This component currently has no mount in the application. These scenarios
// describe its dormant local abstraction, not an available user journey.
// Active flag admission/reinstatement uses the separate vetting API models.
module ui_risk_flag {
  var s: { phase: str, signedIn: bool, evidence: bool, ownFlag: bool, paused: bool, busy: bool }
  action init = s' = { phase: "loading", signedIn: false, evidence: false, ownFlag: false, paused: false, busy: false }
  action signedOut = s' = s.with("phase", "signed-out").with("signedIn", false).with("busy", false)
  action loadStatus = s' = s.with("phase", "ready").with("signedIn", true)
  action writeEvidence = s' = s.with("evidence", true)
  action submit = all { s.phase == "ready", s.signedIn, s.evidence, not(s.ownFlag), not(s.busy), s' = s.with("busy", true) }
  action recorded = all { s.busy, s' = s.with("ownFlag", true).with("busy", false) }
  action observePause = all { s.ownFlag, s' = s.with("paused", true) }
  action withdraw = all { s.signedIn, s.ownFlag, not(s.busy), s' = s.with("ownFlag", false) }
  action failure = s' = s.with("phase", "error").with("busy", false)
  action step = any { signedOut, loadStatus, writeEvidence, submit, recorded, observePause, withdraw, failure, s' = s }
  val invariant = s.busy implies all { s.signedIn, s.evidence, s.phase == "ready" }
  run pauseSurvivesWithdrawalTest = init.then(loadStatus).then(writeEvidence).then(submit).then(recorded).then(observePause).then(withdraw).expect(s.paused and not(s.ownFlag))
  run signedOutTest = init.then(signedOut).expect(not(s.busy) and not(s.signedIn))
}
