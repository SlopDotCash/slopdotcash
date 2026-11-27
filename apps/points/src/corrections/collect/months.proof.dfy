// spec/points/quotaRecovery.md, "Only trusted production runs can restore the original campaign"

lemma monthStartAfter_ensures(at: int, year: int, month: int, start: int)
  requires (0 <= at)
  requires (0 <= year)
  requires (1 <= month)
  requires (month <= 12)
  requires (0 <= start)
  ensures (monthStartAfter(at, year, month, start) > at)
  ensures (monthStartAfter(at, year, month, start) >= start)
  ensures ((start > at) ==> (monthStartAfter(at, year, month, start) == start))
  ensures ((start <= at) ==> ((monthStartAfter(at, year, month, start) - 2678400000) <= at))
{
  if start <= at {
    monthDays_ensures(year, month);
    var next := start + monthDays(year, month) * 86400000;
    if next <= at {
      if month == 12 {
        monthStartAfter_ensures(at, year + 1, 1, next);
      } else {
        monthStartAfter_ensures(at, year, month + 1, next);
      }
    }
  }
}

lemma nextMonthStart_ensures(at: int)
  requires (at >= 0)
  ensures (nextMonthStart(at) > at)
  ensures ((nextMonthStart(at) - 2678400000) <= at)
{
  monthStartAfter_ensures(at, 1970, 1, 0);
}

lemma censusPartEndsInItsMonth(from: int, end: int)
  requires 0 <= from && from < end
  ensures from < (if nextMonthStart(from) < end then nextMonthStart(from) else end)
  ensures (if nextMonthStart(from) < end then nextMonthStart(from) else end) - 2678400000 <= from
{
  nextMonthStart_ensures(from);
}
