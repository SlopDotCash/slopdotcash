# Staging order check with one quota retry

The [release run](./release.md) publishes to staging only after the order
check of its tested `staging` revision allows it ("Production publishes
only the current main head; staging publishes a checked ancestor and never
rolls back"). This machine is one run of that check as development performs
it at df21e37b7: `scripts/check-staging-order.mjs` (commit 9d5d37765) and
development's own model `formal/models/release/staging_release_order.qnt`.
One pass fetches `staging`, requires the candidate to be an ancestor of
or equal to its tip, and reads staging's deployment history. A history
record that is not an ancestor of or equal to the candidate, and that a
release created, refuses at once; a record made by the vetting controller or
a qualification workflow is not a release and is skipped. Each record read
carries its revision, whether `git merge-base --is-ancestor` found it an
ancestor of or equal to the candidate, and whether a non-release workflow
created it; the candidate is an ancestor of or equal to itself.

A GitHub refusal that is a usable quota signal (HTTP 403 or 429 with
`x-ratelimit-remaining: 0` and a numeric reset in the future, plus one second,
and/or a numeric `retry-after`; the later of the two) is retried once, by a
whole fresh pass that discards every earlier observation. The time a pass may
use after the first refusal is bounded by the shared deadline: 120 seconds
after the check started, or the job's `STAGING_ORDER_RETRY_UNTIL` when that
is earlier. Time is in milliseconds since the check started; the shell
supplies the quota delay already parsed, and `validDelay` is false for any
header it could not use.

## Story: Allow staging publication only from one complete, fresh history read

### A quota refusal is retried once, from scratch, only when the wait ends inside the shared deadline

A second quota refusal, an unusable delay, a wait that would reach the
deadline, or any other refused read refuses the check. The retry waits until
the quota delay has passed, then fetches, checks ancestry and reads the
history again; nothing seen before the refusal counts. A retried pass still
running at the deadline is refused. The first pass is bounded only by its own
calls.

```quint
type OrderPhase = NotStarted | Inspecting | ReadingHistory | WaitingForQuota | OrderAllowed | OrderRefused
type StagingOrder = { phase: OrderPhase, candidate: int, deadline: int, now: int, retries: int, wakeAt: int,
  ancestor: bool, history: List[int], skipped: int, present: bool }
pure val retryBudgetMs = 120000
pure val initial: StagingOrder = { phase: NotStarted, candidate: 0, deadline: 0, now: 0, retries: 0, wakeAt: 0,
  ancestor: false, history: List(), skipped: 0, present: false }
pure def orderDeadline(jobDeadline: int): int =
  if (jobDeadline <= 0) 0 else if (jobDeadline < retryBudgetMs) jobDeadline else retryBudgetMs
pure def active(o: StagingOrder): bool =
  o.phase == Inspecting or o.phase == ReadingHistory or o.phase == WaitingForQuota
pure def withinDeadline(o: StagingOrder): bool = o.retries == 0 or o.now < o.deadline
pure def quotaStatus(status: int): bool = status == 403 or status == 429
pure def canBegin(o: StagingOrder, candidate: int, jobDeadline: int): bool = o.phase == NotStarted and candidate > 0
pure def begin(o: StagingOrder, candidate: int, jobDeadline: int): StagingOrder =
  { ...o, phase: Inspecting, candidate: candidate, deadline: orderDeadline(jobDeadline) }
pure def canInspect(o: StagingOrder, ancestor: bool): bool = o.phase == Inspecting and withinDeadline(o)
pure def inspect(o: StagingOrder, ancestor: bool): StagingOrder =
  if (ancestor) { ...o, phase: ReadingHistory, ancestor: true } else { ...o, phase: OrderRefused }
pure def canReadHistory(o: StagingOrder, revision: int, ancestorOrEqual: bool, nonRelease: bool): bool =
  o.phase == ReadingHistory and withinDeadline(o) and revision > 0 and (revision == o.candidate implies ancestorOrEqual)
pure def readHistory(o: StagingOrder, revision: int, ancestorOrEqual: bool, nonRelease: bool): StagingOrder =
  if (not(ancestorOrEqual) and not(nonRelease)) { ...o, phase: OrderRefused }
  else if (not(ancestorOrEqual)) { ...o, skipped: o.skipped + 1 }
  else { ...o, history: if (o.history.includes(revision)) o.history else o.history.append(revision),
    present: o.present or revision == o.candidate }
pure def canFailRead(o: StagingOrder, status: int, validDelay: bool, delay: int): bool =
  o.phase == ReadingHistory and withinDeadline(o)
pure def failRead(o: StagingOrder, status: int, validDelay: bool, delay: int): StagingOrder =
  if (quotaStatus(status) and validDelay and delay >= 0 and o.retries == 0 and o.now + delay < o.deadline)
    { ...o, phase: WaitingForQuota, retries: 1, wakeAt: o.now + delay, ancestor: false, history: List(), skipped: 0,
      present: false }
  else { ...o, phase: OrderRefused }
pure def canAdvanceClock(o: StagingOrder, elapsed: int): bool = active(o) and elapsed > 0 and o.now < o.deadline
pure def advanceClock(o: StagingOrder, elapsed: int): StagingOrder =
  { ...o, now: if (o.now + elapsed > o.deadline) o.deadline else o.now + elapsed }
pure def canResume(o: StagingOrder): bool = o.phase == WaitingForQuota and o.now >= o.wakeAt and o.now < o.deadline
pure def resume(o: StagingOrder): StagingOrder = { ...o, phase: Inspecting }
pure def canExpire(o: StagingOrder): bool = active(o) and o.retries == 1 and o.now >= o.deadline
pure def expire(o: StagingOrder): StagingOrder = { ...o, phase: OrderRefused }
pure def canFinish(o: StagingOrder): bool = o.phase == ReadingHistory and withinDeadline(o) and o.present
pure def finish(o: StagingOrder): StagingOrder = { ...o, phase: OrderAllowed }
pure def alwaysOneBoundedRetry(o: StagingOrder): bool =
  (o.retries == 0 or o.retries == 1) and o.now >= 0 and o.now <= o.deadline and o.deadline <= retryBudgetMs
    and (o.phase != NotStarted implies o.candidate > 0) and (o.phase == NotStarted implies o.now == 0 and o.retries == 0)
    and (o.phase == WaitingForQuota implies o.retries == 1 and o.wakeAt >= 0 and o.wakeAt < o.deadline)
pure def alwaysFreshPassAfterRetry(o: StagingOrder): bool =
  ((o.phase == NotStarted or o.phase == Inspecting or o.phase == WaitingForQuota) implies
    not(o.ancestor) and not(o.present) and o.history == List() and o.skipped == 0)
    and (o.phase == ReadingHistory implies o.ancestor)
    and (o.present implies o.history.includes(o.candidate))
    and o.history.every(h => h > 0) and o.skipped >= 0
pure def alwaysAllowedFromCompleteRead(o: StagingOrder): bool =
  o.phase == OrderAllowed implies o.ancestor and o.present and o.history.includes(o.candidate) and withinDeadline(o)
pure def stepRetryNeverRepeats(before: StagingOrder, after: StagingOrder): bool =
  after.retries >= before.retries and ((before.phase == OrderAllowed or before.phase == OrderRefused) implies after == before)
pure def sometimesAllowedFirstPass(o: StagingOrder): bool = o.phase == OrderAllowed and o.retries == 0
pure def sometimesAllowedAfterRetry(o: StagingOrder): bool = o.phase == OrderAllowed and o.retries == 1
pure def sometimesWaitingForQuota(o: StagingOrder): bool = o.phase == WaitingForQuota
pure def sometimesRetriedThenRefused(o: StagingOrder): bool = o.phase == OrderRefused and o.retries == 1
pure def sometimesNonReleaseSkipped(o: StagingOrder): bool = o.phase == OrderAllowed and o.skipped > 0
```

### Simulation samples cover quota and other refusals, short and long delays, and both deadlines

These sets bound simulation only.

```quint
pure val candidateValues = Set(2)
pure val jobDeadlineValues = Set(0, 90000, 600000)
pure val revisionValues = Set(1, 2, 3)
pure val statusValues = Set(403, 429, 500)
pure val delayValues = Set(0, 30000, 100000)
pure val elapsedValues = Set(10000, 60000, 120000)
pure val weight_readHistory = 6
pure val weight_finish = 4
```
