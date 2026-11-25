// @source .github/workflows/ready-auto-merge.yml
// @source scripts/ready-auto-merge.ts
// @evidence scripts/ready-auto-merge.test.ts
// Ready auto-merge pilot on Slop's own repository (operator decision,
// 25 November 2026; PRD section 5). One labelled pull request and one
// repository switch. The workflow, never Slopbot, merges. A run first verifies
// the pull request at its current head: switch on, base is the registered
// integration branch, the newest ready label event is Slopbot's and was made
// for this head, an approval from a write-access account stands at this head,
// no write-access account has an open change request, GitHub reports it
// clean, nothing under .github/ is touched, and every answer was readable.
// The merge is pinned to the verified head and repeats the pull request level
// facts (open, labelled, base, clean); GitHub refuses a pinned merge whose
// head moved. Assumption: reviews are read once per run, so a dismissal or a
// change request that lands between a run's verification and its merge, a
// few seconds, is not seen. MAX_MERGES abstracts the limit of five a run with
// several pull requests folded into one counter.
module bot_ready_auto_merge {
  pure val MAX_HEAD = 2
  pure val MAX_MERGES = 1
  pure val BASES = Set("development", "main", "vibestack", "feature")
  var s: { switchOn: bool, base: str, head: int, labelBy: str, labelHead: int,
    approvalHead: int, approverWrites: bool, changeRequest: bool, clean: bool,
    touchesGithub: bool, readable: bool, verifiedHead: int, merges: int,
    mergedBy: str, mergedHead: int, switchAtMerge: bool, comments: int }
  action start(base) = s' = { switchOn: false, base: base, head: 0,
    labelBy: "none", labelHead: -1, approvalHead: -1, approverWrites: false,
    changeRequest: false, clean: false, touchesGithub: false, readable: true,
    verifiedHead: -1, merges: 0, mergedBy: "none", mergedHead: -1, switchAtMerge: false,
    comments: 0 }
  action init = {
    nondet base = BASES.oneOf()
    start(base)
  }
  val open = s.mergedBy == "none"
  // Facts on the pull request itself, read twice in a run.
  val pullFacts = all { open, s.switchOn, s.base == "development",
    s.labelBy != "none", s.clean, s.readable }
  // Facts read once in a run, from events, reviews and the changed files.
  val historyFacts = all { s.labelBy == "slopbot", s.labelHead == s.head,
    s.approvalHead == s.head, s.approverWrites, not(s.changeRequest),
    not(s.touchesGithub) }
  // The operator can change the switch at any time, also after a merge.
  action operatorToggles = s' = s.with("switchOn", not(s.switchOn))
  action push = {
    nondet touches = Set(true, false).oneOf()
    all { open, s.head < MAX_HEAD,
      s' = s.with("head", s.head + 1).with("clean", false)
        .with("touchesGithub", touches) }
  }
  action checks(passing) = all { open, s' = s.with("clean", passing) }
  // Slopbot labels the current head, or removes its label.
  action slopbotLabels = all { open,
    s' = s.with("labelBy", "slopbot").with("labelHead", s.head) }
  action labelRemoved = all { open,
    s' = s.with("labelBy", "none").with("labelHead", -1) }
  // A person with triage rights can add the label by hand.
  action personLabels = all { open,
    s' = s.with("labelBy", "person").with("labelHead", s.head) }
  action approves(writes) = all { open,
    s' = s.with("approvalHead", s.head).with("approverWrites", writes) }
  action approvalDismissed = all { open,
    s' = s.with("approvalHead", -1).with("approverWrites", false) }
  action changeRequested(open_) = all { open, s' = s.with("changeRequest", open_) }
  action githubAnswers(ok) = all { open, s' = s.with("readable", ok) }
  // A run verifies the pull request at its head, or skips it.
  action verify = all { pullFacts, historyFacts, s.merges < MAX_MERGES,
    s' = s.with("verifiedHead", s.head) }
  action skip = s' = s.with("verifiedHead", -1)
  // The pinned merge and its one comment end the run for this pull request.
  action workflowMerges = all { pullFacts, s.verifiedHead == s.head,
    s.merges < MAX_MERGES,
    s' = s.with("mergedBy", "workflow").with("mergedHead", s.head)
      .with("switchAtMerge", s.switchOn).with("merges", s.merges + 1)
      .with("comments", s.comments + 1)
      .with("verifiedHead", -1) }
  action personMerges = all { open,
    s' = s.with("mergedBy", "person").with("mergedHead", s.head)
      .with("verifiedHead", -1) }
  action step = {
    nondet flag = Set(true, false).oneOf()
    any { operatorToggles, push, checks(flag), slopbotLabels, labelRemoved,
      personLabels, approves(flag), approvalDismissed, changeRequested(flag),
      githubAnswers(flag), verify, skip, workflowMerges, personMerges, s' = s }
  }
  val invariant = all {
    // Slopbot has no merge action at all.
    s.mergedBy.in(Set("none", "workflow", "person")),
    s.mergedBy == "workflow" implies all {
      s.switchAtMerge, s.base == "development", s.mergedHead == s.head,
      s.labelBy != "none", s.clean, s.readable, s.comments == 1 },
    s.mergedBy != "workflow" implies s.comments == 0,
    s.merges <= MAX_MERGES,
    // A verified head is never ahead of the current head, and the changed
    // files cannot differ from the verified ones without a new head.
    s.verifiedHead <= s.head,
    s.mergedBy == "workflow" implies not(s.touchesGithub),
  }
  run switchedOn(base) = start(base).then(operatorToggles)
  run ready = switchedOn("development")
    .then(approves(true)).then(slopbotLabels).then(checks(true))
  run switchOffNeverMergesTest = start("development").then(approves(true))
    .then(slopbotLabels).then(checks(true)).then(verify.fail())
  run verifiedPullRequestMergesTest = ready.then(verify).then(workflowMerges)
    .expect(s.mergedBy == "workflow" and s.mergedHead == 0 and s.comments == 1)
  run mainIsNeverMergedTest = switchedOn("main").then(approves(true))
    .then(slopbotLabels).then(checks(true)).then(verify.fail())
  run defaultBranchIsNeverMergedTest = switchedOn("vibestack")
    .then(approves(true)).then(slopbotLabels).then(checks(true))
    .then(verify.fail())
  run personLabelNeverCountsTest = switchedOn("development")
    .then(approves(true)).then(personLabels).then(checks(true))
    .then(verify.fail())
  run readOnlyApprovalNeverCountsTest = switchedOn("development")
    .then(approves(false)).then(slopbotLabels).then(checks(true))
    .then(verify.fail())
  run staleLabelAfterPushNeverCountsTest = ready.then(push).then(approves(true))
    .then(checks(true)).then(verify.fail())
  run changeRequestBlocksTest = ready.then(changeRequested(true)).then(verify.fail())
  run unreadableAnswerSkipsTest = ready.then(githubAnswers(false)).then(verify.fail())
  run pushAfterVerificationRefusesMergeTest = ready.then(verify).then(push)
    .then(checks(true)).then(workflowMerges.fail())
  run runLimitStopsFurtherMergesTest = ready.then(verify).then(workflowMerges)
    .then(verify.fail())
  run personCanStillMergeTest = start("feature").then(personMerges)
    .expect(s.mergedBy == "person" and s.comments == 0)
}
