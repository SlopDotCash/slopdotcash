// spec/points/quotaRecovery.md, "Only trusted production runs can restore the original campaign"
// Each census part ends at the first UTC month start after its beginning, or at the cutoff, and parts follow one another.

lemma censusPartEndsInItsMonth(from: int, end: int)
  requires 0 <= from && from < end
  ensures from < (if nextMonthStart(from) < end then nextMonthStart(from) else end)
  ensures (if nextMonthStart(from) < end then nextMonthStart(from) else end) - 2678400000 <= from
{
  assert nextMonthStart(from) > from;
}
