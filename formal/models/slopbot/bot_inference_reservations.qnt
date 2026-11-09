// @source workers/slopbot/value-inference.ts
// @source workers/slopbot/value-budget.ts
// @source workers/slopbot/models.ts
// @source migrations/0104_slopbot_value_inference_attempts.sql
// @source migrations/0120_slopbot_value_attempt_completion.sql
// @source migrations/0118_slopbot_zero_call_reconciliation.sql
// @evidence workers/slopbot/value-attempt-limit.test.ts
// One inference key, two existing counted reservations and three new IDs.
// Admission and the reservation transaction are separate. Each transaction
// records its own decision before its asynchronous response is delivered.
// Complete call lists are no receipt / all-free / containing another call.
// Completion follows call recording and any required valid-result retention;
// it is independent of cost reconciliation. A completed no-call attempt only
// frees its slot after explicit zero-call reconciliation; unfinished holds stay.
// Money arithmetic, individual cost-row writes, and provider truth are outside
// this projection. Ownership abstracts the callback before a provider call;
// it does not claim a distributed lock between that callback and HTTP send.
module bot_inference_reservations {
  type Row = { admitted: bool, reserved: bool, called: bool, recorded: str,
    completed: bool, zeroReconciled: bool, owner: bool, decision: str, delivered: bool }
  val ids = Set(1, 2, 3, 4, 5)
  val candidates = Set(3, 4, 5)
  val empty = { admitted: false, reserved: false, called: false,
    recorded: "none", completed: false, zeroReconciled: false, owner: true, decision: "none", delivered: false }
  val history = { admitted: true, reserved: true, called: true,
    recorded: "none", completed: false, zeroReconciled: false, owner: false, decision: "reserved", delivered: true }
  var s: { rows: int -> Row, budget: bool, atomic: bool }
  action init = s' = { rows: ids.mapBy(id => if (id <= 2) history else empty),
    budget: true, atomic: true }
  val counted = ids.filter(id => {
    val row = s.rows.get(id)
    row.reserved and row.recorded != "free" and not(row.zeroReconciled)
  }).size()
  val confirmed = ids.filter(id => s.rows.get(id).reserved
    and s.rows.get(id).completed and s.rows.get(id).recorded == "other").size()
  val refusal = if (confirmed >= 3) "attempts" else "attempts-pending"
  action admit(id: int): bool = all { candidates.contains(id),
    not(s.rows.get(id).admitted), s.rows.get(id).decision == "none", counted < 3,
    s' = s.with("rows", s.rows.set(id,
      s.rows.get(id).with("admitted", true))) }
  action rejectAdmission(id: int): bool = all { candidates.contains(id),
    not(s.rows.get(id).admitted), s.rows.get(id).decision == "none", counted >= 3,
    s' = s.with("rows", s.rows.set(id,
      s.rows.get(id).with("decision", refusal))) }
  // INSERT RETURNING plus refusal SELECT execute in one D1 batch. Only its
  // response is delayed: later cost writes cannot reclassify that decision.
  action reserve(id: int): bool = {
    val decision = if (not(s.atomic)) "storage"
      else if (counted >= 3) refusal
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
    s.rows.get(id).owner, not(s.rows.get(id).called), not(s.rows.get(id).completed),
    s' = s.with("rows", s.rows.set(id,
      s.rows.get(id).with("called", true))) }
  action record(id: int, free: bool): bool = all { ids.contains(id),
    s.rows.get(id).reserved, s.rows.get(id).called,
    s.rows.get(id).recorded == "none",
    s' = s.with("rows", s.rows.set(id, s.rows.get(id)
      .with("recorded", if (free) "free" else "other"))) }
  action complete(id: int): bool = all { ids.contains(id),
    s.rows.get(id).reserved, not(s.rows.get(id).completed),
    not(s.rows.get(id).called) or s.rows.get(id).recorded != "none",
    s' = s.with("rows", s.rows.set(id,
      s.rows.get(id).with("completed", true))) }
  action reconcileZero(id: int): bool = all { ids.contains(id),
    s.rows.get(id).reserved, s.rows.get(id).completed, not(s.rows.get(id).called),
    s' = s.with("rows", s.rows.set(id,
      s.rows.get(id).with("zeroReconciled", true))) }
  action exhaustBudget = all { s.budget, s' = s.with("budget", false) }
  action restoreBudget = all { not(s.budget), s' = s.with("budget", true) }
  action lackAtomicStorage = all { s.atomic, s' = s.with("atomic", false) }
  action chooseRequest = {
    nondet id = ids.oneOf()
    any { admit(id), rejectAdmission(id), reserve(id), deliver(id), loseOwner(id), call(id),
      complete(id), reconcileZero(id) }
  }
  action chooseRecord = {
    nondet id = ids.oneOf()
    nondet free = Set(false, true).oneOf()
    record(id, free)
  }
  // Unrelated choices do not multiply every successor; domains are unchanged.
  action step = any { chooseRequest, chooseRecord, exhaustBudget, restoreBudget,
    lackAtomicStorage, s' = s }
  val invariant = all { counted <= 3,
    ids.forall(id => {
      val row = s.rows.get(id)
      all { row.reserved implies row.admitted,
        row.called implies row.reserved,
        row.recorded != "none" implies row.called,
        row.completed implies row.reserved,
        row.zeroReconciled implies (row.completed and not(row.called)),
        (row.decision == "reserved") == row.reserved,
        Set("attempts", "attempts-pending", "budget", "storage").contains(row.decision)
          implies not(row.reserved) }
    }) }
  run firstReservationWinsLastSlotTest = init.then(admit(3)).then(admit(4))
    .then(reserve(3)).then(reserve(4)).then(deliver(4))
    .expect(counted == 3 and s.rows.get(4).decision == "attempts-pending"
      and not(s.rows.get(4).reserved) and invariant)
  run reverseReservationOrderWinsLastSlotTest = init.then(admit(3)).then(admit(4))
    .then(reserve(4)).then(reserve(3)).then(deliver(3))
    .expect(counted == 3 and s.rows.get(3).decision == "attempts-pending" and invariant)
  run staleOwnerCannotTakeFourthSlotTest = init.then(admit(3)).then(admit(4))
    .then(loseOwner(3)).then(reserve(4)).then(reserve(3)).then(deliver(3))
    .expect(s.rows.get(3).decision == "attempts-pending"
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
    .expect(counted == 2 and s.rows.get(4).decision == "attempts-pending")
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
  run unknownFullAdmissionRemainsPendingTest = init.then(admit(3)).then(reserve(3))
    .then(rejectAdmission(4)).then(deliver(4))
    .expect(counted == 3 and s.rows.get(4).decision == "attempts-pending"
      and not(s.rows.get(4).admitted) and invariant)
  run knownFullAdmissionIsTerminalTest = init.then(record(1, false)).then(complete(1))
    .then(record(2, false)).then(complete(2))
    .then(admit(3)).then(reserve(3)).then(deliver(3)).then(call(3)).then(record(3, false))
    .then(complete(3))
    .then(rejectAdmission(4)).then(deliver(4))
    .expect(confirmed == 3 and s.rows.get(4).decision == "attempts"
      and not(s.rows.get(4).admitted) and invariant)
  run recordedNonFreeBeforeCompletionRemainsPendingTest = init
    .then(record(1, false)).then(complete(1)).then(record(2, false)).then(complete(2))
    .then(admit(3)).then(reserve(3)).then(deliver(3)).then(call(3)).then(record(3, false))
    .then(rejectAdmission(4)).then(deliver(4))
    .expect(counted == 3 and confirmed == 2 and s.rows.get(4).decision == "attempts-pending")
  run completedNoCallReservationStillHoldsCapacityTest = init.then(admit(3))
    .then(reserve(3)).then(complete(3)).then(rejectAdmission(4)).then(deliver(4))
    .expect(counted == 3 and s.rows.get(3).completed and not(s.rows.get(3).called)
      and s.rows.get(4).decision == "attempts-pending" and invariant)
  run completedNoCallReconciliationReleasesCapacityTest = init.then(admit(3))
    .then(reserve(3)).then(complete(3)).then(reconcileZero(3)).then(admit(4)).then(reserve(4))
    .expect(counted == 3 and s.rows.get(3).zeroReconciled and s.rows.get(4).reserved and invariant)
  run unfinishedNoCallCannotReconcileTest = init.then(admit(3)).then(reserve(3))
    .then(reconcileZero(3).fail())
  run calledAttemptCannotReconcileAsZeroTest = init.then(admit(3)).then(reserve(3))
    .then(deliver(3)).then(call(3)).then(record(3, false)).then(complete(3))
    .then(reconcileZero(3).fail())
}
