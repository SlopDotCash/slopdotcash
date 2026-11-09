// @source backend/projects/github-lookup.ts
// @source backend/github.ts
// @evidence backend/projects/integration-branch.test.ts
// @evidence scripts/project-registry-api.test.ts
// One repository lookup or strict readBranchHead call. Two branch names,
// repository identities and page classes1/20; three immutable commit classes.
// Page classes compress intervening valid pages, not actual request counts.
// Repository metadata and every branch page must succeed before any repository
// facts return. Malformed branch entries fail the whole lookup. Branch names
// deduplicate in insertion order; a later present SHA replaces that name's
// earlier SHA, while omitted optional commit data leaves the old map entry.
// A next branch link validates origin, named path or captured numeric-ID path,
// credentials, fragment and exactly per_page=100/page+1. Its URL is not followed;
// each request reconstructs the named branch-list path.
// License lookup is weaker availability: every failure becomes unknown license
// with the already complete repository/branch facts. Root LICENSE, usable SPDX,
// base64 bytes and a separately fetched default-branch SHA permit a digest.
// That SHA may be newer than the branch list. A strict head read instead throws
// on every missing/malformed/unavailable result and never guesses a commit.
// Source consistency boundary: metadata publishes immutable repository IDs,
// but later URLs use mutable full_name. A rename plus name reuse may therefore
// mix later branch/license facts with the captured metadata identity. The
// source does not revalidate those response identities; this model records
// that behavior rather than asserting a nonexistent atomic snapshot. Callers'
// subsequent repository-authority checks are outside this module.
// Redirects are the injected fetcher's behavior: a final successful response
// can be used, while an unfollowed redirect is an HTTP failure. Branch escaping,
// byte limits, JSON, commit syntax, license decoding and hashing are predicates,
// not verified implementations here. No checks or provider calls were run.
module github_lookup_repository {
  val repositories = Set(1, 2)
  val branches = Set(1, 2)
  val entries = 0.to(6)
  val fetchResults = Set("valid", "404", "rate", "http", "redirect", "bad-object", "body", "transport")
  var s: { phase: str, mode: str, nameRepository: int, capturedRepository: int,
    heads: int -> int, page: int, batch: List[int], cursor: int, pageSource: int, pageCommit: int,
    listed: Set[int], branchCommits: int -> int, branchSources: Set[int],
    pinnedCommit: int, headSource: int, licenseSource: int, licenseHash: int,
    result: str, status: int, exposed: bool }
  action init = s' = { phase: "input", mode: "repository", nameRepository: 1, capturedRepository: 0,
    heads: Map(1 -> 1, 2 -> 3), page: 1, batch: [0, 0], cursor: 0, pageSource: 0, pageCommit: 0,
    listed: Set(), branchCommits: branches.mapBy(_ => 0), branchSources: Set(),
    pinnedCommit: 0, headSource: 0, licenseSource: 0, licenseHash: 0,
    result: "none", status: 0, exposed: false }
  action renameAndReuse = all { s.nameRepository == 1, s' = s.with("nameRepository", 2) }
  action advanceHead = all { s.heads.get(1) == 1, s' = s.with("heads", s.heads.set(1, 2)) }
  action begin(mode: str, valid: bool): bool = all { s.phase == "input", Set("repository", "head").contains(mode),
    s' = s.with("mode", mode).with("phase", if (not(valid)) "done" else if (mode == "head") "head" else "metadata")
      .with("result", if (valid) "none" else "error").with("status", if (valid) 0 else 400) }
  action metadata(outcome: str, complete: bool): bool = {
    val valid = outcome == "valid" and complete
    all { s.phase == "metadata", fetchResults.contains(outcome),
      s' = s.with("phase", if (valid) "page" else "done").with("result", if (valid) "none" else "error")
        .with("capturedRepository", if (valid) s.nameRepository else 0)
        .with("status", if (valid) 0 else if (outcome == "404") 404 else if (outcome == "rate") 503
          else if (Set("body", "transport").contains(outcome)) 0 else 502) }
  }
  action pageReply(outcome: str, first: int, second: int): bool = all { s.phase == "page", fetchResults.contains(outcome),
    entries.contains(first), entries.contains(second),
    s' = s.with("phase", if (outcome == "valid") "rows" else "done").with("batch", [first, second]).with("cursor", 0)
      .with("pageSource", s.nameRepository).with("pageCommit", s.heads.get(s.nameRepository))
      .with("result", if (outcome == "valid") "none" else "error")
      .with("status", if (outcome == "rate") 503 else if (Set("body", "transport").contains(outcome)) 0
        else if (outcome == "valid") 0 else 502) }
  action row = {
    val entry = if (s.cursor < 2) s.batch.nth(s.cursor) else 0
    val bad = Set(5, 6).contains(entry)
    val name = if (entry == 1 or entry == 3) 1 else 2
    all { s.phase == "rows", s.cursor < 2,
      s' = if (bad) s.with("phase", "done").with("result", "error").with("status", 502)
        else s.with("cursor", s.cursor + 1).with("phase", if (s.cursor == 1) "link" else "rows")
          .with("listed", if (entry == 0) s.listed else s.listed.union(Set(name)))
          .with("branchSources", if (entry == 0) s.branchSources else s.branchSources.union(Set(s.pageSource)))
          .with("branchCommits", if (Set(1, 2).contains(entry)) s.branchCommits.set(name, s.pageCommit) else s.branchCommits) }
  }
  action link(kind: str): bool = {
    val valid = Set("named", "numeric-id").contains(kind)
    all { s.phase == "link", Set("none", "named", "numeric-id", "foreign", "wrong-path", "credentials", "fragment", "parameters", "malformed").contains(kind),
      s' = if (kind == "none" and s.listed.contains(1)) s.with("phase", "head")
        else if (valid and s.page == 1) s.with("phase", "page").with("page", 20)
        else s.with("phase", "done").with("result", "error").with("status", 502) }
  }
  action headReply(outcome: str): bool = {
    val valid = outcome == "valid"
    val fallback = not(valid) and s.mode == "repository"
    all { s.phase == "head", fetchResults.contains(outcome),
      s' = s.with("phase", if (valid and s.mode == "repository") "license" else "done")
        .with("pinnedCommit", if (valid) s.heads.get(s.nameRepository) else 0)
        .with("headSource", if (valid) s.nameRepository else 0)
        .with("result", if (valid) (if (s.mode == "head") "head" else "none") else if (fallback) "unknown-license" else "error")
        .with("exposed", fallback)
        .with("status", if (valid or fallback) 0 else if (outcome == "rate") 503
          else if (Set("body", "transport").contains(outcome)) 0 else 502) }
  }
  action license(outcome: str): bool = all { s.phase == "license",
    Set("valid", "404", "wrong-path", "unknown-spdx", "no-bytes", "invalid-base64", "rate", "http", "body", "transport").contains(outcome),
    s' = s.with("phase", "done").with("result", if (outcome == "valid") "verified-license" else "unknown-license")
      .with("licenseSource", if (outcome == "valid") s.nameRepository else 0).with("licenseHash", if (outcome == "valid") s.pinnedCommit else 0)
      .with("exposed", true).with("status", 0) }
  action step = {
    nondet mode = Set("repository", "head").oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet outcome = fetchResults.oneOf()
    nondet first = entries.oneOf()
    nondet second = entries.oneOf()
    nondet next = Set("none", "named", "numeric-id", "foreign", "wrong-path", "credentials", "fragment", "parameters", "malformed").oneOf()
    nondet licensed = Set("valid", "404", "wrong-path", "unknown-spdx", "no-bytes", "invalid-base64", "rate", "http", "body", "transport").oneOf()
    any { renameAndReuse, advanceHead, begin(mode, yes), metadata(outcome, yes), pageReply(outcome, first, second), row,
      link(next), headReply(outcome), license(licensed), s' = s }
  }
  val consistentNamedReads = s.branchSources.subseteq(Set(s.capturedRepository))
    and (s.result != "verified-license" or (s.headSource == s.capturedRepository and s.licenseSource == s.capturedRepository))
  val invariant = all { repositories.contains(s.nameRepository), Set(1, 20).contains(s.page), s.listed.subseteq(branches),
    s.exposed implies s.mode == "repository" and s.capturedRepository > 0 and s.listed.contains(1),
    s.result == "error" implies not(s.exposed),
    s.result == "head" implies s.mode == "head" and s.pinnedCommit > 0,
    s.result == "verified-license" implies s.exposed and s.licenseHash == s.pinnedCommit and s.pinnedCommit > 0,
    s.result == "unknown-license" implies s.exposed and s.licenseHash == 0 }
  action repository = begin("repository", true).then(metadata("valid", true))
  action page(first: int, second: int): bool = pageReply("valid", first, second).then(row).then(row)
  action completeBranches = page(1, 2).then(link("none"))
  run completeRepositoryLicenseUsesPinnedCommitTest = init.then(repository).then(completeBranches).then(headReply("valid")).then(license("valid"))
    .expect(s.exposed and s.licenseHash == 1 and consistentNamedReads and invariant)
  run invalidRepositorySyntaxMakesNoReadTest = init.then(begin("repository", false)).expect(s.status == 400 and s.capturedRepository == 0 and invariant)
  run absentRepositoryIs404Test = init.then(begin("repository", true)).then(metadata("404", true)).expect(s.status == 404 and invariant)
  run incompleteMetadataDoesNotExposeFactsTest = init.then(begin("repository", true)).then(metadata("valid", false)).expect(s.status == 502 and invariant)
  run invalidBranchNameRefusesWholeLookupTest = init.then(repository).then(pageReply("valid", 1, 5)).then(row).then(row)
    .expect(s.result == "error" and not(s.exposed) and invariant)
  run invalidBranchCommitRefusesWholeLookupTest = init.then(repository).then(pageReply("valid", 6, 0)).then(row)
    .expect(s.status == 502 and invariant)
  run laterPageFailureDoesNotExposeEarlierBranchesTest = init.then(repository).then(page(1, 0)).then(link("named")).then(pageReply("rate", 0, 0))
    .expect(s.listed == Set(1) and not(s.exposed) and s.status == 503 and invariant)
  run numericIdBranchLinkStillUsesNamedReadTest = init.then(repository).then(page(2, 0)).then(link("numeric-id")).then(page(1, 0))
    .then(link("none")).then(headReply("404")).expect(s.result == "unknown-license" and invariant)
  run wrongPathBranchLinkRefusesTest = init.then(repository).then(page(1, 0)).then(link("wrong-path")).expect(s.status == 502 and invariant)
  run credentialBearingBranchLinkRefusesTest = init.then(repository).then(page(1, 0)).then(link("credentials")).expect(s.result == "error" and invariant)
  run extraBranchLinkParameterRefusesTest = init.then(repository).then(page(1, 0)).then(link("parameters")).expect(s.result == "error" and invariant)
  run absentDefaultBranchRefusesBeforeLicenseTest = init.then(repository).then(page(2, 0)).then(link("none")).expect(s.result == "error" and invariant)
  run optionalMissingCommitDoesNotEraseEarlierShaTest = init.then(repository).then(page(1, 0)).then(link("named")).then(page(3, 2))
    .then(link("none")).then(headReply("404")).expect(s.branchCommits.get(1) == 1 and invariant)
  run laterPresentCommitWinsDuplicateNameTest = init.then(repository).then(page(1, 0)).then(link("named")).then(advanceHead).then(page(1, 2))
    .then(link("none")).then(headReply("404")).expect(s.branchCommits.get(1) == 2 and invariant)
  run twentiethPageWithNextRefusesPartialBranchesTest = init.then(repository).then(page(1, 0)).then(link("named")).then(page(2, 0)).then(link("named"))
    .expect(s.page == 20 and s.result == "error" and invariant)
  run missingLicenseKeepsRepositoryFactsTest = init.then(repository).then(completeBranches).then(headReply("valid")).then(license("404"))
    .expect(s.exposed and s.result == "unknown-license" and invariant)
  run invalidLicenseBytesDoNotBecomeVerifiedTest = init.then(repository).then(completeBranches).then(headReply("valid")).then(license("invalid-base64"))
    .expect(s.licenseHash == 0 and invariant)
  run wrongLicensePathRemainsUnknownTest = init.then(repository).then(completeBranches).then(headReply("valid")).then(license("wrong-path"))
    .expect(s.result == "unknown-license" and invariant)
  run licenseRateLimitKeepsKnownBranchesTest = init.then(repository).then(completeBranches).then(headReply("valid")).then(license("rate"))
    .expect(s.exposed and s.status == 0 and invariant)
  run defaultHeadMayAdvanceAfterBranchListTest = init.then(repository).then(completeBranches).then(advanceHead).then(headReply("valid")).then(license("valid"))
    .expect(s.branchCommits.get(1) == 1 and s.pinnedCommit == 2 and invariant)
  run renameReuseCanMixNamedBranchFactsTest = init.then(repository).then(renameAndReuse).then(completeBranches).then(headReply("valid")).then(license("valid"))
    .expect(s.capturedRepository == 1 and s.branchSources == Set(2) and not(consistentNamedReads) and s.exposed and invariant)
  run strictHeadLookupReturnsExactShaTest = init.then(begin("head", true)).then(headReply("valid")).expect(s.result == "head" and s.pinnedCommit == 1 and invariant)
  run strictHeadMissingCommitThrowsTest = init.then(begin("head", true)).then(headReply("404")).expect(s.status == 502 and s.result == "error" and invariant)
  run strictHeadRateLimitThrowsTest = init.then(begin("head", true)).then(headReply("rate")).expect(s.status == 503 and invariant)
  run strictHeadTransportCannotGuessTest = init.then(begin("head", true)).then(headReply("transport")).expect(s.pinnedCommit == 0 and s.result == "error" and invariant)
}
