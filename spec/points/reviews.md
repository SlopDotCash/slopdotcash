# Useful review credit

This model covers PRD section 7. A qualifying review has a verified immutable
review ID, an independent human recipient, useful content, and a pre-merge
occurrence time. The GitHub adapter supplies these facts and must keep original
review time across ingestion retries and edits.

## Story: Credit the first five distinct useful reviewers

Each qualifying reviewer receives their highest band. The pool is capped by
the PR's value and is allocated in ten-Point units with deterministic ties.

### Review records preserve first qualification and highest band

Discovered by the proof review, an empty synthetic review state with a
five-Point assessment satisfied the prior invariants and accepted a first
review below the ten-Point minimum. Assessments are now one of the published
size bands, which all meet the minimum. Credit exists only for a merged PR:
the merge time is observed once and every credited review precedes it. Once
the shares are written to the Points journal the record is closed; a later
assessment or review appends a correction there instead.

```quint
type Reviewer = { actor: int, band: int, firstAt: int, reviewId: int }
type Reviews = { prAuthor: int, merged: bool, journaled: bool, assessed: int, reviewers: List[Reviewer],
  mergedAt: int, lastAt: int, lastId: int, restarts: int, corrections: List[int] }
pure val initial: Reviews = { prAuthor: 9, merged: false, journaled: false, assessed: 10, reviewers: List(),
  mergedAt: 0, lastAt: 0, lastId: 0, restarts: 0, corrections: List() }
pure def validBand(band: int): bool = band == 10 or band == 30 or band == 90 or band == 240
pure def sizeBand(points: int): bool =
  points == 10 or points == 30 or points == 90 or points == 240 or points == 450 or points == 750
pure def alwaysAssessmentValid(r: Reviews): bool = sizeBand(r.assessed) and r.assessed >= 10 and r.assessed % 10 == 0
pure def alwaysAtMostFive(r: Reviews): bool = r.reviewers.length() <= 5
pure def alwaysUsefulBands(r: Reviews): bool = r.reviewers.every(v => validBand(v.band) and v.actor > 0 and
  v.actor != r.prAuthor and v.firstAt < r.mergedAt)
pure def alwaysDistinctReviewers(r: Reviews): bool = r.reviewers.every(v =>
  r.reviewers.select(other => other.actor == v.actor).length() == 1)
pure def alwaysCreditOnlyAfterMerge(r: Reviews): bool =
  (not(r.merged) implies r.reviewers.length() == 0 and r.mergedAt == 0 and not(r.journaled) and
    r.corrections.length() == 0) and
  (r.merged implies r.mergedAt > 0)
pure def canObserveMerge(r: Reviews, at: int): bool = not(r.merged) and at > 0
pure def observeMerge(r: Reviews, at: int): Reviews = { ...r, merged: true, mergedAt: at }
pure def stepMergeAndAuthorFixed(before: Reviews, after: Reviews): bool = after.prAuthor == before.prAuthor and
  (before.merged implies after.merged and after.mergedAt == before.mergedAt) and
  (before.journaled implies after.journaled and after.assessed == before.assessed and after.reviewers == before.reviewers) and
  before.corrections.every(id => after.corrections.includes(id)) and after.corrections.length() >= before.corrections.length()
```

### Qualification excludes bots, self-review, repeated comments, empty reviews, and post-merge reviews

The GitHub review evidence names the review's immutable ID, its author and
author type, the PR author and its submission time; the value assessment
supplies its band and whether it is a repeated low-value, empty or duplicate
review. Bot and self-review are derived from those identities here, never
asserted by a caller. The adapter supplies reviews in ascending
occurrence-time and node-ID order; the first five distinct qualifying
reviewers are retained and later updates may raise a retained reviewer's
band without changing their tie priority. Ordering by occurrence time is an
adapter obligation, with two recovery paths when it fails. Before the shares
are journaled, an earlier qualifying review ingested after a later one
restarts the record: the retained reviewers are cleared and the adapter
supplies the complete review list again in order. After journaling, it is
recorded once as a correction request that the Points journal must resolve
by an appended correction ([corrections](./corrections.md)); the journaled
shares are never rewritten.

```quint
type ActorKind = HumanUser | BotUser
type ReviewEvidence = { reviewId: int, actor: int, actorKind: ActorKind, prAuthor: int, at: int, band: int,
  repeated: bool, emptyOrDuplicate: bool }
pure def qualifies(r: Reviews, e: ReviewEvidence): bool =
  e.actor > 0 and e.reviewId > 0 and e.actorKind == HumanUser and e.prAuthor == r.prAuthor and
  e.actor != r.prAuthor and validBand(e.band) and not(e.repeated) and not(e.emptyOrDuplicate) and
  e.at >= 0 and r.merged and e.at < r.mergedAt
pure def canRecordReview(r: Reviews, evidence: ReviewEvidence): bool =
  qualifies(r, evidence) and not(r.journaled) and
  (evidence.at > r.lastAt or (evidence.at == r.lastAt and evidence.reviewId >= r.lastId)) and
  not(r.reviewers.some(v => v.reviewId == evidence.reviewId and v.actor != evidence.actor)) and
  (r.reviewers.length() < 5 or r.reviewers.some(v => v.actor == evidence.actor))
pure def recordReview(r: Reviews, evidence: ReviewEvidence): Reviews =
  { ...r, lastAt: evidence.at, lastId: evidence.reviewId, reviewers: if (r.reviewers.some(v => v.actor == evidence.actor))
      r.reviewers.listMap(v => if (v.actor == evidence.actor and evidence.band > v.band)
        { ...v, band: evidence.band } else v)
    else r.reviewers.append({ actor: evidence.actor, band: evidence.band, firstAt: evidence.at, reviewId: evidence.reviewId }) }
pure def lawBotAndSelfNeverQualify(r: Reviews, evidence: ReviewEvidence): bool =
  (evidence.actorKind == BotUser or evidence.actor == r.prAuthor) implies not(qualifies(r, evidence))
pure def lawPostMergeNeverQualifies(r: Reviews, evidence: ReviewEvidence): bool =
  evidence.at >= r.mergedAt implies not(qualifies(r, evidence))
pure def outOfOrder(r: Reviews, e: ReviewEvidence): bool =
  e.at < r.lastAt or (e.at == r.lastAt and e.reviewId < r.lastId)
pure def canRestartOrder(r: Reviews, evidence: ReviewEvidence): bool =
  qualifies(r, evidence) and not(r.journaled) and outOfOrder(r, evidence)
pure def restartOrder(r: Reviews, evidence: ReviewEvidence): Reviews =
  { ...r, reviewers: List(), lastAt: 0, lastId: 0, restarts: r.restarts + 1 }
pure def canRequestCorrection(r: Reviews, evidence: ReviewEvidence): bool =
  qualifies(r, evidence) and r.journaled and outOfOrder(r, evidence) and
  not(r.reviewers.some(v => v.reviewId == evidence.reviewId)) and not(r.corrections.includes(evidence.reviewId))
pure def requestCorrection(r: Reviews, evidence: ReviewEvidence): Reviews =
  { ...r, corrections: r.corrections.append(evidence.reviewId) }
pure def alwaysCorrectionsOnlyAfterJournal(r: Reviews): bool =
  (r.corrections.length() > 0 implies r.journaled) and r.corrections.every(id => id > 0) and r.restarts >= 0
pure def sometimesRestartedThenReviewed(r: Reviews): bool = r.restarts > 0 and r.reviewers.length() > 0
pure def sometimesCorrectionRequested(r: Reviews): bool = r.corrections.length() > 0
pure def canAssess(r: Reviews, points: int): bool = sizeBand(points) and r.merged and not(r.journaled)
pure def assess(r: Reviews, points: int): Reviews = { ...r, assessed: points }
pure def canJournal(r: Reviews): bool = r.merged and not(r.journaled)
pure def journal(r: Reviews): Reviews = { ...r, journaled: true }
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

### A review is empty unless it is an approval or a change request with twenty substantive characters or an inline comment

This is the substance test of `src/lib/leaderboard.ts`
(`reviewExclusionReason`, `hasSubstantiveReviewBody`). Only the review
states `APPROVED` and `CHANGES_REQUESTED` are decisions; a comment-only,
dismissed or pending review is `non-decision`. A decision is substantive
when its body, with HTML comments removed, the characters `#`, `*`, `_`,
`>`, the backtick, `~`, `[`, `]`, `(`, `)`, `!` and `-` deleted and the ends
trimmed, has at least 20 characters, or when it has an inline comment;
otherwise it is `insufficient-substance`. The adapter counts the characters
and supplies the number.

The test applies where production applies it: to the qualification of a
pull request merged before the value policy, and to the open pull request
hint that a decided review still needs substance to qualify after merge
(`isExpandableReviewOpportunity`). The five-reviewer pool of this file
(bands 10, 30, 90 and 240) is the value-policy pool
(`valueReviewCandidate`): it refuses a missing or bot reviewer, a missing
time, a review at or after the merge and an external-prize repository, and
otherwise takes the assessment's verdict alone. For this pool the adapter
sets `ReviewEvidence.emptyOrDuplicate` from the assessment only, never from
`emptyReview`, so a comment-only or short review the assessment credits
keeps its band.

```quint
type ReviewDecision = ApprovedDecision | ChangesRequestedDecision | CommentedOnly | DismissedReview | PendingReview
type ReviewContent = { decision: ReviewDecision, substantiveChars: int, inlineComments: int }
pure val substantiveMinimum = 20
pure def decided(content: ReviewContent): bool =
  content.decision == ApprovedDecision or content.decision == ChangesRequestedDecision
pure def emptyReview(content: ReviewContent): bool =
  not(decided(content) and (content.substantiveChars >= substantiveMinimum or content.inlineComments > 0))
pure def lawNonDecisionIsEmpty(content: ReviewContent): bool = not(decided(content)) implies emptyReview(content)
pure def lawSubstantiveDecisionIsNotEmpty(content: ReviewContent): bool =
  (decided(content) and (content.substantiveChars >= substantiveMinimum or content.inlineComments > 0)) implies
    not(emptyReview(content))
pure val substantiveApproval: ReviewContent = { decision: ApprovedDecision, substantiveChars: 20, inlineComments: 0 }
pure val contentValues = Set(substantiveApproval, { ...substantiveApproval, substantiveChars: 19 },
  { ...substantiveApproval, decision: ChangesRequestedDecision, substantiveChars: 0, inlineComments: 1 },
  { ...substantiveApproval, decision: CommentedOnly, substantiveChars: 400, inlineComments: 3 },
  { ...substantiveApproval, decision: DismissedReview }, { ...substantiveApproval, decision: PendingReview })
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val review1: ReviewEvidence = { reviewId: 1, actor: 1, actorKind: HumanUser, prAuthor: 9, at: 1, band: 30,
  repeated: false, emptyOrDuplicate: false }
pure val evidenceValues = Set(review1, { ...review1, reviewId: 2, actor: 2, at: 2, band: 90 },
  { ...review1, reviewId: 3, actor: 3, at: 2, band: 10 }, { ...review1, reviewId: 4, actor: 4, at: 3, band: 240 },
  { ...review1, reviewId: 5, actor: 5, at: 3 }, { ...review1, reviewId: 6, actor: 6, at: 4 },
  { ...review1, reviewId: 7, actor: 1, at: 4, band: 90 }, { ...review1, reviewId: 8, actor: 7, actorKind: BotUser, at: 4 },
  { ...review1, reviewId: 9, actor: 9, at: 4 }, { ...review1, reviewId: 10, actor: 8, at: 4, repeated: true },
  { ...review1, reviewId: 11, actor: 8, at: 9 })
pure val atValues = Set(0, 5, 8)
pure val pointsValues = Set(0, 10, 30, 90, 450, 20)
pure def sometimesJournaled(r: Reviews): bool = r.journaled and r.reviewers.length() > 0
```
