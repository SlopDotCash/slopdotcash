lemma lawAdmissionNeverPassesTheCap_ensures(cap: int, rows: seq<MonthItem>, entry: MonthItem)
  ensures (lawAdmissionNeverPassesTheCap(cap, rows, entry) == true)
{
  if monthUsed(rows, entry) <= cap && !(entry in rows) && admitsItemUnder(cap, rows, entry) {
    ProofLib.FilterAppend((row: MonthItem) => sameMonth(row, entry), rows, entry);
  }
}

lemma lawOtherRepositoriesAndMonthsAreUnaffected_ensures(rows: seq<MonthItem>, entry: MonthItem, other: MonthItem)
  ensures (lawOtherRepositoriesAndMonthsAreUnaffected(rows, entry, other) == true)
{
  if !sameMonth(other, entry) && !(entry in rows) && admitsItem(rows, entry) {
    ProofLib.FilterAppend((row: MonthItem) => sameMonth(row, other), rows, entry);
  }
}
