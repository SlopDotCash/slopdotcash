// @source workers/slopbot/value-disputes.ts
// @source workers/slopbot/value-evidence.ts
// @evidence workers/slopbot/penalty-appeal.test.ts
// One affectedValueActor invocation. Actor lookup, a retained joint claim,
// reviewed-source membership and current-head commit authorship are distinct
// evidence. The caller separately permits PR authors and maintainers.
// Review page classes 1 and 30 compress identical intervening full nonmatches.
// An unavailable review page or 30 full nonmatching pages fails before commits
// are inspected. A match on a full last review page succeeds before the cap.
// Commit counts 250/251 are boundary representatives. Every eligibility lookup
// requires a complete immutable range, even when the PR list looks complete.
// Its count, unique valid SHAs and every observed commit must reconcile. These predicates
// are abstract inputs, not proofs of GitHub truth or the pagination algorithm.
// Metadata must still identify the retained PR and captured current head.
// currentHead is an observation; no continuous live authority is claimed.
// No GitHub requests or checks have been executed for this model.
module bot_value_dispute_actor {
  var s: { phase: str, joint: bool, claim: bool, head: bool, page: int,
    eligible: bool, reason: str, commitQueries: bool, listMatch: bool, listComplete: bool,
    commitComplete: bool, compared: bool }
  action init = s' = { phase: "idle", joint: false, claim: false, head: false,
    page: 1, eligible: false, reason: "none", commitQueries: false,
    listMatch: false, listComplete: false, commitComplete: false, compared: false }
  action begin(joint: bool, claim: bool, readHead: bool): bool = all { s.phase == "idle",
    s' = s.with("phase", "actor").with("joint", joint).with("claim", claim).with("head", readHead) }
  action actorReply(valid: bool): bool = all { s.phase == "actor",
    s' = if (valid) s.with("phase", "claim") else s.with("phase", "done").with("reason", "unknown-actor") }
  action retainedClaim = all { s.phase == "claim",
    s' = if (s.joint and s.claim) s.with("phase", "done").with("eligible", true).with("reason", "joint-claim")
      else s.with("phase", "reviews") }
  action pageReply(evidence: str, full: bool): bool = {
    all { s.phase == "reviews", Set("match", "unrelated", "none", "unavailable").contains(evidence),
      s' = if (evidence == "unavailable") s.with("phase", "error").with("reason", "unavailable")
        else if (evidence == "match") s.with("phase", "done").with("eligible", true)
          .with("reason", "retained-review")
        else if (full and s.page == 30) s.with("phase", "error").with("reason", "incomplete")
        else if (full) s.with("page", 30)
        else if (s.head) s.with("phase", "metadata").with("page", 1).with("commitQueries", true)
        else s.with("phase", "done").with("reason", "unaffected") }
  }
  action metadataReply(kind: str): bool = all { s.phase == "metadata", Set("valid", "unavailable", "changed").contains(kind),
    s' = if (kind == "valid") s.with("phase", "commit-list")
      else s.with("phase", "error").with("reason", kind) }
  action commitList(complete: bool, matches: bool): bool = all { s.phase == "commit-list",
    s' = s.with("listMatch", matches).with("listComplete", complete)
      .with("commitComplete", false).with("phase", "comparison") }
  action comparison(valid: bool, matches: bool): bool = all { s.phase == "comparison",
    s' = s.with("compared", true).with("commitComplete", valid)
      .with("phase", if (valid) "done" else "error")
      .with("eligible", valid and matches)
      .with("reason", if (not(valid)) "incomplete" else if (matches) "current-head-author" else "unaffected") }
  action commitFailure = all { Set("commit-list", "comparison").contains(s.phase),
    s' = s.with("phase", "error").with("reason", "unavailable") }
  action oldTruncatedListLooksComplete = all { s.phase == "comparison", not(s.listMatch),
    s' = s.with("phase", "done").with("reason", "unaffected") }
  action oldMutableListQualifies = all { s.phase == "comparison", s.listComplete, s.listMatch,
    s' = s.with("phase", "done").with("eligible", true).with("reason", "current-head-author") }
  action actorFailure = all { s.phase == "actor", s' = s.with("phase", "error").with("reason", "unavailable") }
  action step = {
    nondet yes = Set(false, true).oneOf()
    nondet claim = Set(false, true).oneOf()
    nondet readHead = Set(false, true).oneOf()
    nondet evidence = Set("match", "unrelated", "none", "unavailable").oneOf()
    nondet metadata = Set("valid", "unavailable", "changed").oneOf()
    any { begin(yes, claim, readHead), actorReply(yes), retainedClaim, pageReply(evidence, yes), actorFailure,
      metadataReply(metadata), commitList(yes, claim), comparison(yes, claim), commitFailure, s' = s }
  }
  val invariant = all { Set(1, 30).contains(s.page),
    s.commitQueries implies s.head,
    s.eligible implies s.phase == "done" and Set("joint-claim", "retained-review", "current-head-author").contains(s.reason),
    s.reason == "joint-claim" implies s.joint and s.claim,
    s.reason == "current-head-author" implies s.head and s.commitQueries and s.commitComplete,
    s.phase == "done" and s.commitQueries implies s.commitComplete }
  action reviews(readHead: bool): bool = begin(false, false, readHead).then(actorReply(true)).then(retainedClaim)
  action commits = reviews(true).then(pageReply("none", false)).then(metadataReply("valid"))
  run unknownActorIsNotAffectedTest = init.then(begin(true, true, true)).then(actorReply(false))
    .expect(not(s.eligible) and not(s.commitQueries) and invariant)
  run unavailableActorLookupThrowsTest = init.then(begin(false, false, true)).then(actorFailure)
    .expect(s.phase == "error" and invariant)
  run retainedJointClaimNeedsNoLiveHeadTest = init.then(begin(true, true, false)).then(actorReply(true)).then(retainedClaim)
    .expect(s.eligible and s.reason == "joint-claim" and not(s.commitQueries) and invariant)
  run singleClaimCannotBypassReviewsTest = init.then(begin(false, true, false)).then(actorReply(true)).then(retainedClaim)
    .expect(s.phase == "reviews" and not(s.eligible) and invariant)
  run retainedReviewedSourceQualifiesTest = init.then(reviews(false)).then(pageReply("match", false))
    .expect(s.eligible and s.reason == "retained-review" and invariant)
  run unreviewedCommentDoesNotQualifyTest = init.then(reviews(false)).then(pageReply("unrelated", false))
    .expect(not(s.eligible) and not(s.commitQueries) and invariant)
  run changedHeadSkipsCommitAuthorsTest = init.then(reviews(false)).then(pageReply("none", false))
    .expect(s.reason == "unaffected" and not(s.commitQueries) and invariant)
  run matchingHeadMayCheckCommitAuthorsTest = init.then(commits).then(commitList(true, true)).then(comparison(true, true))
    .expect(s.eligible and s.reason == "current-head-author" and invariant)
  run absentCommitAuthorDoesNotQualifyTest = init.then(commits).then(commitList(true, false)).then(comparison(true, false))
    .expect(not(s.eligible) and s.reason == "unaffected" and invariant)
  run unavailableReviewsDoNotFallBackToCommitsTest = init.then(reviews(true)).then(pageReply("unavailable", false))
    .expect(s.phase == "error" and not(s.commitQueries) and invariant)
  run fullLastReviewPageMatchSucceedsTest = init.then(reviews(true)).then(pageReply("none", true)).then(pageReply("match", true))
    .expect(s.page == 30 and s.eligible and invariant)
  run fullLastReviewPageWithoutMatchIsIncompleteTest = init.then(reviews(true)).then(pageReply("none", true)).then(pageReply("none", true))
    .expect(s.phase == "error" and s.reason == "incomplete" and not(s.commitQueries) and invariant)
  run truncatedCommitListUsesCompleteComparisonTest = init.then(commits).then(commitList(false, false)).then(comparison(true, true))
    .expect(s.eligible and s.compared and s.commitComplete and invariant)
  run invalidCompleteComparisonFailsTest = init.then(commits).then(commitList(false, false)).then(comparison(false, true))
    .expect(s.phase == "error" and not(s.eligible) and invariant)
  run changedMetadataHeadRefusesAtObservationTest = init.then(reviews(true)).then(pageReply("none", false)).then(metadataReply("changed"))
    .expect(s.phase == "error" and not(s.commitComplete) and invariant)
  run invalidMetadataRefusesBeforeCommitListTest = init.then(reviews(true)).then(pageReply("none", false)).then(metadataReply("unavailable"))
    .expect(s.phase == "error" and not(s.commitComplete) and invariant)
  run matchingPrefixCannotHideIncompleteComparisonTest = init.then(commits).then(commitList(false, true)).then(comparison(false, false))
    .expect(s.phase == "error" and not(s.eligible) and invariant)
  run completeComparisonWithoutAuthorRefusesTest = init.then(commits).then(commitList(false, false)).then(comparison(true, false))
    .expect(s.phase == "done" and not(s.eligible) and s.commitComplete and invariant)
  run completeComparisonOwnsFinalAuthorObservationTest = init.then(commits).then(commitList(false, true)).then(comparison(true, false))
    .expect(s.phase == "done" and not(s.eligible) and s.commitComplete and invariant)
  run unavailableCommitListingFailsTest = init.then(commits).then(commitFailure)
    .expect(s.phase == "error" and not(s.eligible) and invariant)
  run unavailableComparisonFailsTest = init.then(commits).then(commitList(false, false)).then(commitFailure)
    .expect(s.phase == "error" and not(s.eligible) and invariant)
  run oldShortPageNegativeControlTest = init.then(commits).then(commitList(false, false)).then(oldTruncatedListLooksComplete)
    .expect(not(invariant))
  run completeMutableListStillNeedsComparisonTest = init.then(commits).then(commitList(true, true))
    .expect(s.phase == "comparison" and not(s.eligible) and not(s.commitComplete) and invariant)
  run changedSameCountCommitSetRefusesTest = init.then(commits).then(commitList(true, true)).then(comparison(false, false))
    .expect(s.phase == "error" and not(s.eligible) and invariant)
  run oldMutableListNegativeControlTest = init.then(commits).then(commitList(true, true)).then(oldMutableListQualifies)
    .expect(not(invariant))
}
