// @source migrations/0059_private_security_submissions.sql
// @source migrations/0101_durable_security_intake.sql
// @source backend/security/report-intake.ts
// @source backend/security/submissions.ts
// @source backend/security/intake-grant.ts
// @source backend/security/github-advisories.ts
// @source backend/security/reporting-readiness.ts
module api_private_intake {
  var s: {phase: str, saved: bool, screening: str, reviewed: bool, attempts: int, absenceProved: bool, externalReceipt: bool, private: bool}
  action init = s' = {phase: "draft", saved: false, screening: "queued", reviewed: false, attempts: 0, absenceProved: false, externalReceipt: false, private: true}
  action save = s' = s.with("saved", true)
  action screen = all { s.saved, s.screening == "queued", s' = s.with("screening", "running") }
  action legitimate = all { s.screening == "running", s' = s.with("screening", "legitimate") }
  action held = all { s.screening == "running", s' = s.with("screening", "needs-information") }
  action humanForward = all { s.saved, s' = s.with("reviewed", true) }
  action send = all { s.saved, s.phase == "draft", s.screening == "legitimate" or s.reviewed, s.attempts < 2,
    s' = s.with("phase", "submitting").with("attempts", s.attempts + 1).with("absenceProved", false) }
  action unknown = all { s.phase == "submitting", s' = s.with("phase", "uncertain") }
  action found = all { Set("submitting", "uncertain").contains(s.phase), s' = s.with("phase", "submitted").with("externalReceipt", true) }
  action absent = all { s.phase == "uncertain", s' = s.with("absenceProved", true) }
  action retry = all { s.phase == "uncertain", s.absenceProved, s' = s.with("phase", "draft") }
  action verify = all { s.phase == "submitted", s.externalReceipt, s' = s.with("phase", "receipt-verified") }
  action step = any { save, screen, legitimate, held, humanForward, send, unknown, found, absent, retry, verify, s' = s }
  val invariant = all { s.private, s.phase != "draft" implies s.saved, s.phase == "receipt-verified" implies s.externalReceipt, s.attempts <= 2 }
  run storedReceiptTest = init.then(save).then(screen).then(held).expect(s.saved and s.phase == "draft")
  run uncertainTest = init.then(save).then(screen).then(legitimate).then(send).then(unknown).expect(s.saved and not(s.absenceProved))
    .then(absent).then(retry).then(send).then(found).then(verify).expect(s.externalReceipt and s.attempts == 2)
}
