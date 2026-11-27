lemma DraftsKeptUsesFilter(intakeEntries: seq<IntakeEntry>, storedIds: seq<int>)
  ensures keptDraftIds(intakeEntries, storedIds) == ProofLib.Filter((id: int) => (exists e :: e in intakeEntries && ((e.id == id) && draftStillNeeded(e.record))), storedIds)
{
}

lemma DraftsEmptyKept(intakeEntries: seq<IntakeEntry>, storedIds: seq<int>)
  requires |intakeEntries| == 0
  ensures keptDraftIds(intakeEntries, storedIds) == []
{
  var needed := (id: int) => (exists e :: e in intakeEntries && ((e.id == id) && draftStillNeeded(e.record)));
  DraftsKeptUsesFilter(intakeEntries, storedIds);
  ProofLib.FilterNone(needed, storedIds);
}

lemma lawPruningKeepsOnlyNeededText_ensures(intakeEntries: seq<IntakeEntry>, storedIds: seq<int>)
  ensures (lawPruningKeepsOnlyNeededText(intakeEntries, storedIds) == true)
{
  var needed := (id: int) => (exists e :: e in intakeEntries && ((e.id == id) && draftStillNeeded(e.record)));
  DraftsKeptUsesFilter(intakeEntries, storedIds);
  forall id | id in keptDraftIds(intakeEntries, storedIds)
    ensures (id in storedIds) && needed(id)
  {
    ProofLib.FilterMember(needed, storedIds, id);
  }
}

lemma lawSignOutErasesEveryText_ensures(storedIds: seq<int>)
  ensures (lawSignOutErasesEveryText(storedIds) == true)
{
  DraftsEmptyKept([], storedIds);
}
