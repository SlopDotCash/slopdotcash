// @source src/AdminVetting.tsx
// @source src/lib/admin-request.ts
// @source src/Admin.tsx
// @source backend/vetting/handler.ts
// @evidence tests/e2e/admin-vetting-request-ownership.spec.ts
// @evidence tests/e2e/admin-editor-lifetime.spec.ts
// Two read slots, two actor identities, two parent lifetimes, one mutation.
// The read ownership applies to VettingSection and ActivationClearance alike;
// clearance's layout generation fence retires a passive load without moving
// its network start or status publication into the layout phase.
// Committed layout cleanup retires the parent and its child mutation. Each
// identity observation, helper return and caller use is a separate transition.
// Admin role and cookie identity can change independently; server admission
// remains an external authority decision, not a promise made by a prior read.
// Source-authored; no parser, simulation, or verifier execution is claimed.
module ui_admin_vetting_requests {
  type Read = { life: int, generation: int, actor: int, cookie: int,
    phase: str, failure: str, observed: int, observedAdmin: bool, gate: str }
  type Mutation = { life: int, ownerRead: int, actor: int, cookie: int,
    phase: str, failure: str, payload: int, observed: int, observedAdmin: bool, gate: str }
  pure val ids = Set(1, 2)
  pure val emptyRead = { life: 0, generation: 0, actor: 0, cookie: 0,
    phase: "unused", failure: "", observed: 0, observedAdmin: false, gate: "none" }
  pure val emptyMutation = { life: 0, ownerRead: 0, actor: 0, cookie: 0,
    phase: "unused", failure: "", payload: 0, observed: 0, observedAdmin: false, gate: "none" }
  var s: { present: bool, mounted: bool, life: int, actor: int, cookie: int, admin: bool,
    identityAvailable: bool, generation: int, activeRead: int,
    reads: int -> Read, mutation: Mutation, privateRead: int,
    formPayload: int, note: bool, error: bool, invalidated: bool,
    accepted: bool, callbacks: int, refreshes: int }

  action init = s' = { present: true, mounted: true, life: 1, actor: 1, cookie: 1, admin: true,
    identityAvailable: true, generation: 0, activeRead: 0,
    reads: ids.mapBy(_ => emptyRead), mutation: emptyMutation,
    privateRead: 0, formPayload: 1, note: false, error: false,
    invalidated: false, accepted: false, callbacks: 0, refreshes: 0 }

  def ownsRead(id: int): bool = s.mounted and not(s.invalidated)
    and s.activeRead == id and s.reads.get(id).life == s.life
    and s.reads.get(id).generation == s.generation
    and s.reads.get(id).actor == s.actor
  // Loading a parent read removes the child form; matching only the parent
  // lifetime is insufficient to keep a former child mutation alive.
  val ownsMutation = s.mounted and not(s.invalidated)
    and s.mutation.life == s.life and s.mutation.actor == s.actor
    and s.privateRead != 0 and s.mutation.ownerRead == s.privateRead
  val visible = s.mounted and not(s.invalidated) and s.privateRead != 0
  // Cookie changes do not rewrite any in-flight request's cookie snapshot.
  action cookieChanges(actor: int): bool = all {
    Set(0, 1, 2).contains(actor), s' = s.with("cookie", actor) }
  action identityAvailability(available: bool): bool =
    s' = s.with("identityAvailable", available)
  action adminRole(allowed: bool): bool = s' = s.with("admin", allowed)
  action editPayload(payload: int): bool = all {
    visible, ids.contains(payload), s' = s.with("formPayload", payload) }
  action depart = all { s.mounted,
    s' = s.with("present", false).with("mounted", false).with("privateRead", 0)
      .with("note", false).with("activeRead", 0) }
  // An outer session revalidation tears down the old keyed subtree. A later
  // observed actor may mount a fresh one; old requests retain their life IDs.
  action remount = all { not(s.mounted), s.life == 1,
    s.identityAvailable, ids.contains(s.cookie),
    s' = s.with("present", true).with("mounted", true).with("life", 2).with("actor", s.cookie)
      .with("invalidated", false).with("error", false).with("note", false)
      .with("activeRead", 0).with("privateRead", 0) }

  action beginRead(id: int): bool = all {
    s.mounted, not(s.invalidated), s.reads.get(id).phase == "unused",
    s' = s.with("generation", s.generation + 1).with("activeRead", id)
      .with("privateRead", 0).with("error", false)
      .with("reads", s.reads.set(id, { life: s.life,
        generation: s.generation + 1, actor: s.actor, cookie: 0,
        phase: "preflight", failure: "", observed: 0, observedAdmin: false, gate: "none" })) }
  action observeReadIdentity(id: int): bool = all {
    Set("preflight", "postflight", "failure").contains(s.reads.get(id).phase),
    s' = s.with("reads", s.reads.set(id, s.reads.get(id)
      .with("gate", s.reads.get(id).phase).with("phase", "identity-observed")
      .with("observed", if (s.identityAvailable) s.cookie else 0)
      .with("observedAdmin", s.identityAvailable and s.admin))) }
  action returnReadIdentity(id: int): bool = all { s.reads.get(id).phase == "identity-observed",
    s' = s.with("reads", s.reads.set(id, s.reads.get(id).with("phase", "identity-returned"))) }
  action useReadIdentity(id: int): bool = {
    val r = s.reads.get(id)
    val completed = s.with("reads", s.reads.set(id, r.with("phase", "done")))
    all { r.phase == "identity-returned",
      s' = if (not(ownsRead(id))) completed
        else if (r.failure == "access" or r.observed != r.actor or not(r.observedAdmin))
          completed.with("invalidated", true).with("privateRead", 0).with("note", false).with("error", true)
        else if (r.gate == "preflight") s.with("reads", s.reads.set(id, r.with("phase", "checked")))
        else if (r.gate == "postflight") completed.with("privateRead", id).with("error", false)
        else completed.with("error", true) }
  }
  // Scenario conveniences are excluded from step; exploration sees the gaps.
  action readPreflight(id: int): bool = observeReadIdentity(id).then(returnReadIdentity(id)).then(useReadIdentity(id))
  action dispatchRead(id: int): bool = all {
    ownsRead(id), s.reads.get(id).phase == "checked",
    s' = s.with("reads", s.reads.set(id,
      s.reads.get(id).with("phase", "http").with("cookie", s.cookie))) }
  // allow is the external server's current authorization/availability decision.
  action readResponse(id: int, allow: bool): bool = all {
    s.reads.get(id).phase == "http",
    s' = s.with("reads", s.reads.set(id,
      s.reads.get(id)
        .with("phase", if (allow and s.reads.get(id).cookie == s.reads.get(id).actor)
          "postflight" else "failure")
        .with("failure", if (allow and s.reads.get(id).cookie == s.reads.get(id).actor)
          "" else "access"))) }
  action readTemporaryFailure(id: int): bool = all {
    s.reads.get(id).phase == "http",
    s' = s.with("reads", s.reads.set(id,
      s.reads.get(id).with("phase", "failure").with("failure", "local"))) }
  action publishRead(id: int): bool = observeReadIdentity(id).then(returnReadIdentity(id)).then(useReadIdentity(id))
  action readAccessLost(id: int): bool = observeReadIdentity(id).then(returnReadIdentity(id)).then(useReadIdentity(id))
  action readLocalError(id: int): bool = observeReadIdentity(id).then(returnReadIdentity(id)).then(useReadIdentity(id))
  action dropRead(id: int): bool = all {
    not(ownsRead(id)),
    not(Set("unused", "done").contains(s.reads.get(id).phase)),
    s' = s.with("reads", s.reads.set(id, s.reads.get(id).with("phase", "done"))) }

  // This one mutation abstracts queue, grant and revoke: their bodies differ,
  // but each captures its selected revision/reason/reference before awaiting.
  action beginMutation = all { visible, s.mutation.phase == "unused",
    s' = s.with("error", false).with("mutation", { life: s.life,
      ownerRead: s.privateRead, actor: s.actor, cookie: 0,
      phase: "preflight", failure: "", payload: s.formPayload, observed: 0, observedAdmin: false, gate: "none" }) }
  action observeMutationIdentity = all {
    Set("preflight", "postflight", "failure").contains(s.mutation.phase),
    s' = s.with("mutation", s.mutation.with("gate", s.mutation.phase).with("phase", "identity-observed")
      .with("observed", if (s.identityAvailable) s.cookie else 0)
      .with("observedAdmin", s.identityAvailable and s.admin)) }
  action returnMutationIdentity = all { s.mutation.phase == "identity-observed",
    s' = s.with("mutation", s.mutation.with("phase", "identity-returned")) }
  action useMutationIdentity = {
    val m = s.mutation
    val completed = s.with("mutation", m.with("phase", "done"))
    all { m.phase == "identity-returned",
      s' = if (not(ownsMutation)) completed
        else if (m.failure == "access" or m.observed != m.actor or not(m.observedAdmin))
          completed.with("invalidated", true).with("privateRead", 0).with("note", false).with("error", true)
        else if (m.gate == "preflight") s.with("mutation", m.with("phase", "checked"))
        else if (m.gate == "postflight") s.with("mutation", m.with("phase", "callback-ready"))
        else completed.with("error", true) }
  }
  action mutationPreflight = observeMutationIdentity.then(returnMutationIdentity).then(useMutationIdentity)
  action dispatchMutation = all { ownsMutation, s.mutation.phase == "checked",
    s' = s.with("mutation", s.mutation.with("phase", "http").with("cookie", s.cookie)) }
  action admitMutation(allow: bool): bool = all { s.mutation.phase == "http",
    s' = s.with("accepted", allow and s.mutation.cookie == s.mutation.actor)
      .with("mutation", s.mutation
        .with("phase", if (allow and s.mutation.cookie == s.mutation.actor)
          "postflight" else "failure")
        .with("failure", if (allow and s.mutation.cookie == s.mutation.actor)
          "" else "access")) }
  action mutationTemporaryFailure = all { s.mutation.phase == "http",
    s' = s.with("mutation", s.mutation.with("phase", "failure").with("failure", "local")) }
  action mutationAccessLost = observeMutationIdentity.then(returnMutationIdentity).then(useMutationIdentity)
  action mutationLocalError = observeMutationIdentity.then(returnMutationIdentity).then(useMutationIdentity)
  // A successful current callback synchronously starts the parent's next read.
  // Its preflight is still separate and must re-observe the actor before GET.
  action invokeMutationCallback(id: int): bool = all {
    ownsMutation, s.mutation.phase == "callback-ready", s.accepted,
    s.reads.get(id).phase == "unused",
    s' = s.with("mutation", s.mutation.with("phase", "done"))
      .with("callbacks", s.callbacks + 1).with("refreshes", s.refreshes + 1)
      .with("note", true).with("privateRead", 0).with("error", false)
      .with("generation", s.generation + 1).with("activeRead", id)
      .with("reads", s.reads.set(id, { life: s.life,
        generation: s.generation + 1, actor: s.actor, cookie: 0,
        phase: "preflight", failure: "", observed: 0, observedAdmin: false, gate: "none" })) }
  action finishMutation(id: int): bool = observeMutationIdentity.then(returnMutationIdentity)
    .then(useMutationIdentity).then(invokeMutationCallback(id))
  action dropMutation = all { not(ownsMutation),
    not(Set("unused", "done", "http").contains(s.mutation.phase)),
    s' = s.with("mutation", s.mutation.with("phase", "done")) }

  action step = {
    nondet id = ids.oneOf()
    nondet actor = Set(0, 1, 2).oneOf()
    nondet flag = Set(false, true).oneOf()
    any { cookieChanges(actor), identityAvailability(flag), adminRole(flag), editPayload(id),
      depart, remount, beginRead(id), observeReadIdentity(id), returnReadIdentity(id), useReadIdentity(id), dispatchRead(id),
      readResponse(id, flag), readTemporaryFailure(id), dropRead(id), beginMutation,
      observeMutationIdentity, returnMutationIdentity, useMutationIdentity, dispatchMutation, admitMutation(flag), mutationTemporaryFailure,
      invokeMutationCallback(id), dropMutation, s' = s }
  }
  val invariant = all {
    not(s.present) implies not(s.mounted),
    s.callbacks <= 1, s.refreshes == s.callbacks,
    s.callbacks > 0 implies s.accepted,
    s.accepted implies s.mutation.cookie == s.mutation.actor,
    s.invalidated implies s.privateRead == 0 and not(s.note),
    if (visible) all {
      s.reads.get(s.privateRead).actor == s.actor,
      s.reads.get(s.privateRead).life == s.life,
      s.reads.get(s.privateRead).observed == s.actor
    } else true,
    s.callbacks > 0 implies s.mutation.observed == s.mutation.actor and s.mutation.observedAdmin,
    s.generation <= 2, s.life <= 2
  }

  run currentReadPublishesTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1))
    .expect(visible and invariant)
  run changedPreflightCannotDispatchReadTest = init.then(beginRead(1))
    .then(cookieChanges(2)).then(readAccessLost(1)).then(dispatchRead(1).fail())
  run unavailableReadIdentityClearsParentTest = init.then(beginRead(1))
    .then(identityAvailability(false)).then(readAccessLost(1))
    .expect(s.invalidated and not(visible))
  run departedReadDoesNotPublishTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(depart).then(readResponse(1, true)).then(dropRead(1))
    .expect(not(visible) and s.refreshes == 0)
  run newerReadWinsTest = init.then(beginRead(1)).then(readPreflight(1)).then(dispatchRead(1))
    .then(beginRead(2)).then(readPreflight(2)).then(dispatchRead(2)).then(readResponse(2, true))
    .then(publishRead(2)).then(readResponse(1, true)).then(dropRead(1))
    .expect(visible and s.privateRead == 2)
  run readPostflightMismatchClearsParentTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(cookieChanges(2)).then(readAccessLost(1))
    .expect(s.invalidated and not(visible))
  run readForbiddenClearsParentTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, false)).then(readAccessLost(1))
    .expect(s.invalidated and not(visible))
  run temporaryReadFailureAllowsRetryTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readTemporaryFailure(1)).then(readLocalError(1))
    .then(beginRead(2)).then(readPreflight(2)).then(dispatchRead(2)).then(readResponse(2, true))
    .then(publishRead(2)).expect(visible and not(s.error) and not(s.invalidated))
  run duplicateMutationRefusesTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(beginMutation.fail())
  run submittedPayloadRemainsCapturedTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(editPayload(2)).then(mutationPreflight).then(dispatchMutation)
    .expect(s.mutation.payload == 1 and s.formPayload == 2)
  run departedPreflightCannotSendMutationTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(depart).then(dropMutation).then(dispatchMutation.fail())
  run changedMutationPreflightSendsNothingTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(cookieChanges(2)).then(mutationAccessLost)
    .expect(s.mutation.cookie == 0 and s.invalidated and not(s.accepted))
  run dispatchCookieMismatchRefusesServerWriteTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(mutationPreflight).then(cookieChanges(2)).then(dispatchMutation).then(admitMutation(true))
    .then(mutationAccessLost).expect(not(s.accepted) and s.invalidated)
  run dispatchCookieSurvivesLaterSwapTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(mutationPreflight).then(dispatchMutation).then(cookieChanges(2)).then(admitMutation(true))
    .then(mutationAccessLost).expect(s.accepted and s.mutation.cookie == 1 and s.refreshes == 0)
  run acceptedDepartureStartsNoRefreshTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(mutationPreflight).then(dispatchMutation).then(depart).then(admitMutation(true))
    .then(dropMutation).expect(s.accepted and s.refreshes == 0 and s.callbacks == 0)
  run alreadyAcceptedDepartureRetainsWriteTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(mutationPreflight).then(dispatchMutation).then(admitMutation(true)).then(depart)
    .then(dropMutation).expect(s.accepted and s.refreshes == 0 and s.callbacks == 0)
  run acceptedOldLifetimeCannotRefreshNewActorTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(mutationPreflight).then(dispatchMutation).then(depart).then(cookieChanges(2)).then(remount)
    .then(admitMutation(true)).then(dropMutation).expect(s.accepted and s.actor == 2 and s.refreshes == 0)
  run forbiddenMutationClearsPrivateParentTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(mutationPreflight).then(dispatchMutation).then(admitMutation(false)).then(mutationAccessLost)
    .expect(not(visible) and s.invalidated and not(s.accepted))
  run temporaryMutationFailureKeepsPrivateViewTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(mutationPreflight).then(dispatchMutation).then(mutationTemporaryFailure).then(mutationLocalError)
    .expect(visible and s.error and not(s.invalidated) and s.refreshes == 0)
  run currentSuccessRefreshesOnceTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(mutationPreflight).then(dispatchMutation).then(admitMutation(true)).then(finishMutation(2))
    .then(readPreflight(2)).then(dispatchRead(2)).then(readResponse(2, true)).then(publishRead(2))
    .expect(visible and s.accepted and s.note and s.refreshes == 1 and invariant)
  run refreshRechecksActorBeforeSendingTest = init.then(beginRead(1)).then(readPreflight(1))
    .then(dispatchRead(1)).then(readResponse(1, true)).then(publishRead(1)).then(beginMutation)
    .then(mutationPreflight).then(dispatchMutation).then(admitMutation(true)).then(finishMutation(2))
    .then(cookieChanges(2)).then(readAccessLost(2)).expect(s.accepted and s.invalidated
      and s.reads.get(2).cookie == 0 and not(s.note))
  action loaded = beginRead(1).then(readPreflight(1)).then(dispatchRead(1))
    .then(readResponse(1, true)).then(publishRead(1))
  action acceptedMutation = loaded.then(beginMutation).then(mutationPreflight)
    .then(dispatchMutation).then(admitMutation(true))
  run readHelperReturnCannotDispatchAfterCommitTest = init.then(beginRead(1))
    .then(observeReadIdentity(1)).then(returnReadIdentity(1)).then(depart).then(useReadIdentity(1))
    .then(dispatchRead(1).fail())
  run clearanceReadCannotStartAfterCommittedRemovalTest = init.then(beginRead(1))
    .then(observeReadIdentity(1)).then(depart).then(returnReadIdentity(1)).then(useReadIdentity(1))
    .then(dispatchRead(1).fail())
  run observedMutationCannotStartAfterCommitTest = init.then(loaded).then(beginMutation)
    .then(observeMutationIdentity).then(depart).then(returnMutationIdentity).then(useMutationIdentity)
    .expect(s.mutation.cookie == 0 and not(s.accepted))
  run returnedMutationCannotStartAfterCommitTest = init.then(loaded).then(beginMutation)
    .then(observeMutationIdentity).then(returnMutationIdentity).then(depart).then(useMutationIdentity)
    .then(dispatchMutation.fail())
  run parentRefreshRetiresChildBeforePreflightUseTest = init.then(loaded).then(beginMutation)
    .then(observeMutationIdentity).then(returnMutationIdentity).then(beginRead(2)).then(useMutationIdentity)
    .expect(s.mutation.cookie == 0 and s.activeRead == 2 and s.refreshes == 0)
  run sameActorWithoutAdminCannotQueueTest = init.then(loaded).then(beginMutation).then(adminRole(false))
    .then(mutationAccessLost).expect(s.invalidated and not(s.accepted) and s.mutation.cookie == 0)
  run acceptedMutationRetainsWriteAfterPostflightReturnAndDepartureTest = init.then(acceptedMutation)
    .then(observeMutationIdentity).then(returnMutationIdentity).then(depart).then(useMutationIdentity)
    .expect(s.accepted and s.callbacks == 0 and s.refreshes == 0)
  run departedCallbackCannotStartParentReadTest = init.then(acceptedMutation)
    .then(observeMutationIdentity).then(returnMutationIdentity).then(useMutationIdentity).then(depart)
    .then(invokeMutationCallback(2).fail())
  run departedErrorHelperCannotInvalidateReplacementTest = init.then(loaded).then(beginMutation)
    .then(mutationPreflight).then(dispatchMutation).then(mutationTemporaryFailure).then(cookieChanges(2))
    .then(observeMutationIdentity).then(returnMutationIdentity).then(depart).then(remount)
    .then(useMutationIdentity).expect(not(s.invalidated) and not(s.error) and s.actor == 2)
  // Historical passive cleanup leaves ownership true after committed removal.
  // These negative controls stay outside step and expose both external effects.
  action oldPassiveDepart = s' = s.with("present", false)
  run oldPassivePreflightCouldQueueAfterRemovalTest = init.then(loaded).then(beginMutation)
    .then(observeMutationIdentity).then(oldPassiveDepart).then(returnMutationIdentity)
    .then(useMutationIdentity).then(dispatchMutation)
    .expect(s.mutation.phase == "http" and not(invariant))
  run oldPassiveCallbackCouldRefreshAfterRemovalTest = init.then(acceptedMutation)
    .then(observeMutationIdentity).then(returnMutationIdentity).then(useMutationIdentity)
    .then(oldPassiveDepart).then(invokeMutationCallback(2))
    .expect(s.refreshes == 1 and not(invariant))
}
