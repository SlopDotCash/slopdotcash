// @source migrations/0123_vetting_assessment_repository.sql
// @source backend/vetting/persistence.ts
// @source backend/vetting/handler.ts
// @source backend/projects/handler.ts
// @source backend/projects/setup.ts
// @evidence scripts/vetting-scan-flags.test.ts
// @evidence scripts/vetting-exemptions.test.ts
// @evidence formal/tests/api-migrations.test.ts
// Admission clearance of a project whose repositories each need their own
// clearance (PRD section 8, 12 November 2026). Repository 1 is the original
// repository; repository 2 is appended by an owner revision (`count` moves
// from 1 to 2 and never back). `kind` is fixed at initialization: an
// ordinary project or a member of the frozen migration-0075 set.
//
// Per repository (repositoryClearance): the 0075 exemption covers only the
// original repository; otherwise the repository's own active exemption that
// covers its own assessments, or its own latest clean scan, clears it.
// Combination (manifestClearance): a confirmed malicious finding bans the
// whole project first; otherwise the first repository in manifest order that
// is not cleared decides the state and is named; otherwise the project is
// cleared. One repository returns its own state unchanged.
//
// Restrictions: two contributor flags pause the project (`flagPaused`); a
// confirmed malicious result bans it. A scan is `fresh` for reinstatement
// when it was requested after the latest restriction and the repository's
// live pin has not moved since. A flag-only pause lifts only when every
// listed repository has a fresh clean scan (planFlagReinstatement); a
// moderator reinstatement after a ban needs the same (backend/projects
// handler). Flag resolution (migration 0123 triggers): with one repository a
// clean scan bound to the flag resolves it, exactly as migration 0060 did;
// with more than one, only once every listed repository has a clean scan
// bound to that flag. The resolution triggers read no pin.
//
// Gap kept outside this model: migration 0031 stores one clean scan id per
// moderator reinstatement (the first repository's), so for two repositories
// the "every repository" check of moderatorReinstate holds in application
// code only; the database checks that one scan.
//
// Bounds: two repositories, one flag episode at a time (the bound flag set
// abstracts to one flag), one pending scan per repository.
module vetting_repository_clearance {
  type Repo = { latest: str, exempt: bool, uncovered: bool, pendingFresh: bool,
    pendingBound: bool, freshClean: bool, boundClean: bool }
  type S = { kind: str, count: int, repos: int -> Repo, malicious: bool, restriction: str,
    flag: str, status: str, activatedUncleared: bool, resolvedWithoutEvery: bool,
    reinstatedWithoutEvery: bool }
  pure val ids = Set(1, 2)
  pure val emptyRepo = { latest: "none", exempt: false, uncovered: false, pendingFresh: false,
    pendingBound: false, freshClean: false, boundClean: false }
  var s: S

  pure def listedIn(x: S): Set[int] = if (x.count == 1) Set(1) else Set(1, 2)
  // repositoryClearance for one listed repository, malice aside.
  pure def repoState(x: S, r: int): str = {
    val e = x.repos.get(r)
    if (x.kind == "grandfathered" and r == 1) "cleared"
    else if (e.exempt and not(e.uncovered)) "cleared"
    else if (e.latest == "clean") "cleared"
    else if (e.latest == "pending") "queued"
    else if (e.latest == "none") "unscanned"
    else "unverified"
  }
  // manifestClearance: the combined state and the repository it names (0 for none).
  pure def combinedIn(x: S): { state: str, repository: int } =
    if (x.malicious) { state: "banned", repository: 0 }
    else if (repoState(x, 1) != "cleared")
      { state: repoState(x, 1), repository: if (x.count == 1) 0 else 1 }
    else if (x.count == 2 and repoState(x, 2) != "cleared") { state: repoState(x, 2), repository: 2 }
    else { state: "cleared", repository: 0 }
  val combined = combinedIn(s)
  val everyFresh = listedIn(s).forall(r => s.repos.get(r).freshClean)
  val everyBound = listedIn(s).forall(r => s.repos.get(r).boundClean)

  action initWith(kind: str, count: int): bool =
    s' = { kind: kind, count: count, repos: ids.mapBy(_ => emptyRepo), malicious: false,
      restriction: "clear", flag: "none", status: "paused", activatedUncleared: false,
      resolvedWithoutEvery: false, reinstatedWithoutEvery: false }
  action init = { nondet kind = Set("ordinary", "grandfathered").oneOf()
    nondet count = Set(1, 2).oneOf() initWith(kind, count) }

  def setRepo(x: S, r: int, e: Repo): S = x.with("repos", x.repos.set(r, e))
  // An owner revision appends repository 2: unscanned, and an active project pauses.
  action appendRepository = all { s.count == 1, s.restriction == "clear",
    s' = s.with("count", 2).with("status", "paused") }
  action requestScan(r: int): bool = {
    val e = s.repos.get(r)
    all { listedIn(s).contains(r), e.latest != "pending",
      s' = setRepo(s, r, e.with("latest", "pending").with("uncovered", true)
        .with("pendingFresh", s.restriction != "clear").with("pendingBound", s.flag == "active")) }
  }
  action completeClean(r: int): bool = {
    val e = s.repos.get(r)
    val done = e.with("latest", "clean").with("freshClean", e.pendingFresh)
      .with("boundClean", e.boundClean or e.pendingBound)
    val x = setRepo(s, r, done)
    // Migration 0123: one repository resolves as 0060; more need every listed one.
    val resolves = s.flag == "active" and e.pendingBound and
      (s.count == 1 or listedIn(x).forall(q => x.repos.get(q).boundClean))
    val y = if (resolves) x.with("flag", "resolved")
      .with("resolvedWithoutEvery", s.resolvedWithoutEvery or
        not(listedIn(x).forall(q => x.repos.get(q).boundClean)))
      else x
    val freshAll = listedIn(y).forall(q => y.repos.get(q).freshClean)
    val reinstates = s.restriction == "flagPaused" and freshAll
    all { e.latest == "pending",
      s' = if (reinstates) y.with("restriction", "clear")
          .with("reinstatedWithoutEvery", s.reinstatedWithoutEvery or not(freshAll))
        else y }
  }
  action completeIncomplete(r: int): bool = {
    val e = s.repos.get(r)
    all { e.latest == "pending", s' = setRepo(s, r, e.with("latest", "incomplete")) }
  }
  // Malice bans the project and makes every earlier scan stale for reinstatement.
  action completeMalicious(r: int): bool = all { s.repos.get(r).latest == "pending",
    s' = s.with("repos", ids.mapBy(q => {
        val e = s.repos.get(q)
        val stale = e.with("freshClean", false).with("pendingFresh", false)
        if (q == r) stale.with("latest", "malicious") else stale
      })).with("malicious", true).with("restriction", "banned").with("status", "paused") }
  action grantExemption(r: int): bool = {
    val e = s.repos.get(r)
    all { listedIn(s).contains(r), not(s.malicious), not(e.exempt),
      s' = setRepo(s, r, e.with("exempt", true).with("uncovered", false)) }
  }
  action revokeExemption(r: int): bool = {
    val e = s.repos.get(r)
    all { e.exempt, s' = setRepo(s, r, e.with("exempt", false)) }
  }
  // Two eligible flags pause the project; earlier scans are not fresh for it.
  action flagPause = all { s.restriction == "clear", s.flag != "active",
    s' = s.with("repos", ids.mapBy(q => s.repos.get(q).with("freshClean", false)
        .with("pendingFresh", false).with("boundClean", false).with("pendingBound", false)))
      .with("restriction", "flagPaused").with("flag", "active").with("status", "paused") }
  // The repository's live integration-branch head moves.
  action advancePin(r: int): bool = {
    val e = s.repos.get(r)
    s' = setRepo(s, r, e.with("freshClean", false).with("pendingFresh", false))
  }
  // Refresh retries a reinstatement that a clean result could not write.
  action refreshReinstate = all { s.restriction == "flagPaused", everyFresh,
    s' = s.with("restriction", "clear")
      .with("reinstatedWithoutEvery", s.reinstatedWithoutEvery or not(everyFresh)) }
  action moderatorReinstate = all { s.restriction == "banned", everyFresh,
    s' = s.with("restriction", "clear").with("malicious", false)
      .with("reinstatedWithoutEvery", s.reinstatedWithoutEvery or not(everyFresh)) }
  // Setup activates a paused, unrestricted project only when it is cleared.
  action activate = all { s.status == "paused", s.restriction == "clear",
    combined.state == "cleared",
    s' = s.with("status", "active")
      .with("activatedUncleared", s.activatedUncleared or combined.state != "cleared") }

  action step = any {
    appendRepository,
    { nondet r = ids.oneOf() requestScan(r) },
    { nondet r = ids.oneOf() completeClean(r) },
    { nondet r = ids.oneOf() completeIncomplete(r) },
    { nondet r = ids.oneOf() completeMalicious(r) },
    { nondet r = ids.oneOf() grantExemption(r) },
    { nondet r = ids.oneOf() revokeExemption(r) },
    flagPause,
    { nondet r = ids.oneOf() advancePin(r) },
    refreshReinstate,
    moderatorReinstate,
    activate,
  }

  val invariant = all {
    not(s.activatedUncleared),
    not(s.resolvedWithoutEvery),
    not(s.reinstatedWithoutEvery),
    s.malicious implies (s.restriction == "banned" and combined.state == "banned"),
    s.restriction != "clear" implies s.status == "paused",
    // Cleared means every listed repository is cleared by its own evidence.
    combined.state == "cleared" implies listedIn(s).forall(r => repoState(s, r) == "cleared"),
    // The frozen 0075 exemption never clears an appended repository.
    (s.count == 2 and repoState(s, 2) == "cleared") implies
      (s.repos.get(2).latest == "clean" or (s.repos.get(2).exempt and not(s.repos.get(2).uncovered))),
    // One repository never names a repository; the named one is the first not cleared.
    s.count == 1 implies combined.repository == 0,
    (combined.repository == 2) implies repoState(s, 1) == "cleared",
  }

  run appendedNeedsOwnScanTest = initWith("ordinary", 1).then(requestScan(1)).then(completeClean(1))
    .then(activate).then(appendRepository)
    .expect(s.status == "paused" and combined == { state: "unscanned", repository: 2 })
    .then(requestScan(2)).expect(combined == { state: "queued", repository: 2 })
    .then(completeClean(2)).then(activate).expect(s.status == "active" and combined.state == "cleared")
  run appendedBlocksActivationTest = initWith("ordinary", 1).then(requestScan(1)).then(completeClean(1))
    .then(appendRepository).then(activate.fail())
  run grandfatheredCoversOriginalOnlyTest = initWith("grandfathered", 1)
    .expect(combined.state == "cleared").then(appendRepository)
    .expect(combined == { state: "unscanned", repository: 2 })
    .then(requestScan(2)).then(completeClean(2)).expect(combined.state == "cleared")
  run exemptionOfSecondNeverClearsFirstTest = initWith("ordinary", 2).then(grantExemption(2))
    .expect(combined == { state: "unscanned", repository: 1 })
    .then(grantExemption(1)).expect(combined.state == "cleared")
  run scanOfFirstNeverClearsSecondTest = initWith("ordinary", 2).then(requestScan(1))
    .then(completeClean(1)).expect(combined == { state: "unscanned", repository: 2 })
  run firstNotClearedDecidesTest = initWith("ordinary", 2).then(requestScan(2)).then(requestScan(1))
    .then(completeIncomplete(1)).expect(combined == { state: "unverified", repository: 1 })
  run banComesFirstTest = initWith("ordinary", 2).then(requestScan(1)).then(requestScan(2))
    .then(completeMalicious(2)).expect(combined == { state: "banned", repository: 0 })
  run singleRepositoryFlagMatches0060Test = initWith("ordinary", 1).then(flagPause)
    .then(requestScan(1)).then(completeClean(1))
    .expect(s.flag == "resolved" and s.restriction == "clear")
  run flagNeedsEveryRepositoryTest = initWith("ordinary", 2).then(flagPause)
    .then(requestScan(1)).then(completeClean(1))
    .expect(s.flag == "active" and s.restriction == "flagPaused")
    .then(requestScan(2)).then(completeClean(2))
    .expect(s.flag == "resolved" and s.restriction == "clear")
  run movedPinDefersReinstatementTest = initWith("ordinary", 2).then(flagPause)
    .then(requestScan(1)).then(completeClean(1)).then(advancePin(1))
    .then(requestScan(2)).then(completeClean(2))
    .expect(s.flag == "resolved" and s.restriction == "flagPaused")
    .then(requestScan(1)).then(completeClean(1)).expect(s.restriction == "clear")
  run moderatorNeedsEveryRepositoryTest = initWith("ordinary", 2).then(requestScan(1))
    .then(completeMalicious(1)).then(requestScan(1)).then(completeClean(1))
    .expect(s.restriction == "banned").then(moderatorReinstate.fail())
  run moderatorReinstatesAfterEveryRepositoryTest = initWith("ordinary", 2).then(requestScan(1))
    .then(completeMalicious(1)).then(requestScan(1)).then(completeClean(1))
    .then(requestScan(2)).then(completeClean(2)).then(moderatorReinstate)
    .expect(s.restriction == "clear" and not(s.malicious))
}
