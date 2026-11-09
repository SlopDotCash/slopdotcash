// @source backend/security/direct-solana-recovery.ts
// @source backend/security/direct-payments.ts
// @source backend/security/handler.ts
// @source workers/fee-converter/solana-expiry.ts
// @source workers/fee-converter/verified-expiry.ts
// @source migrations/0112_direct_payment_recovery.sql
// @source migrations/0113_direct_unpaid_leg_recovery.sql
// @evidence formal/tests/direct-solana-retirement.test.ts
// @evidence backend/security/direct-solana-api.integration.ts
// PRD sections 8, 11 (private payment recovery) and 12 STATE-02.
// This refines the nondeterministic retirement result in private_recovery_progress,
// which already models two plans/callers, signature adoption and idempotency.
// Two callers capture the same generation and its two immutable issued plans.
// Both already have valid payer signatures and qualified independent providers;
// all retained messages are expired. The lower chain/crypto admission remains
// in solana_history_retirement and direct_solana_retirement, not proved here.
// begin is the already-admitted context boundary. Split case/context reads,
// signature adoption and idempotent replies remain in private_recovery_progress.
//
// Per caller, visit plans first, providers second. A non-null nonmatching-failure
// observation is payment-found, not a verified payment. Matching exact finalized
// failures retire that plan without a scan; one failure plus absence holds.
// Otherwise absence proof reads/resumes each provider's immutable scan. Four
// journal keys are (generation 0, plan signature, provider); each has at most two
// appended revisions, abstracting at most two bounded batches, not a production
// page/window limit. Progress 1 is incomplete, 2 complete. Tip IDs 1/2 denote
// complete horizon/block/digest identities, not monotonically ordered heights.
// The supplied scan-tip predicate includes fresh genesis/anchor/expiry/status,
// canonical history and exact traversal checks in proveSolanaExpiry.
//
// Scan read, computed page, atomic SQL CAS and reply are distinct. A conflicting
// or lost write response makes this invocation history-check; committed rows
// survive. Each caller must itself observe matching complete provider coverage
// for each absent plan. Another caller's later completion does not retroactively
// turn an incomplete local result into retirement. The final case transaction
// separately fences captured revision/generation/target/current authorization.
// Stale or failed case writes never delete independent scan evidence.
// Here a lost scan reply follows its commit; an unknown reply preceding a late
// commit is separately retained by private_recovery_progress's delayed-scan path.
//
// Bound: 2 requests, 2 plans, 2 providers, 2 tips, 2 revisions per scan key,
// case revisions 1..4 and generation 0..1. No new plan is issued within this
// captured generation; current refresh refuses expired requests, and a successor
// requires the case CAS. No keys, provider calls or financial actions occur.
// Existing test references supply source context, not a concurrent hosted/SQLite
// execution receipt. All scenarios below are authored and unexecuted.
module private_recovery_scan_concurrency {
  val ids = Set(1, 2)
  val pairs = Set(1, 2, 3, 4)
  type Scan = { pair: int, revision: int, tip: int, progress: int }
  type Call = { phase: str, revision: int, generation: int, target: int,
    plan: int, provider: int, observations: int -> str, failureIds: int -> int,
    proofs: Set[int], donePlans: Set[int], found: bool, incomplete: bool,
    horizon: int, covered: Set[int], coverageTips: int -> int,
    prior: Scan, pending: Scan, result: str, committed: bool, response: str }
  val noScan: Scan = { pair: 1, revision: 0, tip: 0, progress: 0 }
  val noCall: Call = { phase: "unused", revision: 0, generation: 0, target: 0,
    plan: 1, provider: 1, observations: pairs.mapBy(_ => "none"), failureIds: pairs.mapBy(_ => 0),
    proofs: Set(), donePlans: Set(), found: false, incomplete: false,
    horizon: 0, covered: Set(), coverageTips: pairs.mapBy(_ => 0),
    prior: noScan, pending: noScan, result: "none", committed: false, response: "none" }
  var s: { revision: int, generation: int, target: int, authorized: bool,
    calls: int -> Call, latest: int -> Scan, history: Set[Scan], successor: int }
  pure def pair(plan: int, provider: int): int = (plan - 1) * 2 + provider
  def finish(call: Call, result: str): Call = call
    .with("phase", if (result == "retired") "prepare" else "case-ready").with("result", result)
  def advancePlan(call: Call): Call = call.with("donePlans", call.donePlans.union(Set(call.plan)))
    .with("plan", if (call.plan == 1) 2 else call.plan).with("provider", 1)
    .with("phase", if (call.plan == 1) "observe" else "finish")
  def coveredProvider(call: Call, scan: Scan): Call = call
    .with("covered", if (scan.progress == 2) call.covered.union(Set(scan.pair)) else call.covered)
    .with("coverageTips", call.coverageTips.set(scan.pair, scan.tip))
    .with("provider", if (call.provider == 1) 2 else call.provider)
    .with("phase", if (call.provider == 1) "scan-read" else "scan-finish")
  action init = s' = { revision: 1, generation: 0, target: 1, authorized: true,
    calls: ids.mapBy(_ => noCall), latest: pairs.mapBy(p => noScan.with("pair", p)),
    history: Set(), successor: 0 }
  action begin(id: int): bool = all { ids.contains(id), s.calls.get(id).phase == "unused", s.generation == 0, s.authorized,
    s' = s.with("calls", s.calls.set(id, noCall.with("phase", "observe")
      .with("revision", s.revision).with("generation", s.generation).with("target", s.target))) }
  action observe(id: int, kind: str, failureId: int): bool = {
    val call = s.calls.get(id)
    val index = pair(call.plan, call.provider)
    all { call.phase == "observe", Set("absent", "failed", "found").contains(kind), ids.contains(failureId),
      s' = s.with("calls", s.calls.set(id, call.with("observations", call.observations.set(index, kind))
        .with("failureIds", call.failureIds.set(index, if (kind == "failed") failureId else 0))
        .with("provider", if (call.provider == 1) 2 else call.provider)
        .with("phase", if (call.provider == 1) "observe" else "plan-result"))) }
  }
  action observationError(id: int): bool = all { s.calls.get(id).phase == "observe",
    s' = s.with("calls", s.calls.set(id, finish(s.calls.get(id), "history-check"))) }
  action planResult(id: int): bool = {
    val call = s.calls.get(id)
    val first = pair(call.plan, 1)
    val second = pair(call.plan, 2)
    val found = call.found or call.observations.get(first) == "found" or call.observations.get(second) == "found"
    val failed = call.observations.get(first) == "failed" or call.observations.get(second) == "failed"
    val matched = call.observations.get(first) == "failed" and call.observations.get(second) == "failed"
      and call.failureIds.get(first) == call.failureIds.get(second)
    val nextCall = if (found) advancePlan(call.with("found", true))
      else if (failed) advancePlan(if (matched) call.with("proofs", call.proofs.union(Set(call.plan)))
        else call.with("incomplete", true))
      else call.with("phase", "scan-read").with("provider", 1).with("horizon", 0)
    all { call.phase == "plan-result", s' = s.with("calls", s.calls.set(id, nextCall)) }
  }
  action readScan(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "scan-read", s' = s.with("calls", s.calls.set(id,
      call.with("prior", s.latest.get(pair(call.plan, call.provider))).with("phase", "scan-tip"))) }
  }
  action scanTip(id: int, observedTip: int): bool = {
    val call = s.calls.get(id)
    val horizon = if (call.horizon != 0) call.horizon
      else if (call.prior.revision > 0) call.prior.tip else observedTip
    val matches = observedTip == horizon and (call.prior.revision == 0 or call.prior.tip == horizon)
    val observed = call.with("horizon", horizon)
    val nextCall = if (not(matches)) advancePlan(call.with("incomplete", true))
      else if (call.prior.progress == 2) coveredProvider(observed, call.prior)
      else observed.with("phase", "scan-page")
    all { call.phase == "scan-tip", ids.contains(observedTip), s' = s.with("calls", s.calls.set(id, nextCall)) }
  }
  action page(id: int, complete: bool): bool = {
    val call = s.calls.get(id)
    val nextScan: Scan = { pair: pair(call.plan, call.provider), revision: call.prior.revision + 1,
      tip: call.horizon, progress: if (complete) 2 else 1 }
    all { call.phase == "scan-page", call.prior.revision < 2,
      s' = s.with("calls", s.calls.set(id, call.with("pending", nextScan).with("phase", "page-write"))) }
  }
  action commitPage(id: int): bool = {
    val call = s.calls.get(id)
    val matches = s.latest.get(call.pending.pair).revision == call.prior.revision
    all { call.phase == "page-write",
      s' = s.with("latest", if (matches) s.latest.set(call.pending.pair, call.pending) else s.latest)
        .with("history", if (matches) s.history.union(Set(call.pending)) else s.history)
        .with("calls", s.calls.set(id, if (matches) call.with("phase", "page-reply")
          else finish(call, "history-check"))) }
  }
  action pageReply(id: int, received: bool): bool = {
    val call = s.calls.get(id)
    all { call.phase == "page-reply", s' = s.with("calls", s.calls.set(id,
      if (received) coveredProvider(call, call.pending) else finish(call, "history-check"))) }
  }
  action scanError(id: int): bool = all {
    Set("scan-read", "scan-tip", "scan-page", "page-write").contains(s.calls.get(id).phase),
    s' = s.with("calls", s.calls.set(id, finish(s.calls.get(id), "history-check"))) }
  action finishScan(id: int): bool = {
    val call = s.calls.get(id)
    val first = pair(call.plan, 1)
    val second = pair(call.plan, 2)
    val complete = call.covered.contains(first) and call.covered.contains(second)
      and call.coverageTips.get(first) == call.coverageTips.get(second)
    all { call.phase == "scan-finish", s' = s.with("calls", s.calls.set(id,
      advancePlan(if (complete) call.with("proofs", call.proofs.union(Set(call.plan)))
        else call.with("incomplete", true)))) }
  }
  action finishRetirement(id: int): bool = {
    val call = s.calls.get(id)
    all { call.phase == "finish", s' = s.with("calls", s.calls.set(id,
      finish(call, if (call.found) "payment-found"
        else if (call.incomplete or call.proofs != ids) "history-check" else "retired"))) }
  }
  // Successor transaction preparation can fail after retirement proof; the
  // existing immutable scans remain useful to the next authorized attempt.
  action prepareSuccessor(id: int, succeeds: bool): bool = all { s.calls.get(id).phase == "prepare",
    s' = s.with("calls", s.calls.set(id, s.calls.get(id)
      .with("phase", if (succeeds) "case-ready" else "done")
      .with("response", if (succeeds) "none" else "prepare-error"))) }
  action commitCase(id: int): bool = {
    val call = s.calls.get(id)
    val matches = s.revision == call.revision and s.generation == call.generation
      and s.target == call.target and s.authorized
    val successor = call.result == "retired"
    all { call.phase == "case-ready", not(matches) or s.revision < 4,
      s' = s.with("revision", if (matches) s.revision + 1 else s.revision)
        .with("generation", if (matches and successor) 1 else s.generation)
        .with("successor", if (matches and successor) id else s.successor)
        .with("calls", s.calls.set(id, call.with("committed", matches)
          .with("phase", if (matches) "case-reply" else "done")
          .with("response", if (matches) "none" else "stale"))) }
  }
  action caseFailure(id: int): bool = all { s.calls.get(id).phase == "case-ready",
    s' = s.with("calls", s.calls.set(id, s.calls.get(id).with("phase", "done").with("response", "case-error"))) }
  action caseReply(id: int, received: bool): bool = all { s.calls.get(id).phase == "case-reply",
    s' = s.with("calls", s.calls.set(id, s.calls.get(id).with("phase", "done")
      .with("response", if (received) "ok" else "reply-lost"))) }
  action otherCaseWrite = all { s.revision < 3, s' = s.with("revision", s.revision + 1) }
  action otherSuccessor = all { s.generation == 0, s.revision < 3,
    s' = s.with("generation", 1).with("revision", s.revision + 1) }
  action changeTarget = all { s.target == 1, s' = s.with("target", 2) }
  action revokeAuthorization = s' = s.with("authorized", false)
  action step = {
    nondet id = ids.oneOf()
    nondet chosenIdentity = ids.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet kind = Set("absent", "failed", "found").oneOf()
    any { begin(id), observe(id, kind, chosenIdentity), observationError(id), planResult(id), readScan(id), scanTip(id, chosenIdentity),
      page(id, yes), commitPage(id), pageReply(id, yes), scanError(id), finishScan(id), finishRetirement(id),
      prepareSuccessor(id, yes), commitCase(id), caseFailure(id), caseReply(id, yes),
      otherCaseWrite, otherSuccessor, changeTarget, revokeAuthorization, s' = s }
  }
  val invariant = all { s.revision >= 1 and s.revision <= 4, s.generation >= 0 and s.generation <= 1,
    s.history.size() <= 8,
    pairs.forall(index => s.latest.get(index).revision <= 2 and
      (s.latest.get(index).revision == 0 or s.history.contains(s.latest.get(index)))),
    s.history.forall(a => s.history.forall(b => (a.pair == b.pair and a.revision == b.revision) implies a == b)),
    ids.forall(id => {
      val call = s.calls.get(id)
      all { call.result == "retired" implies call.donePlans == ids and call.proofs == ids and not(call.found) and not(call.incomplete),
        call.proofs.subseteq(ids), call.donePlans.subseteq(ids),
        call.covered.forall(index => s.history.exists(row => row.pair == index and row.progress == 2
          and row.tip == call.coverageTips.get(index))),
        call.proofs.forall(plan => {
          val first = pair(plan, 1)
          val second = pair(plan, 2)
          (call.observations.get(first) == "failed" and call.observations.get(second) == "failed"
            and call.failureIds.get(first) == call.failureIds.get(second))
          or (call.covered.contains(first) and call.covered.contains(second)
            and call.coverageTips.get(first) == call.coverageTips.get(second))
        }),
        call.response == "ok" implies call.committed }
    }),
    s.successor != 0 implies s.calls.get(s.successor).committed and s.calls.get(s.successor).result == "retired" }
  action absent(id: int): bool = observe(id, "absent", 1).then(observe(id, "absent", 1)).then(planResult(id))
  action failedPlan(id: int): bool = observe(id, "failed", 1).then(observe(id, "failed", 1)).then(planResult(id))
  action freshProvider(id: int, complete: bool): bool = readScan(id).then(scanTip(id, 1)).then(page(id, complete))
    .then(commitPage(id)).then(pageReply(id, true))
  action freshAbsentPlan(id: int): bool = absent(id).then(freshProvider(id, true)).then(freshProvider(id, true)).then(finishScan(id))
  action reusedProvider(id: int): bool = readScan(id).then(scanTip(id, 1))
  action reusedAbsentPlan(id: int): bool = absent(id).then(reusedProvider(id)).then(reusedProvider(id)).then(finishScan(id))
  action failedRetirement(id: int): bool = begin(id).then(failedPlan(id)).then(failedPlan(id))
    .then(finishRetirement(id)).then(prepareSuccessor(id, true))

  run bothAbsentPlansNeedCompleteMatchingCoverageTest = init.then(begin(1)).then(freshAbsentPlan(1)).then(freshAbsentPlan(1))
    .then(finishRetirement(1)).then(prepareSuccessor(1, true)).then(commitCase(1)).then(caseReply(1, true))
    .expect(s.calls.get(1).proofs == ids and s.history.size() == 4 and s.successor == 1 and invariant)
  run failedAndAbsentPlansComposeWithoutInventedScanTest = init.then(begin(1)).then(failedPlan(1)).then(freshAbsentPlan(1))
    .then(finishRetirement(1)).expect(s.calls.get(1).result == "retired" and s.history.size() == 2 and invariant)
  run concurrentPageCASRetainsOnlyWinnerTest = init.then(begin(1)).then(begin(2)).then(absent(1)).then(absent(2))
    .then(readScan(1)).then(readScan(2)).then(scanTip(1, 1)).then(scanTip(2, 1)).then(page(1, true)).then(page(2, true))
    .then(commitPage(1)).then(commitPage(2))
    .expect(s.history.size() == 1 and s.calls.get(2).result == "history-check" and invariant)
  run committedPageSurvivesLostReplyTest = init.then(begin(1)).then(absent(1)).then(readScan(1)).then(scanTip(1, 1))
    .then(page(1, true)).then(commitPage(1)).then(pageReply(1, false)).then(caseFailure(1))
    .expect(s.history.size() == 1 and s.calls.get(1).result == "history-check" and s.revision == 1 and invariant)
  run secondCallerReusesFirstCallersCompletedRowsTest = init.then(begin(1)).then(freshAbsentPlan(1)).then(freshAbsentPlan(1))
    .then(finishRetirement(1)).then(prepareSuccessor(1, false)).then(begin(2))
    .then(reusedAbsentPlan(2)).then(reusedAbsentPlan(2)).then(finishRetirement(2))
    .then(prepareSuccessor(2, true)).then(commitCase(2))
    .expect(s.successor == 2 and s.history.size() == 4 and invariant)
  run onlyOneConcurrentCompleteCallerPublishesSuccessorTest = init.then(begin(1)).then(begin(2))
    .then(failedPlan(1)).then(failedPlan(1)).then(finishRetirement(1)).then(prepareSuccessor(1, true))
    .then(failedPlan(2)).then(failedPlan(2)).then(finishRetirement(2)).then(prepareSuccessor(2, true))
    .then(commitCase(2)).then(commitCase(1))
    .expect(s.successor == 2 and s.calls.get(1).response == "stale" and invariant)
  run progressWinnerCanInvalidateConcurrentCompleteCallerTest = init.then(begin(1)).then(begin(2))
    .then(failedPlan(1)).then(failedPlan(1)).then(finishRetirement(1)).then(prepareSuccessor(1, true)).then(observationError(2))
    .then(commitCase(2)).then(commitCase(1))
    .expect(s.successor == 0 and s.calls.get(1).response == "stale" and s.calls.get(2).committed and invariant)
  run incompleteLocalResultCannotBorrowLaterGlobalCompletionTest = init.then(begin(1)).then(absent(1))
    .then(freshProvider(1, false)).then(freshProvider(1, false)).then(finishScan(1)).then(failedPlan(1)).then(finishRetirement(1))
    .then(begin(2)).then(freshAbsentPlan(2)).then(failedPlan(2)).then(finishRetirement(2))
    .expect(s.calls.get(1).result == "history-check" and s.calls.get(2).result == "retired"
      and s.latest.get(1).progress == 2 and s.latest.get(2).progress == 2 and invariant)
  run oldGenerationPageCanCommitAfterIndependentSuccessorTest = init.then(begin(1)).then(absent(1))
    .then(readScan(1)).then(scanTip(1, 1)).then(page(1, true)).then(otherSuccessor).then(commitPage(1))
    .then(pageReply(1, false)).then(commitCase(1))
    .expect(s.history.size() == 1 and s.calls.get(1).response == "stale" and s.successor == 0 and invariant)
  run targetChangeRefusesFullyProvedSuccessorTest = init.then(failedRetirement(1)).then(changeTarget).then(commitCase(1))
    .expect(s.successor == 0 and s.calls.get(1).response == "stale" and invariant)
  run authorizationChangeRefusesFullyProvedSuccessorTest = init.then(failedRetirement(1)).then(revokeAuthorization).then(commitCase(1))
    .expect(s.successor == 0 and s.calls.get(1).response == "stale" and invariant)
  run mismatchedFailedReceiptsHoldWithoutScanningTest = init.then(begin(1)).then(observe(1, "failed", 1))
    .then(observe(1, "failed", 2)).then(planResult(1)).then(failedPlan(1)).then(finishRetirement(1))
    .expect(s.calls.get(1).result == "history-check" and s.history.size() == 0 and invariant)
  run oneFailureAndOneAbsenceHoldTest = init.then(begin(1)).then(observe(1, "failed", 1))
    .then(observe(1, "absent", 1)).then(planResult(1)).then(failedPlan(1)).then(finishRetirement(1))
    .expect(s.calls.get(1).result == "history-check" and s.calls.get(1).proofs == Set(2) and invariant)
  run possiblePaymentPreventsRetirementAcrossOtherPlanTest = init.then(begin(1)).then(observe(1, "found", 1))
    .then(observe(1, "absent", 1)).then(planResult(1)).then(failedPlan(1)).then(finishRetirement(1))
    .expect(s.calls.get(1).result == "payment-found" and s.calls.get(1).proofs == Set() and invariant)
  run laterProviderErrorOverridesEarlierPossiblePaymentTest = init.then(begin(1)).then(observe(1, "found", 1))
    .then(observationError(1)).expect(s.calls.get(1).result == "history-check" and s.successor == 0 and invariant)
  run secondProviderTipMismatchCannotCompletePlanTest = init.then(begin(1)).then(absent(1)).then(freshProvider(1, true))
    .then(readScan(1)).then(scanTip(1, 2)).then(failedPlan(1)).then(finishRetirement(1))
    .expect(s.calls.get(1).result == "history-check" and s.calls.get(1).proofs == Set(2) and invariant)
  run failedCaseTransactionPreservesAllScanEvidenceTest = init.then(begin(1)).then(freshAbsentPlan(1)).then(freshAbsentPlan(1))
    .then(finishRetirement(1)).then(prepareSuccessor(1, true)).then(caseFailure(1))
    .expect(s.history.size() == 4 and s.generation == 0 and s.revision == 1 and invariant)
  run lostSuccessorReplyDoesNotUndoWinnerTest = init.then(failedRetirement(1)).then(commitCase(1)).then(caseReply(1, false))
    .expect(s.successor == 1 and s.generation == 1 and s.calls.get(1).response == "reply-lost" and invariant)
  run staleProgressRefusesAtMaximumRevisionTest = init.then(otherCaseWrite).then(otherCaseWrite)
    .then(begin(1)).then(begin(2)).then(observationError(1)).then(observationError(2))
    .then(commitCase(1)).then(commitCase(2))
    .expect(s.revision == 4 and s.calls.get(1).committed and s.calls.get(2).response == "stale" and invariant)
}
