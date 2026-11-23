# Rolling 35-day ledger

PRD section 7: the rolling ledger covers a complete 35-day window, publishes
exact bounds and record counts and deduplicates permanent GitHub IDs. Bots,
self-review, post-merge review and repeated low-value comments are excluded,
and Slopbot does not enter human rankings. A failed ingestion never publishes
an empty leaderboard. This machine follows `src/lib/leaderboard.ts`
(`SCORE_WINDOW_DAYS = 35`, window validation) and the legacy
`leaderboard_transport` and `ingestion_retry` models.

The GitHub read adapter supplies each event with its immutable ID, actor
kind, times and the census item it belongs to. The [census](./census.md)
supplies the source inventory: one refresh collects the issue and pull
request census of every repository, and publication needs every one of them
in phase `ReadyForPublication`, its terminal page read and its item count
equal to GitHub's `totalCount`, with no item in two of them; every recorded
event must belong to an item of that inventory. Passing the census state of the same refresh is
composition obligation C10. Accepted-work values come from [work units](./workUnits.md)
and the [Points journal](./journal.md).

## Story: Publish one complete window with exact counts

### A window spans exactly 35 days and never moves back

```quint
import census as C from "./census"
type WindowPhase = Building | Published | Failed
type ActorKind = Human | Bot | Slopbot
type EventKind = MergeEvent | ReviewEvent | CommentEvent | IssueEvent
type Outcome = Counted | ExcludedBot | ExcludedSelfReview | ExcludedPostMerge | ExcludedRepeat | OutsideWindow
type LedgerEvent = { id: int, source: int, kind: EventKind, actor: int, actorKind: ActorKind, prAuthor: int, at: int, mergedAt: int, repeatLowValue: bool }
type Recorded = { id: int, source: int, actor: int, outcome: Outcome }
type Window = { phase: WindowPhase, from: int, to: int, records: List[Recorded],
  publishedFrom: int, publishedTo: int, publishedCount: int, inventory: List[C::Item], censusTotal: int }
pure val windowDays = 35
pure val initial: Window = { phase: Published, from: 0, to: 35, records: List(), publishedFrom: 0, publishedTo: 35,
  publishedCount: 0, inventory: List(), censusTotal: -1 }
pure def canStart(w: Window, upper: int): bool = w.phase != Building and upper >= w.publishedTo and upper >= windowDays
pure def start(w: Window, upper: int): Window =
  { ...w, phase: Building, from: upper - windowDays, to: upper, records: List(), inventory: List(), censusTotal: -1 }
pure def alwaysExactWindow(w: Window): bool = w.to - w.from == windowDays and w.publishedTo - w.publishedFrom == windowDays
pure def alwaysBuildingAhead(w: Window): bool = w.phase == Building implies w.to >= w.publishedTo
```

### Each permanent ID is recorded once with the reason it counts or not

Every observed event is retained with its outcome. Only counted events reach
rankings; Slopbot and other bots never count.

```quint
pure def outcomeOf(w: Window, e: LedgerEvent): Outcome =
  if (e.at < w.from or e.at >= w.to) OutsideWindow
  else if (e.actorKind != Human) ExcludedBot
  else if (e.kind == ReviewEvent and e.actor == e.prAuthor) ExcludedSelfReview
  else if (e.kind == ReviewEvent and e.mergedAt > 0 and e.at >= e.mergedAt) ExcludedPostMerge
  else if (e.kind == CommentEvent and e.repeatLowValue) ExcludedRepeat
  else Counted
pure def inInventory(w: Window, source: int): bool = w.inventory.some(i => i.id == source)
pure def canObserve(w: Window, e: LedgerEvent): bool =
  w.phase == Building and e.id > 0 and e.actor > 0 and e.source > 0 and (w.censusTotal >= 0 implies inInventory(w, e.source))
pure def observe(w: Window, e: LedgerEvent): Window =
  if (w.records.some(r => r.id == e.id)) w
  else { ...w, records: w.records.append({ id: e.id, source: e.source, actor: e.actor, outcome: outcomeOf(w, e) }) }
pure def countedRecords(w: Window): int = w.records.select(r => r.outcome == Counted).length()
pure def alwaysIdsDistinct(w: Window): bool = w.records.every(r => r.id > 0 and w.records.select(o => o.id == r.id).length() == 1)
```

### Publication needs a verified complete census; a failure keeps the previous window

Every source census of the refresh must be complete by its own rules and
cover the window's first day, no item may appear in two of them, and their
union must contain the source of every event already recorded. Without it the
window never publishes, even an empty one; an empty window publishes only
when a complete census proves the inventory empty.

```quint
pure def censusVerified(c: C::Census): bool =
  c.phase == C::ReadyForPublication and C::alwaysCompleteWhenReady(c) and C::alwaysItemsDistinct(c) and
  c.totalCount >= 0
pure def censusItems(censuses: List[C::Census]): List[C::Item] = censuses.foldl(List(), (acc, c) => acc.concat(c.items))
pure def censusesTotal(censuses: List[C::Census]): int = censuses.foldl(0, (acc, c) => acc + c.totalCount)
pure def canCompleteCensus(w: Window, censuses: List[C::Census]): bool =
  val items = censusItems(censuses)
  w.phase == Building and w.censusTotal < 0 and censuses.length() > 0 and
  censuses.every(c => censusVerified(c) and c.lowerDay <= w.from) and
  items.every(i => items.select(o => o.id == i.id).length() == 1) and
  w.records.every(r => items.some(i => i.id == r.source))
pure def completeCensus(w: Window, censuses: List[C::Census]): Window =
  { ...w, inventory: censusItems(censuses), censusTotal: censusesTotal(censuses) }
pure def canPublish(w: Window): bool = w.phase == Building and w.censusTotal >= 0 and w.records.every(r => inInventory(w, r.source))
pure def publish(w: Window): Window =
  { ...w, phase: Published, publishedFrom: w.from, publishedTo: w.to, publishedCount: countedRecords(w) }
pure def canFailRefresh(w: Window): bool = w.phase == Building
pure def failRefresh(w: Window): Window = { ...w, phase: Failed }
pure def alwaysPublishedCountExact(w: Window): bool = w.phase == Published implies
  (w.publishedFrom == w.from and w.publishedTo == w.to and w.publishedCount == countedRecords(w))
pure def stepFailureKeepsPublished(before: Window, after: Window): bool =
  after.phase != Published implies
    (after.publishedFrom == before.publishedFrom and after.publishedTo == before.publishedTo and after.publishedCount == before.publishedCount)
pure def stepWindowNeverRegresses(before: Window, after: Window): bool = after.publishedTo >= before.publishedTo
pure def alwaysRecordsInInventory(w: Window): bool = w.censusTotal >= 0 implies
  (w.records.every(r => inInventory(w, r.source)) and w.inventory.length() == w.censusTotal)
pure def alwaysBuildingCensusReset(w: Window): bool = w.censusTotal < 0 implies w.inventory.length() == 0
pure def lawBotsNeverCount(e: LedgerEvent): bool = e.actorKind != Human implies outcomeOf({ ...initial, from: 0, to: 100 }, e) != Counted
pure def lawSelfReviewNeverCounts(e: LedgerEvent): bool = (e.kind == ReviewEvent and e.actor == e.prAuthor) implies outcomeOf({ ...initial, from: 0, to: 100 }, e) != Counted
pure def sometimesPublishedWithExclusions(w: Window): bool =
  w.phase == Published and w.publishedCount > 0 and w.records.some(r => r.outcome != Counted)
pure def sometimesFailedKeepsPrior(w: Window): bool = w.phase == Failed and w.publishedTo > 35
pure def sometimesUnverifiedNeverPublishes(w: Window): bool = w.phase == Building and w.censusTotal < 0 and w.records.length() > 0
```

### A hosted feed outage is read again on the configured delays; any other failure stops at once

Each read of an authoritative Slopbot feed (bans, penalties) and of every
value or work-unit history page fails as an outage when the transport fails,
the 30-second request times out, the body cannot be read to its end, or the
answer is 408, 429 or 500 and above, or, for an authoritative feed, 404 (a
release without the route) (`ValueFeedUnavailableError`). Such a read is sent again after each delay of
`SLOP_VALUE_FEED_RETRY_DELAYS_MS` in turn (comma-separated non-negative safe
integer milliseconds, at most 10; unset or blank means one attempt; any other
list refuses the run with `SLOP_VALUE_FEED_RETRY_DELAYS_MS is invalid`),
logging `{"event":"value_feed_retry","attempt":<n>,"delayMs":<ms>}` before
each wait. A refused or invalid answer (any other status, a redirect,
malformed JSON or a failed identity check) is never sent again. After the
last delay the outage ends the refresh as before, and the previous window
stays published (`scripts/value-ingestion.ts`, `withFeedRetry`,
`feedRetryDelays`; operator decision, 19 November 2026; main ffd4fb846,
development 7f71c6ce9). The release collector sets
`2000,10000,30000,60000`. `feedAttempt` counts the attempts already made,
from 1.

```quint
pure val maxFeedDelays = 10
pure def feedDelaysValid(delays: List[int]): bool = delays.length() <= maxFeedDelays and delays.every(d => d >= 0)
pure def feedAttempts(delays: List[int]): int = delays.length() + 1
pure def feedRetried(outage: bool, feedAttempt: int, delays: List[int]): bool =
  outage and feedAttempt >= 1 and feedAttempt < feedAttempts(delays)
pure def feedDelayBefore(feedAttempt: int, delays: List[int]): int = delays.nthOr(feedAttempt - 1, 0)
pure def lawRefusedFeedAnswerNeverRetried(feedAttempt: int, delays: List[int]): bool = not(feedRetried(false, feedAttempt, delays))
pure def lawNoDelaysIsOneAttempt(outage: bool, feedAttempt: int): bool = not(feedRetried(outage, feedAttempt, List()))
pure def lawFeedRetriesBounded(outage: bool, feedAttempt: int, delays: List[int]): bool =
  feedRetried(outage, feedAttempt, delays) implies (feedAttempt <= delays.length() and delays.length() >= 1)
pure def lawEveryConfiguredDelayIsUsed(delays: List[int]): bool =
  (delays.length() >= 1 and delays.length() <= maxFeedDelays) implies
    (feedRetried(true, delays.length(), delays) and not(feedRetried(true, delays.length() + 1, delays)))
pure def lawInvalidDelaysRefused(delays: List[int]): bool =
  (delays.length() > maxFeedDelays or delays.some(d => d < 0)) implies not(feedDelaysValid(delays))
pure val delaysValues = Set(List(), List(2000, 10000, 30000, 60000), List(0), List(-1),
  List(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
pure val feedAttemptValues = Set(0, 1, 4, 5, 11)
```

### Simulation samples include duplicates and every exclusion

```quint
pure val base: LedgerEvent = { id: 1, source: 1, kind: ReviewEvent, actor: 1, actorKind: Human, prAuthor: 2, at: 40, mergedAt: 50, repeatLowValue: false }
pure val eValues = Set(base, { ...base, id: 2, actorKind: Slopbot }, { ...base, id: 3, actor: 2 },
  { ...base, id: 4, at: 55 }, { ...base, id: 5, kind: CommentEvent, repeatLowValue: true }, { ...base, id: 6, at: 10 },
  { ...base, id: 7, source: 9 })
pure val upperValues = Set(35, 70, 71)
pure val censusItem: C::Item = { ...C::human, id: 1 }
pure val readyCensus: C::Census = { ...C::initial, phase: C::ReadyForPublication, lowerDay: 0, cursorsSeen: List(0), expectedCursor: 0,
  totalCount: 1, terminalSeen: true, items: List(censusItem) }
pure val pullCensus: C::Census = { ...readyCensus, items: List({ ...censusItem, id: 9 }) }
pure val censusesValues = Set(List(readyCensus), List(readyCensus, pullCensus), List(readyCensus, readyCensus),
  List({ ...readyCensus, phase: C::Collecting }), List({ ...readyCensus, totalCount: 2 }),
  List({ ...readyCensus, items: List(), totalCount: 0 }))
```
