// @source src/lib/allocation-funding.ts
// @source src/lib/allocation-funding-basis.mjs
// @source src/lib/reward-cap.mjs
// @source src/lib/escrow-policy.mjs
// @source src/lib/verified-base-units.ts
// @evidence scripts/allocation-funding.test.ts
// Three synchronous pure boundaries: derive the current basis, validate an
// explicitly supplied basis, or calculate the legacy min(amount, cap) helper.
// Two month identities, amounts0..5, two invocations. Numeric/cycle predicates
// summarize canonical base-unit and YYYY-MM parsing, not floating-point money.
// The current basis always has committedMinor="0" and instrumentId=null,
// regardless of project funding state or historical committedMinor. It does
// not observe a vault balance or authorize a payment. The standalone amount
// helper can still compute a nonzero legacy amount from its three fields;
// that does not make it an admissible current basis. Extra fields are ignored
// by that helper, whereas the five-field basis validator requires exact keys.
// Returned basis values capture the selected cap; they are not a live view of
// later project changes or a promise that JavaScript objects are frozen.
module allocation_funding {
  val modes = Set("derive", "basis", "amount")
  val faults = Set("object", "keys", "amount", "cap", "cycle", "instrument", "extra")
  type State = { phase: str, invocation: int, mode: str, fundingState: str,
    amount: int, cap: int, projectCommitted: int, projectCap: int, overrideCap: int,
    hasOverride: bool, cycle: int, bad: Set[str], resultKind: str, resultAmount: int,
    resultCap: int, resultCycle: int, selectedCap: int, paid: bool }
  var s: State
  action init = s' = { phase: "input", invocation: 1, mode: "derive", fundingState: "pledged",
    amount: 0, cap: 3, projectCommitted: 5, projectCap: 3, overrideCap: 5,
    hasOverride: true, cycle: 1, bad: Set(), resultKind: "none", resultAmount: -1,
    resultCap: -1, resultCycle: 0, selectedCap: -1, paid: false }
  action input(mode: str, state: str, amount: int, cap: int, cycle: int): bool = all {
    s.phase == "input", modes.contains(mode), Set("pledged", "committed", "invalid").contains(state),
    0.to(5).contains(amount), 0.to(5).contains(cap), Set(1, 2).contains(cycle),
    s' = s.with("mode", mode).with("fundingState", state).with("amount", amount).with("cap", cap).with("cycle", cycle) }
  action fault(kind: str): bool = all { s.phase == "input", faults.contains(kind),
    s' = s.with("bad", s.bad.union(Set(kind))) }
  action project(cap: int, committed: int, overrideCap: int, hasOverride: bool): bool = all {
    s.phase == "input", 0.to(5).contains(cap), 0.to(5).contains(committed), 0.to(5).contains(overrideCap),
    s' = s.with("projectCap", cap).with("projectCommitted", committed).with("overrideCap", overrideCap).with("hasOverride", hasOverride) }
  val resolvedCap = if (s.hasOverride and s.cycle == 1) s.overrideCap else s.projectCap
  val badCommon = s.fundingState == "invalid" or s.bad.contains("cap")
  val invalid = if (s.mode == "derive") badCommon or s.bad.contains("object") or s.bad.contains("cycle")
    else if (s.mode == "basis") badCommon or s.bad != Set() or s.amount != 0
    else badCommon or s.bad.contains("object") or s.bad.contains("amount") or s.bad.contains("keys")
  action evaluate = all { s.phase == "input",
    s' = if (invalid) s.with("phase", "done").with("resultKind", "error")
      else if (s.mode == "amount") s.with("phase", "done").with("resultKind", "amount")
        .with("resultCap", s.cap).with("selectedCap", s.cap)
        .with("resultAmount", if (s.fundingState != "committed") 0 else if (s.amount < s.cap) s.amount else s.cap)
      else s.with("phase", "done").with("resultKind", "basis").with("resultAmount", 0).with("resultCycle", s.cycle)
        .with("resultCap", if (s.mode == "derive") resolvedCap else s.cap)
        .with("selectedCap", if (s.mode == "derive") resolvedCap else s.cap) }
  action laterProjectChange = all { s.phase == "done", s.mode == "derive",
    s' = s.with("projectCap", 1).with("overrideCap", 1).with("projectCommitted", 1) }
  action retry = all { s.phase == "done", s.invocation == 1,
    s' = s.with("phase", "input").with("invocation", 2).with("bad", Set())
      .with("resultKind", "none").with("resultAmount", -1).with("resultCap", -1).with("resultCycle", 0).with("selectedCap", -1) }
  action step = {
    nondet mode = modes.oneOf() nondet state = Set("pledged", "committed", "invalid").oneOf()
    nondet amount = 0.to(5).oneOf() nondet cap = 0.to(5).oneOf() nondet overrideCap = 0.to(5).oneOf()
    nondet cycle = Set(1, 2).oneOf() nondet yes = Set(false, true).oneOf() nondet kind = faults.oneOf()
    any { input(mode, state, amount, cap, cycle), fault(kind), project(cap, amount, overrideCap, yes), evaluate, laterProjectChange, retry, s' = s }
  }
  val invariant = all { not(s.paid), s.invocation <= 2,
    s.resultKind == "basis" implies s.resultAmount == 0 and s.resultCap == s.selectedCap,
    s.resultKind == "amount" implies s.resultAmount >= 0 and s.resultAmount <= s.cap and s.resultAmount <= s.amount,
    s.resultKind == "amount" and s.fundingState == "pledged" implies s.resultAmount == 0,
    s.resultKind == "error" implies s.resultAmount == -1 }
  run pledgeZeroTest = init.then(input("amount", "pledged", 5, 3, 1)).then(evaluate).expect(s.resultAmount == 0 and invariant)
  run capPreservedTest = init.then(input("amount", "committed", 5, 3, 1)).then(evaluate).expect(s.resultAmount == 3 and invariant)
  run legacyAmountBelowCapIsUnchangedTest = init.then(input("amount", "committed", 2, 5, 1)).then(evaluate).expect(s.resultAmount == 2 and invariant)
  run currentCommittedBasisStillHasZeroPrincipalTest = init.then(input("derive", "committed", 5, 3, 1)).then(evaluate)
    .expect(s.resultKind == "basis" and s.resultAmount == 0 and s.resultCap == 5 and invariant)
  run matchingMonthUsesExactOverrideTest = init.then(evaluate).expect(s.resultCap == 5 and s.resultCycle == 1 and invariant)
  run otherMonthUsesDefaultCapTest = init.then(input("derive", "pledged", 0, 3, 2)).then(evaluate).expect(s.resultCap == 3 and invariant)
  run zeroOverrideIsNotTreatedAsMissingTest = init.then(project(3, 5, 0, true)).then(evaluate).expect(s.resultCap == 0 and invariant)
  run projectChangeDoesNotRewriteCapturedBasisTest = init.then(evaluate).then(laterProjectChange)
    .expect(s.resultCap == 5 and s.projectCap == 1 and invariant)
  run nonzeroSuppliedBasisIsRejectedTest = init.then(input("basis", "committed", 1, 3, 1)).then(evaluate).expect(s.resultKind == "error" and invariant)
  run amountHelperDoesNotAdmitItsResultAsCurrentBasisTest = init.then(input("amount", "committed", 3, 5, 1)).then(evaluate)
    .expect(s.resultAmount == 3).then(retry).then(input("basis", "committed", 3, 5, 1)).then(evaluate).expect(s.resultKind == "error" and invariant)
  run instrumentMakesCurrentBasisInvalidTest = init.then(input("basis", "committed", 0, 3, 1)).then(fault("instrument")).then(evaluate)
    .expect(s.resultKind == "error" and invariant)
  run extraBasisKeysRefusedTest = init.then(input("basis", "pledged", 0, 3, 1)).then(fault("extra")).then(evaluate)
    .expect(s.resultKind == "error" and invariant)
  run helperIgnoresExtraBasisMetadataTest = init.then(input("amount", "committed", 3, 5, 1)).then(fault("extra")).then(fault("instrument"))
    .then(fault("cycle")).then(evaluate).expect(s.resultAmount == 3 and invariant)
  run invalidStateRefusesAllAmountModesTest = init.then(input("amount", "invalid", 0, 3, 1)).then(evaluate).expect(s.resultKind == "error" and invariant)
  run invalidCycleRefusesDerivationTest = init.then(fault("cycle")).then(evaluate).expect(s.resultKind == "error" and invariant)
  run noncanonicalAmountRefusesArithmeticTest = init.then(input("amount", "pledged", 0, 3, 1)).then(fault("amount")).then(evaluate)
    .expect(s.resultKind == "error" and invariant)
  run invalidCapRefusesEvenPledgedStateTest = init.then(fault("cap")).then(evaluate).expect(s.resultKind == "error" and invariant)
  run correctedInputCanBeEvaluatedAgainTest = init.then(fault("cycle")).then(evaluate).then(retry).then(evaluate)
    .expect(s.resultKind == "basis" and s.resultAmount == 0 and invariant)
}
