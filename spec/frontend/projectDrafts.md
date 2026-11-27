# Project setup and manifest drafts

PRD section 4. Project setup keeps its unfinished draft in this browser so a
reload, a GitHub round trip or a closed tab does not lose it, and two tabs never
overwrite each other's draft. An administrator's manifest edit keeps its draft
until the edit is accepted or discarded. Neither draft is private report text
(see [private report drafts](./drafts.md)).

## Story: Keep a project setup draft per browser document

> As someone adding a project, I want my unfinished setup to be there when I
> come back, and a duplicated tab to start from a copy rather than share and
> overwrite mine.

### A project setup draft belongs to one live document slot that a duplicated tab cannot take

Owner decision frontend-lib:OD1 is pending. The production behaviour is the
default: the draft belongs to the browser document, not to an account, and
survives sign-out; the referrer captured from a referral link
(`slop:project-referrer:v1`) is kept until the project is created. The
alternative binds the draft to the signed-in account and erases it at sign-out
like a private report draft.

Each saved draft is a slot `slop:project-draft:v3:<key>:slot:<id>` in local
storage holding `{ revision, value }`. A document holds one slot under an
exclusive Web Lock of that slot's name for the document's whole lifetime;
closing the browser document releases it, and a closed slot can be resumed.
Session storage keeps the document's pointer (`…:tab`, or "empty" after the
draft was cleared). One short lock (`…:write`) serialises selection and every
write. Opening reads the pointed slot, or with no pointer the newest saved
slot; it resumes that slot when its lock is free, and otherwise forks: it takes
a fresh slot and, when there is a value to keep, writes it there first. A
duplicated tab copies the pointer but cannot take the original's lock, so it
forks a copy.

```quint
type Pointer = NoPointer | EmptyPointer | SlotPointer({ slot: int })
type SetupSlot = { slot: int, revision: int, value: int, holder: int }
type SetupStore = { slots: List[SetupSlot], nextSlot: int, imported: bool, legacy: int, memory: List[int], lastSaved: int }
pure val initial: SetupStore = { slots: List(), nextSlot: 1, imported: false, legacy: 0, memory: List(), lastSaved: 0 }
pure val noSlot: SetupSlot = { slot: 0, revision: 0, value: 0, holder: 0 }
pure def tabOpen(s: SetupStore, tab: int): bool = s.slots.some(x => x.holder == tab) or s.memory.includes(tab)
pure def newestRevision(s: SetupStore): int = s.slots.foldl(0, (highest, x) => if (x.revision > highest) x.revision else highest)
pure def newestRecord(s: SetupStore): SetupSlot =
  s.slots.foldl(noSlot, (best, x) => if (x.value > 0 and x.revision > best.revision) x else best)
pure def sourceFor(s: SetupStore, pointer: Pointer): SetupSlot = match pointer {
  | SlotPointer(p) => s.slots.select(x => x.slot == p.slot and x.value > 0).nthOr(0, noSlot)
  | NoPointer => newestRecord(s)
  | _ => noSlot
}
pure def openingValue(source: SetupSlot, pointer: Pointer, imported: bool, legacy: int): int =
  if (source.value > 0) source.value else if (pointer == NoPointer and not(imported)) legacy else 0
pure def resumed(tab: int, s: SetupStore, source: SetupSlot): SetupStore =
  { ...s, slots: s.slots.listMap(x => if (x.slot == source.slot) { ...x, holder: tab } else x) }
pure def forked(tab: int, s: SetupStore, value: int): SetupStore =
  if (value > 0) { ...s, slots: s.slots.append({ slot: s.nextSlot, revision: newestRevision(s) + 1, value: value, holder: tab }),
    nextSlot: s.nextSlot + 1, imported: true, lastSaved: newestRevision(s) + 1 }
  else { ...s, slots: s.slots.append({ slot: s.nextSlot, revision: 0, value: 0, holder: tab }), nextSlot: s.nextSlot + 1 }
pure def canOpenDraft(s: SetupStore, tab: int): bool = tab > 0 and not(tabOpen(s, tab))
pure def openDraft(s: SetupStore, tab: int, pointer: Pointer, storageUsable: bool): SetupStore =
  val source = sourceFor(s, pointer)
  if (not(storageUsable)) { ...s, memory: s.memory.append(tab) }
  else if (source.slot > 0 and source.holder == 0) resumed(tab, s, source)
  else forked(tab, s, openingValue(source, pointer, s.imported, s.legacy))
pure def canCloseTab(s: SetupStore, tab: int): bool = tab > 0 and tabOpen(s, tab)
pure def closeTab(s: SetupStore, tab: int): SetupStore =
  { ...s, slots: s.slots.listMap(x => if (x.holder == tab) { ...x, holder: 0 } else x),
    memory: s.memory.select(d => d != tab) }
pure def alwaysOneDocumentPerSlot(s: SetupStore): bool = s.nextSlot > 0 and s.lastSaved >= 0 and
  s.slots.every(a => a.slot > 0 and a.slot < s.nextSlot and a.revision >= 0 and a.revision <= s.lastSaved and
    a.holder >= 0 and (a.value > 0 iff a.revision > 0) and
    s.slots.every(b => (a.slot == b.slot implies a == b) and
      ((a.holder > 0 and a.holder == b.holder) implies a.slot == b.slot) and
      ((a.revision > 0 and a.revision == b.revision) implies a.slot == b.slot))) and
  s.memory.every(d => d > 0 and not(s.slots.some(x => x.holder == d)))
pure def sometimesDuplicateTabForked(s: SetupStore): bool =
  s.slots.some(a => s.slots.some(b => a.slot != b.slot and a.holder > 0 and b.holder > 0 and a.value > 0 and a.value == b.value))
pure def sometimesClosedSlotResumed(s: SetupStore): bool = s.nextSlot == 2 and s.slots.some(x => x.holder == 2 and x.value > 0)
pure val tabValues = Set(1, 2)
pure val pointerValues = Set(NoPointer, EmptyPointer, SlotPointer({ slot: 1 }), SlotPointer({ slot: 2 }))
```

### Each saved setup draft has a strictly greater revision than the record it replaces

Every write of a non-empty draft, and every fork that copies one, takes the
next revision above every saved slot's, under the write lock; revisions
never depend on wall-clock order. Clearing the draft removes the slot's record
and points the tab at "empty". The form shows Saving until the store
answers and a failure when the write did not land; a draft value changed and
changed back is pending again.

```quint
pure def canSaveDraft(s: SetupStore, tab: int, draftValue: int): bool =
  tab > 0 and draftValue >= 0 and s.slots.some(x => x.holder == tab)
pure def saveDraft(s: SetupStore, tab: int, draftValue: int, storageWritable: bool): SetupStore =
  if (not(storageWritable)) s
  else if (draftValue == 0) { ...s, slots: s.slots.listMap(x => if (x.holder == tab) { ...x, revision: 0, value: 0 } else x), imported: true }
  else { ...s, slots: s.slots.listMap(x => if (x.holder == tab) { ...x, revision: newestRevision(s) + 1, value: draftValue } else x),
    imported: true, lastSaved: newestRevision(s) + 1 }
pure def stepSaveIsNewerThanEveryRecord(before: SetupStore, after: SetupStore): bool =
  after.lastSaved != before.lastSaved implies before.slots.every(x => x.revision < after.lastSaved)
pure def sometimesSavedTwice(s: SetupStore): bool = s.lastSaved > 1
pure val draftValueValues = Set(0, 1, 2)
```

### The legacy setup draft is imported once and the store falls back to memory when storage or locks are unavailable

The draft an older version kept under `slop:project-proposal:v1` seeds only a
tab that has no pointer, and only until the first slot write records the
import (`…:imported`); the legacy bytes are never deleted, because an old tab
may still own them. When storage or Web Locks are unavailable the draft lives
in that tab's memory only, starting from the legacy draft, and every save
reports that it was not stored.

```quint
pure def canObserveLegacy(s: SetupStore, legacyDraft: int): bool = legacyDraft > 0
pure def observeLegacy(s: SetupStore, legacyDraft: int): SetupStore = { ...s, legacy: legacyDraft }
pure def stepImportIsMonotonic(before: SetupStore, after: SetupStore): bool = before.imported implies after.imported
pure def lawImportedLegacyIsNotReused(source: SetupSlot, pointer: Pointer, legacy: int): bool =
  source.value == 0 implies openingValue(source, pointer, true, legacy) == 0
pure def lawPointerSkipsLegacy(source: SetupSlot, legacy: int): bool =
  openingValue(source, EmptyPointer, false, legacy) == (if (source.value > 0) source.value else 0)
pure def sometimesMemoryOnly(s: SetupStore): bool = s.memory.length() > 0
pure def sometimesLegacyImported(s: SetupStore): bool = s.imported and s.legacy > 0 and s.slots.some(x => x.value == s.legacy)
pure val legacyDraftValues = Set(1, 2)
pure val sourceValues = Set(noSlot, { slot: 1, revision: 1, value: 2, holder: 0 })
pure val legacyValues = Set(0, 1)
```

## Story: Keep an administrator's manifest edit until it is accepted

> As an administrator editing a project's manifest, I want my edit kept in
> this tab until the server accepts exactly what I sent, or I discard it.

### An administrator's manifest draft is cleared only after its exact submitted text was accepted or on discard

The draft lives in session storage under
`slop:admin-project:<project>:<revision>`, so a new manifest revision starts a
new draft. Every edit saves it, and a failed save is shown. After the server
accepts the submitted manifest, the stored draft is removed only if it is still
exactly the submitted text; an edit made while the request was in flight is
kept. A refused or unanswered submission keeps it. "Close and keep draft"
leaves it; discarding removes it, and a failed removal keeps the editor open
with an error.

```quint
type ManifestOutcome = ManifestAccepted | ManifestRefused | ManifestUnanswered
pure def keptManifestDraft(storedDraft: int, submittedDraft: int, manifestOutcome: ManifestOutcome, discarded: bool): int =
  if (discarded) 0 else if (manifestOutcome == ManifestAccepted and storedDraft == submittedDraft) 0 else storedDraft
pure def lawLaterEditSurvivesAcceptance(storedDraft: int, submittedDraft: int): bool =
  storedDraft != submittedDraft implies keptManifestDraft(storedDraft, submittedDraft, ManifestAccepted, false) == storedDraft
pure def lawOnlyAcceptanceOrDiscardClears(storedDraft: int, submittedDraft: int, manifestOutcome: ManifestOutcome): bool =
  manifestOutcome != ManifestAccepted implies keptManifestDraft(storedDraft, submittedDraft, manifestOutcome, false) == storedDraft
pure def lawDiscardClears(storedDraft: int, submittedDraft: int, manifestOutcome: ManifestOutcome): bool =
  keptManifestDraft(storedDraft, submittedDraft, manifestOutcome, true) == 0
pure val storedDraftValues = Set(1, 2)
pure val submittedDraftValues = Set(1, 2)
```
