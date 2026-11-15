# Repository close capacity and the reopen-rate breaker

PRD section 5 requires caps for automatic closure and PRD section 7 forbids
multiplying a debit through retry. Source `workers/slopbot/close-attempts.ts`
(`reserveClose`, `confirmClose`, `rejectClose`, `reopenBreakerSql`),
`review.ts` (`closureState`), `contracts.ts` (`dailyCloseCap` 0 to 200,
default 25; `REOPEN_BREAKER_RATIO = 0.1`) and migration `0117`. One instance
is one registered repository. It owns the close facts (`slopbot_actions` rows
with `action = 'close'`), the unresolved close attempts and the reversal
facts that the capacity and breaker read. The per-revision attempt lifecycle
and its GitHub evidence belong to the [close attempt](./closeAttempt.md),
which consumes an admitted reservation of this machine as its `CapacityGrant`
and a refused one as its `CapacityRefusal`.

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
type ReversalKind = MaintainerReopen | UpheldFindingAppeal | UpheldValueAppeal
type ReversalEvidence = { item: str, at: int, kind: ReversalKind }
type Capacity = { repository: int, now: int, dailyCap: int, closes: List[CloseFact], pending: List[Attempt],
  rejected: List[int], reversals: List[ReversalEvidence], lastAttempt: int }
pure val daySeconds = 86400
pure val weekSeconds = 604800
pure val maxDailyCap = 200
pure val defaultDailyCap = 25
pure val initial: Capacity = { repository: 7, now: 0, dailyCap: defaultDailyCap, closes: List(), pending: List(),
  rejected: List(), reversals: List(), lastAttempt: 0 }
pure def closesInDay(c: Capacity): int = c.closes.select(f => f.closedAt > c.now - daySeconds).length()
pure def used(c: Capacity): int = closesInDay(c) + c.pending.length()
pure def withinCap(c: Capacity): bool = used(c) < c.dailyCap
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
and the distinct closed items reversed in the last seven days by a
maintainer reopen or an upheld finding appeal, when a close of the item
preceded the reversal. An item closed twice and reversed once counts once
(`COUNT(DISTINCT reversal.item_node_id)`). Value appeals are not reversals of
a close. The breaker allows a reservation when there were no recent closes
or reversed items times ten is at most the recent closes. An author's own
reopen or an unresolved appeal is a dispute, not a reversal, so authors
cannot switch closure off. The same predicate is applied to the advisory read
and to the atomic reservation.

```quint
pure def recentCloses(c: Capacity): int = c.closes.select(f => f.closedAt > c.now - weekSeconds).length()
pure def reversesClose(c: Capacity, r: ReversalEvidence): bool =
  r.at > c.now - weekSeconds and c.closes.some(f => f.key.item == r.item and f.closedAt <= r.at)
pure def reversedItems(c: Capacity): Set[str] =
  c.reversals.foldl(Set(), (acc, r) => if (reversesClose(c, r)) acc.union(Set(r.item)) else acc)
pure def breakerAllows(c: Capacity): bool = recentCloses(c) == 0 or reversedItems(c).size() * 10 <= recentCloses(c)
pure def canRecordReversal(c: Capacity, reversal: ReversalEvidence): bool =
  reversal.item != "" and reversal.at > 0 and reversal.at <= c.now and reversal.kind != UpheldValueAppeal
pure def recordReversal(c: Capacity, reversal: ReversalEvidence): Capacity =
  { ...c, reversals: c.reversals.append(reversal) }
pure def lawNoClosesNeverTrips(c: Capacity): bool = c.closes.length() == 0 implies breakerAllows(c)
pure def alwaysNoValueAppealReversals(c: Capacity): bool = c.reversals.every(r => r.kind != UpheldValueAppeal)
pure def sometimesBreakerTripped(c: Capacity): bool = not(breakerAllows(c))
pure def sometimesRepeatedItemCountedOnce(c: Capacity): bool =
  c.closes.select(f => f.key.item == "a").length() >= 2 and reversedItems(c).size() == 1 and
  c.reversals.length() >= 1
```

### A reservation is admitted only under the current registry fence and review lease, at most one pending per item

Source `reserveClose` with `VALUE_PUBLICATION_FENCE_SQL`: the same D1 write
that counts capacity also requires that the review claim is running with an
unexpired lease for the requesting token, and that the project row still has
the exact approved revision, manifest digest, active status, a non-retired
listing, the `project_enforcements` journal position and every required
repository. The partial unique index `slopbot_one_pending_close_per_item`
admits at most one pending attempt per item, whatever its revision. A
refused write returns its reason to the [close attempt](./closeAttempt.md).

```quint
type Fence = { project: int, projectRevision: int, manifestDigest: str, enforcementPosition: int }
type ReservationRequest = { key: Key, attemptId: int, fence: Fence, leaseToken: int }
type RegistryRead = { fence: Fence, projectActive: bool, listed: bool, repositoriesRegistered: bool,
  leaseToken: int, leaseRunning: bool, leaseExpiresAt: int, at: int }
type Admission = Admitted | CapReached | BreakerTripped | ItemPending | AlreadyClosed | FenceChanged | LeaseLost |
  InvalidRequest
pure def fenceHolds(request: ReservationRequest, registry: RegistryRead): bool =
  registry.fence == request.fence and registry.projectActive and registry.listed and registry.repositoriesRegistered
pure def leaseHolds(request: ReservationRequest, registry: RegistryRead): bool =
  request.leaseToken > 0 and registry.leaseToken == request.leaseToken and registry.leaseRunning and
  registry.at < registry.leaseExpiresAt
pure def admission(c: Capacity, request: ReservationRequest, registry: RegistryRead): Admission =
  if (request.key.item == "" or request.key.revision == "" or request.attemptId <= c.lastAttempt) InvalidRequest
  else if (not(leaseHolds(request, registry))) LeaseLost
  else if (not(fenceHolds(request, registry))) FenceChanged
  else if (c.closes.some(f => f.key == request.key)) AlreadyClosed
  else if (c.pending.some(a => a.key.item == request.key.item)) ItemPending
  else if (not(withinCap(c))) CapReached
  else if (not(breakerAllows(c))) BreakerTripped
  else Admitted
pure def canReserve(c: Capacity, request: ReservationRequest, registry: RegistryRead): bool =
  admission(c, request, registry) == Admitted
pure def reserve(c: Capacity, request: ReservationRequest, registry: RegistryRead): Capacity =
  { ...c, pending: c.pending.append({ key: request.key, attemptId: request.attemptId }), lastAttempt: request.attemptId }
pure def lawStaleFenceNeverAdmits(c: Capacity, request: ReservationRequest, registry: RegistryRead): bool =
  (registry.fence != request.fence or not(registry.leaseRunning) or registry.leaseToken != request.leaseToken) implies
    admission(c, request, registry) != Admitted
pure def lawPendingItemNeverAdmitsAnotherRevision(c: Capacity, request: ReservationRequest, registry: RegistryRead): bool =
  c.pending.some(a => a.key.item == request.key.item) implies admission(c, request, registry) != Admitted
```

### A reservation, its confirmation and its rejection are each recorded once, on GitHub's evidence

Confirmation needs GitHub's close event by the Slopbot App for the pending
attempt's item and revision, with its close time, and moves the attempt into
the close facts. Only a definitive 401, 403, 404, 410, 422 or 429 refusal of
the attempt's request rejects it; the rejected attempt is retained by ID and
a retry reserves a new attempt.

```quint
type CloseActor = ActorUnknown | SlopbotApp | HumanActor
type CloseEvidence = { attemptId: int, item: str, revision: str, actor: CloseActor, closedAt: int }
type GithubRefusal = { attemptId: int, status: int }
pure def definitiveRefusal(status: int): bool =
  status == 401 or status == 403 or status == 404 or status == 410 or status == 422 or status == 429
pure def pendingAttempt(c: Capacity, attemptId: int): Attempt =
  c.pending.select(a => a.attemptId == attemptId).nthOr(0, { key: { item: "", revision: "" }, attemptId: 0 })
pure def canConfirm(c: Capacity, closeEvent: CloseEvidence): bool = {
  val attempt = pendingAttempt(c, closeEvent.attemptId)
  c.pending.some(a => a.attemptId == closeEvent.attemptId) and attempt.key.item == closeEvent.item and
    attempt.key.revision == closeEvent.revision and closeEvent.actor == SlopbotApp and
    closeEvent.closedAt > 0 and closeEvent.closedAt <= c.now
}
pure def confirm(c: Capacity, closeEvent: CloseEvidence): Capacity = {
  val attempt = pendingAttempt(c, closeEvent.attemptId)
  { ...c, pending: c.pending.select(a => a.attemptId != closeEvent.attemptId),
    closes: c.closes.append({ key: attempt.key, attemptId: closeEvent.attemptId, closedAt: closeEvent.closedAt }) }
}
pure def canReject(c: Capacity, githubRefusal: GithubRefusal): bool =
  c.pending.some(a => a.attemptId == githubRefusal.attemptId) and definitiveRefusal(githubRefusal.status)
pure def reject(c: Capacity, githubRefusal: GithubRefusal): Capacity =
  { ...c, pending: c.pending.select(a => a.attemptId != githubRefusal.attemptId),
    rejected: c.rejected.append(githubRefusal.attemptId) }
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

### Simulation samples exercise caps, aging closes, reversals, stale fences and lost leases

```quint
pure val currentFence: Fence = { project: 1, projectRevision: 3, manifestDigest: "m3", enforcementPosition: 4 }
pure val requestValues = Set({ key: { item: "a", revision: "h1" }, attemptId: 1, fence: currentFence, leaseToken: 11 },
  { key: { item: "a", revision: "h2" }, attemptId: 2, fence: currentFence, leaseToken: 11 },
  { key: { item: "b", revision: "h1" }, attemptId: 3, fence: currentFence, leaseToken: 11 },
  { key: { item: "a", revision: "h1" }, attemptId: 4, fence: currentFence, leaseToken: 11 },
  { key: { item: "", revision: "h1" }, attemptId: 4, fence: currentFence, leaseToken: 11 })
pure val currentRegistry: RegistryRead = { fence: currentFence, projectActive: true, listed: true,
  repositoriesRegistered: true, leaseToken: 11, leaseRunning: true, leaseExpiresAt: 100, at: 10 }
pure val registryValues = Set(currentRegistry, { ...currentRegistry, fence: { ...currentFence, enforcementPosition: 5 } },
  { ...currentRegistry, leaseToken: 12 }, { ...currentRegistry, at: 100 })
pure val capValues = Set(0, 1, 2, 25)
pure val observedAtValues = Set(0, 10, 86400, 86411, 604800, 700000)
pure val closeEventValues = Set({ attemptId: 1, item: "a", revision: "h1", actor: SlopbotApp, closedAt: 10 },
  { attemptId: 2, item: "a", revision: "h2", actor: SlopbotApp, closedAt: 86400 },
  { attemptId: 3, item: "b", revision: "h1", actor: SlopbotApp, closedAt: 10 },
  { attemptId: 1, item: "a", revision: "h1", actor: HumanActor, closedAt: 10 },
  { attemptId: 4, item: "a", revision: "h1", actor: SlopbotApp, closedAt: 86400 })
pure val githubRefusalValues = Set({ attemptId: 1, status: 422 }, { attemptId: 2, status: 503 }, { attemptId: 3, status: 429 })
pure val reversalValues = Set({ item: "a", at: 10, kind: MaintainerReopen }, { item: "a", at: 86400, kind: UpheldFindingAppeal },
  { item: "b", at: 86400, kind: UpheldValueAppeal })
pure val weight_reserve = 8
pure val weight_confirm = 8
pure val weight_recordReversal = 5
```
