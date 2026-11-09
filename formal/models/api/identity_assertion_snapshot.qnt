// @source workers/identity/persistence.ts
// @source workers/identity/contracts.ts
// @evidence workers/identity/persistence-transitions.test.ts
// createAssertion owns one shallow snapshot through INSERT and SELECT readback.
// Two callers, two token hashes, four immutable input profiles, two parent
// states plus deletion, and clock ranks 0..3 (expiry ranks 2/3).
// Profile 3 has profile 1's token/actor/login/audience but later timestamps and
// another optional node ID; conflicts preserve the stored row. Source matches
// actor/login/audience, not requested timestamps/node ID, on readback. The
// handler separately validates canonical times and marks parent issuance.
// Database operations and result delivery are distinct. INSERT captures only
// callback_complete parent status (not its expiry); local random tokens pass
// no parent. A readback can observe a row that another caller has just consumed
// or expired cleanup deleted. Returned data is its SELECT snapshot.
// Accurate D1 rows, atomic uniqueness and stable token derivation are assumed;
// callback claiming/terminal states and publication are modeled separately.
// The historical live-input readback action is excluded from step. No execution.
module identity_assertion_snapshot {
  val ids = Set(1, 2)
  type Record = { present: bool, actor: int, login: int, audience: int,
    node: int, created: int, expires: int, consumed: bool }
  type Input = { token: int, value: Record }
  val absent: Record = { present: false, actor: 0, login: 0, audience: 0,
    node: 0, created: 0, expires: 0, consumed: false }
  val first: Record = { present: true, actor: 1, login: 1, audience: 1,
    node: 1, created: 0, expires: 2, consumed: false }
  def profile(id: int): Input =
    if (id == 1) { token: 1, value: first }
    else if (id == 2) { token: 2, value: first.with("actor", 2).with("login", 2).with("audience", 2).with("node", 2) }
    else if (id == 3) { token: 1, value: first.with("node", 2).with("created", 1).with("expires", 3) }
    else { token: 1, value: first.with("actor", 2) }
  type Call = { phase: str, current: int, captured: int, linked: bool,
    parentOpen: bool, inserted: bool, result: str, returnedToken: int, returned: Record }
  val unused: Call = { phase: "unused", current: 1, captured: 0, linked: true,
    parentOpen: false, inserted: false, result: "none", returnedToken: 0, returned: absent }
  var s: { parent: str, now: int, rows: int -> Record, calls: int -> Call }
  action init = s' = { parent: "complete", now: 0, rows: ids.mapBy(_ => absent), calls: ids.mapBy(_ => unused) }
  action seed(id: int): bool = all { s.calls.get(1).phase == "unused", s.calls.get(2).phase == "unused",
    Set(1, 2, 3, 4).contains(id),
    s' = s.with("rows", s.rows.set(profile(id).token, profile(id).value)) }
  action parentState(value: str): bool = all { Set("complete", "issued", "absent").contains(value),
    s.parent == "complete", s' = s.with("parent", value) }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action begin(id: int, input: int, linked: bool): bool = all { s.calls.get(id).phase == "unused",
    Set(1, 2, 3, 4).contains(input), s' = s.with("calls", s.calls.set(id,
      unused.with("phase", "insert").with("current", input).with("captured", input).with("linked", linked))) }
  action changeInput(id: int, input: int): bool = all { Set(1, 2, 3, 4).contains(input),
    s.calls.get(id).phase != "unused", s' = s.with("calls", s.calls.set(id, s.calls.get(id).with("current", input))) }
  action insert(id: int): bool = {
    val c = s.calls.get(id) val input = profile(c.captured)
    val parentOpen = not(c.linked) or s.parent == "complete"
    val created = parentOpen and not(s.rows.get(input.token).present)
    all { c.phase == "insert", s' = s.with("rows", if (created) s.rows.set(input.token, input.value) else s.rows)
      .with("calls", s.calls.set(id, c.with("phase", "insert-reply").with("parentOpen", parentOpen).with("inserted", created))) }
  }
  action insertReply(id: int, outcome: str): bool = {
    val c = s.calls.get(id)
    all { c.phase == "insert-reply", Set("ok", "false", "error").contains(outcome),
      s' = s.with("calls", s.calls.set(id,
        if (outcome == "ok") c.with("phase", "readback")
        else c.with("phase", "done").with("result", if (outcome == "error") "error" else "null"))) }
  }
  def matches(row: Record, requested: Record): bool = row.present and not(row.consumed)
    and row.actor == requested.actor and row.login == requested.login and row.audience == requested.audience
  def readResult(c: Call, input: Input): Call = {
    val row = s.rows.get(input.token)
    val found = matches(row, input.value)
    c.with("phase", "done").with("result", if (found) "row" else "null")
      .with("returnedToken", if (found) input.token else 0).with("returned", if (found) row else absent)
  }
  action readback(id: int, succeeds: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "readback", s' = s.with("calls", s.calls.set(id,
      if (succeeds) readResult(c, profile(c.captured)) else c.with("phase", "done").with("result", "error"))) }
  }
  action consume(token: int, audience: int, stamp: int): bool = {
    val row = s.rows.get(token)
    val allowed = row.present and not(row.consumed) and row.audience == audience and stamp < row.expires
    all { ids.contains(token), ids.contains(audience), 0.to(3).contains(stamp),
      s' = if (allowed) s.with("rows", s.rows.set(token, row.with("consumed", true))) else s }
  }
  action cleanup = s' = s.with("rows", ids.mapBy(id => {
    val row = s.rows.get(id)
    if (row.present and row.expires <= s.now) absent else row
  }))
  action step = {
    nondet id = ids.oneOf() nondet input = Set(1, 2, 3, 4).oneOf()
    nondet yes = Set(false, true).oneOf() nondet outcome = Set("ok", "false", "error").oneOf()
    nondet audience = ids.oneOf() nondet stamp = 0.to(3).oneOf()
    any { seed(input), parentState("issued"), parentState("absent"), tick, begin(id, input, yes), changeInput(id, input),
      insert(id), insertReply(id, outcome), readback(id, yes), consume(id, audience, stamp), cleanup, s' = s }
  }
  val invariant = ids.forall(id => { val c = s.calls.get(id) val input = profile(c.captured)
    all { c.inserted implies c.parentOpen,
      c.result == "row" implies c.returnedToken == input.token and matches(c.returned, input.value) } })
  action ready(id: int, input: int, linked: bool): bool = begin(id, input, linked).then(insert(id)).then(insertReply(id, "ok"))
  action created(id: int, input: int, linked: bool): bool = ready(id, input, linked).then(readback(id, true))
  run normalCreateReturnsExactSnapshotTest = init.then(created(1, 1, true)).expect(s.calls.get(1).returned == first and invariant)
  run callerMutationCannotRetargetReadbackTest = init.then(seed(2)).then(ready(1, 1, true)).then(changeInput(1, 2)).then(readback(1, true)).expect(s.calls.get(1).returnedToken == 1 and invariant)
  run callerIdentityMutationCannotCauseFalseRefusalTest = init.then(ready(1, 1, true)).then(changeInput(1, 4)).then(readback(1, true)).expect(s.calls.get(1).result == "row" and invariant)
  run concurrentSameTokenKeepsFirstTimesTest = init.then(ready(1, 1, true)).then(created(2, 3, true)).then(readback(1, true)).expect(s.rows.get(1) == first and s.calls.get(2).returned.expires == 2 and invariant)
  run existingNodeAndTimesArePreservedTest = init.then(seed(1)).then(created(1, 3, true)).expect(s.calls.get(1).returned.node == 1 and s.calls.get(1).returned.created == 0 and invariant)
  run actorMismatchOnExistingTokenRefusesTest = init.then(seed(1)).then(created(1, 4, true)).expect(s.calls.get(1).result == "null" and invariant)
  run parentIssueBeforeInsertPreventsCreationTest = init.then(begin(1, 1, true)).then(parentState("issued")).then(insert(1)).then(insertReply(1, "ok")).then(readback(1, true)).expect(not(s.rows.get(1).present) and s.calls.get(1).result == "null" and invariant)
  run parentDeletionBeforeInsertPreventsCreationTest = init.then(begin(1, 1, true)).then(parentState("absent")).then(insert(1)).then(insertReply(1, "ok")).then(readback(1, true)).expect(not(s.rows.get(1).present) and invariant)
  run localTokenDoesNotRequireParentTest = init.then(parentState("absent")).then(created(1, 1, false)).expect(s.calls.get(1).result == "row" and invariant)
  run existingUnconsumedRowCanBeReadAfterParentIssuedTest = init.then(seed(1)).then(parentState("issued")).then(created(1, 1, true)).expect(not(s.calls.get(1).inserted) and s.calls.get(1).result == "row" and invariant)
  run consumedRowCannotBeReturnedTest = init.then(seed(1)).then(consume(1, 1, 0)).then(created(1, 1, true)).expect(s.calls.get(1).result == "null" and invariant)
  run consumeBetweenInsertAndReadbackRefusesTest = init.then(ready(1, 1, true)).then(consume(1, 1, 0)).then(readback(1, true)).expect(s.calls.get(1).result == "null" and invariant)
  run wrongAudienceDoesNotConsumeTest = init.then(ready(1, 1, true)).then(consume(1, 2, 0)).then(readback(1, true)).expect(s.calls.get(1).result == "row" and invariant)
  run exactExpiryDoesNotConsumeTest = init.then(ready(1, 1, true)).then(consume(1, 1, 2)).then(readback(1, true)).expect(s.calls.get(1).result == "row" and invariant)
  run cleanupBetweenInsertAndReadbackRefusesTest = init.then(ready(1, 1, true)).then(tick).then(tick).then(cleanup).then(readback(1, true)).expect(s.calls.get(1).result == "null" and invariant)
  run readbackSnapshotSurvivesLaterConsumptionTest = init.then(created(1, 1, true)).then(consume(1, 1, 0)).expect(not(s.calls.get(1).returned.consumed) and s.rows.get(1).consumed and invariant)
  run expiredExistingRowIsLeftForHandlerValidationTest = init.then(seed(1)).then(tick).then(tick).then(created(1, 1, true)).expect(s.calls.get(1).result == "row" and s.calls.get(1).returned.expires == s.now and invariant)
  run lostInsertReplyKeepsDurableRowTest = init.then(begin(1, 1, true)).then(insert(1)).then(insertReply(1, "error")).expect(s.rows.get(1).present and s.calls.get(1).result == "error" and invariant)
  run falseInsertResultKeepsDurableRowButReturnsNullTest = init.then(begin(1, 1, true)).then(insert(1)).then(insertReply(1, "false")).expect(s.rows.get(1).present and s.calls.get(1).result == "null" and invariant)
  run readbackFailureDoesNotUndoInsertTest = init.then(ready(1, 1, true)).then(readback(1, false)).expect(s.rows.get(1).present and s.calls.get(1).result == "error" and invariant)
  run issuedParentCannotRecreateCleanedRowTest = init.then(created(1, 1, true)).then(parentState("issued")).then(tick).then(tick).then(cleanup).then(created(2, 3, true)).expect(not(s.rows.get(1).present) and s.calls.get(2).result == "null" and invariant)
  // Historical implementation read the mutable object after awaiting INSERT.
  action oldReadback(id: int): bool = all { s.calls.get(id).phase == "readback",
    s' = s.with("calls", s.calls.set(id, readResult(s.calls.get(id), profile(s.calls.get(id).current)))) }
  run oldMutableInputCouldReturnAnotherTokenTest = init.then(seed(2)).then(ready(1, 1, true)).then(changeInput(1, 2)).then(oldReadback(1)).expect(s.calls.get(1).returnedToken == 2 and not(invariant))
}
