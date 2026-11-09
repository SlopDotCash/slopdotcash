// @source backend/projects/github-lookup.ts
// @source backend/github.ts
// @evidence scripts/project-registry-api.test.ts
// One owned-repository lookup. Page classes 1/20 compress intervening valid
// pages, not HTTP request counts. Each representative page has two row slots;
// row classes represent eligible repositories, forks, bad shapes, private,
// archived and invalid names. Three exact-case path keys include a case variant.
// The first accepted entry for each exact full_name wins; this is not an ID
// deduplication or a new proof of repository ownership. Description classes
// preserve normalization and the empty/overlength-to-null behavior.
// No accumulated list is returned after any later page/link/body failure.
// A full or short page ends only when Link has no next part. A valid next link
// requires the same origin and numeric next page. Other path/query/fragment
// fields are not followed: requests always reconstruct the fixed users route.
// Returned HTTP redirects are failures; redirects already followed by the
// injected fetcher appear as its final response. Body/transport exceptions
// propagate; status0 below means no GithubLookupError status was assigned.
// Actor-ID-to-current-login resolution is the caller's separate preceding read.
// Existing API tests cover filtering, forks and renamed actors, not every
// pagination class below. No parser, tests or model execution were run.
module github_lookup_owned {
  val keyIds = Set(1, 2, 3)
  val entries = 0.to(8)
  var s: { phase: str, page: int, batch: List[int], cursor: int, names: Set[int],
    descriptions: int -> int, result: str, status: int, requests: int, foreignFetch: bool }
  action init = s' = { phase: "input", page: 1, batch: [0, 0], cursor: 0, names: Set(),
    descriptions: keyIds.mapBy(_ => 0), result: "none", status: 0, requests: 0, foreignFetch: false }
  def entryKey(entry: int): int = if (entry == 1 or entry == 2) 1 else if (entry == 3) 2 else 3
  def description(entry: int): int = if (entry == 2 or entry == 8) 2 else if (entry == 4) 0 else 1
  def eligible(entry: int): bool = Set(1, 2, 3, 4, 8).contains(entry)
  action begin(valid: bool): bool = all { s.phase == "input",
    s' = s.with("phase", if (valid) "request" else "done").with("result", if (valid) "none" else "error")
      .with("status", if (valid) 0 else 400) }
  action pageReply(outcome: str, first: int, second: int): bool = all { s.phase == "request", entries.contains(first), entries.contains(second),
    Set("array", "nonarray", "rate", "http", "404", "redirect", "body", "transport").contains(outcome),
    s' = s.with("requests", s.requests + 1).with("phase", if (outcome == "array") "rows" else "done")
      .with("batch", [first, second]).with("cursor", 0).with("result", if (outcome == "array") "none" else "error")
      .with("status", if (outcome == "rate") 503 else if (Set("nonarray", "http", "404", "redirect").contains(outcome)) 502 else 0) }
  action row = {
    val entry = if (s.cursor < 2) s.batch.nth(s.cursor) else 0
    val key = entryKey(entry)
    val add = eligible(entry) and not(s.names.contains(key))
    all { s.phase == "rows", s.cursor < 2,
      s' = s.with("cursor", s.cursor + 1).with("phase", if (s.cursor == 1) "link" else "rows")
        .with("names", if (add) s.names.union(Set(key)) else s.names)
        .with("descriptions", if (add) s.descriptions.set(key, description(entry)) else s.descriptions) }
  }
  action link(kind: str): bool = {
    val valid = Set("next", "next-other-path").contains(kind)
    all { s.phase == "link", Set("none", "next", "next-other-path", "foreign-origin", "wrong-page", "malformed").contains(kind),
      s' = if (kind == "none") s.with("phase", "done").with("result", "list")
        else if (valid and s.page == 1) s.with("phase", "request").with("page", 20)
        else s.with("phase", "done").with("result", "error").with("status", 502) }
  }
  action step = {
    nondet yes = Set(false, true).oneOf()
    nondet first = entries.oneOf()
    nondet second = entries.oneOf()
    nondet outcome = Set("array", "nonarray", "rate", "http", "404", "redirect", "body", "transport").oneOf()
    nondet kind = Set("none", "next", "next-other-path", "foreign-origin", "wrong-page", "malformed").oneOf()
    any { begin(yes), pageReply(outcome, first, second), row, link(kind), s' = s }
  }
  val invariant = all { Set(1, 20).contains(s.page), s.cursor >= 0 and s.cursor <= 2,
    s.names.subseteq(keyIds), not(s.foreignFetch), s.requests >= 0 and s.requests <= 2,
    s.result == "list" implies s.phase == "done" and s.status == 0,
    s.result == "error" implies s.phase == "done" }
  action page(first: int, second: int): bool = pageReply("array", first, second).then(row).then(row)
  run invalidLoginFailsBeforeFetchTest = init.then(begin(false)).expect(s.status == 400 and s.requests == 0 and invariant)
  run eligibleAndForkRepositoriesRemainTest = init.then(begin(true)).then(page(1, 8)).then(link("none"))
    .expect(s.names == Set(1, 3) and s.result == "list" and invariant)
  run privateAndArchivedRowsAreSkippedTest = init.then(begin(true)).then(page(5, 6)).then(link("none"))
    .expect(s.names == Set() and s.result == "list" and invariant)
  run malformedRowsDoNotFillFactsTest = init.then(begin(true)).then(page(0, 7)).then(link("none"))
    .expect(s.names == Set() and invariant)
  run firstExactNameWinsTest = init.then(begin(true)).then(page(1, 2)).then(link("none"))
    .expect(s.descriptions.get(1) == 1 and invariant)
  run exactCaseKeysRemainDistinctTest = init.then(begin(true)).then(page(1, 3)).then(link("none"))
    .expect(s.names == Set(1, 2) and invariant)
  run emptyOrOverlongDescriptionBecomesNullTest = init.then(begin(true)).then(page(4, 0)).then(link("none"))
    .expect(s.names == Set(3) and s.descriptions.get(3) == 0 and invariant)
  run duplicateOnLaterPageDoesNotReplaceFirstTest = init.then(begin(true)).then(page(1, 0)).then(link("next"))
    .then(page(2, 4)).then(link("none")).expect(s.names == Set(1, 3) and s.descriptions.get(1) == 1 and invariant)
  run nextOtherPathIsNotFollowedTest = init.then(begin(true)).then(page(1, 0)).then(link("next-other-path"))
    .then(page(4, 0)).then(link("none")).expect(s.requests == 2 and not(s.foreignFetch) and invariant)
  run wrongOriginRefusesPartialListTest = init.then(begin(true)).then(page(1, 0)).then(link("foreign-origin"))
    .expect(s.names == Set(1) and s.result == "error" and s.status == 502 and invariant)
  run wrongPageRefusesPartialListTest = init.then(begin(true)).then(page(1, 0)).then(link("wrong-page"))
    .expect(s.result == "error" and invariant)
  run malformedNextPartRefusesTest = init.then(begin(true)).then(page(1, 0)).then(link("malformed"))
    .expect(s.status == 502 and invariant)
  run twentiethPageMayFinishTest = init.then(begin(true)).then(page(1, 0)).then(link("next"))
    .then(page(4, 0)).then(link("none")).expect(s.result == "list" and s.page == 20 and invariant)
  run nextAfterTwentiethPageRefusesTest = init.then(begin(true)).then(page(1, 0)).then(link("next"))
    .then(page(4, 0)).then(link("next")).expect(s.result == "error" and s.status == 502 and invariant)
  run laterRateLimitDoesNotReturnEarlierRowsTest = init.then(begin(true)).then(page(1, 0)).then(link("next"))
    .then(pageReply("rate", 0, 0)).expect(s.names == Set(1) and s.result == "error" and s.status == 503 and invariant)
  run laterBodyFailureDoesNotReturnEarlierRowsTest = init.then(begin(true)).then(page(1, 0)).then(link("next"))
    .then(pageReply("body", 0, 0)).expect(s.result == "error" and invariant)
  run ownedRepository404IsAnErrorTest = init.then(begin(true)).then(pageReply("404", 0, 0)).expect(s.status == 502 and invariant)
}
