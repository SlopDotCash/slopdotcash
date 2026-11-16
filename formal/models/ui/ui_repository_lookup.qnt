// @source src/ProjectProposalPage.tsx
// @source src/lib/project-proposal.ts
// @evidence tests/e2e/project-proposal.spec.ts
// Two repository identities, three request epochs, two branches, and four
// description classes: empty, either repository's suggestion, or user text.
// A request has a cancellable debounce, completion and guarded publication.
// Valid response means the current request/response decoder accepted its
// fields. The UI cannot establish coherence between the provider's separate
// repository identity, owner, branch and license observations. The named-read
// consistency boundary is modeled separately in github_lookup_repository;
// these request-ownership guards do not prove provider consistency.
// Account inventory and authenticated publication are separate models. Public
// facts retained in a tab are not account authority. No execution is claimed.
module ui_repository_lookup {
  type Request = { repo: int, phase: str, valid: bool, alternate: bool, commits: bool }
  var s: { repo: int, epoch: int, active: int, accepted: int, phase: str,
    facts: int, branch: int, available: Set[int], knownCommits: bool, source: int,
    description: int, previousSuggestion: int, mounted: bool,
    requests: int -> Request }
  val ids = Set(1, 2, 3)
  action init = s' = { repo: 1, epoch: 1, active: 0, accepted: 0, phase: "idle",
    facts: 0, branch: 0, available: Set(), knownCommits: false, source: 0,
    description: 0, previousSuggestion: 0, mounted: true,
    requests: ids.mapBy(_ => { repo: 0, phase: "unused", valid: false, alternate: false, commits: false }) }
  def owns(id: int): bool = s.mounted and s.active == id and s.epoch == id
    and s.repo > 0 and s.requests.get(id).repo == s.repo
  val readyForReview = s.mounted and s.facts == s.repo and s.facts > 0
    and s.available.contains(s.branch) and s.phase != "error"
  // Optional branchCommits do not gate an ordinary project. The bounty-only
  // manifest requires a source commit; unknown does not become a made-up SHA.
  val bountySourceReady = readyForReview and s.source > 0
  // Clearing input or changing a repository aborts its current controller
  // immediately in the input handler, including a not-yet-fired timer.
  action schedule = all { s.mounted, s.repo > 0, s.active == 0,
    s.requests.get(s.epoch).phase == "unused",
    s' = s.with("active", s.epoch).with("phase", "loading").with("requests",
      s.requests.set(s.epoch, { repo: s.repo, phase: "timer", valid: false, alternate: false, commits: false })) }
  action dispatch(id: int): bool = all { owns(id), s.requests.get(id).phase == "timer",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id).with("phase", "sent"))) }
  action lookup = schedule.then(dispatch(s.epoch))
  action chooseRepository(repo: int): bool = all { s.mounted, s.epoch < 3,
    Set(0, 1, 2).contains(repo), repo != s.repo,
    s' = s.with("repo", repo).with("epoch", s.epoch + 1).with("active", 0)
      .with("accepted", 0).with("phase", "idle").with("facts", 0)
      .with("branch", 0).with("available", Set()).with("knownCommits", false).with("source", 0) }
  action changeRepository = chooseRepository(2)
  action invalidRepository = chooseRepository(0)
  action retry = all { s.mounted, s.phase == "error", s.epoch < 3,
    s' = s.with("epoch", s.epoch + 1).with("active", 0).with("phase", "idle") }
  action editDescription = all { s.mounted, s' = s.with("description", 3) }
  action clearDescription = all { s.mounted, s' = s.with("description", 0) }
  action selectBranch(branch: int): bool = all { s.mounted, s.available.contains(branch),
    s' = s.with("branch", branch).with("source", if (s.knownCommits) s.repo * 10 + branch else 0) }
  action receiveEvidence(id: int, valid: bool, alternate: bool, commits: bool): bool = all {
    s.requests.get(id).phase == "sent",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id)
      .with("phase", "received").with("valid", valid).with("alternate", alternate)
      .with("commits", commits))) }
  action receive(id: int, valid: bool, alternate: bool): bool = receiveEvidence(id, valid, alternate, true)
  action publish(id: int): bool = {
    val r = s.requests.get(id)
    val branches = if (r.alternate) Set(1, 2) else Set(1)
    // A removed restored branch needs a choice; do not select a new default.
    val branch = if (s.facts == r.repo) s.branch else 1
    val completed = s.with("requests", s.requests.set(id, r.with("phase", "done")))
    all { r.phase == "received",
      s' = if (not(owns(id))) completed
        else if (not(r.valid)) completed.with("active", 0).with("phase", "error")
        else completed.with("active", 0).with("accepted", id).with("phase", "ready")
          .with("facts", r.repo).with("branch", branch).with("available", branches)
          .with("knownCommits", r.commits)
          .with("source", if (branches.contains(branch) and r.commits) r.repo * 10 + branch else 0)
          .with("description", if (s.description == 0 or s.description == s.previousSuggestion)
            r.repo else s.description).with("previousSuggestion", r.repo) }
  }
  action success(id: int): bool = receive(id, true, true).then(publish(id))
  action failed(id: int): bool = receive(id, false, false).then(publish(id))
  // Restored IDs do not substitute for a fresh branch inventory. Saved text is
  // treated as authored text in this bounded restoration scenario.
  action restoredDraft = all { s.mounted, s.active == 0, s.facts == 0, s.epoch == 1,
    s' = s.with("facts", 1).with("branch", 2).with("description", 3) }
  action depart = all { s.mounted, s' = s.with("mounted", false).with("active", 0) }
  action step = {
    nondet id = ids.oneOf()
    nondet repo = Set(0, 1, 2).oneOf()
    nondet branch = Set(1, 2).oneOf()
    nondet valid = Set(false, true).oneOf()
    nondet alternate = Set(false, true).oneOf()
    nondet commits = Set(false, true).oneOf()
    any { schedule, dispatch(id), chooseRepository(repo), retry, editDescription,
      clearDescription, selectBranch(branch), receiveEvidence(id, valid, alternate, commits), publish(id),
      restoredDraft, depart, s' = s }
  }
  val invariant = all {
    s.facts > 0 implies s.facts == s.repo,
    s.repo == 0 implies s.facts == 0 and s.branch == 0 and s.source == 0,
    s.accepted > 0 implies s.accepted <= s.epoch,
    s.source > 0 implies s.available.contains(s.branch) and s.source == s.repo * 10 + s.branch,
    if (readyForReview) s.accepted > 0 and s.requests.get(s.accepted).valid else true }
  run obsoleteFactsTest = init.then(lookup).then(changeRepository).then(lookup)
    .then(success(1)).expect(s.facts == 0 and s.phase == "loading")
  run currentFactsTest = init.then(lookup).then(changeRepository).then(lookup)
    .then(success(1)).then(success(2)).expect(s.facts == 2 and s.branch == 1 and readyForReview)
  run typedDescriptionSurvivesTest = init.then(lookup).then(editDescription)
    .then(success(1)).expect(s.description == 3)
  run invalidInputCancelsTest = init.then(lookup).then(invalidRepository)
    .then(success(1)).expect(s.facts == 0 and not(readyForReview))
  run changedBeforeDebounceStartsNoRequestTest = init.then(schedule).then(changeRepository)
    .then(dispatch(1).fail())
  run clearedBeforeDebounceStartsNoRequestTest = init.then(schedule).then(invalidRepository)
    .then(dispatch(1).fail())
  run invalidInputStartsNoLookupTest = init.then(invalidRepository).then(schedule.fail())
  run receivedOldFactsCannotPublishAfterEditTest = init.then(lookup).then(receive(1, true, true))
    .then(changeRepository).then(publish(1)).expect(s.facts == 0 and s.phase == "idle")
  run oldFailureCannotReplaceNewLoadingTest = init.then(lookup).then(changeRepository)
    .then(lookup).then(failed(1)).expect(s.phase == "loading" and s.active == 2)
  run newSuccessSurvivesOldFailureTest = init.then(lookup).then(changeRepository)
    .then(lookup).then(success(2)).then(failed(1)).expect(readyForReview and s.facts == 2)
  run failedLookupStaysEditableTest = init.then(lookup).then(failed(1)).then(editDescription)
    .expect(s.phase == "error" and s.description == 3 and not(readyForReview))
  run failedLookupRetriesWithNewControllerTest = init.then(lookup).then(failed(1)).then(retry)
    .then(lookup).then(success(2)).expect(s.phase == "ready" and s.accepted == 2)
  run rejectedLookupDoesNotFillFactsTest = init.then(lookup).then(receive(1, false, true))
    .then(publish(1)).expect(s.facts == 0 and s.branch == 0 and s.phase == "error")
  run suggestedTextTracksChangedRepositoryTest = init.then(lookup).then(success(1))
    .then(changeRepository).then(lookup).then(success(2)).expect(s.description == 2)
  run authoredTextSurvivesChangedRepositoryTest = init.then(lookup).then(success(1))
    .then(editDescription).then(changeRepository).then(lookup).then(success(2))
    .expect(s.description == 3)
  run clearedTextTakesNewSuggestionTest = init.then(lookup).then(success(1))
    .then(editDescription).then(clearDescription).then(changeRepository).then(lookup)
    .then(success(2)).expect(s.description == 2)
  run branchChoiceBindsItsOwnCommitTest = init.then(lookup).then(success(1))
    .then(selectBranch(2)).expect(s.branch == 2 and s.source == 12 and readyForReview)
  run absentCommitMapDoesNotInventEvidenceTest = init.then(lookup)
    .then(receiveEvidence(1, true, true, false)).then(publish(1)).then(selectBranch(2))
    .expect(readyForReview and s.source == 0 and not(bountySourceReady))
  run restoredDraftWaitsForFreshBranchesTest = init.then(restoredDraft)
    .expect(s.branch == 2 and s.source == 0 and not(readyForReview))
  run restoredValidBranchIsPreservedTest = init.then(restoredDraft).then(lookup)
    .then(success(1)).expect(s.branch == 2 and s.source == 12 and s.description == 3)
  run removedRestoredBranchRequiresChoiceTest = init.then(restoredDraft).then(lookup)
    .then(receive(1, true, false)).then(publish(1))
    .expect(s.branch == 2 and s.source == 0 and not(readyForReview))
  run removedRestoredBranchCanRecoverTest = init.then(restoredDraft).then(lookup)
    .then(receive(1, true, false)).then(publish(1)).then(selectBranch(1)).expect(readyForReview)
  run failedRestoredLookupCannotValidateBranchTest = init.then(restoredDraft).then(lookup)
    .then(failed(1)).expect(s.facts == 1 and s.source == 0 and not(readyForReview))
  run departedDebounceCannotDispatchTest = init.then(schedule).then(depart).then(dispatch(1).fail())
  run departedResponseCannotPublishTest = init.then(lookup).then(depart).then(success(1))
    .expect(s.facts == 0 and not(readyForReview))
  // Old unguarded publication crosses repository identities; excluded from step.
  action oldPublish(id: int): bool = all { s.requests.get(id).phase == "received",
    s' = s.with("facts", s.requests.get(id).repo).with("accepted", id) }
  run oldUnguardedResponseMixesIdentityTest = init.then(lookup).then(receive(1, true, true))
    .then(changeRepository).then(oldPublish(1)).expect(s.facts != s.repo)
}
