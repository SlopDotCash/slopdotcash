// @source backend/projects/handler.ts
// @source backend/projects/enforcement.ts
// @source backend/projects/verified-enforcement.ts
// @source backend/projects/cloudflare-persistence.ts
// @source backend/projects/contracts.ts
// @source src/lib/project-contracts.ts
// @source migrations/0121_project_application_cancellation.sql
// @evidence scripts/project-self-service.test.ts
// @evidence backend/projects/cloudflare-persistence.test.ts
// @evidence tests/e2e/registry.spec.ts
// One registered project, one pending application (new or update), one
// removal, and one competing revision/activation. Revision 0..3 and a single
// enforcement-generation change bound the finite graph. A cancelled record is
// the public projection of rejected storage plus applicant_cancelled_at.
// Session validity, immutable repository matching and the live GitHub role
// result are inputs. Each removal attempt obtains a fresh authority result;
// GitHub can change after that read, so this is no distributed transaction
// with GitHub. The revision and enforcement comparisons occur at D1 commit.
// Durable writes are atomic predicates; actual migrated-SQLite tests supply
// implementation evidence. Lost HTTP responses do not undo committed writes.
// Historical Points, private cases and funded obligations are represented by
// retained identity sets; amount/chain/payment behavior is outside this model.
// One moderator Quarantine or Ban (the single enforcement-generation change)
// appends its own paused, retired revision unless the project is already
// retired. Reinstatement appends the listed revision again when the
// restriction opened on a listed one (PRD ADM-06), so that revision is no
// removal: removal is refused while the project's own restriction is in
// force, when read and again within the guarded append.
module api_project_removal {
  var s: { head: int, history: List[int], retired: bool, active: bool,
    generation: int, removePhase: str, expected: int, readGeneration: int,
    checkedAuthority: bool, removeWrites: int, removeResponse: str,
    application: str, newApplication: bool, publishPrepared: bool,
    applicationPublished: bool, cancelResponse: str,
    setupPrepared: bool, setupBase: int, otherWritten: bool,
    restricted: bool, openedListed: bool,
    points: Set[int], cases: Set[int], obligations: Set[int] }

  action init = s' = { head: 1, history: List(1), retired: false, active: true,
    generation: 0, removePhase: "idle", expected: 0, readGeneration: -1,
    checkedAuthority: false, removeWrites: 0, removeResponse: "none",
    application: "pending", newApplication: false, publishPrepared: false,
    applicationPublished: false, cancelResponse: "none",
    setupPrepared: false, setupBase: 0, otherWritten: false,
    restricted: false, openedListed: false,
    points: Set(1), cases: Set(1), obligations: Set(1) }

  action pendingNewProject = all { s.removePhase == "idle", s.head == 1,
    not(s.publishPrepared), not(s.setupPrepared), not(s.otherWritten),
    s.application == "pending", not(s.newApplication),
    s' = s.with("newApplication", true).with("head", 0)
      .with("history", List()).with("active", false) }
  action beginRemoval(expected: int): bool = all { s.head > 0,
    Set("idle", "done", "error").contains(s.removePhase),
    expected >= 1, expected <= 3,
    s' = s.with("expected", expected).with("readGeneration", -1)
      .with("checkedAuthority", false).with("removeResponse", "none")
      .with("removePhase", "authority") }
  action authorityReply(result: str): bool = all { s.removePhase == "authority",
    Set("verified", "denied", "unavailable").contains(result),
    s' = if (result == "verified") s.with("checkedAuthority", true).with("readGeneration", s.generation)
      .with("removePhase", "commit")
    else s.with("removePhase", "error").with("removeResponse", result) }
  action commitRemoval = all { s.removePhase == "commit", s.checkedAuthority,
    s' = if (s.restricted) s.with("removePhase", "error").with("removeResponse", "restricted")
    else if (s.retired) s.with("removePhase", "committed")
    else if (s.head != s.expected or s.generation != s.readGeneration or s.head == 3)
      s.with("removePhase", "error").with("removeResponse", "conflict")
    else s.with("head", s.head + 1).with("history", s.history.append(s.head + 1))
      .with("retired", true).with("active", false).with("removeWrites", 1)
      .with("removePhase", "committed") }
  action removalWriteFailure = all { s.removePhase == "commit",
    s' = s.with("removePhase", "error").with("removeResponse", "unavailable") }
  action removalReply(delivered: bool): bool = all { s.removePhase == "committed",
    s' = s.with("removePhase", if (delivered) "done" else "error")
      .with("removeResponse", if (delivered) "removed" else "lost") }

  // Publication reads may finish before cancellation; the final write still
  // compares the terminal application state in the same database transaction.
  action preparePublication = all { s.application == "pending",
    not(s.publishPrepared),
    s' = s.with("publishPrepared", true) }
  action publishApplication = all { s.publishPrepared, s.application == "pending",
    if (s.newApplication) s.head == 0 else s.head == 1,
    s' = s.with("application", "approved").with("applicationPublished", true)
      .with("head", s.head + 1).with("history", s.history.append(s.head + 1)) }
  action cancelApplication(sameApplicant: bool): bool = all {
    s' = if (not(sameApplicant)) s.with("cancelResponse", "not_found")
    else if (s.application == "pending")
      s.with("application", "cancelled").with("cancelResponse", "cancelled")
    else s.with("cancelResponse", if (s.application == "cancelled") "cancelled" else "decided") }
  action lostCancellationReply = all { s.cancelResponse == "cancelled",
    s' = s.with("cancelResponse", "lost") }

  // A setup request that read the old head cannot reactivate a removed head.
  action prepareSetup = all { s.head > 0, not(s.retired), not(s.setupPrepared),
    s' = s.with("setupPrepared", true).with("setupBase", s.head) }
  action commitSetup = all { s.setupPrepared, s.setupBase == s.head,
    not(s.retired), not(s.otherWritten), s.head < 3,
    s' = s.with("head", s.head + 1).with("history", s.history.append(s.head + 1))
      .with("active", true).with("otherWritten", true) }
  action anotherRevision = all { s.head > 0, s.head < 3, not(s.otherWritten),
    s' = s.with("head", s.head + 1).with("history", s.history.append(s.head + 1))
      .with("otherWritten", true) }
  action enforcementArrives = all { s.generation == 0,
    s' = s.with("generation", 1) }
  action restrictionApplies = all { s.generation == 0, s.head > 0,
    s.retired or s.head < 3,
    s' = (if (s.retired) s
      else s.with("head", s.head + 1).with("history", s.history.append(s.head + 1))
        .with("retired", true).with("active", false))
      .with("generation", 1).with("restricted", true)
      .with("openedListed", not(s.retired)) }
  action reinstate = all { s.restricted, not(s.openedListed) or s.head < 3,
    s' = (if (s.openedListed)
        s.with("head", s.head + 1).with("history", s.history.append(s.head + 1))
          .with("retired", false)
      else s).with("restricted", false).with("openedListed", false) }

  action step = {
    nondet expected = 1.to(3).oneOf()
    nondet result = Set("verified", "denied", "unavailable").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { pendingNewProject, beginRemoval(expected), authorityReply(result),
      commitRemoval, removalWriteFailure, removalReply(yes),
      preparePublication, publishApplication, cancelApplication(yes),
      lostCancellationReply, prepareSetup, commitSetup, anotherRevision,
      enforcementArrives, restrictionApplies, reinstate, s' = s }
  }
  val invariant = all {
    s.head >= 0, s.head <= 3, s.head == s.history.length(),
    s.history.indices().forall(i => s.history.nth(i) == i + 1),
    s.retired implies not(s.active),
    s.removeWrites <= 1,
    s.removeWrites == 1 implies s.retired,
    s.restricted implies s.retired,
    (s.restricted and s.openedListed) implies s.removeWrites == 0,
    s.application == "cancelled" implies not(s.applicationPublished),
    s.applicationPublished implies s.application == "approved",
    s.removeResponse == "removed" implies
      (s.retired and s.checkedAuthority and s.removeWrites == 1),
    s.points == Set(1), s.cases == Set(1), s.obligations == Set(1)
  }

  action remove = beginRemoval(1).then(authorityReply("verified")).then(commitRemoval)
  run removalRetainsHistoryAndObligationsTest = init.then(remove).then(removalReply(true))
    .expect(s.head == 2 and s.history == List(1, 2) and s.retired and not(s.active) and invariant)
  run nonMaintainerCannotRemoveTest = init.then(beginRemoval(1)).then(authorityReply("denied"))
    .expect(s.head == 1 and not(s.retired)).then(commitRemoval.fail())
  run unavailableAuthorityDoesNotRemoveTest = init.then(beginRemoval(1)).then(authorityReply("unavailable"))
    .expect(s.removeResponse == "unavailable" and s.head == 1 and not(s.retired))
  run concurrentRevisionRefusesRemovalTest = init.then(beginRemoval(1)).then(authorityReply("verified"))
    .then(anotherRevision).then(commitRemoval).expect(not(s.retired) and s.removeResponse == "conflict")
  run enforcementRaceRefusesRemovalTest = init.then(beginRemoval(1)).then(authorityReply("verified"))
    .then(enforcementArrives).then(commitRemoval).expect(s.head == 1 and s.removeResponse == "conflict")
  run lostRemovalReplyRetryDoesNotAppendTest = init.then(remove).then(removalReply(false))
    .then(beginRemoval(1)).then(authorityReply("verified")).then(commitRemoval).then(removalReply(true))
    .expect(s.head == 2 and s.removeWrites == 1 and s.removeResponse == "removed")
  run lostReplyStillRequiresFreshAuthorityTest = init.then(remove).then(removalReply(false))
    .then(beginRemoval(1)).then(authorityReply("denied"))
    .expect(s.retired and s.head == 2 and s.removeResponse == "denied")
  run failedWriteDoesNotClaimRemovalTest = init.then(beginRemoval(1)).then(authorityReply("verified"))
    .then(removalWriteFailure).expect(s.head == 1 and not(s.retired))
  run cancelledNewApplicationNeverPublishesTest = init.then(pendingNewProject).then(preparePublication)
    .then(cancelApplication(true)).expect(s.head == 0 and s.application == "cancelled")
    .then(publishApplication.fail())
  run cancelledUpdateNeverPublishesTest = init.then(preparePublication).then(cancelApplication(true))
    .expect(s.head == 1 and s.application == "cancelled").then(publishApplication.fail())
  run publicationWinsCancellationRaceTest = init.then(preparePublication).then(publishApplication)
    .then(cancelApplication(true)).expect(s.application == "approved" and s.cancelResponse == "decided" and s.head == 2)
  run anotherActorCannotCancelTest = init.then(cancelApplication(false))
    .expect(s.application == "pending" and s.cancelResponse == "not_found")
  run cancellationRetryNeedsNoGitHubTest = init.then(cancelApplication(true)).then(lostCancellationReply)
    .then(cancelApplication(true)).expect(s.application == "cancelled" and s.cancelResponse == "cancelled" and s.head == 1)
  run staleUpdateCanStillBeCancelledTest = init.then(preparePublication).then(remove)
    .then(cancelApplication(true)).expect(s.retired and s.application == "cancelled" and s.head == 2)
  run removedProjectRejectsPreparedSetupTest = init.then(prepareSetup).then(remove)
    .expect(s.retired and not(s.active)).then(commitSetup.fail())
  run preparedUpdateCannotRestoreRemovedProjectTest = init.then(preparePublication).then(remove)
    .expect(s.retired and not(s.active)).then(publishApplication.fail())
  run restrictionRetirementIsNoRemovalTest = init.then(restrictionApplies)
    .then(beginRemoval(2)).then(authorityReply("verified")).then(commitRemoval)
    .expect(s.removeResponse == "restricted" and s.removeWrites == 0 and s.head == 2 and invariant)
    .then(reinstate).expect(not(s.retired) and s.head == 3 and invariant)
  run staleRemovalDuringRestrictionIsRefusedTest = init.then(restrictionApplies)
    .then(beginRemoval(1)).then(authorityReply("verified")).then(commitRemoval)
    .expect(s.removeResponse == "restricted" and s.removeWrites == 0 and s.head == 2)
  run restrictionDuringRemovalRefusesItTest = init.then(beginRemoval(1)).then(authorityReply("verified"))
    .then(restrictionApplies).then(commitRemoval)
    .expect(s.removeResponse == "restricted" and s.removeWrites == 0 and invariant)
  run removalBeforeRestrictionSurvivesReinstatementTest = init.then(remove).then(removalReply(true))
    .then(restrictionApplies).expect(s.head == 2 and s.restricted and not(s.openedListed))
    .then(reinstate).expect(s.retired and s.head == 2 and s.removeResponse == "removed" and invariant)
}
