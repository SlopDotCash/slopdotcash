// @source backend/vetting/flagger-standing.ts
// @source backend/projects/github-lookup.ts
// @evidence backend/vetting/flagger-standing.test.ts
// One immutable actor, two distinct repository identities, up to three input
// entries and the actual ten-page cap per repository. Repeated names deduplicate
// exactly (case folding is not invented). Page lengths are full/short classes;
// record grammar and bounded JSON/HTTP outcomes are supplied observations.
// Current GitHub account ID/type/login/created date validate before registry
// discovery. A positive answer needs that actor's parseable merged timestamp;
// it does not prove provider honesty, account age or non-maintainer eligibility.
// The flag handler separately checks age/membership/authority and write fences.
// Early success stops the scan. A 404 skips a repository; incomplete reads and
// an exhausted full tenth page throw instead of returning a negative answer.
// No cache, writes, flags or pause occurs in this reader. Unexecuted scenarios.
module vetting_flagger_standing {
  val repositories = Set(1, 2)
  val replies = Set("full", "short", "merge", "wrong-author", "invalid-date",
    "404", "http-error", "body-error", "entry-error")
  type State = { phase: str, accountValid: bool, registryValid: bool,
    accountCaptured: bool, order: List[int], offset: int, seen: Set[int],
    repository: int, page: int, calls: List[int], witness: bool,
    invalidDateSeen: bool, result: str, error: str }
  var s: State
  action init = s' = { phase: "input", accountValid: true, registryValid: true,
    accountCaptured: false, order: List(1, 2), offset: 0, seen: Set(),
    repository: 0, page: 1, calls: List(), witness: false,
    invalidDateSeen: false, result: "none", error: "none" }
  action configure(accountValid: bool, registryValid: bool, order: List[int]): bool = all {
    s.phase == "input", order.length() <= 3,
    order.indices().forall(i => Set(0, 1, 2).contains(order.nth(i))),
    s' = s.with("accountValid", accountValid).with("registryValid", registryValid).with("order", order) }
  def refusal(reason: str): State = s.with("phase", "done").with("result", "error").with("error", reason)
  action begin = all { s.phase == "input", s' = s.with("phase", "account") }
  action account = all { s.phase == "account", s' =
    if (s.accountValid) s.with("accountCaptured", true).with("phase", "registry")
    else refusal("account") }
  action registry = all { s.phase == "registry", s' =
    if (s.registryValid) s.with("phase", "repository") else refusal("registry") }
  action nextRepository = {
    val entry = if (s.offset < s.order.length()) s.order.nth(s.offset) else 0
    all { s.phase == "repository", s' =
      if (s.offset == s.order.length()) s.with("phase", "done").with("result", "false")
      else if (s.seen.contains(entry)) s.with("offset", s.offset + 1)
      else if (not(repositories.contains(entry))) refusal("repository-name")
      else s.with("offset", s.offset + 1).with("seen", s.seen.union(Set(entry)))
        .with("repository", entry).with("page", 1).with("phase", "request") }
  }
  action fetchPage = all { s.phase == "request", s' = s.with("phase", "response")
    .with("calls", s.calls.append(s.repository * 11 + s.page)) }
  action respond(kind: str): bool = all { s.phase == "response", replies.contains(kind), s' =
    if (Set("http-error", "body-error", "entry-error").contains(kind)) refusal(kind)
    else if (kind == "merge") s.with("witness", true).with("phase", "done").with("result", "true")
    else if (kind == "404" or kind == "short" or kind == "wrong-author") s.with("phase", "repository")
    else if (kind == "invalid-date") s.with("phase", "repository").with("invalidDateSeen", true)
    else if (s.page == 10) refusal("page-limit")
    else s.with("page", s.page + 1).with("phase", "request") }
  action step = {
    nondet good = Set(false, true).oneOf() nondet available = Set(false, true).oneOf()
    nondet order = Set(List(), List(1), List(1, 2), List(2, 1), List(1, 1, 2), List(1, 0, 2)).oneOf()
    nondet reply = replies.oneOf()
    any { configure(good, available, order), begin, account, registry, nextRepository, fetchPage, respond(reply), s' = s }
  }
  val invariant = all { s.page >= 1 and s.page <= 10, s.offset <= s.order.length(),
    s.calls.length() <= 20, s.seen.subseteq(repositories),
    s.result == "true" implies s.accountCaptured and s.witness,
    s.result == "false" implies s.accountCaptured and s.registryValid and not(s.witness),
    not(s.accountCaptured) implies s.calls == List(),
    s.result != "error" implies s.error == "none" }
  action toRepository = begin.then(account).then(registry)
  action page(kind: str) = fetchPage.then(respond(kind))
  action full = page("full")
  run firstWitnessStopsBeforeLaterRepositoryTest = init.then(toRepository).then(nextRepository).then(page("merge"))
    .expect(s.result == "true" and s.calls == List(12) and invariant)
  run invalidAccountStopsBeforeRegistryTest = init.then(configure(false, true, List(1))).then(begin).then(account)
    .expect(s.result == "error" and s.calls == List() and invariant)
  run registryFailureReturnsNoPartialAnswerTest = init.then(configure(true, false, List(1))).then(toRepository)
    .expect(s.result == "error" and s.accountCaptured and s.calls == List() and invariant)
  run emptyRegistryReturnsKnownNegativeTest = init.then(configure(true, true, List())).then(toRepository).then(nextRepository)
    .expect(s.result == "false" and s.calls == List() and invariant)
  run exactDuplicateRepositoryIsNotFetchedAgainTest = init.then(configure(true, true, List(1, 1, 2))).then(toRepository)
    .then(nextRepository).then(page("short")).then(nextRepository).then(nextRepository).then(page("merge"))
    .expect(s.result == "true" and s.calls == List(12, 23) and invariant)
  run repositoryOrderIsPreservedTest = init.then(configure(true, true, List(2, 1))).then(toRepository)
    .then(nextRepository).then(page("merge")).expect(s.calls == List(23) and invariant)
  run missingRepositoryIsSkippedTest = init.then(toRepository).then(nextRepository).then(page("404"))
    .then(nextRepository).then(page("merge")).expect(s.result == "true" and invariant)
  run invalidNameAfterEarlierScanRefusesWholeAnswerTest = init.then(configure(true, true, List(1, 0, 2))).then(toRepository)
    .then(nextRepository).then(page("short")).then(nextRepository).expect(s.result == "error" and s.error == "repository-name" and invariant)
  run invalidNameAfterWitnessIsNotReadTest = init.then(configure(true, true, List(1, 0, 2))).then(toRepository)
    .then(nextRepository).then(page("merge")).expect(s.result == "true" and invariant)
  run wrongAuthorIsNotAcceptedWorkTest = init.then(configure(true, true, List(1))).then(toRepository)
    .then(nextRepository).then(page("wrong-author")).then(nextRepository).expect(s.result == "false" and invariant)
  run malformedMergedTimestampDoesNotGrantStandingTest = init.then(configure(true, true, List(1))).then(toRepository)
    .then(nextRepository).then(page("invalid-date")).then(nextRepository).expect(s.result == "false" and s.invalidDateSeen and invariant)
  run validWitnessAfterInvalidTimestampStillQualifiesTest = init.then(toRepository).then(nextRepository).then(page("invalid-date"))
    .then(nextRepository).then(page("merge")).expect(s.result == "true" and s.invalidDateSeen and invariant)
  run shortPagesFinishEveryRepositoryTest = init.then(toRepository).then(nextRepository).then(page("short"))
    .then(nextRepository).then(page("short")).then(nextRepository).expect(s.result == "false" and s.calls == List(12, 23) and invariant)
  run fullPageContinuesWithinSameRepositoryTest = init.then(toRepository).then(nextRepository).then(full).then(page("merge"))
    .expect(s.result == "true" and s.calls == List(12, 13) and invariant)
  run tenthFullPageRefusesInsteadOfNegativeTest = init.then(toRepository).then(nextRepository)
    .then(full).then(full).then(full).then(full).then(full).then(full).then(full).then(full).then(full).then(full)
    .expect(s.result == "error" and s.error == "page-limit" and s.calls.length() == 10 and invariant)
  run tenthPageWitnessQualifiesTest = init.then(toRepository).then(nextRepository)
    .then(full).then(full).then(full).then(full).then(full).then(full).then(full).then(full).then(full).then(page("merge"))
    .expect(s.result == "true" and s.calls.length() == 10 and invariant)
  run httpFailureDoesNotBecomeNegativeTest = init.then(toRepository).then(nextRepository).then(page("http-error"))
    .expect(s.result == "error" and invariant)
  run unreadableBodyDoesNotBecomeNegativeTest = init.then(toRepository).then(nextRepository).then(page("body-error"))
    .expect(s.result == "error" and invariant)
  run malformedEntryDoesNotReturnPartialStandingTest = init.then(toRepository).then(nextRepository).then(page("entry-error"))
    .expect(s.result == "error" and not(s.witness) and invariant)
  run inFlightPageMakesNoStandingClaimTest = init.then(toRepository).then(nextRepository).then(fetchPage)
    .expect(s.result == "none" and s.phase == "response" and invariant)
}
