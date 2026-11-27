lemma HoursFilterBridge(l: RateLedger)
  ensures alwaysOneReadingPerHour(l) == !((exists h :: h in l.sampledHours && !(((|ProofLib.Filter((x: int) => (x == h), l.sampledHours)| == 1) && (h <= quotient_fees__submissionFeeRate(l.clock, hourMs))))))
{
}

lemma RatesFilterBridge(l: RateLedger)
  ensures alwaysRatesHaveReadingsAndWaitForTheirHour(l) == (((l.clock >= 0) && !((exists r :: r in l.rates && !((((((((!r.change.KeepRate?) && readingsBehind(r.change, r.window)) && (r.effectiveAt > r.createdAt)) && ((r.effectiveAt - r.createdAt) <= hourMs)) && (remainder_fees__submissionFeeRate(r.effectiveAt, hourMs) == 0)) && (r.createdAt <= l.clock)) && (|ProofLib.Filter((x: RateRow) => (x.effectiveAt == r.effectiveAt), l.rates)| == 1)))))) && (!((|l.rates| > 0)) || (|l.sampledHours| > 0)))
{
}

lemma storeReading_ensures(l: RateLedger, by_: fees__runtime_Sender)
  ensures (inv(l) ==> canStoreReading(l, by_) ==> alwaysOneReadingPerHour(storeReading(l, by_)))
  ensures (inv(l) ==> canStoreReading(l, by_) ==> alwaysRatesHaveReadingsAndWaitForTheirHour(storeReading(l, by_)))
  ensures (inv(l) ==> canStoreReading(l, by_) ==> stepOffStoresNothing(l, storeReading(l, by_)))
{
  if inv(l) && canStoreReading(l, by_) {
    var after := storeReading(l, by_);
    var hr := quotient_fees__submissionFeeRate(l.clock, hourMs);
    HoursFilterBridge(l);
    HoursFilterBridge(after);
    forall h | h in after.sampledHours
      ensures |ProofLib.Filter((x: int) => (x == h), after.sampledHours)| == 1 && h <= hr
    {
      ProofLib.FilterAppend((x: int) => (x == h), l.sampledHours, hr);
      if h == hr {
        ProofLib.FilterNone((x: int) => (x == h), l.sampledHours);
      } else {
        assert h in l.sampledHours;
      }
    }
  }
}

lemma setRate_ensures(l: RateLedger, window: RateWindow, by_: fees__runtime_Sender)
  ensures (inv(l) ==> canSetRate(l, window, by_) ==> alwaysOneReadingPerHour(setRate(l, window, by_)))
  ensures (inv(l) ==> canSetRate(l, window, by_) ==> alwaysRatesHaveReadingsAndWaitForTheirHour(setRate(l, window, by_)))
  ensures (inv(l) ==> canSetRate(l, window, by_) ==> stepOffStoresNothing(l, setRate(l, window, by_)))
{
  if inv(l) && canSetRate(l, window, by_) {
    var after := setRate(l, window, by_);
    var row := RateRow(nextHourStart(l.clock), l.clock, nextRate((|l.rates| > 0), ageOf(l), window), window);
    assert after.rates == l.rates + [row];
    RatesFilterBridge(l);
    RatesFilterBridge(after);
    lawNextHourIsLater_ensures(l.clock);
    lawNoRateWithoutReadings_ensures((|l.rates| > 0), ageOf(l), window);
    forall r | r in after.rates
      ensures (!r.change.KeepRate?) && readingsBehind(r.change, r.window) && (r.effectiveAt > r.createdAt) && ((r.effectiveAt - r.createdAt) <= hourMs) && (remainder_fees__submissionFeeRate(r.effectiveAt, hourMs) == 0) && (r.createdAt <= after.clock) && (|ProofLib.Filter((x: RateRow) => (x.effectiveAt == r.effectiveAt), after.rates)| == 1)
    {
      ProofLib.FilterAppend((x: RateRow) => (x.effectiveAt == r.effectiveAt), l.rates, row);
      if r == row {
        ProofLib.FilterNone((x: RateRow) => (x.effectiveAt == r.effectiveAt), l.rates);
      } else {
        assert r in l.rates;
        assert r.effectiveAt != row.effectiveAt;
      }
    }
  }
}
