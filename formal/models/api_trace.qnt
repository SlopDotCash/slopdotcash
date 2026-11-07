// @source migrations/0006_private_intake_status.sql
// @source migrations/0001_private_trace_backend.sql
// @source migrations/0005_atomic_trace_attachment.sql
// @source migrations/0058_trace_write_reservations.sql
// @source backend/trace/handler.ts
// @source backend/trace/cloudflare-persistence.ts
// @source backend/trace/contracts.ts
// @source backend/trace/auth.ts
// @source backend/trace/validation.ts
module api_trace {
  var s: {phase: str, intent: str, object: bool, attachment: bool, grant: str, reads: int, audits: int, events: int, intakeReady: bool}
  action init = s' = {phase: "awaiting_trace", intent: "absent", object: false, attachment: false, grant: "absent", reads: 0, audits: 0, events: 0, intakeReady: false}
  action verifyIntake = s' = s.with("intakeReady", true)
  action disableIntake = s' = s.with("intakeReady", false)
  action reserve = all { s.phase != "finalized", s.intent == "absent", s' = s.with("intent", "live") }
  action putBytes = all { s.intakeReady, s.intent == "live", s' = s.with("object", true) }
  action expire = all { s.intent == "live", s' = s.with("intent", "expired") }
  action attach = all { s.intent == "live", s.object, s.phase != "finalized",
    s' = s.with("attachment", true).with("intent", "spent").with("phase", "trace_uploaded") }
  action finalize = all { s.attachment, s' = s.with("phase", "finalized") }
  // Contributor progress is immutable after run finalization.
  action event = all { s.phase != "finalized", s.events < 2, s' = s.with("events", s.events + 1) }
  action grant(operator: bool): bool = all { operator, s.attachment, s.grant == "absent", s' = s.with("grant", "live").with("audits", s.audits + 1) }
  action read(operator: bool): bool = all { operator, s.grant == "live", s' = s.with("grant", "spent").with("reads", 1).with("audits", s.audits + 1) }
  action step = any { verifyIntake, disableIntake, reserve, putBytes, expire, attach, finalize, event, grant(true), grant(false), read(true), read(false), s' = s }
  val invariant = all { s.phase == "finalized" implies (s.object and s.attachment), s.reads <= 1, s.reads < s.audits or s.reads == 0 }
  run traceTest = init.then(verifyIntake).then(reserve).then(putBytes).then(attach).then(event).then(finalize).expect(s.phase == "finalized" and s.events == 1)
  run orphanTest = init.then(verifyIntake).then(reserve).then(putBytes).then(expire).expect(not(s.attachment))
  run privateReadTest = init.then(verifyIntake).then(reserve).then(putBytes).then(attach).then(grant(true)).then(read(true)).expect(s.reads == 1 and s.audits == 2)
}
