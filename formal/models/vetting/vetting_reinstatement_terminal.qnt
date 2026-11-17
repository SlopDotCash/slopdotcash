// @source migrations/0131_vetting_reinstatement_latest.sql
// @source backend/vetting/persistence.ts
// @source backend/projects/cloudflare-persistence.ts
// @source backend/projects/enforcement.ts
// @source src/lib/project-contracts.ts
// @evidence scripts/vetting-scan-flags.test.ts
// One flag-only pause and a retained clean assessment A. Existing flag,
// manifest, freshness, non-reuse and live-pin checks are assumed satisfied.
// Three immutable assessment rows and three request times bound this insertion
// race. SQL rowid is the insertion ordinal. A legacy repository resolves from
// its own revision, independently of the project's current first repository.
// The episode freezes after successful insertion; later investigations belong
// to the ordinary clearance transition, outside this transaction model.
module vetting_reinstatement_terminal {
  pure val ids = Set(1, 2, 3)
  var s: {
    rows: int, repository: int -> int, revisionFirstRepository: int -> int,
    pin: int -> int, content: int -> int, requestedAt: int -> int,
    result: int -> str, phase: str, decidingAssessment: int
  }

  action init = s' = {
    rows: 1, repository: ids.mapBy(_ => 1),
    revisionFirstRepository: ids.mapBy(_ => 1), pin: ids.mapBy(_ => 1),
    content: ids.mapBy(_ => 1), requestedAt: ids.mapBy(_ => 1),
    result: ids.mapBy(id => if (id == 1) "clean" else "unused"),
    phase: "idle", decidingAssessment: 0
  }

  def repositoryOf(id: int): int =
    if (s.repository.get(id) == 0) s.revisionFirstRepository.get(id)
    else s.repository.get(id)

  val terminal = ids.filter(id => id <= s.rows and repositoryOf(id) == 1
    and s.pin.get(id) == 1 and s.content.get(id) == 1
    and s.result.get(id) != "pending")
  val latest = terminal.fold(1, (best, id) =>
    if (s.requestedAt.get(id) > s.requestedAt.get(best)
      or (s.requestedAt.get(id) == s.requestedAt.get(best) and id > best)) id
    else best)
  val newestTerminalClean = s.result.get(latest) == "clean"

  // Scope 1 is this repository and pin. Scopes 2-4 change exactly one bound
  // dimension. Scope 5 is a legacy row of this repository; scope 6 resolves
  // to the other repository through that row's immutable revision.
  action queue(scope: int, at: int): bool = {
    val id = s.rows + 1
    all {
      s.phase != "accepted", s.rows < 3,
      Set(1, 2, 3, 4, 5, 6).contains(scope), Set(0, 1, 2).contains(at),
      s' = s.with("rows", id)
        .with("repository", s.repository.set(id,
          if (Set(5, 6).contains(scope)) 0 else if (scope == 2) 2 else 1))
        .with("revisionFirstRepository", s.revisionFirstRepository.set(id,
          if (scope == 6) 2 else 1))
        .with("pin", s.pin.set(id, if (scope == 3) 2 else 1))
        .with("content", s.content.set(id, if (scope == 4) 2 else 1))
        .with("requestedAt", s.requestedAt.set(id, at))
        .with("result", s.result.set(id, "pending"))
    }
  }

  action complete(id: int, disposition: str): bool = all {
    s.phase != "accepted", id <= s.rows, s.result.get(id) == "pending",
    Set("clean", "incomplete").contains(disposition),
    s' = s.with("result", s.result.set(id, disposition))
  }
  action plan = all {
    Set("idle", "refused").contains(s.phase),
    s' = s.with("phase", if (newestTerminalClean) "planned" else "refused")
      .with("decidingAssessment", latest)
  }
  // The predicate is evaluated again at the database insertion, after any
  // completion between the application reads and this statement.
  action insert = all {
    s.phase == "planned",
    s' = s.with("phase", if (newestTerminalClean) "accepted" else "refused")
      .with("decidingAssessment", latest)
  }
  action step = any {
    { nondet scope = Set(1, 2, 3, 4, 5, 6).oneOf()
      nondet at = Set(0, 1, 2).oneOf()
      queue(scope, at) },
    { nondet id = ids.oneOf()
      nondet disposition = Set("clean", "incomplete").oneOf()
      complete(id, disposition) },
    plan, insert, s' = s
  }
  val invariant = all {
    s.rows >= 1, s.rows <= 3, s.result.get(1) == "clean",
    s.phase == "accepted" implies newestTerminalClean,
    s.phase == "accepted" implies s.result.get(s.decidingAssessment) == "clean",
    terminal.contains(1)
  }

  run pendingCompletionRaceRefusedTest = init.then(queue(1, 1)).then(plan)
    .then(complete(2, "incomplete")).then(insert)
    .expect(s.phase == "refused" and s.decidingAssessment == 2)
  run completedInvestigationBeforePlanRefusedTest = init.then(queue(1, 1))
    .then(complete(2, "incomplete")).then(plan)
    .expect(s.phase == "refused" and s.decidingAssessment == 2)
  run latestCleanReinstatesTest = init.then(plan).then(insert)
    .expect(s.phase == "accepted" and s.decidingAssessment == 1)
  run pendingInvestigationExcludedTest = init.then(queue(1, 2)).then(plan).then(insert)
    .expect(s.phase == "accepted" and s.decidingAssessment == 1)
  run laterCleanSupersedesIncompleteTest = init.then(queue(1, 1)).then(plan)
    .then(complete(2, "incomplete")).then(insert).then(queue(1, 2))
    .then(complete(3, "clean")).then(plan).then(insert)
    .expect(s.phase == "accepted" and s.decidingAssessment == 3)
  run differentRepositoryDoesNotBlockTest = init.then(queue(2, 2)).then(plan)
    .then(complete(2, "incomplete")).then(insert).expect(s.phase == "accepted")
  run differentPinDoesNotBlockTest = init.then(queue(3, 2)).then(plan)
    .then(complete(2, "incomplete")).then(insert).expect(s.phase == "accepted")
  run differentContentDoesNotBlockTest = init.then(queue(4, 2)).then(plan)
    .then(complete(2, "incomplete")).then(insert).expect(s.phase == "accepted")
  run legacySameRepositoryBlocksTest = init.then(queue(5, 1)).then(plan)
    .then(complete(2, "incomplete")).then(insert).expect(s.phase == "refused")
  run legacyOwnRevisionSelectsOtherRepositoryTest = init.then(queue(6, 2)).then(plan)
    .then(complete(2, "incomplete")).then(insert).expect(s.phase == "accepted")
  run requestTimePrecedesRowidTest = init.then(queue(1, 0)).then(plan)
    .then(complete(2, "incomplete")).then(insert)
    .expect(s.phase == "accepted" and s.decidingAssessment == 1)
}
