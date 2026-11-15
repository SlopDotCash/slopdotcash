// Two-request consumption unfolds the fold twice; weights are filtered, positive entries.
lemma lawEarlierRequestConsumesFirst_ensures(credit: int, first: int, second: int)
  ensures (lawEarlierRequestConsumesFirst(credit, first, second) == true)
{
  ConsumeTwo(credit, first, second);
}

lemma lawZeroBalanceSpendsNothing_ensures(first: int, second: int)
  ensures (lawZeroBalanceSpendsNothing(first, second) == true)
{
  ConsumeTwo(0, first, second);
}

lemma lawEnoughCreditAppliesAll_ensures(credit: int, first: int, second: int)
  ensures (lawEnoughCreditAppliesAll(credit, first, second) == true)
{
  ConsumeTwo(credit, first, second);
}

lemma lawTwoRequestsBounded_ensures(credit: int, first: int, second: int)
  ensures (lawTwoRequestsBounded(credit, first, second) == true)
{
  ConsumeTwo(credit, first, second);
  var applied := consume(credit, [first, second]);
  assert applied == [applied[0], applied[1]];
  TotalTwo(applied[0], applied[1]);
}

lemma ConsumeTwo(credit: int, first: int, second: int)
  ensures consume(credit, [first, second]) ==
    [takeFrom(if credit > 0 then credit else 0, first),
     takeFrom((if credit > 0 then credit else 0) - takeFrom(if credit > 0 then credit else 0, first), second)]
{
  var f := (acc: Consumption, request: int) => consumeStep(acc, request);
  var z := Consumption((if (credit > 0) then credit else 0), []);
  assert [first, second][1..] == [second];
  assert [second][1..] == [];
  calc {
    Std.Collections.Seq.FoldLeft(f, z, [first, second]);
    Std.Collections.Seq.FoldLeft(f, f(z, first), [second]);
    Std.Collections.Seq.FoldLeft(f, f(f(z, first), second), []);
    f(f(z, first), second);
  }
}

lemma TotalTwo(a: int, b: int)
  ensures total([a, b]) == a + b
{
  var f := (acc: int, x: int) => (acc + x);
  assert [a, b][1..] == [b];
  assert [b][1..] == [];
  calc {
    Std.Collections.Seq.FoldLeft(f, 0, [a, b]);
    Std.Collections.Seq.FoldLeft(f, f(0, a), [b]);
    Std.Collections.Seq.FoldLeft(f, f(f(0, a), b), []);
    f(f(0, a), b);
  }
}

lemma lawJournalDebitMatchesConsumption_ensures(credit: int, first: int, second: int)
  ensures (lawJournalDebitMatchesConsumption(credit, first, second) == true)
{
  if first >= 0 && second >= 0 {
    ConsumeTwo(credit, first, second);
    var applied := consume(credit, [first, second]);
    assert applied == [applied[0], applied[1]];
    TotalTwo(applied[0], applied[1]);
  }
}

lemma WeightsFromMeaning(period: int, entries: seq<Entry>, exclusions: seq<Exclusion>)
  ensures weightsFrom(period, entries, exclusions) == (var s_map := ProofLib.Filter((e: Entry) => counted(period, exclusions, e), entries); seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var e := s_map[i_map]; PointWeight(e.actor, netWeight(e))))
{
}

lemma WeightsFromPositive(period: int, entries: seq<Entry>, exclusions: seq<Exclusion>)
  ensures forall w :: w in weightsFrom(period, entries, exclusions) ==> w.actor > 0 && w.weight > 0
{
  WeightsFromMeaning(period, entries, exclusions);
  var kept := ProofLib.Filter((e: Entry) => counted(period, exclusions, e), entries);
  var ws := weightsFrom(period, entries, exclusions);
  assert |ws| == |kept|;
  forall w | w in ws
    ensures w.actor > 0 && w.weight > 0
  {
    var i :| 0 <= i < |ws| && ws[i] == w;
    assert ws[i] == PointWeight(kept[i].actor, netWeight(kept[i]));
    assert kept[i] in kept;
    ProofLib.FilterMember((e: Entry) => counted(period, exclusions, e), entries, kept[i]);
  }
}

lemma LiveWeightsPositive(s: MonthlyWeights)
  requires s.phase.Fixed? ==> (forall w :: w in s.snapshot ==> w.actor > 0 && w.weight > 0)
  ensures alwaysWeightsPositive(s)
{
  if !s.phase.Fixed? {
    WeightsFromPositive(s.period, s.entries, s.exclusions);
  }
}

lemma appendExclusion_ensures(s: MonthlyWeights, x: Exclusion)
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> alwaysWeightsPositive(appendExclusion(s, x)))
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> alwaysNovemberListsEmpty(appendExclusion(s, x)))
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> stepFixedWeightsStable(s, appendExclusion(s, x)))
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> stepIdentityStable(s, appendExclusion(s, x)))
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> stepExclusionsProspective(s, appendExclusion(s, x)))
{
  if inv(s) && canAppendExclusion(s, x) {
    LiveWeightsPositive(appendExclusion(s, x));
  }
}

lemma endExclusion_ensures(s: MonthlyWeights, x: Exclusion, untilPeriod: int)
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> alwaysWeightsPositive(endExclusion(s, x, untilPeriod)))
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> alwaysNovemberListsEmpty(endExclusion(s, x, untilPeriod)))
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> stepFixedWeightsStable(s, endExclusion(s, x, untilPeriod)))
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> stepIdentityStable(s, endExclusion(s, x, untilPeriod)))
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> stepExclusionsProspective(s, endExclusion(s, x, untilPeriod)))
{
  if inv(s) && canEndExclusion(s, x, untilPeriod) {
    var after := endExclusion(s, x, untilPeriod);
    LiveWeightsPositive(after);
    var xs := s.exclusions;
    var ys := after.exclusions;
    assert |ys| == |xs|;
    forall y | y in ys
      ensures novemberAllowed(s.project, y)
    {
      var i :| 0 <= i < |ys| && ys[i] == y;
      assert xs[i] in xs;
    }
    if s.period <= s.openPeriod {
      forall e | e in after.entries
        ensures excluded(s.exclusions, s.period, e.actor) == excluded(after.exclusions, after.period, e.actor)
      {
        EndKeepsCoverage(s, x, untilPeriod, e.actor);
      }
    }
  }
}

lemma EndKeepsCoverage(s: MonthlyWeights, x: Exclusion, untilPeriod: int, actor: int)
  requires s.period <= s.openPeriod && untilPeriod > s.openPeriod
  requires x.untilPeriod == 0 || x.untilPeriod > s.openPeriod
  ensures excluded(s.exclusions, s.period, actor) == excluded(endExclusion(s, x, untilPeriod).exclusions, s.period, actor)
{
  var xs := s.exclusions;
  var ys := endExclusion(s, x, untilPeriod).exclusions;
  assert |ys| == |xs|;
  assert forall i :: 0 <= i < |xs| ==> ys[i].actor == xs[i].actor && covers(ys[i], s.period) == covers(xs[i], s.period);
  if excluded(xs, s.period, actor) {
    var o :| o in xs && o.actor == actor && covers(o, s.period);
    var i :| 0 <= i < |xs| && xs[i] == o;
    assert ys[i] in ys;
  }
  if excluded(ys, s.period, actor) {
    var o :| o in ys && o.actor == actor && covers(o, s.period);
    var i :| 0 <= i < |ys| && ys[i] == o;
    assert xs[i] in xs;
  }
}

lemma observeBan_ensures(s: MonthlyWeights, actor: int)
  ensures (inv(s) ==> canObserveBan(s, actor) ==> alwaysWeightsPositive(observeBan(s, actor)))
  ensures (inv(s) ==> canObserveBan(s, actor) ==> stepFixedWeightsStable(s, observeBan(s, actor)))
  ensures (inv(s) ==> canObserveBan(s, actor) ==> stepIdentityStable(s, observeBan(s, actor)))
  ensures (inv(s) ==> canObserveBan(s, actor) ==> stepExclusionsProspective(s, observeBan(s, actor)))
{
  if inv(s) && canObserveBan(s, actor) {
    LiveWeightsPositive(observeBan(s, actor));
  }
}

lemma observe_ensures(s: MonthlyWeights, l: points__journal_Ledger)
  ensures (inv(s) ==> canObserve(s, l) ==> alwaysWeightsPositive(observe(s, l)))
  ensures (inv(s) ==> canObserve(s, l) ==> stepFixedWeightsStable(s, observe(s, l)))
  ensures (inv(s) ==> canObserve(s, l) ==> stepIdentityStable(s, observe(s, l)))
{
  if inv(s) && canObserve(s, l) {
    LiveWeightsPositive(observe(s, l));
  }
}
