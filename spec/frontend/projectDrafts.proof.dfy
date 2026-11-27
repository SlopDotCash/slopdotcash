lemma CloseTabMemoryUsesFilter(s: SetupStore, tab: int)
  ensures closeTab(s, tab).memory == ProofLib.Filter((d: int) => (d != tab), s.memory)
{
}

lemma SourceForSlotUsesFilter(s: SetupStore, slotId: int)
  ensures sourceFor(s, Pointer.SlotPointer(slotId)) == (var kept := ProofLib.Filter((x: SetupSlot) => ((x.slot == slotId) && (x.value > 0)), s.slots); if 0 < |kept| then kept[0] else noSlot)
{
}

lemma NewestRecordFromList(acc: SetupSlot, xs: seq<SetupSlot>)
  ensures var res := Std.Collections.Seq.FoldLeft((best: SetupSlot, x: SetupSlot) => (if ((x.value > 0) && (x.revision > best.revision)) then x else best), acc, xs); res == acc || res in xs
  decreases |xs|
{
  if |xs| > 0 {
    var next := if (xs[0].value > 0) && (xs[0].revision > acc.revision) then xs[0] else acc;
    NewestRecordFromList(next, xs[1..]);
  }
}

lemma SourceForMember(s: SetupStore, pointer: Pointer)
  requires sourceFor(s, pointer).slot > 0
  ensures sourceFor(s, pointer) in s.slots
{
  if pointer.SlotPointer? {
    var p := (x: SetupSlot) => ((x.slot == pointer.slot) && (x.value > 0));
    SourceForSlotUsesFilter(s, pointer.slot);
    var kept := ProofLib.Filter(p, s.slots);
    assert 0 < |kept|;
    ProofLib.FilterMember(p, s.slots, kept[0]);
  } else if pointer.NoPointer? {
    NewestRecordFromList(noSlot, s.slots);
  }
}

lemma NewestRevisionBounds(s: SetupStore)
  ensures newestRevision(s) >= 0
  ensures forall x :: x in s.slots ==> x.revision <= newestRevision(s)
{
  var f := (highest: int, x: SetupSlot) => (if (x.revision > highest) then x.revision else highest);
  ProofLib.FoldLeftInflationary(f, 0, s.slots);
  ProofLib.FoldLeftAboveEach(f, (x: SetupSlot) => x.revision, 0, s.slots);
  forall x | x in s.slots
    ensures x.revision <= newestRevision(s)
  {
    var i :| 0 <= i < |s.slots| && s.slots[i] == x;
    assert s.slots[i].revision <= newestRevision(s);
  }
}

lemma closeTab_ensures(s: SetupStore, tab: int)
  ensures (inv(s) ==> canCloseTab(s, tab) ==> alwaysOneDocumentPerSlot(closeTab(s, tab)))
  ensures (inv(s) ==> canCloseTab(s, tab) ==> stepSaveIsNewerThanEveryRecord(s, closeTab(s, tab)))
  ensures (inv(s) ==> canCloseTab(s, tab) ==> stepImportIsMonotonic(s, closeTab(s, tab)))
{
  if inv(s) && canCloseTab(s, tab) {
    var after := closeTab(s, tab);
    var p := (d: int) => (d != tab);
    CloseTabMemoryUsesFilter(s, tab);
    forall d | d in after.memory
      ensures d > 0 && !(exists x :: x in after.slots && x.holder == d)
    {
      ProofLib.FilterMember(p, s.memory, d);
    }
  }
}

lemma openDraft_ensures(s: SetupStore, tab: int, pointer: Pointer, storageUsable: bool)
  ensures (inv(s) ==> canOpenDraft(s, tab) ==> alwaysOneDocumentPerSlot(openDraft(s, tab, pointer, storageUsable)))
  ensures (inv(s) ==> canOpenDraft(s, tab) ==> stepSaveIsNewerThanEveryRecord(s, openDraft(s, tab, pointer, storageUsable)))
  ensures (inv(s) ==> canOpenDraft(s, tab) ==> stepImportIsMonotonic(s, openDraft(s, tab, pointer, storageUsable)))
{
  if inv(s) && canOpenDraft(s, tab) {
    var source := sourceFor(s, pointer);
    if !storageUsable {
    } else if source.slot > 0 && source.holder == 0 {
      SourceForMember(s, pointer);
    } else {
      NewestRevisionBounds(s);
    }
  }
}

lemma saveDraft_ensures(s: SetupStore, tab: int, draftValue: int, storageWritable: bool)
  ensures (inv(s) ==> canSaveDraft(s, tab, draftValue) ==> alwaysOneDocumentPerSlot(saveDraft(s, tab, draftValue, storageWritable)))
  ensures (inv(s) ==> canSaveDraft(s, tab, draftValue) ==> stepSaveIsNewerThanEveryRecord(s, saveDraft(s, tab, draftValue, storageWritable)))
  ensures (inv(s) ==> canSaveDraft(s, tab, draftValue) ==> stepImportIsMonotonic(s, saveDraft(s, tab, draftValue, storageWritable)))
{
  if inv(s) && canSaveDraft(s, tab, draftValue) {
    NewestRevisionBounds(s);
  }
}
