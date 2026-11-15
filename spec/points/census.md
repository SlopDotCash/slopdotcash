# Source census

PRD section 7 retains every open issue and PR in snapshots for source-count
integrity, publishes a deterministic selection decision for each item and
advertises only bounded, unblocked work. Paused projects are not collected,
and legacy projects are never collected or scored. Missing data is never
presented as an empty successful census.

This machine collects one repository's GitHub inventory for one snapshot. It
follows `scripts/generate-leaderboard.ts`, `src/lib/github-census.ts` and the
legacy `github_census`, `ingestion_retry` and `ui_score_selection` models.
GitHub returns pages by cursor with a `totalCount` and a next cursor. The
GitHub read adapter supplies each page as read, with immutable node IDs.
The project view comes from the D1 registry ([projects](../backend/projects.md))
at collection time. The rolling 35-day ledger window is owned by the
[ledger window](./window.md); the historical publication hold is owned by
the [historical import](./historicalImport.md).

## Story: Collect a complete inventory and a decision for every item

### Collection starts only for a collected project and never moves its window back

```quint
type CensusPhase = Empty | Collecting | Incomplete | Ready | Published
type ProjectView = { registered: bool, paused: bool, retired: bool, legacy: bool, quarantined: bool }
type AuthorKind = HumanAuthor | BotAuthor | SlopbotAuthor | UnknownAuthor
type ItemKind = IssueItem | PullRequestItem
type Item = { id: int, kind: ItemKind, open: bool, author: AuthorKind, diffAvailable: bool, hasAssignee: bool,
  claimed: bool, draft: bool, reviewRequested: bool, approved: bool, changesRequested: bool,
  securityLabel: bool, humanGated: bool, epic: bool }
type Page = { cursor: int, next: int, totalCount: int, items: List[Item] }
type Census = { phase: CensusPhase, lowerDay: int, publishedLower: int, expectedCursor: int, cursorsSeen: List[int],
  totalCount: int, terminalSeen: bool, countChanges: int, items: List[Item],
  previousSnapshot: int, publishedSnapshot: int }
pure val initial: Census = { phase: Empty, lowerDay: 0, publishedLower: 0, expectedCursor: 0, cursorsSeen: List(),
  totalCount: -1, terminalSeen: false, countChanges: 0, items: List(), previousSnapshot: 1, publishedSnapshot: 1 }
pure def collected(p: ProjectView): bool = p.registered and not(p.paused) and not(p.retired) and not(p.legacy) and not(p.quarantined)
pure def canBegin(c: Census, project: ProjectView, lowerDay: int): bool =
  c.phase != Collecting and collected(project) and lowerDay >= c.publishedLower and lowerDay >= 0
pure def begin(c: Census, project: ProjectView, lowerDay: int): Census =
  { ...c, phase: Collecting, lowerDay: lowerDay, expectedCursor: 0, cursorsSeen: List(), totalCount: -1,
    terminalSeen: false, countChanges: 0, items: List(), previousSnapshot: c.publishedSnapshot }
pure def lawPausedNotCollected(project: ProjectView): bool = (project.paused or project.legacy or project.retired) implies not(collected(project))
```

### Pages follow the cursor chain and a changed count stops the pass

A repeated cursor, a cursor out of sequence and overlapping pages cannot
invent a count. The first changed `totalCount` restarts collection once; a
second change leaves the census incomplete. The terminal page is required
even when the count already matches.

```quint
pure def canRecordPage(c: Census, page: Page): bool =
  c.phase == Collecting and not(c.terminalSeen) and page.cursor == c.expectedCursor and
  not(c.cursorsSeen.includes(page.cursor)) and page.next != page.cursor and page.totalCount >= 0 and
  (c.totalCount == -1 or page.totalCount == c.totalCount) and page.items.every(i => i.id > 0)
pure def addItem(items: List[Item], i: Item): List[Item] = if (items.some(o => o.id == i.id)) items else items.append(i)
pure def recordPage(c: Census, page: Page): Census =
  { ...c, cursorsSeen: c.cursorsSeen.append(page.cursor), expectedCursor: page.next, totalCount: page.totalCount,
    terminalSeen: page.next == 0, items: page.items.foldl(c.items, (acc, i) => addItem(acc, i)) }
pure def canRecordCountChange(c: Census, page: Page): bool =
  c.phase == Collecting and page.cursor == c.expectedCursor and c.totalCount >= 0 and page.totalCount != c.totalCount
pure def recordCountChange(c: Census, page: Page): Census =
  if (c.countChanges == 0) { ...c, countChanges: 1, expectedCursor: 0, cursorsSeen: List(), totalCount: -1, terminalSeen: false, items: List() }
  else { ...c, phase: Incomplete, countChanges: 2 }
pure def canRecordFailure(c: Census): bool = c.phase == Collecting
pure def recordFailure(c: Census): Census = { ...c, phase: Incomplete }
pure def canFinish(c: Census): bool =
  c.phase == Collecting and c.terminalSeen and c.items.length() == c.totalCount
pure def finish(c: Census): Census = { ...c, phase: Ready }
```

### Every retained item has a deterministic, fail-closed selection decision

Unknown authors, unavailable diffs, existing assignees, maintainer claims,
drafts, active review requests, approvals, changes requested, security
labels, human-gated work and epics are not offered. Closed items and bot
authors are not offered either. Every retained item keeps its decision.

```quint
type Decision = Offered | Closed | AuthorUnknown | BotAuthored | DiffUnavailable | Assigned | Claimed | DraftItem |
  ReviewRequested | Approved | ChangesRequested | SecurityLabel | HumanGated | Epic
pure def decide(i: Item): Decision =
  if (not(i.open)) Closed
  else if (i.author == UnknownAuthor) AuthorUnknown
  else if (i.author != HumanAuthor) BotAuthored
  else if (i.kind == PullRequestItem and not(i.diffAvailable)) DiffUnavailable
  else if (i.securityLabel) SecurityLabel
  else if (i.humanGated) HumanGated
  else if (i.epic) Epic
  else if (i.hasAssignee) Assigned
  else if (i.claimed) Claimed
  else if (i.draft) DraftItem
  else if (i.reviewRequested) ReviewRequested
  else if (i.approved) Approved
  else if (i.changesRequested) ChangesRequested
  else Offered
pure def offered(c: Census): List[Item] = c.items.select(i => decide(i) == Offered)
pure def lawUnknownAuthorFailsClosed(i: Item): bool = i.author == UnknownAuthor implies decide(i) != Offered
pure def lawUnavailableDiffFailsClosed(i: Item): bool = (i.kind == PullRequestItem and not(i.diffAvailable)) implies decide(i) != Offered
pure def lawOfferedIsUnblocked(i: Item): bool = decide(i) == Offered implies
  (i.open and i.author == HumanAuthor and not(i.hasAssignee or i.claimed or i.draft or i.reviewRequested or
    i.approved or i.changesRequested or i.securityLabel or i.humanGated or i.epic))
```

### Publication requires a complete census and keeps the previous snapshot on failure

```quint
pure def canPublish(c: Census, snapshot: int): bool = c.phase == Ready and snapshot > c.previousSnapshot
pure def publish(c: Census, snapshot: int): Census =
  { ...c, phase: Published, publishedSnapshot: snapshot, publishedLower: c.lowerDay }
pure def alwaysItemsDistinct(c: Census): bool = c.items.every(i => i.id > 0 and c.items.select(o => o.id == i.id).length() == 1)
pure def alwaysCursorsDistinct(c: Census): bool = c.cursorsSeen.every(k => c.cursorsSeen.select(o => o == k).length() == 1)
pure def alwaysCompleteWhenReady(c: Census): bool = (c.phase == Ready or c.phase == Published) implies
  (c.terminalSeen and c.items.length() == c.totalCount)
pure def alwaysFailedKeepsSnapshot(c: Census): bool =
  (c.phase == Collecting or c.phase == Ready or c.phase == Incomplete) implies c.publishedSnapshot == c.previousSnapshot
pure def alwaysWindowForward(c: Census): bool = (c.phase == Collecting or c.phase == Ready) implies c.lowerDay >= c.publishedLower
pure def stepPublishedWindowNeverRegresses(before: Census, after: Census): bool = after.publishedLower >= before.publishedLower
pure def sometimesPublished(c: Census): bool = c.phase == Published and c.items.length() > 0
pure def sometimesIncomplete(c: Census): bool = c.phase == Incomplete and c.countChanges == 2
pure def sometimesRetriedComplete(c: Census): bool = c.phase == Ready and c.countChanges == 1
pure def sometimesRetainedButNotOffered(c: Census): bool = c.phase == Ready and c.items.some(i => decide(i) != Offered) and c.items.some(i => decide(i) == Offered)
```

### Simulation samples include repeated cursors, count changes and blocked items

```quint
pure val human: Item = { id: 1, kind: PullRequestItem, open: true, author: HumanAuthor, diffAvailable: true, hasAssignee: false,
  claimed: false, draft: false, reviewRequested: false, approved: false, changesRequested: false,
  securityLabel: false, humanGated: false, epic: false }
pure val pageValues = Set(
  { cursor: 0, next: 5, totalCount: 2, items: List(human) },
  { cursor: 5, next: 0, totalCount: 2, items: List({ ...human, id: 2, author: UnknownAuthor }) },
  { cursor: 5, next: 0, totalCount: 3, items: List({ ...human, id: 3 }) },
  { cursor: 0, next: 0, totalCount: 1, items: List({ ...human, id: 4, hasAssignee: true }) },
  { cursor: 5, next: 5, totalCount: 2, items: List(human) })
pure val projectValues = Set({ registered: true, paused: false, retired: false, legacy: false, quarantined: false },
  { registered: true, paused: true, retired: false, legacy: false, quarantined: false },
  { registered: true, paused: false, retired: false, legacy: true, quarantined: false })
pure val lowerDayValues = Set(0, 1, 2)
pure val snapshotValues = Set(1, 2, 3)
pure val iValues = Set(human, { ...human, author: UnknownAuthor }, { ...human, diffAvailable: false }, { ...human, epic: true }, { ...human, open: false })
```
