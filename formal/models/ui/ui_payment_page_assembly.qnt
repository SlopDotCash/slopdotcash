// @source src/lib/use-direct-transfers.ts
// @source src/lib/use-vault-payments.ts
// @source src/lib/payments/contracts.ts
// @evidence tests/e2e/public-vault-payments.spec.ts
// @evidence tests/e2e/project-payment-navigation.spec.ts
// @evidence backend/payments/direct-history.workflow.mjs
// Frontend page assembly only. Source-only: every scenario is unexecuted.
// Three records, three pages per invocation and one retry. Amounts are integers.
module ui_payment_page_assembly {
  type State = { mode: str, phase: str, pages: int, retry: int,
    through: int, total: int, after: int, incoming: List[int], offset: int,
    next: int, rows: List[int], seen: Set[int], published: bool,
    legacy: bool, error: str }
  val batches = Set(List(), List(1), List(2), List(3), List(1, 1),
    List(1, 2), List(2, 3), List(1, 2, 3))
  var s: State
  pure def initial(mode: str, retry: int): State = {
    mode: mode, phase: "request", pages: 0, retry: retry, through: -1,
    total: -1, after: 0, incoming: List(), offset: 0, next: -1,
    rows: List(), seen: Set(), published: false, legacy: false, error: "none"
  }
  pure def rejected(value: State, reason: str): State =
    value.with("phase", "error").with("published", false).with("error", reason)
  pure def totalAmount(rows: List[int]): int = rows.foldl(0, (sum, id) => sum + id)
  action init = s' = initial("direct", 0)
  action vaultMode = all { s.pages == 0, s.phase == "request",
    s' = s.with("mode", "vault") }
  action originRefusal = all { s.pages == 0, s.phase == "request",
    s' = rejected(s, "origin") }
  action requestPage = all { s.phase == "request", s.pages < 3,
    s' = s.with("phase", "waiting").with("pages", s.pages + 1) }
  action transportFailure = all { s.phase == "waiting",
    s' = rejected(s, "transport") }
  // rowsValid covers the source's per-row schemas. headersValid covers
  // safe-integer/canonical-number parsing and the page limit of 100.
  action receivePage(rows: List[int], through: int, total: int, nextValue: int,
    rowsValid: bool, headersValid: bool, pageAmount: int): bool = {
    val valid = rowsValid and headersValid and through >= 0 and total >= 0
      and (s.through == -1 or through == s.through)
      and (s.total == -1 or total == s.total)
      and (nextValue == -1 or (rows.length() > 0 and nextValue > s.after and nextValue <= through))
      and (s.mode == "vault" or pageAmount == totalAmount(rows))
    all { s.phase == "waiting", batches.contains(rows),
      s' = if (not(valid)) rejected(s, "page")
      else s.with("phase", "rows").with("through", through).with("total", total)
        .with("incoming", rows).with("offset", 0).with("next", nextValue) }
  }
  // The legacy path is selected only when ALL three pagination properties
  // are absent on the first response. It does not compare the sum or dedupe.
  action receiveLegacy(rows: List[int], rowsValid: bool, canonicalAmount: bool): bool = {
    all { s.phase == "waiting", s.mode == "direct", s.through == -1,
      batches.contains(rows),
      s' = if (not(rowsValid and canonicalAmount)) rejected(s, "legacy-shape")
      else s.with("phase", "complete").with("rows", rows)
        .with("seen", rows.foldl(Set(), (seen, id) => seen.union(Set(id))))
        .with("published", true).with("legacy", true) }
  }
  // The synchronous source loop may append a private prefix before a later
  // duplicate throws. It never publishes that prefix as a successful result.
  action appendRow = {
    val id = if (s.offset < s.incoming.length()) s.incoming[s.offset] else 1
    all { s.phase == "rows", s.offset < s.incoming.length(),
      s' = if (s.seen.contains(id)) rejected(s, "duplicate")
      else s.with("rows", s.rows.append(id)).with("seen", s.seen.union(Set(id)))
        .with("offset", s.offset + 1) }
  }
  action finishPage = {
    val count = s.rows.length()
    all { s.phase == "rows", s.offset == s.incoming.length(),
      s' = if (count > s.total or (s.next != -1 and count >= s.total))
        rejected(s, "count")
      else if (s.next == -1 and count != s.total) rejected(s, "incomplete")
      else if (s.next == -1) s.with("phase", "complete").with("published", true)
      else s.with("phase", "request").with("after", s.next) }
  }
  // Cancellation is at the outstanding fetch/body await. The row loop is
  // synchronous and has no independent browser-event interleaving.
  action cancelWaiting = all { s.phase == "waiting",
    s' = s.with("phase", "cancelled").with("published", false) }
  action lateReply = all { s.phase == "cancelled", s' = s }
  action retry = all { s.phase == "error", s.retry == 0,
    s' = initial(s.mode, 1) }
  action step = {
    nondet rows = batches.oneOf()
    nondet through = Set(-1, 0, 1, 2, 3).oneOf()
    nondet total = Set(-1, 0, 1, 2, 3).oneOf()
    nondet nextValue = Set(-1, 0, 1, 2, 3).oneOf()
    nondet shape = Set(false, true).oneOf()
    nondet headers = Set(false, true).oneOf()
    nondet amount = Set(0, 1, 2, 3, 4, 5, 6).oneOf()
    any { vaultMode, originRefusal, requestPage, transportFailure,
      receivePage(rows, through, total, nextValue, shape, headers, amount),
      receiveLegacy(rows, shape, headers), appendRow, finishPage,
      cancelWaiting, lateReply, retry, s' = s }
  }
  val invariant = all {
    s.pages >= 0, s.pages <= 3, s.retry >= 0, s.retry <= 1,
    s.published implies s.phase == "complete",
    (s.published and not(s.legacy)) implies
      (s.rows.length() == s.total and s.rows.length() == s.seen.size()),
    Set("error", "cancelled").contains(s.phase) implies not(s.published)
  }
  run directPagesPublishOnlyAtTheEndTest = init.then(requestPage)
    .then(receivePage(List(1, 2), 3, 3, 2, true, true, 3)).then(appendRow).then(appendRow)
    .then(finishPage).expect(not(s.published) and s.rows == List(1, 2))
  run directCompletePagesTest = init.then(requestPage)
    .then(receivePage(List(1, 2), 3, 3, 2, true, true, 3)).then(appendRow).then(appendRow)
    .then(finishPage).then(requestPage).then(receivePage(List(3), 3, 3, -1, true, true, 3))
    .then(appendRow).then(finishPage).expect(s.published and s.rows == List(1, 2, 3))
  run vaultThreePagesTest = init.then(vaultMode).then(requestPage)
    .then(receivePage(List(1), 3, 3, 1, true, true, 0)).then(appendRow).then(finishPage)
    .then(requestPage).then(receivePage(List(2), 3, 3, 2, true, true, 0)).then(appendRow).then(finishPage)
    .then(requestPage).then(receivePage(List(3), 3, 3, -1, true, true, 0)).then(appendRow).then(finishPage)
    .expect(s.published and s.pages == 3)
  run emptyFinalPageIsAnEmptySuccessTest = init.then(requestPage)
    .then(receivePage(List(), 0, 0, -1, true, true, 0)).then(finishPage)
    .expect(s.published and s.rows == List())
  run changedBoundaryIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(1), 3, 2, 1, true, true, 1)).then(appendRow).then(finishPage)
    .then(requestPage).then(receivePage(List(2), 2, 2, -1, true, true, 2))
    .expect(s.phase == "error" and not(s.published))
  run changedTotalIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(1), 3, 2, 1, true, true, 1)).then(appendRow).then(finishPage)
    .then(requestPage).then(receivePage(List(2), 3, 3, -1, true, true, 2))
    .expect(s.phase == "error" and not(s.published))
  run nonAdvancingCursorIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(1), 3, 2, 0, true, true, 1)).expect(s.phase == "error")
  run cursorBeyondBoundaryIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(1), 2, 2, 3, true, true, 1)).expect(s.phase == "error")
  run emptyContinuationIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(), 3, 2, 1, true, true, 0)).expect(s.phase == "error")
  run withinPageDuplicateKeepsOnlyPrivatePrefixTest = init.then(requestPage)
    .then(receivePage(List(1, 1), 3, 2, -1, true, true, 2)).then(appendRow).then(appendRow)
    .expect(s.error == "duplicate" and s.rows == List(1) and not(s.published))
  run crossPageDuplicateIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(1), 3, 2, 1, true, true, 1)).then(appendRow).then(finishPage)
    .then(requestPage).then(receivePage(List(1), 3, 2, -1, true, true, 1)).then(appendRow)
    .expect(s.error == "duplicate" and not(s.published))
  run countOverflowIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(1, 2), 3, 1, -1, true, true, 3)).then(appendRow).then(appendRow)
    .then(finishPage).expect(s.error == "count" and not(s.published))
  run shortFinalPageIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(1), 3, 3, -1, true, true, 1)).then(appendRow).then(finishPage)
    .expect(s.error == "incomplete" and not(s.published))
  run continuationAfterTotalIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(1), 3, 1, 1, true, true, 1)).then(appendRow).then(finishPage)
    .expect(s.error == "count" and not(s.published))
  run directPageAmountMismatchIsAnErrorTest = init.then(requestPage)
    .then(receivePage(List(1), 1, 1, -1, true, true, 2)).expect(s.phase == "error")
  run vaultDoesNotInventDirectAmountCheckTest = init.then(vaultMode).then(requestPage)
    .then(receivePage(List(1), 1, 1, -1, true, true, 0)).then(appendRow).then(finishPage)
    .expect(s.published)
  run legacyPreservesItsWeakerContractTest = init.then(requestPage)
    .then(receiveLegacy(List(1, 1), true, true))
    .expect(s.published and s.legacy and s.rows.length() != s.seen.size())
  run legacyInvalidMoneyShapeIsAnErrorTest = init.then(requestPage)
    .then(receiveLegacy(List(1), true, false)).expect(s.phase == "error")
  run noLegacyFallbackAfterFirstPagedReplyTest = init.then(requestPage)
    .then(receivePage(List(1), 3, 2, 1, true, true, 1)).then(appendRow).then(finishPage)
    .then(requestPage).then(receiveLegacy(List(2), true, true).fail())
  run malformedPaginationIsNotLegacyTest = init.then(requestPage)
    .then(receivePage(List(1), 1, 1, -1, true, false, 1)).expect(s.phase == "error")
  run blockedOriginStartsNoRequestTest = init.then(originRefusal)
    .expect(s.pages == 0 and not(s.published))
  run failedSecondPageNeverPublishesPrefixTest = init.then(requestPage)
    .then(receivePage(List(1), 3, 2, 1, true, true, 1)).then(appendRow).then(finishPage)
    .then(requestPage).then(transportFailure).expect(s.rows == List(1) and not(s.published))
  run cancelledReplyCannotPublishTest = init.then(requestPage).then(cancelWaiting).then(lateReply)
    .expect(s.phase == "cancelled" and not(s.published))
  run retryStartsWithFreshAssemblyTest = init.then(requestPage)
    .then(receivePage(List(1), 3, 2, 1, true, true, 1)).then(appendRow).then(finishPage)
    .then(requestPage).then(transportFailure).then(retry).then(requestPage)
    .then(receivePage(List(), 0, 0, -1, true, true, 0)).then(finishPage)
    .expect(s.published and s.rows == List() and s.retry == 1)
}
