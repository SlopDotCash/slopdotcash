# Backlog rule and catch-up pause

PRD sections 5 and 9 (operator decision, 23 November 2026): a listed
monthly-pool project whose maintainers stop keeping up with outside pull
requests leaves rotation until the backlog clears. The rule is required,
not an owner setting; the owner's optional [intake cap](./intakeCap.md)
stays a lower limit of their own. Out of rotation starts at
2026-12-01T00:00:00.000Z; before that nothing leaves rotation and no page
changes, and the owner hears once if the project would leave on the
current figures.

The rule reads the stored [merge activity](./mergeActivity.md) rows: the
count of outside pull requests waiting at least seven days, summed over
the project's repositories, and the latest merge in any repository. A
read taken no more than three days ago decides; without a read that
recent the project stays listed. External-prize projects and security-only
projects (bounty-only, or beside a monthly amount of zero, for example
Umia and Orbio) are not judged. A catch-up pause, set by the owner in
`slopbot.catchUpUntil`, keeps a project in rotation for at most fourteen
days while its maintainers catch up.

One instance is one project with two repositories, which stand for "any
repository of the project", the browser's read of the stored activity,
the server's read for agent discovery, and the scheduled Slopbot run that
sends the notices right after it refreshes merge activity. Time is whole
hours, months are whole UTC months as `YYYYMM`. The funding rule of the
[monthly listing](../frontend/poolListing.md) composes with this one by
conjunction, and the intake cap composes with it by conjunction: a project
is listed only when neither rule holds it.

## Story: Keep the lists to projects whose maintainers are keeping up

> As a contributor, I want the home page, /sponsors and agent discovery to
> show only projects whose maintainers are keeping up with outside pull
> requests, so that work I start has a maintainer ready to review it.

### Fifty or more waiting pull requests take a project out of rotation

While the count of outside pull requests waiting at least seven days,
summed over the project's repositories from reads taken no more than three
days ago, is fifty or more, the project is out of rotation. The count is
the same outside pull request the merge activity read counts: opened by
an outside author, not a bot, not a draft, answered or not.

```quint
type BacklogRead = { read: bool, waiting: int, lastMergedAt: int, observedAt: int }
pure val overLimit = 50
pure val readMaxAgeHours = 72
pure val startsAtHours = 498912
pure val unreadRead: BacklogRead = { read: false, waiting: 0, lastMergedAt: 0, observedAt: 0 }
pure def hasRecentRead(reads: List[BacklogRead], now: int): bool =
  reads.some(r => r.read and now - r.observedAt <= readMaxAgeHours)
pure def recentWaiting(reads: List[BacklogRead], now: int): int =
  reads.foldl(0, (total, r) => total + (if (r.read and now - r.observedAt <= readMaxAgeHours) r.waiting else 0))
pure def recentMerged(reads: List[BacklogRead], now: int): int =
  reads.foldl(0, (latest, r) => if (r.read and now - r.observedAt <= readMaxAgeHours and r.lastMergedAt > latest) r.lastMergedAt else latest)
pure def overLimitHeld(reads: List[BacklogRead], now: int): bool =
  hasRecentRead(reads, now) and recentWaiting(reads, now) >= overLimit
pure def lawSingleRepoOverLimitHolds(r: BacklogRead, now: int): bool =
  overLimitHeld(List(r), now) == (r.read and r.waiting >= overLimit and now - r.observedAt <= readMaxAgeHours)
```

### Work waiting with no merge in fourteen days is dormant

While at least one outside pull request waits and the latest merge in any
repository is more than fourteen days ago, or no merge was ever found, the
project is dormant and out of rotation. A quiet project with nothing
waiting is never dormant. One merge clears dormancy at the next recent
read. Ten days without a merge while work waits sends the owner one
warning, four days before dormancy.

```quint
pure val dormantHours = 336
pure def dormantHeld(reads: List[BacklogRead], now: int): bool =
  hasRecentRead(reads, now) and recentWaiting(reads, now) >= 1
    and (recentMerged(reads, now) == 0 or now - recentMerged(reads, now) >= dormantHours)
pure def dormantWarningDue(reads: List[BacklogRead], now: int): bool =
  hasRecentRead(reads, now) and recentWaiting(reads, now) >= 1 and recentMerged(reads, now) != 0
    and now - recentMerged(reads, now) >= 240 and now - recentMerged(reads, now) < dormantHours
pure def lawSingleRepoDormantHolds(r: BacklogRead, now: int): bool =
  dormantHeld(List(r), now) == (r.read and r.waiting >= 1 and (r.lastMergedAt == 0 or now - r.lastMergedAt >= dormantHours)
    and now - r.observedAt <= readMaxAgeHours)
pure def lawQuietNeverDormant(reads: List[BacklogRead], now: int): bool =
  recentWaiting(reads, now) == 0 implies not(dormantHeld(reads, now))
pure def lawNoReadHoldsNothing(reads: List[BacklogRead], now: int): bool =
  not(hasRecentRead(reads, now)) implies (not(overLimitHeld(reads, now)) and not(dormantHeld(reads, now)))
pure def lawOneMergeClearsDormancy(reads: List[BacklogRead], now: int): bool =
  (hasRecentRead(reads, now) and recentMerged(reads, now) != 0 and now - recentMerged(reads, now) < dormantHours)
    implies not(dormantHeld(reads, now))
```

### No recent read decides nothing, and nothing leaves rotation before 1 December 2026

A read that was never taken, could not be taken or is older than three
days decides nothing, and a failed read keeps the last read and its date.
Out of rotation starts at 2026-12-01T00:00:00.000Z; before that a project
stays listed whatever its backlog. An inactive project, and an exempt
project, are not judged.

```quint
type ListRead = ListLoading | ListReady | ListFailed
type Backlog = { active: bool, exempt: bool, now: int, reads: List[BacklogRead], browser: ListRead, server: ListRead,
  catchingUp: bool, catchUpUntil: int, catchUpStartedAt: int, catchUpStartMonth: int, catchUpHistory: List[int],
  wasOut: bool, sentKeys: Set[str] }
pure val owner = "owner"
pure val registry = "registry"
pure val schedule = "slopbot-schedule"
pure val browserReader = "browser"
pure val discoveryServer = "server"
pure val slopbot = "slopbot"
pure val initial: Backlog = { active: true, exempt: false, now: 1, reads: List(unreadRead, unreadRead), browser: ListLoading,
  server: ListLoading, catchingUp: false, catchUpUntil: 0, catchUpStartedAt: 0, catchUpStartMonth: 0, catchUpHistory: List(),
  wasOut: false, sentKeys: Set() }
pure def catchUpRunning(s: Backlog): bool = s.catchingUp and s.now < s.catchUpUntil
pure def outOfRotation(s: Backlog): bool =
  s.active and not(s.exempt) and not(catchUpRunning(s)) and s.now >= startsAtHours
    and (overLimitHeld(s.reads, s.now) or dormantHeld(s.reads, s.now))
pure def wouldLeave(s: Backlog): bool =
  s.active and not(s.exempt) and not(catchUpRunning(s))
    and (overLimitHeld(s.reads, s.now) or dormantHeld(s.reads, s.now))
pure def canObserveStatus(s: Backlog, active: bool, by: str): bool = by == registry and active != s.active
pure def observeStatus(s: Backlog, active: bool, by: str): Backlog = { ...s, active: active }
pure def canObserveExempt(s: Backlog, exempt: bool, by: str): bool = by == registry and exempt != s.exempt
pure def observeExempt(s: Backlog, exempt: bool, by: str): Backlog = { ...s, exempt: exempt }
pure def canObserveClock(s: Backlog, now: int, by: str): bool = by == schedule and now > s.now
pure def observeClock(s: Backlog, now: int, by: str): Backlog = { ...s, now: now }
pure def canStoreRead(s: Backlog, repository: int, waiting: int, lastMergedAt: int, by: str): bool =
  by == schedule and repository >= 0 and repository < s.reads.length() and waiting >= 0 and lastMergedAt >= 0
pure def storeRead(s: Backlog, repository: int, waiting: int, lastMergedAt: int, by: str): Backlog =
  val stored = { ...s, reads: s.reads.foldl(List(), (acc, r) =>
    acc.append(if (acc.length() == repository) { read: true, waiting: waiting, lastMergedAt: lastMergedAt, observedAt: s.now } else r)) }
  { ...stored, wasOut: s.wasOut or outOfRotation(stored) }
pure def canFailRead(s: Backlog, repository: int, by: str): bool = by == schedule and repository >= 0 and repository < s.reads.length()
pure def failRead(s: Backlog, repository: int, by: str): Backlog = s
pure def lawBeforeStartLists(s: Backlog): bool = s.now < startsAtHours implies not(outOfRotation(s))
pure def lawExemptLists(s: Backlog): bool = s.exempt implies not(outOfRotation(s))
pure def lawInactiveLists(s: Backlog): bool = not(s.active) implies not(outOfRotation(s))
pure def lawCatchUpLists(s: Backlog): bool = catchUpRunning(s) implies not(outOfRotation(s))
pure def lawNoRecentReadLists(s: Backlog): bool =
  s.reads.every(r => not(r.read) or s.now - r.observedAt > readMaxAgeHours) implies not(outOfRotation(s))
```

### The lists leave an out-of-rotation project out and its page says why

While an out-of-rotation project's activity is read, the home page,
/sponsors and agent discovery leave it out and its page shows one line
saying why; skills keep serving by direct link and private security
reporting is unaffected. Points, funded pools, Slopbot reviews and the
monthly close never read the rule. The browser lists every project while
its read loads or after it fails, and discovery lists every project when
the server's read fails. While a catch-up pause runs, the page says the
maintainers are catching up until the date in `slopbot.catchUpUntil`.

```quint
pure val overLimitNotice = "This project is not taking new work right now because at least 50 pull requests are waiting for review."
pure val dormantNotice = "This project is not taking new work right now because its maintainers have not merged work in at least two weeks."
pure def catchUpNotice(until: str): str = "This project's maintainers are catching up on reviews until " + until + "."
pure def canBrowserRead(s: Backlog, ok: bool, by: str): bool = by == browserReader
pure def browserRead(s: Backlog, ok: bool, by: str): Backlog = { ...s, browser: if (ok) ListReady else ListFailed }
pure def canServerRead(s: Backlog, ok: bool, by: str): bool = by == discoveryServer
pure def serverRead(s: Backlog, ok: bool, by: str): Backlog = { ...s, server: if (ok) ListReady else ListFailed }
pure def onHome(s: Backlog): bool = not(s.browser == ListReady and outOfRotation(s))
pure def onSponsors(s: Backlog): bool = not(s.browser == ListReady and outOfRotation(s))
pure def discovered(s: Backlog): bool = not(s.server == ListReady and outOfRotation(s))
pure def noticeShown(s: Backlog): bool = s.browser == ListReady and outOfRotation(s)
pure def catchUpShown(s: Backlog): bool = s.browser == ListReady and catchUpRunning(s)
pure def alwaysOutLeavesLists(s: Backlog): bool =
  outOfRotation(s) implies ((s.browser == ListReady implies (not(onHome(s)) and not(onSponsors(s)) and noticeShown(s)))
    and (s.server == ListReady implies not(discovered(s))))
pure def alwaysInRotationIsListed(s: Backlog): bool =
  not(outOfRotation(s)) implies (onHome(s) and onSponsors(s) and discovered(s) and not(noticeShown(s)))
pure def alwaysFailedReadListsAsBefore(s: Backlog): bool =
  (s.browser != ListReady implies (onHome(s) and onSponsors(s) and not(noticeShown(s))))
    and (s.server != ListReady implies discovered(s))
pure def alwaysCatchUpShownWhileRunning(s: Backlog): bool =
  catchUpRunning(s) and s.browser == ListReady implies catchUpShown(s)
```

### A project returns by itself at the first recent read that clears it

The project comes back by itself when a recent read shows fewer than
fifty waiting and either nothing waiting or a merge within fourteen days;
no owner action is needed.

```quint
pure def alwaysReturnNeedsClearRead(s: Backlog): bool =
  (s.wasOut and not(outOfRotation(s)) and s.active and not(s.exempt) and not(catchUpRunning(s)) and s.now >= startsAtHours)
        implies (not(overLimitHeld(s.reads, s.now)) and not(dormantHeld(s.reads, s.now)))
pure def sometimesBackByItself(s: Backlog): bool = s.wasOut and not(outOfRotation(s)) and s.active
  and s.reads.every(r => r.read) and s.browser == ListReady
```

### A catch-up pause keeps a project in rotation for at most fourteen days

The owner sets `slopbot.catchUpUntil` in project settings as an immutable
owner revision, not a material term: a date at most fourteen days ahead.
While the pause runs, the rule does not take the project out of rotation.
A pause starts at most once per UTC month; the owner may end it early at
any time, and a running pause cannot be moved past fourteen days from its
start. Only the server writes `slopbot.catchUpHistory`, one `{startedAt}`
entry per start, and the owner cannot change it. A new project cannot send
either field: the backend answers 422 `catch_up_refused`.

```quint
pure val catchUpMaxHours = 336
pure def catchUpCanStart(until: int, now: int, lastStartMonth: int, nowMonth: int): bool =
  until > now and until - now <= catchUpMaxHours and lastStartMonth != nowMonth
pure def catchUpCanMove(startedAt: int, until: int, now: int): bool =
  until > now and until - startedAt <= catchUpMaxHours
pure def catchUpRefused(until: int, history: List[int]): bool = until != 0 or history.length() > 0
pure def canStartCatchUp(s: Backlog, until: int, nowMonth: int, by: str): bool =
  by == owner and not(s.catchingUp) and catchUpCanStart(until, s.now, s.catchUpStartMonth, nowMonth)
pure def startCatchUp(s: Backlog, until: int, nowMonth: int, by: str): Backlog =
  { ...s, catchingUp: true, catchUpUntil: until, catchUpStartedAt: s.now, catchUpStartMonth: nowMonth }
pure def canMoveCatchUp(s: Backlog, until: int, by: str): bool =
  by == owner and s.catchingUp and catchUpCanMove(s.catchUpStartedAt, until, s.now)
pure def moveCatchUp(s: Backlog, until: int, by: str): Backlog = { ...s, catchUpUntil: until }
pure def canEndCatchUp(s: Backlog, by: str): bool = by == owner and s.catchingUp
pure def endCatchUp(s: Backlog, by: str): Backlog = { ...s, catchingUp: false, catchUpUntil: 0 }
pure def canRecordCatchUp(s: Backlog, by: str): bool =
  by == schedule and s.catchingUp and not(s.catchUpHistory.some(h => h == s.catchUpStartedAt))
pure def recordCatchUp(s: Backlog, by: str): Backlog =
  { ...s, catchUpHistory: s.catchUpHistory.append(s.catchUpStartedAt) }
pure def lawCatchUpStartWindow(until: int, now: int, lastStartMonth: int, nowMonth: int): bool =
  catchUpCanStart(until, now, lastStartMonth, nowMonth)
    implies (until > now and until - now <= catchUpMaxHours and lastStartMonth != nowMonth)
pure def lawCatchUpNeverPastStart(startedAt: int, until: int, now: int): bool =
  catchUpCanMove(startedAt, until, now) implies until - startedAt <= catchUpMaxHours
pure def lawNewProjectRefusesCatchUp(until: int, history: List[int]): bool =
  (until != 0 or history.length() > 0) implies catchUpRefused(until, history)
pure def alwaysCatchUpWithinFourteenDays(s: Backlog): bool =
  s.catchingUp implies s.catchUpUntil - s.catchUpStartedAt <= catchUpMaxHours
pure def sometimesCatchUpKeepsListed(s: Backlog): bool =
  catchUpRunning(s) and (overLimitHeld(s.reads, s.now) or dormantHeld(s.reads, s.now)) and onHome(s) and s.browser == ListReady
pure def sometimesCatchUpRecorded(s: Backlog): bool =
  s.catchingUp and s.catchUpHistory.some(h => h == s.catchUpStartedAt)
```

### The owner hears once before the rule starts, and once each time a project leaves rotation

Notices go to the user steward, or to the account that listed the project
when the steward is an Organization, under the Inbox kind
`project_revision`, with event keys under `backlog-rule:`:
`backlog-rule:<project>:preview` once, before 1 December 2026, when the
project would leave on the current figures;
`backlog-rule:<project>:warn:<last merge>` once when dormancy is four days
away; and one notice each time the project leaves rotation, keyed as
`backlog-rule:<project>:out:<backlog | dormant>:<last merge or none>`.
The scheduled Slopbot run sends them right after it refreshes merge
activity; a failure to send never fails that read. The Slopbot sender 
itself is a later change. No notice names a contributor or an amount.

```quint
pure val inboxKind = "project_revision"
pure val backlogRuleKeyPrefix = "backlog-rule:"
pure def canSendNotice(s: Backlog, key: str, by: str): bool = by == schedule and not(s.sentKeys.contains(key))
pure def sendNotice(s: Backlog, key: str, by: str): Backlog = { ...s, sentKeys: s.sentKeys.union(Set(key)) }
pure def lawNoticeSentOnce(s: Backlog, key: str): bool =
  s.sentKeys.contains(key) implies not(canSendNotice(s, key, schedule))
pure def lawPreviewBeforeStart(s: Backlog, key: str): bool =
  (s.now < startsAtHours and wouldLeave(s) and not(s.sentKeys.contains(key))) implies canSendNotice(s, key, schedule)
pure def sometimesNoticeSent(s: Backlog, key: str): bool = s.sentKeys.contains(key)
pure val readsValues = Set(List(unreadRead, unreadRead),
  List({ read: true, waiting: 50, lastMergedAt: 498800, observedAt: 498911 }, unreadRead),
  List({ read: true, waiting: 25, lastMergedAt: 498800, observedAt: 498911 }, { read: true, waiting: 25, lastMergedAt: 498800, observedAt: 498911 }),
  List({ read: true, waiting: 1, lastMergedAt: 498500, observedAt: 498911 }, unreadRead),
  List({ read: true, waiting: 1, lastMergedAt: 0, observedAt: 498911 }, unreadRead),
  List({ read: true, waiting: 50, lastMergedAt: 0, observedAt: 1 }, unreadRead))
pure val rValues = Set(unreadRead, { read: true, waiting: 50, lastMergedAt: 498800, observedAt: 498911 },
  { read: true, waiting: 1, lastMergedAt: 498500, observedAt: 498911 },
  { read: true, waiting: 1, lastMergedAt: 0, observedAt: 498911 },
  { read: true, waiting: 3, lastMergedAt: 498612, observedAt: 498911 })
pure val waitingValues = Set(0, 1, 25, 49, 50, 51)
pure val lastMergedValues = Set(0, 498500, 498612, 498800, 498911)
pure val nowValues = Set(2, 498912, 498913)
pure val untilValues = Set(0, 498913, 499248, 499249)
pure val startedAtValues = Set(0, 498912)
pure val lastStartMonthValues = Set(0, 202611, 202612)
pure val nowMonthValues = Set(202611, 202612)
pure val repositoryValues = Set(0, 1)
pure val historyValues = Set(List(), List(498912))
pure val keyValues = Set("backlog-rule:example:preview", "backlog-rule:example:warn:498800", "backlog-rule:example:out:backlog:498800")
pure val byValues = Set(owner, registry, schedule, browserReader, discoveryServer, slopbot)
pure val weight_storeRead = 3
pure val weight_startCatchUp = 2
```
