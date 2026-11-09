// @source backend/payments/handler.ts
// @source migrations/0021_multi_asset_vault_snapshots.sql
// @evidence backend/payments/totals.test.ts
// GET /projects/:id/totals after the shared origin/method gate. Three rows,
// two assets, testnet network 1, mainnet 2 and unclassified network 3. Network
// order is lexical here. D1 row selection/JSON decoding and exact integer
// grammar are supplied contracts. Every amount is grouped by network+asset;
// decimals come from the first row in that group (SQL does not sort ties).
// The current D1 admission trigger locks each project's network/vault/asset;
// alternate groups/decimals here exercise the generic read algorithm, not a
// claim that one ordinary project may admit such a configuration.
// Amount rows and cursors are separate reads. A later cursor is not an atomic
// snapshot binding to the earlier amounts. Unknown networks pass the source's
// testnet filter. The cursor position is opaque, not interpreted as an amount
// or validated as provider coverage. No RPC or persistence occurs in this route.
// Representative small amounts do not replace production BigInt arithmetic.
// New scenarios/regressions are unexecuted.
module public_project_totals {
  val rowIds = Set(1, 2, 3)
  val groupKeys = 1.to(11)
  type Row = { network: int, asset: int, decimals: int, gross: int, fee: int, paid: bool }
  type State = { phase: str, staging: bool, ids: Set[int], rows: int -> Row,
    cursors: Set[int], positions: int -> int, captured: List[int], observed: int -> Row,
    cursorNetwork: int, cursorPosition: int, index: int, groups: List[int],
    paidNet: int -> int, paidFee: int -> int, heldNet: int -> int, heldFee: int -> int,
    decimals: int -> int, outputNetwork: int, status: int, returned: bool,
    changedRows: bool, changedCursor: bool, malformedRow: int }
  var s: State
  val initialRows = Map(
    1 -> { network: 2, asset: 1, decimals: 6, gross: 10, fee: 2, paid: false },
    2 -> { network: 2, asset: 1, decimals: 6, gross: 5, fee: 1, paid: true },
    3 -> { network: 1, asset: 2, decimals: 9, gross: 7, fee: 1, paid: true })
  val zero = groupKeys.mapBy(_ => 0)
  action init = s' = { phase: "input", staging: false, ids: rowIds, rows: initialRows,
    cursors: Set(2), positions: Map(1 -> 1, 2 -> 1, 3 -> 1), captured: List(), observed: initialRows,
    cursorNetwork: 0, cursorPosition: 0, index: 0, groups: List(), paidNet: zero,
    paidFee: zero, heldNet: zero, heldFee: zero, decimals: zero, outputNetwork: 0,
    status: 0, returned: false, changedRows: false, changedCursor: false, malformedRow: 0 }
  pure def reportable(network: int, staging: bool): bool = staging or network != 1
  pure def key(row: Row): int = row.network * 3 + row.asset
  def current: Row = s.observed.get(if (s.index < s.captured.length()) s.captured.nth(s.index) else 1)
  action configure(staging: bool, ids: Set[int], cursors: Set[int]): bool = all {
    s.phase == "input", ids.subseteq(rowIds), cursors.subseteq(Set(1, 2, 3)),
    s' = s.with("staging", staging).with("ids", ids).with("cursors", cursors) }
  action rowProfile(kind: int): bool = all { s.phase == "input", 0.to(3).contains(kind),
    s' = s.with("rows", if (kind == 1) s.rows.set(2, s.rows.get(2).with("asset", 2).with("decimals", 9))
      else if (kind == 2) s.rows.set(3, s.rows.get(3).with("network", 3))
      else if (kind == 3) s.rows.set(2, s.rows.get(2).with("decimals", 9)) else s.rows) }
  action corrupt(id: int): bool = all { s.phase == "input", rowIds.contains(id), s' = s.with("malformedRow", id) }
  action begin = all { s.phase == "input", s' = s.with("phase", "rows") }
  action readRows(reverse: bool): bool = {
    val pair = if (reverse and s.rows.get(1).asset == s.rows.get(2).asset) List(2, 1) else List(1, 2)
    val order = if (s.rows.get(3).network == 1) List(3).concat(pair) else pair.concat(List(3))
    all { s.phase == "rows", s' = s.with("phase", "cursors").with("observed", s.rows)
      .with("captured", order.select(id => s.ids.contains(id) and reportable(s.rows.get(id).network, s.staging))) }
  }
  action makePaid = all { not(s.changedRows), s.phase != "done",
    s' = s.with("rows", s.rows.set(1, s.rows.get(1).with("paid", true))).with("changedRows", true) }
  action advanceCursor(network: int): bool = all { not(s.changedCursor), Set(1, 2, 3).contains(network), s.phase != "done",
    s' = s.with("cursors", s.cursors.union(Set(network))).with("positions", s.positions.set(network, 2)).with("changedCursor", true) }
  action readCursor = {
    val usable = List(1, 2, 3).select(n => s.cursors.contains(n) and reportable(n, s.staging))
    val network = if (usable.length() > 0) usable.nth(0) else 0
    all { s.phase == "cursors", s' = s.with("cursorNetwork", network)
      .with("cursorPosition", if (network == 0) 0 else s.positions.get(network))
      .with("phase", if (s.captured.length() == 0 and network == 0) "done" else "fold")
      .with("status", if (s.captured.length() == 0 and network == 0) 503 else 0) }
  }
  action foldRow = {
    val row = current
    val rowId = if (s.index < s.captured.length()) s.captured.nth(s.index) else 0
    val k = key(row)
    val net = row.gross - row.fee
    all { s.phase == "fold", s.index < s.captured.length(), s' =
      if (rowId == s.malformedRow) s.with("phase", "done").with("status", 503)
      else s.with("index", s.index + 1)
        .with("groups", if (s.groups.contains(k)) s.groups else s.groups.append(k))
        .with("decimals", if (s.groups.contains(k)) s.decimals else s.decimals.set(k, row.decimals))
        .with("paidNet", if (row.paid) s.paidNet.set(k, s.paidNet.get(k) + net) else s.paidNet)
        .with("paidFee", if (row.paid) s.paidFee.set(k, s.paidFee.get(k) + row.fee) else s.paidFee)
        .with("heldNet", if (row.paid) s.heldNet else s.heldNet.set(k, s.heldNet.get(k) + net))
        .with("heldFee", if (row.paid) s.heldFee else s.heldFee.set(k, s.heldFee.get(k) + row.fee)) }
  }
  action respond = all { s.phase == "fold", s.index == s.captured.length(),
    s' = s.with("phase", "done").with("status", 200).with("returned", true)
      .with("outputNetwork", if (s.cursorNetwork != 0) s.cursorNetwork
        else if (s.captured.length() > 0) s.observed.get(s.captured.nth(0)).network else 0) }
  action failure = all { Set("rows", "cursors").contains(s.phase), s' = s.with("phase", "done").with("status", 503) }
  action step = {
    nondet yes = Set(false, true).oneOf() nondet kind = 0.to(3).oneOf()
    nondet ids = rowIds.powerset().oneOf() nondet cursors = Set(1, 2, 3).powerset().oneOf()
    nondet network = Set(1, 2, 3).oneOf() nondet id = rowIds.oneOf()
    any { configure(yes, ids, cursors), rowProfile(kind), corrupt(id), begin, readRows(yes),
      makePaid, advanceCursor(network), readCursor, foldRow, respond, failure, s' = s }
  }
  val invariant = all { s.index <= s.captured.length(), s.index <= 3,
    s.returned implies s.status == 200 and s.phase == "done",
    not(s.staging) implies s.captured.forall(id => s.observed.get(id).network != 1),
    s.returned implies s.cursorNetwork != 0 or s.captured.length() > 0,
    s.returned and s.cursorNetwork != 0 implies s.outputNetwork == s.cursorNetwork,
    groupKeys.forall(k => s.paidNet.get(k) >= 0 and s.paidFee.get(k) >= 0 and s.heldNet.get(k) >= 0 and s.heldFee.get(k) >= 0) }
  action capture = begin.then(readRows(false)).then(readCursor)
  action finishTwo = capture.then(foldRow).then(foldRow).then(respond)
  run paidAndReservedRemainDistinctTest = init.then(finishTwo).expect(s.paidNet.get(7) == 4 and s.heldNet.get(7) == 8 and s.paidFee.get(7) == 1 and s.heldFee.get(7) == 2 and invariant)
  run productionExcludesTestnetRowsTest = init.then(finishTwo).expect(s.captured == List(1, 2) and invariant)
  run stagingIncludesTestnetRowsTest = init.then(configure(true, rowIds, Set(1, 2))).then(capture).then(foldRow).then(foldRow).then(foldRow).then(respond).expect(s.groups == List(5, 7) and s.outputNetwork == 1 and invariant)
  run testnetOnlyReadsAsUnindexedInProductionTest = init.then(configure(false, Set(3), Set(1))).then(capture).expect(s.status == 503 and not(s.returned) and invariant)
  run cursorOnlyReturnsEmptyAssetsTest = init.then(configure(false, Set(), Set(2))).then(capture).then(respond).expect(s.returned and s.groups == List() and s.outputNetwork == 2 and invariant)
  run amountsWithoutCursorHaveNullCoverageTest = init.then(configure(false, Set(1, 2), Set())).then(finishTwo).expect(s.returned and s.cursorPosition == 0 and s.outputNetwork == 2 and invariant)
  run noRowsOrCursorIsUnavailableTest = init.then(configure(false, Set(), Set())).then(capture).expect(s.status == 503 and invariant)
  run firstReportableCursorWinsTest = init.then(configure(false, Set(1, 2), Set(1, 2, 3))).then(finishTwo).expect(s.cursorNetwork == 2 and invariant)
  run unclassifiedNetworkIsNotAutomaticallyTestnetTest = init.then(rowProfile(2)).then(configure(false, Set(3), Set(3))).then(capture).then(foldRow).then(respond).expect(s.outputNetwork == 3 and s.groups == List(11) and invariant)
  run differentAssetsAreNotSummedTest = init.then(rowProfile(1)).then(finishTwo).expect(s.groups == List(7, 8) and s.heldNet.get(7) == 8 and s.paidNet.get(8) == 4 and invariant)
  run firstGroupedRowProvidesDecimalsTest = init.then(rowProfile(3)).then(finishTwo).expect(s.decimals.get(7) == 6 and invariant)
  run SQLTieOrderCanChooseOtherDecimalsTest = init.then(rowProfile(3)).then(begin).then(readRows(true)).then(readCursor).then(foldRow).then(foldRow).then(respond).expect(s.decimals.get(7) == 9 and invariant)
  run laterPaymentDoesNotRewriteCapturedAmountsTest = init.then(begin).then(readRows(false)).then(makePaid).then(readCursor).then(foldRow).then(foldRow).then(respond).expect(s.rows.get(1).paid and s.heldNet.get(7) == 8 and invariant)
  run cursorCanAdvanceAfterAmountReadTest = init.then(begin).then(readRows(false)).then(advanceCursor(2)).then(readCursor).then(foldRow).then(foldRow).then(respond).expect(s.cursorPosition == 2 and s.heldNet.get(7) == 8 and invariant)
  run laterCursorDoesNotRewriteCapturedCoverageTest = init.then(capture).then(advanceCursor(2)).then(foldRow).then(foldRow).then(respond).expect(s.cursorPosition == 1 and s.positions.get(2) == 2 and invariant)
  run rowReadFailureReturnsNoAssetsTest = init.then(begin).then(failure).expect(s.status == 503 and not(s.returned) and invariant)
  run cursorReadFailureDoesNotReturnAmountPrefixTest = init.then(begin).then(readRows(false)).then(failure).expect(s.status == 503 and not(s.returned) and invariant)
  run malformedAmountCannotReturnPartialGroupsTest = init.then(corrupt(1)).then(capture).then(foldRow).expect(s.status == 503 and not(s.returned) and invariant)
  run lateMalformedAmountHidesEarlierGroupTest = init.then(corrupt(2)).then(capture).then(foldRow).then(foldRow).expect(s.groups == List(7) and s.status == 503 and not(s.returned) and invariant)
}
