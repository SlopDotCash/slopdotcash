# Penalty debits and their reversal

PRD section 7 "Penalties" and section 5: the published table applies only to
eligible authors of a confirmed Slopbot closure; a debit affects only that UTC
month's accepted-work Points for the author and project and cannot reduce them
below zero; it cannot change an approved, scheduled or paid award; each debit
and upheld-appeal reversal is recorded once and reopen, retry and appeal must
not multiply them; later table changes are prospective. Source
`workers/slopbot/penalties.ts` (`recordPenalty`, `reversePenalty`,
`activePenaltyPage`), migration `0064` (`slopbot_penalties`: `item_node_id`
primary key, reverse-once trigger, no delete), `src/lib/score-penalties.ts`
and `src/lib/points.ts` (bucket `actor, project, YYYY-MM`, recomputed on every
generation). The table itself is the shared
[category library](../slopbot/categories.md).

The `ConfirmedClose` record is produced only by a confirmed close attempt of
the [closure decision](../slopbot/closure.md): GitHub's close event by the
Slopbot App on the reviewed revision, after every closure gate including the
author's participation authority and non-maintainer status held at the final
recheck. Its `period` is the UTC month of that `closed_at`; deriving it is a
shell obligation. A `ReversalAuthority` comes from an upheld
[appeal](../slopbot/appeals.md) or a confirmed maintainer reopen. The
binding of both to their producing machines is an open composition
obligation.

## Story: Debit an eligible author once per pull request

### Accepted-work credits are keyed by author, project and UTC month

A credit is one accepted source's recipient share in Points (zero or more:
the ten-Point minimum belongs to the work unit, not to each recipient). The
penalty journal reads the same keyed credits that the Points journal
publishes.

```quint
import categories as F from "../slopbot/categories"
type Bucket = { actor: int, project: int, period: int }
type Credit = { source: int, bucket: Bucket, points: int }
type ReversalReason = AppealUpheld | MaintainerReopen
type PenaltyRow = { item: str, bucket: Bucket, revision: str, category: F::Category, tableVersion: int,
  debit: int, recordedAt: int, moderatorReview: bool, reversed: bool, reason: ReversalReason, reversedAt: int }
type Reopen = { item: str, revision: str, at: int }
type Frozen = { bucket: Bucket, weight: int }
type Penalties = { credits: List[Credit], rows: List[PenaltyRow], reopens: List[Reopen], frozen: List[Frozen] }
pure val initial: Penalties = { credits: List(), rows: List(), reopens: List(), frozen: List() }
pure def earned(p: Penalties, b: Bucket): int = p.credits.foldl(0, (acc, c) => acc + (if (c.bucket == b) c.points else 0))
pure def activeDebits(p: Penalties, b: Bucket): int =
  p.rows.foldl(0, (acc, r) => acc + (if (r.bucket == b and not(r.reversed)) r.debit else 0))
pure def standing(p: Penalties, b: Bucket): int =
  if (activeDebits(p, b) > earned(p, b)) 0 else earned(p, b) - activeDebits(p, b)
pure def canAddCredit(p: Penalties, source: int, bucket: Bucket, points: int): bool =
  source > 0 and points >= 0 and bucket.actor > 0 and bucket.project > 0 and bucket.period > 0 and
  not(p.credits.some(c => c.source == source and c.bucket.actor == bucket.actor))
pure def addCredit(p: Penalties, source: int, bucket: Bucket, points: int): Penalties =
  { ...p, credits: p.credits.append({ source: source, bucket: bucket, points: points }) }
pure def alwaysCreditsValid(p: Penalties): bool = p.credits.every(c => c.source > 0 and c.points >= 0 and
  c.bucket.actor > 0 and c.bucket.project > 0 and c.bucket.period > 0)
```

### A confirmed close records the published debit once per PR, never after a confirmed reopen of that revision

The debit is the table value of the closed category under the current table
version, and the row keeps that version. A category with no debit records no
row. The PR node is the key across every project and month, so a second
close, a retried job or a later revision of the same PR never debits again.
A reopen of the closed revision confirmed before the debit is written makes
the write record nothing, atomically.

```quint
type ConfirmedClose = { item: str, repository: int, revision: str, author: int, project: int,
  category: F::Category, closedAt: int, period: int }
pure def hasRow(p: Penalties, itemNode: str): bool = p.rows.some(r => r.item == itemNode)
pure def reopenedRevision(p: Penalties, itemNode: str, revision: str): bool =
  p.reopens.some(o => o.item == itemNode and o.revision == revision)
pure def canRecordPenalty(p: Penalties, close: ConfirmedClose): bool =
  close.item != "" and close.revision != "" and close.author > 0 and close.project > 0 and close.period > 0 and
  close.closedAt > 0 and F::debitFor(F::currentTableVersion, close.category) > 0 and
  not(hasRow(p, close.item)) and not(reopenedRevision(p, close.item, close.revision))
pure def recordPenalty(p: Penalties, close: ConfirmedClose): Penalties =
  { ...p, rows: p.rows.append({ item: close.item, bucket: { actor: close.author, project: close.project, period: close.period },
    revision: close.revision, category: close.category, tableVersion: F::currentTableVersion,
    debit: F::debitFor(F::currentTableVersion, close.category), recordedAt: close.closedAt,
    moderatorReview: F::moderatorReview(close.category), reversed: false, reason: AppealUpheld, reversedAt: 0 }) }
pure def alwaysOnePenaltyPerItem(p: Penalties): bool =
  p.rows.every(r => p.rows.select(o => o.item == r.item).length() == 1)
pure def alwaysPublishedDebit(p: Penalties): bool = p.rows.every(r =>
  r.debit > 0 and r.debit == F::debitFor(r.tableVersion, r.category) and F::knownTableVersion(r.tableVersion) and
  r.moderatorReview == F::moderatorReview(r.category) and r.recordedAt > 0 and r.bucket.actor > 0 and
  (r.reversed implies r.reversedAt > 0) and (not(r.reversed) implies r.reversedAt == 0))
pure def lawZeroDebitRecordsNothing(p: Penalties, close: ConfirmedClose): bool =
  F::debitFor(F::currentTableVersion, close.category) == 0 implies not(canRecordPenalty(p, close))
pure def sometimesDebited(p: Penalties): bool = p.rows.some(r => not(r.reversed))
pure def sometimesReopenBeforeRecord(p: Penalties): bool = p.reopens.length() > 0 and p.rows.length() == 0
```

### A reversal restores the debit once and covers only its own revision or an earlier debit

An upheld appeal binds the revision it was opened on and its open time; a
confirmed maintainer reopen binds the reopened revision and its event time.
Either reverses the item's debit only when the debit was recorded for that
revision or at or before that time, so a newer head's debit after a push
survives an older appeal or reopen. A reversed row is otherwise immutable and
is never reversed again.

```quint
type ReversalAuthority = { item: str, revision: str, at: int, reason: ReversalReason }
pure def canConfirmReopen(p: Penalties, reopen: Reopen): bool = reopen.item != "" and reopen.revision != "" and reopen.at > 0
pure def confirmReopen(p: Penalties, reopen: Reopen): Penalties = { ...p, reopens: p.reopens.append(reopen) }
pure def covers(r: PenaltyRow, authority: ReversalAuthority): bool =
  r.item == authority.item and (r.revision == authority.revision or r.recordedAt <= authority.at)
pure def canReversePenalty(p: Penalties, authority: ReversalAuthority): bool = authority.at > 0 and
  (authority.reason != MaintainerReopen or reopenedRevision(p, authority.item, authority.revision)) and
  p.rows.some(r => not(r.reversed) and covers(r, authority))
pure def reversePenalty(p: Penalties, authority: ReversalAuthority): Penalties =
  { ...p, rows: p.rows.listMap(r => if (not(r.reversed) and covers(r, authority))
      { ...r, reversed: true, reason: authority.reason, reversedAt: authority.at } else r) }
pure def sameDebit(x: PenaltyRow, y: PenaltyRow): bool = x.item == y.item and x.bucket == y.bucket and
  x.revision == y.revision and x.category == y.category and x.tableVersion == y.tableVersion and x.debit == y.debit and
  x.recordedAt == y.recordedAt and x.moderatorReview == y.moderatorReview
pure def stepRowsRetained(before: Penalties, after: Penalties): bool =
  after.rows.length() >= before.rows.length() and
  before.rows.every(r => after.rows.some(x => sameDebit(x, r) and (r.reversed implies x == r)))
pure def stepReopensAppendOnly(before: Penalties, after: Penalties): bool =
  after.reopens.length() >= before.reopens.length() and before.reopens.every(o => after.reopens.includes(o))
pure def sometimesAppealReversed(p: Penalties): bool = p.rows.some(r => r.reversed and r.reason == AppealUpheld)
pure def sometimesReopenReversed(p: Penalties): bool = p.rows.some(r => r.reversed and r.reason == MaintainerReopen)
pure def sometimesNewerHeadSurvives(p: Penalties): bool =
  p.rows.some(r => not(r.reversed) and p.reopens.some(o => o.item == r.item and o.revision != r.revision))
```

## Story: Standing is recomputed from the bucket, and frozen rewards never change

### Standing is the month's accepted-work credits minus active debits, never below zero, whatever the order

Standing for an author, project and month is recomputed from every credit
and every unreversed debit in that bucket on each generation, so accepted
work credited after a debit is still reduced and a reversal restores it.
Debits in other months or projects do not touch the bucket.

```quint
pure def lawStandingFloor(p: Penalties, b: Bucket): bool = standing(p, b) >= 0 and
  ((earned(p, b) >= 0 and activeDebits(p, b) >= 0) implies standing(p, b) <= earned(p, b))
pure def sometimesLateCreditDebited(p: Penalties): bool = p.rows.some(r => not(r.reversed) and
  earned(p, r.bucket) > 0 and standing(p, r.bucket) < earned(p, r.bucket))
pure def sometimesClampedAtZero(p: Penalties): bool = p.rows.some(r => not(r.reversed) and
  activeDebits(p, r.bucket) > earned(p, r.bucket))
```

### A frozen reward weight is captured once and later Points history cannot change it

The financial freeze of the month (the settlement workflow's freeze, an
owner's early finalization or the 72-hour cutoff) captures the bucket's
standing as its reward weight once. Later credits, debits, reversals and
appeals still change Points standing but never that weight.

```quint
pure def isFrozen(p: Penalties, b: Bucket): bool = p.frozen.some(f => f.bucket == b)
pure def rewardWeight(p: Penalties, b: Bucket): int =
  if (isFrozen(p, b)) p.frozen.select(f => f.bucket == b).nthOr(0, { bucket: b, weight: 0 }).weight else standing(p, b)
pure def canFreeze(p: Penalties, bucket: Bucket): bool = bucket.actor > 0 and not(isFrozen(p, bucket))
pure def freeze(p: Penalties, bucket: Bucket): Penalties =
  { ...p, frozen: p.frozen.append({ bucket: bucket, weight: standing(p, bucket) }) }
pure def alwaysFrozenWeightsNonNegative(p: Penalties): bool = p.frozen.every(f => f.weight >= 0)
pure def stepFrozenRetained(before: Penalties, after: Penalties): bool =
  after.frozen.length() >= before.frozen.length() and before.frozen.every(f => after.frozen.includes(f))
pure def sometimesPenaltyAfterFreeze(p: Penalties): bool =
  p.rows.some(r => isFrozen(p, r.bucket) and standing(p, r.bucket) != rewardWeight(p, r.bucket))
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only.

```quint
pure val bucketValues = Set({ actor: 5, project: 1, period: 11 }, { actor: 5, project: 2, period: 11 },
  { actor: 5, project: 1, period: 12 })
pure val sourceValues = Set(1, 2, 3)
pure val pointsValues = Set(0, 10, 30, 240)
pure val spamClose: ConfirmedClose = { item: "pr", repository: 7, revision: "h1", author: 5, project: 1,
  category: F::Spam, closedAt: 100, period: 11 }
pure val closeValues = Set(spamClose, { ...spamClose, revision: "h2", closedAt: 300 },
  { ...spamClose, category: F::Scam }, { ...spamClose, category: F::Duplicate },
  { ...spamClose, item: "pr2", category: F::Busywork, closedAt: 200 })
pure val reopenValues = Set({ item: "pr", revision: "h1", at: 150 }, { item: "pr", revision: "h1", at: 50 })
pure val authorityValues = Set({ item: "pr", revision: "h1", at: 150, reason: MaintainerReopen },
  { item: "pr", revision: "h1", at: 150, reason: AppealUpheld }, { item: "pr", revision: "h1", at: 50, reason: AppealUpheld },
  { item: "pr2", revision: "h9", at: 250, reason: AppealUpheld })
pure val bValues = bucketValues
pure val weight_recordPenalty = 6
pure val weight_addCredit = 5
```
