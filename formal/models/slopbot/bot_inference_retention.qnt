// @source workers/slopbot/value-inference.ts
// @source workers/slopbot/value-budget.ts
// @source migrations/0054_slopbot_value_inference_results.sql
// @source migrations/0104_slopbot_value_inference_attempts.sql
// @source migrations/0118_slopbot_zero_call_reconciliation.sql
// @source migrations/0120_slopbot_value_attempt_completion.sql
// @evidence workers/slopbot/value-attempt-limit.test.ts
// One inference key and one active caller; eight distinct admitted identities
// cover four free denials, three counted attempts, and a refused eighth ID.
// Unreserved rows and all-recorded-free calls do not consume the limit.
// An unrecorded or mixed/ordinary call remains counted. Provider call lists
// are quotiented to no call / all-free / containing at least one other call.
// A no-call reservation stops counting only after completion and explicit
// zero-call reconciliation. Concurrent admit/reserve interleaving is refined
// by bot_inference_reservations; late contradictory provider evidence is
// covered by value-attempt-limit.test.ts, outside this one-active-caller model.
module bot_inference_retention {
  type Attempt = { admitted: bool, reserved: bool, called: bool,
    usage: bool, free: bool, valid: bool, completed: bool, zeroReconciled: bool }
  val ids = Set(1, 2, 3, 4, 5, 6, 7, 8)
  val empty = { admitted: false, reserved: false, called: false,
    usage: false, free: false, valid: false, completed: false, zeroReconciled: false }
  var s: { rows: int -> Attempt, current: int, retained: int, published: bool }
  action init = s' = { rows: ids.mapBy(_ => empty), current: 0,
    retained: 0, published: false }
  def rowCounted(row: Attempt): bool = row.reserved and not(row.usage and row.free)
    and not(row.completed and row.zeroReconciled and not(row.usage))
  val counted = ids.filter(id => rowCounted(s.rows.get(id))).size()
  action admit(id: int): bool = all { ids.contains(id), s.current == 0,
    not(s.rows.get(id).admitted), counted < 3, s.retained == 0,
    s' = s.with("current", id).with("rows",
      s.rows.set(id, empty.with("admitted", true))) }
  action reserve = all { s.current > 0, not(s.rows.get(s.current).reserved), counted < 3,
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("reserved", true))) }
  action budgetRefused = all { s.current > 0, not(s.rows.get(s.current).reserved),
    s' = s.with("current", 0) }
  action call = all { s.current > 0, s.rows.get(s.current).reserved,
    not(s.rows.get(s.current).called), not(s.rows.get(s.current).completed),
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("called", true))) }
  action freeDenial = all { s.current > 0, s.rows.get(s.current).reserved,
    not(s.rows.get(s.current).called), not(s.rows.get(s.current).completed),
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("called", true).with("free", true))) }
  // One earlier non-free call plus a free fallback is still counted.
  action mixedDenial = call
  action recordUsage = all { s.current > 0, s.rows.get(s.current).called,
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("usage", true))) }
  action validate = all { s.current > 0, s.rows.get(s.current).called,
    not(s.rows.get(s.current).free), not(s.rows.get(s.current).completed),
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("valid", true))) }
  action retain = all { s.current > 0, s.rows.get(s.current).usage,
    s.rows.get(s.current).valid, s.retained == 0,
    s' = s.with("retained", s.current) }
  // Completion follows call persistence and any successful result retention.
  // It does not imply that unknown provider costs could be reconciled.
  action complete = all { s.current > 0, s.rows.get(s.current).reserved,
    not(s.rows.get(s.current).completed),
    not(s.rows.get(s.current).called) or s.rows.get(s.current).usage,
    not(s.rows.get(s.current).valid) or s.retained == s.current,
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("completed", true))) }
  action reconcileZeroCall = all { s.current > 0,
    s.rows.get(s.current).completed, not(s.rows.get(s.current).called),
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("zeroReconciled", true))) }
  action finish = all { s.current > 0, s' = s.with("current", 0) }
  action publish = all { s.retained > 0, s' = s.with("published", true) }
  // Identities are interchangeable: every guard, update and invariant treats
  // them only by equality, and `retained`/`current` follow the same renaming.
  // Step therefore admits the lowest unadmitted identity; admitting any other
  // one reaches an identity-permuted copy of the same state (formal/README.md,
  // "Write-only fields and canonical choices").
  // Only the current row changes, and a released identity is never admitted
  // again. A released row is then read only through `admitted`, its counted
  // contribution and, if retained, the retained conjunct. Its other invariant
  // conjuncts were checked while it was current and hold for the canonical
  // row too. stepFinish stores one canonical counted or uncounted row unless the
  // row is retained. budgetRefused has the same successor as finish, so step
  // keeps finish alone.
  action stepFinish = {
    val row = s.rows.get(s.current)
    val released = if (rowCounted(row)) empty.with("admitted", true).with("reserved", true)
      else empty.with("admitted", true)
    all { s.current > 0, s' = s.with("current", 0)
      .with("rows", if (s.retained == s.current) s.rows else s.rows.set(s.current, released)) }
  }
  action stepAdmit = {
    nondet id = ids.oneOf()
    all { ids.forall(earlier => earlier < id implies s.rows.get(earlier).admitted), admit(id) }
  }
  action step = any { stepAdmit, reserve, call, freeDenial, mixedDenial,
    recordUsage, validate, retain, complete, reconcileZeroCall, stepFinish, publish, s' = s }
  val invariant = all { counted <= 3,
    ids.forall(id => s.rows.get(id).called implies s.rows.get(id).reserved),
    ids.forall(id => s.rows.get(id).zeroReconciled implies
      s.rows.get(id).completed and not(s.rows.get(id).called)),
    s.retained > 0 implies s.rows.get(s.retained).usage and s.rows.get(s.retained).valid,
    s.published implies s.retained > 0 }
  run usageFailureCannotPublishTest = init.then(admit(1)).then(reserve).then(call).then(validate)
    .expect(s.retained == 0 and not(s.published)).then(retain.fail())
  run retainedResultReusedTest = init.then(admit(1)).then(reserve).then(call).then(recordUsage).then(validate).then(retain)
    .then(finish).then(publish).expect(counted == 1 and s.published and invariant)
  run unreservedAdmissionDoesNotSpendAttemptTest = init.then(admit(1)).then(budgetRefused)
    .then(admit(2)).then(budgetRefused).then(admit(3)).then(budgetRefused)
    .then(admit(4)).then(reserve).then(call).expect(counted == 1)
  run freeDenialsLeaveThreeCountedAttemptsTest = init
    .then(admit(1)).then(reserve).then(freeDenial).then(recordUsage).then(finish)
    .then(admit(2)).then(reserve).then(freeDenial).then(recordUsage).then(finish)
    .then(admit(3)).then(reserve).then(freeDenial).then(recordUsage).then(finish)
    .then(admit(4)).then(reserve).then(freeDenial).then(recordUsage).then(finish)
    .then(admit(5)).then(reserve).then(call).then(recordUsage).then(finish)
    .then(admit(6)).then(reserve).then(call).then(recordUsage).then(finish)
    .then(admit(7)).then(reserve).then(call).then(recordUsage).then(finish)
    .expect(counted == 3).then(admit(8).fail())
  run unknownNoCallReservationsRemainCountedTest = init
    .then(admit(1)).then(reserve).then(finish)
    .then(admit(2)).then(reserve).then(finish)
    .then(admit(3)).then(reserve).then(finish)
    .expect(counted == 3).then(admit(4).fail())
  run unrecordedFreeResponseRemainsCountedTest = init.then(admit(1)).then(reserve).then(freeDenial)
    .expect(counted == 1).then(recordUsage).expect(counted == 0)
  run mixedBudgetDenialStillCountsTest = init.then(admit(1)).then(reserve).then(mixedDenial)
    .then(recordUsage).expect(counted == 1)
  run zeroCallAttemptsDoNotExhaustLimitTest = init
    .then(admit(1)).then(reserve).then(complete).then(reconcileZeroCall).then(finish)
    .then(admit(2)).then(reserve).then(complete).then(reconcileZeroCall).then(finish)
    .then(admit(3)).then(reserve).then(complete).then(reconcileZeroCall).then(finish)
    .then(admit(4)).then(reserve).then(complete).then(reconcileZeroCall).then(finish)
    .then(admit(5)).then(reserve).then(call).then(recordUsage).then(validate).then(retain)
    .then(complete).then(finish).then(publish)
    .expect(counted == 1 and s.published and invariant)
  run completionAloneKeepsNoCallAttemptCountedTest = init.then(admit(1)).then(reserve)
    .then(complete).expect(counted == 1).then(reconcileZeroCall).expect(counted == 0)
  run unfinishedNoCallCannotReconcileTest = init.then(admit(1)).then(reserve)
    .then(reconcileZeroCall.fail())
  run calledAttemptCannotReconcileAsZeroTest = init.then(admit(1)).then(reserve).then(call)
    .then(recordUsage).then(complete).then(reconcileZeroCall.fail())
  run completedNoCallCannotStartProviderTest = init.then(admit(1)).then(reserve)
    .then(complete).then(call.fail())
}
