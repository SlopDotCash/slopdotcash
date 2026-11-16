// @source workers/slopbot/review-cap.ts
// @source workers/slopbot/review.ts
// @source migrations/0129_slopbot_review_month_starts.sql
// Free advisory reviews per repository and UTC month (operator decision,
// 16 November 2026). CAP abstracts FREE_REVIEWS_PER_REPO_PER_MONTH = 2000.
// Admission is one statement: a review key already started in that month is
// admitted again without a new row; otherwise a row is added only below the
// cap. A refused review records the skip and makes no model call or GitHub
// action. Value assessment never reads this state.
module bot_review_monthly_cap {
  pure val CAP = 1
  type Start = { repo: int, month: int, key: int }
  pure val STARTS: Set[Start] = tuples(Set(1, 2), Set(1, 2), Set(1, 2))
    .map(t => { repo: t._1, month: t._2, key: t._3 })
  // none, started (row recorded), called, published, skipped
  var s: { status: Start -> str, valueCalls: int }
  action init = s' = { status: STARTS.mapBy(_ => "none"), valueCalls: 0 }
  def started(r: Start): bool = s.status.get(r).in(Set("started", "called", "published"))
  def used(repo: int, month: int): int =
    STARTS.filter(r => r.repo == repo and r.month == month and started(r)).size()
  def admitted(r: Start): bool = started(r) or used(r.repo, r.month) < CAP
  action admitReview(r: Start): bool = all {
    admitted(r), not(started(r)),
    s' = s.with("status", s.status.set(r, "started"))
  }
  action readmitReview(r: Start): bool = all { started(r), s' = s }
  action refuseReview(r: Start): bool = all {
    not(admitted(r)), s' = s.with("status", s.status.set(r, "skipped"))
  }
  // Primary and confirmation calls, and their advisory action, need admission.
  action modelCall(r: Start): bool = all {
    s.status.get(r) == "started", s' = s.with("status", s.status.set(r, "called"))
  }
  action publish(r: Start): bool = all {
    s.status.get(r) == "called", s' = s.with("status", s.status.set(r, "published"))
  }
  action valueAssessment = all {
    s.valueCalls < 1, s' = s.with("valueCalls", s.valueCalls + 1)
  }
  action step = {
    nondet r = STARTS.oneOf()
    any { admitReview(r), refuseReview(r), modelCall(r), publish(r),
      valueAssessment, s' = s }
  }
  val invariant = Set(1, 2).forall(repo => Set(1, 2).forall(month => used(repo, month) <= CAP))
  run capRefusesNextReviewTest = init
    .then(admitReview({ repo: 1, month: 1, key: 1 }))
    .then(refuseReview({ repo: 1, month: 1, key: 2 }))
    .expect(used(1, 1) == CAP and s.status.get({ repo: 1, month: 1, key: 2 }) == "skipped")
  run retryOfStartedReviewIsNotCountedTwiceTest = init
    .then(admitReview({ repo: 1, month: 1, key: 1 }))
    .then(modelCall({ repo: 1, month: 1, key: 1 }))
    .then(readmitReview({ repo: 1, month: 1, key: 1 }))
    .expect(used(1, 1) == CAP)
  run otherRepositoryAndNewMonthAreUnaffectedTest = init
    .then(admitReview({ repo: 1, month: 1, key: 1 }))
    .then(admitReview({ repo: 2, month: 1, key: 2 }))
    .then(admitReview({ repo: 1, month: 2, key: 2 }))
    .expect(used(2, 1) == 1 and used(1, 2) == 1)
  run valueAssessmentIgnoresReviewCapTest = init
    .then(admitReview({ repo: 1, month: 1, key: 1 }))
    .then(refuseReview({ repo: 1, month: 1, key: 2 }))
    .then(valueAssessment)
    .expect(s.valueCalls == 1)
}
