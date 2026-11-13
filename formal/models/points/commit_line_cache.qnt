// @source scripts/generate-leaderboard.ts
// @evidence scripts/leaderboard-source-recovery.test.ts
// Two immutable objects and one-object batches abstract the bounded loader.
// The identity predicate represents checked repository/node/SHA/parent and
// non-conflicting linked actors. Authors models whether a verified account
// link is known; null links never erase it. Actual IDs and parsing are abstract.
module commit_line_cache {
  var s: { phase: str, cached: Set[int], before: Set[int], wanted: Set[int],
    missing: Set[int], staged: Set[int], requests: int, returned: bool,
    authors: Set[int], beforeAuthors: Set[int], pendingAuthors: Set[int] }
  action init = s' = { phase: "idle", cached: Set(), before: Set(),
    wanted: Set(), missing: Set(), staged: Set(), requests: 0, returned: false,
    authors: Set(), beforeAuthors: Set(), pendingAuthors: Set() }
  action start(wanted: Set[int], identityValid: bool): bool = all {
    s.phase == "idle", wanted.subseteq(Set(0, 1)),
    s' = s.with("phase", if (identityValid) "loading" else "failed")
      .with("before", s.cached).with("wanted", wanted)
      .with("missing", wanted.exclude(s.cached)).with("staged", Set())
      .with("returned", false).with("beforeAuthors", s.authors).with("pendingAuthors", Set())
  }
  action fetchOne(id: int, valid: bool): bool = all {
    s.phase == "loading", s.missing.exclude(s.staged).contains(id),
    s.requests < 4,
    s' = if (valid) s.with("staged", s.staged.union(Set(id))).with("requests", s.requests + 1)
      else s.with("phase", "failed").with("staged", Set()).with("pendingAuthors", Set()).with("requests", s.requests + 1)
  }
  action stageAuthor(id: int): bool = all {
    s.phase == "loading", s.wanted.contains(id),
    s' = s.with("pendingAuthors", s.pendingAuthors.union(Set(id)))
  }
  action finish = all {
    s.phase == "loading", s.staged == s.missing,
    s' = s.with("cached", s.cached.union(s.staged)).with("staged", Set())
      .with("phase", "idle").with("returned", true)
      .with("authors", s.authors.union(s.pendingAuthors)).with("pendingAuthors", Set())
  }
  action recover = all { s.phase == "failed", s' = s.with("phase", "idle") }
  action step = if (s.phase == "idle") {
    nondet wanted = Set(Set(0), Set(1), Set(0, 1)).oneOf()
    nondet valid = Set(false, true).oneOf()
    any { start(wanted, valid), s' = s }
  } else if (s.phase == "loading") any {
    fetchOne(0, true), fetchOne(1, true), fetchOne(0, false), fetchOne(1, false),
    stageAuthor(0), stageAuthor(1), finish, s' = s
  } else any { recover, s' = s }
  val invariant = all {
    s.cached.subseteq(Set(0, 1)), s.staged.subseteq(s.missing),
    s.authors.subseteq(s.cached), s.pendingAuthors.subseteq(s.wanted),
    s.phase != "idle" implies s.authors == s.beforeAuthors,
    s.phase != "idle" implies s.cached == s.before,
    s.phase == "failed" implies s.staged == Set() and s.pendingAuthors == Set() and not(s.returned),
    s.returned implies s.wanted.subseteq(s.cached),
    s.requests >= 0, s.requests <= 4
  }
  run completeLoadAndReuseTest = init.then(start(Set(0, 1), true))
    .then(fetchOne(0, true)).then(fetchOne(1, true)).then(finish)
    .then(start(Set(1), true)).then(finish)
    .expect(s.cached == Set(0, 1) and s.requests == 2 and invariant)
  run partialLoadNotPublishedTest = init.then(start(Set(0, 1), true)).then(fetchOne(0, true))
    .expect(s.cached == Set() and invariant).then(finish.fail())
  run laterFailureDiscardsStagedTest = init.then(start(Set(0, 1), true))
    .then(fetchOne(0, true)).then(fetchOne(1, false))
    .expect(s.cached == Set() and s.staged == Set() and invariant)
  run oldCacheSurvivesFailureTest = init.then(start(Set(0), true)).then(fetchOne(0, true)).then(finish)
    .then(start(Set(0, 1), true)).then(fetchOne(1, false))
    .expect(s.cached == Set(0) and invariant)
  run lateAuthorLinkRepairsPriorOccurrenceTest = init.then(start(Set(0), true))
    .then(fetchOne(0, true)).then(finish).then(start(Set(0), true))
    .then(stageAuthor(0)).then(finish)
    .expect(s.authors == Set(0) and s.requests == 1 and invariant)
  run failedLoadCannotPublishAuthorTest = init.then(start(Set(0), true))
    .then(fetchOne(0, true)).then(finish).then(start(Set(0, 1), true))
    .then(stageAuthor(0)).then(fetchOne(1, false))
    .expect(s.authors == Set() and invariant)
  run invalidIdentityCannotFetchTest = init.then(start(Set(0), false))
    .expect(s.requests == 0 and invariant).then(fetchOne(0, true).fail())
}
