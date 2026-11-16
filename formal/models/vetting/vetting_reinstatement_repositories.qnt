// @source migrations/0131_vetting_reinstatement_latest.sql
// @source backend/vetting/persistence.ts
// @source backend/projects/enforcement.ts
// @source src/lib/project-contracts.ts
// @evidence scripts/vetting-scan-flags.test.ts
// A retained clean issuer A and, for two listed repositories, a retained clean
// B at repository two's own live pin. Flag coverage, manifest identity, retained
// evidence, freshness and non-reuse are fixed satisfied preconditions. IDs are
// immutable SQL insertion ordinals. Repository identity is the normalized result
// of each row's own revision; the terminal model checks that normalization.
// Four rows, two listed repositories and three request times bound this race.
// The episode freezes after successful insertion. A later investigation after
// that transaction belongs to the ordinary clearance transition.
module vetting_reinstatement_repositories {
  pure val ids = Set(1, 2, 3, 4)
  var s: {
    rows: int, required: Set[int], repository: int -> int, pin: int -> int,
    content: int -> int, requestedAt: int -> int, result: int -> str,
    phase: str, planned: Set[int], hasProvenance: bool
  }

  action initWithRepositories(count: int): bool = all {
    Set(1, 2).contains(count),
    s' = {
      rows: count, required: if (count == 2) Set(1, 2) else Set(1),
      repository: ids.mapBy(id => if (id == 2) 2 else 1),
      pin: ids.mapBy(id => if (id == 2) 2 else 1),
      content: ids.mapBy(_ => 1), requestedAt: ids.mapBy(_ => 1),
      result: ids.mapBy(id => if (id <= count) "clean" else "unused"),
      phase: "idle", planned: Set(), hasProvenance: false
    }
  }
  action init = initWithRepositories(2)

  def terminalFor(assessment: int): Set[int] = ids.filter(id =>
    id <= s.rows and s.repository.get(id) == s.repository.get(assessment)
      and s.pin.get(id) == s.pin.get(assessment)
      and s.content.get(id) == s.content.get(assessment)
      and s.result.get(id) != "pending")
  def latestFor(assessment: int): int = terminalFor(assessment).fold(
    assessment, (best, id) =>
      if (s.requestedAt.get(id) > s.requestedAt.get(best)
        or (s.requestedAt.get(id) == s.requestedAt.get(best) and id > best)) id
      else best)
  val checkedIds = if (s.hasProvenance) s.planned else Set(1)
  val coversListedRepositories = s.required.forall(repository =>
    checkedIds.exists(id => s.repository.get(id) == repository))
  val allLatestTerminalClean = checkedIds.forall(id =>
    s.result.get(id) == "clean" and s.result.get(latestFor(id)) == "clean")
  val insertionAllowed = coversListedRepositories and allLatestTerminalClean

  // Queue either an investigation of repository two at its own pin or one at
  // repository one's pin. Only the former can supersede repository two's B.
  action queueSecond(at: int, ownPin: bool): bool = {
    val id = s.rows + 1
    all {
      s.phase != "accepted", s.rows < 4, s.required == Set(1, 2),
      Set(0, 1, 2).contains(at),
      s' = s.with("rows", id)
        .with("repository", s.repository.set(id, 2))
        .with("pin", s.pin.set(id, if (ownPin) 2 else 1))
        .with("content", s.content.set(id, 1))
        .with("requestedAt", s.requestedAt.set(id, at))
        .with("result", s.result.set(id, "pending"))
    }
  }
  action complete(id: int, disposition: str): bool = all {
    s.phase != "accepted", id <= s.rows, s.result.get(id) == "pending",
    Set("clean", "incomplete").contains(disposition),
    s' = s.with("result", s.result.set(id, disposition))
  }
  // The issuer's retained eligibility is assumed. Every required repository
  // selects its newest completed same-pin assessment when the plan is built.
  action plan = {
    val second = latestFor(2)
    val ready = s.required.forall(repository =>
      s.result.get(latestFor(repository)) == "clean")
    all {
      Set("idle", "refused").contains(s.phase),
      s' = s.with("phase", if (ready) "planned" else "refused")
        .with("planned", if (s.required.contains(2)) Set(1, second) else Set(1))
        .with("hasProvenance", true)
    }
  }
  // Older single-repository issuers had no list. A partial list represents a
  // record that names its issuer but omits repository two's planned evidence.
  action omitProvenance = all {
    s.phase == "planned", s' = s.with("planned", Set()).with("hasProvenance", false)
  }
  action omitSecondAssessment = all {
    s.phase == "planned", s' = s.with("planned", Set(1)).with("hasProvenance", true)
  }
  action insert = all {
    s.phase == "planned",
    s' = s.with("phase", if (insertionAllowed) "accepted" else "refused")
  }
  action step = any {
    { nondet at = Set(0, 1, 2).oneOf()
      nondet ownPin = Set(false, true).oneOf()
      queueSecond(at, ownPin) },
    { nondet id = ids.oneOf()
      nondet disposition = Set("clean", "incomplete").oneOf()
      complete(id, disposition) },
    plan, omitProvenance, omitSecondAssessment, insert, s' = s
  }
  val invariant = all {
    s.rows >= 1, s.rows <= 4, s.result.get(1) == "clean",
    s.phase == "accepted" implies insertionAllowed,
    s.phase == "accepted" implies coversListedRepositories,
    s.phase == "accepted" implies allLatestTerminalClean
  }

  run otherRepositoryCompletionRaceRefusedTest = init.then(queueSecond(1, true))
    .then(plan).then(complete(3, "incomplete")).then(insert)
    .expect(s.phase == "refused" and s.planned == Set(1, 2))
  run otherRepositorySequentialIncompleteRefusesPlanTest = init
    .then(queueSecond(1, true)).then(complete(3, "incomplete")).then(plan)
    .expect(s.phase == "refused")
  run laterCleanOfOtherRepositoryRecoversTest = init.then(queueSecond(1, true))
    .then(plan).then(complete(3, "incomplete")).then(insert)
    .then(queueSecond(2, true)).then(complete(4, "clean")).then(plan).then(insert)
    .expect(s.phase == "accepted" and s.planned == Set(1, 4))
  run otherRepositoryPendingRemainsExcludedTest = init.then(queueSecond(2, true))
    .then(plan).then(insert).expect(s.phase == "accepted" and s.planned == Set(1, 2))
  run otherRepositoryAtDifferentPinDoesNotBlockTest = init.then(queueSecond(2, false))
    .then(plan).then(complete(3, "incomplete")).then(insert)
    .expect(s.phase == "accepted")
  run bothCleanRepositoriesReinstateTest = init.then(plan).then(insert)
    .expect(s.phase == "accepted" and s.planned == Set(1, 2))
  run missingProvenanceRefusesTwoRepositoriesTest = init.then(plan)
    .then(omitProvenance).then(insert).expect(s.phase == "refused")
  run incompleteProvenanceRefusesTwoRepositoriesTest = init.then(plan)
    .then(omitSecondAssessment).then(insert).expect(s.phase == "refused")
  run legacyIssuerFallbackReinstatesOneRepositoryTest = initWithRepositories(1)
    .then(plan).then(omitProvenance).then(insert).expect(s.phase == "accepted")
  run requestTimePrecedesOtherRepositoryRowidTest = init.then(queueSecond(0, true))
    .then(plan).then(complete(3, "incomplete")).then(insert)
    .expect(s.phase == "accepted" and s.planned == Set(1, 2))
}
