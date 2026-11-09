// @source workers/payments/scanner.ts
// @evidence workers/payments/scanner-progress.workflow.mjs
// scanEvmPayments only: two callers, two invocations each, blocks 0..6,
// page spans 1..3 and representative zero/two-log responses. One inclusive
// range per invocation. Grammar, BigInt/JSON parsing and RPC errors are
// represented by outcomes. Sorting includes a reversed pair and duplicates.
// Provider range/delivery completeness is NOT established. A successful
// callback promises durable verification under the caller contract; rejection
// may follow a committed effect. Actual ledger verification/idempotence is
// outside this helper model. Cursor writes compare canonical decimal strings
// by length then lexicographically. Equal writes are accepted; older writes
// cannot rewind. A lost reply can leave an advanced cursor. No lease prevents
// overlapping/retried delivery. New scenarios and regressions are unexecuted.
module evm_scan_checkpoint {
  val callers = Set(1, 2)
  type Worker = { phase: str, attempt: int, profile: int, span: int, headBlock: int,
    fromBlock: int, toBlock: int, entries: List[int], ordinal: int, calls: int,
    reply: str, returned: bool }
  type State = { cursor: int, initialCursor: int, started: bool,
    workers: int -> Worker, durable: Set[int], delivered: List[int],
    eligible: Set[int], committed: Set[int] }
  var s: State
  val fresh: Worker = { phase: "idle", attempt: 0, profile: 0, span: 2, headBlock: 6,
    fromBlock: -1, toBlock: -1, entries: List(), ordinal: 0, calls: 0,
    reply: "none", returned: false }
  action init = s' = { cursor: 0, initialCursor: 0, started: false,
    workers: Map(1 -> fresh, 2 -> fresh), durable: Set(), delivered: List(),
    eligible: Set(), committed: Set() }
  pure def stopped(w: Worker, reason: str): Worker = w.with("phase", "done").with("reply", reason)
  action seed(position: int): bool = all { not(s.started), (-1).to(6).contains(position),
    s' = s.with("cursor", position).with("initialCursor", position) }
  action configure(who: int, profile: int, span: int, headBlock: int): bool = {
    val w = s.workers.get(who)
    all { w.phase == "idle", 0.to(10).contains(profile), 1.to(3).contains(span), 0.to(6).contains(headBlock),
      s' = s.with("workers", s.workers.set(who, w.with("profile", profile).with("span", span).with("headBlock", headBlock))) }
  }
  action begin(who: int): bool = {
    val w = s.workers.get(who)
    all { Set("idle", "done").contains(w.phase), w.attempt < 2,
      s' = s.with("started", true).with("workers", s.workers.set(who,
        fresh.with("phase", "config").with("attempt", w.attempt + 1)
          .with("profile", w.profile).with("span", w.span).with("headBlock", w.headBlock).with("calls", w.calls))) }
  }
  action validate(who: int): bool = {
    val w = s.workers.get(who)
    all { w.phase == "config", s' = s.with("workers", s.workers.set(who,
      if (w.profile == 1) stopped(w, "config-error") else w.with("phase", "cursor"))) }
  }
  action readCursor(who: int): bool = {
    val w = s.workers.get(who)
    all { w.phase == "cursor", s' = s.with("workers", s.workers.set(who,
      if (s.cursor >= 0) w.with("fromBlock", s.cursor + 1).with("phase", "head")
      else if (w.profile == 2) stopped(w, "missing-origin") else w.with("phase", "origin"))) }
  }
  action origin(who: int, block: int): bool = {
    val w = s.workers.get(who)
    all { w.phase == "origin", 0.to(6).contains(block), s' = s.with("workers", s.workers.set(who,
      if (w.profile == 3) stopped(w, "origin-error") else w.with("fromBlock", block).with("phase", "head"))) }
  }
  action finalizedHead(who: int): bool = {
    val w = s.workers.get(who)
    val end = if (w.fromBlock + w.span - 1 < w.headBlock) w.fromBlock + w.span - 1 else w.headBlock
    all { w.phase == "head", s' = s.with("workers", s.workers.set(who,
      if (w.profile == 4) stopped(w, "head-error")
      else if (w.fromBlock > w.headBlock) stopped(w, "caught-up").with("returned", true)
      else w.with("toBlock", end).with("phase", "logs"))) }
  }
  action readLogs(who: int): bool = {
    val w = s.workers.get(who)
    // 8 is returned [2,1] then sorted; 9 preserves equal-position duplicates;
    // 10 contains an unexpected topic after the first successful callback.
    val rows = if (w.profile == 7) List(1) else if (w.profile == 8) List(1, 2)
      else if (w.profile == 9) List(1, 1) else if (w.profile == 10) List(1, 3) else List()
    all { w.phase == "logs", s' = s.with("workers", s.workers.set(who,
      if (w.profile == 5) stopped(w, "array-error") else if (w.profile == 6) stopped(w, "sort-error")
      else w.with("phase", "index").with("entries", rows))) }
  }
  action indexNext(who: int): bool = {
    val w = s.workers.get(who)
    all { w.phase == "index", s' =
      if (w.ordinal >= w.entries.length()) s.with("workers", s.workers.set(who, w.with("phase", "checkpoint")))
        .with("eligible", s.eligible.union(Set(w.toBlock)))
      else if (w.entries.nth(w.ordinal) == 3) s.with("workers", s.workers.set(who, stopped(w, "unexpected-topic")))
      else s.with("workers", s.workers.set(who, w.with("phase", "callback").with("calls", w.calls + 1)))
        .with("delivered", s.delivered.append(w.entries.nth(w.ordinal))) }
  }
  action indexResult(who: int, success: bool, landed: bool): bool = {
    val w = s.workers.get(who)
    val eventId = if (w.ordinal < w.entries.length()) w.entries.nth(w.ordinal) else 0
    all { w.phase == "callback", success implies landed,
      s' = s.with("durable", if (landed) s.durable.union(Set(eventId)) else s.durable)
        .with("workers", s.workers.set(who,
          if (success) w.with("phase", "index").with("ordinal", w.ordinal + 1) else stopped(w, "index-error"))) }
  }
  action commit(who: int): bool = {
    val w = s.workers.get(who)
    all { w.phase == "checkpoint", s' = s.with("cursor", if (w.toBlock > s.cursor) w.toBlock else s.cursor)
      .with("committed", s.committed.union(Set(w.toBlock)))
      .with("workers", s.workers.set(who, w.with("phase", "ack"))) }
  }
  action writeFailure(who: int): bool = {
    val w = s.workers.get(who)
    all { w.phase == "checkpoint", s' = s.with("workers", s.workers.set(who, stopped(w, "write-error"))) }
  }
  action acknowledge(who: int, delivered: bool): bool = {
    val w = s.workers.get(who)
    all { w.phase == "ack", s' = s.with("workers", s.workers.set(who,
      stopped(w, if (delivered) "success" else "lost-write-reply").with("returned", delivered))) }
  }
  action readFailure(who: int): bool = {
    val w = s.workers.get(who)
    all { Set("cursor", "origin", "head", "logs").contains(w.phase),
      s' = s.with("workers", s.workers.set(who, stopped(w, "read-error"))) }
  }
  action step = {
    nondet who = callers.oneOf() nondet profile = 0.to(10).oneOf()
    nondet block = 0.to(6).oneOf() nondet position = (-1).to(6).oneOf() nondet span = 1.to(3).oneOf()
    nondet yes = Set(false, true).oneOf() nondet landed = Set(false, true).oneOf()
    any { seed(position), configure(who, profile, span, block), begin(who), validate(who), readCursor(who),
      origin(who, block), finalizedHead(who), readLogs(who), indexNext(who), indexResult(who, yes, landed),
      commit(who), writeFailure(who), acknowledge(who, yes), readFailure(who), s' = s }
  }
  val invariant = all { s.cursor >= s.initialCursor, s.cursor <= 6,
    s.committed.subseteq(s.eligible), s.durable.subseteq(Set(1, 2)), s.delivered.length() <= 8,
    s.committed.forall(target => target <= s.cursor),
    s.cursor == s.initialCursor or s.committed.contains(s.cursor),
    callers.forall(who => {
      val w = s.workers.get(who)
      all { w.attempt <= 2, w.calls <= 4, w.ordinal <= 2,
        if (w.phase == "callback") w.entries.nth(w.ordinal) != 3 else true,
        Set("logs", "index", "callback", "checkpoint", "ack").contains(w.phase)
          implies w.fromBlock <= w.toBlock and w.toBlock <= w.headBlock
            and w.toBlock - w.fromBlock + 1 <= w.span,
        w.reply == "success" implies w.returned and s.cursor >= w.toBlock,
        w.returned implies Set("success", "caught-up").contains(w.reply) }
    }) }
  action toHead(who: int): bool = begin(who).then(validate(who)).then(readCursor(who))
  action toRows(who: int): bool = toHead(who).then(finalizedHead(who)).then(readLogs(who))
  action finishEmpty(who: int): bool = toRows(who).then(indexNext(who)).then(commit(who)).then(acknowledge(who, true))
  action indexed(who: int): bool = indexNext(who).then(indexResult(who, true, true))
  action finishRows(who: int): bool = indexed(who).then(indexed(who)).then(indexNext(who)).then(commit(who)).then(acknowledge(who, true))
  run oldCompletionCannotRewindTest = init.then(toRows(1)).then(indexNext(1))
    .then(finishEmpty(2)).then(finishEmpty(2)).then(commit(1)).then(acknowledge(1, true))
    .expect(s.cursor == 4 and invariant)
  run failedPageCannotAdvanceTest = init.then(toRows(1)).then(indexNext(1)).then(writeFailure(1))
    .expect(s.cursor == 0 and invariant).then(finishEmpty(1)).expect(s.cursor == 2 and invariant)
  run invalidConfigPrecedesCursorReadTest = init.then(configure(1, 1, 2, 6)).then(begin(1)).then(validate(1))
    .expect(s.workers.get(1).reply == "config-error" and s.cursor == 0 and invariant)
  run missingOriginRefusedTest = init.then(seed(-1)).then(configure(1, 2, 2, 6)).then(toHead(1))
    .expect(s.workers.get(1).reply == "missing-origin" and invariant)
  run revertedOriginRefusedTest = init.then(seed(-1)).then(configure(1, 3, 2, 6)).then(toHead(1)).then(origin(1, 1))
    .expect(s.workers.get(1).reply == "origin-error" and s.cursor == -1 and invariant)
  run originStartsInclusiveTest = init.then(seed(-1)).then(toHead(1)).then(origin(1, 4))
    .then(finalizedHead(1)).then(readLogs(1)).then(indexNext(1)).then(commit(1)).then(acknowledge(1, true))
    .expect(s.workers.get(1).fromBlock == 4 and s.cursor == 5 and invariant)
  run unavailableHeadRefusedTest = init.then(configure(1, 4, 2, 6)).then(toHead(1)).then(finalizedHead(1))
    .expect(s.workers.get(1).reply == "head-error" and invariant)
  run caughtUpMakesNoLogRequestTest = init.then(seed(6)).then(toHead(1)).then(finalizedHead(1))
    .expect(s.workers.get(1).reply == "caught-up" and s.workers.get(1).toBlock == -1 and invariant)
  run tailClampedToFinalizedHeadTest = init.then(seed(4)).then(configure(1, 0, 3, 5)).then(finishEmpty(1))
    .expect(s.workers.get(1).fromBlock == 5 and s.cursor == 5 and invariant)
  run invalidArrayDoesNotCheckpointTest = init.then(configure(1, 5, 2, 6)).then(toRows(1))
    .expect(s.workers.get(1).reply == "array-error" and s.cursor == 0 and invariant)
  run sortFailurePrecedesIndexTest = init.then(configure(1, 6, 2, 6)).then(toRows(1))
    .expect(s.workers.get(1).reply == "sort-error" and s.delivered == List() and invariant)
  run reversedResponseIndexedInCanonicalOrderTest = init.then(configure(1, 8, 2, 6)).then(toRows(1)).then(finishRows(1))
    .expect(s.delivered == List(1, 2) and s.cursor == 2 and invariant)
  run duplicateResponseIsDeliveredTwiceTest = init.then(configure(1, 9, 2, 6)).then(toRows(1)).then(finishRows(1))
    .expect(s.delivered == List(1, 1) and s.durable == Set(1) and invariant)
  run laterUnexpectedTopicKeepsEarlierEffectTest = init.then(configure(1, 10, 2, 6)).then(toRows(1)).then(indexed(1)).then(indexNext(1))
    .expect(s.durable == Set(1) and s.cursor == 0 and s.workers.get(1).reply == "unexpected-topic" and invariant)
  run callbackFailureKeepsEarlierEffectTest = init.then(configure(1, 8, 2, 6)).then(toRows(1)).then(indexed(1))
    .then(indexNext(1)).then(indexResult(1, false, false)).expect(s.durable == Set(1) and s.cursor == 0 and invariant)
  run callbackMayCommitBeforeRejectionTest = init.then(configure(1, 7, 2, 6)).then(toRows(1))
    .then(indexNext(1)).then(indexResult(1, false, true))
    .expect(s.durable == Set(1) and s.cursor == 0 and not(s.workers.get(1).returned) and invariant)
  run retryRedeliversCompletedPrefixTest = init.then(configure(1, 8, 2, 6)).then(toRows(1)).then(indexed(1))
    .then(indexNext(1)).then(indexResult(1, false, false)).then(toRows(1)).then(finishRows(1))
    .expect(s.delivered == List(1, 2, 1, 2) and s.cursor == 2 and invariant)
  run lostWriteReplyKeepsCursorTest = init.then(toRows(1)).then(indexNext(1)).then(commit(1)).then(acknowledge(1, false))
    .expect(s.cursor == 2 and not(s.workers.get(1).returned) and invariant)
    .then(finishEmpty(1)).expect(s.workers.get(1).fromBlock == 3 and s.cursor == 4 and invariant)
  run readFailureReturnsNoCompletionTest = init.then(toHead(1)).then(readFailure(1))
    .expect(s.cursor == 0 and not(s.workers.get(1).returned) and invariant)
  run emptyResponseCanAdvanceWithoutEventEvidenceTest = init.then(finishEmpty(1))
    .expect(s.cursor == 2 and s.durable == Set() and s.delivered == List() and invariant)
}
