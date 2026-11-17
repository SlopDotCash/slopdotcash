// spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
lemma aCycleGeneratedAfterItsIndexIsRefused(row: CycleRow, generatedMs: int)
  requires row.generatedMs > generatedMs
  ensures !rowValid(row, generatedMs)
{
}

lemma aRepeatedProjectCycleIsRefused(row: CycleRow, generatedMs: int)
  requires !row.firstSeen
  ensures !rowValid(row, generatedMs)
{
}

lemma anOutOfOrderCycleIsRefused(row: CycleRow, generatedMs: int)
  requires !row.follows
  ensures !rowValid(row, generatedMs)
{
}
