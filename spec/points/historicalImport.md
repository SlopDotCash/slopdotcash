# Historical Points import and publication hold

PRD sections 5 and 7: hold historical Points publication until the complete
assessment journal and the exact Points changes reconcile. Source coverage,
duplicate-credit and funded-history checks are required before release.
Other releases keep the prior historical rules. The standard importer and
the September candidate checks stay in force. `src/lib/scoring-policy.ts`
keeps normal publication on the 1 November 2026 boundary until a reviewed
source change releases the hold; no runtime flag enables it.

This machine owns the hold for each historical import by its identity. A new
import arms its own hold; releasing one import never releases another. The
evidence of a reconciliation comes from the importer's verified run
(`scripts/prepare-points-import.ts`) and the [Points
journal](./journal.md) digest it reconciles against. The [scoring
policy](./scoringPolicy.md) applies the released bands.

## Story: Release historical rescoring only after it reconciles

### Each import has its own hold and published rules stay prior until a release

An import names the exact accepted sources it covers. The [scoring
policy](./scoringPolicy.md) applies a released band only to a source in a
released import's list.

```quint
type ImportPhase = Collecting | Assessed | Reconciled | Released | Refused
type Import = { phase: ImportPhase, sources: int, sourceIds: List[int], assessed: int, held: int,
  coverageComplete: bool, duplicateChecked: bool, fundedChecked: bool, changesDigest: str, journalDigest: str }
type Imports = { ids: List[int], imports: int -> Import, released: List[int] }
pure val noImport: Import = { phase: Refused, sources: 0, sourceIds: List(), assessed: 0, held: 0, coverageComplete: false,
  duplicateChecked: false, fundedChecked: false, changesDigest: "", journalDigest: "" }
pure val initial: Imports = { ids: List(), imports: Map(), released: List() }
pure def find(s: Imports, id: int): Import = if (s.imports.keys().contains(id)) s.imports.get(id) else noImport
pure def known(s: Imports, id: int): bool = s.imports.keys().contains(id)
pure def store(id: int, f: Import, s: Imports): Imports = { ...s, imports: s.imports.put(id, f) }
pure def distinctSources(sourceIds: List[int]): bool =
  sourceIds.every(x => x > 0 and sourceIds.select(o => o == x).length() == 1)
pure def canBegin(s: Imports, id: int, sourceIds: List[int]): bool =
  id > 0 and sourceIds.length() > 0 and distinctSources(sourceIds) and not(known(s, id)) and not(s.ids.includes(id))
pure def begin(s: Imports, id: int, sourceIds: List[int]): Imports =
  { ...s, ids: s.ids.append(id), imports: s.imports.put(id, { ...noImport, phase: Collecting, sources: sourceIds.length(), sourceIds: sourceIds }) }
pure def includesSource(i: Import, source: int): bool = i.phase == Released and i.sourceIds.includes(source)
pure def held(s: Imports, id: int): bool = known(s, id) and not(s.released.includes(id))
```

### Every source is assessed or explicitly held before reconciliation

Held and unassessed sources keep their earlier Points; they never become a
silent zero.

```quint
type Completion = { assessed: int, held: int, coverageComplete: bool }
pure def canComplete(s: Imports, id: int, c: Completion): bool =
  known(s, id) and find(s, id).phase == Collecting and c.assessed >= 0 and c.held >= 0 and
  c.assessed + c.held == find(s, id).sources and c.coverageComplete
pure def complete(s: Imports, id: int, c: Completion): Imports =
  store(id, { ...find(s, id), phase: Assessed, assessed: c.assessed, held: c.held, coverageComplete: true }, s)
pure def canRefuse(s: Imports, id: int): bool = known(s, id) and (find(s, id).phase == Collecting or find(s, id).phase == Assessed)
pure def refuse(s: Imports, id: int): Imports = store(id, { ...find(s, id), phase: Refused }, s)
```

### Reconciliation binds the exact changes to the current journal and the release follows it

The release requires the reconciliation's duplicate-credit and funded-history
checks and the journal digest it was computed against. A changed journal
needs a new reconciliation.

```quint
type Reconciliation = { changesDigest: str, journalDigest: str, duplicateChecked: bool, fundedChecked: bool }
pure def canReconcile(s: Imports, id: int, r: Reconciliation): bool =
  known(s, id) and find(s, id).phase == Assessed and r.changesDigest != "" and r.journalDigest != "" and r.duplicateChecked and r.fundedChecked
pure def reconcile(s: Imports, id: int, r: Reconciliation): Imports =
  store(id, { ...find(s, id), phase: Reconciled, changesDigest: r.changesDigest, journalDigest: r.journalDigest,
    duplicateChecked: true, fundedChecked: true }, s)
pure def canRelease(s: Imports, id: int, currentJournal: str): bool =
  known(s, id) and s.ids.includes(id) and find(s, id).phase == Reconciled and find(s, id).journalDigest == currentJournal and
  currentJournal != "" and not(s.released.includes(id))
pure def release(s: Imports, id: int, currentJournal: str): Imports =
  { ...s, imports: s.imports.put(id, { ...find(s, id), phase: Released }), released: s.released.append(id) }
pure def canInvalidate(s: Imports, id: int, currentJournal: str): bool =
  known(s, id) and find(s, id).phase == Reconciled and find(s, id).journalDigest != currentJournal and currentJournal != ""
pure def invalidate(s: Imports, id: int, currentJournal: str): Imports =
  store(id, { ...find(s, id), phase: Assessed, changesDigest: "", journalDigest: "", duplicateChecked: false, fundedChecked: false }, s)
pure def releasedReconciled(i: Import): bool =
  i.sources == i.sourceIds.length() and
  ((i.phase == Assessed or i.phase == Reconciled or i.phase == Released) implies
    (i.coverageComplete and i.assessed >= 0 and i.held >= 0 and i.assessed + i.held == i.sources)) and
  ((i.phase == Reconciled or i.phase == Released) implies
    (i.duplicateChecked and i.fundedChecked and i.changesDigest != "" and i.journalDigest != ""))
pure def alwaysReleasedReconciled(s: Imports): bool = s.ids.every(id => known(s, id) and releasedReconciled(find(s, id)) and
  (s.released.includes(id) iff find(s, id).phase == Released))
pure def alwaysKnownListed(s: Imports): bool = s.released.every(id => s.ids.includes(id))
pure def stepReleaseFinal(before: Imports, after: Imports): bool =
  before.released.every(id => after.released.includes(id)) and before.ids.every(id => after.ids.includes(id)) and
  before.ids.every(id => (find(before, id).phase == Released or find(before, id).phase == Refused) implies find(after, id) == find(before, id))
pure def sometimesReleased(s: Imports): bool = s.ids.some(id => find(s, id).phase == Released and find(s, id).held > 0)
pure def sometimesSecondImportStillHeld(s: Imports): bool = s.released.length() > 0 and s.ids.some(id => held(s, id))
pure def sometimesInvalidated(s: Imports): bool = s.ids.some(id => find(s, id).phase == Assessed and find(s, id).assessed > 0 and not(find(s, id).duplicateChecked))
pure def sometimesRefused(s: Imports): bool = s.ids.some(id => find(s, id).phase == Refused)
```

### Simulation samples bound the import identities

```quint
pure val idValues = Set(1, 2)
pure val sourceIdsValues = Set(List(1, 2), List(3, 4))
pure val cValues = Set({ assessed: 1, held: 1, coverageComplete: true }, { assessed: 2, held: 0, coverageComplete: true },
  { assessed: 1, held: 0, coverageComplete: true }, { assessed: 2, held: 0, coverageComplete: false })
pure val rValues = Set({ changesDigest: "c", journalDigest: "j1", duplicateChecked: true, fundedChecked: true },
  { changesDigest: "c", journalDigest: "j1", duplicateChecked: false, fundedChecked: true })
pure val currentJournalValues = Set("j1", "j2")
```
