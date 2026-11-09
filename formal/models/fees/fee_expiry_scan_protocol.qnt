// @source workers/fee-converter/solana-expiry.ts
// @source workers/fee-converter/verified-expiry.ts
// @source workers/fee-converter/native-gas.ts
// @source workers/fee-converter/solana.ts
// @source migrations/0095_fee_solana_expiry.sql
// @evidence workers/fee-converter/native-gas.test.ts
// One retained signed Solana transaction, two provider identities, four calls.
// Three linked block representatives end at anchor 1; horizons are 2 or 3.
// One block per modeled page represents a nonempty bounded source page (32
// blocks maximum), not a new production scan limit. Lists stand for exact
// ordered block/digest witnesses; hash collisions and RPC truth are excluded.
//
// Provider observations, unsaved local coverage, committed checkpoints and
// final zero-cost resolution are distinct. The first retained/provider horizon
// fixes this call's shared horizon. A page reply may be lost after its commit;
// next-call readback resumes it. A partial page lost before save is not durable.
// `owned` is the lease predicate evaluated by the guarded SQL statement, not
// a continuous wall-clock ownership promise. No hold is released merely for
// absent status, expiry, a completed local page, or a failed write response.
// This is the production worker path with a coverage store. The helper's
// optional in-memory-only store omission is outside this bound.
module fee_expiry_scan_protocol {
  val providers = Set(1, 2)
  type Coverage = { present: bool, tip: int, cursor: int, blocks: List[int],
    complete: bool, revision: int }
  type State = { phase: str, call: int, provider: int, context: int, horizon: int,
    owned: bool, saved: int -> Coverage, observed: int -> Coverage,
    captured: Coverage, local: Coverage, page: List[int], pageWrites: Set[int],
    allComplete: bool, checked: Set[int], unknownPage: bool,
    proof: bool, resolved: bool, outcome: str }
  pure val emptyCoverage: Coverage = { present: false, tip: 0, cursor: 0,
    blocks: [], complete: false, revision: 0 }
  var s: State
  action init = s' = { phase: "idle", call: 0, provider: 1, context: 0, horizon: 0,
    owned: true, saved: providers.mapBy(_ => emptyCoverage), observed: providers.mapBy(_ => emptyCoverage),
    captured: emptyCoverage, local: emptyCoverage, page: [], pageWrites: Set(), allComplete: true,
    checked: Set(), unknownPage: false, proof: false, resolved: false, outcome: "none" }
  pure def matching(a: Coverage, b: Coverage): bool = a.present and b.present
    and a.complete and b.complete and a.tip == b.tip and a.blocks == b.blocks and a.blocks.length() > 0
  def done(outcome: str): State = s.with("phase", "done").with("outcome", outcome)
  val held = if (s.resolved) 0 else 2
  action begin = all { Set("idle", "done").contains(s.phase), s.call < 4,
    s' = s.with("call", s.call + 1).with("provider", 1).with("context", 0).with("horizon", 0)
      .with("owned", true).with("allComplete", true).with("checked", Set())
      .with("unknownPage", false).with("observed", providers.mapBy(_ => emptyCoverage))
      .with("phase", if (s.resolved) "done" else "genesis")
      .with("outcome", if (s.resolved) "already-resolved" else "none") }
  action loseLease = all { s.call > 0, s' = s.with("owned", false) }
  action genesis(ok: bool): bool = all { s.phase == "genesis",
    s' = if (ok) s.with("phase", "available") else done("refused") }
  action available(ok: bool): bool = all { s.phase == "available",
    s' = if (ok) s.with("phase", "anchor") else done("refused") }
  action anchor(ok: bool): bool = all { s.phase == "anchor",
    s' = if (ok) s.with("phase", "expiry") else done("refused") }
  action expired(ok: bool, context: int): bool = all { s.phase == "expiry", Set(2, 3).contains(context),
    s' = if (ok) s.with("context", context).with("phase", "signature") else done("refused") }
  action signatureAbsent(ok: bool): bool = all { s.phase == "signature",
    s' = if (ok) s.with("phase", "transaction") else done("refused") }
  action transactionAbsent(ok: bool): bool = all { s.phase == "transaction",
    s' = if (ok) s.with("phase", "checkpoint") else done("refused") }
  action checkpoint(validIdentity: bool): bool = {
    val stored = s.saved.get(s.provider)
    val horizon = if (s.horizon != 0) s.horizon else if (stored.present) stored.tip else s.context
    val compatible = validIdentity and s.context >= horizon and (not(stored.present) or stored.tip == horizon)
    all { s.phase == "checkpoint",
      s' = if (not(compatible)) done("refused") else s.with("horizon", horizon).with("captured", stored)
        .with("local", if (stored.present) stored else { present: true, tip: horizon, cursor: horizon,
          blocks: [], complete: false, revision: 0 }).with("page", []).with("phase", "tip") }
  }
  action tip(matches: bool): bool = all { s.phase == "tip",
    s' = if (not(matches)) done("refused") else s.with("phase", if (s.local.complete) "provider-done" else "block") }
  // Shape, exact expected block hash and decreasing parent link are one
  // checked response class. `found` is exact signature membership.
  action block(valid: bool, found: bool): bool = all { s.phase == "block", not(s.local.complete),
    s' = if (not(valid) or found) done("refused") else s.with("local", s.local
      .with("blocks", s.local.blocks.append(s.local.cursor))
      .with("complete", s.local.cursor == 1)
      .with("cursor", if (s.local.cursor == 1) 1 else s.local.cursor - 1))
      .with("page", [s.local.cursor]).with("phase", "save") }
  val canSave = s.owned and not(s.resolved)
    and s.saved.get(s.provider).revision == s.captured.revision
  def savedPage: State = {
    val coverage = s.local.with("revision", s.captured.revision + 1)
    s.with("saved", s.saved.set(s.provider, coverage)).with("local", coverage)
      .with("pageWrites", s.pageWrites.union(Set(s.provider * 10 + coverage.revision)))
  }
  action saveCommit = all { s.phase == "save", s.page.length() > 0,
    s' = if (canSave) savedPage.with("phase", "save-reply") else done("write-refused") }
  action saveReply(delivered: bool): bool = all { s.phase == "save-reply",
    s' = if (delivered) s.with("phase", "provider-done") else done("write-error") }
  action saveRejected = all { s.phase == "save", s' = done("write-error") }
  // The caller has a rejection while the dispatched D1 write is unresolved.
  action unknownPageReply = all { s.phase == "save", s' = done("write-error").with("unknownPage", true) }
  action latePageCommit = all { s.phase == "done", s.unknownPage, canSave,
    s' = savedPage.with("unknownPage", false) }
  action providerDone = all { s.phase == "provider-done",
    s' = s.with("observed", s.observed.set(s.provider, s.local))
      .with("allComplete", s.allComplete and s.local.complete)
      .with("provider", if (s.provider == 1) 2 else 2)
      .with("phase", if (s.provider == 1) "genesis" else "finish") }
  action finish = all { s.phase == "finish",
    s' = if (s.allComplete and matching(s.observed.get(1), s.observed.get(2)))
      s.with("provider", 1).with("phase", "retained") else done("incomplete") }
  action retained(matchesReadback: bool): bool = all { s.phase == "retained",
    s' = if (not(matchesReadback) or s.saved.get(s.provider) != s.observed.get(s.provider)) done("proof-error")
      else s.with("checked", s.checked.union(Set(s.provider)))
        .with("provider", if (s.provider == 1) 2 else 2)
        .with("phase", if (s.provider == 1) "retained" else "proof") }
  action proofCommit = all { s.phase == "proof", s.checked == providers,
    s' = if (s.owned and not(s.resolved) and matching(s.saved.get(1), s.saved.get(2)))
      s.with("proof", true).with("resolved", true).with("phase", "proof-reply") else done("write-refused") }
  action proofReply(delivered: bool): bool = all { s.phase == "proof-reply",
    s' = done(if (delivered) "released" else "proof-error") }
  action rpcFailure = all { Set("genesis", "available", "anchor", "expiry", "signature", "transaction", "tip", "block").contains(s.phase),
    s' = done("rpc-error") }
  action storageReadFailure = all { Set("checkpoint", "retained").contains(s.phase), s' = done("read-error") }
  action step = {
    nondet yes = Set(false, true).oneOf()
    nondet found = Set(false, true).oneOf()
    nondet context = Set(2, 3).oneOf()
    any { begin, loseLease, genesis(yes), available(yes), anchor(yes), expired(yes, context),
      signatureAbsent(yes), transactionAbsent(yes), checkpoint(yes), tip(yes), block(yes, found),
      saveCommit, saveReply(yes), saveRejected, unknownPageReply, latePageCommit, providerDone,
      finish, retained(yes), proofCommit, proofReply(yes), rpcFailure, storageReadFailure, s' = s }
  }
  val invariant = all {
    s.call <= 4, s.horizon >= 0 and s.horizon <= 3,
    s.resolved iff s.proof,
    s.resolved implies matching(s.saved.get(1), s.saved.get(2)),
    s.outcome == "released" implies s.resolved and held == 0,
    not(s.resolved) implies held == 2,
    providers.forall(p => {
      val coverage = s.saved.get(p)
      coverage.revision >= 0 and coverage.revision <= 3
        and (coverage.complete implies coverage.present and coverage.cursor == 1 and coverage.blocks.length() == coverage.tip)
    }) }
  action preflight = genesis(true).then(available(true)).then(anchor(true)).then(expired(true, 3))
    .then(signatureAbsent(true)).then(transactionAbsent(true)).then(checkpoint(true)).then(tip(true))
  action onePage = preflight.then(block(true, false)).then(saveCommit).then(saveReply(true)).then(providerDone)
  action partialCall = begin.then(onePage).then(onePage).then(finish)
  action completeCoverage = partialCall.then(partialCall).then(begin).then(onePage).then(onePage).then(finish)
  action readyProof = completeCoverage.then(retained(true)).then(retained(true))
  run expiryAndAbsentStatusAloneKeepHoldTest = init.then(begin).then(genesis(true)).then(available(true))
    .then(anchor(true)).then(expired(true, 3)).then(signatureAbsent(true)).then(transactionAbsent(true))
    .expect(held == 2 and not(s.proof) and invariant)
  run partialPagesResumeAcrossCallsTest = init.then(partialCall).then(partialCall)
    .expect(s.saved.get(1).blocks == [3, 2] and s.saved.get(2).blocks == [3, 2] and held == 2 and invariant)
  run completeMatchingCoverageReleasesAtomicallyTest = init.then(readyProof).then(proofCommit).then(proofReply(true))
    .expect(s.resolved and held == 0 and s.pageWrites.size() == 6 and invariant)
  run firstProviderPageSurvivesSecondRpcFailureTest = init.then(begin).then(onePage).then(rpcFailure)
    .expect(s.saved.get(1).revision == 1 and s.saved.get(2).revision == 0 and held == 2 and invariant)
  run lostPageReplyRetainsCommittedCursorTest = init.then(begin).then(preflight).then(block(true, false))
    .then(saveCommit).then(saveReply(false)).then(begin).then(preflight)
    .expect(s.local.cursor == 2 and s.local.blocks == [3] and held == 2 and invariant)
  run rejectedReplyMayPrecedePageCommitTest = init.then(begin).then(preflight).then(block(true, false))
    .then(unknownPageReply).then(latePageCommit).then(begin).then(preflight)
    .expect(s.local.cursor == 2 and s.saved.get(1).revision == 1 and invariant)
  run rejectedWriteDoesNotAdvanceCheckpointTest = init.then(begin).then(preflight).then(block(true, false)).then(saveRejected)
    .expect(not(s.saved.get(1).present) and s.local.blocks == [3] and held == 2 and invariant)
  run leaseLossRefusesPendingPageTest = init.then(begin).then(preflight).then(block(true, false)).then(loseLease).then(saveCommit)
    .expect(s.outcome == "write-refused" and not(s.saved.get(1).present) and held == 2 and invariant)
  run lostLeaseCannotCommitUnknownPageTest = init.then(begin).then(preflight).then(block(true, false))
    .then(unknownPageReply).then(loseLease).then(latePageCommit.fail())
  run signatureFoundInHistoryKeepsHoldTest = init.then(begin).then(preflight).then(block(true, true))
    .expect(s.outcome == "refused" and not(s.saved.get(1).present) and held == 2 and invariant)
  run invalidLinkKeepsUnsavedPageNonDurableTest = init.then(begin).then(preflight).then(block(false, false))
    .expect(s.outcome == "refused" and s.pageWrites == Set() and held == 2 and invariant)
  run slowerSecondProviderCannotInventCommonHorizonTest = init.then(begin).then(onePage)
    .then(genesis(true)).then(available(true)).then(anchor(true)).then(expired(true, 2))
    .then(signatureAbsent(true)).then(transactionAbsent(true)).then(checkpoint(true))
    .expect(s.outcome == "refused" and s.horizon == 3 and s.saved.get(1).tip == 3 and held == 2 and invariant)
  run failedRetainedReadDoesNotReleaseLocalProofTest = init.then(completeCoverage).then(storageReadFailure)
    .expect(matching(s.observed.get(1), s.observed.get(2)) and not(s.resolved) and held == 2 and invariant)
  run changedReadbackRefusesProofTest = init.then(completeCoverage).then(retained(false))
    .expect(s.outcome == "proof-error" and held == 2 and invariant)
  run lostLeaseRefusesAtomicZeroCostResolutionTest = init.then(readyProof).then(loseLease).then(proofCommit)
    .expect(s.outcome == "write-refused" and held == 2 and not(s.proof) and invariant)
  run lostProofReplyDoesNotUndoResolutionTest = init.then(readyProof).then(proofCommit).then(proofReply(false)).then(begin)
    .expect(s.outcome == "already-resolved" and s.resolved and held == 0 and invariant)
}
