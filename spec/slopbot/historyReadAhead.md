# Read the first history pages ahead of the in-order reader

The operator decision of 21 November 2026 (main PRD section 9; development
7f71c6ce9, main `bcdaf1161`, development pull request 3222 `e34d7edad`): the
value collection may read the first history pages of its outcomes ahead of the
in-order reader, a bounded number at once and within a bounded window in front
of the loop, to save waiting. Source `scripts/value-ingestion.ts`
(`loadValueInputs`, `warmFirstHistoryPages`, `valueFeedConcurrency`),
`scripts/value-history-prefetch.test.ts` and development's own model
`formal/models/slopbot/value_history_warmup.qnt`.

One instance is one collection's read of the histories of its outcomes, in
the order the collection lists them, numbered from 1. The reading of one
outcome's history, its pages, boundaries and selection, is the
[value history selection](./valueHistory.md); this machine only says which
first pages may come from a read-ahead and that a read-ahead decides
nothing. The shell keys each warmed page by the outcome's position and the
exact arguments of its first read (repository, pull request number,
repository node ID), and the in-order reader takes an empty warmed page only
for its own first read with those arguments: the first joint page (from
sequence 0, no fixed boundary) and, after an empty joint history, the first
single page. A page that carries records is read again in the loop's turn so
records published or replaced during the loop are read live.

## Story: Save waiting on the first history pages without changing a decision

> As an operator collecting value, I want the first history page of each
> outcome read ahead a few at a time within a bounded window beside the loop,
> so a collection waits less without reading stale records far ahead, while
> every decision, hold and reported failure stays exactly what the reader
> that reads one page at a time would give.

### First history pages may be read ahead beside the loop within a bounded window and decide nothing

The concurrency is `SLOP_VALUE_FEED_CONCURRENCY`: one or two digits, from
1 to 16, 1 when unset (the release sets 6); any other value stops the
collection before it reads any history. With 1, or with no outcomes, nothing is read
ahead. Otherwise, after each outcome's repository is resolved once, in
order (one that cannot be resolved is left to the in-order reader, as is
every outcome of a repository that failed before), read-ahead runs beside
the loop, staying at most `2 * concurrency` outcomes in front of the loop's
current position and sharing the `concurrency` limit with the loop. Each read
takes an outcome strictly ahead of the loop within the window: its first joint
page and, when that joint history is empty (no records, no continuation, a
total of 0) and nothing has failed, its first single page. A read-ahead
that fails is dropped and ends the read-ahead: no further outcome is
started, the reads already running finish, and nothing is reported.

```quint
type ReadAheadPhase = Unconfigured | Running | ReadFailed | AllRead
type ReadAhead = { phase: ReadAheadPhase, concurrency: int, outcomeCount: int, at: int, reading: Set[int],
  warmed: Set[int], empty: Set[int], dropped: Set[int], taken: Set[int], live: Set[int], failedAt: int, aheadOff: bool }
pure val maxConcurrency = 16
pure val initial: ReadAhead = { phase: Unconfigured, concurrency: 1, outcomeCount: 0, at: 0, reading: Set(),
  warmed: Set(), empty: Set(), dropped: Set(), taken: Set(), live: Set(), failedAt: 0, aheadOff: false }
pure def validConcurrency(concurrency: int): bool = concurrency >= 1 and concurrency <= maxConcurrency
pure def readsAhead(concurrency: int, outcomeCount: int): bool = concurrency > 1 and outcomeCount > 0
pure def readAheadWindow(concurrency: int): int = 2 * concurrency
pure def started(r: ReadAhead): Set[int] = r.reading.union(r.warmed).union(r.dropped)
pure def canBegin(r: ReadAhead, concurrency: int, outcomeCount: int): bool =
  r.phase == Unconfigured and validConcurrency(concurrency) and outcomeCount >= 0
pure def begin(r: ReadAhead, concurrency: int, outcomeCount: int): ReadAhead =
  { ...r, phase: Running, concurrency: concurrency, outcomeCount: outcomeCount,
    aheadOff: not(readsAhead(concurrency, outcomeCount)) }
pure def canStartRead(r: ReadAhead, position: int): bool =
  r.phase == Running and not(r.aheadOff) and r.dropped.size() == 0 and position > r.at and
    position <= r.outcomeCount and position <= r.at + readAheadWindow(r.concurrency) and
    not(started(r).contains(position)) and r.reading.size() < r.concurrency
pure def startRead(r: ReadAhead, position: int): ReadAhead =
  { ...r, reading: r.reading.union(Set(position)) }
pure def canFinishRead(r: ReadAhead, position: int, isEmpty: bool): bool =
  r.phase == Running and r.reading.contains(position)
pure def finishRead(r: ReadAhead, position: int, isEmpty: bool): ReadAhead =
  { ...r, reading: r.reading.exclude(Set(position)), warmed: r.warmed.union(Set(position)),
    empty: if (isEmpty) r.empty.union(Set(position)) else r.empty }
pure def canDropRead(r: ReadAhead, position: int): bool =
  r.phase == Running and r.reading.contains(position)
pure def dropRead(r: ReadAhead, position: int): ReadAhead =
  { ...r, reading: r.reading.exclude(Set(position)), dropped: r.dropped.union(Set(position)), aheadOff: true }
pure def alwaysConcurrencyInRange(r: ReadAhead): bool = validConcurrency(r.concurrency) and r.outcomeCount >= 0
pure def alwaysReadsWithinConcurrency(r: ReadAhead): bool = r.reading.size() <= r.concurrency
pure def alwaysReadsWithinWindow(r: ReadAhead): bool =
  r.reading.forall(p => p >= 1 and p <= r.outcomeCount and p <= r.at + readAheadWindow(r.concurrency))
pure def alwaysNoReadsWhenFinished(r: ReadAhead): bool = r.phase == AllRead implies r.reading.size() == 0
pure def alwaysSetsDisjoint(r: ReadAhead): bool =
  r.reading.intersect(r.warmed).size() == 0 and r.reading.intersect(r.dropped).size() == 0 and
    r.warmed.intersect(r.dropped).size() == 0 and r.empty.subseteq(r.warmed)
pure def alwaysNoReadAheadWithoutConcurrency(r: ReadAhead): bool =
  (r.phase == Unconfigured or not(readsAhead(r.concurrency, r.outcomeCount))) implies
    (r.reading.size() == 0 and r.warmed.size() == 0 and r.empty.size() == 0 and r.dropped.size() == 0)
pure def stepNoReadStartsAfterADrop(before: ReadAhead, via: str, after: ReadAhead): bool =
  via == "startRead" implies before.dropped.size() == 0
pure def lawInvalidConcurrencyReadsNothing(concurrency: int, outcomeCount: int): bool =
  not(validConcurrency(concurrency)) implies not(canBegin(initial, concurrency, outcomeCount))
pure def sometimesReadAheadFull(r: ReadAhead): bool = r.phase == Running and r.reading.size() == r.concurrency and r.concurrency > 1
pure def sometimesReadAheadDropped(r: ReadAhead): bool = r.phase == Running and r.dropped.size() > 0 and r.warmed.size() > 0
```

### The in-order reader takes each empty warmed page once and reads every other page itself

The in-order reader advances through the outcomes in order and decides them as
the reader without read-ahead does: for an outcome whose first pages were
warmed and empty it takes them, once; for any other outcome — one with records,
a dropped one, or one not read ahead — it waits for any in-flight read of that
outcome to finish and reads it live under the same concurrency limit.
A failure is reported only by the in-order reader, for its own read of its
current outcome, so it is the first failure in outcome order, as without
read-ahead. A read-ahead records nothing, decides nothing and reports
nothing (one structured line counts the window, unresolved targets, pages
warmed and any first drop).

```quint
pure def decidedOutcomes(r: ReadAhead): Set[int] = r.taken.union(r.live).exclude(Set(r.failedAt))
pure def canAdvance(r: ReadAhead): bool =
  r.phase == Running and r.at < r.outcomeCount and decidedOutcomes(r).size() == r.at
pure def advance(r: ReadAhead): ReadAhead = { ...r, at: r.at + 1 }
pure def currentUndecided(r: ReadAhead): bool =
  r.phase == Running and r.at > 0 and not(decidedOutcomes(r).contains(r.at))
pure def canTakeWarmed(r: ReadAhead): bool = currentUndecided(r) and r.empty.contains(r.at)
pure def takeWarmed(r: ReadAhead): ReadAhead = { ...r, taken: r.taken.union(Set(r.at)) }
pure def canReadLive(r: ReadAhead): bool =
  currentUndecided(r) and not(r.empty.contains(r.at)) and not(r.reading.contains(r.at)) and r.reading.size() < r.concurrency
pure def readLive(r: ReadAhead): ReadAhead = { ...r, live: r.live.union(Set(r.at)) }
pure def canFailRead(r: ReadAhead): bool =
  currentUndecided(r) and not(r.empty.contains(r.at)) and not(r.reading.contains(r.at)) and r.reading.size() < r.concurrency
pure def failRead(r: ReadAhead): ReadAhead =
  { ...r, live: r.live.union(Set(r.at)), failedAt: r.at, phase: ReadFailed }
pure def canFinishAll(r: ReadAhead): bool =
  r.phase == Running and r.at == r.outcomeCount and decidedOutcomes(r).size() == r.outcomeCount and r.reading.size() == 0
pure def finishAll(r: ReadAhead): ReadAhead = { ...r, phase: AllRead }
pure def alwaysDecidedInOrder(r: ReadAhead): bool =
  r.at >= 0 and r.at <= r.outcomeCount and decidedOutcomes(r).forall(p => p >= 1 and p <= r.at) and
    (r.at == 0 implies decidedOutcomes(r).size() == 0) and
    (r.at > 0 implies (decidedOutcomes(r).size() == r.at - 1 or decidedOutcomes(r).size() == r.at))
pure def alwaysEachPageReadOnce(r: ReadAhead): bool =
  r.taken.intersect(r.live).size() == 0 and r.taken.subseteq(r.empty) and r.live.intersect(r.empty).size() == 0
pure def alwaysOnlyTheLoopReportsAFailure(r: ReadAhead): bool =
  (r.failedAt != 0 iff r.phase == ReadFailed) and
    (r.failedAt != 0 implies (r.failedAt == r.at and r.live.contains(r.failedAt)))
pure def alwaysAllReadDecidesEvery(r: ReadAhead): bool =
  r.phase == AllRead implies decidedOutcomes(r).size() == r.outcomeCount
pure def stepReadAheadDecidesNothing(before: ReadAhead, via: str, after: ReadAhead): bool =
  (via == "startRead" or via == "finishRead" or via == "dropRead") implies
    (after.taken.subseteq(before.taken) and before.taken.subseteq(after.taken) and after.live.subseteq(before.live) and
      before.live.subseteq(after.live) and after.at == before.at and after.failedAt == before.failedAt)
pure def sometimesSequentialOnly(r: ReadAhead): bool = r.phase == AllRead and r.outcomeCount > 0 and r.warmed.size() == 0
pure def sometimesEveryPageTaken(r: ReadAhead): bool = r.phase == AllRead and r.outcomeCount > 0 and r.taken.size() == r.outcomeCount
pure def sometimesDroppedPageReadAgain(r: ReadAhead): bool =
  r.phase == AllRead and r.taken.size() > 0 and r.dropped.subseteq(r.live) and r.dropped.size() > 0
pure def sometimesNonEmptyReadAgain(r: ReadAhead): bool =
  r.phase == AllRead and r.warmed.exclude(r.empty).size() > 0 and r.warmed.exclude(r.empty).subseteq(r.live)
pure def sometimesFailureAfterWarmedPage(r: ReadAhead): bool = r.phase == ReadFailed and r.taken.size() > 0
```

### Simulation samples cover no read-ahead, a bounded window, a non-empty page and a dropped one

These sets bound simulation only.

```quint
pure val concurrencyValues = Set(1, 2, 16, 0, 17)
pure val outcomeCountValues = Set(0, 3)
pure val positionValues = Set(1, 2, 3)
pure val isEmptyValues = Set(false, true)
pure val eval_witness_sometimesReadAheadFull = (("begin", 2, 3), ("startRead", 1), ("startRead", 2))
pure val eval_witness_sometimesReadAheadDropped = (("begin", 2, 3), ("startRead", 1), ("startRead", 2),
  ("finishRead", 1, true), ("dropRead", 2))
pure val eval_witness_sometimesDroppedPageReadAgain = (("begin", 2, 3), ("startRead", 1), ("startRead", 2),
  ("dropRead", 2), ("finishRead", 1, true), "advance", "takeWarmed", "advance", "readLive", "advance", "readLive", "finishAll")
pure val eval_witness_sometimesNonEmptyReadAgain = (("begin", 2, 3), ("startRead", 1), ("finishRead", 1, false),
  "advance", "readLive", "advance", "readLive", "advance", "readLive", "finishAll")
pure val eval_witness_sometimesFailureAfterWarmedPage = (("begin", 2, 3), ("startRead", 1), ("startRead", 2),
  ("dropRead", 2), ("finishRead", 1, true), "advance", "takeWarmed", "advance", "failRead")
pure val eval_witness_sometimesEveryPageTaken = (("begin", 2, 3), ("startRead", 1), ("startRead", 2),
  ("finishRead", 1, true), ("startRead", 3), ("finishRead", 3, true), ("finishRead", 2, true),
  "advance", "takeWarmed", "advance", "takeWarmed", "advance", "takeWarmed", "finishAll")
pure val eval_witness_sometimesSequentialOnly = (("begin", 1, 3), "advance", "readLive", "advance", "readLive", "advance", "readLive", "finishAll")
```
