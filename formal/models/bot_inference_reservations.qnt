// @source workers/slopbot/value-inference.ts
// @source workers/slopbot/value-budget.ts
// @source workers/slopbot/models.ts
// @source migrations/0104_slopbot_value_inference_attempts.sql
// @evidence workers/slopbot/value-attempt-limit.test.ts
// One inference key, two existing counted reservations and three new IDs.
// Admission and the reservation transaction are separate. Each transaction
// records its own decision before its asynchronous response is delivered.
// Complete call lists are no receipt / all-free / containing another call.
// Money arithmetic, individual cost-row writes, and provider truth are outside
// this projection. Ownership abstracts the callback before a provider call;
// it does not claim a distributed lock between that callback and HTTP send.
module bot_inference_reservations {
  type Row = { admitted: bool, reserved: bool, called: bool, recorded: str,
    owner: bool, decision: str, delivered: bool }
  val ids = Set(1, 2, 3, 4, 5)
  val candidates = Set(3, 4, 5)
  val empty = { admitted: false, reserved: false, called: false,
    recorded: "none", owner: true, decision: "none", delivered: false }
  val history = { admitted: true, reserved: true, called: true,
    recorded: "none", owner: false, decision: "reserved", delivered: true }
  var s: { rows: int -> Row, budget: bool, atomic: bool }
  action init = s' = { rows: ids.mapBy(id => if (id <= 2) history else empty),
    budget: true, atomic: true }
  val counted = ids.filter(id => {
    val row = s.rows.get(id)
    row.reserved and row.recorded != "free"
  }).size()
  action admit(id: int): bool = all { candidates.contains(id),
    not(s.rows.get(id).admitted), counted < 3,
    s' = s.with("rows", s.rows.set(id,
      s.rows.get(id).with("admitted", true))) }
  // INSERT RETURNING plus refusal SELECT execute in one D1 batch. Only its
  // response is delayed: later cost writes cannot reclassify that decision.
  action reserve(id: int): bool = {
    val decision = if (not(s.atomic)) "storage"
      else if (counted >= 3) "attempts"
      else if (not(s.budget)) "budget" else "reserved"
    all { candidates.contains(id), s.rows.get(id).admitted,
      s.rows.get(id).decision == "none",
      s' = s.with("rows", s.rows.set(id, s.rows.get(id)
        .with("decision", decision).with("reserved", decision == "reserved"))) }
  }
  action deliver(id: int): bool = all { candidates.contains(id),
    s.rows.get(id).decision != "none", not(s.rows.get(id).delivered),
    s' = s.with("rows", s.rows.set(id,
      s.rows.get(id).with("delivered", true))) }
  action loseOwner(id: int): bool = all { candidates.contains(id),
    s.rows.get(id).owner,
    s' = s.with("rows", s.rows.set(id,
      s.rows.get(id).with("owner", false))) }
  action call(id: int): bool = all { candidates.contains(id),
    s.rows.get(id).delivered, s.rows.get(id).reserved,
    s.rows.get(id).owner, not(s.rows.get(id).called),
    s' = s.with("rows", s.rows.set(id,
      s.rows.get(id).with("called", true))) }
  action record(id: int, free: bool): bool = all { ids.contains(id),
    s.rows.get(id).reserved, s.rows.get(id).called,
    s.rows.get(id).recorded == "none",
    s' = s.with("rows", s.rows.set(id, s.rows.get(id)
      .with("recorded", if (free) "free" else "other"))) }
  action exhaustBudget = all { s.budget, s' = s.with("budget", false) }
  action restoreBudget = all { not(s.budget), s' = s.with("budget", true) }
  action lackAtomicStorage = all { s.atomic, s' = s.with("atomic", false) }
  action step = {
    nondet id = ids.oneOf()
    nondet free = Set(false, true).oneOf()
    any { admit(id), reserve(id), deliver(id), loseOwner(id), call(id),
      record(id, free), exhaustBudget, restoreBudget, lackAtomicStorage,
      s' = s }
  }
  val invariant = all { counted <= 3,
    ids.forall(id => {
      val row = s.rows.get(id)
      all { row.reserved implies row.admitted,
        row.called implies row.reserved,
        row.recorded != "none" implies row.called,
        (row.decision == "reserved") == row.reserved,
        Set("attempts", "budget", "storage").contains(row.decision)
          implies not(row.reserved) }
    }) }
  run firstReservationWinsLastSlotTest = init.then(admit(3)).then(admit(4))
    .then(reserve(3)).then(reserve(4)).then(deliver(4))
    .expect(counted == 3 and s.rows.get(4).decision == "attempts"
      and not(s.rows.get(4).reserved) and invariant)
  run reverseReservationOrderWinsLastSlotTest = init.then(admit(3)).then(admit(4))
    .then(reserve(4)).then(reserve(3)).then(deliver(3))
    .expect(counted == 3 and s.rows.get(3).decision == "attempts" and invariant)
  run staleOwnerCannotTakeFourthSlotTest = init.then(admit(3)).then(admit(4))
    .then(loseOwner(3)).then(reserve(4)).then(reserve(3)).then(deliver(3))
    .expect(s.rows.get(3).decision == "attempts"
      and not(s.rows.get(3).called) and counted == 3)
  run staleOwnerReservationRemainsHeldTest = init.then(admit(3)).then(loseOwner(3))
    .then(reserve(3)).then(deliver(3))
    .expect(s.rows.get(3).reserved and counted == 3).then(call(3).fail())
  run budgetRefusalRetainsOnlyAdmissionTest = init.then(admit(3)).then(exhaustBudget)
    .then(reserve(3)).then(deliver(3))
    .expect(s.rows.get(3).admitted and s.rows.get(3).decision == "budget"
      and counted == 2 and not(s.rows.get(3).reserved))
  run refusalSurvivesFreeReceiptBeforeReplyTest = init.then(admit(3)).then(admit(4))
    .then(reserve(3)).then(deliver(3)).then(call(3)).then(reserve(4))
    .then(record(3, true)).then(deliver(4))
    .expect(counted == 2 and s.rows.get(4).decision == "attempts")
    .then(admit(5)).then(reserve(5)).expect(counted == 3 and invariant)
  run unknownReservationsDoNotExpireTest = init.then(admit(3)).then(reserve(3))
    .then(deliver(3)).then(loseOwner(3))
    .expect(counted == 3 and s.rows.get(3).recorded == "none")
    .then(admit(4).fail())
  run nonFreeReceiptDoesNotReopenSlotTest = init.then(admit(3)).then(reserve(3))
    .then(deliver(3)).then(call(3)).then(record(3, false))
    .expect(counted == 3).then(admit(4).fail())
  run missingAtomicStorageCannotAuthorizeCallTest = init.then(admit(3))
    .then(lackAtomicStorage).then(reserve(3)).then(deliver(3))
    .expect(s.rows.get(3).decision == "storage" and counted == 2)
    .then(call(3).fail())
  run immutableAttemptCannotBeReadmittedTest = init.then(admit(3)).then(reserve(3))
    .then(record(1, true)).expect(counted == 2 and s.rows.get(3).admitted)
    .then(admit(3).fail())
}
