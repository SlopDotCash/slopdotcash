// @source migrations/0025_community_security_vetting.sql
// @source backend/vetting/persistence.ts
// @source backend/vetting/handler.ts
// @source backend/vetting/result.ts
// @source backend/vetting/scan-result.ts
// Atomic result, artifact and enforcement commit. A failed/duplicate write
// cannot attach artifacts to a competing result or leave a partial ban.
module vetting_result_atomic {
  var s: { state: str, staged: str, phase: str, artifacts: bool,
    banned: bool, resultVersion: int, notifications: int }
  action init = s' = {state: "pending", staged: "none", phase: "idle", artifacts: false,
    banned: false, resultVersion: 0, notifications: 0}
  action prepare(kind: str): bool = all { s.state == "pending", s.phase == "idle",
    s' = s.with("staged", kind).with("phase", "staged") }
  action rollback = all { s.phase == "staged", s' = s.with("phase", "idle").with("staged", "none") }
  action commit = all { s.phase == "staged", s.state == "pending",
    s' = s.with("state", s.staged).with("phase", "idle").with("artifacts", true)
      .with("banned", s.staged == "malicious").with("resultVersion", 1)
      .with("notifications", if (s.staged == "clean") 0 else 1) }
  action duplicate = all { s.state != "pending", s' = s }
  action step = { nondet kind = Set("clean", "incomplete", "malicious").oneOf()
    any { prepare(kind), rollback, commit, duplicate, s' = s } }
  val invariant = all { s.artifacts == (s.state != "pending"), s.banned == (s.state == "malicious"),
    s.resultVersion <= 1, s.notifications <= 1 }
  run failureLeavesPendingTest = init.then(prepare("malicious")).then(rollback)
    .expect(s.state == "pending" and not(s.banned) and not(s.artifacts))
  run banCommitsWithEvidenceTest = init.then(prepare("malicious")).then(commit).then(duplicate)
    .expect(s.banned and s.artifacts and s.notifications == 1)
}
