// @source scripts/generate-leaderboard.ts
// @evidence scripts/leaderboard-source-recovery.test.ts
// Two immutable objects and one-object batches abstract the bounded loader.
// The identity predicate represents checked repository/node/SHA/parent/author
// bindings; the model does not prove GitHub identity or the numeric parser.
module commit_line_cache {
  var s: { phase: str, cached: Set[int], before: Set[int], wanted: Set[int],
    missing: Set[int], staged: Set[int], requests: int, returned: bool }
  action init = s' = { phase: "idle", cached: Set(), before: Set(),
    wanted: Set(), missing: Set(), staged: Set(), requests: 0, returned: false }
  action start(wanted: Set[int], identityValid: bool): bool = all {
    s.phase == "idle", wanted.subseteq(Set(0, 1)),
    s' = s.with("phase", if (identityValid) "loading" else "failed")
      .with("before", s.cached).with("wanted", wanted)
      .with("missing", wanted.exclude(s.cached)).with("staged", Set())
      .with("returned", false)
  }
  action fetchOne(id: int, valid: bool): bool = all {
    s.phase == "loading", s.missing.exclude(s.staged).contains(id),
    s.requests < 4,
    s' = if (valid) s.with("staged", s.staged.union(Set(id))).with("requests", s.requests + 1)
      else s.with("phase", "failed").with("staged", Set()).with("requests", s.requests + 1)
  }
  action finish = all {
    s.phase == "loading", s.staged == s.missing,
    s' = s.with("cached", s.cached.union(s.staged)).with("staged", Set())
      .with("phase", "idle").with("returned", true)
  }
  action recover = all { s.phase == "failed", s' = s.with("phase", "idle") }
  action step = if (s.phase == "idle") {
    nondet wanted = Set(Set(0), Set(1), Set(0, 1)).oneOf()
    nondet valid = Set(false, true).oneOf()
    any { start(wanted, valid), s' = s }
  } else if (s.phase == "loading") any {
    fetchOne(0, true), fetchOne(1, true), fetchOne(0, false), fetchOne(1, false), finish, s' = s
  } else any { recover, s' = s }
  val invariant = all {
    s.cached.subseteq(Set(0, 1)), s.staged.subseteq(s.missing),
    s.phase != "idle" implies s.cached == s.before,
    s.phase == "failed" implies s.staged == Set() and not(s.returned),
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
  run invalidIdentityCannotFetchTest = init.then(start(Set(0), false))
    .expect(s.requests == 0 and invariant).then(fetchOne(0, true).fail())
}
