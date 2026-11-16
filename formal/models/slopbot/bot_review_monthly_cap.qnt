// @source workers/slopbot/review-cap.ts
// @source workers/slopbot/review.ts
// @source migrations/0129_slopbot_review_month_starts.sql
// Free advisory reviews per repository and UTC month (operator decision,
// 16 November 2026). The cap counts distinct pull requests or issues; CAP
// abstracts FREE_REVIEWS_PER_REPO_PER_MONTH = 2000. Admission is one
// statement: an item already admitted that month is admitted again for every
// later review (new pushes, a moved base, retries) without a new row; a new
// item gets a row only below the cap. A refused new item records the skip and
// makes no model call or GitHub action. Value assessment never reads this
// state.
module bot_review_monthly_cap {
  pure val CAP = 1
  type Item = { repo: int, month: int, item: int }
  pure val ITEMS: Set[Item] = tuples(Set(1, 2), Set(1, 2), Set(1, 2))
    .map(t => { repo: t._1, month: t._2, item: t._3 })
  // status: none, admitted, skipped; reviews: model-backed reviews run
  var s: { status: Item -> str, reviews: Item -> int, valueCalls: int }
  action init = s' = { status: ITEMS.mapBy(_ => "none"),
    reviews: ITEMS.mapBy(_ => 0), valueCalls: 0 }
  def admittedItem(r: Item): bool = s.status.get(r) == "admitted"
  def used(repo: int, month: int): int =
    ITEMS.filter(r => r.repo == repo and r.month == month and admittedItem(r)).size()
  def admits(r: Item): bool = admittedItem(r) or used(r.repo, r.month) < CAP
  // One review of an item: admission, then the model call and its action.
  action review(r: Item): bool = all {
    admits(r), s.reviews.get(r) < 2,
    s' = s.with("status", s.status.set(r, "admitted"))
      .with("reviews", s.reviews.set(r, s.reviews.get(r) + 1))
  }
  action refuse(r: Item): bool = all {
    not(admits(r)), s' = s.with("status", s.status.set(r, "skipped"))
  }
  action valueAssessment = all {
    s.valueCalls < 1, s' = s.with("valueCalls", s.valueCalls + 1)
  }
  action step = {
    nondet r = ITEMS.oneOf()
    any { review(r), refuse(r), valueAssessment, s' = s }
  }
  val invariant = all {
    Set(1, 2).forall(repo => Set(1, 2).forall(month => used(repo, month) <= CAP)),
    ITEMS.forall(r => s.reviews.get(r) > 0 implies admittedItem(r)),
    ITEMS.forall(r => s.status.get(r) == "skipped" implies s.reviews.get(r) == 0),
  }
  run newItemOverCapIsSkippedTest = init
    .then(review({ repo: 1, month: 1, item: 1 }))
    .then(refuse({ repo: 1, month: 1, item: 2 }))
    .expect(used(1, 1) == CAP and s.status.get({ repo: 1, month: 1, item: 2 }) == "skipped"
      and s.reviews.get({ repo: 1, month: 1, item: 2 }) == 0)
  run admittedItemIsReviewedAgainAtCapTest = init
    .then(review({ repo: 1, month: 1, item: 1 }))
    .then(refuse({ repo: 1, month: 1, item: 2 }))
    .then(review({ repo: 1, month: 1, item: 1 }))
    .expect(used(1, 1) == CAP and s.reviews.get({ repo: 1, month: 1, item: 1 }) == 2)
  run otherRepositoryAndNewMonthAreUnaffectedTest = init
    .then(review({ repo: 1, month: 1, item: 1 }))
    .then(review({ repo: 2, month: 1, item: 2 }))
    .then(review({ repo: 1, month: 2, item: 2 }))
    .expect(used(2, 1) == 1 and used(1, 2) == 1)
  run valueAssessmentIgnoresReviewCapTest = init
    .then(review({ repo: 1, month: 1, item: 1 }))
    .then(refuse({ repo: 1, month: 1, item: 2 }))
    .then(valueAssessment)
    .expect(s.valueCalls == 1)
}
