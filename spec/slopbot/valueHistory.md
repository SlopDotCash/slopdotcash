# Select Slopbot value from the complete assessment history

PRD sections 5 and 7 require source-bound assessments, append-only
corrections, and no duplicate work-unit credit. The
[value inference model](./valueInference.md) owns provider attempts and
publication of an individual inference. This model owns the read of durable
grouped assessment history and selection of a current decision before any
new attempt starts. It also consumes verified heads from the older
per-source assessment journal. [Work units](./workUnits.md) own the durable
append that produces this history, and [value requests](./valueRequests.md)
own the request claims and the shared source leases that fence it. The
focused witness scenarios are in
`formal/validation/source-coverage/slopbot-value-history.witness.qnt`.

The source at main `ee1a4b2cd2672245537928380e425f5bd9ecb994` is
`workers/slopbot/value-work-unit-journal.ts:275–363`,
`workers/slopbot/value-work-unit-consumption.ts:42–116,122–341`,
`workers/slopbot/verified-source-ownership.ts:111–220`,
`workers/slopbot/value-consumption.ts:58–160` and
`workers/slopbot/value-consumer.ts:210–325`. The retained Quint cases
`bot_value_history` and `bot_value_journal` cover stable coverage,
correction lineage and unresolved sources.

Adapters authenticate the D1 connection, parse record bytes, verify their
SHA-256 and schema, and bind opaque identities to exact canonical data.
A source identity means the immutable repository and PR node-ID pair.
A record ID means its exact retained digest. The model uses integers for
these identities. Source and claim fingerprints bind ordered exact evidence.
This reader supplies provisional decisions. Human ratification, prize
acceptance, and Points allocation are separate authorities.

## Story: Recover complete history at a fixed sequence boundary

### Each page agrees with the first through sequence and total count

The first page fixes the sequence upper bound and total lineage count.
Later appends may add roots below the current cursor only through a newer
join record. Follow that join in a separately started read. Pages cannot
change the captured boundary, exceed 100 returned rows, repeat a
sequence, skip a claimed continuation, or stop before the promised count.
Sequence numbers can have gaps because other groups share the journal.

```quint
type Phase = Opening | BetweenPages | ReadingPage | HistoryReady | Refused | Decided
type Verdict = Pending | Invalid | Missing | Incomplete | Stale | Unresolved | Assessed
type Row = { sequence: int, digest: int, project: int, sources: Set[int], claims: Set[int],
  parents: Set[int], legacy: Set[int], sourceDigest: int, membersDigest: int, claimsDigest: int,
  rubric: int, revisionReason: bool, exactRecord: bool }
type Page = { through: int, total: int, rows: int, nextAfter: int }
type History = { phase: Phase, project: int, target: int, through: int, total: int,
  cursor: int, page: Page, pageRead: int, rows: List[Row], retired: Set[int], outcome: Verdict, selected: int }
pure val noPage: Page = { through: 0, total: 0, rows: 0, nextAfter: 0 }
pure val emptyRow: Row = { sequence: 0, digest: 0, project: 0, sources: Set(), claims: Set(), parents: Set(),
  legacy: Set(), sourceDigest: 0, membersDigest: 0, claimsDigest: 0, rubric: 0,
  revisionReason: false, exactRecord: false }
pure def startHistory(project: int, target: int): History =
  { phase: Opening, project: project, target: target, through: 0, total: 0, cursor: 0,
    page: noPage, pageRead: 0, rows: List(), retired: Set(), outcome: Pending, selected: 0 }
pure val initial = startHistory(1, 1)
pure def orderedBoundary(h: History, page: Page): bool =
  page.through >= h.cursor and page.total >= 0 and page.rows >= 0 and page.rows <= 100 and page.nextAfter >= 0
    and h.rows.length() + page.rows <= page.total
    and (if (page.nextAfter > 0) page.rows > 0 and page.nextAfter > h.cursor and page.nextAfter <= page.through
         else h.rows.length() + page.rows == page.total)
    and (h.phase == Opening or (page.through == h.through and page.total == h.total))
pure def canAcceptPage(h: History, page: Page): bool =
  (h.phase == Opening or h.phase == BetweenPages) and orderedBoundary(h, page)
pure def acceptPage(h: History, page: Page): History =
  { ...h, phase: ReadingPage, through: page.through, total: page.total, page: page, pageRead: 0 }
pure def canRejectPage(h: History, page: Page): bool =
  (h.phase == Opening or h.phase == BetweenPages) and not(orderedBoundary(h, page))
pure def rejectPage(h: History, page: Page): History = { ...h, phase: Refused, outcome: Invalid }
pure def lawLaterPageCannotMoveBoundary(h: History, page: Page): bool =
  (h.phase == BetweenPages and (page.through != h.through or page.total != h.total)) implies not(canAcceptPage(h, page))
```

### A successor consumes every affected predecessor and its complete source set

Digest, sequence, project and immutable membership are verified before a
record can become current. Every named predecessor must be present,
previous, unconsumed and part of the same project. A successor keeps every
source of every predecessor. Any current source or claim that intersects a
candidate must belong to one of its named predecessors. A successful
transition retires all parents, including their old claim ownership. A
sibling root may join the target's lineage in this way. An absent or already
consumed parent and an omitted source or conflicting claim refuse the read.

```quint
pure def livingRows(h: History): List[Row] = h.rows.select(record => not(h.retired.contains(record.digest)))
pure def rowOf(h: History, digest: int): Row =
  h.rows.select(record => record.digest == digest).nthOr(0, emptyRow)
pure def ownSources(h: History, record: Row): bool =
  livingRows(h).every(owner =>
    owner.sources.intersect(record.sources).size() == 0 or record.parents.contains(owner.digest))
pure def ownClaims(h: History, record: Row): bool =
  livingRows(h).every(owner =>
    owner.claims.intersect(record.claims).size() == 0 or record.parents.contains(owner.digest))
pure def completeParent(h: History, record: Row, digest: int): bool =
  val parent = rowOf(h, digest)
  parent.digest > 0 and parent.project == record.project and parent.sequence < record.sequence
    and not(h.retired.contains(parent.digest)) and parent.sources.subseteq(record.sources)
pure def completeParents(h: History, record: Row): bool =
  record.parents.forall(digest => completeParent(h, record, digest))
pure def exactRow(h: History, record: Row): bool =
  record.exactRecord and record.digest > 0 and rowOf(h, record.digest).digest == 0 and record.project == h.project
    and record.sequence > h.cursor and record.sequence <= h.through and record.sources.size() > 0
    and record.sourceDigest > 0 and record.membersDigest > 0 and record.claimsDigest > 0 and record.rubric > 0
    and record.revisionReason == (record.parents.size() > 0 or record.legacy.size() > 0)
pure def rowAllowed(h: History, record: Row): bool =
  exactRow(h, record) and completeParents(h, record) and ownSources(h, record) and ownClaims(h, record)
pure def canAcceptRow(h: History, record: Row): bool =
  h.phase == ReadingPage and h.pageRead < h.page.rows and rowAllowed(h, record)
pure def acceptRow(h: History, record: Row): History =
  { ...h, cursor: record.sequence, pageRead: h.pageRead + 1, rows: h.rows.append(record),
    retired: h.retired.union(record.parents) }
pure def canRejectRow(h: History, record: Row): bool =
  h.phase == ReadingPage and (h.pageRead >= h.page.rows or not(rowAllowed(h, record)))
pure def rejectRow(h: History, record: Row): History = { ...h, phase: Refused, outcome: Invalid }
pure def lawOmittedOwnerCannotAdvance(h: History, record: Row): bool =
  (not(ownSources(h, record)) or not(ownClaims(h, record))) implies not(canAcceptRow(h, record))
```

### The requested source selects one live record in the complete captured lineage

A page continuation names the exact last row sequence. At the final page,
the requested source must have one live owner and the other retained records
must all be its ancestors. With validated predecessor order and membership
inheritance, one live record across the captured nonempty lineage implies
every earlier record reaches that root. Unrelated additional roots refuse.
An empty complete lineage yields Missing. Empty and malformed histories
remain distinct.

```quint
pure def liveTarget(h: History): Row =
  livingRows(h).select(record => record.sources.contains(h.target)).nthOr(0, emptyRow)
pure def exactTerminalLineage(h: History): bool =
  h.rows.length() == h.total and
    (h.total == 0 or (livingRows(h).length() == 1 and liveTarget(h).digest > 0))
pure def canClosePage(h: History): bool = h.phase == ReadingPage and h.pageRead == h.page.rows
pure def closePage(h: History): History =
  if (h.page.nextAfter > 0)
    (if (h.page.nextAfter == h.cursor) { ...h, phase: BetweenPages }
     else { ...h, phase: Refused, outcome: Invalid })
  else if (not(exactTerminalLineage(h))) { ...h, phase: Refused, outcome: Invalid }
  else { ...h, phase: HistoryReady, selected: liveTarget(h).digest }
pure def lawWrongContinuationRefused(h: History): bool =
  (canClosePage(h) and h.page.nextAfter > 0 and h.page.nextAfter != h.cursor) implies closePage(h).outcome == Invalid
pure def lawUnrelatedRootRefused(h: History): bool =
  (canClosePage(h) and h.page.nextAfter == 0 and h.total > 0 and livingRows(h).length() != 1)
    implies closePage(h).outcome == Invalid
```

## Story: Reuse the exact current assessment before spending again

### Incomplete, stale and unresolved decisions remain distinct

A reader lists each source's current verified legacy record or verified
absence. Unverified legacy heads or malformed exact binding evidence refuse.
Complete source collection with a changed group digest, rubric or legacy
head set is stale and requires reconsideration. For matching digests, the
ordered source bindings, claims, producer and work-unit verdict identities
must also match the current evidence. Missing evidence remains incomplete.
Only a complete assessed assessment or complete unresolved verdict may
skip new inference. These states alone grant no numeric award. If the source
evidence changed, the prior assessed record remains in the journal and the
current read can return Stale.

```quint
type Observation = { sourceDigest: int, rubric: int, membersDigest: int, claimsDigest: int,
  observedSources: Set[int], verifiedLegacySources: Set[int], legacy: Set[int],
  completeEvidence: bool, exactProducer: bool, validAssessment: bool, everyUnitAssessed: bool }
pure def exactIds(left: Set[int], right: Set[int]): bool = left.subseteq(right) and right.subseteq(left)
pure def decision(h: History, observation: Observation): Verdict =
  val record = rowOf(h, h.selected)
  if (h.selected <= 0) Missing
  else if (not(observation.completeEvidence)) Incomplete
  else if (record.sourceDigest != observation.sourceDigest or record.rubric != observation.rubric) Stale
  else if (not(exactIds(observation.verifiedLegacySources, observation.observedSources))) Invalid
  else if (not(exactIds(record.legacy, observation.legacy))) Stale
  else if (not(exactIds(record.sources, observation.observedSources)) or record.membersDigest != observation.membersDigest
    or record.claimsDigest != observation.claimsDigest or not(observation.exactProducer)
    or not(observation.validAssessment)) Invalid
  else if (observation.everyUnitAssessed) Assessed else Unresolved
pure def canConsume(h: History, observation: Observation): bool = h.phase == HistoryReady
pure def consume(h: History, observation: Observation): History =
  val result = decision(h, observation)
  { ...h, phase: if (result == Invalid) Refused else Decided, outcome: result }
pure def mayReuseCurrent(h: History): bool = h.phase == Decided and (h.outcome == Assessed or h.outcome == Unresolved)
pure def lawMissingSelectionNotReusable(h: History, observation: Observation): bool =
  (canConsume(h, observation) and h.selected == 0) implies not(mayReuseCurrent(consume(h, observation)))
pure def lawChangedLegacyHeadIsStale(h: History, observation: Observation): bool =
  val record = rowOf(h, h.selected)
  (canConsume(h, observation) and h.selected > 0 and observation.completeEvidence
    and observation.sourceDigest == record.sourceDigest and observation.rubric == record.rubric
    and exactIds(observation.verifiedLegacySources, observation.observedSources) and not(exactIds(observation.legacy, record.legacy)))
    implies consume(h, observation).outcome == Stale
pure def alwaysSelectionAfterRead(h: History): bool =
  (h.phase == Opening or h.phase == BetweenPages or h.phase == ReadingPage) implies h.selected == 0
pure def alwaysReusableHasSelection(h: History): bool = mayReuseCurrent(h) implies h.selected > 0
pure def stepCapturedBoundaryPersists(before: History, after: History): bool =
  before.phase != Opening implies before.through == after.through and before.total == after.total
pure def stepCapturedHistoryDoesNotShrink(before: History, after: History): bool =
  after.rows.length() >= before.rows.length() and before.retired.subseteq(after.retired)
pure def sometimesCurrent(h: History): bool = mayReuseCurrent(h)
pure def sometimesMissing(h: History): bool = h.outcome == Missing
pure def sometimesIncomplete(h: History): bool = h.outcome == Incomplete
pure def sometimesStale(h: History): bool = h.outcome == Stale
pure def sometimesInvalid(h: History): bool = h.outcome == Invalid
```

### Simulation includes pinned pages, sibling roots and alternate evidence

```quint
pure val rootRecord: Row = { sequence: 1, digest: 1, project: 1, sources: Set(1), claims: Set(1), parents: Set(),
  legacy: Set(), sourceDigest: 1, membersDigest: 1, claimsDigest: 1, rubric: 1, revisionReason: false, exactRecord: true }
pure val siblingRecord: Row = { ...rootRecord, sequence: 3, digest: 2, sources: Set(2), claims: Set(2) }
pure val joinedRecord: Row = { ...rootRecord, sequence: 5, digest: 3, sources: Set(1, 2), claims: Set(1, 2),
  parents: Set(1, 2), legacy: Set(8), sourceDigest: 3, membersDigest: 3, claimsDigest: 3, revisionReason: true }
pure val recordValues = Set(rootRecord, siblingRecord, joinedRecord,
  { ...joinedRecord, parents: Set(1), sources: Set(1) }, { ...rootRecord, exactRecord: false })
pure val pageValues = Set(noPage, { through: 1, total: 1, rows: 1, nextAfter: 0 },
  { through: 5, total: 3, rows: 1, nextAfter: 1 }, { through: 5, total: 3, rows: 2, nextAfter: 0 },
  { through: 6, total: 3, rows: 2, nextAfter: 0 })
pure val sourceObservation: Observation = { sourceDigest: 1, rubric: 1, membersDigest: 1, claimsDigest: 1,
  observedSources: Set(1), verifiedLegacySources: Set(1), legacy: Set(), completeEvidence: true,
  exactProducer: true, validAssessment: true, everyUnitAssessed: true }
pure val observationValues = Set(sourceObservation, { ...sourceObservation, completeEvidence: false },
  { ...sourceObservation, everyUnitAssessed: false }, { ...sourceObservation, legacy: Set(8) },
  { ...sourceObservation, sourceDigest: 3, membersDigest: 3, claimsDigest: 3, observedSources: Set(1, 2),
    verifiedLegacySources: Set(1, 2), legacy: Set(8) })
```
