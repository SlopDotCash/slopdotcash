// @source workers/slopbot/value-publication-fence.ts
// @source workers/slopbot/value-publication.ts
// @source workers/slopbot/value-work-unit-publication.ts
// @source workers/slopbot/value-journal.ts
// @source workers/slopbot/value-work-unit-journal.ts
// Two publishers of the same assessment. Registry revision, restriction
// generation and every source mapping are fenced in the INSERT. Existing
// immutable records may be returned on replay, never replaced after a pause.
module bot_publication_transaction {
  var s: { revision: int, generation: int, active: bool, restricted: bool, mappings: Set[int],
    aRevision: int, aGeneration: int, bRevision: int, bGeneration: int,
    aReady: bool, bReady: bool, exists: bool, writes: int, returned: Set[int], validWrite: bool }
  action init = s' = {revision: 1, generation: 0, active: true, restricted: false, mappings: Set(1, 2),
    aRevision: 0, aGeneration: -1, bRevision: 0, bGeneration: -1,
    aReady: false, bReady: false, exists: false, writes: 0, returned: Set(), validWrite: false}
  action captureA = all { s.active, not(s.restricted), s.mappings == Set(1, 2),
    s' = s.with("aRevision", s.revision).with("aGeneration", s.generation).with("aReady", true) }
  action captureB = all { s.active, not(s.restricted), s.mappings == Set(1, 2),
    s' = s.with("bRevision", s.revision).with("bGeneration", s.generation).with("bReady", true) }
  val aFenced = s.active and not(s.restricted) and s.aRevision == s.revision and s.aGeneration == s.generation and s.mappings == Set(1, 2)
  val bFenced = s.active and not(s.restricted) and s.bRevision == s.revision and s.bGeneration == s.generation and s.mappings == Set(1, 2)
  action commitA = all { s.aReady, s.exists or aFenced,
    s' = s.with("exists", true).with("writes", if (s.exists) s.writes else s.writes + 1)
      .with("validWrite", s.validWrite or aFenced).with("returned", s.returned.union(Set(1))) }
  action commitB = all { s.bReady, s.exists or bFenced,
    s' = s.with("exists", true).with("writes", if (s.exists) s.writes else s.writes + 1)
      .with("validWrite", s.validWrite or bFenced).with("returned", s.returned.union(Set(2))) }
  action pause = all { s.revision == 1, s' = s.with("revision", 2).with("active", false) }
  action quarantine = all { s.generation == 0, s' = s.with("generation", 1).with("restricted", true) }
  action removeSecondary = s' = s.with("mappings", Set(1))
  action step = any { captureA, captureB, commitA, commitB, pause, quarantine, removeSecondary, s' = s }
  val invariant = all { s.writes <= 1, s.exists implies s.validWrite and s.writes == 1,
    s.returned.size() > 0 implies s.exists }
  run pauseBeforeInsertWinsTest = init.then(captureA).then(pause).then(commitA.fail())
  run restrictionBeforeInsertWinsTest = init.then(captureA).then(quarantine).then(commitA.fail())
  run removedGroupMemberWinsTest = init.then(captureA).then(removeSecondary).then(commitA.fail())
  run competingPublisherIsReplayTest = init.then(captureA).then(captureB).then(commitA).then(commitB)
    .expect(s.returned == Set(1, 2) and s.writes == 1)
  run lateReplayDoesNotWriteTest = init.then(captureA).then(captureB).then(commitA).then(pause).then(commitB)
    .expect(s.writes == 1 and s.returned == Set(1, 2))
}
