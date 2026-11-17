# Repository merge activity

Issue 1993, operator decision of 15 November 2026. For each repository of
an active project, a scheduled refresh reads public GitHub facts and stores
them in `repository_merge_activity` (migration 0125): when the repository
last merged a pull request, how many outside pull requests wait for someone
who can merge, and how long outside pull requests took to merge in the last
thirty days. Project pages read the stored rows through
`GET /api/v1/merge-activity` and never read GitHub per page view (PRD
section 9). This machine follows `backend/projects/merge-activity.ts` and
`src/lib/merge-activity.ts`. Nothing here writes to GitHub.

The table belongs to Points. The hourly maintenance run of the identity
Worker triggers a refresh and does not wait on its result. Times are integer
milliseconds of the run's clock. A repository is identified by a number; the
registry supplies, at the start of each run, the repositories of projects
that are active and not retired from listing, in registry order.

## Story: Show how a repository answers outside contributors

### Only outside, non-bot, non-draft pull requests count as waiting or merged

An outside author is not a bot and has neither the `OWNER`, `MEMBER` nor
`COLLABORATOR` association. Drafts are never waiting.

```quint
type OpenPull = { bot: bool, maintainerAuthor: bool, draft: bool, maintainerResponded: bool, createdAt: int }
type MergedPull = { bot: bool, maintainerAuthor: bool, createdAt: int, mergedAt: int }
pure val waitingAfterMs = 604800000
pure val mergedWindowMs = 2592000000
pure def outsideOpen(pull: OpenPull): bool = not(pull.bot) and not(pull.maintainerAuthor)
pure def outsideMerged(done: MergedPull): bool = not(done.bot) and not(done.maintainerAuthor)
pure def lawBotsAndMaintainersNeverCount(pull: OpenPull, done: MergedPull, now: int): bool =
  ((pull.bot or pull.maintainerAuthor) implies not(waitingAt(pull, now))) and
  ((done.bot or done.maintainerAuthor) implies not(countsAsMerged(done, now)))
pure def lawDraftsNeverWait(pull: OpenPull, now: int): bool = pull.draft implies not(waitingAt(pull, now))
pure val openPull: OpenPull = { bot: false, maintainerAuthor: false, draft: false, maintainerResponded: false, createdAt: 0 }
pure val mergedPull: MergedPull = { bot: false, maintainerAuthor: false, createdAt: 0, mergedAt: 3600000 }
pure val pullValues = Set(openPull, { ...openPull, bot: true }, { ...openPull, maintainerAuthor: true },
  { ...openPull, draft: true }, { ...openPull, maintainerResponded: true }, { ...openPull, createdAt: 1 })
pure val doneValues = Set(mergedPull, { ...mergedPull, bot: true }, { ...mergedPull, maintainerAuthor: true },
  { ...mergedPull, createdAt: 7200000 })
pure val nowValues = Set(604800000, 604800001, 2595600000, 2595600001)
```

### Outside pull requests open seven days without a response from someone who can merge are counted as waiting

A response is a review or a comment by a non-bot author with the `OWNER`,
`MEMBER` or `COLLABORATOR` association, among a pull request's first 40
reviews and first 60 comments. The read takes open pull requests oldest
first, 50 a page, and stops at the first page that reaches one newer than
seven days or after six pages, when the count is marked capped. The
adapter supplies that flag as `openCapped`; the row stores it beside the
count.

```quint
pure def waitingAt(pull: OpenPull, now: int): bool =
  outsideOpen(pull) and not(pull.draft) and not(pull.maintainerResponded) and now - pull.createdAt >= waitingAfterMs
pure def waitingCount(pulls: List[OpenPull], now: int): int = pulls.select(p => waitingAt(p, now)).length()
pure def lawNewerThanSevenDaysNeverWaits(pull: OpenPull, now: int): bool =
  now - pull.createdAt < waitingAfterMs implies not(waitingAt(pull, now))
pure def lawAnsweredNeverWaits(pull: OpenPull, now: int): bool = pull.maintainerResponded implies not(waitingAt(pull, now))
```

### The median merge time covers outside pull requests merged in the last thirty days

The read searches pull requests merged since the UTC date thirty days
before the run, at most three pages of 100. The count is every outside pull
request merged at most thirty days before the run. The median is taken in
hours over those with a merge time not before their creation: the middle
value, the mean of the two middle values for an even count, and none when
there is none. The row stores it as twice the median in milliseconds, so
the mean of two middle values stays an integer, or -1 when there is none;
the API reports it as hours, dividing by 7,200,000, or as none. The last
merge time is the latest of every merged pull
request read, any author, and of the repository's ten most recently updated
merged pull requests.

```quint
pure def countsAsMerged(done: MergedPull, now: int): bool = outsideMerged(done) and now - done.mergedAt <= mergedWindowMs
pure def inMedian(done: MergedPull, now: int): bool = countsAsMerged(done, now) and done.mergedAt >= done.createdAt
pure def mergedCount(pulls: List[MergedPull], now: int): int = pulls.select(p => countsAsMerged(p, now)).length()
pure def mergeDurations(pulls: List[MergedPull], now: int): List[int] =
  pulls.select(p => inMedian(p, now)).listMap(p => p.mergedAt - p.createdAt)
pure def rankedValue(values: List[int], rank: int): int = values.foldl(-1, (acc, v) =>
  if (values.select(o => o < v).length() <= rank and values.select(o => o <= v).length() > rank) v else acc)
pure def medianTwiceOf(pulls: List[MergedPull], now: int): int =
  val durations = mergeDurations(pulls, now)
  if (durations.length() == 0) -1
  else rankedValue(durations, (durations.length() - 1) / 2) + rankedValue(durations, durations.length() / 2)
pure def lawSingleMergeIsItsOwnMedian(done: MergedPull, now: int): bool =
  inMedian(done, now) implies medianTwiceOf(List(done), now) == 2 * (done.mergedAt - done.createdAt)
pure def lawNoMergeHasNoMedian(done: MergedPull, now: int): bool =
  not(inMedian(done, now)) implies medianTwiceOf(List(done), now) == -1
pure def lastMerged(pulls: List[MergedPull], latest: int): int =
  pulls.foldl(latest, (acc, p) => if (p.mergedAt > acc) p.mergedAt else acc)
pure def lawOlderMergesOutsideTheWindow(done: MergedPull, now: int): bool =
  now - done.mergedAt > mergedWindowMs implies (not(countsAsMerged(done, now)) and not(inMedian(done, now)))
```

### Each repository of an active project is refreshed at most once in twenty hours and a failed read keeps its last values with their date

A row is due when it was never attempted, when its last attempt succeeded
twenty hours (72,000,000 ms) ago or more, or when its last attempt failed
an hour (3,600,000 ms) ago or more. A successful read stores the waiting count with whether
it was capped, the merged count, the median and the last merge time. A
failed read, a missing installation token included, records only its
attempt time and failure; every value, the capped flag and the median
included, and their observation time stay as they were.

```quint
pure val refreshAfterMs = 72000000
pure val retryAfterMs = 3600000
type RunPhase = Idle | Running
type Row = { repository: int, attemptedAt: int, observedAt: int, failed: bool, waiting: int, waitingCapped: bool,
  mergedRecently: int, medianTwiceMs: int, lastMergedAt: int }
type MergeActivity = { phase: RunPhase, now: int, measured: List[int], readThisRun: int, failedThisRun: int, runs: int,
  rows: List[Row] }
pure val initial: MergeActivity = { phase: Idle, now: 0, measured: List(), readThisRun: 0, failedThisRun: 0, runs: 0,
  rows: List() }
pure def blankRow(repository: int): Row = { repository: repository, attemptedAt: -1, observedAt: -1, failed: false,
  waiting: 0, waitingCapped: false, mergedRecently: 0, medianTwiceMs: -1, lastMergedAt: -1 }
pure def rowFor(rows: List[Row], repository: int): Row =
  rows.foldl(blankRow(repository), (acc, r) => if (r.repository == repository) r else acc)
pure def putRow(rows: List[Row], row: Row): List[Row] =
  if (rows.some(r => r.repository == row.repository)) rows.listMap(r => if (r.repository == row.repository) row else r)
  else rows.append(row)
pure def due(row: Row, now: int): bool =
  row.attemptedAt < 0 or (if (row.failed) now - row.attemptedAt >= retryAfterMs else now - row.attemptedAt >= refreshAfterMs)
pure def readRepository(m: MergeActivity, repository: int, openPulls: List[OpenPull], openCapped: bool,
  mergedPulls: List[MergedPull], latest: int): MergeActivity =
  { ...m, readThisRun: m.readThisRun + 1, rows: putRow(m.rows, { repository: repository, attemptedAt: m.now,
    observedAt: m.now, failed: false, waiting: waitingCount(openPulls, m.now), waitingCapped: openCapped,
    mergedRecently: mergedCount(mergedPulls, m.now), medianTwiceMs: medianTwiceOf(mergedPulls, m.now),
    lastMergedAt: lastMerged(mergedPulls, latest) }) }
pure def failRead(m: MergeActivity, repository: int): MergeActivity =
  { ...m, failedThisRun: m.failedThisRun + 1,
    rows: putRow(m.rows, { ...rowFor(m.rows, repository), attemptedAt: m.now, failed: true }) }
pure def keepsValues(before: Row, after: Row): bool = before.attemptedAt < 0 or
  (after.observedAt == before.observedAt and after.waiting == before.waiting and
    after.waitingCapped == before.waitingCapped and after.mergedRecently == before.mergedRecently and
    after.medianTwiceMs == before.medianTwiceMs and after.lastMergedAt == before.lastMergedAt)
pure def refreshedTooSoon(before: Row, after: Row): bool =
  before.observedAt >= 0 and after.observedAt != before.observedAt and after.observedAt - before.observedAt < refreshAfterMs
pure def alwaysRowsDistinct(m: MergeActivity): bool = m.rows.every(r => m.rows.select(o => o.repository == r.repository).length() == 1)
pure def alwaysAttemptsInOrder(m: MergeActivity): bool = m.rows.every(r => r.attemptedAt >= 0 and r.attemptedAt <= m.now and
  r.observedAt <= r.attemptedAt and (not(r.failed) implies r.observedAt == r.attemptedAt))
pure def alwaysFailureAfterRefreshWindow(m: MergeActivity): bool =
  m.rows.every(r => (r.failed and r.observedAt >= 0) implies r.attemptedAt - r.observedAt >= refreshAfterMs)
pure def stepRefreshAtMostOnceInTwentyHours(before: MergeActivity, after: MergeActivity): bool =
  after.rows.every(a => not(refreshedTooSoon(rowFor(before.rows, a.repository), a)))
pure def stepFailedReadKeepsValues(before: MergeActivity, after: MergeActivity): bool =
  after.rows.every(a => not(a.failed) or keepsValues(rowFor(before.rows, a.repository), a))
pure def sometimesFailedKeepsEarlierValues(m: MergeActivity): bool = m.rows.some(r => r.failed and r.observedAt >= 0)
pure def sometimesWaitingCounted(m: MergeActivity): bool = m.rows.some(r => r.waiting > 0 and r.mergedRecently > 0)
pure def sometimesMedianShown(m: MergeActivity): bool = m.rows.some(r => r.medianTwiceMs >= 0 and r.observedAt >= 0)
pure def sometimesCappedKeptByFailure(m: MergeActivity): bool = m.rows.some(r => r.failed and r.waitingCapped)
```

### A run refreshes at most fifteen due repositories and retries a failed repository after one hour

A run reads the due repositories in order of their last attempt, never
attempted first, and stops after fifteen reads, failed or not, so each run
stays short.

```quint
pure val repositoriesPerRun = 15
pure def waitedSince(row: Row): int = if (row.attemptedAt < 0) 0 else row.attemptedAt
pure def nextInLine(m: MergeActivity, repository: int): bool =
  m.measured.includes(repository) and due(rowFor(m.rows, repository), m.now) and
  not(m.measured.some(o => due(rowFor(m.rows, o), m.now) and waitedSince(rowFor(m.rows, o)) < waitedSince(rowFor(m.rows, repository))))
pure def canStartRun(m: MergeActivity, measured: List[int], elapsed: int): bool =
  m.phase == Idle and elapsed >= 0 and measured.every(x => x > 0 and measured.select(o => o == x).length() == 1)
pure def startRun(m: MergeActivity, measured: List[int], elapsed: int): MergeActivity =
  { ...m, phase: Running, now: m.now + elapsed, measured: measured, readThisRun: 0, failedThisRun: 0 }
pure def canReadRepository(m: MergeActivity, repository: int): bool =
  m.phase == Running and m.readThisRun + m.failedThisRun < repositoriesPerRun and nextInLine(m, repository)
pure def canFailRead(m: MergeActivity, repository: int): bool =
  m.phase == Running and m.readThisRun + m.failedThisRun < repositoriesPerRun and nextInLine(m, repository)
pure def alwaysAtMostFifteenPerRun(m: MergeActivity): bool =
  m.readThisRun >= 0 and m.failedThisRun >= 0 and m.readThisRun + m.failedThisRun <= repositoriesPerRun
pure def sometimesRetriedAfterFailure(m: MergeActivity): bool =
  m.runs > 1 and m.rows.some(r => not(r.failed) and r.observedAt >= 0) and m.rows.some(r => r.failed)
```

### Merge activity is display-only: it changes no score, status or payment, and a failed refresh never fails the scheduled run

Nothing here feeds the Points journal, reward weights, project status,
work selection or settlement. The API lists only rows that were observed at
least once, each with its observation time and whether its last attempt
failed; a repository never read successfully is shown as unknown, never as
zero. A run ends however many of its reads failed, and the maintenance run
that triggered it never fails because of it.

```quint
pure def shownRows(m: MergeActivity): List[Row] = m.rows.select(r => r.observedAt >= 0)
pure def canEndRun(m: MergeActivity): bool = m.phase == Running
pure def endRun(m: MergeActivity): MergeActivity = { ...m, phase: Idle, runs: m.runs + 1 }
pure def alwaysRunningCanEnd(m: MergeActivity): bool = m.phase == Running implies canEndRun(m)
pure def alwaysUnreadNeverShown(m: MergeActivity): bool = shownRows(m).every(r => r.observedAt >= 0 and r.observedAt <= m.now)
pure def sometimesRunEndedWithFailures(m: MergeActivity): bool = m.phase == Idle and m.runs > 0 and m.rows.some(r => r.failed)
```

### Simulation samples cover stale, failed and never-read repositories

```quint
pure val measuredValues = Set(List(1, 2), List(1), List(2, 3), List(1, 1))
pure val elapsedValues = Set(0, 3600000, 72000000, 604800000)
pure val repositoryValues = Set(1, 2, 3)
pure val openPullsValues = Set(List(), List(openPull), List(openPull, { ...openPull, draft: true }),
  List({ ...openPull, bot: true }, { ...openPull, maintainerResponded: true }))
pure val mergedPullsValues = Set(List(), List(mergedPull), List(mergedPull, { ...mergedPull, maintainerAuthor: true }),
  List(mergedPull, { ...mergedPull, createdAt: 1800000 }))
pure val latestValues = Set(-1, 3600000)
pure val openCappedValues = Set(false, true)
```
