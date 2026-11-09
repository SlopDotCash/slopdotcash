// @source workers/slopbot/value-disputes.ts
// @source workers/slopbot/review.ts
// @source workers/slopbot/persistence.ts
// @evidence workers/slopbot/penalty-appeal.test.ts
// Two reads, two immutable single records and one joint successor. One
// delivery binding is first-writer-wins. Current lookup and retained lookup
// are different: a current joint row takes precedence, even when invalid;
// retained lookup uses its exact digest after later corrections. SQL lookup,
// digest verification, parsing and identity validation are separate outcomes.
// The source's hash/JSON/schema/identity predicates are finite input classes,
// not a proof of their implementation. Missing current rows return null;
// missing retained rows fail. No query is a transaction with later binding.
// The caller's authorization and appeal decision are modeled separately.
// All scenarios are source-authored and unexecuted.
module bot_value_dispute_read {
  val ids = Set(1, 2)
  val faults = Set("ok", "digest", "json", "project", "schema", "repository", "item", "head", "policy", "number", "joint-source")
  type Read = { mode: str, phase: str, row: int, fault: str, result: int }
  val unused: Read = { mode: "current", phase: "unused", row: 0, fault: "ok", result: 0 }
  var s: { single: int, joint: bool, bound: int, calls: int -> Read,
    known: Set[int] }
  action init = s' = { single: 1, joint: false, bound: 0,
    calls: ids.mapBy(_ => unused), known: Set(1, 2, 3) }
  action correctSingle = all { s.single == 1, s' = s.with("single", 2) }
  action jointSuccessor = all { not(s.joint), s' = s.with("joint", true) }
  action start(id: int, mode: str, fault: str): bool = all {
    ids.contains(id), Set("current", "retained").contains(mode), faults.contains(fault),
    s.calls.get(id).phase == "unused",
    s' = s.with("calls", s.calls.set(id, unused.with("mode", mode).with("fault", fault)
      .with("phase", if (mode == "current") "joint-query" else "key"))) }
  action validateKey(id: int, valid: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "key", s' = s.with("calls", s.calls.set(id,
      c.with("phase", if (valid and s.bound > 0) "retained-query" else "key-error"))) }
  }
  action jointQuery(id: int, available: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "joint-query", s' = s.with("calls", s.calls.set(id,
      if (not(available)) c.with("phase", "query-error")
      else if (s.joint) c.with("row", 3).with("phase", "digest")
      else c.with("phase", "single-query"))) }
  }
  action singleQuery(id: int, available: bool, isPresent: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "single-query", s' = s.with("calls", s.calls.set(id,
      if (not(available)) c.with("phase", "query-error")
      else if (not(isPresent)) c.with("phase", "null")
      else c.with("row", s.single).with("phase", "digest"))) }
  }
  action retainedQuery(id: int, available: bool, isPresent: bool): bool = {
    val c = s.calls.get(id)
    all { c.phase == "retained-query", s' = s.with("calls", s.calls.set(id,
      if (not(available)) c.with("phase", "query-error")
      else if (not(isPresent)) c.with("phase", "missing-error")
      else c.with("row", s.bound).with("phase", "digest"))) }
  }
  action digest(id: int): bool = {
    val c = s.calls.get(id)
    all { c.phase == "digest", s' = s.with("calls", s.calls.set(id,
      c.with("phase", if (c.fault == "digest") "digest-error" else "parse"))) }
  }
  action parse(id: int): bool = {
    val c = s.calls.get(id)
    all { c.phase == "parse", s' = s.with("calls", s.calls.set(id,
      c.with("phase", if (c.fault == "json") "json-error" else "identity"))) }
  }
  action identity(id: int): bool = {
    val c = s.calls.get(id)
    val invalid = Set("project", "schema", "repository", "item", "head", "policy").contains(c.fault)
      or (c.row == 3 and c.fault == "joint-source")
    all { c.phase == "identity", s' = s.with("calls", s.calls.set(id,
      if (invalid) c.with("phase", "identity-error")
      else if (c.mode == "retained" and c.fault == "number") c.with("phase", "number-error")
      else c.with("phase", "ok").with("result", c.row))) }
  }
  action bindDelivery(id: int): bool = {
    val c = s.calls.get(id)
    all { c.mode == "current", c.phase == "ok",
      s' = if (s.bound == 0) s.with("bound", c.result) else s }
  }
  action oldRetargetRetained(id: int): bool = {
    val c = s.calls.get(id)
    all { c.mode == "retained", c.phase == "ok", c.result != (if (s.joint) 3 else s.single),
      s' = s.with("calls", s.calls.set(id, c.with("result", if (s.joint) 3 else s.single))) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet mode = Set("current", "retained").oneOf()
    nondet fault = faults.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet isPresent = Set(false, true).oneOf()
    any { correctSingle, jointSuccessor, start(id, mode, fault), validateKey(id, yes),
      jointQuery(id, yes), singleQuery(id, yes, isPresent), retainedQuery(id, yes, isPresent),
      digest(id), parse(id), identity(id), bindDelivery(id), s' = s }
  }
  val invariant = all {
    Set(1, 2).contains(s.single), Set(0, 1, 2, 3).contains(s.bound),
    ids.forall(id => {
      val c = s.calls.get(id)
      all { Set(0, 1, 2, 3).contains(c.row),
        c.phase == "ok" implies c.result == c.row and s.known.contains(c.result),
        c.mode == "retained" and c.phase == "ok" implies c.result == s.bound }
    }) }
  action validated(id: int): bool = digest(id).then(parse(id)).then(identity(id))
  action current(id: int): bool = start(id, "current", "ok").then(jointQuery(id, true)).then(singleQuery(id, true, true)).then(validated(id))
  action retained(id: int): bool = start(id, "retained", "ok").then(validateKey(id, true)).then(retainedQuery(id, true, true)).then(validated(id))
  run currentSingleTest = init.then(current(1)).expect(s.calls.get(1).result == 1 and invariant)
  run jointTakesPrecedenceTest = init.then(jointSuccessor).then(start(1, "current", "ok"))
    .then(jointQuery(1, true)).then(validated(1)).expect(s.calls.get(1).result == 3 and invariant)
  run invalidJointDoesNotFallBackTest = init.then(jointSuccessor).then(start(1, "current", "digest"))
    .then(jointQuery(1, true)).then(digest(1))
    .expect(s.calls.get(1).phase == "digest-error" and invariant).then(singleQuery(1, true, true).fail())
  run missingCurrentIsNullTest = init.then(start(1, "current", "ok")).then(jointQuery(1, true))
    .then(singleQuery(1, true, false)).expect(s.calls.get(1).phase == "null" and invariant)
  run currentQueryFailureTest = init.then(start(1, "current", "ok")).then(jointQuery(1, false))
    .expect(s.calls.get(1).phase == "query-error" and invariant)
  run correctionDoesNotRetargetRetainedReadTest = init.then(current(1)).then(bindDelivery(1)).then(correctSingle)
    .then(jointSuccessor).then(retained(2)).expect(s.calls.get(2).result == 1 and s.bound == 1 and invariant)
  run capturedCurrentRowSurvivesLaterCorrectionTest = init.then(start(1, "current", "ok")).then(jointQuery(1, true))
    .then(singleQuery(1, true, true)).then(correctSingle).then(validated(1)).then(bindDelivery(1))
    .expect(s.bound == 1 and s.single == 2 and invariant)
  run firstDeliveryBindingWinsTest = init.then(current(1)).then(correctSingle).then(current(2))
    .then(bindDelivery(2)).then(bindDelivery(1)).expect(s.bound == 2 and invariant)
  run malformedBindingFailsBeforeQueryTest = init.then(start(1, "retained", "ok")).then(validateKey(1, false))
    .expect(s.calls.get(1).phase == "key-error" and invariant)
  run missingRetainedRowFailsTest = init.then(current(1)).then(bindDelivery(1)).then(start(2, "retained", "ok"))
    .then(validateKey(2, true)).then(retainedQuery(2, true, false)).expect(s.calls.get(2).phase == "missing-error" and invariant)
  run invalidJsonFailsAfterDigestTest = init.then(start(1, "current", "json")).then(jointQuery(1, true))
    .then(singleQuery(1, true, true)).then(digest(1)).then(parse(1)).expect(s.calls.get(1).phase == "json-error" and invariant)
  run wrongProjectFailsTest = init.then(start(1, "current", "project")).then(jointQuery(1, true))
    .then(singleQuery(1, true, true)).then(validated(1)).expect(s.calls.get(1).phase == "identity-error" and invariant)
  run jointWithoutItemSourceFailsTest = init.then(jointSuccessor).then(start(1, "current", "joint-source"))
    .then(jointQuery(1, true)).then(validated(1)).expect(s.calls.get(1).phase == "identity-error" and invariant)
  run invalidHeadFailsTest = init.then(start(1, "current", "head")).then(jointQuery(1, true))
    .then(singleQuery(1, true, true)).then(validated(1)).expect(s.calls.get(1).phase == "identity-error" and invariant)
  run retainedNumberMismatchFailsTest = init.then(current(1)).then(bindDelivery(1)).then(start(2, "retained", "number"))
    .then(validateKey(2, true)).then(retainedQuery(2, true, true)).then(validated(2))
    .expect(s.calls.get(2).phase == "number-error" and invariant)
  run oldRetargetNegativeControlTest = init.then(current(1)).then(bindDelivery(1)).then(correctSingle).then(retained(2))
    .then(oldRetargetRetained(2)).expect(not(invariant))
}
