// @source backend/projects/cloudflare-persistence.ts
// @source backend/projects/handler.ts
// @source migrations/0019_project_registry.sql
// @source migrations/0039_project_update_applications.sql
// One existing project's pending update and a new project's application both
// propose alias 3. Project/history/alias/application effects commit together.
// Reads may race; the global repository-key unique index is final authority.
module api_registry_alias_transaction {
  var s: { revisionA: int, revisionB: int, historyA: int, historyB: int,
    keysA: Set[int], keysB: Set[int], applicationA: str, applicationB: str,
    preparedA: bool, preparedB: bool, generation: int, readGeneration: int,readGenerationB:int,
    notifications: int }
  action init = s' = {revisionA: 1, revisionB: 0, historyA: 1, historyB: 0,
    keysA: Set(1), keysB: Set(), applicationA: "pending", applicationB: "pending",
    preparedA: false, preparedB: false, generation: 0, readGeneration: 0,readGenerationB:0, notifications: 0}
  action prepareUpdate = all { s.applicationA == "pending", s.revisionA == 1, not(s.keysB.contains(3)),
    s' = s.with("preparedA", true).with("readGeneration", s.generation) }
  action prepareNew = all { s.applicationB == "pending", s.revisionB == 0, not(s.keysA.contains(3)),
    s' = s.with("preparedB", true).with("readGenerationB",s.generation) }
  action publishUpdate = all { s.preparedA, s.applicationA == "pending", s.revisionA == 1,
    s.readGeneration == s.generation, not(s.keysB.contains(3)),
    s' = s.with("revisionA", 2).with("historyA", 2).with("keysA", Set(1, 3))
      .with("applicationA", "approved").with("notifications", s.notifications + 1) }
  action publishNew = all { s.preparedB, s.applicationB == "pending", s.revisionB == 0, not(s.keysA.contains(3)),s.readGenerationB==s.generation,
    s' = s.with("revisionB", 1).with("historyB", 1).with("keysB", Set(2, 3)).with("applicationB", "approved") }
  action directRevision = all { s.revisionA == 1,
    s' = s.with("revisionA", 2).with("historyA", 2).with("notifications", s.notifications + 1) }
  action enforcementArrives = all { s.generation == 0, s' = s.with("generation", 1) }
  action step = any { prepareUpdate, prepareNew, publishUpdate, publishNew, directRevision, enforcementArrives, s' = s }
  val invariant = all { s.keysA.intersect(s.keysB).size() == 0,
    s.historyA == s.revisionA, s.historyB == s.revisionB,
    s.applicationA == "approved" implies s.revisionA == 2 and s.keysA == Set(1, 3),
    s.applicationB == "approved" implies s.revisionB == 1 and s.keysB == Set(2, 3),
    s.notifications == s.revisionA - 1, s.keysA.contains(1) }
  run revisionWinsAliasRaceTest = init.then(prepareUpdate).then(prepareNew).then(publishUpdate)
    .expect(s.applicationB == "pending" and s.revisionB == 0).then(publishNew.fail())
  run newApplicationWinsAliasRaceTest = init.then(prepareUpdate).then(prepareNew).then(publishNew)
    .expect(s.revisionA == 1 and s.applicationA == "pending").then(publishUpdate.fail())
  run changedBaseLeavesUpdatePendingTest = init.then(prepareUpdate).then(directRevision)
    .expect(s.applicationA == "pending").then(publishUpdate.fail())
  run restrictionInvalidatesPreparedRevisionTest = init.then(prepareUpdate).then(enforcementArrives).then(publishUpdate.fail())
  run approvedApplicationCannotPublishTwiceTest = init.then(prepareNew).then(publishNew).then(publishNew.fail())
  run aliasAppendRetainsOriginalIdentityTest = init.then(prepareUpdate).then(publishUpdate)
    .expect(s.keysA == Set(1, 3) and s.historyA == 2)
  run restrictionInvalidatesNewApplicationTest=init.then(prepareNew).then(enforcementArrives)
    .expect(s.applicationB=="pending" and s.revisionB==0 and s.keysB==Set()).then(publishNew.fail())
}
