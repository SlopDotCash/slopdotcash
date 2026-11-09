// @source backend/vetting/evidence.ts
// Native download terminal arbitration only. Two parts represent the bounded
// stream; each part verification is abstracted. A terminal audit can fail or
// remain pending. Server finish never proves the browser saved any bytes.
module vetting_download_stream {
  var s: { phase: str, intent: str, reader: str, sent: int, consumed: bool,
    attempts: int, audits: Set[str] }
  action init = s' = {phase: "grant", intent: "none", reader: "waiting", sent: 0,
    consumed: false, attempts: 0, audits: Set()}
  action authorize = all { s.phase == "grant",
    s' = s.with("phase", "open").with("reader", "reading").with("consumed", true) }
  action sendVerifiedPart = all { s.phase == "open", s.sent < 2,
    s' = s.with("sent", s.sent + 1) }
  action claimFinish = all { s.phase == "open", s.sent == 2,
    s' = s.with("phase", "finishing").with("intent", "finished").with("attempts", 1) }
  action claimFailure = all { s.phase == "open",
    s' = s.with("phase", "failing").with("intent", "failed").with("attempts", 1) }
  action cancel = all { s.reader == "reading",
    s' = if (s.phase == "open")
      s.with("phase", "cancelling").with("intent", "cancelled").with("reader", "cancelled").with("attempts", 1)
    else s.with("reader", "cancelled") }
  val auditPending = Set("finishing", "failing", "cancelling").contains(s.phase)
  action auditSuccess = all { auditPending,
    s' = s.with("phase", "closed").with("audits", Set(s.intent)).with("reader",
      if (s.reader == "cancelled") "cancelled" else if (s.intent == "finished") "closed" else "error") }
  action auditFailure = all { auditPending,
    s' = s.with("phase", "closed").with("reader", if (s.reader == "cancelled") "cancelled" else "error") }
  action step = any { authorize, sendVerifiedPart, claimFinish, claimFailure,
    cancel, auditSuccess, auditFailure, s' = s }
  val invariant = all { s.attempts <= 1, s.audits.size() <= s.attempts,
    s.intent == "finished" implies s.sent == 2,
    s.reader == "closed" implies s.audits == Set("finished"),
    s.phase != "grant" implies s.consumed }
  run finishAuditThenCancelTest = init.then(authorize).then(sendVerifiedPart).then(sendVerifiedPart)
    .then(claimFinish).then(cancel).then(auditSuccess)
    .expect(s.audits == Set("finished") and s.reader == "cancelled" and s.attempts == 1)
  run cancelBeforeFinishTest = init.then(authorize).then(sendVerifiedPart).then(cancel).then(auditSuccess)
    .expect(s.audits == Set("cancelled") and s.sent == 1).then(claimFinish.fail())
  run failureAuditThenCancelTest = init.then(authorize).then(claimFailure).then(cancel).then(auditSuccess)
    .expect(s.audits == Set("failed") and s.reader == "cancelled" and s.attempts == 1)
  run failedFinishAuditErrorsStreamTest = init.then(authorize).then(sendVerifiedPart).then(sendVerifiedPart)
    .then(claimFinish).then(auditFailure).expect(s.reader == "error" and s.audits.size() == 0 and s.consumed)
}
