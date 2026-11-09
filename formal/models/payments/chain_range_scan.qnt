// @source workers/referral-accrual/chain-logs.ts
// @source src/lib/escrow-policy.mjs
// @source scripts/check-referral-roots.ts
// @evidence scripts/referral-log-ranges.test.ts
// scanReferralLogs only. EVM/Solana payment scanners have their own checkpoint
// models; this helper returns one complete array and persists no cursor.
// Two calls, bounds0..5, configured page size1..3, at most two values per reply.
// check-referral-roots is linked for its use of this helper only; its broader
// verification/report orchestration remains a separate source-review boundary.
// Covered means a range read resolved, not that a provider returned every log.
// Returned values are kept in reply order, including duplicates. An exception
// exposes no partial result; a later invocation restarts the original range.
// Configuration is validated even for an empty range. Source uses exact bigint
// arithmetic; finite integers here represent inclusive block boundaries.
module chain_range_scan {
  val bounds = 0.to(5)
  type State = { phase: str, invocation: int, first: int, last: int, size: int,
    configured: bool, nextBlock: int, pendingFrom: int, pendingTo: int,
    ranges: List[(int, int)], covered: Set[int], values: List[int], output: List[int], failed: bool }
  var s: State
  action init = s' = { phase: "input", invocation: 1, first: 0, last: 5, size: 2,
    configured: true, nextBlock: 0, pendingFrom: 0, pendingTo: 0,
    ranges: List(), covered: Set(), values: List(), output: List(), failed: false }
  action configure(first: int, last: int, size: int, configured: bool): bool = all {
    s.phase == "input", bounds.contains(first), bounds.contains(last), Set(1, 2, 3).contains(size),
    s' = s.with("first", first).with("last", last).with("size", size).with("configured", configured) }
  action begin = all { s.phase == "input",
    s' = if (not(s.configured)) s.with("phase", "failed").with("failed", true)
      else s.with("phase", "iterate").with("nextBlock", s.first) }
  action request = {
    val end = if (s.nextBlock + s.size - 1 < s.last) s.nextBlock + s.size - 1 else s.last
    all { s.phase == "iterate", s.nextBlock <= s.last,
      s' = s.with("phase", "waiting").with("pendingFrom", s.nextBlock).with("pendingTo", end)
        .with("ranges", s.ranges.append((s.nextBlock, end))) }
  }
  action reply(values: List[int]): bool = all { s.phase == "waiting", values.length() <= 2,
    values.indices().forall(i => Set(1, 2).contains(values[i])),
    s' = s.with("phase", "iterate").with("values", s.values.concat(values))
      .with("covered", s.covered.union(s.pendingFrom.to(s.pendingTo))).with("nextBlock", s.nextBlock + s.size) }
  action failRead = all { s.phase == "waiting",
    s' = s.with("phase", "failed").with("failed", true) }
  action publish = all { s.phase == "iterate", s.nextBlock > s.last,
    s' = s.with("phase", "done").with("output", s.values) }
  action retry = all { Set("failed", "done").contains(s.phase), s.invocation == 1,
    s' = s.with("phase", "input").with("invocation", 2).with("nextBlock", s.first)
      .with("ranges", List()).with("covered", Set()).with("values", List()).with("output", List()).with("failed", false) }
  action step = {
    nondet first = bounds.oneOf() nondet last = bounds.oneOf() nondet size = Set(1, 2, 3).oneOf()
    nondet configured = Set(false, true).oneOf()
    nondet values = Set(List(), List(1), List(2), List(1, 1), List(1, 2), List(2, 1), List(2, 2)).oneOf()
    any { configure(first, last, size, configured), begin, request, reply(values), failRead, publish, retry, s' = s }
  }
  val invariant = all { s.invocation <= 2,
    s.phase == "done" implies s.output == s.values and s.covered == s.first.to(s.last),
    s.failed implies s.output == List(),
    s.ranges.indices().forall(i => {
      val range = s.ranges[i]
      range._1 <= range._2 and range._2 <= s.last and range._2 - range._1 < s.size
        and (if (i == 0) range._1 == s.first else range._1 == s.ranges[i - 1]._1 + s.size)
    }) }
  action page = request.then(reply(List(1)))
  run completePagesTest = init.then(begin).then(page).then(page).then(page).then(publish)
    .expect(s.covered == 0.to(5) and s.output == List(1, 1, 1) and invariant)
  run retryDoesNotSkipTest = init.then(begin).then(page).then(request).then(failRead).then(retry).then(begin)
    .then(request).expect(s.pendingFrom == 0 and s.values == List() and invariant)
  run incompleteRefusedTest = init.then(begin).then(page).then(request).then(failRead).then(publish.fail())
  run finalPageIsClampedToLastBlockTest = init.then(configure(1, 5, 3, true)).then(begin).then(page).then(request)
    .expect(s.pendingFrom == 4 and s.pendingTo == 5 and invariant).then(reply(List())).then(publish)
    .expect(s.covered == 1.to(5) and invariant)
  run singleBlockStillNeedsOneReadTest = init.then(configure(3, 3, 2, true)).then(begin).then(request)
    .expect(s.pendingFrom == 3 and s.pendingTo == 3).then(reply(List(2))).then(publish).expect(s.output == List(2) and invariant)
  run emptyRangeReturnsWithoutRpcTest = init.then(configure(4, 3, 2, true)).then(begin).then(publish)
    .expect(s.output == List() and s.ranges == List() and invariant)
  run emptyRangeStillRequiresConfigurationTest = init.then(configure(4, 3, 2, false)).then(begin)
    .expect(s.failed and s.ranges == List() and invariant)
  run emptySuccessfulRepliesStillCompleteQueryCoverageTest = init.then(begin).then(request).then(reply(List()))
    .then(request).then(reply(List())).then(request).then(reply(List())).then(publish)
    .expect(s.output == List() and s.covered == 0.to(5) and invariant)
  run duplicateReplyValuesRemainDuplicatesTest = init.then(configure(0, 0, 1, true)).then(begin).then(request)
    .then(reply(List(2, 2))).then(publish).expect(s.output == List(2, 2) and invariant)
  run returnedValuesKeepPageAndWithinPageOrderTest = init.then(configure(0, 1, 1, true)).then(begin)
    .then(request).then(reply(List(2, 1))).then(request).then(reply(List(1, 2))).then(publish)
    .expect(s.output == List(2, 1, 1, 2) and invariant)
  run firstReadFailureReturnsNoPrefixTest = init.then(begin).then(request).then(failRead)
    .expect(s.output == List() and s.covered == Set() and invariant)
  run finalReadFailureKeepsOnlyInternalPrefixTest = init.then(begin).then(page).then(page).then(request).then(failRead)
    .expect(s.values == List(1, 1) and s.output == List() and invariant)
}
