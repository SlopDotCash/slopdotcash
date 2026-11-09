// @source workers/slopbot/value-inference.ts
// @source workers/slopbot/value-budget.ts
// @source migrations/0054_slopbot_value_inference_results.sql
// @source migrations/0104_slopbot_value_inference_attempts.sql
// @evidence workers/slopbot/value-attempt-limit.test.ts
// One inference key and one active caller; eight distinct admitted identities
// cover four free denials, three counted attempts, and a refused eighth ID.
// Unreserved rows and all-recorded-free calls do not consume the limit.
// An unrecorded or mixed/ordinary call remains counted. Provider call lists
// are quotiented to no call / all-free / containing at least one other call.
// Concurrent admit/reserve interleaving is explicitly outside this model.
module bot_inference_retention {
  type Attempt = { admitted: bool, reserved: bool, called: bool,
    usage: bool, free: bool, valid: bool }
  val ids = Set(1, 2, 3, 4, 5, 6, 7, 8)
  val empty = { admitted: false, reserved: false, called: false,
    usage: false, free: false, valid: false }
  var s: { rows: int -> Attempt, current: int, retained: int, published: bool }
  action init = s' = { rows: ids.mapBy(_ => empty), current: 0,
    retained: 0, published: false }
  val counted = ids.filter(id => {
    val row = s.rows.get(id)
    row.reserved and not(row.usage and row.free)
  }).size()
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
    not(s.rows.get(s.current).called),
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("called", true))) }
  action freeDenial = all { s.current > 0, s.rows.get(s.current).reserved,
    not(s.rows.get(s.current).called),
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("called", true).with("free", true))) }
  // One earlier non-free call plus a free fallback is still counted.
  action mixedDenial = call
  action recordUsage = all { s.current > 0, s.rows.get(s.current).called,
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("usage", true))) }
  action validate = all { s.current > 0, s.rows.get(s.current).called,
    not(s.rows.get(s.current).free),
    s' = s.with("rows", s.rows.set(s.current,
      s.rows.get(s.current).with("valid", true))) }
  action retain = all { s.current > 0, s.rows.get(s.current).usage,
    s.rows.get(s.current).valid, s.retained == 0,
    s' = s.with("retained", s.current) }
  action finish = all { s.current > 0, s' = s.with("current", 0) }
  action publish = all { s.retained > 0, s' = s.with("published", true) }
  action step = {
    nondet id = ids.oneOf()
    any { admit(id), reserve, budgetRefused, call, freeDenial, mixedDenial,
      recordUsage, validate, retain, finish, publish, s' = s }
  }
  val invariant = all { counted <= 3,
    ids.forall(id => s.rows.get(id).called implies s.rows.get(id).reserved),
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
}
