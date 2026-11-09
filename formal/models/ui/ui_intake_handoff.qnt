// @source src/SecurityBounty.tsx
// @source src/App.tsx
// @evidence tests/e2e/security-bounty.spec.ts
// @evidence tests/e2e/intake-readiness-lifetime.spec.ts
// Source-only, unexecuted refinement of IntakeHandoff/AutomaticReportForm.
// Three reads/observations, two component lifetimes/projects, one reporter,
// durations 0/2/4 and monotonic clock 0..6 bound the model. A separate wall
// clock shows that changing Date does not extend performance.now deadlines.
// HTTP/body validation, server age, native timer scheduling and the private
// form's saved-draft/session protocol are delegated. No browser/provider ran.
// App keys SecurityProgramPage by project.id. StrictMode can replay its first
// effect. Reads are not aborted, but only the current lifetime/read publishes.
// A recheck keeps the prior observation and absolute acceptance deadline.
// Timer callbacks are bound to that observation, independent of the new read.
module ui_intake_handoff {
  type Read = { phase: str, life: int, project: int }
  type Timer = { phase: str, deadline: int }
  type State = { mounted: bool, life: int, project: int, actor: bool,
    phase: str, active: int, reads: int -> Read, observation: int,
    ready: bool, url: bool, stored: bool, stale: bool, staleFor: int,
    rechecking: bool, acceptedAt: int, deadline: int, duration: int,
    now: int, wall: int, timers: int -> Timer, replayed: bool, draft: bool }
  val ids = Set(1, 2, 3)
  val noRead: Read = { phase: "unused", life: 0, project: 0 }
  val noTimer: Timer = { phase: "unused", deadline: 0 }
  var s: State
  val localIntake = s.mounted and s.phase == "checked" and s.stored
  val form = localIntake and s.actor
  val renderedDraft = form and s.draft
  val githubLink = s.mounted and s.phase == "checked" and s.ready and s.url and not(s.stale)
  val retryVisible = s.mounted and (s.phase == "error" or
    (s.phase == "checked" and (s.stale or not(s.ready) or not(s.url))))
  def owns(id: int): bool = s.mounted and s.active == id
    and s.reads.get(id).life == s.life and s.reads.get(id).project == s.project
  pure def starting(value: State, id: int): State = value.with("active", id)
    .with("reads", value.reads.set(id, { phase: "pending", life: value.life, project: value.project }))
    .with("phase", if (value.phase == "checked") "checked" else "checking")
    .with("rechecking", value.phase == "checked")

  action init = s' = { mounted: true, life: 1, project: 1, actor: true,
    phase: "checking", active: 0, reads: ids.mapBy(_ => noRead), observation: 0,
    ready: false, url: false, stored: false, stale: false, staleFor: 0,
    rechecking: false, acceptedAt: 0, deadline: 0, duration: 0,
    now: 0, wall: 0, timers: ids.mapBy(_ => noTimer), replayed: false, draft: false }
  action begin(id: int): bool = all { s.mounted, ids.contains(id), s.reads.get(id).phase == "unused",
    s' = starting(s, id) }
  action initialRead(id: int): bool = all { s.active == 0, s.phase == "checking", begin(id) }
  action retry(id: int): bool = all { retryVisible, not(s.rechecking), begin(id) }
  action replayEffect(id: int): bool = all { s.mounted, not(s.replayed),
    s.phase == "checking", s.active > 0, ids.contains(id), s.reads.get(id).phase == "unused",
    s' = starting(s, id).with("replayed", true) }
  action reply(id: int, ready: bool, url: bool, stored: bool, stale: bool, duration: int): bool = {
    val r = s.reads.get(id)
    val finished = s.with("reads", s.reads.set(id, r.with("phase", "done")))
    all { r.phase == "pending", Set(0, 2, 4).contains(duration),
      s' = if (owns(id)) finished.with("active", 0).with("phase", "checked")
        .with("observation", id).with("ready", ready).with("url", url).with("stored", stored)
        .with("stale", stale).with("staleFor", if (stale) id else 0).with("rechecking", false)
        .with("acceptedAt", s.now).with("duration", duration).with("deadline", s.now + duration)
      else finished }
  }
  action reject(id: int): bool = {
    val r = s.reads.get(id)
    val finished = s.with("reads", s.reads.set(id, r.with("phase", "failed")))
    all { r.phase == "pending",
      s' = if (not(owns(id))) finished
      else if (s.phase == "checked") finished.with("active", 0).with("stale", true)
        .with("staleFor", s.observation).with("rechecking", false)
      else finished.with("active", 0).with("phase", "error").with("rechecking", false) }
  }
  // The passive effect cleans older timers and schedules from the accepted
  // absolute deadline. Rechecking the same value/deadline does not rearm it.
  action flushTimerEffect = all { s.mounted,
    s' = s.with("timers", ids.mapBy(id => {
      val t = s.timers.get(id)
      if (s.phase == "checked" and not(s.stale) and id == s.observation)
        (if (t.phase == "unused") { phase: "armed", deadline: s.deadline } else t)
      else if (t.phase == "armed") t.with("phase", "cancelled") else t
    })) }
  action queueExpiry(id: int): bool = all { s.timers.get(id).phase == "armed",
    s.now >= s.timers.get(id).deadline,
    s' = s.with("timers", s.timers.set(id, s.timers.get(id).with("phase", "queued"))) }
  action expire(id: int): bool = {
    val t = s.timers.get(id)
    val current = s.mounted and s.phase == "checked" and s.observation == id and s.deadline == t.deadline
    val finished = s.with("timers", s.timers.set(id, t.with("phase", "fired")))
    all { t.phase == "queued",
      s' = if (current) finished.with("stale", true).with("staleFor", id) else finished }
  }
  action tick = all { s.now < 6, s' = s.with("now", s.now + 1) }
  action wallClock(value: int): bool = all { Set(0, 1, 2).contains(value), s' = s.with("wall", value) }
  action editDraft = all { form, s' = s.with("draft", true) }
  // Form/sign-in projection only. Account-bound draft clearing/restoration is
  // covered by ui_private_intake and the session models.
  action signedOut = all { s.actor, s' = s.with("actor", false) }
  action signedIn = all { not(s.actor), s' = s.with("actor", true) }
  action depart = all { s.mounted, s' = s.with("mounted", false).with("active", 0) }
  action remount = all { not(s.mounted), s.life == 1,
    s' = s.with("mounted", true).with("life", 2).with("project", 2).with("phase", "checking")
      .with("active", 0).with("observation", 0).with("ready", false).with("url", false)
      .with("stored", false).with("stale", false).with("staleFor", 0)
      .with("rechecking", false).with("draft", false).with("acceptedAt", 0).with("deadline", 0) }
  action step = {
    nondet id = ids.oneOf()
    nondet ready = Set(false, true).oneOf()
    nondet url = Set(false, true).oneOf()
    nondet stored = Set(false, true).oneOf()
    nondet stale = Set(false, true).oneOf()
    nondet duration = Set(0, 2, 4).oneOf()
    nondet wall = Set(0, 1, 2).oneOf()
    any { initialRead(id), retry(id), replayEffect(id), reply(id, ready, url, stored, stale, duration), reject(id),
      flushTimerEffect, queueExpiry(id), expire(id), tick, wallClock(wall), editDraft,
      signedOut, signedIn, depart, remount, s' = s }
  }
  val invariant = all {
    s.now >= 0, s.now <= 6, s.life >= 1, s.life <= 2,
    s.stale implies s.staleFor == s.observation,
    s.rechecking implies s.phase == "checked",
    githubLink implies not(s.stale) and s.ready and s.url,
    s.phase == "checked" implies ids.contains(s.observation) and s.deadline == s.acceptedAt + s.duration,
    ids.forall(id => s.timers.get(id).phase == "armed" and id == s.observation
      implies s.timers.get(id).deadline == s.deadline)
  }

  run initialFailureHasRetryTest = init.then(initialRead(1)).then(reject(1))
    .expect(s.phase == "error" and retryVisible and not(localIntake) and not(githubLink))
  run independentStoredIntakeTest = init.then(initialRead(1)).then(reply(1, false, false, true, false, 2))
    .expect(form and not(githubLink))
  run githubWithoutStoredIntakeTest = init.then(initialRead(1)).then(reply(1, true, true, false, false, 2))
    .expect(githubLink and not(localIntake))
  run expiryHidesOnlyGithubLinkTest = init.then(initialRead(1)).then(reply(1, true, true, true, false, 2))
    .then(editDraft).then(flushTimerEffect).then(tick).then(tick).then(queueExpiry(1)).then(expire(1))
    .expect(not(githubLink) and renderedDraft and retryVisible)
  run recheckRetainsDraftAndStaleObservationTest = init.then(initialRead(1)).then(reply(1, true, true, true, true, 2))
    .then(editDraft).then(retry(2)).expect(s.rechecking and renderedDraft and not(githubLink))
  run failedRecheckRetainsStoredRouteTest = init.then(initialRead(1)).then(reply(1, true, true, true, true, 2))
    .then(editDraft).then(retry(2)).then(reject(2)).expect(s.stale and renderedDraft and not(githubLink))
  run successfulRecheckRestoresFreshLinkTest = init.then(initialRead(1)).then(reply(1, true, true, true, true, 2))
    .then(retry(2)).then(reply(2, true, true, true, false, 2)).expect(githubLink and not(s.rechecking))
  run serverStaleReadyCannotShowLinkTest = init.then(initialRead(1)).then(reply(1, true, true, true, true, 4))
    .expect(form and not(githubLink))
  run recheckDoesNotExtendOriginalDeadlineTest = init.then(initialRead(1)).then(reply(1, false, false, true, false, 2))
    .then(flushTimerEffect).then(tick).then(retry(2)).then(flushTimerEffect)
    .expect(s.deadline == 2 and s.timers.get(1).deadline == 2 and s.rechecking and invariant)
  run pendingRecheckStillExpiresOriginalAnswerTest = init.then(initialRead(1)).then(reply(1, false, false, true, false, 2))
    .then(editDraft).then(flushTimerEffect).then(tick).then(retry(2)).then(tick)
    .then(queueExpiry(1)).then(expire(1)).expect(s.rechecking and s.stale and renderedDraft)
  run queuedOldTimerCannotStaleNewAnswerTest = init.then(initialRead(1)).then(reply(1, false, false, true, false, 2))
    .then(flushTimerEffect).then(tick).then(retry(2)).then(tick).then(queueExpiry(1))
    .then(reply(2, true, true, true, false, 4)).then(expire(1))
    .expect(githubLink and s.observation == 2 and not(s.stale) and invariant)
  run newAnswerUsesItsOwnAcceptanceDeadlineTest = init.then(initialRead(1)).then(reply(1, false, false, true, false, 2))
    .then(tick).then(retry(2)).then(reply(2, true, true, true, false, 4)).then(flushTimerEffect)
    .expect(s.acceptedAt == 1 and s.deadline == 5 and s.timers.get(2).deadline == 5)
  run zeroAgeQueuesImmediateExpiryTest = init.then(initialRead(1)).then(reply(1, true, true, true, false, 0))
    .then(flushTimerEffect).then(queueExpiry(1)).then(expire(1)).expect(s.stale and not(githubLink) and form)
  run freshHealthyReplyHasNoRecheckButtonTest = init.then(initialRead(1)).then(reply(1, true, true, true, false, 2))
    .expect(not(retryVisible))
  run missingUrlCanRetryWithoutInventingLinkTest = init.then(initialRead(1)).then(reply(1, true, false, true, false, 2))
    .expect(retryVisible and not(githubLink))
  run signedOutStillGetsPublicGithubLinkTest = init.then(signedOut).then(initialRead(1)).then(reply(1, true, true, true, false, 2))
    .expect(localIntake and not(form) and githubLink)
  run wallClockJumpCannotChangeExpiryTest = init.then(initialRead(1)).then(reply(1, true, true, true, false, 2))
    .then(flushTimerEffect).then(wallClock(2)).then(wallClock(0))
    .expect(s.now == 0 and s.deadline == 2 and githubLink)
  run departedReadCannotPublishTest = init.then(initialRead(1)).then(depart)
    .then(reply(1, true, true, true, false, 2)).expect(s.phase == "checking" and not(githubLink) and s.observation == 0)
  run oldProjectReplyCannotReplaceRemountedProjectTest = init.then(initialRead(1)).then(depart).then(remount)
    .then(initialRead(2)).then(reply(2, false, false, true, false, 2))
    .then(reply(1, true, true, false, false, 4)).expect(s.project == 2 and s.observation == 2 and localIntake and not(githubLink))
  run departedTimerCannotStaleNewProjectTest = init.then(initialRead(1)).then(reply(1, false, false, true, false, 2))
    .then(flushTimerEffect).then(tick).then(tick).then(queueExpiry(1)).then(depart).then(remount)
    .then(initialRead(2)).then(reply(2, true, true, true, false, 4)).then(expire(1))
    .expect(githubLink and not(s.stale) and s.observation == 2)
  run newerFailureDoesNotBecomeInitialLoadingTest = init.then(initialRead(1)).then(reply(1, false, false, true, false, 2))
    .then(retry(2)).then(reject(2)).expect(s.phase == "checked" and s.stale and localIntake and retryVisible)
  run initialErrorCanRetryToStoredIntakeTest = init.then(initialRead(1)).then(reject(1)).then(retry(2))
    .then(reply(2, false, false, true, false, 4)).expect(form and s.phase == "checked")
  run unavailableStoredIntakeShowsNoFormTest = init.then(initialRead(1)).then(reply(1, false, false, false, false, 2))
    .expect(not(localIntake) and not(form) and retryVisible)
  run replayedEffectRejectsOldSuccessTest = init.then(initialRead(1)).then(replayEffect(2))
    .then(reply(2, false, false, true, false, 2)).then(reply(1, true, true, false, false, 4))
    .expect(s.observation == 2 and localIntake and not(githubLink))
  run replayedEffectRejectsOldFailureTest = init.then(initialRead(1)).then(replayEffect(2))
    .then(reply(2, true, true, true, false, 2)).then(reject(1)).expect(githubLink and not(s.stale))

  // Excluded old behavior: whole-state dependencies restarted the full TTL,
  // and a queued timer could stale a replacement observation.
  action oldRestartTimer = all { s.phase == "checked", not(s.stale), s.rechecking,
    s' = s.with("timers", s.timers.set(s.observation, { phase: "armed", deadline: s.now + s.duration })) }
  action oldExpire(id: int): bool = all { s.timers.get(id).phase == "queued", s.phase == "checked",
    s' = s.with("stale", true).with("staleFor", id)
      .with("timers", s.timers.set(id, s.timers.get(id).with("phase", "fired"))) }
  run oldRecheckExtendedFreshnessTest = init.then(initialRead(1)).then(reply(1, false, false, true, false, 2))
    .then(flushTimerEffect).then(tick).then(retry(2)).then(oldRestartTimer)
    .expect(s.timers.get(1).deadline == 3 and s.deadline == 2 and not(invariant))
  run oldTimerPoisonedNewReplyTest = init.then(initialRead(1)).then(reply(1, false, false, true, false, 2))
    .then(flushTimerEffect).then(tick).then(retry(2)).then(tick).then(queueExpiry(1))
    .then(reply(2, true, true, true, false, 4)).then(oldExpire(1))
    .expect(not(githubLink) and s.staleFor != s.observation and not(invariant))
}
