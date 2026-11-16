// @source src/SecurityBounty.tsx
// @evidence tests/e2e/security-bounty.spec.ts
// @evidence tests/e2e/inbox-response-owner.spec.ts
// Two simultaneously open PrivateReportDetail instances. Immutable submission
// IDs scope each card and summary heading reference. This finite projection
// checks distinct DOM references, not browser-computed accessible names; the
// real two-report axe flow checks those names and both bodies' account reset.
module ui_private_report_identity {
  // One focused receipt per panel lifetime. Positive values are revisions,
  // zero is absent, and -1 means the dedicated read has no accepted result.
  type Focused = { recent: int, receipt: int, listPending: bool,
    receiptPending: bool, listFailed: bool, receiptFailed: bool, actionApplied: bool }
  var opened: Set[int]
  var focused: Focused
  val reports = Set(1, 2)
  val revisions = Set(0, 1, 2)
  pure val emptyFocus = { recent: 0, receipt: -1, listPending: false,
    receiptPending: false, listFailed: false, receiptFailed: false, actionApplied: false }
  pure def cardHeading(id: int): int = id * 2
  pure def summaryHeading(id: int): int = id * 2 + 1
  pure def references(id: int): Set[int] = Set(cardHeading(id), summaryHeading(id))
  val shown = if (focused.receipt < 0) focused.recent else focused.receipt

  action init = all { opened' = Set(), focused' = emptyFocus }
  action openFirst = all { opened' = opened.union(Set(1)), focused' = focused }
  action openSecond = all { opened' = opened.union(Set(2)), focused' = focused }
  action closeFirst = all { opened' = opened.exclude(Set(1)), focused' = focused }
  action closeSecond = all { opened' = opened.exclude(Set(2)), focused' = focused }
  action accountChanges = all { opened' = Set(), focused' = emptyFocus }
  // The panel starts the current list and metadata read independently. A newer
  // load supersedes the older generation, so only current replies are modeled.
  action load = all { opened' = opened, focused' = focused.with("listPending", true)
    .with("receiptPending", true).with("listFailed", false).with("receiptFailed", false)
    .with("actionApplied", false) }
  action listReply(revision: int): bool = all { opened' = opened,
    focused.listPending, revisions.contains(revision),
    focused' = focused.with("listPending", false).with("recent", revision) }
  action listUnavailable = all { opened' = opened, focused.listPending,
    focused' = focused.with("listPending", false).with("listFailed", true) }
  action receiptReply(revision: int, recipientMatches: bool, idMatches: bool): bool = all {
    opened' = opened, focused.receiptPending, revisions.contains(revision),
    val completed = focused.with("receiptPending", false)
    focused' = if (focused.actionApplied) completed
      else if (recipientMatches and idMatches) completed.with("receipt", revision)
      else completed.with("receiptFailed", true),
  }
  action updateReceipt = all { opened' = opened, shown == 1,
    focused' = focused.with("receipt", 2).with("actionApplied", true).with("receiptFailed", false) }
  action nextList = { nondet revision = revisions.oneOf() listReply(revision) }
  action nextReceipt = { nondet revision = revisions.oneOf() receiptReply(revision, true, true) }
  action step = any {
    openFirst, openSecond, closeFirst, closeSecond, accountChanges,
    load, nextList, listUnavailable, nextReceipt, updateReceipt,
    receiptReply(1, false, true), receiptReply(1, true, false),
    all { opened' = opened, focused' = focused },
  }
  val invariant = all {
    opened.subseteq(reports),
    opened.forall(a => opened.forall(b =>
      a != b implies references(a).intersect(references(b)) == Set())),
    focused.receipt >= 0 implies shown == focused.receipt,
    focused.actionApplied implies shown == 2,
  }
  run bothOpenKeepDistinctReferencesTest = init.then(openFirst).then(openSecond)
    .expect(opened.size() == 2 and references(1).union(references(2)).size() == 4)
  run closingOneKeepsTheOtherTest = init.then(openFirst).then(openSecond)
    .then(closeFirst).expect(opened == Set(2))
  run accountChangeRemovesBothTest = init.then(openFirst).then(openSecond)
    .then(accountChanges).expect(opened == Set())
  run receiptLoadsBeforeListAndSurvivesListFailureTest = init.then(load)
    .then(receiptReply(1, true, true)).expect(shown == 1 and focused.listPending and opened == Set())
    .then(listUnavailable).expect(shown == 1 and focused.listFailed and opened == Set())
  run refreshedReceiptWinsOverStaleRecentListTest = init.then(load)
    .then(receiptReply(2, true, true)).then(listReply(1)).expect(shown == 2)
  run actionWinsOverBothPendingReadsTest = init.then(load).then(receiptReply(1, true, true))
    .then(load).then(updateReceipt).then(receiptReply(1, true, true)).then(listReply(1))
    .expect(shown == 2 and focused.recent == 1)
  run receiptRejectsWrongRecipientTest = init.then(load).then(receiptReply(1, false, true))
    .expect(shown == 0 and focused.receiptFailed and opened == Set())
  run receiptRejectsWrongReportTest = init.then(load).then(receiptReply(1, true, false))
    .expect(shown == 0 and focused.receiptFailed and opened == Set())
  run missingReceiptSupersedesRecentRowTest = init.then(load).then(listReply(1))
    .then(receiptReply(0, true, true)).expect(shown == 0 and focused.recent == 1)
}
