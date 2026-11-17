// @source backend/security/routine-decisions.ts
// @source backend/security/handler.ts
// @source backend/security/case-store.ts
// @source backend/security/report-intake.ts
// @source migrations/0133_security_routine_decisions.sql
// @evidence backend/security/routine-decisions.test.ts
// Routine decisions on one private report (PRD section 8, operator decision
// of 17 November 2026). A pass reads the report while it is "received", or
// while its own request for proof is due or has a new report version. It
// records one result: a duplicate (same digest, or both calls name the same
// earlier report), a published line (both calls name the same line), a
// request for proof with a clock, a close as no proof received when that
// clock ends with no new version, or an acknowledgement for the owner.
// combineRoutineCalls: a plausible loss of funds in either call stops every
// close and every request for proof; a duplicate or a line named by one call
// only is a disagreement; one request for proof per report. A report on
// GitHub is never closed. Three failed attempts send the report to the owner.
// `dry_run` records the decision and changes nothing; `live` applies it only
// to the revision it read, so a person's action (requestInformation, decide)
// that lands first makes the pass see the new state. An appeal of a routine
// close that no person reviewed returns the report to the owner at once
// (planChange "appeal", routineClosed) and the pass never reads an appealed
// report again; an appeal of a person's close opens the moderator path of
// api_private_case. The pass never confirms a finding and has no award or
// payment action.
// Abstracted: one report; the two calls are eight booleans; the 14-day clock
// is two ticks; the lease, per-pass and per-day limits bound work and are
// covered by the `security_routine_runs` insert and the tests; awards follow
// api_private_case. Bounds: three report versions, four ticks, three failed
// attempts. Source-only; not executed against the code.
module api_security_routine_decisions {
  type Report = { mode: str, receipt: str, appeal: str, from: str, version: int,
    asked: int, now: int, due: int, github: bool, appealed: bool, person: bool,
    routineClosed: bool, closedOnLoss: bool, closedEarly: bool, dryChanged: bool,
    proofRequests: int, failed: int, recorded: bool }
  var s: Report
  pure val WINDOW = 2
  pure val refusals = Set("duplicate", "out-of-scope", "rejected")
  pure val openReceipt = Set("received", "needs-information", "triaging")

  action init = s' = { mode: "dry_run", receipt: "received", appeal: "none", from: "none",
    version: 1, asked: 0, now: 0, due: -1, github: false, appealed: false, person: false,
    routineClosed: false, closedOnLoss: false, closedEarly: false, dryChanged: false,
    proofRequests: 0, failed: 0, recorded: false }

  // candidates(): what a pass may read. A person's request for information
  // has no clock (due < 0), so the pass never reads it.
  val clockDue = s.receipt == "needs-information" and s.due >= 0 and s.version <= s.asked and s.now >= s.due
  val revised = s.receipt == "needs-information" and s.due >= 0 and s.version > s.asked
  val readable = s.appeal == "none" and not(s.appealed) and
    (s.receipt == "received" or clockDue or revised) and
    (s.mode == "live" or not(s.recorded))
  val live = s.mode == "live"

  // A reviewed configuration change; production starts in dry_run.
  action goLive = all { s.mode == "dry_run", s' = s.with("mode", "live").with("recorded", false) }

  // record(): dry_run stores the decision only.
  def close(outcome: str): Report =
    if (live) s.with("receipt", outcome).with("routineClosed", true).with("due", -1).with("failed", 0)
    else s.with("recorded", true)
  val acknowledge: Report =
    if (live) s.with("receipt", "triaging").with("due", -1).with("failed", 0)
    else s.with("recorded", true)
  val askForProof: Report =
    if (live) s.with("receipt", "needs-information").with("due", s.now + WINDOW)
      .with("asked", s.version).with("proofRequests", s.proofRequests + 1).with("failed", 0)
    else s.with("recorded", true)

  // The clock ended with no new version: no call is made. `closedEarly` is
  // computed from the state before the step, not from the guard.
  action clockEnds = all { readable, clockDue,
    val after = if (s.github) acknowledge else close("rejected")
    s' = after.with("closedEarly", s.closedEarly or
      (refusals.contains(after.receipt) and (s.now < s.due or s.version > s.asked or s.asked == 0))) }
  // Same bytes as an earlier report: no call is made.
  action sameDigest = all { readable, not(clockDue), not(s.github), s' = close("duplicate") }
  // A report on GitHub, or three failed attempts: to the owner, undecided.
  action held = all { readable, not(clockDue), s.github or s.failed >= 3, s' = acknowledge }
  action unavailable = all { readable, not(clockDue), not(s.github), s.failed < 3,
    s' = s.with("failed", s.failed + 1) }
  // Two independent calls: loss, duplicate named, line named, proof present.
  // `closedOnLoss` is computed from the raw answers, not from the branch.
  action twoCalls(la: bool, lb: bool, da: bool, db: bool, xa: bool, xb: bool, pa: bool, pb: bool): bool = all {
    readable, not(clockDue), not(s.github), s.failed < 3,
    val after = if (la or lb) acknowledge
      else if (da or db) (if (da and db) close("duplicate") else acknowledge)
      else if (xa or xb) (if (xa and xb) close("out-of-scope") else acknowledge)
      else if (pa != pb) acknowledge
      else if (not(pa)) (if (s.asked > 0) acknowledge else askForProof)
      else acknowledge
    s' = after.with("closedOnLoss", s.closedOnLoss or
      ((la or lb) and (refusals.contains(after.receipt) or after.proofRequests > s.proofRequests))) }

  action tick = all { s.now < 4, s' = s.with("now", s.now + 1) }
  // The reporter adds a report version while the report is undecided.
  action revise = all { openReceipt.contains(s.receipt), s.version < 3, not(s.github),
    s' = s.with("version", s.version + 1).with("failed", 0).with("recorded", false) }
  action forward = all { openReceipt.contains(s.receipt), s' = s.with("github", true) }
  // People: a request without a clock, and a technical decision.
  action requestInformation = all { openReceipt.contains(s.receipt),
    s' = s.with("receipt", "needs-information").with("due", -1) }
  action decide(outcome: str): bool = all { openReceipt.contains(s.receipt),
    s' = s.with("receipt", outcome).with("person", true).with("routineClosed", false) }
  // planChange "appeal": a routine close returns to the owner at once.
  action appeal = all { refusals.contains(s.receipt), s.appeal != "open",
    s' = if (s.routineClosed)
        s.with("appeal", "returned").with("from", s.receipt).with("receipt", "triaging")
          .with("appealed", true).with("routineClosed", false)
      else s.with("appeal", "open").with("from", s.receipt).with("receipt", "disputed")
          .with("appealed", true) }
  action decideAppeal(uphold: bool): bool = all { s.appeal == "open",
    s' = if (uphold) s.with("appeal", "upheld").with("receipt", s.from)
      else s.with("appeal", "returned").with("receipt", "triaging") }

  action step = any {
    goLive, clockEnds, sameDigest, held, unavailable, tick, revise, forward, requestInformation, appeal,
    { nondet o = Set("confirmed", "duplicate", "out-of-scope", "rejected").oneOf() decide(o) },
    { nondet u = Set(true, false).oneOf() decideAppeal(u) },
    { nondet la = Set(true, false).oneOf() nondet lb = Set(true, false).oneOf()
      nondet da = Set(true, false).oneOf() nondet db = Set(true, false).oneOf()
      nondet xa = Set(true, false).oneOf() nondet xb = Set(true, false).oneOf()
      nondet pa = Set(true, false).oneOf() nondet pb = Set(true, false).oneOf()
      twoCalls(la, lb, da, db, xa, xb, pa, pb) },
    s' = s,
  }

  val invariant = all {
    // No close while a call found loss of funds plausible, and no close as
    // no proof received before the clock ended or after a new version.
    not(s.closedOnLoss), not(s.closedEarly),
    // A routine close is a refusal that no person decided and nobody appealed.
    s.routineClosed implies (refusals.contains(s.receipt) and not(s.appealed)),
    // The pass never confirms a finding.
    s.receipt == "confirmed" implies s.person,
    // One request for proof per report, and a clock only after that request.
    s.proofRequests <= 1,
    s.due >= 0 implies s.asked > 0,
    // A dry run changes nothing: the report stays as received until a person
    // or the reporter acts.
    (s.mode == "dry_run" and not(s.person) and not(s.github) and s.receipt != "needs-information")
      implies (s.receipt == "received" and s.proofRequests == 0),
    s.mode == "dry_run" implies (not(s.routineClosed) and s.due < 0),
    // An open appeal is the moderator path and never follows a routine close.
    (s.appeal == "open") iff (s.receipt == "disputed"),
    s.failed <= 3,
  }

  run dryRunChangesNothingTest = init.then(twoCalls(false, false, true, true, false, false, true, true))
    .expect(s.receipt == "received" and s.recorded and not(s.routineClosed) and invariant)
  run dryRunDecidesOnceTest = init.then(twoCalls(false, false, true, true, false, false, true, true))
    .then(sameDigest.fail())
  run agreedLineClosesTest = init.then(goLive).then(twoCalls(false, false, false, false, true, true, true, true))
    .expect(s.receipt == "out-of-scope" and s.routineClosed and invariant)
  run lossStopsCloseTest = init.then(goLive).then(twoCalls(false, true, true, true, true, true, false, false))
    .expect(s.receipt == "triaging" and not(s.routineClosed) and s.proofRequests == 0 and invariant)
  run oneCallAloneDoesNotCloseTest = init.then(goLive).then(twoCalls(false, false, true, false, false, false, true, true))
    .expect(s.receipt == "triaging" and invariant)
  run noProofWaitsForClockTest = init.then(goLive)
    .then(twoCalls(false, false, false, false, false, false, false, false))
    .expect(s.receipt == "needs-information" and s.due == 2 and invariant)
    .then(tick).then(clockEnds.fail())
  run noProofClosesAfterClockTest = init.then(goLive)
    .then(twoCalls(false, false, false, false, false, false, false, false))
    .then(tick).then(tick).then(clockEnds)
    .expect(s.receipt == "rejected" and s.routineClosed and invariant)
  run newVersionStopsClockTest = init.then(goLive)
    .then(twoCalls(false, false, false, false, false, false, false, false)).then(revise)
    .then(tick).then(tick).then(clockEnds.fail())
  run newVersionIsReadAgainTest = init.then(goLive)
    .then(twoCalls(false, false, false, false, false, false, false, false)).then(revise)
    .then(twoCalls(false, false, false, false, false, false, false, false))
    .expect(s.receipt == "triaging" and s.proofRequests == 1 and invariant)
  run routineAppealReturnsToOwnerTest = init.then(goLive).then(sameDigest).then(appeal)
    .expect(s.receipt == "triaging" and s.appeal == "returned" and not(s.routineClosed) and invariant)
    .then(decide("duplicate")).then(appeal)
    .expect(s.receipt == "disputed" and s.appeal == "open" and invariant)
  run routineAppealIsOnceTest = init.then(goLive).then(sameDigest).then(appeal).then(appeal.fail())
  run appealedReportIsNeverReadAgainTest = init.then(goLive).then(sameDigest).then(appeal)
    .then(decide("rejected")).then(appeal).then(decideAppeal(false))
    .expect(s.receipt == "triaging" and not(readable)).then(sameDigest.fail())
  run personRequestHasNoClockTest = init.then(goLive).then(requestInformation).then(tick).then(tick)
    .then(tick).expect(not(readable)).then(clockEnds.fail())
  run githubReportIsNotClosedByDigestTest = init.then(goLive).then(forward).then(sameDigest.fail())
  run githubReportIsNotReadByCallsTest = init.then(goLive).then(forward)
    .then(twoCalls(false, false, true, true, false, false, true, true).fail())
  run githubReportGoesToOwnerTest = init.then(goLive).then(forward).then(held)
    .expect(s.receipt == "triaging" and not(s.routineClosed) and invariant)
  run failedCallsStopAtThreeTest = init.then(goLive).then(unavailable).then(unavailable).then(unavailable)
    .expect(s.receipt == "received").then(unavailable.fail())
  run failedCallsGoToOwnerTest = init.then(goLive).then(unavailable).then(unavailable).then(unavailable)
    .then(held).expect(s.receipt == "triaging" and invariant)
}
