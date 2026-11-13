# Useful review credit

This model covers PRD section 7. A qualifying review has a verified immutable
review ID, an independent human recipient, useful content, and a pre-merge
occurrence time. The GitHub adapter supplies these facts and must keep original
review time across ingestion retries and edits.

## Story: Credit the first five distinct useful reviewers

Each qualifying reviewer receives their highest band. The pool is capped by
the PR's value and is allocated in ten-Point units with deterministic ties.

### Review records preserve first qualification and highest band

```quint
type Reviewer = { actor: int, band: int, firstAt: int, reviewId: int }
type Reviews = { assessed: int, reviewers: List[Reviewer], mergedAt: int, lastAt: int, lastId: int }
pure val initial: Reviews = { assessed: 10, reviewers: List(), mergedAt: 10, lastAt: 0, lastId: 0 }
pure def validBand(band: int): bool = band == 10 or band == 30 or band == 90 or band == 240
pure def alwaysAtMostFive(r: Reviews): bool = r.reviewers.length() <= 5
pure def alwaysUsefulBands(r: Reviews): bool = r.reviewers.every(v => validBand(v.band) and v.actor > 0 and v.firstAt < r.mergedAt)
pure def alwaysDistinctReviewers(r: Reviews): bool = r.reviewers.every(v =>
  r.reviewers.select(other => other.actor == v.actor).length() == 1)
```

### Qualification excludes bots, self-review, repeated comments, empty reviews, and post-merge reviews

The adapter supplies reviews in ascending occurrence-time and node-ID order.
The first five distinct qualifying reviewers are retained. Later updates to a
retained reviewer may increase their band without changing their tie priority.

```quint
pure def canRecordReview(r: Reviews, actor: int, band: int, at: int, reviewId: int,
  bot: bool, selfReview: bool, useful: bool, repeated: bool): bool =
  actor > 0 and reviewId > 0 and validBand(band) and at >= 0 and at < r.mergedAt and (at > r.lastAt or (at == r.lastAt and reviewId >= r.lastId)) and
  not(r.reviewers.some(v => v.reviewId == reviewId and v.actor != actor)) and
  not(bot) and not(selfReview) and useful and not(repeated) and
  (r.reviewers.length() < 5 or r.reviewers.some(v => v.actor == actor))
pure def recordReview(r: Reviews, actor: int, band: int, at: int, reviewId: int,
  bot: bool, selfReview: bool, useful: bool, repeated: bool): Reviews =
  { ...r, lastAt: at, lastId: reviewId, reviewers: if (r.reviewers.some(v => v.actor == actor))
      r.reviewers.listMap(v => if (v.actor == actor and band > v.band)
        { ...v, band: band } else v)
    else r.reviewers.append({ actor: actor, band: band, firstAt: at, reviewId: reviewId }) }
pure def canAssess(r: Reviews, points: int): bool = points >= 10 and points % 10 == 0
pure def assess(r: Reviews, points: int): Reviews = { ...r, assessed: points }
```

### Pool shares use ten-Point largest remainder and the original review order

```quint
pure def bandTotal(r: Reviews): int = r.reviewers.foldl(0, (acc, v) => acc + v.band)
pure def poolPoints(r: Reviews): int =
  if (r.reviewers.length() == 0) 0 else if (bandTotal(r) > r.assessed) r.assessed else bandTotal(r)
pure def reviewFloor(r: Reviews, v: Reviewer): int =
  if (bandTotal(r) > 0) (poolPoints(r) / 10) * v.band / bandTotal(r) else 0
pure def reviewRemainder(r: Reviews, v: Reviewer): int =
  if (bandTotal(r) > 0) (poolPoints(r) / 10) * v.band % bandTotal(r) else 0
pure def reviewFloorTotal(r: Reviews): int = r.reviewers.foldl(0, (acc, v) => acc + reviewFloor(r, v))
pure def reviewRank(r: Reviews, v: Reviewer): int = r.reviewers.select(other =>
  reviewRemainder(r, other) > reviewRemainder(r, v) or
  (reviewRemainder(r, other) == reviewRemainder(r, v) and
    (other.firstAt < v.firstAt or (other.firstAt == v.firstAt and other.reviewId < v.reviewId)))).length()
pure def reviewShare(r: Reviews, v: Reviewer): int = 10 * (reviewFloor(r, v) +
  (if (reviewRank(r, v) < poolPoints(r) / 10 - reviewFloorTotal(r)) 1 else 0))
pure def alwaysPoolBound(r: Reviews): bool = poolPoints(r) <= r.assessed and
  (r.reviewers.length() == 0 or poolPoints(r) >= 10)
pure def sometimesReviewed(r: Reviews): bool = r.reviewers.length() > 0
pure def sometimesFiveReviewers(r: Reviews): bool = r.reviewers.length() == 5
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val actorValues = Set(0, 1, 2, 3, 4, 5)
pure val atValues = Set(0, 1, 2)
pure val bandValues = Set(0, 10, 30, 90, 240)
pure val pointsValues = Set(0, 10, 30, 90)
pure val reviewIdValues = Set(0, 1, 2, 3, 4, 5)
```
