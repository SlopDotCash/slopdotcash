// @source backend/referrals/cache.ts
// @source backend/referrals/claims.ts
// @source migrations/0089_referral_claim_cache.sql
// @evidence workers/referral-accrual/anvil.integration.ts
// PRD11 referrals remain off; enabled is an input class, never an activation
// instruction. Two refreshes, request timestamps 1..4, finalized heights 1..3.
// Projection correctness is supplied by referral_cache_projection. This model
// separates captured reads, SQL execution and lost replies. Timestamps are the
// captured request time, not completion time; equality conservatively favors
// failure. A newer height alone cannot bypass the observation-time guard.
// A read failure occurs outside the source try/catch and cannot mark a failure.
// Lost success-write replies can mark the committed body stale at the same
// timestamp. Old-source counterexamples are outside step. No execution claimed.
module referral_cache_write_order {
  val ids = Set(1, 2)
  val times = Set(1, 2, 3, 4)
  val heights = Set(1, 2, 3)
  type Row = { present: bool, body: bool, observed: int, error: int, block: int }
  type Call = { phase: str, at: int, block: int, priorBlock: int, read: bool, wrote: bool }
  val absent: Row = { present: false, body: false, observed: 0, error: 0, block: 0 }
  val empty: Call = { phase: "unused", at: 1, block: 1, priorBlock: 0, read: false, wrote: false }
  type State = { enabled: bool, row: Row, calls: int -> Call, peakError: int,
    clearedError: int, successAt: int }
  var s: State
  def initial(enabled: bool): State = { enabled: enabled, row: absent,
    calls: ids.mapBy(_ => empty), peakError: 0, clearedError: 0, successAt: 0 }
  action init = { nondet enabled = Set(false, true).oneOf(); s' = initial(enabled) }
  action active = s' = initial(true)
  action off = s' = initial(false)
  action seed = all { ids.forall(id => s.calls.get(id).phase == "unused"),
    s' = s.with("row", { present: true, body: true, observed: 1, error: 0, block: 1 }) }
  action start(id: int, at: int, block: int): bool = all {
    ids.contains(id), times.contains(at), heights.contains(block), s.calls.get(id).phase == "unused",
    s' = s.with("calls", s.calls.set(id, empty.with("at", at).with("block", block)
      .with("phase", if (s.enabled) "read" else "skipped"))) }
  action read(id: int): bool = all { s.calls.get(id).phase == "read",
    s' = s.with("calls", s.calls.set(id, s.calls.get(id).with("read", true)
      .with("priorBlock", s.row.block).with("phase", "project"))) }
  action readError(id: int): bool = all { s.calls.get(id).phase == "read",
    s' = s.with("calls", s.calls.set(id, s.calls.get(id).with("phase", "read-error"))) }
  action projection(id: int, verified: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "project", s' = s.with("calls", s.calls.set(id, call.with("phase",
      if (verified and call.block >= call.priorBlock) "success-write" else "failure-write"))) }
  }
  def successAllowed(call: Call): bool = not(s.row.present) or
    ((s.row.observed == 0 or (s.row.observed < call.at and s.row.block <= call.block))
      and (s.row.error == 0 or s.row.error < call.at))
  def failureAllowed(call: Call): bool = not(s.row.present) or
    ((s.row.observed == 0 or s.row.observed <= call.at) and (s.row.error == 0 or s.row.error < call.at))
  action successWrite(id: int): bool = {
    val call = s.calls.get(id)
    val accepted = successAllowed(call)
    all { call.phase == "success-write", s' = s
      .with("row", if (accepted) { present: true, body: true, observed: call.at, error: 0, block: call.block } else s.row)
      .with("clearedError", if (accepted) s.row.error else s.clearedError)
      .with("successAt", if (accepted) call.at else s.successAt)
      .with("calls", s.calls.set(id, call.with("wrote", accepted).with("phase", "success-reply"))) }
  }
  action failureWrite(id: int): bool = {
    val call = s.calls.get(id)
    val accepted = failureAllowed(call)
    all { call.phase == "failure-write", s' = s
      .with("row", if (accepted) s.row.with("present", true).with("error", call.at) else s.row)
      .with("peakError", if (accepted and call.at > s.peakError) call.at else s.peakError)
      .with("calls", s.calls.set(id, call.with("wrote", accepted).with("phase", "failure-reply"))) }
  }
  action successReply(id: int, received: bool): bool = all { s.calls.get(id).phase == "success-reply",
    s' = s.with("calls", s.calls.set(id, s.calls.get(id).with("phase", if (received) "done" else "failure-write"))) }
  action failureReply(id: int): bool = all { s.calls.get(id).phase == "failure-reply",
    s' = s.with("calls", s.calls.set(id, s.calls.get(id).with("phase", "failed"))) }
  action successError(id: int): bool = all { s.calls.get(id).phase == "success-write",
    s' = s.with("calls", s.calls.set(id, s.calls.get(id).with("phase", "failure-write"))) }
  action step = {
    nondet id = ids.oneOf()
    nondet at = times.oneOf()
    nondet block = heights.oneOf()
    nondet yes = Set(false, true).oneOf()
    any { seed, start(id, at, block), read(id), readError(id), projection(id, yes), successWrite(id),
      failureWrite(id), successReply(id, yes), failureReply(id), successError(id), s' = s }
  }
  val invariant = all { s.row.body == (s.row.observed != 0),
    not(s.row.present) implies not(s.row.body) and s.row.error == 0,
    s.row.error != 0 implies s.row.error == s.peakError and s.row.error >= s.row.observed,
    s.clearedError != 0 implies s.successAt > s.clearedError,
    ids.forall(id => s.calls.get(id).read implies s.enabled) }
  action prepared(id: int, at: int, block: int, verified: bool): bool =
    start(id, at, block).then(read(id)).then(projection(id, verified))
  action failed(id: int, at: int): bool = prepared(id, at, 1, false).then(failureWrite(id)).then(failureReply(id))
  // Historical predicates deliberately omit the new error ordering condition.
  action oldSuccess(id: int): bool = {
    val call = s.calls.get(id)
    val accepted = not(s.row.present) or s.row.observed == 0 or (s.row.observed < call.at and s.row.block <= call.block)
    all { call.phase == "success-write", accepted, s' = s
      .with("row", { present: true, body: true, observed: call.at, error: 0, block: call.block })
      .with("clearedError", s.row.error).with("successAt", call.at)
      .with("calls", s.calls.set(id, call.with("phase", "success-reply").with("wrote", true))) }
  }
  action oldFailure(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "failure-write", s.row.observed == 0 or s.row.observed <= call.at,
      s' = s.with("row", s.row.with("present", true).with("error", call.at))
        .with("calls", s.calls.set(id, call.with("phase", "failure-reply"))) }
  }
  run disabledInputDoesNotReadCacheTest = off.then(start(1, 1, 1)).expect(not(s.calls.get(1).read) and not(s.row.present) and invariant)
  run firstFailureKeepsAmountsUnknownTest = active.then(failed(1, 1)).expect(s.row.present and not(s.row.body) and s.row.error == 1 and invariant)
  run cacheReadFailureDoesNotInventFailureRowTest = active.then(start(1, 2, 1)).then(readError(1)).expect(not(s.row.present) and invariant)
  run newerFailureWinsOverOlderSuccessTest = active.then(seed).then(prepared(1, 2, 2, true)).then(failed(2, 3))
    .then(successWrite(1)).expect(s.row.observed == 1 and s.row.error == 3 and not(s.calls.get(1).wrote) and invariant)
  run failureOnlyRowAlsoRefusesOlderSuccessTest = active.then(prepared(1, 2, 1, true)).then(failed(2, 3))
    .then(successWrite(1)).expect(not(s.row.body) and s.row.error == 3 and invariant)
  run oldFailureCannotMoveErrorTimeBackwardsTest = active.then(seed).then(prepared(1, 2, 1, false)).then(failed(2, 3))
    .then(failureWrite(1)).expect(s.row.error == 3 and not(s.calls.get(1).wrote) and invariant)
  run equalFailureBeforeSuccessRemainsStaleTest = active.then(seed).then(prepared(1, 2, 2, true)).then(failed(2, 2))
    .then(successWrite(1)).expect(s.row.error == 2 and s.row.observed == 1 and invariant)
  run equalFailureAfterSuccessMarksBodyStaleTest = active.then(prepared(1, 2, 2, true)).then(successWrite(1))
    .then(successReply(1, true)).then(failed(2, 2)).expect(s.row.body and s.row.error == 2 and invariant)
  run strictlyNewerSuccessClearsFailureTest = active.then(failed(1, 2)).then(prepared(2, 3, 2, true)).then(successWrite(2))
    .expect(s.row.body and s.row.observed == 3 and s.row.error == 0 and invariant)
  run oldFailureCannotMarkNewerBodyStaleTest = active.then(prepared(1, 3, 2, true)).then(successWrite(1))
    .then(failed(2, 2)).expect(s.row.observed == 3 and s.row.error == 0 and invariant)
  run oldSuccessCannotReplaceNewerBodyTest = active.then(prepared(1, 2, 2, true)).then(prepared(2, 3, 3, true))
    .then(successWrite(2)).then(successWrite(1)).expect(s.row.observed == 3 and s.row.block == 3 and invariant)
  run newerTimeCannotRegressFinalizedHeightTest = active.then(seed).then(prepared(1, 4, 2, true)).then(prepared(2, 3, 3, true))
    .then(successWrite(2)).then(successWrite(1)).expect(s.row.observed == 3 and s.row.block == 3 and invariant)
  run lostSuccessReplyRetainsButMarksCommittedBodyStaleTest = active.then(prepared(1, 2, 2, true)).then(successWrite(1))
    .then(successReply(1, false)).then(failureWrite(1)).expect(s.row.body and s.row.observed == 2 and s.row.error == 2 and invariant)
  run definiteSuccessWriteFailureKeepsPreviousBodyTest = active.then(seed).then(prepared(1, 2, 2, true)).then(successError(1))
    .then(failureWrite(1)).expect(s.row.observed == 1 and s.row.block == 1 and s.row.error == 2 and invariant)
  run oldSuccessCouldEraseNewerFailureNegativeControlTest = active.then(seed).then(prepared(1, 2, 2, true)).then(failed(2, 3))
    .then(oldSuccess(1)).expect(not(invariant) and s.row.error == 0)
  run oldFailureCouldMoveErrorTimeBackwardsNegativeControlTest = active.then(seed).then(prepared(1, 2, 1, false)).then(failed(2, 3))
    .then(oldFailure(1)).expect(not(invariant) and s.row.error == 2)
}
