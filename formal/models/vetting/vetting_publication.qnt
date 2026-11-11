// @source migrations/0074_vetting_publication_journal.sql
// @source workers/vetting/publication.ts
// @source workers/vetting/publication-journal.ts
// workers/vetting/publication.ts and publication-journal.ts.
// One assessment/digest; journal reserve wins once before HTTP is attempted.
// Lost responses stay unknown; a retry never sends a second result.
module vetting_publication {
  var s: { prepared: bool, approved: bool, evidence: bool, reserved: bool,
    sends: int, outcome: str, serverCommitted: bool, state: str }
  action init = s' = { prepared: false, approved: false, evidence: false,
    reserved: false, sends: 0, outcome: "none", serverCommitted: false, state: "new" }
  action prepare = all { s.state == "new", s' = s.with("prepared", true).with("state", "prepared") }
  action approve = all { s.prepared, s' = s.with("approved", true) }
  action retainEvidence = s' = s.with("evidence", true)
  action reserve = all { s.prepared, s.approved, s.evidence, not(s.reserved),
    s' = s.with("reserved", true).with("state", "reserved") }
  action send = all { s.state == "reserved", s.sends == 0,
    s' = s.with("sends", 1).with("state", "sending") }
  action accepted = all { s.state == "sending",
    s' = s.with("serverCommitted", true).with("outcome", "accepted").with("state", "recorded") }
  action rejected = all { s.state == "sending",
    s' = s.with("outcome", "rejected").with("state", "recorded") }
  action loseResponse(committed) = all { s.state == "sending",
    s' = s.with("serverCommitted", committed).with("outcome", "unknown").with("state", "recorded") }
  action retry = all { s.reserved, s' = s }
  action step = {
    nondet committed = Set(false, true).oneOf()
    any { prepare, approve, retainEvidence, reserve, send, accepted, rejected, loseResponse(committed), retry }
  }
  val invariant = all {
    s.sends <= 1,
    (s.sends > 0) implies all { s.reserved, s.approved, s.prepared, s.evidence },
    (s.outcome == "accepted") implies s.serverCommitted,
    (s.outcome != "none") implies s.reserved,
  }
  run lostAcceptedResponseTest = init.then(prepare).then(approve).then(retainEvidence)
    .then(reserve).then(send).then(loseResponse(true)).then(retry)
    .expect(s.outcome == "unknown" and s.sends == 1 and s.serverCommitted)
  run rejectedIsNotRetriedTest = init.then(prepare).then(approve).then(retainEvidence)
    .then(reserve).then(send).then(rejected).then(retry)
    .expect(s.outcome == "rejected" and s.sends == 1)
  run crashAfterReservationTest = init.then(prepare).then(approve).then(retainEvidence)
    .then(reserve).then(retry).expect(s.sends == 0 and s.reserved)
}
