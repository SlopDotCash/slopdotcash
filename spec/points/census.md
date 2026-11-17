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
  securityLabel: bool, humanGated: bool, epic: bool, contributorReady: bool, blockedLabel: bool }
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
pure def sometimesRetainedButNotOffered(c: Census): bool = c.phase == Ready and c.items.some(i => blocked(i)) and c.items.some(i => not(blocked(i)))
```

### A maintainer claim counts only from a trusted association or a claim label, and a claim comment lapses after seven days

The GitHub adapter supplies each item's `claimed` from this derivation
(`src/lib/leaderboard.ts`, `issueClaim`, `pullRequestClaim`,
`latestClaimComment`), at the collection's reference time. The claim
sources are tried in this order: a non-bot assignee (on a pull request, one
other than its author); for an issue, an open pull request that references
it; a claim comment; a claim label. A claim comment is a Markdown line that
starts `CLAIMING:` on an issue or `CLAIMING REVIEW:` on a pull request,
written by a non-bot author whose association is `OWNER`, `MEMBER` or
`COLLABORATOR`, never by the pull request's own author, created at or
before the reference time and no more than seven days (604,800,000 ms)
before it. A claim label is, ignoring case, `claimed`, `in-progress`,
`in progress` or `working` (each optionally followed by `: name`),
`status: claimed` or `status: in-progress` on an issue, and
`review-claimed` or `review-in-progress` (optionally followed by `: name`)
or `review: claimed` on a pull request. A label claim does not lapse. The
adapter matches the line and label patterns and supplies the booleans
below; times are integer milliseconds.

```quint
pure val claimMaxAgeMs = 604800000
type ClaimSource = NoClaim | AssigneeClaim | LinkedPullRequestClaim | CommentClaim | LabelClaim
type ClaimComment = { botAuthor: bool, trustedAssociation: bool, byItemAuthor: bool, claimLine: bool, createdAt: int }
type ClaimEvidence = { kind: ItemKind, otherAssignee: bool, openLinkedPullRequest: bool, comments: List[ClaimComment],
  claimLabel: bool }
pure def claimCommentCounts(claim: ClaimEvidence, comment: ClaimComment, now: int): bool =
  not(comment.botAuthor) and comment.trustedAssociation and comment.claimLine and
  (claim.kind == IssueItem or not(comment.byItemAuthor)) and
  comment.createdAt <= now and now - comment.createdAt <= claimMaxAgeMs
pure def claimSource(claim: ClaimEvidence, now: int): ClaimSource =
  if (claim.otherAssignee) AssigneeClaim
  else if (claim.kind == IssueItem and claim.openLinkedPullRequest) LinkedPullRequestClaim
  else if (claim.comments.some(m => claimCommentCounts(claim, m, now))) CommentClaim
  else if (claim.claimLabel) LabelClaim
  else NoClaim
pure def claimedFrom(claim: ClaimEvidence, now: int): bool = claimSource(claim, now) != NoClaim
pure def lawUntrustedOrBotCommentNeverClaims(claim: ClaimEvidence, comment: ClaimComment, now: int): bool =
  (comment.botAuthor or not(comment.trustedAssociation)) implies not(claimCommentCounts(claim, comment, now))
pure def lawClaimCommentLapsesAfterSevenDays(claim: ClaimEvidence, comment: ClaimComment, now: int): bool =
  (now - comment.createdAt > claimMaxAgeMs or comment.createdAt > now) implies not(claimCommentCounts(claim, comment, now))
pure def lawAuthorCannotClaimOwnPullRequest(claim: ClaimEvidence, comment: ClaimComment, now: int): bool =
  (claim.kind == PullRequestItem and comment.byItemAuthor) implies not(claimCommentCounts(claim, comment, now))
pure def lawNoClaimWithoutEvidence(claim: ClaimEvidence, now: int): bool =
  (not(claim.otherAssignee) and not(claim.openLinkedPullRequest) and not(claim.claimLabel) and
    claim.comments.every(m => not(claimCommentCounts(claim, m, now)))) implies not(claimedFrom(claim, now))
pure def lawLabelClaimNeverLapses(claim: ClaimEvidence, now: int): bool = claim.claimLabel implies claimedFrom(claim, now)
pure val claimComment: ClaimComment = { botAuthor: false, trustedAssociation: true, byItemAuthor: false, claimLine: true,
  createdAt: 1000000000 }
pure val commentValues = Set(claimComment, { ...claimComment, botAuthor: true }, { ...claimComment, trustedAssociation: false },
  { ...claimComment, byItemAuthor: true }, { ...claimComment, claimLine: false }, { ...claimComment, createdAt: 395200000 },
  { ...claimComment, createdAt: 395199999 })
pure val issueClaim: ClaimEvidence = { kind: IssueItem, otherAssignee: false, openLinkedPullRequest: false,
  comments: List(claimComment), claimLabel: false }
pure val claimValues = Set(issueClaim, { ...issueClaim, comments: List() }, { ...issueClaim, comments: List(), claimLabel: true },
  { ...issueClaim, comments: List(), openLinkedPullRequest: true },
  { ...issueClaim, kind: PullRequestItem, openLinkedPullRequest: true, comments: List() },
  { ...issueClaim, kind: PullRequestItem, comments: List({ ...claimComment, byItemAuthor: true }) },
  { ...issueClaim, kind: PullRequestItem, otherAssignee: true, comments: List() })
pure val nowValues = Set(1000000000, 1604800000, 1604800001)
```

### A live collection spends at most 4,900 GraphQL cost points per rate-limit window, keeps a 100-point reserve and recollects a changed review census once within the same budget

The live GraphQL client of `scripts/generate-leaderboard.ts`
(`MAX_GENERATION_COST`, `MINIMUM_RATE_LIMIT_RESERVE`, `ensureBudget`,
`ensureEstimatedBudget`, `runGenerator`) checks each estimated cost before
it spends it. What is available is the smaller of 4,900 less the larger of
the cost this run spent in the current rate-limit window and the points the
shared token lost since this run's first response in that window, and the
reported remaining points less a reserve of 100. A cost that fits is spent.
One that does not fit waits for the reported reset once, which starts a new
window with nothing spent; a cost that still does not fit after waiting for
that same reset, or that exceeds 4,900 on its own, stops the collection with
no partial snapshot. Before GitHub has reported a rate limit, the first
request is sent. A changed review census (`ReviewCensusChangedError`) or an
enumerated node that became unavailable (`SourceNodeUnavailableError`)
discards the first attempt and recollects every source once, with the same
client: the cost spent, the reserve and the reset already waited for carry
over. Any other failure, or a second such failure, stops the collection.
Publication is outside the retry. The [ingestion read](./ingestion.md) is a
separate REST transport with no budget of its own.

```quint
pure val maxGenerationCost = 4900
pure val rateLimitReserve = 100
type Budget = { windowSpent: int, windowDrain: int, remaining: int, waitedForReset: bool }
type BudgetDecision = SpendNow | WaitForReset | StopCollection
type RetryCause = ReviewCensusChanged | SourceNodeUnavailable | OtherFailure
pure def availableCost(budget: Budget): int =
  val used = if (budget.windowSpent > budget.windowDrain) budget.windowSpent else budget.windowDrain
  val byCap = maxGenerationCost - used
  val byReserve = budget.remaining - rateLimitReserve
  if (byCap < byReserve) byCap else byReserve
pure def budgetDecision(budget: Budget, cost: int): BudgetDecision =
  if (cost < 0 or cost > maxGenerationCost) StopCollection
  else if (cost <= availableCost(budget)) SpendNow
  else if (budget.waitedForReset) StopCollection
  else WaitForReset
pure def afterReset(remaining: int): Budget = { windowSpent: 0, windowDrain: 0, remaining: remaining, waitedForReset: true }
pure def recollects(attempt: int, cause: RetryCause): bool = attempt == 1 and cause != OtherFailure
pure def lawSpendKeepsCapAndReserve(budget: Budget, cost: int): bool =
  budgetDecision(budget, cost) == SpendNow implies
    (budget.windowSpent + cost <= maxGenerationCost and budget.windowDrain + cost <= maxGenerationCost and
      budget.remaining - cost >= rateLimitReserve)
pure def lawWaitsOnceForAReset(budget: Budget, cost: int): bool =
  budget.waitedForReset implies budgetDecision(budget, cost) != WaitForReset
pure def lawResetStillShortStops(remaining: int, cost: int): bool =
  (cost >= 0 and cost <= maxGenerationCost and remaining - rateLimitReserve < cost) implies
    budgetDecision(afterReset(remaining), cost) == StopCollection
pure def lawRecollectsOnlyOnceAndOnlyForCensusChurn(attempt: int, cause: RetryCause): bool =
  recollects(attempt, cause) implies (attempt == 1 and (cause == ReviewCensusChanged or cause == SourceNodeUnavailable))
pure val openBudget: Budget = { windowSpent: 0, windowDrain: 0, remaining: 5000, waitedForReset: false }
pure val budgetValues = Set(openBudget, { ...openBudget, windowSpent: 4800 }, { ...openBudget, remaining: 150 },
  { ...openBudget, windowDrain: 4900, waitedForReset: true }, { ...openBudget, remaining: 50 })
pure val costValues = Set(-1, 0, 1, 100, 4900, 4901)
pure val remainingValues = Set(0, 100, 5000)
pure val attemptValues = Set(1, 2)
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
pure val snapshotValues = Set(1, 2, 3)
pure val iValues = Set(human, { ...human, author: UnknownAuthor }, { ...human, diffAvailable: false }, { ...human, epic: true },
  { ...human, open: false }, { ...human, kind: IssueItem, contributorReady: false }, { ...human, kind: IssueItem },
  { ...human, blockedLabel: true, hasAssignee: true })
```
