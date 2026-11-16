// @source src/lib/project-proposal.ts
// @source src/ProjectProposalPage.tsx
// @source src/ProjectSetupStatus.tsx
// @source src/PendingProjectApplications.tsx
// @source src/ProjectSecuritySettings.tsx
// @source src/SecurityProgramEditor.tsx
// @source src/ProjectFormFields.tsx
// @source src/RewardAssetFields.tsx
// Three-step draft, immutable revision save, and separate activation/readiness.
module ui_project_setup {
  var s: { step: int, valid: bool, saved: bool, authority: bool, app: bool, scan: str, active: bool, revision: int, expected: int }
  action init = s' = { step: 1, valid: false, saved: false, authority: false, app: false,
    scan: "pending", active: false, revision: 1, expected: 1 }
  action edit = s' = s.with("valid", true)
  action advance = all { s.valid, s.step < 3, s' = s.with("step", s.step + 1) }
  action back = all { s.step > 1, s' = s.with("step", s.step - 1) }
  action save = all { s.step == 3, s.valid, s.expected == s.revision,
    s' = s.with("saved", true).with("revision", 2) }
  action verifyAuthority = all { s.saved, s' = s.with("authority", true) }
  action installApp = all { s.saved, s' = s.with("app", true) }
  action scanPassed = all { s.saved, s' = s.with("scan", "passed") }
  action scanExempt = all { s.saved, s' = s.with("scan", "exempt") }
  action activate = all { s.saved, s.authority, s.app, Set("passed", "exempt").contains(s.scan), s' = s.with("active", true) }
  action conflict = all { s.expected != s.revision, s' = s }
  action step = any { edit, advance, back, save, verifyAuthority, installApp, scanPassed, scanExempt, activate, conflict, s' = s }
  val invariant = all { s.step >= 1, s.step <= 3, s.active implies all { s.saved, s.authority, s.app, s.scan != "pending" } }
  run setupTest = init.then(edit).then(advance).then(advance).then(save).then(verifyAuthority).then(installApp).then(scanPassed).then(activate).expect(s.active)
  run exemptionTest = init.then(edit).then(advance).then(advance).then(save).then(verifyAuthority).then(installApp).then(scanExempt).then(activate).expect(s.active and s.scan == "exempt")
  run revisionTest = init.then(edit).then(advance).then(advance).then(save).then(conflict).expect(s.revision == 2)
}
