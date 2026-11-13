# Append-only Points journal

This model covers PRD sections 2 and 7. An instance represents one accepted
work source and its recipient allocation. Production keys include immutable
GitHub source IDs, project, recipient, kind, and UTC period. Frozen financial
terms remain outside retrospective Points correction.

## Story: Preserve accepted work and correct unpaid attribution

The journal credits a source once, appends corrections, and preserves approved or funded obligations.

### Original occurrence time and append-only recording history are distinct

```quint
type Journal = { sourceId: int, occurredAt: int, recordedAt: int,
  entries: List[int], workPoints: int, frozenPoints: int, financialFrozen: bool,
  credited: bool,
  historicalParticipation: int, rewardWeight: int }
pure val initial: Journal = { sourceId: 1, occurredAt: 1, recordedAt: 1,
  entries: List(), workPoints: 0, frozenPoints: 0, financialFrozen: false,
  credited: false,
  historicalParticipation: 30, rewardWeight: 0 }
pure def alwaysJournalTime(j: Journal): bool = j.recordedAt >= j.occurredAt
pure def alwaysNonnegative(j: Journal): bool = j.workPoints >= 0 and j.rewardWeight >= 0
pure def alwaysHistoryRetained(j: Journal): bool = j.sourceId == 1 and j.occurredAt == 1 and j.historicalParticipation == 30
```

### One verified accepted source creates one credit

A removed GitHub PR retains its recorded credit. Replays and indirect merges
cannot create a second entry for the same source.

```quint
pure def canCredit(j: Journal, points: int, recordedAt: int, sourceVerified: bool, accepted: bool, alreadyRewarded: bool): bool =
  not(j.credited) and points >= 10 and recordedAt >= j.recordedAt and sourceVerified and accepted and not(alreadyRewarded)
pure def credit(j: Journal, points: int, recordedAt: int, sourceVerified: bool, accepted: bool, alreadyRewarded: bool): Journal =
  { ...j, credited: true, workPoints: points, rewardWeight: points,
    recordedAt: recordedAt, entries: j.entries.append(points) }
pure def canFreeze(j: Journal): bool = j.credited and not(j.financialFrozen)
pure def freeze(j: Journal): Journal = { ...j, financialFrozen: true, frozenPoints: j.rewardWeight }
```

### Unpaid corrections append their difference without rewriting history

A reallocation without a new value assessment preserves the full source pool.
Frozen approved, funded, scheduled, or paid rewards refuse retrospective changes.

```quint
pure def canCorrect(j: Journal, newPoints: int, recordedAt: int): bool =
  j.credited and not(j.financialFrozen) and newPoints >= 10 and recordedAt >= j.recordedAt
pure def correct(j: Journal, newPoints: int, recordedAt: int): Journal =
  { ...j, workPoints: newPoints, rewardWeight: newPoints,
    recordedAt: recordedAt, entries: j.entries.append(newPoints - j.workPoints) }
pure def canReassign(j: Journal, oldPool: int, newPool: int, evidenceComplete: bool): bool =
  j.credited and not(j.financialFrozen) and evidenceComplete and oldPool == j.workPoints and newPool == oldPool
pure def reassign(j: Journal, oldPool: int, newPool: int, evidenceComplete: bool): Journal =
  { ...j, entries: j.entries.append(0) }
pure def alwaysFrozenReward(j: Journal): bool = j.financialFrozen implies j.rewardWeight == j.frozenPoints
```

### Credited and frozen source states are reachable

Monthly penalties and their reversals are applied by the aggregate monthly
Points specification. Individual source values retain their attribution and
append-only correction history.

```quint
pure def stepAppendOnly(before: Journal, after: Journal): bool = after.entries.length() >= before.entries.length()
pure def sometimesCredited(j: Journal): bool = j.credited and j.rewardWeight >= 10
pure def sometimesFrozen(j: Journal): bool = j.financialFrozen
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val newPointsValues = Set(0, 10, 30)
pure val newPoolValues = Set(0, 10, 30)
pure val oldPoolValues = Set(0, 10, 30)
pure val pointsValues = Set(0, 10, 30)
pure val recordedAtValues = Set(0, 1, 2)
```
