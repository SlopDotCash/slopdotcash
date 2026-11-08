// @source workers/slopbot/value-accepted-commit-census.ts
// One PR, up to three required commits from four identities. Two listed commits
// abstract GitHub's 250-commit ceiling; compare pages of two abstract 100/page.
// Hash/repository/head validity and transport failure are equivalence classes.
module bot_commit_census_fallback {
  var s: {phase: str, total: int, listed: Set[int], compared: Set[int],
    page: int, accepted: Set[int], published: bool}
  action init = s' = {phase: "listing", total: 3, listed: Set(), compared: Set(),
    page: 1, accepted: Set(), published: false}
  action listedCommit(id: int): bool = all {s.phase == "listing", not(id.in(s.listed)),
    s' = s.with("listed", s.listed.union(Set(id)))}
  action finishListing = all {s.phase == "listing",
    s' = if(s.listed.size() == s.total) s.with("phase", "ready").with("accepted", s.listed)
      else if(s.listed.size() == 2 and s.total > 2) s.with("phase", "heads")
      else s.with("phase", "incomplete")}
  action rangeHeads(valid: bool): bool = all {s.phase == "heads",
    s' = s.with("phase", if(valid) "compare" else "incomplete")}
  action comparePage(ids: Set[int], countMatches: bool, validHashes: bool): bool = all {s.phase == "compare",
    val expected = if(s.page == 1) 2 else 1
    val combined = s.compared.union(ids)
    val valid = countMatches and validHashes and ids.size() == expected and s.compared.intersect(ids).size() == 0
    s' = if(not(valid)) s.with("phase", "incomplete")
      else if(s.page == 1) s.with("compared", combined).with("page", 2)
      else if(combined.size() == s.total and s.listed.subseteq(combined))
        s.with("compared", combined).with("accepted", combined).with("phase", "ready")
      else s.with("phase", "incomplete")}
  action publish = all {s.phase == "ready", s' = s.with("published", true)}
  action step = {
    nondet id = Set(1, 2, 3, 4).oneOf()
    nondet ids = Set(Set(), Set(1), Set(2), Set(3), Set(4), Set(1, 2), Set(1, 3), Set(1, 4), Set(2, 3), Set(2, 4), Set(3, 4)).oneOf()
    nondet valid = Set(false, true).oneOf()
    nondet hashes = Set(false, true).oneOf()
    any {listedCommit(id), finishListing, rangeHeads(valid), comparePage(ids, valid, hashes), publish, s' = s}
  }
  val invariant = all {
    s.published implies s.phase == "ready" and s.accepted.size() == s.total and s.listed.subseteq(s.accepted),
    s.phase == "incomplete" implies not(s.published), s.page.in(Set(1, 2)),
  }
  run listingCeilingRecoversThroughCompleteCompareTest = init.then(listedCommit(1)).then(listedCommit(2))
    .then(finishListing).then(rangeHeads(true)).then(comparePage(Set(1, 2), true, true))
    .then(comparePage(Set(3), true, true)).then(publish).expect(s.accepted == Set(1, 2, 3) and s.published)
  run arbitraryShortListingCannotUseFallbackTest = init.then(listedCommit(1)).then(finishListing)
    .expect(s.phase == "incomplete")
  run missingHeadCannotCompleteTest = init.then(listedCommit(1)).then(listedCommit(2)).then(finishListing)
    .then(rangeHeads(false)).expect(s.phase == "incomplete")
  run movingCompareCountCannotCompleteTest = init.then(listedCommit(1)).then(listedCommit(2)).then(finishListing)
    .then(rangeHeads(true)).then(comparePage(Set(1, 2), false, true)).expect(s.phase == "incomplete")
  run omittedListedCommitCannotCompleteTest = init.then(listedCommit(1)).then(listedCommit(2)).then(finishListing)
    .then(rangeHeads(true)).then(comparePage(Set(1, 3), true, true))
    .then(comparePage(Set(4), true, true)).expect(s.phase == "incomplete")
  run shortLastPageCannotCompleteTest = init.then(listedCommit(1)).then(listedCommit(2)).then(finishListing)
    .then(rangeHeads(true)).then(comparePage(Set(1, 2), true, true))
    .then(comparePage(Set(), true, true)).expect(s.phase == "incomplete")
  run duplicateAcrossPagesCannotCompleteTest = init.then(listedCommit(1)).then(listedCommit(2)).then(finishListing)
    .then(rangeHeads(true)).then(comparePage(Set(1, 2), true, true))
    .then(comparePage(Set(1), true, true)).expect(s.phase == "incomplete")
}
