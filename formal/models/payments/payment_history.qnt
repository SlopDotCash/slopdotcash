// @source backend/payments/public-records.ts
// @source backend/payments/direct-history.ts
// @source backend/payments/handler.ts
// @source src/lib/use-vault-payments.ts
// @source src/lib/use-direct-transfers.ts
// @source migrations/0011_payments.sql
// @source migrations/0081_monthly_asset_amount_range.sql
// @evidence backend/payments/public-records.test.ts
// @evidence tests/e2e/payout-consent.spec.ts
// Two page calls; five ordinary rows, plus one separate private-table row.
// Page2/lookahead1 represents source100/101. IDs stand for append-only rowids.
// Row2 belongs to actor2; row4 is testnet/project2; vault row5 is nonpaid; row6 is
// private-table evidence and never enters the ordinary table's boundary.
// Exact joins, amounts, asset/time fields and evidence equality are predicates.
// Invalid rows are retained bad input, not writes permitted by this model.
// Boundary, count and page are independent observations. Through excludes
// later appends, not membership changes or later monthly attribution. Direct
// disclosures ignore membership privacy; vault rows exclude private/closed
// members. Absent member rows remain eligible. Scope/tier are fixed per read.
// Vault validation covers selected rows only; invalid lookahead fails its next
// page. Direct row-shape validation is the client's boundary, not publicRecord;
// its invalid class keeps amount parseable (amount failure uses queryFailure).
// Exact page-sum arithmetic and healthy response shape are assumed; malformed
// envelopes and forged duplicate IDs are outside this source-response model.
// Missing monthly attribution remains null. The client publishes only after
// stable total/boundary, no duplicates and complete count are established.
// Legacy unpaged direct replies, byte-level malformed envelopes, component
// lifetime and retaining an earlier good result are outside this model. No
// tests, parsers or checkers were executed for these definitions.
module payment_history {
  val ids = Set(1, 2)
  val ordinaryIds = Set(1, 2, 3, 4, 5)
  val scopes = Set("all", "actor1", "actor2", "project1", "project2")
  type Page = { phase: str, after: int, requested: int, through: int, total: int,
    fetched: Set[int], selected: Set[int], months: Set[int], next: int, result: str }
  val unused: Page = { phase: "unused", after: 0, requested: -1, through: -1,
    total: -1, fetched: Set(), selected: Set(), months: Set(), next: 0, result: "none" }
  var s: { configured: bool, rail: str, scope: str, testnets: bool, present: Set[int],
    hidden: Set[int], invalid: Set[int], unmatched: Set[int], monthly: Set[int],
    pages: int -> Page, through: int, total: int, cursor: int, collected: Set[int],
    ready: bool, failed: bool, privateTablePresent: bool }
  action init = s' = { configured: false, rail: "vault", scope: "all", testnets: false,
    present: Set(1, 2), hidden: Set(2), invalid: Set(), unmatched: Set(), monthly: Set(),
    pages: ids.mapBy(_ => unused), through: -1, total: -1, cursor: 0, collected: Set(),
    ready: false, failed: false, privateTablePresent: false }
  def actor(row: int): int = if (row == 2) 2 else 1
  def project(row: int): int = if (row == 4) 2 else 1
  val highest = s.present.fold(0, (a, b) => if (a > b) a else b)
  def scoped(row: int): bool = s.scope == "all" or s.scope == "actor1" and actor(row) == 1
    or s.scope == "actor2" and actor(row) == 2 or s.scope == "project1" and project(row) == 1
    or s.scope == "project2" and project(row) == 2
  def eligible(row: int): bool = s.present.contains(row) and scoped(row) and
    (s.rail == "direct" or (row != 5 and not(s.hidden.contains(actor(row)))
      and not(s.unmatched.contains(row)) and (s.testnets or row != 4)))
  def first(rows: Set[int], count: int): Set[int] = rows.filter(row => rows.filter(other => other < row).size() < count)
  def failedPage(page: Page, result: str): Page = page.with("phase", "response").with("result", result)
  action configure(rail: str, count: int, public2: bool, invalid: int, unmatched: int): bool = all {
    not(s.configured), Set("vault", "direct").contains(rail), Set(2, 3, 5).contains(count),
    Set(0, 1, 2, 3, 4, 5).contains(invalid), Set(0, 1, 2, 3, 4, 5).contains(unmatched),
    s' = s.with("configured", true).with("rail", rail).with("present", ordinaryIds.filter(row => row <= count))
      .with("hidden", if (public2) Set() else Set(2)).with("invalid", if (invalid == 0) Set() else Set(invalid))
      .with("unmatched", if (unmatched == 0) Set() else Set(unmatched)) }
  action scope(scope: str, testnets: bool): bool = all {
    s.configured, s.through == -1, ids.forall(id => s.pages.get(id).phase == "unused"), scopes.contains(scope),
    s' = s.with("scope", scope).with("testnets", testnets) }
  action appendRecord = all { s.configured, highest < 5, s' = s.with("present", s.present.union(Set(highest + 1))) }
  action appendPrivate = all { not(s.privateTablePresent), s' = s.with("privateTablePresent", true) }
  action visibility(actor: int, visible: bool): bool = all { ids.contains(actor),
    s' = s.with("hidden", if (visible) s.hidden.exclude(Set(actor)) else s.hidden.union(Set(actor))) }
  action attachMonth(row: int): bool = all { s.present.contains(row), s' = s.with("monthly", s.monthly.union(Set(row))) }
  action begin(id: int, after: int, through: int, syntaxValid: bool): bool = all {
    s.configured, ids.contains(id), s.pages.get(id).phase == "unused", Set(0, 1, 2, 3, 4, 5, 6).contains(after),
    Set(-1, 0, 1, 2, 3, 4, 5, 6).contains(through),
    s' = s.with("pages", s.pages.set(id, if (not(syntaxValid) or (after > 0 and through == -1))
      failedPage(unused.with("after", after).with("requested", through), "400")
      else unused.with("phase", "boundary").with("after", after).with("requested", through))) }
  action boundary(id: int): bool = {
    val page = s.pages.get(id)
    val through = if (page.requested == -1) highest else page.requested
    all { page.phase == "boundary", s' = s.with("pages", s.pages.set(id,
      if (through < page.after or through > highest) failedPage(page, "400")
      else page.with("phase", "count").with("through", through))) }
  }
  action count(id: int): bool = {
    val page = s.pages.get(id)
    all { page.phase == "count", s' = s.with("pages", s.pages.set(id, page.with("phase", "page")
      .with("total", s.present.filter(row => eligible(row) and row <= page.through).size()))) }
  }
  action readPage(id: int): bool = {
    val page = s.pages.get(id)
    val fetched = first(s.present.filter(row => eligible(row) and row > page.after and row <= page.through), 3)
    val selected = first(fetched, 2)
    val nextCursor = if (fetched.size() > 2) selected.fold(0, (a, b) => if (a > b) a else b) else 0
    all { page.phase == "page", s' = s.with("pages", s.pages.set(id, page.with("phase", "validate")
      .with("fetched", fetched).with("selected", selected).with("next", nextCursor)
      .with("months", if (s.rail == "vault") selected.intersect(s.monthly) else Set()))) }
  }
  action validate(id: int): bool = {
    val page = s.pages.get(id)
    all { page.phase == "validate", s' = s.with("pages", s.pages.set(id,
      failedPage(page, if (s.rail == "direct" or page.selected.intersect(s.invalid).size() == 0) "200" else "503"))) }
  }
  action queryFailure(id: int): bool = {
    val page = s.pages.get(id)
    all { Set("boundary", "count", "page", "validate").contains(page.phase),
      s' = s.with("pages", s.pages.set(id, failedPage(page, "503"))) }
  }
  action accept(id: int): bool = {
    val page = s.pages.get(id)
    val collected = s.collected.union(page.selected)
    val bad = page.result != "200" or (s.through != -1 and s.through != page.through)
      or (s.rail == "direct" and page.selected.intersect(s.invalid).size() > 0)
      or (s.total != -1 and s.total != page.total) or s.collected.intersect(page.selected).size() > 0
      or collected.size() > page.total or (page.next != 0 and collected.size() >= page.total)
      or (page.next == 0 and collected.size() != page.total)
    // Only the request the sequential client actually issues can be consumed;
    // arbitrary public API cursor calls may still reach a server response.
    all { page.phase == "response", page.after == s.cursor,
      (s.through == -1 and page.requested == -1) or page.requested == s.through,
      not(s.ready), not(s.failed),
      s' = s.with("pages", s.pages.set(id, page.with("phase", "done")))
        .with("failed", bad).with("ready", not(bad) and page.next == 0)
        .with("through", if (bad) s.through else page.through).with("total", if (bad) s.total else page.total)
        .with("cursor", if (bad) s.cursor else page.next).with("collected", if (bad) s.collected else collected) }
  }
  action step = {
    nondet id = ids.oneOf()
    nondet after = Set(0, 1, 2, 3, 4, 5, 6).oneOf()
    nondet through = Set(-1, 0, 1, 2, 3, 4, 5, 6).oneOf()
    nondet row = Set(0, 1, 2, 3, 4, 5).oneOf()
    nondet other = Set(0, 1, 2, 3, 4, 5).oneOf()
    nondet rail = Set("vault", "direct").oneOf()
    nondet n = Set(2, 3, 5).oneOf()
    nondet filterScope = scopes.oneOf()
    nondet yes = Set(false, true).oneOf()
    any { configure(rail, n, yes, row, other), scope(filterScope, yes), appendRecord, appendPrivate,
      visibility(id, yes), attachMonth(row), begin(id, after, through, yes), boundary(id), count(id), readPage(id), validate(id), queryFailure(id), accept(id), s' = s }
  }
  val invariant = all {
    s.present.subseteq(ordinaryIds), not(s.collected.contains(6)),
    ids.forall(id => {
      val page = s.pages.get(id)
      all { page.selected.size() <= 2, page.selected.subseteq(page.fetched),
        page.fetched.size() <= 3, page.months.subseteq(page.selected),
        page.selected.forall(row => row > page.after and row <= page.through),
        (page.result == "200" and s.rail == "vault") implies page.selected.intersect(s.invalid).size() == 0 }
    }), s.ready implies not(s.failed) and s.collected.size() == s.total and s.collected.forall(row => row <= s.through) }
  action base = init.then(configure("vault", 2, false, 0, 0))
  action queried(id: int): bool = boundary(id).then(count(id)).then(readPage(id)).then(validate(id))
  action firstPage = begin(1, 0, -1, true).then(queried(1))
  action nextPage = begin(2, s.cursor, s.through, true).then(queried(2))

  run appendDoesNotMoveReadBoundaryTest = base.then(begin(1, 0, -1, true)).then(boundary(1)).then(appendRecord)
    .then(count(1)).then(readPage(1)).then(validate(1)).then(accept(1))
    .expect(s.through == 2 and s.collected == Set(1) and s.ready and invariant)
  run freshReadFindsLaterTest = base.then(appendRecord).then(firstPage).then(accept(1))
    .expect(s.through == 3 and s.collected == Set(1, 3) and s.ready and invariant)
  run twoPagesPublishOnlyCompleteCollectionTest = init.then(configure("vault", 3, true, 0, 0)).then(firstPage).then(accept(1))
    .expect(not(s.ready) and s.cursor == 2).then(nextPage).then(accept(2))
    .expect(s.ready and s.collected == Set(1, 2, 3) and invariant)
  run newAppendBetweenPagesRemainsOutsideBoundaryTest = init.then(configure("vault", 3, true, 0, 0)).then(firstPage).then(accept(1))
    .then(appendRecord).then(nextPage).then(accept(2)).expect(s.ready and s.through == 3 and not(s.collected.contains(4)) and invariant)
  run hiddenActorLooksLikeEmptyHistoryTest = base.then(scope("actor2", false)).then(firstPage).then(accept(1))
    .expect(s.ready and s.total == 0 and s.collected == Set() and invariant)
  run disclosedDirectRowsRemainPublicDespiteHiddenMembershipTest = init.then(configure("direct", 2, false, 0, 0)).then(scope("actor2", false))
    .then(firstPage).then(accept(1)).expect(s.ready and s.collected == Set(2) and invariant)
  run privateTableDoesNotMoveOrdinaryBoundaryTest = base.then(appendPrivate).then(firstPage).then(accept(1))
    .expect(s.through == 2 and not(s.collected.contains(6)) and invariant)
  run productionFilterExcludesTestnetAndReservedRowsTest = init.then(configure("vault", 5, false, 0, 0)).then(scope("all", false))
    .then(firstPage).then(accept(1)).expect(s.ready and s.collected == Set(1, 3) and s.through == 5 and invariant)
  run stagingRetainsTestnetRowsTest = init.then(configure("vault", 5, false, 0, 0)).then(scope("all", true)).then(firstPage).then(accept(1))
    .then(nextPage).then(accept(2)).expect(s.ready and s.collected == Set(1, 3, 4) and invariant)
  run projectScopeMatchesOnlyItsRowsTest = init.then(configure("vault", 5, true, 0, 0)).then(scope("project2", true)).then(firstPage).then(accept(1))
    .expect(s.ready and s.collected == Set(4) and invariant)
  run missingPaidTransactionJoinExcludesRowTest = init.then(configure("vault", 2, false, 0, 1)).then(firstPage).then(accept(1))
    .expect(s.ready and s.total == 0 and invariant)
  run selectedInvalidEvidenceFailsRatherThanEmptySuccessTest = init.then(configure("vault", 2, false, 1, 0)).then(firstPage).then(accept(1))
    .expect(s.failed and not(s.ready) and s.pages.get(1).result == "503" and invariant)
  run invalidLookaheadWaitsUntilSelectedNextPageTest = init.then(configure("vault", 3, true, 3, 0)).then(firstPage).then(accept(1))
    .expect(s.pages.get(1).result == "200" and not(s.ready)).then(nextPage).then(accept(2))
    .expect(s.failed and s.pages.get(2).result == "503" and invariant)
  run invalidDirectRowIsRefusedAtClientBoundaryTest = init.then(configure("direct", 2, true, 1, 0)).then(firstPage).then(accept(1))
    .expect(s.pages.get(1).result == "200" and s.failed and not(s.ready) and invariant)
  run missingWorkMonthIsNullAtObservationTest = base.then(firstPage).then(accept(1))
    .expect(s.pages.get(1).months == Set() and invariant)
  run laterMonthlyJoinDoesNotRewriteEarlierPageTest = base.then(firstPage).then(attachMonth(1)).then(accept(1))
    .expect(s.monthly == Set(1) and s.pages.get(1).months == Set() and invariant)
  run monthPresentBeforePageIsIncludedTest = base.then(attachMonth(1)).then(firstPage).then(accept(1))
    .expect(s.pages.get(1).months == Set(1) and invariant)
  run visibilityChangeBetweenCountAndPageCanFailClientTest = init.then(configure("vault", 2, true, 0, 0)).then(begin(1, 0, -1, true))
    .then(boundary(1)).then(count(1)).then(visibility(2, false)).then(readPage(1)).then(validate(1)).then(accept(1))
    .expect(s.pages.get(1).total == 2 and s.pages.get(1).selected == Set(1) and s.failed and invariant)
  run visibilityChangeBetweenPagesCanChangeTotalTest = init.then(configure("vault", 3, true, 0, 0)).then(firstPage).then(accept(1))
    .then(visibility(2, false)).then(nextPage).then(accept(2)).expect(s.failed and not(s.ready) and invariant)
  run privacyChangeAfterReadDoesNotRevokeReturnedSnapshotTest = init.then(configure("vault", 2, true, 0, 0)).then(firstPage)
    .then(visibility(2, false)).then(accept(1)).expect(s.ready and s.collected.contains(2) and invariant)
  run afterWithoutThroughIsRejectedTest = base.then(begin(1, 1, -1, true))
    .expect(s.pages.get(1).result == "400" and invariant)
  run unknownOrNoncanonicalCursorIsRejectedTest = base.then(begin(1, 0, -1, false)).then(accept(1))
    .expect(s.pages.get(1).result == "400" and invariant)
  run throughBeyondCurrentBoundaryIsRejectedTest = base.then(begin(1, 0, 6, true)).then(boundary(1))
    .expect(s.pages.get(1).result == "400" and invariant)
  run afterBeyondThroughIsRejectedTest = base.then(begin(1, 3, 2, true)).then(boundary(1))
    .expect(s.pages.get(1).result == "400" and invariant)
  run failedSecondQueryNeverPublishesPartialHistoryTest = init.then(configure("vault", 3, true, 0, 0)).then(firstPage).then(accept(1))
    .then(begin(2, s.cursor, s.through, true)).then(boundary(2)).then(queryFailure(2)).then(accept(2))
    .expect(s.failed and not(s.ready) and s.collected == Set(1, 2) and invariant)
}
