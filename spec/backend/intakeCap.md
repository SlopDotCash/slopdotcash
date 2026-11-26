# Project intake cap

PRD sections 5 and 9 (operator decision, 17 November 2026): a project owner
may set an intake cap in project settings, one whole number from 1 to 500,
stored as `slopbot.intakeCap`: pause new contributors when this many outside
pull requests are open. Absent means off, and each change is an immutable
owner revision, not a material term. Sources at Slop development `e126f2419`:
`src/lib/intake-cap.mjs` (`INTAKE_CAP_LIMITS`, `INTAKE_COUNT_MAX_AGE_MS`,
`INTAKE_PAUSED_NOTICE`, `intakePaused`), `backend/projects/merge-activity.ts`
(`openOutside`, `INTAKE_REFRESH_AFTER_MS`, `due`),
`backend/projects/skill-publication.ts`, `workers/slopbot/intake-cap.ts`
(`intakeCapRefuses`), `migrations/0134_merge_activity_open_outside.sql` and
the retained model `formal/models/api/api_intake_cap.qnt`.

The count is every open pull request from an outside contributor (author
not an owner, member or collaborator, not a bot, not a draft) in one
repository, answered or not. The scheduled [merge activity](./mergeActivity.md)
read stores it with its observed time, counting past its waiting pages in
lighter pages, and reads a project with a cap at every hourly run instead of
once a day. A failed read keeps the last count and its date.

One instance is one project with two repositories, which stand for "any
repository of the project", the browser's read of the stored counts, the
server's read for agent discovery, and Slopbot's advisory review of one pull
request. Time is whole hours. The funding rule of the
[monthly listing](../frontend/poolListing.md) composes with this one by
conjunction.

## Story: Pause new contributors while the review queue is full

> As a project owner, I want new contributors to stop arriving while my
> review queue is full, so that the queue can drain without turning away
> work already in progress.

### The count takes every open outside pull request that is not a draft, answered or not

```quint
import mergeActivity as MA from "./mergeActivity"
pure def openOutsideCount(open: List[MA::OpenPull], countedBeyondPages: int): int = MA::outsideOpen(open, countedBeyondPages)
pure def lawDraftsMaintainersAndBotsNeverCount(p: MA::OpenPull): bool =
  (p.draft or p.bot or p.association == MA::Owner or p.association == MA::Member or p.association == MA::Collaborator)
    implies openOutsideCount(List(p), 0) == 0
pure def lawAnsweredPullStillCounts(p: MA::OpenPull): bool =
  (MA::outsideAuthor(p.association, p.bot) and not(p.draft)) implies openOutsideCount(List({ ...p, maintainerResponded: true }), 0) == 1
pure val pValues = Set(MA::outsideOld, { ...MA::outsideOld, draft: true }, { ...MA::outsideOld, association: MA::Member },
  { ...MA::outsideOld, maintainerResponded: true }, { ...MA::outsideOld, bot: true })
```

### A recent count at or above the cap of an active project pauses it

While the latest count of any of the project's repositories is at or above
the number, observed no more than three days ago, the project has paused new
contributors. A count that was never read, could not be read or is older
than three days pauses nothing; off pauses nothing; a paused or retired
project is not listed for this reason. The project comes back by itself when
a later count is below the number.

```quint
type StoredCount = { read: bool, count: int, observedAt: int }
type ListRead = ListLoading | ListReady | ListFailed
type ReviewOutcome = NoReview | Reviewed | SkippedForIntake
type Intake = { cap: int, active: bool, now: int, counts: List[StoredCount], browser: ListRead, server: ListRead,
  reviewedBefore: bool, outcome: ReviewOutcome, skipWhilePaused: bool, wasPaused: bool }
pure val owner = "owner"
pure val registry = "registry"
pure val schedule = "slopbot-schedule"
pure val browserReader = "browser"
pure val discoveryServer = "server"
pure val slopbot = "slopbot"
pure val minCap = 1
pure val maxCap = 500
pure val countMaxAgeHours = 72
pure val pausedNotice = "This project has paused new contributors because its review queue is full. Accepted work still records points."
pure val unread: StoredCount = { read: false, count: 0, observedAt: 0 }
pure def countAtCap(cap: int, c: StoredCount, now: int): bool =
  c.read and c.count >= cap and now - c.observedAt <= countMaxAgeHours
pure def paused(s: Intake): bool = s.active and s.cap >= minCap and s.counts.some(c => countAtCap(s.cap, c, s.now))
pure def lawOffPausesNothing(c: StoredCount, now: int): bool =
  not(paused({ cap: 0, active: true, now: now, counts: List(c), browser: ListReady, server: ListReady,
    reviewedBefore: false, outcome: NoReview, skipWhilePaused: false, wasPaused: false }))
pure def lawUnreadOrOldCountPausesNothing(cap: int, c: StoredCount, now: int): bool =
  (not(c.read) or now - c.observedAt > countMaxAgeHours) implies not(countAtCap(cap, c, now))
pure val initial: Intake = { cap: 0, active: true, now: 1, counts: List(unread, unread), browser: ListLoading,
  server: ListLoading, reviewedBefore: false, outcome: NoReview, skipWhilePaused: false, wasPaused: false }
pure def canSetCap(s: Intake, cap: int, by: str): bool = by == owner and (cap == 0 or (cap >= minCap and cap <= maxCap))
pure def setCap(s: Intake, cap: int, by: str): Intake = { ...s, cap: cap, wasPaused: s.wasPaused or paused({ ...s, cap: cap }) }
pure def canObserveStatus(s: Intake, active: bool, by: str): bool = by == registry and active != s.active
pure def observeStatus(s: Intake, active: bool, by: str): Intake = { ...s, active: active }
pure def canObserveClock(s: Intake, now: int, by: str): bool = by == schedule and now > s.now
pure def observeClock(s: Intake, now: int, by: str): Intake = { ...s, now: now }
pure def canStoreCount(s: Intake, repository: int, count: int, by: str): bool =
  by == schedule and repository >= 0 and repository < s.counts.length() and count >= 0
pure def storeCount(s: Intake, repository: int, count: int, by: str): Intake =
  val stored = { ...s, counts: s.counts.foldl(List(), (acc, c) =>
    acc.append(if (acc.length() == repository) { read: true, count: count, observedAt: s.now } else c)) }
  { ...stored, wasPaused: s.wasPaused or paused(stored) }
pure def canFailRead(s: Intake, repository: int, by: str): bool = by == schedule and repository >= 0 and repository < s.counts.length()
pure def failRead(s: Intake, repository: int, by: str): Intake = s
```

### The lists leave a paused project out, its page says why, and a failed read lists it as before

While a paused project's counts are read, the home page, /sponsors and agent
discovery (`/.well-known/slop/projects.json`) leave it out and its page shows
the notice; skills keep serving by direct link and private security
reporting is unaffected. The browser lists every project while its read
loads or after it fails, and discovery lists every project when the server's
read fails.

```quint
pure def canBrowserRead(s: Intake, ok: bool, by: str): bool = by == browserReader
pure def browserRead(s: Intake, ok: bool, by: str): Intake = { ...s, browser: if (ok) ListReady else ListFailed }
pure def canServerRead(s: Intake, ok: bool, by: str): bool = by == discoveryServer
pure def serverRead(s: Intake, ok: bool, by: str): Intake = { ...s, server: if (ok) ListReady else ListFailed }
pure def onHome(s: Intake): bool = not(s.browser == ListReady and paused(s))
pure def onSponsors(s: Intake): bool = not(s.browser == ListReady and paused(s))
pure def discovered(s: Intake): bool = not(s.server == ListReady and paused(s))
pure def noticeShown(s: Intake): bool = s.browser == ListReady and paused(s)
pure def alwaysUnpausedIsListed(s: Intake): bool =
  not(paused(s)) implies (onHome(s) and onSponsors(s) and discovered(s) and not(noticeShown(s)))
pure def alwaysFailedReadListsAsBefore(s: Intake): bool =
  (s.browser != ListReady implies (onHome(s) and onSponsors(s) and not(noticeShown(s))))
    and (s.server != ListReady implies discovered(s))
pure def alwaysNoticeExplainsAbsence(s: Intake): bool = noticeShown(s) implies (not(onHome(s)) and not(onSponsors(s)))
```

### Slopbot skips only a new outside pull request of a paused project, and scoring never reads the cap

While the project is paused, Slopbot skips its free advisory review of an
outside pull request it has not completed a review of before, records the
skip with the reason `intake-cap` and posts nothing. A pull request reviewed
once keeps its reviews on later pushes, and a maintainer's pull request is
reviewed. Points, value assessment, scoring, the monthly close and payment
never read the cap: work a maintainer merges scores exactly as before.

```quint
pure val intakeCapReason = "intake-cap"
pure def canReview(s: Intake, outside: bool, by: str): bool = by == slopbot
pure def review(s: Intake, outside: bool, by: str): Intake =
  if (paused(s) and outside and not(s.reviewedBefore)) { ...s, outcome: SkippedForIntake, skipWhilePaused: true }
  else { ...s, outcome: Reviewed, reviewedBefore: true }
pure def alwaysSkipOnlyNewPullWhilePaused(s: Intake): bool =
  s.outcome == SkippedForIntake implies (s.skipWhilePaused and not(s.reviewedBefore))
pure def stepReviewedPullKeepsItsReviews(before: Intake, via: str, after: Intake): bool =
  (via == "review" and before.reviewedBefore) implies after.outcome == Reviewed
pure def alwaysCapWithinLimits(s: Intake): bool = s.cap == 0 or (s.cap >= minCap and s.cap <= maxCap)
pure def sometimesPausedAndExplained(s: Intake): bool = noticeShown(s) and not(discovered(s))
pure def sometimesBackByItself(s: Intake): bool = s.wasPaused and not(paused(s)) and s.cap >= minCap and s.active
  and s.counts.every(c => c.read) and s.browser == ListReady
pure def sometimesOldCountPausesNothing(s: Intake): bool = s.cap >= minCap and s.counts.some(c => c.read and c.count >= s.cap)
  and not(paused(s)) and s.active
pure def sometimesNewPullSkipped(s: Intake): bool = s.outcome == SkippedForIntake
pure def sometimesReviewedPullReviewedWhilePaused(s: Intake): bool = paused(s) and s.outcome == Reviewed and s.reviewedBefore
pure val capValues = Set(0, 1, 2, 501)
pure val countValues = Set(0, 1, 3)
pure val repositoryValues = Set(0, 1)
pure val nowValues = Set(2, 40, 80)
pure val cValues = Set(unread, { read: true, count: 3, observedAt: 1 })
pure val byValues = Set(owner, registry, schedule, browserReader, discoveryServer, slopbot)
pure val weight_storeCount = 3
pure val weight_setCap = 2
```
