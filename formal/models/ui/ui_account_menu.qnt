// @source src/Points.tsx
// @source src/lib/use-action.ts
// @source src/lib/browser-deployment.ts
// @evidence tests/e2e/account-menu-lifecycle.spec.ts
// @evidence tests/e2e/account-sessions.spec.ts
// @evidence tests/e2e/points-social.spec.ts
// Source-only model; all new scenarios and browser definitions are unexecuted.
// PointsNav keeps local open/error/image state while its rendered branch changes.
// Two actors, three avatar URLs, two signout requests and three locations bound
// this model. Session and validated points publication are external inputs;
// cookie truth, HTTP/body validation, global draft storage, session-read request
// cancellation and AdminAccountLink authorization are delegated to other models.
// The synchronous owner epoch distinguishes accepted different actors and
// explicit account actions. A passive null read does not create a new owner;
// it can acknowledge this same pending logout. Header delivery is separate
// from delayed JSON completion. This client guard does not order Set-Cookie
// headers or detect another tab signing in again as the same actor.
// At most six externally accepted ownership changes, two owned signout
// completions and one cleanup bound the epoch by nine; it never wraps or saturates.
// Listener installation/cleanup is a separate passive-effect delivery. A DOM
// event before that delivery sees the previously installed listener set.
// Native links close through their onClick callback; they do not use Link's
// client history dispatcher. The signout button is the user-level serializer;
// useAction has no mutex for arbitrary direct callback invocation.
module ui_account_menu {
  type Signout = { phase: str, startedActor: int, ownerEpoch: int, headers: bool }
  type State = { mounted: bool, actor: int, session: str, open: bool,
    listeners: bool, focus: str, location: int, hash: int,
    returnLocation: int, returnHash: int, historyListeners: bool,
    points: str, earnedActors: Set[int], pointsRequested: bool,
    busy: bool, error: bool, requests: int -> Signout,
    accepted: Set[int], clearedDrafts: bool, notified: bool,
    avatar: int, failedAvatar: int, admin: str,
    ownerActor: int, ownerEpoch: int, providerActive: bool, wrongOwnerClear: bool }
  val requestIds = Set(1, 2)
  val actorIds = Set(1, 2)
  val locations = Set(1, 2, 3) // ordinary route, /login, another ordinary route
  var s: State

  val signedIn = s.actor > 0
  val branch = if (not(s.mounted)) "departed"
    else if (not(signedIn) and s.location == 2) "hidden-login"
    else if (not(signedIn) and s.session == "loading") "checking"
    else if (not(signedIn)) "login" else "account"
  val panel = branch == "account" and s.open
  val fallbackAvatar = branch == "account" and s.failedAvatar == s.avatar
  val total = if (not(signedIn) or s.points != "ready") -1
    else (if (s.earnedActors.contains(s.actor)) s.actor * 10 else 0)
      + (if (s.actor == 1) 15 else 0)
  val pointsMessage = if (not(panel) or total >= 0) "none"
    else if (s.points == "error") "unavailable" else "loading"
  val signoutEnabled = panel and not(s.busy)
  val adminVisible = panel and s.admin == "admin"

  action init = s' = { mounted: true, actor: 0, session: "loading", open: false,
    listeners: false, focus: "outside", location: 1, hash: 0,
    returnLocation: 1, returnHash: 0, historyListeners: false,
    points: "loading", earnedActors: Set(), pointsRequested: false,
    busy: false, error: false,
    requests: requestIds.mapBy(_ => { phase: "unused", startedActor: 0, ownerEpoch: 0, headers: false }),
    accepted: Set(), clearedDrafts: false, notified: false,
    avatar: 1, failedAvatar: 0, admin: "checking",
    ownerActor: 0, ownerEpoch: 0, providerActive: true, wrongOwnerClear: false }
  action installHistory = all { s.mounted, not(s.historyListeners),
    s' = s.with("historyListeners", true) }
  action acceptSession(actor: int): bool = all { s.mounted, s.ownerEpoch < 6,
    Set(0, 1, 2).contains(actor),
    s' = s.with("ownerActor", actor).with("session", "ready")
      .with("ownerEpoch", s.ownerEpoch + (if (actor > 0 and actor != s.ownerActor) 1 else 0)) }
  // Provider ownership changes synchronously before React commits the new
  // rendered me. The old A event handler must already refuse a POST here.
  action commitMembership = all { s.mounted,
    s' = s.with("actor", s.ownerActor)
      .with("avatar", if (s.ownerActor == 0) s.avatar else s.ownerActor)
      .with("admin", if (s.actor == 0 and s.ownerActor > 0 and s.open) "checking" else s.admin) }
  action publishSession(actor: int): bool = acceptSession(actor).then(commitMembership)
  action explicitMembership(actor: int): bool = all { s.mounted, s.ownerEpoch < 6,
    Set(0, 1, 2).contains(actor),
    s' = s.with("ownerActor", actor).with("actor", actor).with("ownerEpoch", s.ownerEpoch + 1)
      .with("session", "ready").with("avatar", if (actor == 0) s.avatar else actor)
      .with("admin", if (s.actor == 0 and actor > 0 and s.open) "checking" else s.admin) }
  action checkSession = all { s.mounted, s' = s.with("session", "loading") }
  action failSession = all { s.mounted, s' = s.with("session", "error") }
  // requestPoints sets an idempotent provider flag. Publication of a membership
  // does not itself mean that any point read has completed.
  action signedInEffect = all { s.mounted, signedIn,
    s' = s.with("pointsRequested", true) }
  action publishPoints(members: Set[int]): bool = all { s.mounted,
    members.subseteq(actorIds),
    s' = s.with("points", "ready").with("earnedActors", members) }
  action pointsLoading = all { s.mounted, s' = s.with("points", "loading") }
  action pointsFailure = all { s.mounted, s' = s.with("points", "error") }
  action retryPoints = all { panel, s.points == "error",
    s' = s.with("points", "loading") }
  action toggleAccount = all { branch == "account",
    s' = s.with("open", not(s.open)).with("focus", "trigger")
      .with("pointsRequested", s.pointsRequested or not(s.open))
      .with("admin", if (s.open) s.admin else "checking") }
  action flushListeners = all { s.mounted, s.listeners != s.open,
    s' = s.with("listeners", s.open) }
  action focusInside = all { panel, s' = s.with("focus", "panel") }
  action pointerInside = all { panel, s' = s }
  // The focus/pointer target lies outside root. With no signed-in branch,
  // root.current is null, so any installed outside handler also closes.
  action outsidePointer = all { s.mounted,
    s' = if (s.listeners) s.with("open", false) else s }
  action outsideFocus = all { s.mounted,
    s' = s.with("focus", "outside").with("open", if (s.listeners) false else s.open) }
  action escapeKey = all { s.mounted,
    s' = if (s.listeners) s.with("open", false)
      .with("focus", if (branch == "account") "trigger" else s.focus) else s }
  action otherKey = all { s.mounted, s' = s }
  action history(location: int, hash: int): bool = all { s.mounted,
    locations.contains(location), Set(0, 1).contains(hash),
    s' = s.with("location", location).with("hash", hash)
      .with("open", if (s.listeners) false else s.open)
      .with("returnLocation", if (s.historyListeners) location else s.returnLocation)
      .with("returnHash", if (s.historyListeners) hash else s.returnHash) }
  // hashchange updates the return address but is not a menu-close event.
  action hashChange = all { s.mounted,
    s' = s.with("hash", 1).with("returnHash", if (s.historyListeners) 1 else s.returnHash) }
  action nativeLink = all { panel, s' = s.with("open", false) }
  action adminResult(result: str): bool = all { panel,
    Set("checking", "admin", "regular", "error").contains(result),
    s' = s.with("admin", result) }
  action avatarChanges(urlId: int): bool = all { branch == "account",
    Set(1, 2, 3).contains(urlId), s' = s.with("avatar", urlId) }
  // A late error uses the URL captured by that rendered image, not whatever
  // avatar is currently displayed. The state retains one failed URL only.
  action imageError(urlId: int): bool = all { s.mounted,
    Set(1, 2, 3).contains(urlId), s' = s.with("failedAvatar", urlId) }
  action startSignout(id: int): bool = all { signoutEnabled,
    s.providerActive, s.ownerActor == s.actor,
    requestIds.contains(id), s.requests.get(id).phase == "unused",
    s' = s.with("busy", true).with("error", false)
      .with("requests", s.requests.set(id, { phase: "pending", startedActor: s.actor,
        ownerEpoch: s.ownerEpoch, headers: false })) }
  def ownsSignout(id: int): bool = s.providerActive
    and s.requests.get(id).ownerEpoch == s.ownerEpoch
  action serverAccepts(id: int): bool = all { requestIds.contains(id),
    s.requests.get(id).phase == "pending",
    s' = s.with("accepted", s.accepted.union(Set(id))) }
  action signoutFails(id: int): bool = all { requestIds.contains(id),
    s.requests.get(id).phase == "pending",
    s' = s.with("busy", false).with("error", ownsSignout(id))
      .with("requests", s.requests.set(id, s.requests.get(id).with("phase", "failed"))) }
  action receiveHeaders(id: int): bool = all { requestIds.contains(id),
    s.requests.get(id).phase == "pending", s.accepted.contains(id),
    s' = s.with("requests", s.requests.set(id, s.requests.get(id).with("headers", true))) }
  action signoutSucceeds(id: int): bool = all { requestIds.contains(id),
    s.requests.get(id).phase == "pending", s.requests.get(id).headers,
    s' = if (ownsSignout(id)) s.with("actor", 0).with("ownerActor", 0)
      .with("ownerEpoch", s.ownerEpoch + 1).with("session", "ready").with("open", false)
      .with("busy", false).with("clearedDrafts", true).with("notified", true)
      .with("requests", s.requests.set(id, s.requests.get(id).with("phase", "done")))
    else s.with("busy", false)
      .with("requests", s.requests.set(id, s.requests.get(id).with("phase", "superseded"))) }
  action depart = all { s.mounted, s' = s.with("mounted", false)
    .with("listeners", false).with("historyListeners", false).with("providerActive", false)
    .with("ownerEpoch", s.ownerEpoch + 1) }
  action step = {
    nondet actor = Set(0, 1, 2).oneOf()
    nondet id = requestIds.oneOf()
    nondet urlId = Set(1, 2, 3).oneOf()
    nondet location = locations.oneOf()
    nondet hash = Set(0, 1).oneOf()
    nondet result = Set("checking", "admin", "regular", "error").oneOf()
    nondet members = actorIds.powerset().oneOf()
    any { installHistory, acceptSession(actor), commitMembership, explicitMembership(actor), checkSession, failSession,
      signedInEffect, publishPoints(members), pointsLoading, pointsFailure,
      retryPoints, toggleAccount, flushListeners, focusInside, pointerInside,
      outsidePointer, outsideFocus, escapeKey, otherKey, history(location, hash),
      hashChange, nativeLink, adminResult(result), avatarChanges(urlId),
      imageError(urlId), startSignout(id), serverAccepts(id), receiveHeaders(id), signoutFails(id),
      signoutSucceeds(id), depart, s' = s }
  }
  val invariant = all {
    Set(0, 1, 2).contains(s.actor), locations.contains(s.location),
    s.ownerEpoch >= 0, s.ownerEpoch <= 9, not(s.wrongOwnerClear),
    locations.contains(s.returnLocation), s.accepted.subseteq(requestIds),
    panel implies signedIn and s.open and s.mounted,
    total >= 0 implies signedIn and s.points == "ready",
    s.clearedDrafts iff s.notified,
    s.clearedDrafts implies requestIds.exists(id => s.requests.get(id).phase == "done"),
    s.busy iff requestIds.exists(id => s.requests.get(id).phase == "pending"),
    not(s.mounted) implies not(s.listeners or s.historyListeners)
  }

  run unknownSessionShowsCheckingTest = init.expect(branch == "checking" and not(panel))
  run loginRouteSuppressesAnonymousControlTest = init.then(history(2, 0))
    .expect(branch == "hidden-login")
  run sessionFailureOffersLoginTest = init.then(failSession).expect(branch == "login")
  run signedInSessionRecheckKeepsAccountControlTest = init.then(publishSession(1))
    .then(checkSession).expect(branch == "account")
  run failedRecheckRetainsPublishedMembershipTest = init.then(publishSession(1))
    .then(failSession).expect(branch == "account")
  run openedMenuRequestsPointsTest = init.then(publishSession(1)).then(toggleAccount)
    .expect(panel and s.pointsRequested and pointsMessage == "loading")
  run readyTotalIncludesHistoricalMembershipAwardsTest = init.then(publishSession(1))
    .then(publishPoints(Set(1))).expect(total == 25)
  run absentEarnedRecordStillKeepsHistoricalAwardsTest = init.then(publishSession(1))
    .then(publishPoints(Set())).expect(total == 15)
  run pointsFailureDoesNotMislabelHistoricalBonusAsTotalTest = init.then(publishSession(1))
    .then(toggleAccount).then(pointsFailure).expect(total == -1 and pointsMessage == "unavailable")
  run pointsErrorRetryKeepsPanelOpenTest = init.then(publishSession(1)).then(toggleAccount)
    .then(pointsFailure).then(retryPoints).expect(panel and pointsMessage == "loading")
  run interiorFocusDoesNotDismissTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(focusInside).then(pointerInside).expect(panel and s.focus == "panel")
  run escapeClosesAndRestoresTriggerTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(focusInside).then(escapeKey).expect(not(panel) and s.focus == "trigger")
  run otherKeysDoNotDismissTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(otherKey).expect(panel)
  run outsidePointerClosesTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(outsidePointer).expect(not(panel))
  run outsideFocusClosesWithoutFocusTheftTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(outsideFocus).expect(not(panel) and s.focus == "outside")
  run eventBeforeEffectHasNoNewListenerTest = init.then(publishSession(1)).then(toggleAccount)
    .then(outsidePointer).expect(panel and not(s.listeners))
  run closedMenuListenerCleanupIsSeparateTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(toggleAccount).expect(not(panel) and s.listeners)
  run cleanedUpEscapeDoesNotMoveFocusTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(toggleAccount).then(flushListeners).then(outsideFocus)
    .then(escapeKey).expect(s.focus == "outside" and not(s.listeners))
  run nativeAccountLinkClosesBeforeNavigationTest = init.then(publishSession(1))
    .then(toggleAccount).then(nativeLink).expect(not(panel) and s.location == 1)
  run popstateClosesMenuAndTracksReturnTest = init.then(installHistory).then(publishSession(1))
    .then(toggleAccount).then(flushListeners).then(history(3, 1))
    .expect(not(panel) and s.returnLocation == 3 and s.returnHash == 1)
  run hashchangeTracksReturnWithoutClosingMenuTest = init.then(installHistory)
    .then(publishSession(1)).then(toggleAccount).then(flushListeners).then(hashChange)
    .expect(panel and s.returnHash == 1)
  run lostMembershipDoesNotSynchronouslyResetLocalOpenTest = init.then(publishSession(1))
    .then(toggleAccount).then(flushListeners).then(publishSession(0))
    .expect(branch == "login" and s.open and s.listeners)
  run nullRootOutsideEventClosesRetainedOpenTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(publishSession(0)).then(outsidePointer).expect(not(s.open))
  run actorChangeUsesCurrentProfileAndTotalTest = init.then(publishSession(1)).then(toggleAccount)
    .then(publishPoints(Set(1, 2))).then(publishSession(2)).expect(panel and s.actor == 2 and total == 20)
  run roleErrorDoesNotShowAdminLinkTest = init.then(publishSession(1)).then(toggleAccount)
    .then(adminResult("error")).expect(not(adminVisible) and panel)
  run adminLinkNeedsCurrentChildRoleResultTest = init.then(publishSession(1)).then(toggleAccount)
    .then(adminResult("admin")).expect(adminVisible)
  run reopenedAdminChildStartsCheckingTest = init.then(publishSession(1)).then(toggleAccount)
    .then(adminResult("admin")).then(toggleAccount).then(toggleAccount).expect(not(adminVisible))
  run failedCurrentAvatarUsesInitialsTest = init.then(publishSession(1)).then(imageError(1))
    .expect(fallbackAvatar)
  run changedAvatarDoesNotReuseFailedUrlTest = init.then(publishSession(1)).then(imageError(1))
    .then(avatarChanges(3)).expect(not(fallbackAvatar))
  run lateOldAvatarErrorDoesNotHideCurrentImageTest = init.then(publishSession(1))
    .then(avatarChanges(3)).then(imageError(1)).expect(not(fallbackAvatar))
  run onlyLatestFailedUrlIsRetainedTest = init.then(publishSession(1)).then(imageError(1))
    .then(avatarChanges(3)).then(imageError(3)).then(avatarChanges(1)).expect(not(fallbackAvatar))
  run signoutWaitsBeforeClearingMembershipTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(serverAccepts(1))
    .expect(s.actor == 1 and s.busy and not(s.clearedDrafts))
  run pendingSignoutMayCloseMenuTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(startSignout(1)).then(outsidePointer)
    .expect(s.busy and not(panel))
  run failedHiddenSignoutReappearsWithErrorTest = init.then(publishSession(1)).then(toggleAccount)
    .then(flushListeners).then(startSignout(1)).then(outsidePointer).then(signoutFails(1))
    .then(toggleAccount).expect(panel and s.error and signoutEnabled and not(s.clearedDrafts))
  run retrySignoutClearsEarlierErrorTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(signoutFails(1)).then(startSignout(2))
    .expect(s.busy and not(s.error))
  run successfulSignoutClosesAndPublishesInvalidationTest = init.then(publishSession(1))
    .then(toggleAccount).then(startSignout(1)).then(serverAccepts(1)).then(receiveHeaders(1)).then(signoutSucceeds(1))
    .expect(branch == "login" and not(s.open) and s.clearedDrafts and s.notified and invariant)
  run failureDoesNotInvalidateAccountTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(signoutFails(1)).expect(panel and s.actor == 1 and s.error and invariant)
  run signoutButtonSerializesVisibleUserActionsTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(startSignout(2).fail())
  run newMemberSurvivesEarlierSignoutBodyTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(serverAccepts(1)).then(receiveHeaders(1)).then(publishSession(2))
    .then(signoutSucceeds(1)).expect(s.actor == 2 and not(s.clearedDrafts) and not(s.notified))
  run passiveNullStillCompletesCurrentSignoutTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(serverAccepts(1)).then(receiveHeaders(1)).then(publishSession(0))
    .then(signoutSucceeds(1)).expect(s.actor == 0 and s.clearedDrafts and s.notified)
  run newerMemberThenNullStillRetiresEarlierSignoutTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(serverAccepts(1)).then(receiveHeaders(1)).then(publishSession(2))
    .then(publishSession(0)).then(signoutSucceeds(1)).expect(not(s.clearedDrafts) and not(s.notified))
  run sameActorExplicitLoginRetiresEarlierSignoutTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(serverAccepts(1)).then(receiveHeaders(1)).then(explicitMembership(1))
    .then(signoutSucceeds(1)).expect(s.actor == 1 and not(s.clearedDrafts))
  run sameActorOrdinaryRecheckKeepsCurrentSignoutTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(serverAccepts(1)).then(receiveHeaders(1)).then(publishSession(1))
    .then(signoutSucceeds(1)).expect(s.actor == 0 and s.clearedDrafts)
  run uncommittedNewActorPreventsOldHandlerDispatchTest = init.then(publishSession(1)).then(toggleAccount)
    .then(acceptSession(2)).then(startSignout(1).fail())
  run newActorHidesEarlierSignoutFailureTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(publishSession(2)).then(signoutFails(1))
    .expect(panel and s.actor == 2 and not(s.error))
  run departedProviderCannotClearLaterDraftsTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(serverAccepts(1)).then(receiveHeaders(1)).then(depart)
    .then(signoutSucceeds(1)).expect(not(s.clearedDrafts) and not(s.notified))
  run departureRemovesWindowListenersTest = init.then(installHistory).then(publishSession(1))
    .then(toggleAccount).then(flushListeners).then(depart)
    .expect(branch == "departed" and not(s.listeners or s.historyListeners))

  // Historical counterexample only, outside step: before provider ownership
  // was captured, delayed A completion always cleared current B and all drafts.
  action oldSignoutSucceeds(id: int): bool = all {
    s.requests.get(id).phase == "pending", s.requests.get(id).headers,
    s' = s.with("actor", 0).with("ownerActor", 0).with("busy", false)
      .with("clearedDrafts", true).with("notified", true).with("open", false)
      .with("wrongOwnerClear", s.wrongOwnerClear or not(ownsSignout(id)))
      .with("requests", s.requests.set(id, s.requests.get(id).with("phase", "done"))) }
  run oldDelayedSignoutClearedNewMemberTest = init.then(publishSession(1)).then(toggleAccount)
    .then(startSignout(1)).then(serverAccepts(1)).then(receiveHeaders(1)).then(publishSession(2))
    .then(oldSignoutSucceeds(1)).expect(s.actor == 0 and s.clearedDrafts and s.wrongOwnerClear and not(invariant))
}
