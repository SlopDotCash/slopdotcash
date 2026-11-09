// @source src/InboxEmail.tsx
// @source src/lib/use-action.ts
// @source src/lib/project-api.ts
// @evidence tests/e2e/email-link-action.spec.ts
// @evidence tests/e2e/email-preference-actor-binding.spec.ts
// Two links, two actors/checks/submissions, generations1..4. Token/schema,
// saved-action age and backend authority are predicates. The 30-minute check
// is restore-only; live submission has no local deadline. A fragment is
// scrubbed before optional storage. Opening a link changes no preferences.
// Initial verification binds storage, not the in-memory action.actor field.
// Unsubscribe is capability-only and performs neither actor check.
// Preflight use and POST dispatch are synchronous; server effect, response,
// body and postflight observation/use are separate. Session observations are
// not continuous authority; a verify POST binds its captured expected actor.
// Layout departure retires pending work before passive listener cleanup;
// capture/session callbacks then do nothing. Used tokens may remain in storage
// if removal fails, while this page displays success. Another departed view
// may retain a different token; no cross-view storage CAS is claimed.
// The inner catch publishes its error synchronously under the generation
// guard and does not rethrow into useAction. The shared hook's busy release
// remains unscoped. The old rethrow path is a historical negative control
// outside step. Existing browser definitions are partial evidence, unexecuted.
// Exhaustive verification explores a reduced `step`; the comment above it
// states each reduction argument. Direct actions and scenarios are unreduced.
module ui_email_actions {
  val ids = Set(1, 2)
  val kinds = Set("verify", "unsubscribe")
  type Check = { phase: str, generation: int, link: int, bound: int, observed: int, available: bool }
  type Request = { phase: str, attempt: int, generation: int, link: int, kind: str,
    actor: int, observed: int, available: bool, cookie: int, accepted: bool, cause: str }
  val emptyCheck: Check = { phase: "unused", generation: 1, link: 0, bound: 0, observed: 0, available: false }
  val emptyRequest: Request = { phase: "idle", attempt: 0, generation: 1, link: 0, kind: "verify",
    actor: 0, observed: 0, available: false, cookie: 0, accepted: false, cause: "none" }
  type State = { loaded: bool, present: bool, generation: int, captures: int,
    link: int, kind: str, tokenValid: bool, actionActor: int, actor: int, session: int,
    stored: int, storedActor: int, scrubbed: bool, done: bool, doneLink: int,
    error: str, errorGeneration: int, busy: bool, activeCheck: int, checks: int -> Check,
    request: Request, effects: Set[int] }
  var s: State
  action init = s' = { loaded: false, present: true, generation: 1, captures: 0,
    link: 0, kind: "verify", tokenValid: false, actionActor: 0, actor: -1, session: 1,
    stored: 0, storedActor: 0, scrubbed: false, done: false, doneLink: 0,
    error: "none", errorGeneration: 0, busy: false, activeCheck: 0, checks: ids.mapBy(_ => emptyCheck),
    request: emptyRequest, effects: Set() }
  // Step-only compaction (see the step comment). Direct actions pass false.
  pure def compactIf(compact: bool, st: State): State = if (not(compact)) st
    else st.with("stored", 0).with("storedActor", 0)
      .with("checks", ids.mapBy(id => {
        val c = st.checks.get(id)
        if (c.phase == "unused" or (c.phase != "done" and st.present and st.activeCheck == id
          and c.generation == st.generation)) c
        else emptyCheck.with("phase", "done").with("generation", c.generation)
      }))
      .with("request", {
        val r = st.request
        val owned = st.present and r.generation == st.generation
        if (Set("done", "finally").contains(r.phase)) emptyRequest.with("phase", r.phase).with("attempt", r.attempt)
        else if (not(owned) and not(Set("idle", "http").contains(r.phase)))
          emptyRequest.with("phase", "finally").with("attempt", r.attempt)
        else if (r.phase == "http") r.with("observed", 0).with("available", false)
        else r
      })
  def ownsRequest: bool = s.present and s.request.generation == s.generation
  def rejected(cause: str): State = s.with("request", s.request.with("phase", "catch").with("cause", cause))
  def successful(storageWorks: bool): State = s.with("done", true).with("doneLink", s.request.link)
    .with("stored", if (storageWorks) 0 else s.stored).with("storedActor", if (storageWorks) 0 else s.storedActor)
    .with("request", s.request.with("phase", "finally"))
  action capture(kind: str, valid: bool, storageWorks: bool): bool = captureAs(kind, valid, storageWorks, false)
  action captureAs(kind: str, valid: bool, storageWorks: bool, compact: bool): bool = {
    val id = s.captures + 1
    all { s.present, s.captures < 2, s.generation < 4, kinds.contains(kind),
      s' = compactIf(compact, s.with("loaded", true).with("captures", id).with("link", id).with("kind", kind).with("tokenValid", valid)
        .with("generation", if (s.loaded) s.generation + 1 else s.generation)
        .with("actionActor", 0).with("actor", -1).with("done", false).with("doneLink", 0).with("error", "none")
        .with("scrubbed", true).with("stored", if (storageWorks) id else s.stored)
        .with("storedActor", if (storageWorks) 0 else s.storedActor)) }
  }
  action restore(kind: str, valid: bool, bound: int, recoverable: bool, removalWorks: bool): bool = restoreAs(kind, valid, bound, recoverable, removalWorks, false)
  action restoreAs(kind: str, valid: bool, bound: int, recoverable: bool, removalWorks: bool, compact: bool): bool = all {
    s.present, not(s.loaded), kinds.contains(kind), Set(0, 1, 2).contains(bound),
    s' = compactIf(compact, s.with("loaded", true).with("captures", 1).with("kind", kind)
      .with("link", if (recoverable) 1 else 0).with("tokenValid", recoverable and valid)
      .with("actionActor", if (recoverable) bound else 0)
      .with("stored", if (recoverable or not(removalWorks)) 1 else 0)
      .with("storedActor", if (recoverable or not(removalWorks)) bound else 0)) }
  action startCheck(id: int): bool = startCheckAs(id, false)
  action startCheckAs(id: int, compact: bool): bool = all { ids.contains(id), s.present, s.loaded, s.link > 0, s.tokenValid, s.kind == "verify",
    s.checks.get(id).phase == "unused",
    ids.forall(prior => s.checks.get(prior).phase == "unused" or s.checks.get(prior).generation != s.generation)
      or (s.actor == -1 and s.error != "none" and s.errorGeneration == s.generation),
    s' = compactIf(compact, s.with("activeCheck", id).with("actor", -1).with("error", "none")
      .with("checks", s.checks.set(id, emptyCheck.with("phase", "waiting").with("generation", s.generation)
        .with("link", s.link).with("bound", s.actionActor)))) }
  action observeCheck(id: int, available: bool): bool = all { ids.contains(id), s.checks.get(id).phase == "waiting",
    s' = s.with("checks", s.checks.set(id, s.checks.get(id).with("phase", "observed")
      .with("observed", s.session).with("available", available))) }
  action useCheck(id: int, storageWorks: bool): bool = useCheckAs(id, storageWorks, false)
  action useCheckAs(id: int, storageWorks: bool, compact: bool): bool = {
    val check = s.checks.get(id)
    val owned = s.present and s.activeCheck == id and check.generation == s.generation
    val finished = s.with("checks", s.checks.set(id, check.with("phase", "done")))
    all { ids.contains(id), check.phase == "observed",
      s' = compactIf(compact, if (not(owned)) finished
        else if (not(check.available)) finished.with("error", "account-unavailable").with("errorGeneration", s.generation)
        else if (check.observed != 0 and check.bound != 0 and check.observed != check.bound)
          finished.with("error", "account-changed").with("errorGeneration", s.generation)
        else finished.with("actor", check.observed)
          .with("stored", if (storageWorks and check.observed > 0) check.link else s.stored)
          .with("storedActor", if (storageWorks and check.observed > 0) check.observed else s.storedActor)) }
  }
  action sessionChanges(actor: int): bool = all { Set(0, 1, 2).contains(actor), s' = s.with("session", actor) }
  action sessionEvent = sessionEventAs(false)
  action sessionEventAs(compact: bool): bool = all { s.present, s.kind == "verify", s.link > 0, s.generation < 4,
    s' = compactIf(compact, s.with("generation", s.generation + 1).with("actor", 0).with("done", false).with("doneLink", 0).with("error", "none")) }
  action submit = all { s.present, s.link > 0, s.tokenValid, not(s.done), not(s.busy), s.request.attempt < 2,
    Set("idle", "done").contains(s.request.phase), s.kind == "unsubscribe" or s.actor > 0,
    s' = s.with("busy", true).with("error", "none")
      .with("request", emptyRequest.with("attempt", s.request.attempt + 1).with("generation", s.generation)
        .with("link", s.link).with("kind", s.kind).with("actor", s.actor)
        .with("phase", if (s.kind == "verify") "preflight" else "http")
        .with("cookie", if (s.kind == "unsubscribe") s.session else 0)) }
  action observePreflight(available: bool): bool = all { s.request.phase == "preflight",
    s' = s.with("request", s.request.with("phase", "preflight-observed").with("observed", s.session).with("available", available)) }
  action usePreflight = usePreflightAs(false)
  action usePreflightAs(compact: bool): bool = all { s.request.phase == "preflight-observed",
    s' = compactIf(compact, if (not(ownsRequest)) s.with("request", s.request.with("phase", "finally"))
      else if (not(s.request.available)) rejected("account-unavailable")
      else if (s.request.observed == 0 or s.request.observed != s.request.actor) rejected("account-changed")
      else s.with("request", s.request.with("phase", "http").with("cookie", s.session))) }
  action serverEffect(accepted: bool): bool = serverEffectAs(accepted, false)
  action serverEffectAs(accepted: bool, compact: bool): bool = {
    val authorized = s.request.kind == "unsubscribe" or (s.request.cookie > 0 and s.request.cookie == s.request.actor)
    all { s.request.phase == "http", not(accepted) or authorized,
      s' = compactIf(compact, s.with("effects", if (accepted) s.effects.union(Set(s.request.link)) else s.effects)
        .with("request", s.request.with("phase", "http-reply").with("accepted", accepted))) }
  }
  action response(received: bool): bool = responseAs(received, false)
  action responseAs(received: bool, compact: bool): bool = all { s.request.phase == "http-reply",
    s' = compactIf(compact, if (not(ownsRequest)) s.with("request", s.request.with("phase", "finally"))
      else if (not(received)) rejected("request-unavailable")
      else if (not(s.request.accepted)) rejected("request-refused")
      else s.with("request", s.request.with("phase", "body"))) }
  action body(valid: bool, storageWorks: bool): bool = bodyAs(valid, storageWorks, false)
  action bodyAs(valid: bool, storageWorks: bool, compact: bool): bool = all { s.request.phase == "body",
    s' = compactIf(compact, if (not(ownsRequest)) s.with("request", s.request.with("phase", "finally"))
      else if (not(valid)) rejected("invalid-response")
      else if (s.request.kind == "verify") s.with("request", s.request.with("phase", "postflight"))
      else successful(storageWorks)) }
  action observePostflight(available: bool): bool = all { s.request.phase == "postflight",
    s' = s.with("request", s.request.with("phase", "postflight-observed").with("observed", s.session).with("available", available)) }
  action usePostflight(storageWorks: bool): bool = usePostflightAs(storageWorks, false)
  action usePostflightAs(storageWorks: bool, compact: bool): bool = all { s.request.phase == "postflight-observed",
    s' = compactIf(compact, if (not(ownsRequest)) s.with("request", s.request.with("phase", "finally"))
      else if (not(s.request.available)) rejected("account-unavailable")
      else if (s.request.observed == 0 or s.request.observed != s.request.actor) rejected("account-changed")
      else successful(storageWorks)) }
  action handleCaught = handleCaughtAs(false)
  action handleCaughtAs(compact: bool): bool = all { s.request.phase == "catch",
    s' = compactIf(compact, s.with("error", if (ownsRequest) s.request.cause else s.error)
      .with("errorGeneration", if (ownsRequest) s.request.generation else s.errorGeneration)
      .with("request", s.request.with("phase", "finally"))) }
  action releaseBusy = releaseBusyAs(false)
  action releaseBusyAs(compact: bool): bool = all { s.request.phase == "finally",
    s' = compactIf(compact, s.with("busy", false).with("request", s.request.with("phase", "done"))) }
  action discard(storageWorks: bool): bool = discardAs(storageWorks, false)
  action discardAs(storageWorks: bool, compact: bool): bool = all { s.present, s.link > 0, not(s.busy), s.generation < 4,
    s' = compactIf(compact, s.with("generation", s.generation + 1).with("link", 0).with("tokenValid", false)
      .with("stored", if (storageWorks) 0 else s.stored).with("storedActor", if (storageWorks) 0 else s.storedActor)) }
  action depart = departAs(false)
  action departAs(compact: bool): bool = all { s.present, s.generation < 4, s' = compactIf(compact, s.with("present", false).with("generation", s.generation + 1)) }
  action retainFromOtherView = all { not(s.present), s' = s.with("stored", 2).with("storedActor", 0) }
  // Each nondeterministic choice is scoped to the one action that reads it
  // (formal/README.md, "Scoped nondeterministic choices"). The disjunction of
  // per-action existentials equals the former single existential over every
  // choice, so successors and enabledness are unchanged.
  // Step-only compaction (formal/README.md, "Retired requests" and
  // "Write-only fields and canonical choices"); direct actions and scenarios keep every field:
  // - `stored` and `storedActor` are read only by their own updates and by
  //   the invariant's range conjuncts, which every assignment satisfies
  //   (links 1..2, actors 0..2, the other view's 2, or 0). Step stores 0 for
  //   both, so retainFromOtherView, which changes only them, leaves step.
  // - A check stops being owned for good: `present` never returns, the
  //   generation only grows and `activeCheck` names only a newly started
  //   unused id. A check that is not owned or has finished changes only its
  //   own fields, and other actions read it only through its phase being
  //   unused and its generation. Step keeps those and stores defaults for the
  //   rest.
  // - A request in "finally" or "done" is read only through its phase and
  //   attempt count; releaseBusy changes only its phase and `busy`, and the
  //   invariant already checked its frozen fields. Step stores defaults for
  //   the rest. A request stops being owned for good (the generation only
  //   grows and `present` never returns); unowned, every phase except "http"
  //   can only reach "finally" without changing anything else, so step moves
  //   it there directly. Its observed actor and availability are read only by
  //   the preflight and postflight uses, and the postflight observation
  //   overwrites them, so step clears them in "http".
  action step = any {
    { nondet kind = kinds.oneOf() nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf() captureAs(kind, a, b, true) },
    { nondet kind = kinds.oneOf() nondet actor = Set(0, 1, 2).oneOf() nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf() nondet c = Set(false, true).oneOf() restoreAs(kind, a, actor, b, c, true) },
    { nondet id = ids.oneOf() startCheckAs(id, true) },
    { nondet id = ids.oneOf() nondet a = Set(false, true).oneOf() observeCheck(id, a) },
    { nondet id = ids.oneOf() nondet a = Set(false, true).oneOf() useCheckAs(id, a, true) },
    { nondet actor = Set(0, 1, 2).oneOf() sessionChanges(actor) }, sessionEventAs(true), submit,
    { nondet a = Set(false, true).oneOf() observePreflight(a) }, usePreflightAs(true),
    { nondet a = Set(false, true).oneOf() serverEffectAs(a, true) },
    { nondet a = Set(false, true).oneOf() responseAs(a, true) },
    { nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf() bodyAs(a, b, true) },
    { nondet a = Set(false, true).oneOf() observePostflight(a) },
    { nondet a = Set(false, true).oneOf() usePostflightAs(a, true) }, handleCaughtAs(true), releaseBusyAs(true),
    { nondet a = Set(false, true).oneOf() discardAs(a, true) }, departAs(true), s' = s }
  val invariant = all { s.generation >= 1 and s.generation <= 4, s.captures <= 2, s.request.attempt <= 2,
    s.stored >= 0 and s.stored <= 2, s.storedActor >= 0 and s.storedActor <= 2, s.effects.subseteq(Set(1, 2)),
    s.done and s.link > 0 implies s.doneLink == s.link and s.effects.contains(s.doneLink),
    s.present and s.link > 0 and s.error != "none" implies s.errorGeneration == s.generation,
    s.request.phase == "done" implies not(s.busy),
    s.request.accepted and s.request.kind == "verify" implies s.request.cookie == s.request.actor and s.request.actor > 0 }
  action identified = capture("verify", true, true).then(startCheck(1)).then(observeCheck(1, true)).then(useCheck(1, true))
  action dispatched = submit.then(observePreflight(true)).then(usePreflight)
  action verifiedBody = serverEffect(true).then(response(true)).then(body(true, true))
  action errorFinished = handleCaught.then(releaseBusy)
  action completed(storageWorks: bool): bool = verifiedBody.then(observePostflight(true)).then(usePostflight(storageWorks)).then(releaseBusy)
  run capturedFragmentIsScrubbedWithoutSubmittingTest = init.then(capture("verify", true, true)).expect(s.scrubbed and s.stored == 1 and s.effects == Set() and invariant)
  run failedInitialStorageStillAllowsCurrentLinkTest = init.then(capture("unsubscribe", true, false)).then(submit).then(serverEffect(true)).then(response(true)).then(body(true, true)).then(releaseBusy).expect(s.done and invariant)
  run invalidTokenCannotSubmitTest = init.then(capture("verify", false, true)).then(submit.fail())
  run expiredStoredLinkIsNotActionableTest = init.then(restore("verify", true, 1, false, true)).expect(s.link == 0 and s.stored == 0 and invariant)
  run failedInvalidStoredRemovalRemainsNonActionableTest = init.then(restore("verify", true, 1, false, false)).expect(s.stored == 1 and invariant).then(submit.fail())
  run initialAccountCheckBindsStorageOnlyTest = init.then(identified).expect(s.actor == 1 and s.actionActor == 0 and s.storedActor == 1 and invariant)
  run initialBindingFailureKeepsPageUsableTest = init.then(capture("verify", true, true)).then(startCheck(1)).then(observeCheck(1, true)).then(useCheck(1, false)).expect(s.actor == 1 and s.storedActor == 0 and invariant)
  run restoredDifferentActorRefusesInitialCheckTest = init.then(restore("verify", true, 2, true, true)).then(startCheck(1)).then(observeCheck(1, true)).then(useCheck(1, true)).expect(s.actor == -1 and s.error == "account-changed" and invariant)
  run initialAccountCheckCanRetryTest = init.then(capture("verify", true, true)).then(startCheck(1)).then(observeCheck(1, false)).then(useCheck(1, true)).then(startCheck(2)).then(observeCheck(2, true)).then(useCheck(2, true)).expect(s.actor == 1 and s.error == "none" and invariant)
  run departedInitialCheckCannotOverwriteStoredReplacementTest = init.then(capture("verify", true, true)).then(startCheck(1)).then(observeCheck(1, true)).then(depart).then(retainFromOtherView).then(useCheck(1, true)).expect(s.stored == 2 and s.storedActor == 0 and invariant)
  run replacementRetiresInitialAccountCheckTest = init.then(capture("verify", true, true)).then(startCheck(1)).then(observeCheck(1, true)).then(capture("unsubscribe", true, true)).then(useCheck(1, true)).expect(s.link == 2 and s.stored == 2 and s.actor == -1 and invariant)
  run currentVerificationCompletesTest = init.then(identified).then(dispatched).then(completed(true)).expect(s.done and not(s.busy) and s.stored == 0 and invariant)
  run failedSuccessRemovalMayRetainUsedTokenTest = init.then(identified).then(dispatched).then(completed(false)).expect(s.done and s.stored == 1 and not(s.busy) and invariant)
  run unsubscribeNeedsNoSessionTest = init.then(sessionChanges(0)).then(capture("unsubscribe", true, true)).then(submit).then(serverEffect(true)).then(response(true)).then(body(true, true)).then(releaseBusy).expect(s.done and invariant)
  run changedPreflightActorStartsNoPostTest = init.then(identified).then(submit).then(sessionChanges(2)).then(observePreflight(true)).then(usePreflight).then(errorFinished).expect(s.error == "account-changed" and s.effects == Set() and invariant)
  run decodedPreflightCannotPostAfterDepartureTest = init.then(identified).then(submit).then(observePreflight(true)).then(depart).then(usePreflight).then(releaseBusy).expect(s.effects == Set() and invariant)
  run changedCookieFailsExpectedActorAdmissionTest = init.then(identified).then(submit).then(observePreflight(true)).then(sessionChanges(2)).then(usePreflight).then(serverEffect(false)).then(response(true)).then(errorFinished).expect(s.request.cookie == 2 and s.effects == Set() and invariant)
  run acceptedEffectSurvivesDepartureTest = init.then(identified).then(dispatched).then(depart).then(serverEffect(true)).then(response(true)).then(releaseBusy).expect(s.effects == Set(1) and not(s.done) and s.stored == 1 and invariant)
  run oldResponseCannotConfirmReplacementTest = init.then(identified).then(dispatched).then(capture("unsubscribe", true, true)).then(serverEffect(true)).then(response(true)).then(releaseBusy).expect(s.stored == 2 and not(s.done) and invariant)
  run replacementBeforeInnerCatchSuppressesOldErrorTest = init.then(identified).then(dispatched).then(serverEffect(false)).then(response(true)).then(capture("unsubscribe", true, true)).then(handleCaught).then(releaseBusy).expect(s.error == "none" and s.stored == 2 and invariant)
  run errorPublishedBeforeReplacementIsClearedByNewLinkTest = init.then(identified).then(dispatched).then(serverEffect(false)).then(response(true)).then(handleCaught).then(capture("unsubscribe", true, true)).then(releaseBusy).expect(s.error == "none" and s.stored == 2 and invariant)
  run oldFinallyReleasesSharedBusyForNewLinkTest = init.then(identified).then(dispatched).then(capture("unsubscribe", true, true)).expect(s.busy).then(serverEffect(true)).then(response(true)).then(releaseBusy).then(submit).expect(s.request.link == 2 and s.busy and invariant)
  run newLinkCompletesTest = init.then(identified).then(dispatched).then(capture("unsubscribe", true, true)).then(serverEffect(true)).then(response(true)).then(releaseBusy).then(submit).then(serverEffect(true)).then(response(true)).then(body(true, true)).then(releaseBusy).expect(s.done and s.doneLink == 2 and s.effects == Set(1, 2) and s.stored == 0 and invariant)
  run replacementAfterHeadersSkipsOldBodyTest = init.then(identified).then(dispatched).then(serverEffect(true)).then(response(true)).then(capture("unsubscribe", true, true)).then(body(true, true)).then(releaseBusy).expect(s.stored == 2 and not(s.done) and invariant)
  run malformedBodyLeavesLinkRetryableTest = init.then(identified).then(dispatched).then(serverEffect(true)).then(response(true)).then(body(false, true)).then(errorFinished).expect(s.effects == Set(1) and not(s.done) and s.stored == 1 and invariant)
  run changedPostflightActorRefusesLocalSuccessTest = init.then(identified).then(dispatched).then(verifiedBody).then(sessionChanges(2)).then(observePostflight(true)).then(usePostflight(true)).then(errorFinished).expect(s.effects == Set(1) and not(s.done) and invariant)
  run postflightSnapshotIsNotContinuousAuthorityTest = init.then(identified).then(dispatched).then(verifiedBody).then(observePostflight(true)).then(sessionChanges(2)).then(usePostflight(true)).then(releaseBusy).expect(s.done and s.session == 2 and invariant)
  run signOutRetiresPostflightAndRetainsLinkTest = init.then(identified).then(dispatched).then(verifiedBody).then(observePostflight(true)).then(sessionChanges(0)).then(sessionEvent).then(usePostflight(true)).then(releaseBusy).expect(s.actor == 0 and s.stored == 1 and not(s.done) and invariant)
  run unsubscribeIgnoresSessionEventTest = init.then(capture("unsubscribe", true, true)).then(submit).then(sessionChanges(0)).then(serverEffect(true)).then(response(true)).then(body(true, true)).then(releaseBusy).expect(s.done and invariant)
  run departedCaptureHasNoSideEffectsTest = init.then(capture("verify", true, true)).then(depart).then(retainFromOtherView).expect(s.stored == 2 and s.captures == 1 and invariant).then(capture("unsubscribe", true, true).fail())
  run departedSessionListenerHasNoSideEffectsTest = init.then(identified).then(depart).expect(s.actor == 1 and s.storedActor == 1 and invariant).then(sessionEvent.fail())
  run dismissRemovesCurrentActionTest = init.then(capture("unsubscribe", true, true)).then(discard(true)).expect(s.link == 0 and s.stored == 0 and invariant)
  run failedDismissLeavesNoLocalActionTest = init.then(capture("unsubscribe", true, true)).then(discard(false)).expect(s.link == 0 and s.stored == 1 and invariant).then(submit.fail())
  run busyReplacementRefusesSubmitTest = init.then(identified).then(dispatched)
    .then(capture("unsubscribe", true, true)).then(submit.fail())
  run unsubscribeSessionEventIsDisabledTest = init.then(capture("unsubscribe", true, true))
    .then(submit).then(sessionChanges(0)).then(sessionEvent.fail())
  // The historical nested rejection crossed another await before useAction
  // published its error. These actions are intentionally absent from step.
  action historicalRethrow = all { s.request.phase == "catch", ownsRequest,
    s' = s.with("request", s.request.with("phase", "hook-catch")) }
  action historicalHookError = all { s.request.phase == "hook-catch",
    s' = s.with("error", s.request.cause).with("errorGeneration", s.request.generation)
      .with("request", s.request.with("phase", "finally")) }
  run historicalRethrowCanPublishAfterReplacementTest = init.then(identified).then(dispatched).then(serverEffect(false)).then(response(true)).then(historicalRethrow).then(capture("unsubscribe", true, true)).then(historicalHookError).then(releaseBusy)
    .expect(s.errorGeneration < s.generation and s.error == "request-refused" and not(invariant))
}
