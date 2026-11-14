# Source census and publication

This model covers PRD section 7 and legacy `github_census`, `source_import`,
`source_replay`, and `journal_publication`. A census retains every open issue
and PR even when work-selection eligibility is false. Network pagination,
immutable GitHub IDs, and source-tree hashes need integration qualification.

## Story: Publish complete rankings and deterministic work decisions

Missing data is never presented as an empty successful census. Only a complete
35-day source window and reconciled history can replace the published snapshot.

### Snapshot progress preserves exact bounds and distinct immutable source IDs

Discovered by the proof review, a synthetic saved census could previously
contain repeated or out-of-range page IDs while satisfying the expected page
count. Every retained page now has a unique valid page index, and every source
has a positive immutable ID before completion can be accepted.

```quint
type CensusPhase = Empty | Collecting | Incomplete | Ready | Published
type Census = { phase: CensusPhase, lowerDay: int, upperDay: int,
  pagesExpected: int, sourcesExpected: int, pagesSeen: List[int], sourceIds: List[int],
  previousSnapshot: int, publishedSnapshot: int, historicalHold: bool,
  duplicateChecked: bool, frozenChecked: bool, assessmentsComplete: bool }
pure val initial: Census = { phase: Empty, lowerDay: 0, upperDay: 35,
  pagesExpected: 0, sourcesExpected: 0, pagesSeen: List(), sourceIds: List(), previousSnapshot: 1,
  publishedSnapshot: 1, historicalHold: true, duplicateChecked: false,
  frozenChecked: false, assessmentsComplete: false }
pure def alwaysWindow(c: Census): bool = c.upperDay - c.lowerDay == 35
pure def alwaysExpectedCounts(c: Census): bool = c.pagesExpected >= 0 and c.sourcesExpected >= 0
pure def alwaysPageRange(c: Census): bool = c.pagesSeen.every(page => page >= 1 and page <= c.pagesExpected)
pure def alwaysDistinctPages(c: Census): bool = c.pagesSeen.every(page =>
  c.pagesSeen.select(other => other == page).length() == 1)
pure def alwaysSourceIds(c: Census): bool = c.sourceIds.every(id => id > 0)
pure def alwaysDistinctSources(c: Census): bool = c.sourceIds.every(id =>
  c.sourceIds.select(other => other == id).length() == 1)
```

### Collection records all pages and deduplicates immutable sources

Each source retains its selection decision and original occurrence time in
production. A page failure holds the prior published snapshot.

```quint
pure def canBegin(c: Census, lowerDay: int, pages: int, sources: int): bool = lowerDay >= 0 and pages > 0 and sources >= 0 and c.phase != Collecting
pure def begin(c: Census, lowerDay: int, pages: int, sources: int): Census =
  { ...c, phase: Collecting, lowerDay: lowerDay, upperDay: lowerDay + 35,
    pagesExpected: pages, sourcesExpected: sources, pagesSeen: List(), sourceIds: List(),
    previousSnapshot: c.publishedSnapshot, duplicateChecked: false,
    frozenChecked: false, assessmentsComplete: false }
pure def canRecordPage(c: Census, page: int, sourceId: int): bool =
  c.phase == Collecting and page >= 1 and page <= c.pagesExpected and sourceId > 0
pure def recordPage(c: Census, page: int, sourceId: int): Census =
  { ...c, pagesSeen: if (c.pagesSeen.includes(page)) c.pagesSeen else c.pagesSeen.append(page),
    sourceIds: if (c.sourceIds.includes(sourceId)) c.sourceIds else c.sourceIds.append(sourceId) }
pure def canRecordEmptyPage(c: Census, page: int): bool =
  c.phase == Collecting and page >= 1 and page <= c.pagesExpected
pure def recordEmptyPage(c: Census, page: int): Census =
  { ...c, pagesSeen: if (c.pagesSeen.includes(page)) c.pagesSeen else c.pagesSeen.append(page) }
pure def canRecordFailure(c: Census): bool = c.phase == Collecting
pure def recordFailure(c: Census): Census = { ...c, phase: Incomplete }
pure def canFinish(c: Census, duplicateChecked: bool, frozenChecked: bool, assessmentsComplete: bool): bool =
  c.phase == Collecting and c.pagesSeen.length() == c.pagesExpected and c.sourceIds.length() == c.sourcesExpected and duplicateChecked and frozenChecked and assessmentsComplete
pure def finish(c: Census, duplicateChecked: bool, frozenChecked: bool, assessmentsComplete: bool): Census =
  { ...c, phase: Ready, duplicateChecked: true, frozenChecked: true, assessmentsComplete: true }
```

### Publication requires a complete reconciled journal and preserves the previous snapshot on failure

The historical publication hold is released only after complete assessments,
duplicate checks, and frozen-history checks. A no-change promotion is excluded
only with complete hash-verified base, head, merge, and prior accepted-source
coverage for every imported commit.

```quint
pure def canReleaseHold(c: Census): bool = c.phase == Ready and c.duplicateChecked and c.frozenChecked and c.assessmentsComplete
pure def releaseHold(c: Census): Census = { ...c, historicalHold: false }
pure def canPublish(c: Census, snapshot: int): bool = c.phase == Ready and not(c.historicalHold) and snapshot > c.previousSnapshot
pure def publish(c: Census, snapshot: int): Census = { ...c, phase: Published, publishedSnapshot: snapshot }
pure def promotionExcluded(baseTree: str, headTree: str, mergeTree: str,
  completeCoverage: bool, allPriorAccepted: bool): bool =
  baseTree != "" and baseTree == headTree and headTree == mergeTree and completeCoverage and allPriorAccepted
pure def alwaysPublishedComplete(c: Census): bool = c.phase == Published implies
  c.pagesSeen.length() == c.pagesExpected and c.sourceIds.length() == c.sourcesExpected and not(c.historicalHold) and c.duplicateChecked and c.frozenChecked and c.assessmentsComplete
pure def alwaysFailedKeepsSnapshot(c: Census): bool = c.phase == Incomplete implies c.publishedSnapshot == c.previousSnapshot
pure def sometimesPublished(c: Census): bool = c.phase == Published
pure def sometimesIncomplete(c: Census): bool = c.phase == Incomplete
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val baseTreeValues = Set("", "a", "b")
pure val headTreeValues = Set("", "a", "b")
pure val lowerDayValues = Set(0, 1, 2)
pure val mergeTreeValues = Set("", "a", "b")
pure val pageValues = Set(0, 1, 2)
pure val pagesValues = Set(0, 1, 2)
pure val snapshotValues = Set(0, 1, 2)
pure val sourceIdValues = Set(0, 1, 2)
pure val sourcesValues = Set(0, 1, 2)
```
