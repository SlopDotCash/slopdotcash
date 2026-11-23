# Read the first history pages ahead of the in-order reader

The operator decision of 21 November 2026 (main PRD section 9; development
7f71c6ce9 and main `bcdaf1161`): the value collection may read the first
history pages of its outcomes ahead of the in-order reader, a bounded
number at once, to save waiting. Source `scripts/value-ingestion.ts`
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
repository node ID), and the in-order reader takes a warmed page only for
its own first read with those arguments: the first joint page (from
sequence 0, no fixed boundary) and, after an empty joint history, the first
single page.

## Story: Save waiting on the first history pages without changing a decision

> As an operator collecting value, I want the first history page of each
> outcome read ahead a few at a time, so a collection waits less, while
> every decision, hold and reported failure stays exactly what the reader
> that reads one page at a time would give.

### First history pages may be read ahead, a bounded number at once, and decide nothing

The concurrency is `SLOP_VALUE_FEED_CONCURRENCY`: one or two digits, from
1 to 16, 1 when unset (the release sets 6); any other value stops the
collection before it reads any history. With 1, or with no outcomes, nothing is read
ahead. Otherwise, after each outcome's repository is resolved once, in
order (one that cannot be resolved is left to the in-order reader, as is
every outcome of a repository that failed before), up to the concurrency of
reads run at once. Each takes the next outcome in order: its first joint
page and, when that joint history is empty (no records, no continuation, a
total of 0) and nothing has failed, its first single page. A read-ahead
that fails is dropped and ends the read-ahead: no further outcome is
started, the reads already running finish, and nothing is reported. An
outcome whose single page fails after its joint page was read counts here as
dropped; that joint page stays warmed, and the in-order reader may take it
and then reads the single page itself, which decides the same. Only
when every read has finished does the in-order reader start.

```quint
type ReadAheadPhase = Unconfigured | WarmingPages | ReadingInOrder | ReadFailed | AllRead
type ReadAhead = { phase: ReadAheadPhase, concurrency: int, outcomeCount: int, nextStart: int, reading: Set[int],
  warmed: Set[int], dropped: Set[int], taken: Set[int], live: Set[int], cursor: int, failedAt: int }
pure val maxConcurrency = 16
pure val initial: ReadAhead = { phase: Unconfigured, concurrency: 1, outcomeCount: 0, nextStart: 1, reading: Set(),
  warmed: Set(), dropped: Set(), taken: Set(), live: Set(), cursor: 1, failedAt: 0 }
pure def validConcurrency(concurrency: int): bool = concurrency >= 1 and concurrency <= maxConcurrency
pure def readsAhead(concurrency: int, outcomeCount: int): bool = concurrency > 1 and outcomeCount > 0
pure def canBegin(r: ReadAhead, concurrency: int, outcomeCount: int): bool =
  r.phase == Unconfigured and validConcurrency(concurrency) and outcomeCount >= 0
pure def begin(r: ReadAhead, concurrency: int, outcomeCount: int): ReadAhead =
  { ...r, phase: if (readsAhead(concurrency, outcomeCount)) WarmingPages else ReadingInOrder,
    concurrency: concurrency, outcomeCount: outcomeCount }
pure def workerFree(r: ReadAhead): bool =
  r.phase == WarmingPages and r.dropped.size() == 0 and r.nextStart <= r.outcomeCount and r.reading.size() < r.concurrency
pure def canStartRead(r: ReadAhead): bool = workerFree(r)
pure def startRead(r: ReadAhead): ReadAhead = { ...r, reading: r.reading.union(Set(r.nextStart)), nextStart: r.nextStart + 1 }
pure def canSkipRead(r: ReadAhead): bool = workerFree(r)
pure def skipRead(r: ReadAhead): ReadAhead = { ...r, nextStart: r.nextStart + 1 }
pure def canFinishRead(r: ReadAhead, position: int): bool = r.phase == WarmingPages and r.reading.contains(position)
pure def finishRead(r: ReadAhead, position: int): ReadAhead =
  { ...r, reading: r.reading.exclude(Set(position)), warmed: r.warmed.union(Set(position)) }
pure def canDropRead(r: ReadAhead, position: int): bool = r.phase == WarmingPages and r.reading.contains(position)
pure def dropRead(r: ReadAhead, position: int): ReadAhead =
  { ...r, reading: r.reading.exclude(Set(position)), dropped: r.dropped.union(Set(position)) }
pure def canEndReadAhead(r: ReadAhead): bool =
  r.phase == WarmingPages and r.reading.size() == 0 and (r.dropped.size() > 0 or r.nextStart > r.outcomeCount)
pure def endReadAhead(r: ReadAhead): ReadAhead = { ...r, phase: ReadingInOrder }
pure def alwaysConcurrencyInRange(r: ReadAhead): bool = validConcurrency(r.concurrency) and r.outcomeCount >= 0
pure def alwaysReadsWithinConcurrency(r: ReadAhead): bool = r.reading.size() <= r.concurrency
pure def alwaysReadsOnlyWhileWarming(r: ReadAhead): bool = r.phase != WarmingPages implies r.reading.size() == 0
pure def alwaysStartedInOrder(r: ReadAhead): bool =
  r.nextStart >= 1 and r.nextStart <= r.outcomeCount + 1 and
    r.reading.union(r.warmed).union(r.dropped).forall(p => p >= 1 and p < r.nextStart) and
    r.reading.intersect(r.warmed).size() == 0 and r.reading.intersect(r.dropped).size() == 0 and
    r.warmed.intersect(r.dropped).size() == 0
pure def alwaysNoReadAheadWithoutConcurrency(r: ReadAhead): bool =
  (r.phase == Unconfigured or not(readsAhead(r.concurrency, r.outcomeCount))) implies
    (r.reading.size() == 0 and r.warmed.size() == 0 and r.dropped.size() == 0 and r.nextStart == 1)
pure def stepNoReadStartsAfterADrop(before: ReadAhead, via: str, after: ReadAhead): bool =
  (via == "startRead" or via == "skipRead") implies before.dropped.size() == 0
pure def lawInvalidConcurrencyReadsNothing(concurrency: int, outcomeCount: int): bool =
  not(validConcurrency(concurrency)) implies not(canBegin(initial, concurrency, outcomeCount))
pure def sometimesReadAheadFull(r: ReadAhead): bool = r.phase == WarmingPages and r.reading.size() == r.concurrency and r.concurrency > 1
pure def sometimesReadAheadDropped(r: ReadAhead): bool = r.phase == ReadingInOrder and r.dropped.size() > 0 and r.warmed.size() > 0
```

### The in-order reader takes each warmed page once and reads every other page itself

The in-order reader goes through the outcomes in order and decides them as
the reader without read-ahead does: for an outcome whose first page was
warmed it takes that page, once, and reads every later page of it itself;
for any other outcome, a dropped one included, it reads every page itself.
A failure is reported only by the in-order reader, for its own read of the
next outcome (a later page of an outcome whose first page was warmed
included), so it is the first failure in outcome order, as without
read-ahead. A read-ahead records nothing, decides nothing and reports
nothing (one structured line counts the pages warmed).

```quint
pure def decidedOutcomes(r: ReadAhead): Set[int] = r.taken.union(r.live).exclude(Set(r.failedAt))
pure def inOrder(r: ReadAhead): bool = r.phase == ReadingInOrder and r.cursor <= r.outcomeCount
pure def canTakeWarmed(r: ReadAhead): bool = inOrder(r) and r.warmed.contains(r.cursor)
pure def takeWarmed(r: ReadAhead): ReadAhead = { ...r, taken: r.taken.union(Set(r.cursor)), cursor: r.cursor + 1 }
pure def canReadLive(r: ReadAhead): bool = inOrder(r) and not(r.warmed.contains(r.cursor))
pure def readLive(r: ReadAhead): ReadAhead = { ...r, live: r.live.union(Set(r.cursor)), cursor: r.cursor + 1 }
pure def canFailRead(r: ReadAhead): bool = inOrder(r)
pure def failRead(r: ReadAhead): ReadAhead =
  val warmedFirst = r.warmed.contains(r.cursor)
  { ...r, taken: if (warmedFirst) r.taken.union(Set(r.cursor)) else r.taken,
    live: if (warmedFirst) r.live else r.live.union(Set(r.cursor)), failedAt: r.cursor, phase: ReadFailed }
pure def canFinishAll(r: ReadAhead): bool = r.phase == ReadingInOrder and r.cursor > r.outcomeCount
pure def finishAll(r: ReadAhead): ReadAhead = { ...r, phase: AllRead }
pure def alwaysWarmingDecidesNothing(r: ReadAhead): bool =
  (r.phase == Unconfigured or r.phase == WarmingPages) implies
    (r.taken.size() == 0 and r.live.size() == 0 and r.failedAt == 0 and r.cursor == 1)
pure def alwaysDecidedInOrder(r: ReadAhead): bool =
  r.cursor >= 1 and r.cursor <= r.outcomeCount + 1 and
    decidedOutcomes(r).forall(p => p >= 1 and p < r.cursor) and decidedOutcomes(r).size() == r.cursor - 1
pure def alwaysEachPageReadOnce(r: ReadAhead): bool =
  r.taken.intersect(r.live).size() == 0 and r.taken.subseteq(r.warmed) and r.live.intersect(r.warmed).size() == 0
pure def alwaysOnlyTheLoopReportsAFailure(r: ReadAhead): bool =
  (r.failedAt != 0 iff r.phase == ReadFailed) and
    (r.failedAt != 0 implies (r.failedAt == r.cursor and r.taken.union(r.live).contains(r.failedAt)))
pure def alwaysAllReadDecidesEvery(r: ReadAhead): bool =
  r.phase == AllRead implies decidedOutcomes(r).size() == r.outcomeCount
pure def stepReadAheadDecidesNothing(before: ReadAhead, via: str, after: ReadAhead): bool =
  (via == "startRead" or via == "skipRead" or via == "finishRead" or via == "dropRead" or via == "endReadAhead") implies
    (after.taken == before.taken and after.live == before.live and after.cursor == before.cursor and after.failedAt == before.failedAt)
pure def sometimesSequentialOnly(r: ReadAhead): bool = r.phase == AllRead and r.outcomeCount > 0 and r.warmed.size() == 0
pure def sometimesEveryPageTaken(r: ReadAhead): bool = r.phase == AllRead and r.outcomeCount > 0 and r.taken.size() == r.outcomeCount
pure def sometimesDroppedPageReadAgain(r: ReadAhead): bool =
  r.phase == AllRead and r.taken.size() > 0 and r.dropped.subseteq(r.live) and r.dropped.size() > 0
pure def sometimesFailureAfterWarmedPage(r: ReadAhead): bool = r.phase == ReadFailed and r.taken.size() > 0
pure def sometimesWarmedOutcomeFailsLater(r: ReadAhead): bool = r.phase == ReadFailed and r.taken.contains(r.failedAt)
```

### Simulation samples cover no read-ahead, a full read-ahead and a dropped one

These sets bound simulation only.

```quint
pure val concurrencyValues = Set(1, 2, 16, 0, 17)
pure val outcomeCountValues = Set(0, 3)
pure val positionValues = Set(1, 2, 3)
pure val eval_witness_sometimesDroppedPageReadAgain = (("begin", 2, 3), "startRead", "startRead", ("dropRead", 2),
  ("finishRead", 1), "endReadAhead", "takeWarmed", "readLive", "readLive", "finishAll")
pure val eval_witness_sometimesFailureAfterWarmedPage = (("begin", 2, 3), "startRead", "startRead", ("dropRead", 2),
  ("finishRead", 1), "endReadAhead", "takeWarmed", "failRead")
pure val eval_witness_sometimesEveryPageTaken = (("begin", 2, 3), "startRead", "startRead", ("finishRead", 1),
  "startRead", ("finishRead", 3), ("finishRead", 2), "endReadAhead", "takeWarmed", "takeWarmed", "takeWarmed", "finishAll")
pure val eval_witness_sometimesWarmedOutcomeFailsLater = (("begin", 2, 3), "startRead", ("finishRead", 1), "startRead",
  ("finishRead", 2), "startRead", ("finishRead", 3), "endReadAhead", "failRead")
pure val eval_witness_sometimesSequentialOnly = (("begin", 1, 3), "readLive", "readLive", "readLive", "finishAll")
```
