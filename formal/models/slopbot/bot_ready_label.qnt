// @source workers/slopbot/ready-label.ts
// @source workers/slopbot/index.ts
// @source src/lib/slopbot-ready.mjs
// @source migrations/0130_slopbot_ready_labels.sql
// The slopbot:ready label (operator decision, 16 November 2026; PRD section
// 5). One open pull request. A check re-reads every fact at the current head
// commit and sets the label exactly when all five conditions hold there:
// checks passing and mergeable, Slopbot's review of that head has no finding,
// enough approvals at that head from write-access accounts, under the size
// cap, no protected path. Every other action is an event that can make the
// last check stale; a push resets every per-head fact. The owner setting is
// off at the start. Only a human merges; Slopbot has no merge action.
// REQUIRED abstracts the owner's approval count (default 1).
// A pull request whose submission fee Slopbot asked and nobody paid is never
// labelled, whatever else holds (operator decision, 18 November 2026; the fee
// itself is modelled in bot_submission_fee).
module bot_ready_label {
  pure val REQUIRED = 1
  pure val MAX_HEAD = 2
  var s: { on: bool, head: int, checks: bool, reviewNone: bool,
    approvals: int, protectedPath: bool, overCap: bool, feeUnpaid: bool,
    label: bool, fresh: bool, merged: bool }
  action init = s' = { on: false, head: 0, checks: false, reviewNone: false,
    approvals: 0, protectedPath: false, overCap: false, feeUnpaid: false,
    label: false, fresh: true, merged: false }
  val conditions = all { s.on, s.checks, s.reviewNone, not(s.feeUnpaid),
    s.approvals >= REQUIRED, not(s.protectedPath), not(s.overCap) }
  // Any event marks the last decision stale until the next check.
  def event(after) = after.with("fresh", false)
  action push = {
    nondet touchesProtected = Set(true, false).oneOf()
    nondet large = Set(true, false).oneOf()
    all { not(s.merged), s.head < MAX_HEAD,
      s' = event(s.with("head", s.head + 1).with("checks", false)
        .with("reviewNone", false).with("approvals", 0)
        .with("protectedPath", touchesProtected).with("overCap", large)) }
  }
  action checksPass = all { not(s.merged), s' = event(s.with("checks", true)) }
  action checksFail = all { not(s.merged), s' = event(s.with("checks", false)) }
  action reviewNoFinding = all { not(s.merged), s' = event(s.with("reviewNone", true)) }
  action reviewFinding = all { not(s.merged), s' = event(s.with("reviewNone", false)) }
  // An approval at the head from an account with write access.
  action maintainerApproves = all { not(s.merged), s.approvals < 2,
    s' = event(s.with("approvals", s.approvals + 1)) }
  // An approval from an account without write access changes no fact.
  action readOnlyApproves = all { not(s.merged), s' = event(s) }
  action changesRequested = all { not(s.merged), s' = event(s.with("approvals", 0)) }
  action ownerToggles = all { s' = event(s.with("on", not(s.on))) }
  // Slopbot asks a submission fee for the pull request; a deposit or a
  // release ends the wait.
  action feeAsked = all { not(s.merged), s' = event(s.with("feeUnpaid", true)) }
  action feeSettled = all { not(s.merged), s' = event(s.with("feeUnpaid", false)) }
  // The ready check: label exactly when every condition holds. A closed or
  // merged pull request keeps its last label.
  action check = all { not(s.merged),
    s' = s.with("label", conditions).with("fresh", true) }
  action humanMerges = all { not(s.merged), s' = s.with("merged", true) }
  action step = any { push, checksPass, checksFail, reviewNoFinding,
    reviewFinding, maintainerApproves, readOnlyApproves, changesRequested,
    ownerToggles, feeAsked, feeSettled, check, humanMerges, s' = s }
  val invariant = all {
    (s.fresh and not(s.merged)) implies (s.label == conditions),
    s.approvals <= 2,
  }
  run offByDefaultNeverLabelsTest = init.then(reviewNoFinding).then(checksPass)
    .then(maintainerApproves).then(check)
    .expect(not(s.on) and not(s.label))
  run allConditionsLabelTest = init.then(ownerToggles).then(reviewNoFinding)
    .then(checksPass).then(maintainerApproves).then(check)
    .expect(s.label)
  run pushRemovesLabelAtNextCheckTest = init.then(ownerToggles).then(reviewNoFinding)
    .then(checksPass).then(maintainerApproves).then(check)
    .then(push).then(check)
    .expect(not(s.label) and s.head == 1)
  run readOnlyApprovalIsIgnoredTest = init.then(ownerToggles).then(reviewNoFinding)
    .then(checksPass).then(readOnlyApproves).then(check)
    .expect(not(s.label))
  run failingCheckRemovesLabelTest = init.then(ownerToggles).then(reviewNoFinding)
    .then(checksPass).then(maintainerApproves).then(check)
    .then(checksFail).then(check)
    .expect(not(s.label))
  run ownerTurningOffRemovesLabelTest = init.then(ownerToggles).then(reviewNoFinding)
    .then(checksPass).then(maintainerApproves).then(check)
    .then(ownerToggles).then(check)
    .expect(not(s.label))
  run unpaidFeeIsNeverLabelledTest = init.then(ownerToggles).then(reviewNoFinding)
    .then(checksPass).then(maintainerApproves).then(feeAsked).then(check)
    .expect(not(s.label))
  run paidFeeIsLabelledTest = init.then(ownerToggles).then(reviewNoFinding)
    .then(checksPass).then(maintainerApproves).then(feeAsked).then(check)
    .then(feeSettled).then(check)
    .expect(s.label)
  run mergedPullRequestKeepsLabelTest = init.then(ownerToggles).then(reviewNoFinding)
    .then(checksPass).then(maintainerApproves).then(check).then(humanMerges)
    .expect(s.label and s.merged)
}
