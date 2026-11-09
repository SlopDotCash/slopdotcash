// @source backend/vetting/evidence-storage.ts
// @source backend/vetting/evidence-chunks.ts
// @source migrations/0119_vetting_storage_generations.sql
// @evidence scripts/vetting-api.test.ts
// Two helper invocations, two generations of one whole-object digest, two full
// descriptor tuples per generation, and four immutable physical targets. A
// descriptor includes part_index, sha256 and size_bytes, so conflicting chunk
// declarations never share a head. Digests/lengths and valid input identities
// are predicates; callers verify incoming digests before storePart. Identifier
// collisions are included and must reconcile the complete immutable tuple.
// Registration's atomic generation/object binding is modeled separately.
//
// The initial active read, pointer read, verifiedPart, reservation statement,
// mandatory reservation readback, R2 write, publication statement and final
// observations are distinct boundaries. Unknown R2 replies may leave a remote
// create-only PUT pending even after its caller has returned an error. No target
// is overwritten by this helper. A failed/losing publication can still succeed
// by reading and verifying the current winner in the same descriptor tuple.
// Both the existing-copy shortcut and publication path require a final active
// generation observation. This is not an atomic response-delivery guarantee.
// readPart itself has no active-generation requirement; the API owns authority
// and retention. It may read a still-present retiring generation's bytes.
//
// Worker retirement is an environment contract: freeze a generation, replace
// every reserved target (including unpublished targets) with a persistent
// non-evidence marker, then record retirement. Marker integrity, backup before
// replacement, reference policy and legacy null-generation storage belong to
// other models. Marker bytes never become evidence, even for empty originals.
// Crypto correctness, provider liveness, arbitrary-size multipart composition,
// and execution conformance are not proved. Regression definitions are partial
// evidence; no tests, parser, checker, or runtime were executed for this model.
module vetting_generation_storage {
  val callers = Set(1, 2)
  val generations = Set(1, 2)
  val targets = Set(1, 2, 3, 4)
  val descriptors = Set(1, 2)
  type Target = { generation: int, descriptor: int }
  type Request = { phase: str, mode: str, generation: int, descriptor: int,
    candidate: int, expected: int, selected: int, reserved: bool,
    published: bool, verified: bool, activeAccepted: bool, dbFailure: bool,
    putPending: bool, putSettled: bool, result: str }
  val noTarget: Target = { generation: 0, descriptor: 0 }
  val idle: Request = { phase: "idle", mode: "store", generation: 1, descriptor: 1,
    candidate: 0, expected: 0, selected: 0, reserved: false, published: false,
    verified: false, activeAccepted: false, dbFailure: false,
    putPending: false, putSettled: false, result: "none" }
  var s: { generations: int -> str, targets: int -> Target,
    heads: int -> int, bodies: int -> str, retiredTargets: Set[int],
    requests: int -> Request, safePublication: bool, createOnly: bool }
  action init = s' = { generations: Map(1 -> "active", 2 -> "absent"),
    targets: targets.mapBy(_ => noTarget), heads: 1.to(4).mapBy(_ => 0),
    bodies: targets.mapBy(_ => "missing"), retiredTargets: Set(),
    requests: callers.mapBy(_ => idle), safePublication: true, createOnly: true }
  pure def tuple(generation: int, descriptor: int): int = (generation - 1) * 2 + descriptor
  def identity(target: int): Target = if (targets.contains(target)) s.targets.get(target) else noTarget
  def bodyAt(target: int): str = if (targets.contains(target)) s.bodies.get(target) else "missing"
  def stop(r: Request, cause: str): Request = r.with("phase", "done").with("result", cause)
  action begin(id: int, mode: str, generation: int, descriptor: int, candidate: int, inputValid: bool): bool = {
    val r = s.requests.get(id)
    all { callers.contains(id), Set("store", "read").contains(mode),
      generations.contains(generation), descriptors.contains(descriptor), targets.contains(candidate), r.phase == "idle",
      s' = s.with("requests", s.requests.set(id,
        idle.with("mode", mode).with("generation", generation).with("descriptor", descriptor).with("candidate", candidate)
          .with("phase", if (not(inputValid)) "done" else if (mode == "store") "initial-active" else "lookup")
          .with("result", if (inputValid) "pending" else "input-error"))) }
  }
  action activeCheck(id: int, io: bool): bool = {
    val r = s.requests.get(id)
    val accepted = io and s.generations.get(r.generation) == "active"
    val finishing = Set("current-active", "final-active").contains(r.phase)
    all { Set("initial-active", "current-active", "publication-active", "final-active").contains(r.phase),
      s' = s.with("requests", s.requests.set(id,
        if (not(io)) stop(r, "database-error") else if (not(accepted)) stop(r, "retired")
        else if (finishing) stop(r.with("activeAccepted", true), "stored")
        else r.with("phase", if (r.phase == "initial-active") "lookup" else "winner"))) }
  }
  action headRead(id: int, io: bool): bool = {
    val r = s.requests.get(id)
    val readHead = s.heads.get(tuple(r.generation, r.descriptor))
    all { r.phase == "lookup", s' = s.with("requests", s.requests.set(id,
      if (not(io)) stop(r, "database-error")
      else if (readHead == 0 and r.mode == "read") stop(r, "missing")
      else r.with("expected", readHead).with("selected", readHead).with("phase", if (readHead == 0) "reserve" else "current"))) }
  }
  action currentRead(id: int, io: bool): bool = {
    val r = s.requests.get(id)
    val body = bodyAt(r.selected)
    all { r.phase == "current", r.selected > 0,
      s' = s.with("requests", s.requests.set(id,
        if (not(io)) stop(r, "read-error") else if (body == "marker") stop(r, "retired")
        else if (body == "bytes")
          (if (r.mode == "read") stop(r.with("verified", true), "read")
           else r.with("verified", true).with("phase", "current-active"))
        else if (r.mode == "read") stop(r, if (body == "missing") "missing" else "corrupt")
        else r.with("phase", "reserve"))) }
  }
  action reserve(id: int, operational: bool): bool = {
    val r = s.requests.get(id)
    val available = identity(r.candidate).generation == 0
    val active = s.generations.get(r.generation) == "active"
    val allowed = operational and active and available
    all { r.phase == "reserve",
      s' = s.with("targets", if (allowed) s.targets.set(r.candidate,
          { generation: r.generation, descriptor: r.descriptor }) else s.targets)
        .with("requests", s.requests.set(id, r.with("reserved", allowed)
          .with("dbFailure", not(operational) or (active and not(available))).with("phase", "reservation-reply"))) }
  }
  action reservationReply(id: int, received: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "reservation-reply", s' = s.with("requests", s.requests.set(id,
      r.with("dbFailure", r.dbFailure or not(received)).with("phase", "reservation-readback"))) }
  }
  action reservationReadback(id: int, io: bool): bool = {
    val r = s.requests.get(id)
    val target = identity(r.candidate)
    val matches = target.generation == r.generation and target.descriptor == r.descriptor
    all { r.phase == "reservation-readback", s' = s.with("requests", s.requests.set(id,
      if (not(io)) stop(r, "database-error")
      else if (target.generation == 0) stop(r, if (r.dbFailure) "reservation-error" else "retired")
      else if (not(matches)) stop(r, "identity-conflict")
      else r.with("reserved", true).with("phase", "put"))) }
  }
  action startPut(id: int): bool = {
    val r = s.requests.get(id)
    all { r.phase == "put", r.reserved,
      s' = s.with("requests", s.requests.set(id, r.with("putPending", true).with("phase", "put-await"))) }
  }
  action settlePut(id: int): bool = {
    val r = s.requests.get(id)
    val creates = bodyAt(r.candidate) == "missing"
    all { r.putPending,
      s' = s.with("bodies", if (creates) s.bodies.set(r.candidate, "bytes") else s.bodies)
        .with("createOnly", s.createOnly and (not(creates) or bodyAt(r.candidate) == "missing"))
        .with("requests", s.requests.set(id, r.with("putPending", false).with("putSettled", true))) }
  }
  action putReply(id: int, received: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "put-await", not(received) or r.putSettled,
      s' = s.with("requests", s.requests.set(id,
        if (received) r.with("phase", "verify-candidate") else stop(r, "put-error"))) }
  }
  action candidateRead(id: int, io: bool): bool = {
    val r = s.requests.get(id)
    val body = bodyAt(r.candidate)
    all { r.phase == "verify-candidate", s' = s.with("requests", s.requests.set(id,
      if (io and body == "bytes") r.with("phase", "publish")
      else stop(r, if (io and body == "marker") "retired" else "candidate-error"))) }
  }
  action publish(id: int, operational: bool): bool = {
    val r = s.requests.get(id)
    val key = tuple(r.generation, r.descriptor)
    val allowed = operational and s.generations.get(r.generation) == "active" and s.heads.get(key) == r.expected
    all { r.phase == "publish",
      s' = s.with("heads", if (allowed) s.heads.set(key, r.candidate) else s.heads)
        .with("safePublication", s.safePublication and (not(allowed) or (r.reserved and
          identity(r.candidate).generation == r.generation and identity(r.candidate).descriptor == r.descriptor)))
        .with("requests", s.requests.set(id, r.with("published", allowed)
          .with("dbFailure", not(operational)).with("phase", "publication-reply"))) }
  }
  action publicationReply(id: int, received: bool): bool = {
    val r = s.requests.get(id)
    all { r.phase == "publication-reply", s' = s.with("requests", s.requests.set(id,
      r.with("dbFailure", r.dbFailure or not(received)).with("phase", "publication-active"))) }
  }
  action winnerRead(id: int, io: bool): bool = {
    val r = s.requests.get(id)
    val readHead = s.heads.get(tuple(r.generation, r.descriptor))
    all { r.phase == "winner", s' = s.with("requests", s.requests.set(id,
      if (not(io)) stop(r, "database-error")
      else if (readHead == 0) stop(r, if (r.dbFailure) "database-error" else "publication-error")
      else r.with("selected", readHead).with("phase", "verify-winner"))) }
  }
  action winnerVerify(id: int, io: bool): bool = {
    val r = s.requests.get(id)
    val body = bodyAt(r.selected)
    all { r.phase == "verify-winner", s' = s.with("requests", s.requests.set(id,
      if (io and body == "bytes") r.with("verified", true).with("phase", "final-active")
      else stop(r, if (io and body == "marker") "retired" else "winner-error"))) }
  }
  action changeBody(target: int, body: str): bool = all { targets.contains(target),
    s.bodies.get(target) == "bytes", Set("corrupt", "missing").contains(body),
    s' = s.with("bodies", s.bodies.set(target, body)) }
  action retireGeneration(generation: int): bool = all { generations.contains(generation), s.generations.get(generation) == "active",
    s' = s.with("generations", s.generations.set(generation, "retiring")) }
  action marker(target: int): bool = {
    val generation = identity(target).generation
    all { targets.contains(target), generation > 0,
      (if (generation > 0) s.generations.get(generation) == "retiring" else false),
      s' = s.with("bodies", s.bodies.set(target, "marker")) }
  }
  action retirementRecord(target: int): bool = all { targets.contains(target), s.bodies.get(target) == "marker",
    s' = s.with("retiredTargets", s.retiredTargets.union(Set(target))) }
  action finishRetirement(generation: int): bool = all { generations.contains(generation), s.generations.get(generation) == "retiring",
    targets.filter(target => s.targets.get(target).generation == generation).subseteq(s.retiredTargets),
    s' = s.with("generations", s.generations.set(generation, "retired")) }
  action nextGeneration = all { s.generations.get(1) != "active", s.generations.get(2) == "absent",
    s' = s.with("generations", s.generations.set(2, "active")) }
  action step = {
    nondet id = callers.oneOf()
    nondet generation = generations.oneOf()
    nondet descriptor = descriptors.oneOf()
    nondet target = targets.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet mode = Set("read", "store").oneOf()
    nondet body = Set("corrupt", "missing").oneOf()
    any { begin(id, mode, generation, descriptor, target, yes), activeCheck(id, yes), headRead(id, yes),
      currentRead(id, yes), reserve(id, yes), reservationReply(id, yes), reservationReadback(id, yes),
      startPut(id), settlePut(id), putReply(id, yes), candidateRead(id, yes), publish(id, yes),
      publicationReply(id, yes), winnerRead(id, yes), winnerVerify(id, yes), changeBody(target, body),
      retireGeneration(generation), marker(target), retirementRecord(target), finishRetirement(generation), nextGeneration, s' = s }
  }
  val invariant = all {
    s.safePublication, s.createOnly,
    generations.filter(generation => s.generations.get(generation) == "active").size() <= 1,
    s.retiredTargets.forall(target => s.bodies.get(target) == "marker"),
    1.to(4).forall(key => {
      val target = s.heads.get(key)
      target == 0 or tuple(identity(target).generation, identity(target).descriptor) == key
    }),
    callers.forall(id => {
      val r = s.requests.get(id)
      all { r.result != "stored" or (r.verified and r.activeAccepted and r.selected > 0),
        r.result != "read" or (r.verified and r.selected > 0),
        not(r.putPending) or (r.reserved and identity(r.candidate).generation == r.generation and
          identity(r.candidate).descriptor == r.descriptor) }
    }) }
  action preparing(id: int, generation: int, descriptor: int, target: int): bool =
    begin(id, "store", generation, descriptor, target, true).then(activeCheck(id, true)).then(headRead(id, true))
  action reserved(id: int): bool = reserve(id, true).then(reservationReply(id, true)).then(reservationReadback(id, true))
  action written(id: int): bool = startPut(id).then(settlePut(id)).then(putReply(id, true))
  action ready(id: int): bool = reserved(id).then(written(id)).then(candidateRead(id, true))
  action published(id: int): bool = publish(id, true).then(publicationReply(id, true)).then(activeCheck(id, true))
  action observed(id: int): bool = winnerRead(id, true).then(winnerVerify(id, true))
  action completed(id: int): bool = published(id).then(observed(id)).then(activeCheck(id, true))
  action seed = preparing(1, 1, 1, 1).then(ready(1)).then(completed(1))
  action reading = begin(2, "read", 1, 1, 2, true).then(headRead(2, true))
  run freshTargetPublishedThenVerifiedTest = init.then(seed).expect(s.requests.get(1).result == "stored" and invariant)
  run invalidPayloadReservesNothingTest = init.then(begin(1, "store", 1, 1, 1, false)).expect(s.targets.get(1).generation == 0 and invariant)
  run initialActiveDatabaseFailureDoesNotWriteTest = init.then(begin(1, "store", 1, 1, 1, true)).then(activeCheck(1, false)).expect(s.requests.get(1).result == "database-error" and s.targets.get(1).generation == 0 and invariant)
  run initiallyRetiredGenerationRefusesTest = init.then(retireGeneration(1)).then(begin(1, "store", 1, 1, 1, true)).then(activeCheck(1, true)).expect(s.requests.get(1).result == "retired" and invariant)
  run genericHeadReadFailureDoesNotWriteTest = init.then(begin(1, "store", 1, 1, 1, true)).then(activeCheck(1, true)).then(headRead(1, false)).expect(s.requests.get(1).result == "database-error" and invariant)
  run lostReservationReplyReadsExactTargetTest = init.then(preparing(1, 1, 1, 1)).then(reserve(1, true)).then(reservationReply(1, false)).then(reservationReadback(1, true)).then(written(1)).then(candidateRead(1, true)).then(completed(1)).expect(s.requests.get(1).result == "stored" and invariant)
  run reservationReadbackFailureNeverStartsPutTest = init.then(preparing(1, 1, 1, 1)).then(reserve(1, true)).then(reservationReply(1, true)).then(reservationReadback(1, false)).expect(s.requests.get(1).result == "database-error" and s.bodies.get(1) == "missing" and invariant)
  run conflictingTargetIdentifierRefusesTest = init.then(preparing(1, 1, 1, 1)).then(preparing(2, 1, 2, 1)).then(reserved(1)).then(reserve(2, true)).then(reservationReply(2, true)).then(reservationReadback(2, true)).expect(s.requests.get(2).result == "identity-conflict" and s.bodies.get(1) == "missing" and invariant)
  run exactTargetCollisionCannotOverwriteTest = init.then(preparing(1, 1, 1, 1)).then(preparing(2, 1, 1, 1)).then(reserved(1)).then(reserved(2)).then(written(1)).then(written(2)).then(candidateRead(1, true)).then(candidateRead(2, true)).then(completed(1)).then(completed(2)).expect(s.bodies.get(1) == "bytes" and s.requests.get(2).result == "stored" and invariant)
  run lostPutReplyRetainsUnpublishedTargetTest = init.then(preparing(1, 1, 1, 1)).then(reserved(1)).then(startPut(1)).then(settlePut(1)).then(putReply(1, false)).expect(s.bodies.get(1) == "bytes" and s.heads.get(1) == 0 and s.requests.get(1).result == "put-error" and invariant)
  run unknownPutReplyDoesNotInventCommittedBytesTest = init.then(preparing(1, 1, 1, 1)).then(reserved(1)).then(startPut(1)).then(putReply(1, false)).expect(s.bodies.get(1) == "missing" and s.requests.get(1).putPending and invariant)
  run validExistingTargetSkipsReservationTest = init.then(seed).then(preparing(2, 1, 1, 2)).then(currentRead(2, true)).then(activeCheck(2, true)).expect(s.requests.get(2).result == "stored" and s.targets.get(2).generation == 0 and invariant)
  run existingCopyRetirementBeforeFinalFenceRefusesTest = init.then(seed).then(preparing(2, 1, 1, 2)).then(currentRead(2, true)).then(retireGeneration(1)).then(activeCheck(2, true)).expect(s.requests.get(2).result == "retired" and s.targets.get(2).generation == 0 and invariant)
  run unavailableCurrentTargetDoesNotRepairTest = init.then(seed).then(preparing(2, 1, 1, 2)).then(currentRead(2, false)).expect(s.requests.get(2).result == "read-error" and s.targets.get(2).generation == 0 and invariant)
  run corruptCurrentTargetUsesFreshKeyTest = init.then(seed).then(changeBody(1, "corrupt")).then(preparing(2, 1, 1, 2)).then(currentRead(2, true)).then(ready(2)).then(completed(2)).expect(s.bodies.get(1) == "corrupt" and s.heads.get(1) == 2 and invariant)
  run missingCurrentTargetUsesFreshKeyTest = init.then(seed).then(changeBody(1, "missing")).then(preparing(2, 1, 1, 2)).then(currentRead(2, true)).then(ready(2)).then(completed(2)).expect(s.bodies.get(1) == "missing" and s.heads.get(1) == 2 and invariant)
  run concurrentFirstPublishChoosesOneTargetTest = init.then(preparing(1, 1, 1, 1)).then(preparing(2, 1, 1, 2)).then(ready(1)).then(ready(2)).then(completed(1)).then(completed(2)).expect(s.heads.get(1) == 1 and s.requests.get(2).selected == 1 and not(s.requests.get(2).published) and invariant)
  run conflictingDescriptorCannotReplaceOtherHeadTest = init.then(seed).then(preparing(2, 1, 2, 2)).then(ready(2)).then(completed(2)).expect(s.heads.get(1) == 1 and s.heads.get(2) == 2 and invariant)
  run lostPublicationReplyReadsVerifiedWinnerTest = init.then(preparing(1, 1, 1, 1)).then(ready(1)).then(publish(1, true)).then(publicationReply(1, false)).then(activeCheck(1, true)).then(observed(1)).then(activeCheck(1, true)).expect(s.requests.get(1).result == "stored" and invariant)
  run failedPublicationWithoutWinnerPreservesFailureTest = init.then(preparing(1, 1, 1, 1)).then(ready(1)).then(publish(1, false)).then(publicationReply(1, true)).then(activeCheck(1, true)).then(winnerRead(1, true)).expect(s.requests.get(1).result == "database-error" and invariant)
  run winnerCorruptionAfterPublicationRefusesTest = init.then(preparing(1, 1, 1, 1)).then(ready(1)).then(published(1)).then(winnerRead(1, true)).then(changeBody(1, "corrupt")).then(winnerVerify(1, true)).expect(s.requests.get(1).result == "winner-error" and invariant)
  run retirementBlocksNewReservationTest = init.then(preparing(1, 1, 1, 1)).then(retireGeneration(1)).then(reserve(1, true)).then(reservationReply(1, true)).then(reservationReadback(1, true)).expect(s.targets.get(1).generation == 0 and s.requests.get(1).result == "retired" and invariant)
  run retirementBlocksPublicationTest = init.then(preparing(1, 1, 1, 1)).then(ready(1)).then(retireGeneration(1)).then(publish(1, true)).then(publicationReply(1, true)).then(activeCheck(1, true)).expect(s.heads.get(1) == 0 and s.requests.get(1).result == "retired" and invariant)
  run retirementAfterWinnerVerificationRefusesTest = init.then(preparing(1, 1, 1, 1)).then(ready(1)).then(published(1)).then(observed(1)).then(retireGeneration(1)).then(activeCheck(1, true)).expect(s.requests.get(1).result == "retired" and invariant)
  run persistentMarkerBlocksEarlierUnknownPutTest = init.then(preparing(1, 1, 1, 1)).then(reserved(1)).then(startPut(1)).then(putReply(1, false)).then(retireGeneration(1)).then(marker(1)).then(retirementRecord(1)).then(finishRetirement(1)).then(settlePut(1)).expect(s.bodies.get(1) == "marker" and s.requests.get(1).result == "put-error" and s.heads.get(1) == 0 and invariant)
  run markerPutReturningNullNeverVerifiesAsEvidenceTest = init.then(preparing(1, 1, 1, 1)).then(reserved(1)).then(retireGeneration(1)).then(marker(1)).then(written(1)).then(candidateRead(1, true)).expect(s.bodies.get(1) == "marker" and s.requests.get(1).result == "retired" and invariant)
  run unpublishedTargetsStillNeedRetirementTest = init.then(preparing(1, 1, 1, 1)).then(reserved(1)).then(startPut(1)).then(putReply(1, false)).then(retireGeneration(1)).then(finishRetirement(1).fail())
  run unpublishedTargetsRetireAfterMarkerTest = init.then(preparing(1, 1, 1, 1)).then(reserved(1)).then(startPut(1)).then(putReply(1, false)).then(retireGeneration(1)).then(marker(1)).then(retirementRecord(1)).then(finishRetirement(1)).expect(s.generations.get(1) == "retired" and invariant)
  run laterGenerationUsesDifferentPhysicalKeyTest = init.then(preparing(1, 1, 1, 1)).then(ready(1)).then(retireGeneration(1)).then(marker(1)).then(retirementRecord(1)).then(finishRetirement(1)).then(nextGeneration).then(preparing(2, 2, 1, 2)).then(ready(2)).then(completed(2)).expect(s.bodies.get(1) == "marker" and s.heads.get(3) == 2 and invariant)
  run absentHeadReadOwnsNoReservationTest = init.then(reading).expect(s.requests.get(2).result == "missing" and s.targets.get(2).generation == 0 and invariant)
  run retiringGenerationReadCanReturnExistingBytesTest = init.then(seed).then(retireGeneration(1)).then(reading).then(currentRead(2, true)).expect(s.requests.get(2).result == "read" and invariant)
  run markerReadNeverReturnsOriginalBytesTest = init.then(seed).then(retireGeneration(1)).then(marker(1)).then(reading).then(currentRead(2, true)).expect(s.requests.get(2).result == "retired" and invariant)
  run corruptReadDoesNotRepairTest = init.then(seed).then(changeBody(1, "corrupt")).then(reading).then(currentRead(2, true)).expect(s.requests.get(2).result == "corrupt" and s.targets.get(2).generation == 0 and invariant)
}
