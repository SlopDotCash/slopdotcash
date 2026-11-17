# Public Slopbot feeds

PRD section 7 (published penalties and value history, BOT-07, LDR-04) and
CLAUDE.md "Public pages never read chain or GitHub state live per page
view". Source at the development head: `workers/slopbot/index.ts` `fetch`
(`/health`, `/v1/penalties`, `/v1/value-assessments`,
`/v1/work-unit-assessments`), `penalties.ts` (`activePenaltyPage`,
`PENALTY_PAGE_SIZE`), `value-journal.ts` (`valueHistory`),
`value-work-unit-journal.ts` (`workUnitHistory`) and
`backend/slopbot/summary.ts` (`handleSlopbotApi`). The consumers are the
leaderboard generator and the Points producer. Paging consistency across
pages is [value history](./valueHistory.md) "Each page agrees with the
first through sequence and total count"; this library fixes the requests
each feed accepts and what it answers. Response bodies keep their published
bytes.

## Story: Serve published history from stored records only

> As the Points producer, I want each Slopbot feed to answer one stable,
> versioned schema from D1, and to refuse a malformed or unregistered
> request, so that the published score can be rebuilt exactly.

### Feeds serve only registered history repositories with strictly validated cursors, 100 items per page and no-store

`GET /health` answers `{service: "slopbot", ok: true}`. `GET
/v1/penalties` needs `project` to be a registered history project, an
optional `after` cursor of at most 100 characters of `[A-Za-z0-9_=-]` (an
item node ID) and an optional `history`, which may only be `1`. `GET
/v1/value-assessments` and `GET /v1/work-unit-assessments` need a
registered history `repository` (or, without it, a `repositoryNodeId` of 1
to 100 of `[A-Za-z0-9_=-]`), a `pull` number in decimal from 1 without a
leading zero, and an optional `after` sequence in decimal from 0, each a
safe integer. Any other request is 400 with its route's error text
(`Invalid penalty query` or `Invalid value-history query`). Each page reads
one row more than 100 to know whether a next page exists and returns at
most 100, ordered by item node ID or by sequence, with the next cursor
only when more remain. A penalty page without `history` omits reversed
debits. A successful answer is `no-store` and `nosniff`; a failed read is
503 `no-store` with `Penalties are unavailable` or `Value history is
unavailable`. Any other path or method is 404 `not found`, apart from the
webhook and the internal routes.

```quint
type FeedRoute = HealthFeed | PenaltiesFeed | ValueHistoryFeed | WorkUnitHistoryFeed | OtherPath
type HistoryFlag = FlagAbsent | FlagOne | FlagOther
type FeedQuery = { route: FeedRoute, isGet: bool, registered: bool, cursorWellFormed: bool, historyFlag: HistoryFlag,
  nodeIdConflict: bool, pullWellFormed: bool, pull: int, afterWellFormed: bool, after: int, throughPresent: bool,
  throughWellFormed: bool, through: int }
type FeedAnswer = { httpStatus: int, schemaId: str, noStore: bool, pageLimit: int }
pure val feedPageSize = 100
pure def penaltyQueryValid(q: FeedQuery): bool = q.cursorWellFormed and q.historyFlag != FlagOther
pure def historyQueryValid(q: FeedQuery): bool =
  val joint = q.route == WorkUnitHistoryFeed
  not(q.nodeIdConflict) and q.pullWellFormed and q.pull > 0 and q.afterWellFormed and q.after >= 0 and
  not(joint and q.after > 0 and not(q.throughPresent)) and
  (not(joint) or not(q.throughPresent) or (q.throughWellFormed and q.through >= q.after))
pure def feedSchema(q: FeedQuery): str =
  if (q.route == PenaltiesFeed) (if (q.historyFlag == FlagOne) "slop-penalty-history:v1" else "slop-penalties:v1")
  else if (q.route == ValueHistoryFeed) "slop-value-history:v1"
  else if (q.route == WorkUnitHistoryFeed) "slop-work-unit-history:v1"
  else ""
pure def feedQueryValid(q: FeedQuery): bool =
  if (q.route == PenaltiesFeed) penaltyQueryValid(q) else historyQueryValid(q)
pure def feedAnswer(q: FeedQuery, readFailed: bool): FeedAnswer =
  if (not(q.isGet) or q.route == OtherPath) { httpStatus: 404, schemaId: "", noStore: false, pageLimit: 0 }
  else if (q.route == HealthFeed) { httpStatus: 200, schemaId: "", noStore: false, pageLimit: 0 }
  else if (not(feedQueryValid(q)) or not(q.registered)) { httpStatus: 400, schemaId: "", noStore: false, pageLimit: 0 }
  else if (readFailed) { httpStatus: 503, schemaId: "", noStore: true, pageLimit: 0 }
  else { httpStatus: 200, schemaId: feedSchema(q), noStore: true, pageLimit: feedPageSize }
pure def pageRecords(available: int): int = if (available > feedPageSize) feedPageSize else available
pure def hasNextPage(available: int): bool = available > feedPageSize
pure def lawUnregisteredNeverServed(sampleQuery: FeedQuery, readFailed: bool): bool =
  (sampleQuery.route != HealthFeed and not(sampleQuery.registered)) implies
    feedAnswer(sampleQuery, readFailed).httpStatus != 200
pure def lawServedHistoryIsNoStore(sampleQuery: FeedQuery, readFailed: bool): bool =
  (feedAnswer(sampleQuery, readFailed).httpStatus == 200 and sampleQuery.route != HealthFeed) implies
    (feedAnswer(sampleQuery, readFailed).noStore and feedAnswer(sampleQuery, readFailed).pageLimit == feedPageSize)
pure def lawPageNeverExceedsSize(available: int): bool =
  available >= 0 implies (pageRecords(available) <= feedPageSize and (hasNextPage(available) iff available > pageRecords(available)))
pure val penaltyQuery: FeedQuery = { route: PenaltiesFeed, isGet: true, registered: true, cursorWellFormed: true,
  historyFlag: FlagAbsent, nodeIdConflict: false, pullWellFormed: false, pull: 0, afterWellFormed: true, after: 0,
  throughPresent: false, throughWellFormed: false, through: 0 }
pure val historyQuery: FeedQuery = { ...penaltyQuery, route: ValueHistoryFeed, pullWellFormed: true, pull: 12 }
pure val sampleQueryValues = Set(penaltyQuery, { ...penaltyQuery, historyFlag: FlagOne },
  { ...penaltyQuery, historyFlag: FlagOther }, { ...penaltyQuery, registered: false },
  { ...penaltyQuery, cursorWellFormed: false }, historyQuery, { ...historyQuery, pull: 0 },
  { ...historyQuery, route: WorkUnitHistoryFeed, after: 5 },
  { ...historyQuery, route: WorkUnitHistoryFeed, after: 5, throughPresent: true, throughWellFormed: true, through: 9 },
  { ...historyQuery, nodeIdConflict: true }, { ...historyQuery, isGet: false }, { ...penaltyQuery, route: HealthFeed })
pure val availableValues = Set(0, 100, 101)
```

### Each feed keeps its published schema id: slop-penalties:v1, slop-penalty-history:v1, slop-value-history:v1, slop-work-unit-history:v1

The penalty answer adds `project`, `records` and `nextAfter`; the history
answers add `repository`, `repositoryNodeId`, `pullRequestNumber`, the
history's records and `nextAfter`. A new field or format is a new schema
version; an existing id never changes meaning.

```quint
pure def lawSchemaIdsArePublished(sampleQuery: FeedQuery): bool =
  val schema = feedSchema(sampleQuery)
  schema == "" or schema == "slop-penalties:v1" or schema == "slop-penalty-history:v1" or
    schema == "slop-value-history:v1" or schema == "slop-work-unit-history:v1"
pure def lawHistoryFlagSelectsHistorySchema(sampleQuery: FeedQuery): bool =
  (sampleQuery.route == PenaltiesFeed and sampleQuery.historyFlag == FlagOne) implies
    feedSchema(sampleQuery) == "slop-penalty-history:v1"
```

### A joint work-unit page requires a through bound

On `/v1/work-unit-assessments`, an `after` above 0 needs a `through`
sequence, a safe decimal integer no smaller than `after`. The first page
may omit it and takes the journal's current maximum, which the answer
reports; a `through` above the stored maximum is refused as unavailable.
The single-PR value history takes no `through`.

```quint
pure def lawLaterJointPageNeedsThrough(sampleQuery: FeedQuery): bool =
  (sampleQuery.route == WorkUnitHistoryFeed and sampleQuery.after > 0 and not(sampleQuery.throughPresent)) implies
    not(feedQueryValid(sampleQuery))
pure def lawThroughNeverBeforeAfter(sampleQuery: FeedQuery): bool =
  (sampleQuery.route == WorkUnitHistoryFeed and sampleQuery.throughPresent and sampleQuery.through < sampleQuery.after)
    implies not(feedQueryValid(sampleQuery))
```

### The per-repository summary counts reviewed, blocked, labeled, closed, reopened and appealed items from D1 only

`GET /api/v1/slopbot/summary` on the site lists, per repository with a
completed or failed review, its installation IDs, the distinct items
whose review completed, items whose latest review failed on a recorded
budget block, items labeled, items closed, closed items a human reopened
at or after their first close, closed items appealed at or after their
first close, and the latest activity. Skipped and running reviews are
excluded, so a private repository, always skipped, never appears. It
publishes counts only, never verdicts, comment bodies, authors or item IDs,
and reads nothing live. The route only reads: it writes nothing and
changes no stored review, action or budget block. It is cached publicly for 60 seconds; a failed
read is 503 `no-store`, another path 404 and another method 405 with
`allow: GET`.

```quint
type ItemActivity = { completedReview: bool, failedReview: bool, latestBudgetBlocked: bool, labeled: bool,
  firstCloseAt: int, latestReopenAt: int, latestAppealAt: int }
type RepositorySummary = { itemsReviewed: int, itemsBlocked: int, itemsLabeled: int, itemsClosed: int,
  closuresReopened: int, closuresAppealed: int }
pure val summaryCacheSeconds = 60
pure def listedInSummary(items: List[ItemActivity]): bool = items.some(i => i.completedReview or i.failedReview)
pure def summarize(items: List[ItemActivity]): RepositorySummary =
  { itemsReviewed: items.select(i => i.completedReview).length(),
    itemsBlocked: items.select(i => i.failedReview and i.latestBudgetBlocked).length(),
    itemsLabeled: items.select(i => i.labeled).length(),
    itemsClosed: items.select(i => i.firstCloseAt > 0).length(),
    closuresReopened: items.select(i => i.firstCloseAt > 0 and i.latestReopenAt >= i.firstCloseAt).length(),
    closuresAppealed: items.select(i => i.firstCloseAt > 0 and i.latestAppealAt >= i.firstCloseAt).length() }
pure def lawReopenBeforeCloseNotCounted(sampleItem: ItemActivity): bool =
  sampleItem.latestReopenAt < sampleItem.firstCloseAt implies summarize(List(sampleItem)).closuresReopened == 0
pure def lawSkippedOnlyNeverListed(sampleItem: ItemActivity): bool =
  (not(sampleItem.completedReview) and not(sampleItem.failedReview)) implies not(listedInSummary(List(sampleItem)))
pure val closedItem: ItemActivity = { completedReview: true, failedReview: false, latestBudgetBlocked: false,
  labeled: true, firstCloseAt: 10, latestReopenAt: 12, latestAppealAt: 0 }
pure val sampleItemValues = Set(closedItem, { ...closedItem, latestReopenAt: 5 },
  { ...closedItem, completedReview: false, failedReview: true, latestBudgetBlocked: true, firstCloseAt: 0 },
  { ...closedItem, completedReview: false, labeled: false, firstCloseAt: 0, latestReopenAt: 0 })
```
