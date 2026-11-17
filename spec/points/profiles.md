# Contributor profile census

PRD section 9: public profile pages read a published census and never live
GitHub per page view, and missing data is never shown as an empty or zero
count. This machine is one profile census publication, following
`scripts/generate-profiles.ts`, `scripts/profile-issue-census.ts`,
`scripts/extend-published-profiles.ts`, `scripts/published-profiles.ts` and
`src/lib/profiles.ts`.

A live collection starts from the last published census, or from the
reviewed seed for the first publication. For each collected repository it
reads every pull request, oldest first, and counts each user author's
merged, open and closed pull requests; a pull request without a user author
is counted as excluded. The crawled count must equal the total GitHub
reports, which may grow during the crawl but never shrink. It then reads
every issue of the repository with its closed, reopened, duplicate and
transfer events. Any failure (a changed repository identity, a shrinking or
unreconciled count, a repeated item, a stalled cursor) publishes nothing and
keeps the previous census. The adapter names each repository by a number
and supplies its permanent registry identity (`profileCanonicalRepository`)
as `canonical`, 0 when the registry does not know the name.

## Story: Publish a profile census that never loses counts

### A profile census carries the counts of removed repositories forward

A previous row is carried unchanged when its repository is not collected
now and its registry identity is unknown or not collected under any name
(`isCarriedProfileRepository`): removing or pausing a project keeps the
profile totals it earned. The manual extension of a published census
(`extend-published-profiles.ts`) adds newly active repositories with zero
counts until the next full collection replaces them.

```quint
type ProfilePhase = Idle | Collecting
type Target = { repository: int, canonical: int }
type RepositoryRow = { repository: int, canonical: int, pullRequests: int, excluded: int }
type RepositoryTally = { repository: int, canonical: int, crawled: int, reported: int, excluded: int }
type ProfileIssue = { id: int, repository: int, unavailable: bool, historyIncomplete: bool }
type ObservedIssue = { id: int, repository: int, eventsReproduceState: bool }
type IssueTally = { repository: int, crawled: int, reported: int }
type Profiles = { phase: ProfilePhase, targets: List[Target], rows: List[RepositoryRow], issues: List[ProfileIssue],
  issuesReconciled: List[int], publishedRows: List[RepositoryRow], publishedIssues: List[ProfileIssue],
  publications: int, failures: int }
pure val initial: Profiles = { phase: Idle, targets: List(), rows: List(), issues: List(), issuesReconciled: List(),
  publishedRows: List(), publishedIssues: List(), publications: 0, failures: 0 }
pure def collectedName(targets: List[Target], repository: int): bool = targets.some(t => t.repository == repository)
pure def carried(row: RepositoryRow, targets: List[Target]): bool =
  not(collectedName(targets, row.repository)) and (row.canonical == 0 or not(targets.some(t => t.canonical == row.canonical)))
pure def canBegin(p: Profiles, targets: List[Target]): bool =
  p.phase == Idle and targets.length() > 0 and targets.every(t => t.repository > 0 and t.canonical > 0 and
    targets.select(o => o.repository == t.repository).length() == 1 and
    targets.select(o => o.canonical == t.canonical).length() == 1)
pure def begin(p: Profiles, targets: List[Target]): Profiles =
  { ...p, phase: Collecting, targets: targets, rows: p.publishedRows.select(r => carried(r, targets)), issues: List(),
    issuesReconciled: List() }
pure def alwaysCarriedRowsKept(p: Profiles): bool = p.phase == Collecting implies
  p.publishedRows.every(r => not(carried(r, p.targets)) or p.rows.includes(r))
pure def alwaysRowsDistinct(p: Profiles): bool =
  p.rows.every(r => p.rows.select(o => o.repository == r.repository).length() == 1) and
  p.publishedRows.every(r => p.publishedRows.select(o => o.repository == r.repository).length() == 1)
pure def stepPublicationKeepsCarriedRows(before: Profiles, after: Profiles): bool =
  after.publications > before.publications implies
    before.publishedRows.every(r => not(carried(r, before.targets)) or after.publishedRows.includes(r))
pure def sometimesCarriedRowPublished(p: Profiles): bool =
  p.publications > 1 and p.publishedRows.some(r => not(collectedName(p.targets, r.repository)))
```

### A renamed repository is followed by its permanent registry identity

A repository collected under its current name replaces the row a previous
census kept under its old name, so its pull requests are counted once. A
count is recorded only for a collected name that resolved to its expected
registry identity, and only when the crawl reconciles with GitHub's total.

```quint
pure def canRecordRepository(p: Profiles, tally: RepositoryTally): bool =
  p.phase == Collecting and p.targets.some(t => t.repository == tally.repository and t.canonical == tally.canonical) and
  not(p.rows.some(r => r.repository == tally.repository)) and tally.crawled == tally.reported and
  tally.excluded >= 0 and tally.excluded <= tally.crawled
pure def recordRepository(p: Profiles, tally: RepositoryTally): Profiles =
  { ...p, rows: p.rows.append({ repository: tally.repository, canonical: tally.canonical, pullRequests: tally.crawled,
    excluded: tally.excluded }) }
pure def alwaysOneRowPerCollectedIdentity(p: Profiles): bool = p.phase == Collecting implies
  p.targets.every(t => p.rows.select(r => r.canonical == t.canonical).length() <= 1)
pure def alwaysRowsCollectedOrCarried(p: Profiles): bool = p.phase == Collecting implies
  p.rows.every(r => p.targets.some(t => t.repository == r.repository and t.canonical == r.canonical) or carried(r, p.targets))
pure def lawOldNameOfCollectedRepositoryNotCarried(row: RepositoryRow, targets: List[Target]): bool =
  (row.canonical > 0 and targets.some(t => t.canonical == row.canonical)) implies not(carried(row, targets))
pure def sometimesRenameReplacesOldRow(p: Profiles): bool = p.phase == Collecting and
  p.publishedRows.some(old => p.rows.some(r => r.canonical == old.canonical and r.repository != old.repository)) and
  p.publishedRows.every(old => not(p.rows.includes(old)) or carried(old, p.targets))
```

### A missing issue history is recorded as a coverage gap, never as zero

An issue a previous census held that GitHub no longer returns is kept with
the time it became unavailable; one of a repository that is no longer
collected is archived unchanged, so a reactivated project resumes it. An
issue whose visible events do not reproduce its current state (GitHub hides
events by unavailable accounts) is marked incomplete; the missing
transition is never inferred. A failed collection keeps the previous census
whole.

An issue is recorded only for a collected repository whose issue inventory
is not yet reconciled. A repository's inventory is reconciled once, when
the crawled issue count equals the total GitHub reports and every crawled
issue is recorded; the adapter also requires each issue's events to
reconcile with their reported count and every cursor to advance, and
abandons the collection otherwise. A census publishes only when every
collected repository's pull requests and issues are both reconciled, so a
collection that read no issues never marks published issues unavailable.
The same issue seen twice, under one repository or after a transfer under
another, is refused, and the adapter then abandons the whole collection
(`Duplicate issue in census`): a duplicate is never skipped.

```quint
pure def canRecordIssue(p: Profiles, issue: ObservedIssue): bool =
  p.phase == Collecting and issue.id > 0 and collectedName(p.targets, issue.repository) and
  not(p.issuesReconciled.includes(issue.repository)) and not(p.issues.some(i => i.id == issue.id))
pure def recordIssue(p: Profiles, issue: ObservedIssue): Profiles =
  { ...p, issues: p.issues.append({ id: issue.id, repository: issue.repository, unavailable: false,
    historyIncomplete: not(issue.eventsReproduceState) }) }
pure def retainedIssues(p: Profiles): List[ProfileIssue] =
  p.publishedIssues.select(old => not(p.issues.some(i => i.id == old.id)))
    .listMap(old => if (collectedName(p.targets, old.repository)) { ...old, unavailable: true } else old)
pure def canReconcileIssues(p: Profiles, issueTally: IssueTally): bool =
  p.phase == Collecting and collectedName(p.targets, issueTally.repository) and
  not(p.issuesReconciled.includes(issueTally.repository)) and issueTally.crawled == issueTally.reported and
  issueTally.crawled == p.issues.select(i => i.repository == issueTally.repository).length()
pure def reconcileIssues(p: Profiles, issueTally: IssueTally): Profiles =
  { ...p, issuesReconciled: p.issuesReconciled.append(issueTally.repository) }
pure def canPublish(p: Profiles): bool = p.phase == Collecting and
  p.targets.every(t => p.rows.some(r => r.repository == t.repository)) and
  p.targets.every(t => p.issuesReconciled.includes(t.repository))
pure def publish(p: Profiles): Profiles =
  { ...p, phase: Idle, publishedRows: p.rows, publishedIssues: p.issues.concat(retainedIssues(p)),
    publications: p.publications + 1 }
pure def canAbandon(p: Profiles): bool = p.phase == Collecting
pure def abandon(p: Profiles): Profiles =
  { ...p, phase: Idle, rows: List(), issues: List(), issuesReconciled: List(), failures: p.failures + 1 }
pure def alwaysReconciledRepositoriesCollected(p: Profiles): bool =
  p.issuesReconciled.every(r => collectedName(p.targets, r) and p.issuesReconciled.select(o => o == r).length() == 1)
pure def stepPublicationReconcilesIssues(before: Profiles, after: Profiles): bool =
  after.publications > before.publications implies
    before.targets.every(t => before.issuesReconciled.includes(t.repository))
pure def alwaysIssuesDistinct(p: Profiles): bool =
  p.issues.every(i => i.id > 0 and p.issues.select(o => o.id == i.id).length() == 1) and
  p.publishedIssues.every(i => i.id > 0 and p.publishedIssues.select(o => o.id == i.id).length() == 1)
pure def stepPublishedIssuesNeverDropped(before: Profiles, after: Profiles): bool =
  before.publishedIssues.every(old => after.publishedIssues.some(i => i.id == old.id))
pure def stepFailureKeepsPublished(before: Profiles, after: Profiles): bool =
  after.publications == before.publications implies
    (after.publishedRows == before.publishedRows and after.publishedIssues == before.publishedIssues)
pure def sometimesUnavailableIssueKept(p: Profiles): bool = p.publishedIssues.some(i => i.unavailable)
pure def sometimesIncompleteHistoryRecorded(p: Profiles): bool = p.publishedIssues.some(i => i.historyIncomplete)
pure def sometimesArchivedIssueKept(p: Profiles): bool = p.phase == Idle and
  p.publishedIssues.some(i => not(collectedName(p.targets, i.repository)) and not(i.unavailable))
pure def sometimesFailureKeepsPrevious(p: Profiles): bool = p.failures > 0 and p.publishedRows.length() > 0
```

### Simulation samples rename, remove and re-add repositories

```quint
pure val targetsValues = Set(List({ repository: 1, canonical: 1 }), List({ repository: 2, canonical: 1 }),
  List({ repository: 1, canonical: 1 }, { repository: 3, canonical: 3 }), List({ repository: 3, canonical: 3 }),
  List({ repository: 1, canonical: 1 }, { repository: 4, canonical: 1 }))
pure val tallyValues = Set({ repository: 1, canonical: 1, crawled: 2, reported: 2, excluded: 1 },
  { repository: 2, canonical: 1, crawled: 3, reported: 3, excluded: 0 },
  { repository: 3, canonical: 3, crawled: 1, reported: 1, excluded: 0 },
  { repository: 1, canonical: 1, crawled: 1, reported: 2, excluded: 0 },
  { repository: 2, canonical: 2, crawled: 1, reported: 1, excluded: 0 })
pure val issueValues = Set({ id: 1, repository: 1, eventsReproduceState: true },
  { id: 2, repository: 3, eventsReproduceState: false }, { id: 3, repository: 2, eventsReproduceState: true },
  { id: 1, repository: 2, eventsReproduceState: true })
pure val issueTallyValues = Set({ repository: 1, crawled: 1, reported: 1 }, { repository: 3, crawled: 1, reported: 1 },
  { repository: 2, crawled: 0, reported: 0 }, { repository: 1, crawled: 0, reported: 0 },
  { repository: 1, crawled: 1, reported: 2 })
pure val rowValues = Set({ repository: 1, canonical: 1, pullRequests: 2, excluded: 0 },
  { repository: 5, canonical: 0, pullRequests: 1, excluded: 0 }, { repository: 2, canonical: 3, pullRequests: 4, excluded: 1 })
```
