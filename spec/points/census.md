# Source census

PRD section 7 retains every open issue and PR in snapshots for source-count
integrity, publishes a deterministic selection decision for each item and
advertises only bounded, unblocked work. Paused projects are not collected,
and legacy projects are never collected or scored. Missing data is never
presented as an empty successful census. A complete census is ready for
publication; the [exact-prefix publication](./publication.md) machine alone
publishes it.

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

The project view excludes paused, retired, quarantined and legacy projects:
the ids kept in `src/lib/legacy-projects.json` and the retired registry
listings are never collected, scored or paid.

```quint
import periods as P from "./periods"
type CensusPhase = Empty | Collecting | Incomplete | ReadyForPublication
type ProjectView = { registered: bool, paused: bool, retired: bool, legacy: bool, quarantined: bool }
type AuthorKind = HumanAuthor | BotAuthor | SlopbotAuthor | UnknownAuthor
type ItemKind = IssueItem | PullRequestItem
type Item = { id: int, kind: ItemKind, open: bool, author: AuthorKind, diffAvailable: bool, hasAssignee: bool,
  claimed: bool, draft: bool, reviewRequested: bool, approved: bool, changesRequested: bool,
  securityLabel: bool, humanGated: bool, epic: bool, contributorReady: bool, blockedLabel: bool }
type Page = { cursor: int, next: int, totalCount: int, items: List[Item] }
type Census = { phase: CensusPhase, lowerDay: int, expectedCursor: int, cursorsSeen: List[int],
  totalCount: int, terminalSeen: bool, countChanges: int, items: List[Item] }
pure val initial: Census = { phase: Empty, lowerDay: 0, expectedCursor: 0, cursorsSeen: List(),
  totalCount: -1, terminalSeen: false, countChanges: 0, items: List() }
pure def collected(p: ProjectView): bool = p.registered and not(p.paused) and not(p.retired) and not(p.legacy) and not(p.quarantined)
pure def canBegin(c: Census, project: ProjectView, lowerDay: int): bool =
  c.phase != Collecting and collected(project) and lowerDay >= c.lowerDay and lowerDay >= 0
pure def begin(c: Census, project: ProjectView, lowerDay: int): Census =
  { ...c, phase: Collecting, lowerDay: lowerDay, expectedCursor: 0, cursorsSeen: List(), totalCount: -1,
    terminalSeen: false, countChanges: 0, items: List() }
pure def lawPausedNotCollected(project: ProjectView): bool =
  (project.paused or project.legacy or project.retired or project.quarantined) implies not(collected(project))
pure def stepWindowNeverRegresses(before: Census, after: Census): bool = after.lowerDay >= before.lowerDay
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
pure def finish(c: Census): Census = { ...c, phase: ReadyForPublication }
```

### Every retained item has a deterministic, fail-closed selection decision with all its reasons

Unknown authors, unavailable diffs, existing assignees, maintainer claims,
drafts, blocked labels, active review requests, approvals, changes
requested, security labels, human-gated work and epics are not offered. An
issue without a contributor-ready label is untriaged and not offered.
Closed items and bot authors are not offered either. Every retained item
keeps its decision, which lists every applicable reason once, in a fixed order
(`src/lib/leaderboard.ts`, `candidateExclusionReasons`): an item is a
candidate exactly when it has none.

```quint
type Reason = Closed | AuthorUnknown | BotAuthored | DiffUnavailable | Untriaged | Blocked | Assigned | Claimed |
  DraftItem | ReviewRequested | Approved | ChangesRequested | SecurityLabel | HumanGated | Epic
type Status = Candidate | Excluded
type Selection = { status: Status, reasons: List[Reason] }
pure def reasonIf(c: bool, r: Reason): List[Reason] = if (c) List(r) else List()
pure def blocked(i: Item): bool =
  not(i.open) or i.author != HumanAuthor or (i.kind == PullRequestItem and not(i.diffAvailable)) or
  (i.kind == IssueItem and not(i.contributorReady)) or i.blockedLabel or i.securityLabel or i.humanGated or i.epic or
  i.hasAssignee or i.claimed or i.draft or i.reviewRequested or i.approved or i.changesRequested
pure def authorReasons(i: Item): List[Reason] =
  reasonIf(not(i.open), Closed).concat(reasonIf(i.author == UnknownAuthor, AuthorUnknown))
    .concat(reasonIf(i.author == BotAuthor or i.author == SlopbotAuthor, BotAuthored))
pure def readinessReasons(i: Item): List[Reason] =
  reasonIf(i.kind == PullRequestItem and not(i.diffAvailable), DiffUnavailable)
    .concat(reasonIf(i.kind == IssueItem and not(i.contributorReady), Untriaged)).concat(reasonIf(i.blockedLabel, Blocked))
pure def scopeReasons(i: Item): List[Reason] =
  reasonIf(i.securityLabel, SecurityLabel).concat(reasonIf(i.humanGated, HumanGated)).concat(reasonIf(i.epic, Epic))
pure def claimReasons(i: Item): List[Reason] =
  reasonIf(i.hasAssignee, Assigned).concat(reasonIf(i.claimed, Claimed)).concat(reasonIf(i.draft, DraftItem))
pure def reviewReasons(i: Item): List[Reason] =
  reasonIf(i.reviewRequested, ReviewRequested).concat(reasonIf(i.approved, Approved)).concat(reasonIf(i.changesRequested, ChangesRequested))
pure def reasons(i: Item): List[Reason] =
  val first = authorReasons(i).concat(readinessReasons(i))
  val second = scopeReasons(i).concat(claimReasons(i))
  first.concat(second).concat(reviewReasons(i))
pure def decide(i: Item): Selection = { status: if (blocked(i)) Excluded else Candidate, reasons: reasons(i) }
pure def offered(c: Census): List[Item] = c.items.select(i => not(blocked(i)))
pure def lawUnknownAuthorFailsClosed(i: Item): bool = i.author == UnknownAuthor implies (blocked(i) and reasons(i).some(x => x == AuthorUnknown))
pure def lawUnavailableDiffFailsClosed(i: Item): bool =
  (i.kind == PullRequestItem and not(i.diffAvailable)) implies (blocked(i) and reasons(i).some(x => x == DiffUnavailable))
pure def lawUntriagedIssueFailsClosed(i: Item): bool =
  (i.kind == IssueItem and not(i.contributorReady)) implies (blocked(i) and reasons(i).some(x => x == Untriaged))
pure def lawOfferedIsUnblocked(i: Item): bool = not(blocked(i)) implies
  (i.open and i.author == HumanAuthor and not(i.hasAssignee or i.claimed or i.draft or i.reviewRequested or i.blockedLabel or
    i.approved or i.changesRequested or i.securityLabel or i.humanGated or i.epic))
pure def lawCandidateIffNoReason(i: Item): bool =
  blocked(i) iff reasons(i).length() > 0
pure def lawEveryReasonListed(i: Item): bool =
  (i.hasAssignee implies reasons(i).some(x => x == Assigned)) and (i.claimed implies reasons(i).some(x => x == Claimed)) and
  (i.approved implies reasons(i).some(x => x == Approved)) and (i.changesRequested implies reasons(i).some(x => x == ChangesRequested))
```

### Only a complete census is ready for publication

```quint
pure def alwaysItemsDistinct(c: Census): bool = c.items.every(i => i.id > 0 and c.items.select(o => o.id == i.id).length() == 1)
pure def alwaysCursorsDistinct(c: Census): bool = c.cursorsSeen.every(k => c.cursorsSeen.select(o => o == k).length() == 1)
pure def alwaysCompleteWhenReady(c: Census): bool = c.phase == ReadyForPublication implies
  (c.terminalSeen and c.items.length() == c.totalCount)
pure def sometimesReady(c: Census): bool = c.phase == ReadyForPublication and c.items.length() > 0
pure def sometimesIncomplete(c: Census): bool = c.phase == Incomplete and c.countChanges == 2
pure def sometimesRetriedComplete(c: Census): bool = c.phase == ReadyForPublication and c.countChanges == 1
pure def sometimesRetainedButNotOffered(c: Census): bool =
  c.phase == ReadyForPublication and c.items.some(i => blocked(i)) and c.items.some(i => not(blocked(i)))
```

### Simulation samples include repeated cursors, count changes and blocked items

```quint
pure val human: Item = { id: 1, kind: PullRequestItem, open: true, author: HumanAuthor, diffAvailable: true, hasAssignee: false,
  claimed: false, draft: false, reviewRequested: false, approved: false, changesRequested: false,
  securityLabel: false, humanGated: false, epic: false, contributorReady: true, blockedLabel: false }
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
pure val iValues = Set(human, { ...human, author: UnknownAuthor }, { ...human, diffAvailable: false }, { ...human, epic: true },
  { ...human, open: false }, { ...human, kind: IssueItem, contributorReady: false }, { ...human, kind: IssueItem },
  { ...human, blockedLabel: true, hasAssignee: true })
```

## Story: Reapply the current bands to eligible unpaid September and October work only

> As a contributor, I want my unpaid September and October 2026 work scored
> by the current size and review bands, without anyone's approved or paid
> award changing.

### The band reapplication touches only eligible unpaid work from 1 September through 31 October 2026

PRD section 7, "Historical scoring and source integrity". The reapplication appends
a reassessment for eligible unpaid work that occurred in September or
October 2026. Approved, scheduled, paid and frozen awards keep their
original Points and terms; work outside those months and ineligible work keep
their recorded Points. Source IDs, occurrence times and eligibility and
penalty dates are retained, so the reapplication changes only the Points.

```quint
type AwardStage = UnpaidAward | ApprovedAward | ScheduledAward | PaidAward | FrozenAward
type BandedWork = { source: int, occurredAt: int, eligible: bool, stage: AwardStage, points: int }
pure def septemberOrOctober(at: int): bool = at >= P::september2026Start and at < P::november2026Start
pure def reapplicable(w: BandedWork): bool = septemberOrOctober(w.occurredAt) and w.eligible and w.stage == UnpaidAward
pure def reapplyBands(w: BandedWork, currentBandPoints: int): BandedWork =
  if (reapplicable(w)) { ...w, points: currentBandPoints } else w
pure def lawReapplicationOnlyUnpaidSeptemberOctober(w: BandedWork, currentBandPoints: int): bool =
  reapplyBands(w, currentBandPoints) != w implies reapplicable(w)
pure def lawSettledAwardsUnchanged(w: BandedWork, currentBandPoints: int): bool =
  w.stage != UnpaidAward implies reapplyBands(w, currentBandPoints) == w
pure def lawIdentityAndDatesKept(w: BandedWork, currentBandPoints: int): bool =
  reapplyBands(w, currentBandPoints).source == w.source and reapplyBands(w, currentBandPoints).occurredAt == w.occurredAt
    and reapplyBands(w, currentBandPoints).eligible == w.eligible and reapplyBands(w, currentBandPoints).stage == w.stage
pure val workSample: BandedWork = { source: 1, occurredAt: 2432105, eligible: true, stage: UnpaidAward, points: 10 }
pure val wValues = Set(workSample, { ...workSample, stage: PaidAward }, { ...workSample, stage: FrozenAward },
  { ...workSample, stage: ApprovedAward }, { ...workSample, stage: ScheduledAward }, { ...workSample, eligible: false },
  { ...workSample, occurredAt: 2431999 }, { ...workSample, occurredAt: 2432200 })
pure val currentBandPointsValues = Set(10, 20)
```
