// @source src/lib/received-totals.ts
// @source src/lib/verified-allocation.ts
// @evidence scripts/points-summary.test.ts
// isReceivedTotals only: two rows, exact integer amounts 0..6, total 0..12.
// JSON shape/date/decimal grammar predicates represent the source checks;
// this does not prove parsers, arbitrary JavaScript accessors or large integers.
// Each row reconciles direct+vault USD and the envelope sums only row USD.
// Project subtotals, duplicate actors, ordering, component/count grand totals
// and an asset-decimal range are not extra source guarantees. Successful
// validation observes an envelope; it does not establish payment finality.
// The old numeric-ID coercion is a negative control outside step. New
// scenarios and regression definitions are source-only and unexecuted.
module received_totals_contract {
  val rowSlots = Set(1, 2)
  val headerFaults = Set("none", "shape", "schema", "date", "money", "count", "array")
  type Row = { object: bool, stringId: bool, id: int, canonicalId: bool,
    login: bool, money: bool, usd: int, direct: int, vault: int,
    counts: bool, projects: bool, projectSum: int, assets: bool, decimals: int }
  type State = { phase: str, fault: str, count: int, declaredCount: int,
    totalUsd: int, totalDirect: int, totalVault: int, rows: int -> Row,
    cursor: int, sum: int, result: str }
  var s: State
  val example: Row = { object: true, stringId: true, id: 1, canonicalId: true,
    login: true, money: true, usd: 2, direct: 1, vault: 1, counts: true,
    projects: true, projectSum: 2, assets: true, decimals: 6 }
  action init = s' = { phase: "input", fault: "none", count: 2, declaredCount: 2,
    totalUsd: 4, totalDirect: 2, totalVault: 2,
    rows: Map(1 -> example, 2 -> example.with("id", 2)), cursor: 1, sum: 0, result: "none" }
  pure def validRow(value: Row): bool = value.object and value.stringId and value.canonicalId
    and value.login and value.money and value.direct + value.vault == value.usd
    and value.counts and value.projects and value.assets
  pure def oldIdGate(value: Row): bool = value.canonicalId
  action configure(fault: str, count: int, declaredCount: int, total: int): bool = all {
    s.phase == "input", headerFaults.contains(fault), 0.to(2).contains(count),
    0.to(3).contains(declaredCount), 0.to(12).contains(total),
    s' = s.with("fault", fault).with("count", count).with("declaredCount", declaredCount).with("totalUsd", total) }
  action replaceRow(index: int, value: Row): bool = all { s.phase == "input", rowSlots.contains(index),
    Set(1, 2).contains(value.id), 0.to(6).contains(value.usd), 0.to(6).contains(value.direct),
    0.to(6).contains(value.vault), 0.to(6).contains(value.projectSum), Set(-1, 6, 37).contains(value.decimals),
    s' = s.with("rows", s.rows.set(index, value)) }
  action componentTotals(direct: int, vault: int): bool = all { s.phase == "input",
    0.to(12).contains(direct), 0.to(12).contains(vault),
    s' = s.with("totalDirect", direct).with("totalVault", vault) }
  action begin = all { s.phase == "input", s' =
    if (s.fault != "none" or s.count != s.declaredCount) s.with("phase", "done").with("result", "false")
    else s.with("phase", "rows") }
  action inspectRow = {
    val value = s.rows.get(if (rowSlots.contains(s.cursor)) s.cursor else 1)
    all { s.phase == "rows", s' =
      if (s.cursor > s.count) s.with("phase", "sum")
      else if (not(validRow(value))) s.with("phase", "done").with("result", "false")
      else s.with("cursor", s.cursor + 1).with("sum", s.sum + value.usd) }
  }
  action compareSum = all { s.phase == "sum", s' = s.with("phase", "done")
    .with("result", if (s.sum == s.totalUsd) "true" else "false") }
  action profile(kind: int): bool = {
    val value = if (kind == 1) example.with("stringId", false)
      else if (kind == 2) example.with("canonicalId", false)
      else if (kind == 3) example.with("object", false)
      else if (kind == 4) example.with("money", false)
      else if (kind == 5) example.with("direct", 2)
      else if (kind == 6) example.with("counts", false)
      else if (kind == 7) example.with("projects", false)
      else if (kind == 8) example.with("assets", false)
      else if (kind == 9) example.with("login", false)
      else if (kind == 10) example.with("projectSum", 0)
      else if (kind == 11) example.with("decimals", -1)
      else example
    all { s.phase == "input", 0.to(11).contains(kind), s' = s.with("rows", s.rows.set(1, value)) }
  }
  action step = {
    nondet fault = headerFaults.oneOf() nondet count = 0.to(2).oneOf()
    nondet total = 0.to(12).oneOf() nondet kind = 0.to(11).oneOf()
    any { configure(fault, count, count, total), profile(kind), begin, inspectRow, compareSum, s' = s }
  }
  val invariant = all { s.cursor <= 3, s.sum >= 0 and s.sum <= 12,
    s.result == "true" implies s.fault == "none" and s.count == s.declaredCount
      and s.sum == s.totalUsd and rowSlots.filter(index => index <= s.count).forall(index => validRow(s.rows.get(index))) }
  action finishTwo = begin.then(inspectRow).then(inspectRow).then(inspectRow).then(compareSum)
  action refuseFirst = begin.then(inspectRow)
  run validEnvelopeTest = init.then(finishTwo).expect(s.result == "true" and invariant)
  run emptyEnvelopeIsKnownZeroTest = init.then(configure("none", 0, 0, 0)).then(begin).then(inspectRow).then(compareSum).expect(s.result == "true" and invariant)
  run invalidObjectRefusedTest = init.then(configure("shape", 2, 2, 4)).then(begin).expect(s.result == "false" and invariant)
  run wrongSchemaRefusedTest = init.then(configure("schema", 2, 2, 4)).then(begin).expect(s.result == "false" and invariant)
  run invalidDateRefusedTest = init.then(configure("date", 2, 2, 4)).then(begin).expect(s.result == "false" and invariant)
  run noncanonicalTotalMoneyRefusedTest = init.then(configure("money", 2, 2, 4)).then(begin).expect(s.result == "false" and invariant)
  run unsafeTotalCountRefusedTest = init.then(configure("count", 2, 2, 4)).then(begin).expect(s.result == "false" and invariant)
  run nonArrayContributorsRefusedTest = init.then(configure("array", 2, 2, 4)).then(begin).expect(s.result == "false" and invariant)
  run contributorCountMustMatchLengthTest = init.then(configure("none", 2, 1, 4)).then(begin).expect(s.result == "false" and invariant)
  run numericGithubIdNoLongerCoercesTest = init.then(profile(1)).expect(oldIdGate(s.rows.get(1))).then(refuseFirst).expect(s.result == "false" and invariant)
  run invalidGithubIdGrammarRefusedTest = init.then(profile(2)).then(refuseFirst).expect(s.result == "false" and invariant)
  run nullContributorRefusedTest = init.then(profile(3)).then(refuseFirst).expect(s.result == "false" and invariant)
  run noncanonicalRowMoneyRefusedTest = init.then(profile(4)).then(refuseFirst).expect(s.result == "false" and invariant)
  run rowComponentsMustSumTest = init.then(profile(5)).then(refuseFirst).expect(s.result == "false" and invariant)
  run invalidRowCountRefusedTest = init.then(profile(6)).then(refuseFirst).expect(s.result == "false" and invariant)
  run malformedProjectRowRefusedTest = init.then(profile(7)).then(refuseFirst).expect(s.result == "false" and invariant)
  run malformedAssetRowRefusedTest = init.then(profile(8)).then(refuseFirst).expect(s.result == "false" and invariant)
  run invalidLoginTypeRefusedTest = init.then(profile(9)).then(refuseFirst).expect(s.result == "false" and invariant)
  run grandUsdMustSumTest = init.then(configure("none", 2, 2, 3)).then(finishTwo).expect(s.result == "false" and invariant)
  run duplicateActorsAreNotAnEnvelopeCheckTest = init.then(replaceRow(2, example)).then(finishTwo).expect(s.result == "true" and invariant)
  run projectSubtotalsAreNotReconciledHereTest = init.then(profile(10)).then(finishTwo).expect(s.result == "true" and invariant)
  run componentGrandTotalsAreOnlyShapeCheckedTest = init.then(componentTotals(12, 12)).then(finishTwo).expect(s.result == "true" and invariant)
  run negativeAssetDecimalsAreOnlySafeIntegerCheckedTest = init.then(profile(11)).then(finishTwo).expect(s.result == "true" and invariant)
}
