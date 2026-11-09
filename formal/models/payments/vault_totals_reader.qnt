// @source workers/payments/index.ts
// @source contracts/evm/adapter.ts
// @source contracts/solana/adapter.ts
// @evidence workers/payments/vault-reader.test.ts
// @evidence contracts/solana/adapter.test.ts
// readDeploymentVaultTotals composition only. Two families and two chain
// revisions. Inner RPC/layout/arithmetic checks are delegated to the family
// reader models. The EVM reader captures its finalized block first. Every
// verification getter then uses that exact numeric block, even after the
// latest head changes. Totals are not returned before that verification.
// Solana checks project/program presence here, then delegates account reads;
// this wrapper does not verify configured mint, genesis, deployment code or
// authority. The later snapshot store compares the returned configured asset.
// No writes, payments, provider honesty or current-balance promise is implied.
module vault_totals_reader {
  type State = { phase: str, family: str, complete: bool, chainIdValid: bool,
    verificationOk: bool, countersOk: bool, revision: int, verifiedRevision: int,
    counterRevision: int, verificationCalled: bool, countersCalled: bool,
    returned: bool, error: str }
  var s: State
  action init = s' = { phase: "input", family: "evm", complete: true,
    chainIdValid: true, verificationOk: true, countersOk: true, revision: 1,
    verifiedRevision: 0, counterRevision: 0, verificationCalled: false,
    countersCalled: false, returned: false, error: "none" }
  action configure(family: str, complete: bool, chainIdValid: bool, verificationOk: bool, countersOk: bool): bool = all {
    s.phase == "input", Set("evm", "solana").contains(family),
    s' = s.with("family", family).with("complete", complete).with("chainIdValid", chainIdValid)
      .with("verificationOk", verificationOk).with("countersOk", countersOk) }
  def refuse(reason: str): State = s.with("phase", "done").with("error", reason)
  action begin = all { s.phase == "input", s' =
    if (not(s.complete)) refuse("deployment-incomplete")
    else if (s.family == "evm" and not(s.chainIdValid)) refuse("chain-id")
    else s.with("phase", "counters") }
  action verify = all { s.phase == "verify", s' = s.with("verificationCalled", true)
    .with("verifiedRevision", s.counterRevision).with("phase", "done")
    .with("returned", s.verificationOk).with("error", if (s.verificationOk) "none" else "verification") }
  action advanceChain = all { s.revision == 1, s' = s.with("revision", 2) }
  action counters = all { s.phase == "counters", s' = s.with("countersCalled", true)
    .with("counterRevision", s.revision).with("phase", if (s.countersOk and s.family == "evm") "verify" else "done")
    .with("returned", s.countersOk and s.family == "solana").with("error", if (s.countersOk) "none" else "counters") }
  action step = {
    nondet family = Set("evm", "solana").oneOf()
    nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf() nondet d = Set(false, true).oneOf()
    any { configure(family, a, b, c, d), begin, verify, advanceChain, counters, s' = s }
  }
  val invariant = all { s.returned implies s.complete and s.countersCalled and s.error == "none",
    s.returned and s.family == "evm" implies s.verificationCalled and s.verificationOk and s.chainIdValid,
    s.family == "solana" implies not(s.verificationCalled),
    s.returned and s.family == "evm" implies s.verifiedRevision == s.counterRevision,
    s.error == "verification" implies s.countersCalled and not(s.returned),
    s.counterRevision <= s.revision, s.verifiedRevision <= s.revision }
  run evmVerifiesCapturedCountersBeforeReturnTest = init.then(begin).then(counters).expect(not(s.returned)).then(verify).expect(s.returned and s.verifiedRevision == 1 and invariant)
  run missingEvmFieldsRefuseBeforeVerificationTest = init.then(configure("evm", false, true, true, true)).then(begin).expect(not(s.verificationCalled) and not(s.countersCalled) and invariant)
  run malformedEvmChainIdRefusesBeforeVerificationTest = init.then(configure("evm", true, false, true, true)).then(begin).expect(s.error == "chain-id" and invariant)
  run failedVerificationNeverReturnsCountersTest = init.then(configure("evm", true, true, false, true)).then(begin).then(counters).then(verify).expect(not(s.returned) and s.countersCalled and invariant)
  run failedCountersDoNotStartVerificationTest = init.then(configure("evm", true, true, true, false)).then(begin).then(counters).expect(s.error == "counters" and not(s.verificationCalled) and invariant)
  run headAdvanceKeepsVerificationAtCounterBlockTest = init.then(begin).then(counters).then(advanceChain).then(verify).expect(s.returned and s.verifiedRevision == 1 and s.counterRevision == 1 and s.revision == 2 and invariant)
  run solanaHasNoEvmVerificationStageTest = init.then(configure("solana", true, false, false, true)).then(begin).then(counters).expect(s.returned and not(s.verificationCalled) and invariant)
  run missingSolanaProjectOrProgramRefusesTest = init.then(configure("solana", false, true, true, true)).then(begin).expect(s.error == "deployment-incomplete" and not(s.countersCalled) and invariant)
  run solanaCounterFailureReturnsNoTotalsTest = init.then(configure("solana", true, true, true, false)).then(begin).then(counters).expect(s.error == "counters" and invariant)
  run waitingForVerificationHasNoReturnedCounterResultTest = init.then(begin).then(counters).expect(not(s.returned) and not(s.verificationCalled) and invariant)
}
