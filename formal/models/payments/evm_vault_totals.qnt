// @source contracts/evm/adapter.ts
// @evidence contracts/evm/vault-totals.test.ts
// readVaultTotals only. Integer amounts 0..7, two provider heads, and one
// captured finalized block. ABI/hex/uint128/timestamp parsing are outcome
// predicates, not reproduced parsers. Grouped spent represents paid + payout
// fees + gross withdrawn; withdrawal fees are already inside withdrawn gross.
// All monetary reads after the head use the captured numeric block tag. The
// function does not verify deployment code, authority or expected asset.
// Provider honesty/canonicality and unbounded amounts remain external.
module evm_vault_totals {
  type State = { phase: str, fault: str, native: bool, latest: int, block: int,
    tags: List[int], deposited: int, free: int, principal: int, fees: int,
    spent: int, accrued: int, balance: int, nativeBalance: int, pending: int,
    pendingRead: bool, reserved: int, returned: bool, error: str }
  var s: State
  val faults = Set("none", "vault", "chain", "head", "totals", "token", "decimals", "native-decimals", "pending", "time")
  action init = s' = { phase: "input", fault: "none", native: false, latest: 1, block: 0,
    tags: List(), deposited: 6, free: 2, principal: 1, fees: 0, spent: 2,
    accrued: 1, balance: 5, nativeBalance: 5, pending: 1,
    pendingRead: false, reserved: -1, returned: false, error: "none" }
  action configure(fault: str, native: bool, profile: int): bool = all {
    s.phase == "input", faults.contains(fault), 0.to(6).contains(profile),
    s' = s.with("fault", fault).with("native", native)
      .with("deposited", if (profile == 1) 5 else if (profile == 2) 4 else 6)
      .with("pending", if (profile == 3) 2 else 1)
      .with("balance", if (profile == 4) 4 else if (profile == 5) 7 else 5)
      .with("nativeBalance", if (profile == 6) 6 else if (profile == 5) 7 else 5) }
  def accounted: int = s.free + s.principal + s.fees + s.spent
  def owed: int = s.free + s.principal + s.fees + (if (s.pendingRead) s.pending else 0) + s.accrued
  def failAt(reason: str): State = s.with("phase", "done").with("error", reason)
  action begin = all { s.phase == "input", s' = if (s.fault == "vault") failAt("vault") else s.with("phase", "chain") }
  action chain = all { s.phase == "chain", s' = if (s.fault == "chain") failAt("chain") else s.with("phase", "head") }
  action headRead = all { s.phase == "head", s' = if (s.fault == "head") failAt("head") else s.with("phase", "totals").with("block", s.latest) }
  action advanceChain = all { s.latest == 1, s' = s.with("latest", 2) }
  action totals = all { s.phase == "totals", s' = if (s.fault == "totals") failAt("totals")
    else s.with("phase", "token").with("tags", s.tags.append(s.block)) }
  action token = all { s.phase == "token", s' = if (s.fault == "token") failAt("asset")
    else s.with("phase", "decimals").with("tags", s.tags.append(s.block)) }
  action decimals = all { s.phase == "decimals", s' = if (s.fault == "decimals") failAt("asset")
    else s.with("phase", if (s.native) "native" else "pending-gate").with("tags", s.tags.append(s.block)) }
  action nativeRead = all { s.phase == "native", s' =
    if (s.fault == "native-decimals" or s.nativeBalance != s.balance) failAt("native-balance")
    else s.with("phase", "pending-gate").with("tags", s.tags.append(s.block)) }
  action pendingGate = all { s.phase == "pending-gate", s' = s.with("phase", if (s.deposited > accounted) "pending" else "conserve") }
  action pendingRead = all { s.phase == "pending", s' = if (s.fault == "pending") failAt("pending")
    else s.with("phase", "conserve").with("pendingRead", true).with("tags", s.tags.append(s.block)) }
  action conserve = all { s.phase == "conserve", s' =
    if (s.deposited != accounted + (if (s.pendingRead) s.pending else 0) or s.balance < owed) failAt("conservation")
    else s.with("phase", "time").with("reserved", if (s.pendingRead and s.pending > 0) s.principal + s.fees + s.pending else -1) }
  action timestamp = all { s.phase == "time", s' = if (s.fault == "time") failAt("time") else s.with("phase", "done").with("returned", true) }
  action step = {
    nondet fault = faults.oneOf() nondet native = Set(false, true).oneOf() nondet profile = 0.to(6).oneOf()
    any { configure(fault, native, profile), begin, chain, headRead, advanceChain, totals, token, decimals,
      nativeRead, pendingGate, pendingRead, conserve, timestamp, s' = s }
  }
  val invariant = all { s.tags.forall(tag => tag == s.block),
    s.error != "none" implies not(s.returned),
    s.returned implies s.deposited == accounted + (if (s.pendingRead) s.pending else 0) and s.balance >= owed,
    s.returned and s.native implies s.nativeBalance == s.balance,
    s.returned and not(s.pendingRead) implies s.reserved == -1 }
  action toPending = begin.then(chain).then(headRead).then(totals).then(token).then(decimals)
  action toConserve = pendingGate.then(pendingRead)
  action finish = toConserve.then(conserve).then(timestamp)
  run pendingReserveConservesTest = init.then(toPending).then(finish).expect(s.returned and s.reserved == 2 and invariant)
  run legacyBalancedReturnsNullReservedTest = init.then(configure("none", false, 1)).then(toPending).then(pendingGate).then(conserve).then(timestamp).expect(s.returned and not(s.pendingRead) and s.reserved == -1 and invariant)
  run excessWithdrawalsRefuseWithoutPendingGetterTest = init.then(configure("none", false, 2)).then(toPending).then(pendingGate).then(conserve).expect(s.error == "conservation" and not(s.pendingRead) and invariant)
  run wrongPendingAmountRefusedTest = init.then(configure("none", false, 3)).then(toPending).then(toConserve).then(conserve).expect(s.error == "conservation" and invariant)
  run insufficientVaultBalanceRefusedTest = init.then(configure("none", false, 4)).then(toPending).then(toConserve).then(conserve).expect(s.error == "conservation" and invariant)
  run unsolicitedBalanceDoesNotIncreaseFreeTest = init.then(configure("none", false, 5)).then(toPending).then(finish).expect(s.returned and s.free == 2 and s.balance == 7 and invariant)
  run nativeBalanceMustEqualTotalsBalanceTest = init.then(configure("none", true, 6)).then(toPending).then(nativeRead).expect(s.error == "native-balance" and invariant)
  run nativeDecimalsRequireBalanceStageTest = init.then(configure("native-decimals", true, 0)).then(toPending).then(nativeRead).expect(s.error == "native-balance" and not(s.pendingRead) and invariant)
  run nativeConservationAfterBalanceReadTest = init.then(configure("none", true, 0)).then(toPending).then(nativeRead).then(finish).expect(s.returned and invariant)
  run readsStayAtCapturedBlockAfterHeadAdvanceTest = init.then(begin).then(chain).then(headRead).then(advanceChain).then(totals).then(token).then(decimals).then(finish).expect(s.returned and s.block == 1 and s.latest == 2 and invariant)
  run badVaultStopsBeforeChainTest = init.then(configure("vault", false, 0)).then(begin).expect(s.error == "vault" and s.tags == List() and invariant)
  run wrongChainStopsBeforeHeadTest = init.then(configure("chain", false, 0)).then(begin).then(chain).expect(s.error == "chain" and invariant)
  run malformedHeadStopsBeforeTotalsTest = init.then(configure("head", false, 0)).then(begin).then(chain).then(headRead).expect(s.error == "head" and invariant)
  run malformedTotalsHaveNoAssetReadsTest = init.then(configure("totals", false, 0)).then(begin).then(chain).then(headRead).then(totals).expect(s.error == "totals" and invariant)
  run malformedTokenRefusedTest = init.then(configure("token", false, 0)).then(begin).then(chain).then(headRead).then(totals).then(token).expect(s.error == "asset" and invariant)
  run invalidDecimalsRefusedTest = init.then(configure("decimals", false, 0)).then(toPending).expect(s.error == "asset" and invariant)
  run missingPendingGetterRefusedTest = init.then(configure("pending", false, 0)).then(toPending).then(pendingGate).then(pendingRead).expect(s.error == "pending" and invariant)
  run badTimestampReturnsNoPartialTotalsTest = init.then(configure("time", false, 0)).then(toPending).then(finish).expect(s.error == "time" and not(s.returned) and invariant)
}
