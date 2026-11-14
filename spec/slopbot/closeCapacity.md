# Repository close capacity and the reopen-rate breaker

PRD section 5 requires caps for automatic closure and PRD section 7 forbids
multiplying a debit through retry. Source `workers/slopbot/close-attempts.ts`
(`reserveClose`, `confirmClose`, `rejectClose`, `reopenBreakerSql`),
`review.ts` (`closureState`), `contracts.ts` (`dailyCloseCap` 0 to 200,
default 25; `REOPEN_BREAKER_RATIO = 0.1`) and migration `0117`. One instance
is one registered repository. It owns the close facts (`slopbot_actions` rows
with `action = 'close'`), the unresolved close attempts and the reversal
facts that the capacity and breaker read. The per-revision attempt lifecycle
and its GitHub evidence belong to [closure](./closure.md), which consumes a
reservation of this machine as its `CapacityGrant`.

## Story: Reserve a close slot before any GitHub request

### Confirmed closes in the rolling day plus every unresolved attempt consume the daily cap

One serialized D1 write reserves the slot. It counts confirmed closes whose
time is within the last 86400 seconds plus every pending attempt, and admits
the reservation only below the repository's `dailyCloseCap`. A cap of zero
admits nothing. Confirmation moves an attempt into the close facts in the
same write, so a close is never counted twice and capacity never has an
empty gap. Time alone never frees a pending attempt: only GitHub's close
evidence or a definitive refusal resolves it.

```quint
type Key = { item: str, revision: str }
type Attempt = { key: Key, attemptId: int }
type CloseFact = { key: Key, attemptId: int, closedAt: int }
type ReversalKind = MaintainerReopen | UpheldAppeal
type Reversal = { item: str, at: int, kind: ReversalKind }
type Capacity = { repository: int, now: int, dailyCap: int, closes: List[CloseFact], pending: List[Attempt],
  rejected: List[int], reversals: List[Reversal], lastAttempt: int }
pure val daySeconds = 86400
pure val weekSeconds = 604800
pure val maxDailyCap = 200
pure val defaultDailyCap = 25
pure val initial: Capacity = { repository: 7, now: 0, dailyCap: defaultDailyCap, closes: List(), pending: List(),
  rejected: List(), reversals: List(), lastAttempt: 0 }
pure def closesInDay(c: Capacity): int = c.closes.select(f => f.closedAt > c.now - daySeconds).length()
pure def used(c: Capacity): int = closesInDay(c) + c.pending.length()
pure def withinCap(c: Capacity): bool = used(c) < c.dailyCap
pure def keyBusy(c: Capacity, key: Key): bool =
  c.pending.some(a => a.key == key) or c.closes.some(f => f.key == key)
pure def canObserveTime(c: Capacity, observedAt: int): bool = observedAt >= c.now
pure def observeTime(c: Capacity, observedAt: int): Capacity = { ...c, now: observedAt }
pure def canObserveCap(c: Capacity, cap: int): bool = cap >= 0 and cap <= maxDailyCap
pure def observeCap(c: Capacity, cap: int): Capacity = { ...c, dailyCap: cap }
pure def alwaysCapInRange(c: Capacity): bool = c.dailyCap >= 0 and c.dailyCap <= maxDailyCap and c.now >= 0 and
  c.lastAttempt >= 0
pure def stepTimeMonotone(before: Capacity, after: Capacity): bool = after.now >= before.now
```

### The reopen-rate breaker stops new reservations after more than one in ten recent closes was reversed

The breaker counts this repository's Slopbot closes in the last seven days
and the closed items reversed in the last seven days by a maintainer reopen
or an upheld non-value appeal, once per item, when the close preceded the
reversal. The breaker allows a reservation when there were no recent closes
or reversed times ten is at most the recent closes. An author's own reopen or
an unresolved appeal is a dispute, not a reversal, so authors cannot switch
closure off. The same predicate is applied to the advisory read and to the
atomic reservation.

```quint
pure def recentCloses(c: Capacity): int = c.closes.select(f => f.closedAt > c.now - weekSeconds).length()
pure def reversedCloses(c: Capacity): int = c.closes.select(f => c.reversals.some(r =>
  r.item == f.key.item and r.at > c.now - weekSeconds and f.closedAt <= r.at)).length()
pure def breakerAllows(c: Capacity): bool = recentCloses(c) == 0 or reversedCloses(c) * 10 <= recentCloses(c)
pure def canRecordReversal(c: Capacity, itemNode: str, at: int): bool = itemNode != "" and at > 0 and at <= c.now
pure def recordReversal(c: Capacity, itemNode: str, at: int, kind: ReversalKind): Capacity =
  { ...c, reversals: c.reversals.append({ item: itemNode, at: at, kind: kind }) }
pure def lawNoClosesNeverTrips(c: Capacity): bool = c.closes.length() == 0 implies breakerAllows(c)
pure def sometimesBreakerTripped(c: Capacity): bool = not(breakerAllows(c))
```

### A reservation, its confirmation and its rejection are each recorded once

A reservation names a fresh attempt for an item revision that has no pending
attempt and no confirmed close. Confirmation needs GitHub's close time and
moves the attempt into the close facts. Only a definitive refusal rejects;
the rejected attempt is retained by ID and a retry reserves a new attempt.

```quint
pure def canReserve(c: Capacity, key: Key, attemptId: int): bool =
  key.item != "" and key.revision != "" and attemptId > c.lastAttempt and not(keyBusy(c, key)) and
  withinCap(c) and breakerAllows(c)
pure def reserve(c: Capacity, key: Key, attemptId: int): Capacity =
  { ...c, pending: c.pending.append({ key: key, attemptId: attemptId }), lastAttempt: attemptId }
pure def canConfirm(c: Capacity, attemptId: int, closedAt: int): bool =
  c.pending.some(a => a.attemptId == attemptId) and closedAt > 0 and closedAt <= c.now
pure def confirm(c: Capacity, attemptId: int, closedAt: int): Capacity = {
  val attempt = c.pending.select(a => a.attemptId == attemptId).nthOr(0, { key: { item: "", revision: "" }, attemptId: 0 })
  { ...c, pending: c.pending.select(a => a.attemptId != attemptId),
    closes: c.closes.append({ key: attempt.key, attemptId: attemptId, closedAt: closedAt }) }
}
pure def canReject(c: Capacity, attemptId: int): bool = c.pending.some(a => a.attemptId == attemptId)
pure def reject(c: Capacity, attemptId: int): Capacity =
  { ...c, pending: c.pending.select(a => a.attemptId != attemptId), rejected: c.rejected.append(attemptId) }
pure def alwaysAttemptsBelowLast(c: Capacity): bool =
  c.pending.every(a => a.attemptId > 0 and a.attemptId <= c.lastAttempt) and
  c.closes.every(f => f.attemptId > 0 and f.attemptId <= c.lastAttempt) and
  c.rejected.every(r => r > 0 and r <= c.lastAttempt)
pure def alwaysCloseTimesKnown(c: Capacity): bool = c.closes.every(f => f.closedAt > 0 and f.closedAt <= c.now)
pure def stepReserveWithinCapacity(before: Capacity, via: str, after: Capacity): bool =
  via == "reserve" implies withinCap(before) and breakerAllows(before)
pure def stepTimeNeverFreesPending(before: Capacity, via: str, after: Capacity): bool =
  (via == "observeTime" or via == "observeCap" or via == "recordReversal") implies after.pending == before.pending
pure def stepFactsAppendOnly(before: Capacity, after: Capacity): bool =
  after.closes.length() >= before.closes.length() and before.closes.every(f => after.closes.includes(f)) and
  after.rejected.length() >= before.rejected.length() and before.rejected.every(r => after.rejected.includes(r)) and
  after.reversals.length() >= before.reversals.length() and before.reversals.every(r => after.reversals.includes(r))
pure def stepAttemptIdsNeverReused(before: Capacity, after: Capacity): bool = after.lastAttempt >= before.lastAttempt
pure def sometimesCapReached(c: Capacity): bool = c.dailyCap > 0 and used(c) >= c.dailyCap
pure def sometimesPendingCountsAfterDay(c: Capacity): bool = c.pending.length() > 0 and c.now >= daySeconds
pure def sometimesSlotFreedByDay(c: Capacity): bool = c.closes.length() > 0 and closesInDay(c) == 0
pure def sometimesRejected(c: Capacity): bool = c.rejected.length() > 0
```

### Simulation samples exercise caps, aging closes and reversals

```quint
pure val keyValues = Set({ item: "a", revision: "h1" }, { item: "a", revision: "h2" }, { item: "b", revision: "h1" },
  { item: "", revision: "h1" })
pure val attemptIdValues = Set(1, 2, 3, 4)
pure val capValues = Set(0, 1, 2, 25)
pure val observedAtValues = Set(0, 10, 86400, 86411, 604800, 700000)
pure val closedAtValues = Set(1, 10, 86400)
pure val atValues = Set(1, 10, 86400)
pure val itemNodeValues = Set("a", "b")
pure val weight_reserve = 8
pure val weight_confirm = 8
pure val weight_recordReversal = 5
```
