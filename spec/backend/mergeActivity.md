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
`migrations/0125_repository_merge_activity.sql`, and at `8660a6121`
(`e126f2419`, `13d3f5144`) `migrations/0134_merge_activity_open_outside.sql`,
`0144_merge_activity_wanted_issues.sql`, `src/lib/wanted-label.mjs` and
`workers/slopbot/reporting-readiness.ts` (`ensureWantedLabel`),
`workers/identity/index.ts:468–506` (the hourly cron runs it independently
of the other jobs and never fails the schedule for it) and the retained
`api_merge_activity` model. The page line is a
[projection](../frontend/projections.md).

One instance is the stored row of one (project, repository) and the
schedule's runs, which also read other repositories (`readOther`). Time is
whole hours. The shell's GitHub adapter supplies each repository's open and
recently merged pull requests with their author association, bot and draft
flags and whether someone who can merge responded; any read error is a
failure. The registry also reports whether the project has an
[intake cap](./intakeCap.md) and its wanted label (`slop-wanted` while the
owner turned `slopbot.wantedIssues` on, empty otherwise).

## Story: Read each repository once a day and keep the last values on failure

### Outside pull requests come from authors who cannot merge, never bots or drafts

An outside pull request's author is not an owner, member or collaborator
and is not a bot. The waiting count takes open outside pull requests that
are not drafts, were opened seven days or more ago and have no review or
comment from a maintainer. The 30-day count takes every outside pull request
merged in the last 30 days. The median takes their merge durations that are
not negative (a merge time before the opening time counts but has no
duration) and is kept doubled, so an even count stays exact; with no such
duration it is absent (`-1`), never zero. The open count for the intake cap
(`openOutside`) takes every open outside pull request that is not a draft,
answered or not: those of the waiting pages and those counted beyond them
(`countedBeyond`); it is capped (`openOutsideCapped`, a floor) when the count
pages end with more pages left.

```quint
type Association = Owner | Member | Collaborator | Contributor | FirstTimer | NoAssociation
type OpenPull = { association: Association, bot: bool, draft: bool, openedAt: int, maintainerResponded: bool }
type MergedPull = { association: Association, bot: bool, openedAt: int, mergedAt: int }
type Summary = { lastMergedAt: int, waitingOutside: int, waitingCapped: bool, mergedOutside30d: int, medianDoubled: int,
  openOutside: int, openOutsideCapped: bool }
pure val waitingHours = 168
pure val medianWindowHours = 720
pure def outsideAuthor(association: Association, bot: bool): bool =
  not(bot) and association != Owner and association != Member and association != Collaborator
pure def waitingOutside(open: List[OpenPull], now: int): int = open.select(p => outsideAuthor(p.association, p.bot)
  and not(p.draft) and not(p.maintainerResponded) and p.openedAt <= now - waitingHours).length()
pure def recentMerges(merged: List[MergedPull], now: int): List[MergedPull] = merged.select(p =>
  outsideAuthor(p.association, p.bot) and p.mergedAt >= now - medianWindowHours)
pure def recentDurations(merged: List[MergedPull], now: int): List[int] =
  recentMerges(merged, now).select(p => p.mergedAt >= p.openedAt).listMap(p => p.mergedAt - p.openedAt)
pure def kth(xs: List[int], k: int): int =
  xs.foldl(-1, (best, x) => if (xs.select(y => y <= x).length() >= k and (best == -1 or x < best)) x else best)
pure def medianDoubled(xs: List[int]): int =
  val n = xs.length()
  if (n == 0) -1 else if (n % 2 == 1) 2 * kth(xs, (n + 1) / 2) else kth(xs, n / 2) + kth(xs, n / 2 + 1)
pure def outsideOpen(open: List[OpenPull], countedBeyond: int): int =
  open.select(p => outsideAuthor(p.association, p.bot) and not(p.draft)).length() + countedBeyond
pure def summarize(open: List[OpenPull], capped: bool, merged: List[MergedPull], now: int, countedBeyond: int,
  countCapped: bool): Summary =
  val durations = recentDurations(merged, now)
  { lastMergedAt: merged.foldl(0, (latest, p) => if (p.mergedAt > latest) p.mergedAt else latest),
    waitingOutside: waitingOutside(open, now), waitingCapped: capped,
    mergedOutside30d: recentMerges(merged, now).length(), medianDoubled: medianDoubled(durations),
    openOutside: outsideOpen(open, countedBeyond), openOutsideCapped: countCapped }
pure def lawMaintainersAndBotsAreNotOutside(association: Association, bot: bool): bool =
  (bot or association == Owner or association == Member or association == Collaborator) implies not(outsideAuthor(association, bot))
pure def lawNoMergesNoMedian(merged: List[MergedPull], now: int): bool =
  summarize(List(), false, merged, now, 0, false).mergedOutside30d == 0 implies
    summarize(List(), false, merged, now, 0, false).medianDoubled == -1
pure def lawCountKeepsMergesWithoutDuration(merged: List[MergedPull], now: int): bool =
  summarize(List(), false, merged, now, 0, false).mergedOutside30d >= recentDurations(merged, now).length()
pure def lawOpenCountCoversWaiting(open: List[OpenPull], now: int): bool =
  outsideOpen(open, 0) >= waitingOutside(open, now)
```

### A bounded daily run reads due repositories of active projects

The registry decides whether the repository is measured: it belongs to an
active, listed project; a paused or retired project's repositories are not
read. A repository is due when it has no row; after a failed attempt, an
hour later (45 minutes for a project with an intake cap); otherwise when the
project's wanted label differs from the stored row's, or 45 minutes after its
last attempt for a project with an intake cap (so every hourly run reads
it), six hours for a project with a wanted label and 20 hours for any other
(`due`, `INTAKE_REFRESH_AFTER_MS`, `WANTED_REFRESH_AFTER_MS`). Time here is
whole hours, so the 45 minutes are one hour: the hourly run is the clock.
One run reads at most 15 due repositories, oldest attempt first. Each read
takes open pull requests oldest first, 50 a page, at most 6 pages, and stops
at the first page that reaches one opened less than 7 days ago or has no
next page; the waiting count is capped when the sixth page ends the read
with more pages left. When the waiting walk stops with a next page, the rest
of the open list is only counted, from that cursor, 100 a page and at most 7
pages; the open count is capped when the seventh count page still has a next
page (`COUNT_PAGE`, `COUNT_PAGES`). Merged pull requests are read from 30
days back, at most 3 pages of 100 (Slop development
`backend/projects/merge-activity.ts`, `OPEN_PAGE`, `OPEN_PAGES`,
`MERGED_PAGE`, `MERGED_PAGES`).

```quint
type Table = MergeActivityRows | GithubLabel | Scores | ProjectStatus | Payments
type Write = { table: Table, repository: int }
type WantedIssue = { number: int, ownRepository: bool, openPulls: int }
type Row = { stored: bool, observedAt: int, attemptedAt: int, failed: bool, summary: Summary, label: str,
  wanted: List[WantedIssue], labelReady: str }
type Merges = { repository: int, now: int, measured: bool, listed: bool, row: Row, running: bool, reads: int,
  intake: bool, label: str, labelPending: bool }
type Outcome = { state: Merges, out: List[Write] }
pure val schedule = "slopbot-schedule"
pure val registry = "registry"
pure val repositoriesPerRun = 15
pure val refreshAfterHours = 20
pure val retryAfterHours = 1
pure val intakeRefreshHours = 1
pure val wantedRefreshHours = 6
pure val countPageSize = 100
pure val countPages = 7
pure val openPageSize = 50
pure val openPages = 6
pure val mergedPageSize = 100
pure val mergedPages = 3
pure def openReadCapped(page: int, hasNextPage: bool, reachedRecent: bool): bool =
  page == openPages and hasNextPage and not(reachedRecent)
pure def lawCapNeedsTheLastOpenPage(page: int, hasNextPage: bool, reachedRecent: bool): bool =
  openReadCapped(page, hasNextPage, reachedRecent) implies (page == openPages and not(reachedRecent))
pure def countReadCapped(page: int, hasNextPage: bool): bool = page == countPages and hasNextPage
pure val maxCountedBeyond = countPageSize * countPages
pure val noSummary: Summary = { lastMergedAt: 0, waitingOutside: 0, waitingCapped: false, mergedOutside30d: 0, medianDoubled: -1,
  openOutside: 0, openOutsideCapped: false }
pure val noRow: Row = { stored: false, observedAt: 0, attemptedAt: 0, failed: false, summary: noSummary, label: "",
  wanted: List(), labelReady: "" }
pure val initial: Merges = { repository: 1, now: 1, measured: false, listed: true, row: noRow, running: false, reads: 0,
  intake: false, label: "", labelPending: false }
pure def refreshHours(m: Merges): int =
  if (m.intake) intakeRefreshHours else if (m.label != "") wantedRefreshHours else refreshAfterHours
pure def due(m: Merges): bool =
  not(m.row.stored) or (if (m.row.failed) m.now - m.row.attemptedAt >= (if (m.intake) intakeRefreshHours else retryAfterHours)
    else ((m.label != "" and m.row.label != m.label) or m.now - m.row.attemptedAt >= refreshHours(m)))
pure def canObserveClock(m: Merges, now: int, by: str): bool = by == schedule and now > m.now
pure def observeClock(m: Merges, now: int, by: str): Merges = { ...m, now: now }
pure def canObserveRegistry(m: Merges, measured: bool, intake: bool, label: str, by: str): bool =
  by == registry and (label == "" or label == wantedLabelName) and
    (measured != m.measured or intake != m.intake or label != m.label)
pure def observeRegistry(m: Merges, measured: bool, intake: bool, label: str, by: str): Merges =
  { ...m, measured: measured, intake: intake, label: label }
pure def canStartRun(m: Merges, by: str): bool = by == schedule and not(m.running)
pure def startRun(m: Merges, by: str): Merges = { ...m, running: true, reads: 0 }
pure def canEndRun(m: Merges, by: str): bool = by == schedule and m.running
pure def endRun(m: Merges, by: str): Merges = { ...m, running: false, labelPending: false }
```

### A success replaces the values; a failure keeps them with their date

A successful read sets the observed and attempted times and the values. A
failed read, including a missing App installation, only moves the attempted
time and sets the failure; the last values and their observed date stay,
never zero. A failure before any success stores no values, so the API serves
no row for that repository and the page line stays hidden. A success also
stores the open count and, while the project's wanted label is on, the label
and its issues (below); with the label off it stores neither. Apart from the
wanted label (below), every write goes to the merge-activity rows only:
nothing here changes a score, a project status or a payment.

```quint
pure def readable(m: Merges, by: str): bool = by == schedule and m.running and m.reads < repositoriesPerRun
pure def canReadOther(m: Merges, by: str): bool = readable(m, by)
pure def readOther(m: Merges, by: str): Outcome =
  { state: { ...m, reads: m.reads + 1 }, out: List({ table: MergeActivityRows, repository: 0 }) }
pure def canReadSucceeded(m: Merges, open: List[OpenPull], capped: bool, merged: List[MergedPull], countedBeyond: int,
  countCapped: bool, wanted: List[WantedIssue], by: str): bool =
  readable(m, by) and m.measured and m.listed and due(m) and countedBeyond >= 0 and countedBeyond <= maxCountedBeyond
    and (m.label == "" or wantedValid(wanted))
pure def readSucceeded(m: Merges, open: List[OpenPull], capped: bool, merged: List[MergedPull], countedBeyond: int,
  countCapped: bool, wanted: List[WantedIssue], by: str): Outcome =
  val on = m.label != ""
  val ready = if (on) m.row.labelReady else ""
  { state: { ...m, reads: m.reads + 1, labelPending: on and ready != m.label,
      row: { stored: true, observedAt: m.now, attemptedAt: m.now, failed: false,
        summary: summarize(open, capped, merged, m.now, countedBeyond, countCapped), label: m.label,
        wanted: if (on) wanted else List(), labelReady: ready } },
    out: List({ table: MergeActivityRows, repository: m.repository }) }
pure def canReadFailed(m: Merges, by: str): bool = readable(m, by) and m.measured and m.listed and due(m)
pure def readFailed(m: Merges, by: str): Outcome =
  { state: { ...m, reads: m.reads + 1, labelPending: false, row: { ...m.row, stored: true, attemptedAt: m.now, failed: true } },
    out: List({ table: MergeActivityRows, repository: m.repository }) }
pure def served(m: Merges): bool = m.row.stored and m.row.observedAt > 0
```

### Wanted issues are read with the activity and their label is created once

When the registry reports the project's wanted label (operator decision,
21 November 2026; PRD section 5), a successful read also stores the open
issues carrying it: at most 20, oldest first, each with its number, its
title cut to 200 characters, its URL and the number of open pull requests
GitHub links as closing it, never below zero. An issue whose URL is not the
repository's own issue URL (`https://github.com/<owner>/<name>/issues/<number>`,
compared without case) fails the whole read, which keeps the last values as
any failure does. A row stores its label and list only while the label is
on, and `GET /api/v1/merge-activity` serves them only when both are stored.
After a successful read, once per label value, the schedule ensures the
label exists on the repository (`ensureWantedLabel`): it reads the label and
creates it when it is missing (404) with the colour `f97316` and the
description "Most wanted by the maintainers. Listed on slop.cash."; a create
that finds it already present (422) counts as done. Success records the
label as ready on the row; a failed read or create keeps the list as read
and is tried again at the next read. The shell writes the read and the
label's readiness in one upsert. Creating that one label is the only GitHub
write of the schedule, made with an installation token scoped to issues
write (the read uses pull requests read and issues read); it never edits,
renames or applies a label, and Points, value assessment, scoring, the
monthly close and payment never read the label.

```quint
type LabelAttempt = LabelFound | LabelCreated | LabelCreateRaced | LabelCreateFailed | LabelReadFailed
pure val wantedLabelName = "slop-wanted"
pure val wantedIssuesStored = 20
pure val wantedTitleLength = 200
pure val wantedLabelColor = "f97316"
pure val wantedLabelDescription = "Most wanted by the maintainers. Listed on slop.cash."
pure def wantedValid(xs: List[WantedIssue]): bool =
  xs.length() <= wantedIssuesStored and xs.every(i => i.ownRepository and i.openPulls >= 0)
pure def labelExists(attempt: LabelAttempt): bool =
  attempt == LabelFound or attempt == LabelCreated or attempt == LabelCreateRaced
pure def labelPosted(attempt: LabelAttempt): bool =
  attempt == LabelCreated or attempt == LabelCreateRaced or attempt == LabelCreateFailed
pure def canEnsureLabel(m: Merges, attempt: LabelAttempt, by: str): bool =
  by == schedule and m.running and m.labelPending and m.label != "" and m.row.label == m.label and m.row.labelReady != m.label
pure def ensureLabel(m: Merges, attempt: LabelAttempt, by: str): Outcome =
  { state: { ...m, labelPending: false,
      row: { ...m.row, labelReady: if (labelExists(attempt)) m.label else m.row.labelReady } },
    out: if (labelPosted(attempt))
        List({ table: GithubLabel, repository: m.repository }, { table: MergeActivityRows, repository: m.repository })
      else List({ table: MergeActivityRows, repository: m.repository }) }
pure def alwaysNoWantedWithoutLabel(m: Merges): bool =
  (m.row.label == "" implies (m.row.wanted == List() and m.row.labelReady == "")) and wantedValid(m.row.wanted)
    and (m.row.labelReady == "" or m.row.labelReady == m.row.label) and (m.label == "" or m.label == wantedLabelName)
    and (m.row.label == "" or m.row.label == wantedLabelName)
pure def stepLabelCreatedOnlyWhenNotReady(before: Merges, via: str, after: Merges, out: List[Write]): bool =
  out.some(w => w.table == GithubLabel) implies
    (via == "ensureLabel" and before.label != "" and before.row.labelReady != before.label)
pure def sometimesWantedListed(m: Merges): bool = served(m) and m.row.label != "" and m.row.wanted.length() > 0
pure def sometimesLabelReady(m: Merges): bool = m.row.labelReady != "" and m.row.labelReady == m.label
pure def sometimesLabelRetriedAfterFailure(m: Merges): bool =
  served(m) and m.row.label != "" and m.row.labelReady == "" and not(m.labelPending)
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
  out.every(w => w.table == MergeActivityRows or (w.table == GithubLabel and via == "ensureLabel"))
pure def stepFailureKeepsLastValues(before: Merges, via: str, after: Merges): bool = via == "readFailed" implies
  after.row.observedAt == before.row.observedAt and after.row.summary == before.row.summary
pure def stepObservedNeverGoesBack(before: Merges, after: Merges): bool = after.row.observedAt >= before.row.observedAt
pure def alwaysRunBounded(m: Merges): bool = m.reads >= 0 and m.reads <= repositoriesPerRun
pure def alwaysUnobservedHasNoValues(m: Merges): bool = m.row.observedAt == 0 implies m.row.summary == noSummary
  and (m.row.stored implies m.row.failed)
pure def alwaysTimesOrdered(m: Merges): bool = m.row.observedAt <= m.row.attemptedAt and m.row.attemptedAt <= m.now and m.now >= 1
pure def alwaysOpenCountCoversWaiting(m: Merges): bool = m.row.summary.openOutside >= m.row.summary.waitingOutside
pure def sometimesStaleServed(m: Merges): bool = served(m) and m.row.failed and m.row.summary.mergedOutside30d > 0
pure def sometimesHiddenAfterFailure(m: Merges): bool = m.row.stored and not(served(m))
pure def sometimesCurrent(m: Merges): bool = served(m) and not(m.row.failed) and m.row.summary.waitingOutside > 0
pure def sometimesSeveralReadsInOneRun(m: Merges): bool = m.reads >= 2 and m.running and served(m)
pure def sometimesRunFull(m: Merges): bool = m.reads == repositoriesPerRun
pure def sometimesCappedProjectReadHourly(m: Merges): bool =
  m.intake and served(m) and not(m.row.failed) and m.row.summary.openOutside > m.row.summary.waitingOutside
    and m.row.observedAt > 2
pure val outsideOld: OpenPull = { association: Contributor, bot: false, draft: false, openedAt: 1, maintainerResponded: false }
pure val outsideMerged: MergedPull = { association: FirstTimer, bot: false, openedAt: 1, mergedAt: 3 }
pure val openValues = Set(List(), List(outsideOld, { ...outsideOld, association: Member }, { ...outsideOld, draft: true },
  { ...outsideOld, bot: true }))
pure val mergedValues = Set(List(), List(outsideMerged, { ...outsideMerged, association: Owner }),
  List(outsideMerged, { ...outsideMerged, openedAt: 5, mergedAt: 3 }))
pure val nowValues = Set(2, 22, 200)
pure val byValues = Set(schedule, registry)
pure val countedBeyondValues = Set(0, 3, 700, 701)
pure val wantedValues = Set(List(), List({ number: 7, ownRepository: true, openPulls: 1 }),
  List({ number: 8, ownRepository: false, openPulls: 0 }), List({ number: 9, ownRepository: true, openPulls: -1 }))
pure val labelValues = Set("", wantedLabelName, "other")
pure val attemptValues = Set(LabelFound, LabelCreated, LabelCreateRaced, LabelCreateFailed, LabelReadFailed)
pure val weight_readOther = 8
pure val weight_readSucceeded = 4
pure val weight_readFailed = 4
```
