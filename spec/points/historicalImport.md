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

```quint
type ImportPhase = Collecting | Assessed | Reconciled | Released | Refused
type Import = { id: int, phase: ImportPhase, sources: int, assessed: int, held: int,
  coverageComplete: bool, duplicateChecked: bool, fundedChecked: bool, changesDigest: str, journalDigest: str }
type Imports = { imports: List[Import], releasedThrough: List[int] }
pure val initial: Imports = { imports: List(), releasedThrough: List() }
pure def find(s: Imports, id: int): Import =
  s.imports.foldl({ id: 0, phase: Refused, sources: 0, assessed: 0, held: 0, coverageComplete: false,
    duplicateChecked: false, fundedChecked: false, changesDigest: "", journalDigest: "" }, (acc, i) => if (i.id == id) i else acc)
pure def known(s: Imports, id: int): bool = s.imports.some(i => i.id == id)
pure def update(id: int, f: Import, s: Imports): Imports = { ...s, imports: s.imports.listMap(i => if (i.id == id) f else i) }
pure def canBegin(s: Imports, id: int, sources: int): bool = id > 0 and sources > 0 and not(known(s, id))
pure def begin(s: Imports, id: int, sources: int): Imports =
  { ...s, imports: s.imports.append({ id: id, phase: Collecting, sources: sources, assessed: 0, held: 0,
    coverageComplete: false, duplicateChecked: false, fundedChecked: false, changesDigest: "", journalDigest: "" }) }
pure def held(s: Imports, id: int): bool = known(s, id) and not(s.releasedThrough.includes(id))
```

### Every source is assessed or explicitly held before reconciliation

Held and unassessed sources keep their earlier Points; they never become a
silent zero.

```quint
type Completion = { assessed: int, held: int, coverageComplete: bool }
pure def canComplete(s: Imports, id: int, c: Completion): bool =
  find(s, id).phase == Collecting and c.assessed >= 0 and c.held >= 0 and
  c.assessed + c.held == find(s, id).sources and c.coverageComplete
pure def complete(s: Imports, id: int, c: Completion): Imports =
  update(id, { ...find(s, id), phase: Assessed, assessed: c.assessed, held: c.held, coverageComplete: true }, s)
pure def canRefuse(s: Imports, id: int): bool = find(s, id).phase == Collecting or find(s, id).phase == Assessed
pure def refuse(s: Imports, id: int): Imports = update(id, { ...find(s, id), phase: Refused }, s)
```

### Reconciliation binds the exact changes to the current journal and the release follows it

The release requires the reconciliation's duplicate-credit and funded-history
checks and the journal digest it was computed against. A changed journal
needs a new reconciliation.

```quint
type Reconciliation = { changesDigest: str, journalDigest: str, duplicateChecked: bool, fundedChecked: bool }
pure def canReconcile(s: Imports, id: int, r: Reconciliation): bool =
  find(s, id).phase == Assessed and r.changesDigest != "" and r.journalDigest != "" and r.duplicateChecked and r.fundedChecked
pure def reconcile(s: Imports, id: int, r: Reconciliation): Imports =
  update(id, { ...find(s, id), phase: Reconciled, changesDigest: r.changesDigest, journalDigest: r.journalDigest,
    duplicateChecked: true, fundedChecked: true }, s)
pure def canRelease(s: Imports, id: int, currentJournal: str): bool =
  find(s, id).phase == Reconciled and find(s, id).journalDigest == currentJournal and currentJournal != ""
pure def release(s: Imports, id: int, currentJournal: str): Imports =
  { ...update(id, { ...find(s, id), phase: Released }, s), releasedThrough: s.releasedThrough.append(id) }
pure def canInvalidate(s: Imports, id: int, currentJournal: str): bool =
  find(s, id).phase == Reconciled and find(s, id).journalDigest != currentJournal and currentJournal != ""
pure def invalidate(s: Imports, id: int, currentJournal: str): Imports =
  update(id, { ...find(s, id), phase: Assessed, changesDigest: "", journalDigest: "", duplicateChecked: false, fundedChecked: false }, s)
pure def alwaysReleasedReconciled(s: Imports): bool = s.imports.every(i =>
  (i.phase == Released implies (i.coverageComplete and i.duplicateChecked and i.fundedChecked and
    i.changesDigest != "" and i.journalDigest != "" and i.assessed + i.held == i.sources)) and
  (s.releasedThrough.includes(i.id) iff i.phase == Released))
pure def alwaysReleasesKnown(s: Imports): bool = s.releasedThrough.every(id => s.imports.some(i => i.id == id))
pure def stepReleaseFinal(before: Imports, after: Imports): bool =
  before.releasedThrough.every(id => after.releasedThrough.includes(id)) and
  before.imports.every(i => (i.phase == Released or i.phase == Refused) implies after.imports.includes(i))
pure def sometimesReleased(s: Imports): bool = s.imports.some(i => i.phase == Released and i.held > 0)
pure def sometimesSecondImportStillHeld(s: Imports): bool = s.releasedThrough.length() > 0 and s.imports.some(i => held(s, i.id))
pure def sometimesInvalidated(s: Imports): bool = s.imports.some(i => i.phase == Assessed and i.assessed > 0 and not(i.duplicateChecked))
pure def sometimesRefused(s: Imports): bool = s.imports.some(i => i.phase == Refused)
```

### Simulation samples bound the import identities

```quint
pure val idValues = Set(1, 2)
pure val sourcesValues = Set(2)
pure val cValues = Set({ assessed: 1, held: 1, coverageComplete: true }, { assessed: 2, held: 0, coverageComplete: true },
  { assessed: 1, held: 0, coverageComplete: true }, { assessed: 2, held: 0, coverageComplete: false })
pure val rValues = Set({ changesDigest: "c", journalDigest: "j1", duplicateChecked: true, fundedChecked: true },
  { changesDigest: "c", journalDigest: "j1", duplicateChecked: false, fundedChecked: true })
pure val currentJournalValues = Set("j1", "j2")
```
