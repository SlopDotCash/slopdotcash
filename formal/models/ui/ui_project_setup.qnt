// @source src/lib/project-proposal.ts
// @source src/ProjectProposalPage.tsx
// @source src/ProjectFormFields.tsx
// @source src/RewardAssetFields.tsx
// @source src/lib/reward-asset.mjs
// @evidence tests/e2e/project-proposal.spec.ts
// @evidence scripts/project-reward-network.test.ts
// Creation wizard only: three steps, two representative edited forms and one
// retained creation result. Field grammar/manifest construction, repository lookup coherence,
// draft-slot writes, actor/departure ownership and backend admission are their
// separate contracts. Error classes stand for fields on steps zero and one.
// Focus means requested focus, not proof of native DOM delivery. A pending
// branch lookup delays automatic rewind but still blocks manual forward motion.
// The submitted result hands off server setup state; local clicks never grant
// admission or payment authority. Payload equality includes step and referrer.
// Network classes: 0 unknown, 1 a registered own key, 2 an inherited-name input.
// The null-prototype dictionary makes both invalid classes missing. Restored
// assignment dates are parsed without throwing and gate the project step.
// No parser,
// browser or model execution is claimed for these scenarios.
module ui_project_setup {
  type State = { page: int, proposal: int, referrer: bool, baseErrors: Set[str],
    branchPending: bool, funded: bool, network: int, assignment: bool, dateValid: bool, attempted: Set[int],
    session: bool, refreshSession: bool, focus: str, restored: bool,
    submission: str, capturedPayload: List[int], capturedReferrer: bool,
    backendCreated: bool, active: bool, summaryReferrer: bool, install: bool }
  var s: State
  action init = s' = { page: 0, proposal: 0, referrer: false,
    baseErrors: Set("project"), branchPending: false, funded: false, network: 1, assignment: false, dateValid: true,
    attempted: Set(), session: true, refreshSession: false, focus: "none", restored: false,
    submission: "idle", capturedPayload: List(), capturedReferrer: false,
    backendCreated: false, active: false, summaryReferrer: false, install: false }
  pure def hardErrors(value: State): Set[str] = value.baseErrors
    .union(if (value.funded and value.network != 1) Set("reward") else Set())
    .union(if (value.assignment and not(value.dateValid)) Set("project") else Set())
  pure def errors(value: State): Set[str] = hardErrors(value)
    .union(if (value.branchPending) Set("branch") else Set())
  pure def payload(value: State): List[int] = List(value.proposal, value.page,
    if (value.referrer) 1 else 0, if (value.funded) 1 else 0, value.network,
    if (value.assignment) 1 else 0, if (value.dateValid) 1 else 0)
  pure def move(value: State, target: int): State = {
    val forward = target > value.page or target == 2
    val marked = if (forward and target > 0) value.attempted.union(0.to(target - 1)) else value.attempted
    val bad = errors(value)
    val first = if (target > 0 and (bad.contains("project") or bad.contains("branch"))) 0
      else if (target > 1 and bad.contains("reward")) 1 else -1
    if (forward and first >= 0) value.with("page", first).with("attempted", marked)
      .with("focus", if (first == 0) "project-field" else "reward-field")
    else value.with("page", target).with("attempted", marked).with("focus", "heading")
      .with("refreshSession", value.refreshSession or (target == 2 and value.page != target))
  }
  action restore(page: int, bad: Set[str], referrer: bool): bool = all {
    not(s.restored), (-1).to(3).contains(page), bad.subseteq(Set("project", "branch", "reward")),
    s' = s.with("restored", true).with("proposal", 1)
      .with("page", if (0.to(2).contains(page)) page else 0).with("baseErrors", bad).with("referrer", referrer) }
  action edit(form: int, bad: Set[str]): bool = all {
    Set(1, 2).contains(form), bad.subseteq(Set("project", "branch", "reward")),
    s' = s.with("restored", true).with("proposal", form).with("baseErrors", bad) }
  action selectNetwork(funded: bool, network: int): bool = all { 0.to(2).contains(network),
    s' = s.with("restored", true).with("funded", funded).with("network", network) }
  action lookupPending(pending: bool): bool = s' = s.with("branchPending", pending)
  action assignmentDate(required: bool, valid: bool): bool = s' = s.with("assignment", required).with("dateValid", valid)
  action session(signedIn: bool): bool = s' = s.with("session", signedIn)
  action referral(present: bool): bool = s' = s.with("referrer", present)
  action navigate(target: int): bool = all { 0.to(2).contains(target),
    s' = move(s.with("restored", true), target) }
  action rewind = {
    val bad = hardErrors(s)
    val first = if (bad.contains("project") or bad.contains("branch")) 0 else if (bad.contains("reward")) 1 else -1
    all { first >= 0, first < s.page, s' = s.with("page", first).with("attempted", s.attempted.union(Set(first)))
      .with("focus", if (first == 0) "project-field" else "reward-field") }
  }
  action clear = all { s.submission != "submitting", s' = s.with("page", 0).with("proposal", 0)
    .with("baseErrors", Set("project")).with("branchPending", false).with("funded", false).with("network", 1)
    .with("assignment", false).with("dateValid", true)
    .with("attempted", Set()).with("submission", "idle").with("install", false).with("focus", "none") }
  action submit = all { s.submission != "submitting", s' =
    if (errors(s).size() != 0) move(s, 2)
    else if (not(s.session)) s.with("refreshSession", true)
    else s.with("submission", "submitting").with("capturedPayload", payload(s)).with("capturedReferrer", s.referrer) }
  // Actor/lifetime permission for these outcomes is supplied by
  // ui_project_publication_lifetime. A failure can follow a committed create.
  action serverCreate = all { s.submission == "submitting", s' = s.with("backendCreated", true) }
  action failSubmission(needsInstall: bool): bool = all { s.submission == "submitting",
    s' = s.with("submission", "error").with("install", needsInstall) }
  action success(serverActive: bool): bool = all { s.submission == "submitting", s.backendCreated,
    s' = s.with("submission", "submitted").with("active", serverActive)
      .with("summaryReferrer", s.capturedReferrer)
      .with("referrer", if (payload(s) == s.capturedPayload) false else s.referrer).with("focus", "created-heading") }
  action step = {
    nondet page = (-1).to(3).oneOf() nondet target = 0.to(2).oneOf()
    nondet form = Set(1, 2).oneOf() nondet network = 0.to(2).oneOf()
    nondet bad = Set(Set(), Set("project"), Set("branch"), Set("reward"), Set("project", "reward")).oneOf()
    nondet yes = Set(false, true).oneOf() nondet dateValid = Set(false, true).oneOf()
    any { restore(page, bad, yes), edit(form, bad), selectNetwork(yes, network), lookupPending(yes), assignmentDate(yes, dateValid), session(yes),
      referral(yes), navigate(target), rewind, clear, submit, serverCreate, failSubmission(yes), success(yes), s' = s }
  }
  val invariant = all { s.page >= 0 and s.page <= 2, s.attempted.subseteq(Set(0, 1)),
    s.active implies s.backendCreated,
    s.submission == "submitted" implies s.backendCreated }
  action validForm = edit(1, Set())
  action toReview = validForm.then(navigate(1)).then(navigate(2))
  run setupTest = init.then(toReview).then(submit).then(serverCreate).then(success(false)).expect(s.submission == "submitted" and not(s.active) and invariant)
  run exemptionTest = init.then(toReview).then(submit).then(serverCreate).then(success(true)).expect(s.active and s.backendCreated and invariant)
  run revisionTest = init.then(toReview).then(submit).then(failSubmission(false)).expect(s.submission == "error" and s.proposal == 1 and invariant)
  run jumpChecksEarlierStepsInOrderTest = init.then(edit(1, Set("project", "reward"))).then(navigate(2)).expect(s.page == 0 and s.attempted == Set(0, 1) and s.focus == "project-field" and invariant)
  run rewardErrorReturnsToRewardStepTest = init.then(edit(1, Set("reward"))).then(navigate(2)).expect(s.page == 1 and s.focus == "reward-field" and invariant)
  run backDoesNotValidateLaterStepTest = init.then(toReview).then(edit(2, Set("reward"))).then(navigate(0)).expect(s.page == 0 and s.focus == "heading" and invariant)
  run restoredReviewWaitsForPendingBranchesTest = init.then(restore(2, Set(), false)).then(lookupPending(true)).then(rewind.fail())
  run pendingBranchStillBlocksForwardButtonTest = init.then(validForm).then(lookupPending(true)).then(navigate(1)).expect(s.page == 0 and s.focus == "project-field" and invariant)
  run newlyInvalidPriorFieldRewindsTest = init.then(restore(2, Set(), false)).then(edit(1, Set("project"))).then(rewind).expect(s.page == 0 and s.attempted == Set(0) and invariant)
  run invalidRestoredStepFallsBackToFirstTest = init.then(restore(3, Set(), false)).expect(s.page == 0 and invariant)
  run enteringReviewRequestsSessionRefreshTest = init.then(toReview).expect(s.refreshSession and s.page == 2 and invariant)
  run signedOutSubmitDoesNotCreateTest = init.then(toReview).then(session(false)).then(submit).expect(s.submission == "idle" and s.refreshSession and not(s.backendCreated) and invariant)
  run invalidSubmitFocusesFirstErrorTest = init.then(submit).expect(s.page == 0 and s.focus == "project-field" and s.submission == "idle" and invariant)
  run submittingClearIsRefusedTest = init.then(toReview).then(submit).then(clear.fail())
  run submittingDuplicateIsRefusedTest = init.then(toReview).then(submit).then(submit.fail())
  run clearKeepsReferralAndResetsFormTest = init.then(toReview).then(referral(true)).then(clear).expect(s.proposal == 0 and s.page == 0 and s.referrer and s.attempted == Set() and invariant)
  run unchangedSubmittedPayloadClearsOnlyLiveReferralTest = init.then(toReview).then(referral(true)).then(submit).then(serverCreate).then(success(false)).expect(not(s.referrer) and s.summaryReferrer and s.proposal == 1 and invariant)
  run laterEditKeepsReferralTest = init.then(toReview).then(referral(true)).then(submit).then(edit(2, Set())).then(serverCreate).then(success(false)).expect(s.referrer and s.summaryReferrer and s.proposal == 2 and invariant)
  run navigationChangesPayloadEqualityTest = init.then(toReview).then(referral(true)).then(submit).then(navigate(1)).then(serverCreate).then(success(false)).expect(s.referrer and s.summaryReferrer and invariant)
  run lostResponseKeepsCommittedProjectSeparateTest = init.then(toReview).then(submit).then(serverCreate).then(failSubmission(false)).expect(s.backendCreated and s.submission == "error" and not(s.active) and invariant)
  run installationFailureShowsActionTest = init.then(toReview).then(submit).then(failSubmission(true)).expect(s.install and s.submission == "error" and invariant)
  run unknownFundedNetworkBlocksReviewTest = init.then(validForm).then(selectNetwork(true, 0)).then(navigate(2)).expect(s.page == 1 and s.focus == "reward-field" and invariant)
  run inheritedNetworkNameIsAlsoMissingTest = init.then(validForm).then(selectNetwork(true, 2)).then(navigate(2)).expect(s.page == 1 and s.focus == "reward-field" and invariant)
  run correctingNetworkAllowsReviewTest = init.then(validForm).then(selectNetwork(true, 2)).then(navigate(2)).then(selectNetwork(true, 1)).then(navigate(2)).expect(s.page == 2 and invariant)
  run unfundedDraftDoesNotRequireNetworkTest = init.then(validForm).then(selectNetwork(false, 2)).then(navigate(2)).expect(s.page == 2 and invariant)
  run invalidAssignmentDateRewindsWithoutDiscardingDraftTest = init.then(restore(2, Set(), false)).then(assignmentDate(true, false)).then(rewind)
    .expect(s.page == 0 and s.proposal == 1 and invariant).then(assignmentDate(true, true)).then(navigate(2)).expect(s.page == 2 and invariant)
  run pendingNetworkEditKeepsReferralTest = init.then(toReview).then(referral(true)).then(submit).then(selectNetwork(false, 0))
    .then(serverCreate).then(success(false)).expect(s.referrer and s.summaryReferrer and invariant)
  run pendingAssignmentEditKeepsReferralTest = init.then(toReview).then(referral(true)).then(submit).then(assignmentDate(true, true))
    .then(serverCreate).then(success(false)).expect(s.referrer and s.summaryReferrer and invariant)
}
