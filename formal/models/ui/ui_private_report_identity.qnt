// @source src/SecurityBounty.tsx
// @evidence tests/e2e/security-bounty.spec.ts
// Two simultaneously open PrivateReportDetail instances. Immutable submission
// IDs scope each card and summary heading reference. This finite projection
// checks distinct DOM references, not browser-computed accessible names; the
// real two-report axe flow checks those names and both bodies' account reset.
module ui_private_report_identity {
  var opened: Set[int]
  val reports = Set(1, 2)
  pure def cardHeading(id: int): int = id * 2
  pure def summaryHeading(id: int): int = id * 2 + 1
  pure def references(id: int): Set[int] = Set(cardHeading(id), summaryHeading(id))

  action init = opened' = Set()
  action openFirst = opened' = opened.union(Set(1))
  action openSecond = opened' = opened.union(Set(2))
  action closeFirst = opened' = opened.exclude(Set(1))
  action closeSecond = opened' = opened.exclude(Set(2))
  action accountChanges = opened' = Set()
  action step = any {
    openFirst, openSecond, closeFirst, closeSecond, accountChanges,
    opened' = opened,
  }
  val invariant = all {
    opened.subseteq(reports),
    opened.forall(a => opened.forall(b =>
      a != b implies references(a).intersect(references(b)) == Set())),
  }
  run bothOpenKeepDistinctReferencesTest = init.then(openFirst).then(openSecond)
    .expect(opened.size() == 2 and references(1).union(references(2)).size() == 4)
  run closingOneKeepsTheOtherTest = init.then(openFirst).then(openSecond)
    .then(closeFirst).expect(opened == Set(2))
  run accountChangeRemovesBothTest = init.then(openFirst).then(openSecond)
    .then(accountChanges).expect(opened == Set())
}
