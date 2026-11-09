// @source backend/vetting/flags.ts
// @source backend/vetting/flagger-standing.ts
// @evidence scripts/vetting-scan-flags.test.ts
// Two reporters, two invocations each, revisions/digests 1..2. Age classes are
// below, exactly at, and above 30 days. Authentication/membership, account and
// authority HTTP evidence, input grammar and D1 atomicity are delegated. The handler
// reads authority THEN standing before checking a maintainer outcome; failures
// cannot grant standing. The ban and project revision/digest are checked again
// in the write. Pause and notices commit with the second distinct active flag.
// Readback, cache-generation/scan work and response observation follow commit;
// their failure never rolls back it. Expiry/withdrawal do not lift a pause.
// notices counts pause notification groups, not their individual recipients.
// Individual cache-delete failures are swallowed by purge; postcommit failure
// here represents generation-read or queued-scan failure instead.
// A supplied external reinstatement has its separate freshness model in
// vetting_flag_reinstatement. No new policy, provider or execution proof.
module vetting_flag_admission {
  val reporters = Set(1, 2)
  type Call = { phase: str, attempt: int, age: int, accepted: bool,
    authority: str, inputValid: bool, revision: int, digest: int,
    standingRead: bool, committed: bool, paused: bool, observedActive: bool,
    observedRestriction: str, queue: bool, status: int, error: str }
  type State = { revision: int, digest: int, owner: int, banned: Set[int],
    active: Set[int], filed: Set[int], old: Set[int], restriction: str,
    pauses: int, notices: int, calls: int -> Call }
  var s: State
  val fresh: Call = { phase: "unused", attempt: 0, age: 2, accepted: true,
    authority: "denied", inputValid: true, revision: 0, digest: 0,
    standingRead: false, committed: false, paused: false, observedActive: false,
    observedRestriction: "none", queue: true, status: 0, error: "none" }
  action init = s' = { revision: 1, digest: 1, owner: 0, banned: Set(), active: Set(),
    filed: Set(), old: Set(), restriction: "clear", pauses: 0, notices: 0,
    calls: Map(1 -> fresh, 2 -> fresh) }
  def call(who: int): Call = s.calls.get(who)
  pure def ended(c: Call, status: int, error: str): Call = c.with("phase", "done").with("status", status).with("error", error)
  action configure(who: int, kind: int): bool = {
    val c = call(who)
    val value = c.with("age", if (kind == 1) 0 else if (kind == 2) 1 else 2)
      .with("accepted", kind != 3).with("authority", if (kind == 4) "verified" else if (kind == 5) "retry" else "denied")
      .with("inputValid", kind != 6).with("queue", kind != 7)
    all { c.phase == "unused", 0.to(7).contains(kind), s' = s.with("calls", s.calls.set(who, value)) }
  }
  action begin(who: int): bool = {
    val c = call(who)
    val started = c.with("attempt", c.attempt + 1)
    all { c.phase == "unused", c.attempt < 2, s' = s.with("calls", s.calls.set(who,
      if (s.banned.contains(who)) ended(started, 403, "banned")
      else started.with("phase", "body"))) }
  }
  action body(who: int): bool = {
    val c = call(who)
    all { c.phase == "body", s' = s.with("calls", s.calls.set(who,
      if (c.inputValid) c.with("phase", "project") else ended(c, 400, "input"))) }
  }
  action project(who: int): bool = {
    val c = call(who)
    all { c.phase == "project", s' = s.with("calls", s.calls.set(who,
      if (s.owner == who) ended(c, 403, "owner") else c.with("phase", "authority")
        .with("revision", s.revision).with("digest", s.digest))) }
  }
  action authority(who: int, ok: bool): bool = {
    val c = call(who)
    all { c.phase == "authority", s' = s.with("calls", s.calls.set(who,
      if (ok) c.with("phase", "standing") else ended(c, 503, "standing-unavailable"))) }
  }
  action standing(who: int, ok: bool): bool = {
    val c = call(who).with("standingRead", true)
    all { c.phase == "standing", s' = s.with("calls", s.calls.set(who,
      if (not(ok)) ended(c, 503, "standing-unavailable")
      else if (c.authority == "verified") ended(c, 403, "maintainer")
      else if (c.authority == "retry") ended(c, 503, "standing-unavailable")
      else if (c.age == 0) ended(c, 403, "young")
      else if (not(c.accepted)) ended(c, 403, "no-accepted-work") else c.with("phase", "write"))) }
  }
  action fileFlag(who: int): bool = {
    val c = call(who)
    val pause = s.restriction == "clear" and s.active.union(Set(who)).size() >= 2
    val written = c.with("phase", "readback").with("committed", true).with("paused", pause)
    all { c.phase == "write", s' =
      if (s.banned.contains(who)) s.with("calls", s.calls.set(who, ended(c, 403, "banned")))
      else if (s.active.contains(who) or c.revision != s.revision or c.digest != s.digest)
        s.with("calls", s.calls.set(who, c.with("phase", "conflict")))
      else s.with("active", s.active.union(Set(who))).with("filed", s.filed.union(Set(who)))
        .with("restriction", if (pause) "quarantined" else s.restriction)
        .with("pauses", s.pauses + if (pause) 1 else 0).with("notices", s.notices + if (pause) 1 else 0)
        .with("calls", s.calls.set(who, written)) }
  }
  action conflict(who: int): bool = {
    val c = call(who)
    all { c.phase == "conflict", s' = s.with("calls", s.calls.set(who,
      ended(c, 409, if (s.active.contains(who)) "active" else "retry"))) }
  }
  action readback(who: int): bool = {
    val c = call(who)
    all { c.phase == "readback", s' = s.with("calls", s.calls.set(who,
      c.with("observedActive", s.active.contains(who)).with("phase", if (c.paused) "postcommit" else "response"))) }
  }
  action postcommit(who: int, ok: bool): bool = {
    val c = call(who)
    all { c.phase == "postcommit", s' = s.with("calls", s.calls.set(who,
      if (ok) c.with("phase", "response") else ended(c, 500, "postcommit"))) }
  }
  action respond(who: int): bool = {
    val c = call(who)
    all { c.phase == "response", s' = s.with("calls", s.calls.set(who,
      ended(c.with("observedRestriction", s.restriction), 201, "none"))) }
  }
  action failure(who: int): bool = {
    val c = call(who)
    all { Set("project", "write", "readback", "response", "conflict").contains(c.phase),
      s' = s.with("calls", s.calls.set(who, ended(c, 500, "io"))) }
  }
  action retry(who: int): bool = {
    val c = call(who)
    all { c.phase == "done", c.attempt < 2,
      s' = s.with("calls", s.calls.set(who, fresh.with("attempt", c.attempt))) }
  }
  action ban(who: int): bool = s' = s.with("banned", s.banned.union(Set(who)))
  action revise(owner: int): bool = all { s.revision == 1, 0.to(2).contains(owner),
    s' = s.with("revision", 2).with("digest", 2).with("owner", owner) }
  action expire(who: int): bool = all { s.active.contains(who),
    s' = s.with("active", s.active.exclude(Set(who))).with("old", s.old.union(Set(who))) }
  action reinstated = all { s.restriction == "quarantined", s' = s.with("restriction", "clear").with("active", Set()) }
  action step = {
    nondet who = reporters.oneOf() nondet kind = 0.to(7).oneOf() nondet ok = Set(false, true).oneOf()
    any { configure(who, kind), begin(who), body(who), project(who), authority(who, ok), standing(who, ok), fileFlag(who),
      conflict(who), readback(who), postcommit(who, ok), respond(who), failure(who), retry(who), ban(who), revise(who), expire(who), reinstated, s' = s }
  }
  val invariant = all { s.active.subseteq(s.filed), s.notices == s.pauses, s.pauses <= 2,
    s.active.size() == 2 implies s.restriction != "clear",
    reporters.forall(who => call(who).status == 201 implies call(who).committed),
    reporters.forall(who => call(who).committed implies call(who).standingRead and call(who).age > 0 and call(who).accepted),
    reporters.forall(who => call(who).paused implies call(who).committed) }
  action verifyStanding(who: int): bool = begin(who).then(body(who)).then(project(who)).then(authority(who, true)).then(standing(who, true))
  action finish(who: int): bool = readback(who).then(respond(who))
  action admitted(who: int): bool = verifyStanding(who).then(fileFlag(who))
  run banBetweenCheckAndWriteTest = init.then(verifyStanding(1)).then(ban(1)).then(fileFlag(1))
    .expect(call(1).error == "banned" and s.active == Set() and invariant)
  run twoMembersPauseThenExpireTest = init.then(admitted(1)).then(finish(1)).then(admitted(2)).then(readback(2)).then(postcommit(2, true)).then(respond(2)).then(expire(1))
    .expect(s.restriction == "quarantined" and s.active == Set(2) and invariant)
  run changedProjectCannotUseOldStandingTest = init.then(verifyStanding(1)).then(revise(1)).then(fileFlag(1)).then(conflict(1))
    .expect(s.active == Set() and call(1).error == "retry" and invariant)
  run changedOwnerCannotRefreshStandingTest = init.then(verifyStanding(1)).then(revise(1)).then(fileFlag(1)).then(conflict(1)).then(retry(1)).then(begin(1)).then(body(1)).then(project(1))
    .expect(call(1).error == "owner" and invariant)
  run recheckedNonOwnerCanFileNewRevisionTest = init.then(verifyStanding(1)).then(revise(2)).then(fileFlag(1)).then(conflict(1)).then(retry(1)).then(admitted(1)).then(finish(1))
    .expect(s.active == Set(1) and call(1).status == 201 and invariant)
  run exactThirtyDaysQualifiesTest = init.then(configure(1, 2)).then(admitted(1)).then(finish(1)).expect(call(1).status == 201 and invariant)
  run underThirtyDaysRefusedTest = init.then(configure(1, 1)).then(verifyStanding(1)).expect(call(1).error == "young" and s.active == Set() and invariant)
  run acceptedWorkRequiredTest = init.then(configure(1, 3)).then(verifyStanding(1)).expect(call(1).error == "no-accepted-work" and invariant)
  run maintainerStillReadsStandingBeforeRefusalTest = init.then(configure(1, 4)).then(verifyStanding(1)).expect(call(1).standingRead and call(1).error == "maintainer" and invariant)
  run standingOutagePrecedesMaintainerRefusalTest = init.then(configure(1, 4)).then(begin(1)).then(body(1)).then(project(1)).then(authority(1, true)).then(standing(1, false))
    .expect(call(1).status == 503 and call(1).error == "standing-unavailable" and invariant)
  run authorityOutageDoesNotReadStandingTest = init.then(begin(1)).then(body(1)).then(project(1)).then(authority(1, false)).expect(not(call(1).standingRead) and invariant)
  run retryAuthorityIsNotPermissionTest = init.then(configure(1, 5)).then(verifyStanding(1)).expect(call(1).status == 503 and invariant)
  run invalidInputDoesNotReadProjectTest = init.then(configure(1, 6)).then(begin(1)).then(body(1)).expect(call(1).status == 400 and call(1).revision == 0 and invariant)
  run duplicateFlagIsReclassifiedAfterWriteTest = init.then(admitted(1)).then(finish(1)).then(retry(1)).then(admitted(1)).then(conflict(1))
    .expect(call(1).error == "active" and s.active == Set(1) and s.pauses == 0 and invariant)
  run expiredDuplicateCanReturnRetryInsteadTest = init.then(admitted(1)).then(finish(1)).then(retry(1)).then(admitted(1)).then(expire(1)).then(conflict(1))
    .expect(call(1).error == "retry" and invariant)
  run readbackFailureRetainsCommittedFlagTest = init.then(admitted(1)).then(failure(1)).expect(call(1).status == 500 and s.active == Set(1) and invariant)
  run readbackMayObserveAlreadyClosedFlagTest = init.then(admitted(1)).then(expire(1)).then(finish(1))
    .expect(call(1).status == 201 and not(call(1).observedActive) and s.old == Set(1) and invariant)
  run secondFlagPostcommitFailureRetainsPauseTest = init.then(admitted(1)).then(finish(1)).then(admitted(2)).then(readback(2)).then(postcommit(2, false))
    .expect(call(2).status == 500 and s.active == reporters and s.notices == 1 and invariant)
  run noQueueIsStillSuccessfulPauseTest = init.then(configure(2, 7)).then(admitted(1)).then(finish(1)).then(admitted(2)).then(readback(2)).then(postcommit(2, true)).then(respond(2))
    .expect(not(call(2).queue) and call(2).paused and call(2).status == 201 and invariant)
  run responseObservesRestrictionAfterReinstatementTest = init.then(admitted(1)).then(finish(1)).then(admitted(2)).then(readback(2)).then(postcommit(2, true)).then(reinstated).then(respond(2))
    .expect(call(2).paused and call(2).observedRestriction == "clear" and invariant)
  run expiredFlagDoesNotLiftPauseTest = init.then(admitted(1)).then(admitted(2)).then(expire(1)).then(expire(2)).expect(s.active == Set() and s.restriction == "quarantined" and invariant)
  run prewriteFailureCannotCreateFlagTest = init.then(verifyStanding(1)).then(failure(1)).expect(s.active == Set() and not(call(1).committed) and invariant)
}
