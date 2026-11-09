// @source backend/projects/github-lookup.ts
// @source backend/github.ts
// @evidence backend/projects/integration-branch.test.ts
// @evidence scripts/project-registry-api.test.ts
// One repository lookup or unchanged strict readBranchHead call. Two repository
// IDs, two branch names, three commit/blob classes, three opaque cursor classes,
// and page classes 1/2/20. Advancing page2 to20 compresses valid intermediate
// requests; it does not claim an actual two-page request budget.
// Repository lookup requires the configured public-only token. Its permission
// scope is an external deployment contract, not discoverable from token bytes.
// Initial REST metadata captures numeric and node identity. Every GraphQL page,
// default-head read and exact-commit LICENSE object checks that same identity
// and publicness. Branch pages are complete-or-error; missing target OIDs fail.
// Cursor absence, malformed/cyclic cursors, partial GraphQL replies and the
// twenty-page boundary cannot expose partial branch facts. Ref values remain
// mutable across pages: identity binding does not claim a frozen ref snapshot.
// License failures keep complete repository facts but return unknown. Verified
// classification requires root file LICENSE, a usable SPDX, base64 bytes,
// returned blob OID and recomputed Git blob hash matching the immutable node's
// '<captured commit>:LICENSE' object. REST may resolve a renamed/reused path,
// but only identical expected blob bytes can pass. SHA-256 binds those bytes.
// Old mixed-name actions are historical negative controls, excluded from step.
// The strict standalone head reader still uses its input name and throws on
// every failed/malformed response; this change does not rewrite that contract.
// JSON, branch syntax, response bounds, base64 and both hashes are predicates,
// not proofs of their implementations. These are authored, unexecuted models
// and regression definitions; live provider conformance remains unperformed.
module github_lookup_repository {
  val repositories = Set(1, 2)
  val branches = Set(1, 2)
  val entries = 0.to(6)
  val fetchResults = Set("valid", "404", "rate", "http", "redirect", "partial", "bad-object", "body", "transport")
  val licenseResults = Set("valid", "404", "wrong-path", "non-file", "wrong-oid", "wrong-bytes", "unknown-spdx", "no-bytes", "invalid-base64", "rate", "http", "body", "transport")
  var s: { phase: str, mode: str, nameRepository: int, capturedRepository: int,
    token: bool, heads: int -> int, page: int, batch: List[int], rowIndex: int,
    pageSource: int, pageCommit: int, seenCursors: Set[int],
    listed: Set[int], branchCommits: int -> int, branchSources: Set[int],
    pinnedCommit: int, headSource: int, blobSource: int, expectedBlob: int,
    licenseSource: int, byteBlob: int, licenseHash: int,
    result: str, status: int, exposed: bool }
  action init = s' = { phase: "input", mode: "repository", nameRepository: 1, capturedRepository: 0,
    token: false, heads: Map(1 -> 1, 2 -> 3), page: 1, batch: [0, 0], rowIndex: 0,
    pageSource: 0, pageCommit: 0, seenCursors: Set(),
    listed: Set(), branchCommits: branches.mapBy(_ => 0), branchSources: Set(),
    pinnedCommit: 0, headSource: 0, blobSource: 0, expectedBlob: 0,
    licenseSource: 0, byteBlob: 0, licenseHash: 0,
    result: "none", status: 0, exposed: false }
  action renameAndReuse = all { s.nameRepository == 1, s' = s.with("nameRepository", 2) }
  action advanceHead = all { s.heads.get(1) == 1, s' = s.with("heads", s.heads.set(1, 2)) }
  action begin(mode: str, valid: bool): bool = all {
    s.phase == "input", Set("repository", "head").contains(mode),
    s' = s.with("mode", mode).with("phase", if (not(valid)) "done" else if (mode == "head") "head" else "credential")
      .with("result", if (valid) "none" else "error").with("status", if (valid) 0 else 400) }
  action credential(present: bool): bool = all { s.phase == "credential",
    s' = s.with("token", present).with("phase", if (present) "metadata" else "done")
      .with("result", if (present) "none" else "error").with("status", if (present) 0 else 503) }
  action metadata(outcome: str, complete: bool): bool = {
    val valid = outcome == "valid" and complete
    all { s.phase == "metadata", fetchResults.contains(outcome),
      s' = s.with("phase", if (valid) "page" else "done").with("result", if (valid) "none" else "error")
        .with("capturedRepository", if (valid) s.nameRepository else 0)
        .with("status", if (valid) 0 else if (outcome == "404") 404 else if (outcome == "rate") 503
          else if (Set("body", "transport").contains(outcome)) 0 else 502) }
  }
  action pageReply(outcome: str, first: int, second: int): bool = all {
    s.phase == "page", fetchResults.contains(outcome), entries.contains(first), entries.contains(second),
    s' = s.with("phase", if (outcome == "valid") "rows" else "done").with("batch", [first, second]).with("rowIndex", 0)
      .with("pageSource", s.capturedRepository).with("pageCommit", s.heads.get(s.capturedRepository))
      .with("result", if (outcome == "valid") "none" else "error")
      .with("status", if (outcome == "rate") 503 else if (Set("body", "transport").contains(outcome)) 0
        else if (outcome == "valid") 0 else 502) }
  action pageIdentityRefusal(kind: str): bool = all {
    s.phase == "page", Set("numeric-id", "node-id", "private", "missing-node").contains(kind),
    s' = s.with("phase", "done").with("result", "error").with("status", 502) }
  action row = {
    val entry = if (s.rowIndex < 2) s.batch.nth(s.rowIndex) else 0
    val bad = Set(3, 4, 5, 6).contains(entry)
    val name = if (entry == 1 or entry == 3) 1 else 2
    all { s.phase == "rows", s.rowIndex < 2,
      s' = if (bad) s.with("phase", "done").with("result", "error").with("status", 502)
        else s.with("rowIndex", s.rowIndex + 1).with("phase", if (s.rowIndex == 1) "cursor" else "rows")
          .with("listed", if (entry == 0) s.listed else s.listed.union(Set(name)))
          .with("branchSources", if (entry == 0) s.branchSources else s.branchSources.union(Set(s.pageSource)))
          .with("branchCommits", if (entry == 0) s.branchCommits else s.branchCommits.set(name, s.pageCommit)) }
  }
  action nextPage(kind: str): bool = {
    val cursor = if (kind == "fresh1") 1 else if (kind == "fresh2") 2 else if (kind == "fresh3") 3 else 0
    val valid = cursor > 0 and not(s.seenCursors.contains(cursor)) and s.page < 20
    all { s.phase == "cursor", Set("none", "fresh1", "fresh2", "fresh3", "empty", "malformed").contains(kind),
      s' = if (kind == "none" and s.listed.contains(1)) s.with("phase", "head")
        else if (valid) s.with("phase", "page").with("page", if (s.page == 1) 2 else 20)
          .with("seenCursors", s.seenCursors.union(Set(cursor)))
        else s.with("phase", "done").with("result", "error").with("status", 502) }
  }
  action headReply(outcome: str): bool = {
    val valid = outcome == "valid"
    val fallback = not(valid) and s.mode == "repository"
    val source = if (s.mode == "head") s.nameRepository else s.capturedRepository
    all { s.phase == "head", fetchResults.contains(outcome),
      s' = s.with("phase", if (valid and s.mode == "repository") "blob" else "done")
        .with("pinnedCommit", if (valid) s.heads.get(source) else 0).with("headSource", if (valid) source else 0)
        .with("result", if (valid) (if (s.mode == "head") "head" else "none") else if (fallback) "unknown-license" else "error")
        .with("exposed", fallback).with("status", if (valid or fallback) 0 else if (outcome == "rate") 503
          else if (Set("body", "transport").contains(outcome)) 0 else 502) }
  }
  action blobReply(outcome: str): bool = all {
    s.phase == "blob", Set("valid", "missing", "non-blob", "node-id", "private", "rate", "partial", "transport").contains(outcome),
    s' = s.with("phase", if (outcome == "valid") "license" else "done")
      .with("blobSource", if (outcome == "valid") s.capturedRepository else 0)
      .with("expectedBlob", if (outcome == "valid") s.pinnedCommit else 0)
      .with("result", if (outcome == "valid") "none" else "unknown-license").with("exposed", outcome != "valid") }
  action license(outcome: str): bool = all { s.phase == "license", licenseResults.contains(outcome),
    s' = s.with("phase", "done").with("result", if (outcome == "valid") "verified-license" else "unknown-license")
      .with("licenseSource", s.nameRepository).with("byteBlob", if (outcome == "valid") s.expectedBlob else 0)
      .with("licenseHash", if (outcome == "valid") s.expectedBlob else 0).with("exposed", true).with("status", 0) }
  // Pre-fix implementation accepted named branch/head/license reads. These
  // actions intentionally bypass the new guards and are never current step.
  action oldNamedPage = all { s.phase == "page",
    s' = s.with("phase", "rows").with("batch", [1, 2]).with("rowIndex", 0)
      .with("pageSource", s.nameRepository).with("pageCommit", s.heads.get(s.nameRepository)) }
  action oldNamedLicense = all { s.phase == "head", s.mode == "repository",
    s' = s.with("phase", "done").with("result", "verified-license").with("exposed", true)
      .with("pinnedCommit", s.heads.get(s.nameRepository)).with("headSource", s.nameRepository)
      .with("blobSource", s.nameRepository).with("expectedBlob", s.heads.get(s.nameRepository))
      .with("licenseSource", s.nameRepository).with("byteBlob", s.heads.get(s.nameRepository))
      .with("licenseHash", s.heads.get(s.nameRepository)) }
  action step = {
    nondet mode = Set("repository", "head").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet outcome = fetchResults.oneOf()
    nondet first = entries.oneOf()
    nondet second = entries.oneOf()
    nondet nextValue = Set("none", "fresh1", "fresh2", "fresh3", "empty", "malformed").oneOf()
    nondet identity = Set("numeric-id", "node-id", "private", "missing-node").oneOf()
    nondet blob = Set("valid", "missing", "non-blob", "node-id", "private", "rate", "partial", "transport").oneOf()
    nondet licensed = licenseResults.oneOf()
    any { renameAndReuse, advanceHead, begin(mode, yes), credential(yes), metadata(outcome, yes),
      pageReply(outcome, first, second), pageIdentityRefusal(identity), row, nextPage(nextValue),
      headReply(outcome), blobReply(blob), license(licensed), s' = s }
  }
  val sourceIdentity = s.branchSources.subseteq(Set(s.capturedRepository))
    and (s.mode != "repository" or s.headSource == 0 or s.headSource == s.capturedRepository)
    and (s.blobSource == 0 or s.blobSource == s.capturedRepository)
  val invariant = all { repositories.contains(s.nameRepository), Set(1, 2, 20).contains(s.page), s.listed.subseteq(branches),
    s.exposed implies s.mode == "repository" and s.token and s.capturedRepository > 0 and s.listed.contains(1),
    s.result == "error" implies not(s.exposed), sourceIdentity,
    s.result == "head" implies s.mode == "head" and s.pinnedCommit > 0,
    s.result == "verified-license" implies s.exposed and s.expectedBlob > 0
      and s.byteBlob == s.expectedBlob and s.licenseHash == s.expectedBlob and s.pinnedCommit > 0,
    s.result == "unknown-license" implies s.exposed and s.licenseHash == 0 }
  action repository = begin("repository", true).then(credential(true)).then(metadata("valid", true))
  action page(first: int, second: int): bool = pageReply("valid", first, second).then(row).then(row)
  action completeBranches = page(1, 2).then(nextPage("none"))
  action licenseSource = headReply("valid").then(blobReply("valid"))
  run completeRepositoryLicenseUsesPinnedCommitTest = init.then(repository).then(completeBranches).then(licenseSource).then(license("valid"))
    .expect(s.exposed and s.licenseHash == 1 and invariant)
  run invalidRepositorySyntaxMakesNoReadTest = init.then(begin("repository", false)).expect(s.status == 400 and s.capturedRepository == 0 and invariant)
  run missingPublicTokenMakesNoReadTest = init.then(begin("repository", true)).then(credential(false)).expect(s.status == 503 and s.capturedRepository == 0 and invariant)
  run absentRepositoryIs404Test = init.then(begin("repository", true)).then(credential(true)).then(metadata("404", true)).expect(s.status == 404 and invariant)
  run incompleteMetadataDoesNotExposeFactsTest = init.then(begin("repository", true)).then(credential(true)).then(metadata("valid", false)).expect(s.status == 502 and invariant)
  run invalidBranchNameRefusesWholeLookupTest = init.then(repository).then(pageReply("valid", 1, 5)).then(row).then(row).expect(s.result == "error" and invariant)
  run invalidBranchCommitRefusesWholeLookupTest = init.then(repository).then(pageReply("valid", 6, 0)).then(row).expect(s.status == 502 and invariant)
  run absentBranchTargetCannotReuseEarlierCommitTest = init.then(repository).then(page(1, 0)).then(nextPage("fresh1")).then(pageReply("valid", 3, 0)).then(row).expect(s.result == "error" and invariant)
  run laterPageFailureDoesNotExposeEarlierBranchesTest = init.then(repository).then(page(1, 0)).then(nextPage("fresh1")).then(pageReply("rate", 0, 0)).expect(s.listed == Set(1) and not(s.exposed) and s.status == 503 and invariant)
  run partialGraphqlResponseRefusesFactsTest = init.then(repository).then(pageReply("partial", 1, 2)).expect(s.result == "error" and invariant)
  run reusedNodeIdentityRefusesFactsTest = init.then(repository).then(pageIdentityRefusal("node-id")).expect(s.status == 502 and invariant)
  run mismatchedNumericIdentityRefusesFactsTest = init.then(repository).then(pageIdentityRefusal("numeric-id")).expect(s.status == 502 and invariant)
  run privateNodeRefusesFactsTest = init.then(repository).then(pageIdentityRefusal("private")).expect(s.status == 502 and invariant)
  run emptyNextCursorRefusesTest = init.then(repository).then(page(1, 0)).then(nextPage("empty")).expect(s.status == 502 and invariant)
  run repeatedNextCursorRefusesTest = init.then(repository).then(page(1, 0)).then(nextPage("fresh1")).then(page(2, 0)).then(nextPage("fresh1")).expect(s.result == "error" and invariant)
  run earlierCursorCycleRefusesTest = init.then(repository).then(page(1, 0)).then(nextPage("fresh1")).then(page(2, 0)).then(nextPage("fresh2")).then(page(1, 0)).then(nextPage("fresh1")).expect(s.result == "error" and invariant)
  run absentDefaultBranchRefusesBeforeLicenseTest = init.then(repository).then(page(2, 0)).then(nextPage("none")).expect(s.result == "error" and invariant)
  run laterPresentCommitWinsDuplicateNameTest = init.then(repository).then(page(1, 0)).then(nextPage("fresh1")).then(advanceHead).then(page(1, 2)).then(nextPage("none")).then(headReply("404")).expect(s.branchCommits.get(1) == 2 and invariant)
  run twentiethPageWithNextRefusesPartialBranchesTest = init.then(repository).then(page(1, 0)).then(nextPage("fresh1")).then(page(2, 0)).then(nextPage("fresh2")).then(page(1, 0)).then(nextPage("fresh3")).expect(s.page == 20 and s.result == "error" and invariant)
  run missingLicenseObjectKeepsRepositoryFactsTest = init.then(repository).then(completeBranches).then(headReply("valid")).then(blobReply("missing")).expect(s.exposed and s.result == "unknown-license" and invariant)
  run changedLicenseNodeKeepsUnknownLicenseTest = init.then(repository).then(completeBranches).then(headReply("valid")).then(blobReply("node-id")).expect(s.exposed and s.licenseHash == 0 and invariant)
  run changedHeadNodeKeepsUnknownLicenseTest = init.then(repository).then(completeBranches).then(headReply("bad-object")).expect(s.exposed and s.result == "unknown-license" and invariant)
  run missingRestLicenseKeepsRepositoryFactsTest = init.then(repository).then(completeBranches).then(licenseSource).then(license("404")).expect(s.exposed and s.result == "unknown-license" and invariant)
  run invalidLicenseBytesDoNotBecomeVerifiedTest = init.then(repository).then(completeBranches).then(licenseSource).then(license("invalid-base64")).expect(s.licenseHash == 0 and invariant)
  run wrongLicenseBlobOidRemainsUnknownTest = init.then(repository).then(completeBranches).then(licenseSource).then(license("wrong-oid")).expect(s.result == "unknown-license" and invariant)
  run claimedCorrectOidWithDifferentBytesRemainsUnknownTest = init.then(repository).then(completeBranches).then(licenseSource).then(license("wrong-bytes")).expect(s.result == "unknown-license" and invariant)
  run nonFileLicenseRemainsUnknownTest = init.then(repository).then(completeBranches).then(licenseSource).then(license("non-file")).expect(s.result == "unknown-license" and invariant)
  run licenseRateLimitKeepsKnownBranchesTest = init.then(repository).then(completeBranches).then(licenseSource).then(license("rate")).expect(s.exposed and s.status == 0 and invariant)
  run defaultHeadMayAdvanceAfterBranchListTest = init.then(repository).then(completeBranches).then(advanceHead).then(licenseSource).then(license("valid")).expect(s.branchCommits.get(1) == 1 and s.pinnedCommit == 2 and invariant)
  run renameReuseCannotReplaceNodeBranchesTest = init.then(repository).then(renameAndReuse).then(completeBranches).then(licenseSource).then(license("valid")).expect(s.capturedRepository == 1 and s.branchSources == Set(1) and s.headSource == 1 and s.licenseSource == 2 and invariant)
  run oldNamedReadMixNegativeControlTest = init.then(repository).then(renameAndReuse).then(oldNamedPage).then(row).then(row).then(nextPage("none")).then(oldNamedLicense).expect(s.branchSources == Set(2) and s.exposed and not(invariant))
  run strictHeadLookupReturnsExactShaTest = init.then(begin("head", true)).then(headReply("valid")).expect(s.result == "head" and s.pinnedCommit == 1 and invariant)
  run strictHeadMissingCommitThrowsTest = init.then(begin("head", true)).then(headReply("404")).expect(s.status == 502 and s.result == "error" and invariant)
  run strictHeadRateLimitThrowsTest = init.then(begin("head", true)).then(headReply("rate")).expect(s.status == 503 and invariant)
  run strictHeadTransportCannotGuessTest = init.then(begin("head", true)).then(headReply("transport")).expect(s.pinnedCommit == 0 and s.result == "error" and invariant)
}
