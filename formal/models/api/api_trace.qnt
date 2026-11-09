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
  // The grant/read endpoints were removed. Historical grant/audit rows may
  // remain, but no actor can turn them into an application trace-body read.
  var s: {phase: str, intent: str, object: bool, attachment: bool, legacyHistoryIntact: bool, removedRequests: int, reads: int, events: int, intakeReady: bool}
  action init = s' = {phase: "awaiting_trace", intent: "absent", object: false, attachment: false, legacyHistoryIntact: true, removedRequests: 0, reads: 0, events: 0, intakeReady: false}
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
  // Canonical former trace grant/read requests miss matchAuthenticatedRoute and
  // return 404 before actor authorization, including an operator's request.
  action removedRoute = all { s.removedRequests < 2,
    s' = s.with("removedRequests", s.removedRequests + 1) }
  action step = any { verifyIntake, disableIntake, reserve, putBytes, expire, attach, finalize, event, removedRoute, s' = s }
  val invariant = all { s.phase == "finalized" implies (s.object and s.attachment), s.reads == 0, s.legacyHistoryIntact }
  run traceTest = init.then(verifyIntake).then(reserve).then(putBytes).then(attach).then(event).then(finalize).expect(s.phase == "finalized" and s.events == 1)
  run orphanTest = init.then(verifyIntake).then(reserve).then(putBytes).then(expire).expect(not(s.attachment))
  run retiredGrantAndReadRemainUnavailableTest = init.then(verifyIntake).then(reserve)
    .then(putBytes).then(attach).then(removedRoute).then(removedRoute)
    .expect(s.reads == 0 and s.legacyHistoryIntact and s.removedRequests == 2)
}
