// @source src/Profiles.tsx
// @source src/ProfilePage.tsx
// @source src/Points.tsx
// @source src/lib/profiles.ts
// @source src/lib/use-public-resource.ts
// @source src/lib/browser-json.ts
// @evidence tests/e2e/profile-rename.spec.ts
// Source-only: no model execution or browser acceptance claimed.
// Two route instances, four read IDs, three validated directory versions and
// three clock ticks bound this model. Version 1 is a warm older directory;
// version 2 names actor 2 at the second route; version 3 establishes absence
// there. The old directory either lacks that route or names former actor 3.
// Actor 1 is the warm-up route. Other identity sources are already settled;
// `authority` represents a compatible current member/ledger actor, or none.
// Full source arbitration remains in ui_profile_identity. Public membership
// checks, schema/byte/count validation and native Fetch abort are external.
// Validation, module-cache write and hook-local publication are distinct.
// A response validated before cleanup may still seed lastVerifiedProfiles;
// cleanup/deadline can nevertheless refuse its local view publication. A
// global-cache write causes no React render by itself. A later parent render
// can observe it only when that instance is using the failed-read fallback.
// No monotonic generatedAt policy or cache TTL exists in current source.
// The generatedAt/startedAt relation is validated, not ordered against the
// prior cache. Clock ticks alone neither expire nor refresh cached profiles.
// One model clock unit stands for the captured read's 15-second deadline.
// A new mount and every retry start from loading. Last-verified fallback is
// used only after a failed read and carries refreshError. Failure plus a
// missing/conflicting cached identity is unavailable, never known absence.
module ui_profile_census_cache {
  type Read = { phase: str, instance: int, version: int,
    bodyReady: bool, aborted: bool, settled: bool, deadline: int }
  type State = { mounted: bool, instance: int, route: int, conflicting: bool,
    authority: int, scheduled: bool, active: int, phase: str, local: int,
    shown: int, cache: int, now: int, reads: int -> Read }
  val ids = Set(1, 2, 3, 4)
  val versions = Set(1, 2, 3)
  val unused: Read = { phase: "unused", instance: 0, version: 0,
    bodyReady: false, aborted: false, settled: false, deadline: 0 }
  var s: State

  pure def paint(value: State): State = value.with("shown",
    if (value.phase == "ready") value.local
    else if (value.phase == "error") value.cache else 0)
  pure def directoryActor(version: int, route: int, conflicting: bool): int =
    if (version == 0) 0 else if (route == 1) 1
    else if (version == 2) 2
    else if (version == 1 and conflicting) 3 else 0
  val recorded = directoryActor(s.shown, s.route, s.conflicting)
  val actor = if (s.shown == 0) 0
    else if (s.authority > 0 and recorded > 0 and recorded != s.authority) 0
    else if (s.authority > 0) s.authority else recorded
  val view = if (not(s.mounted)) "departed"
    else if (s.phase == "loading") "checking"
    else if (actor > 0) (if (s.phase == "error") "stale-profile" else "profile")
    else if (s.phase == "error") "unavailable" else "absent"
  val canRetry = s.mounted and s.phase == "error"
  def owns(id: int): bool = s.mounted and s.active == id
    and s.reads.get(id).instance == s.instance and not(s.reads.get(id).settled)
  def mayValidate(id: int): bool = s.reads.get(id).phase == "reading"
    and (not(s.reads.get(id).aborted) or s.reads.get(id).bodyReady)

  action init = s' = { mounted: true, instance: 1, route: 1, conflicting: false,
    authority: 0, scheduled: true, active: 0, phase: "loading", local: 0,
    shown: 0, cache: 0, now: 0, reads: ids.mapBy(_ => unused) }
  action conflictingCache = all { s.active == 0,
    ids.forall(id => s.reads.get(id).phase == "unused"),
    s' = s.with("conflicting", true) }
  action begin(id: int): bool = all { s.mounted, s.scheduled,
    ids.contains(id), s.reads.get(id).phase == "unused",
    s' = paint(s.with("active", id).with("scheduled", false)
      .with("phase", "loading").with("local", 0)
      .with("reads", s.reads.set(id, unused.with("phase", "reading")
        .with("instance", s.instance).with("deadline", s.now + 1)))) }
  // Native abort prevents unfinished body acquisition. Already obtained bytes
  // can still decode/validate after cleanup; loadProfiles has no later abort gate.
  action captureBody(id: int): bool = all { s.reads.get(id).phase == "reading",
    not(s.reads.get(id).aborted), not(s.reads.get(id).bodyReady),
    s' = s.with("reads", s.reads.set(id, s.reads.get(id).with("bodyReady", true))) }
  action validate(id: int, version: int): bool = all {
    mayValidate(id), versions.contains(version),
    s' = s.with("reads", s.reads.set(id, s.reads.get(id)
      .with("phase", "validated").with("version", version))) }
  // loadVerifiedProfiles writes before usePublicResource's active/settled gate.
  action publishCache(id: int): bool = all { s.reads.get(id).phase == "validated",
    s' = s.with("cache", s.reads.get(id).version).with("reads",
      s.reads.set(id, s.reads.get(id).with("phase", "cached"))) }
  action publishView(id: int): bool = {
    val read = s.reads.get(id)
    val done = s.with("reads", s.reads.set(id,
      read.with("phase", "done").with("settled", true)))
    all { read.phase == "cached",
      s' = if (owns(id)) paint(done.with("phase", "ready")
        .with("active", 0).with("local", read.version)) else done }
  }
  // HTTP/transport/schema failures all preserve the previously verified cache.
  action readFailure(id: int): bool = {
    val read = s.reads.get(id)
    val done = s.with("reads", s.reads.set(id,
      read.with("phase", "failed").with("settled", true)))
    all { read.phase == "reading",
      s' = if (owns(id)) paint(done.with("phase", "error").with("active", 0)) else done }
  }
  action deadline(id: int): bool = all { owns(id), s.now >= s.reads.get(id).deadline,
    Set("reading", "validated", "cached").contains(s.reads.get(id).phase),
    s' = paint(s.with("phase", "error").with("active", 0).with("reads",
      s.reads.set(id, s.reads.get(id).with("aborted", true).with("settled", true)))) }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }
  action retry = all { canRetry, not(s.scheduled), s' = s.with("scheduled", true) }
  action nextRoute = all { s.mounted, s.instance == 1,
    s' = s.with("instance", 2).with("route", 2).with("authority", 0)
      .with("active", 0).with("scheduled", true).with("phase", "loading")
      .with("local", 0).with("shown", 0).with("reads", ids.mapBy(id =>
        if (s.reads.get(id).instance == 1) s.reads.get(id).with("aborted", true)
        else s.reads.get(id))) }
  action confirmCurrentActor = all { s.mounted, s.route == 2, s.authority == 0,
    s' = paint(s.with("authority", 2)) }
  action unrelatedRender = all { s.mounted, s' = paint(s) }
  action depart = all { s.mounted,
    s' = s.with("mounted", false).with("active", 0).with("scheduled", false)
      .with("reads", ids.mapBy(id => if (s.reads.get(id).instance == s.instance)
        s.reads.get(id).with("aborted", true) else s.reads.get(id))) }
  action step = {
    nondet id = ids.oneOf()
    nondet version = versions.oneOf()
    any { conflictingCache, begin(id), captureBody(id), validate(id, version), publishCache(id),
      publishView(id), readFailure(id), deadline(id), tick, retry, nextRoute,
      confirmCurrentActor, unrelatedRender, depart, s' = s }
  }
  val invariant = all {
    s.cache == 0 or versions.contains(s.cache),
    s.cache > 0 implies ids.exists(id => s.reads.get(id).version == s.cache
      and Set("cached", "done").contains(s.reads.get(id).phase)),
    s.phase == "loading" implies s.shown == 0,
    view == "absent" implies s.phase == "ready" and s.shown > 0 and actor == 0,
    s.phase == "error" and actor == 0 and s.mounted implies view == "unavailable" and canRetry,
    view == "stale-profile" implies actor > 0 and s.phase == "error",
    s.phase == "ready" implies ids.exists(id => s.reads.get(id).instance == s.instance
      and s.reads.get(id).phase == "done" and s.reads.get(id).version == s.local)
  }

  run coldMountDoesNotUseUnverifiedCacheTest = init.expect(view == "checking" and s.cache == 0)
  run coldFailureIsUnavailableTest = init.then(begin(1)).then(readFailure(1))
    .expect(view == "unavailable" and canRetry and invariant)
  run validationIsNotViewPublicationTest = init.then(begin(1)).then(validate(1, 1))
    .expect(s.cache == 0 and view == "checking")
  run cacheWritePrecedesLocalSuccessTest = init.then(begin(1)).then(validate(1, 1))
    .then(publishCache(1)).expect(s.cache == 1 and view == "checking")
  run successfulReadNamesCurrentActorTest = init.then(begin(1)).then(validate(1, 1))
    .then(publishCache(1)).then(publishView(1)).expect(view == "profile" and actor == 1 and invariant)
  run nextMountStillRequiresFreshReadTest = init.then(begin(1)).then(validate(1, 1))
    .then(publishCache(1)).then(publishView(1)).then(nextRoute)
    .expect(s.cache == 1 and view == "checking" and s.shown == 0)
  run warmMissingIdentityIsUnavailableTest = init.then(begin(1)).then(validate(1, 1))
    .then(publishCache(1)).then(publishView(1)).then(nextRoute).then(begin(2)).then(readFailure(2))
    .expect(view == "unavailable" and actor == 0 and canRetry and invariant)
  run warmConflictWithCurrentMemberIsUnavailableTest = init.then(conflictingCache)
    .then(begin(1)).then(validate(1, 1)).then(publishCache(1)).then(publishView(1))
    .then(nextRoute).then(confirmCurrentActor).then(begin(2)).then(readFailure(2))
    .expect(recorded == 3 and actor == 0 and view == "unavailable" and canRetry)
  run compatibleCachedProfileRemainsVisibleTest = init.then(begin(1)).then(validate(1, 2))
    .then(publishCache(1)).then(publishView(1)).then(nextRoute).then(begin(2)).then(readFailure(2))
    .expect(view == "stale-profile" and actor == 2 and invariant)
  run currentMemberMayUseNonconflictingCachedDirectoryTest = init.then(begin(1))
    .then(validate(1, 1)).then(publishCache(1)).then(publishView(1)).then(nextRoute)
    .then(confirmCurrentActor).then(begin(2)).then(readFailure(2))
    .expect(view == "stale-profile" and actor == 2 and invariant)
  run successfulEmptyDirectoryCanEstablishAbsenceTest = init.then(nextRoute).then(begin(1))
    .then(validate(1, 3)).then(publishCache(1)).then(publishView(1))
    .expect(view == "absent" and not(canRetry) and invariant)
  run retryHidesFallbackUntilItsResultTest = init.then(begin(1)).then(validate(1, 1))
    .then(publishCache(1)).then(publishView(1)).then(nextRoute).then(begin(2)).then(readFailure(2))
    .then(retry).then(begin(3)).expect(view == "checking" and s.cache == 1)
  run retryRecoversMissingIdentityTest = init.then(begin(1)).then(validate(1, 1))
    .then(publishCache(1)).then(publishView(1)).then(nextRoute).then(begin(2)).then(readFailure(2))
    .then(retry).then(begin(3)).then(validate(3, 2)).then(publishCache(3)).then(publishView(3))
    .expect(view == "profile" and actor == 2 and invariant)
  run retryCanConfirmActualAbsenceTest = init.then(nextRoute).then(begin(1)).then(readFailure(1))
    .then(retry).then(begin(2)).then(validate(2, 3)).then(publishCache(2)).then(publishView(2))
    .expect(view == "absent" and invariant)
  run departedValidatedReadMayOnlySeedGlobalCacheTest = init.then(begin(1)).then(validate(1, 1))
    .then(nextRoute).then(publishCache(1)).then(publishView(1))
    .expect(s.cache == 1 and s.shown == 0 and view == "checking" and invariant)
  run completeBodyCanValidateAfterDepartureTest = init.then(begin(1)).then(captureBody(1))
    .then(nextRoute).then(validate(1, 1)).then(publishCache(1)).then(publishView(1))
    .expect(s.cache == 1 and view == "checking" and invariant)
  run abortBeforeBodyCannotValidateTest = init.then(begin(1)).then(nextRoute)
    .expect(not(mayValidate(1)) and s.cache == 0)
  run lateCacheWriteDoesNotChangeAReadyViewTest = init.then(begin(1)).then(validate(1, 1))
    .then(nextRoute).then(begin(2)).then(validate(2, 2)).then(publishCache(2)).then(publishView(2))
    .then(publishCache(1)).then(publishView(1))
    .expect(s.cache == 1 and s.shown == 2 and view == "profile" and invariant)
  run failedViewReadsChangedCacheOnlyOnRenderTest = init.then(begin(1)).then(validate(1, 2))
    .then(nextRoute).then(begin(2)).then(readFailure(2)).then(publishCache(1))
    .expect(s.cache == 2 and s.shown == 0 and view == "unavailable")
  run unrelatedRenderCanObserveValidatedFallbackTest = init.then(begin(1)).then(validate(1, 2))
    .then(nextRoute).then(begin(2)).then(readFailure(2)).then(publishCache(1)).then(unrelatedRender)
    .expect(view == "stale-profile" and actor == 2 and invariant)
  run elapsedClockDoesNotExpireModuleCacheTest = init.then(begin(1)).then(validate(1, 1))
    .then(publishCache(1)).then(publishView(1)).then(tick).then(tick).then(tick)
    .expect(s.cache == 1 and view == "profile" and actor == 1)
  run deadlineRefusesLocalLateSuccessTest = init.then(begin(1)).then(validate(1, 1))
    .then(tick).then(deadline(1)).then(publishCache(1)).then(publishView(1))
    .expect(s.phase == "error" and s.local == 0 and s.cache == 1 and invariant)
  run departedViewNeverPublishesLocallyTest = init.then(begin(1)).then(validate(1, 1))
    .then(depart).then(publishCache(1)).then(publishView(1))
    .expect(view == "departed" and s.local == 0 and invariant)

  // Historical projection only, not in step: before the fix a ready fallback
  // suppressed the original error and no selected actor became a false 404.
  val oldView = if (s.phase == "error" and s.shown > 0 and actor == 0)
    "absent" else view
  run oldWarmMissingFallbackInventedAbsenceTest = init.then(begin(1)).then(validate(1, 1))
    .then(publishCache(1)).then(publishView(1)).then(nextRoute).then(begin(2)).then(readFailure(2))
    .expect(oldView == "absent" and view == "unavailable")
  run oldWarmConflictInventedAbsenceTest = init.then(conflictingCache).then(begin(1))
    .then(validate(1, 1)).then(publishCache(1)).then(publishView(1)).then(nextRoute)
    .then(confirmCurrentActor).then(begin(2)).then(readFailure(2))
    .expect(oldView == "absent" and view == "unavailable")
}
