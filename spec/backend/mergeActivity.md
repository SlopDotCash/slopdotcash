# Repository merge activity

The operator decision of 15 November 2026 (#1993, PRD section 9) shows how
fast each registered repository merges outside work: when it last merged a
pull request, how many outside pull requests have waited seven days or more
without a response from anyone who can merge, and the median time to merge
of outside pull requests merged in the last 30 days. The Slopbot schedule
reads public GitHub facts once a day into D1, and project pages read the
stored rows through `GET /api/v1/merge-activity`; no page reads GitHub per
view. Sources at Slop development `87a26cc98`:
`backend/projects/merge-activity.ts:25–71,311,405`,
`migrations/0125_repository_merge_activity.sql`,
`workers/identity/index.ts:468–506` (the hourly cron runs it independently
of the other jobs and never fails the schedule for it) and the retained
`api_merge_activity` model. The page line is a
[projection](../frontend/projections.md).

One instance is the stored row of one (project, repository) and the
schedule's runs, which also read other repositories (`readOther`). Time is
whole hours. The shell's GitHub adapter supplies each repository's open and
recently merged pull requests with their author association, bot and draft
flags and whether someone who can merge responded; any read error is a
failure.

## Story: Read each repository once a day and keep the last values on failure

### Outside pull requests come from authors who cannot merge, never bots or drafts

An outside pull request's author is not an owner, member or collaborator
and is not a bot. The waiting count takes open outside pull requests that
are not drafts, were opened seven days or more ago and have no review or
comment from a maintainer. The median takes outside pull requests merged in
the last 30 days and is kept doubled, so an even count stays exact; with no
such pull request it is absent (`-1`), never zero.

```quint
type Association = Owner | Member | Collaborator | Contributor | FirstTimer | NoAssociation
type OpenPull = { association: Association, bot: bool, draft: bool, openedAt: int, maintainerResponded: bool }
type MergedPull = { association: Association, bot: bool, openedAt: int, mergedAt: int }
type Summary = { lastMergedAt: int, waitingOutside: int, waitingCapped: bool, mergedOutside30d: int, medianDoubled: int }
pure val waitingHours = 168
pure val medianWindowHours = 720
pure def outsideAuthor(association: Association, bot: bool): bool =
  not(bot) and association != Owner and association != Member and association != Collaborator
pure def waitingOutside(open: List[OpenPull], now: int): int = open.select(p => outsideAuthor(p.association, p.bot)
  and not(p.draft) and not(p.maintainerResponded) and p.openedAt <= now - waitingHours).length()
pure def recentDurations(merged: List[MergedPull], now: int): List[int] = merged.select(p =>
  outsideAuthor(p.association, p.bot) and p.mergedAt >= now - medianWindowHours and p.mergedAt >= p.openedAt)
  .listMap(p => p.mergedAt - p.openedAt)
pure def kth(xs: List[int], k: int): int =
  xs.foldl(-1, (best, x) => if (xs.select(y => y <= x).length() >= k and (best == -1 or x < best)) x else best)
pure def medianDoubled(xs: List[int]): int =
  val n = xs.length()
  if (n == 0) -1 else if (n % 2 == 1) 2 * kth(xs, (n + 1) / 2) else kth(xs, n / 2) + kth(xs, n / 2 + 1)
pure def summarize(open: List[OpenPull], capped: bool, merged: List[MergedPull], now: int): Summary =
  val durations = recentDurations(merged, now)
  { lastMergedAt: merged.foldl(0, (latest, p) => if (p.mergedAt > latest) p.mergedAt else latest),
    waitingOutside: waitingOutside(open, now), waitingCapped: capped,
    mergedOutside30d: durations.length(), medianDoubled: medianDoubled(durations) }
pure def lawMaintainersAndBotsAreNotOutside(association: Association, bot: bool): bool =
  (bot or association == Owner or association == Member or association == Collaborator) implies not(outsideAuthor(association, bot))
pure def lawNoMergesNoMedian(merged: List[MergedPull], now: int): bool =
  summarize(List(), false, merged, now).mergedOutside30d == 0 implies summarize(List(), false, merged, now).medianDoubled == -1
```

### A bounded daily run reads due repositories of active projects

The registry decides whether the repository is measured: it belongs to an
active, listed project; a paused or retired project's repositories are not
read. A repository is due when it has no row, 20 hours after its last
attempt, or an hour after a failed one. One run reads at most 15 due
repositories, oldest attempt first.

```quint
type Table = MergeActivityRows | Scores | ProjectStatus | Payments
type Write = { table: Table, repository: int }
type Row = { stored: bool, observedAt: int, attemptedAt: int, failed: bool, summary: Summary }
type Merges = { repository: int, now: int, measured: bool, listed: bool, row: Row, running: bool, reads: int }
type Outcome = { state: Merges, out: List[Write] }
pure val schedule = "slopbot-schedule"
pure val registry = "registry"
pure val repositoriesPerRun = 15
pure val refreshAfterHours = 20
pure val retryAfterHours = 1
pure val noSummary: Summary = { lastMergedAt: 0, waitingOutside: 0, waitingCapped: false, mergedOutside30d: 0, medianDoubled: -1 }
pure val noRow: Row = { stored: false, observedAt: 0, attemptedAt: 0, failed: false, summary: noSummary }
pure val initial: Merges = { repository: 1, now: 1, measured: false, listed: true, row: noRow, running: false, reads: 0 }
pure def due(m: Merges): bool =
  not(m.row.stored) or m.now - m.row.attemptedAt >= (if (m.row.failed) retryAfterHours else refreshAfterHours)
pure def canObserveClock(m: Merges, now: int, by: str): bool = by == schedule and now > m.now
pure def observeClock(m: Merges, now: int, by: str): Merges = { ...m, now: now }
pure def canObserveRegistry(m: Merges, measured: bool, by: str): bool = by == registry and measured != m.measured
pure def observeRegistry(m: Merges, measured: bool, by: str): Merges = { ...m, measured: measured }
pure def canStartRun(m: Merges, by: str): bool = by == schedule and not(m.running)
pure def startRun(m: Merges, by: str): Merges = { ...m, running: true, reads: 0 }
pure def canEndRun(m: Merges, by: str): bool = by == schedule and m.running
pure def endRun(m: Merges, by: str): Merges = { ...m, running: false }
```

### A success replaces the values; a failure keeps them with their date

A successful read sets the observed and attempted times and the values. A
failed read, including a missing App installation, only moves the attempted
time and sets the failure; the last values and their observed date stay,
never zero. A failure before any success stores no values, so the API serves
no row for that repository and the page line stays hidden. Every write goes
to the merge-activity rows only: nothing here changes a score, a project
status or a payment.

```quint
pure def readable(m: Merges, by: str): bool = by == schedule and m.running and m.reads < repositoriesPerRun
pure def canReadOther(m: Merges, by: str): bool = readable(m, by)
pure def readOther(m: Merges, by: str): Outcome =
  { state: { ...m, reads: m.reads + 1 }, out: List({ table: MergeActivityRows, repository: 0 }) }
pure def canReadSucceeded(m: Merges, open: List[OpenPull], capped: bool, merged: List[MergedPull], by: str): bool =
  readable(m, by) and m.measured and m.listed and due(m)
pure def readSucceeded(m: Merges, open: List[OpenPull], capped: bool, merged: List[MergedPull], by: str): Outcome =
  { state: { ...m, reads: m.reads + 1, row: { stored: true, observedAt: m.now, attemptedAt: m.now, failed: false,
      summary: summarize(open, capped, merged, m.now) } },
    out: List({ table: MergeActivityRows, repository: m.repository }) }
pure def canReadFailed(m: Merges, by: str): bool = readable(m, by) and m.measured and m.listed and due(m)
pure def readFailed(m: Merges, by: str): Outcome =
  { state: { ...m, reads: m.reads + 1, row: { ...m.row, stored: true, attemptedAt: m.now, failed: true } },
    out: List({ table: MergeActivityRows, repository: m.repository }) }
pure def served(m: Merges): bool = m.row.stored and m.row.observedAt > 0
```

### A path the project no longer lists is never read again and the next run deletes its row

The instance's repository is a path the project lists. A reviewed transfer
publishes the repository's new path, and the old path is then unlisted for
good: the registry reports it, the old path is never read again, and the
next run deletes its stored row, so
`GET /api/v1/merge-activity` no longer serves it and its stale values never
add to the project (Slop development `887f92d18`,
`backend/projects/merge-activity.ts:271–345`, the retained
`api_merge_activity` model). Only an unlisted path loses its row: a paused or
retired project's listed paths are not read but keep theirs. The deletion
leaves the last observed time in this model so that no time goes back; with
no stored row nothing of it is served. A row of a project the registry no
longer returns at all is not deleted by the run.

```quint
pure def canUnlistPath(m: Merges, by: str): bool = by == registry and m.listed
pure def unlistPath(m: Merges, by: str): Merges = { ...m, listed: false }
pure def canPrune(m: Merges, by: str): bool = by == schedule and m.running and not(m.listed) and m.row.stored
pure def prune(m: Merges, by: str): Outcome =
  { state: { ...m, row: { ...m.row, stored: false } }, out: List({ table: MergeActivityRows, repository: m.repository }) }
pure def stepUnlistedStaysUnlisted(before: Merges, after: Merges): bool = not(before.listed) implies not(after.listed)
pure def stepOnlyUnlistedRowsDeleted(before: Merges, via: str, after: Merges): bool =
  (before.row.stored and not(after.row.stored)) implies (via == "prune" and not(before.listed))
pure def stepUnlistedPathNotRead(before: Merges, via: str, after: Merges): bool =
  not(before.listed) implies (via != "readSucceeded" and via != "readFailed")
pure def sometimesTransferredRowDeleted(m: Merges): bool = not(m.listed) and not(m.row.stored) and m.row.observedAt > 0
pure def sometimesPausedRowKept(m: Merges): bool = m.listed and not(m.measured) and served(m)
```

### Rules

```quint
pure def stepWritesOnlyMergeRows(before: Merges, via: str, after: Merges, out: List[Write]): bool =
  out.every(w => w.table == MergeActivityRows)
pure def stepFailureKeepsLastValues(before: Merges, via: str, after: Merges): bool = via == "readFailed" implies
  after.row.observedAt == before.row.observedAt and after.row.summary == before.row.summary
pure def stepObservedNeverGoesBack(before: Merges, after: Merges): bool = after.row.observedAt >= before.row.observedAt
pure def alwaysRunBounded(m: Merges): bool = m.reads >= 0 and m.reads <= repositoriesPerRun
pure def alwaysUnobservedHasNoValues(m: Merges): bool = m.row.observedAt == 0 implies m.row.summary == noSummary
  and (m.row.stored implies m.row.failed)
pure def alwaysTimesOrdered(m: Merges): bool = m.row.observedAt <= m.row.attemptedAt and m.row.attemptedAt <= m.now and m.now >= 1
pure def sometimesStaleServed(m: Merges): bool = served(m) and m.row.failed and m.row.summary.mergedOutside30d > 0
pure def sometimesHiddenAfterFailure(m: Merges): bool = m.row.stored and not(served(m))
pure def sometimesCurrent(m: Merges): bool = served(m) and not(m.row.failed) and m.row.summary.waitingOutside > 0
pure def sometimesSeveralReadsInOneRun(m: Merges): bool = m.reads >= 2 and m.running and served(m)
pure def sometimesRunFull(m: Merges): bool = m.reads == repositoriesPerRun
pure val outsideOld: OpenPull = { association: Contributor, bot: false, draft: false, openedAt: 1, maintainerResponded: false }
pure val outsideMerged: MergedPull = { association: FirstTimer, bot: false, openedAt: 1, mergedAt: 3 }
pure val openValues = Set(List(), List(outsideOld, { ...outsideOld, association: Member }, { ...outsideOld, draft: true },
  { ...outsideOld, bot: true }))
pure val mergedValues = Set(List(), List(outsideMerged, { ...outsideMerged, association: Owner }))
pure val nowValues = Set(2, 22, 200)
pure val byValues = Set(schedule, registry)
pure val weight_readOther = 8
pure val weight_readSucceeded = 4
pure val weight_readFailed = 4
```
