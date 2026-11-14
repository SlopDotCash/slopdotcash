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

lemma WeightsFromMeaning(project: string, period: int, entries: seq<Entry>, exclusions: seq<Exclusion>, banned: seq<int>)
  ensures weightsFrom(project, period, entries, exclusions, banned) == (var s_map := ProofLib.Filter((e: Entry) => counted(project, period, exclusions, banned, e), entries); seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var e := s_map[i_map]; PointWeight(e.actor, netWeight(e))))
{
}

lemma WeightsFromPositive(project: string, period: int, entries: seq<Entry>, exclusions: seq<Exclusion>, banned: seq<int>)
  requires forall e :: e in entries ==> e.actor > 0
  ensures forall w :: w in weightsFrom(project, period, entries, exclusions, banned) ==> w.actor > 0 && w.weight > 0
{
  WeightsFromMeaning(project, period, entries, exclusions, banned);
  var kept := ProofLib.Filter((e: Entry) => counted(project, period, exclusions, banned, e), entries);
  var ws := weightsFrom(project, period, entries, exclusions, banned);
  assert |ws| == |kept|;
  forall w | w in ws
    ensures w.actor > 0 && w.weight > 0
  {
    var i :| 0 <= i < |ws| && ws[i] == w;
    assert ws[i] == PointWeight(kept[i].actor, netWeight(kept[i]));
    assert kept[i] in kept;
    ProofLib.FilterMember((e: Entry) => counted(project, period, exclusions, banned, e), entries, kept[i]);
  }
}

lemma LiveWeightsPositive(s: MonthlyWeights)
  requires forall e :: e in s.entries ==> e.actor > 0
  requires s.phase.Fixed? ==> (forall w :: w in s.snapshot ==> w.actor > 0 && w.weight > 0)
  ensures alwaysWeightsPositive(s)
{
  if !s.phase.Fixed? {
    WeightsFromPositive(s.project, s.period, s.entries, s.exclusions, s.banned);
  }
}

lemma appendExclusion_ensures(s: MonthlyWeights, x: Exclusion)
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> alwaysEntryActorsPositive(appendExclusion(s, x)))
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> alwaysWeightsPositive(appendExclusion(s, x)))
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> stepFixedWeightsStable(s, appendExclusion(s, x)))
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> stepIdentityStable(s, appendExclusion(s, x)))
  ensures (inv(s) ==> canAppendExclusion(s, x) ==> stepExclusionsProspective(s, appendExclusion(s, x)))
{
  if inv(s) && canAppendExclusion(s, x) {
    LiveWeightsPositive(appendExclusion(s, x));
  }
}

lemma endExclusion_ensures(s: MonthlyWeights, x: Exclusion, untilPeriod: int)
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> alwaysEntryActorsPositive(endExclusion(s, x, untilPeriod)))
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> alwaysWeightsPositive(endExclusion(s, x, untilPeriod)))
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> stepFixedWeightsStable(s, endExclusion(s, x, untilPeriod)))
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> stepIdentityStable(s, endExclusion(s, x, untilPeriod)))
  ensures (inv(s) ==> canEndExclusion(s, x, untilPeriod) ==> stepExclusionsProspective(s, endExclusion(s, x, untilPeriod)))
{
  if inv(s) && canEndExclusion(s, x, untilPeriod) {
    var after := endExclusion(s, x, untilPeriod);
    LiveWeightsPositive(after);
    if s.period <= s.openPeriod {
      forall e | e in after.entries
        ensures excluded(s.project, s.period, s.exclusions, e.actor) == excluded(after.project, after.period, after.exclusions, e.actor)
      {
        EndKeepsCoverage(s, x, untilPeriod, e.actor);
      }
    }
  }
}

lemma EndKeepsCoverage(s: MonthlyWeights, x: Exclusion, untilPeriod: int, actor: int)
  requires s.period <= s.openPeriod && untilPeriod > s.openPeriod
  requires x.untilPeriod == 0 || x.untilPeriod > s.openPeriod
  ensures excluded(s.project, s.period, s.exclusions, actor) == excluded(s.project, s.period, endExclusion(s, x, untilPeriod).exclusions, actor)
{
  var xs := s.exclusions;
  var ys := endExclusion(s, x, untilPeriod).exclusions;
  assert |ys| == |xs|;
  assert forall i :: 0 <= i < |xs| ==> ys[i].actor == xs[i].actor && covers(ys[i], s.period) == covers(xs[i], s.period);
  if !((s.period == points__journal_november2026) && (s.project in novemberEmptyProjects)) {
    if excluded(s.project, s.period, xs, actor) {
      var o :| o in xs && o.actor == actor && covers(o, s.period);
      var i :| 0 <= i < |xs| && xs[i] == o;
      assert ys[i] in ys;
    }
    if excluded(s.project, s.period, ys, actor) {
      var o :| o in ys && o.actor == actor && covers(o, s.period);
      var i :| 0 <= i < |ys| && ys[i] == o;
      assert xs[i] in xs;
    }
  }
}

lemma observeBan_ensures(s: MonthlyWeights, actor: int)
  ensures (inv(s) ==> canObserveBan(s, actor) ==> alwaysEntryActorsPositive(observeBan(s, actor)))
  ensures (inv(s) ==> canObserveBan(s, actor) ==> alwaysWeightsPositive(observeBan(s, actor)))
  ensures (inv(s) ==> canObserveBan(s, actor) ==> stepFixedWeightsStable(s, observeBan(s, actor)))
  ensures (inv(s) ==> canObserveBan(s, actor) ==> stepIdentityStable(s, observeBan(s, actor)))
  ensures (inv(s) ==> canObserveBan(s, actor) ==> stepExclusionsProspective(s, observeBan(s, actor)))
{
  if inv(s) && canObserveBan(s, actor) {
    LiveWeightsPositive(observeBan(s, actor));
  }
}

lemma observe_ensures(s: MonthlyWeights, l: points__journal_Ledger, actors: seq<int>)
  ensures (inv(s) ==> canObserve(s, l, actors) ==> alwaysEntryActorsPositive(observe(s, l, actors)))
  ensures (inv(s) ==> canObserve(s, l, actors) ==> alwaysWeightsPositive(observe(s, l, actors)))
  ensures (inv(s) ==> canObserve(s, l, actors) ==> stepFixedWeightsStable(s, observe(s, l, actors)))
  ensures (inv(s) ==> canObserve(s, l, actors) ==> stepIdentityStable(s, observe(s, l, actors)))
  ensures (inv(s) ==> canObserve(s, l, actors) ==> stepExclusionsProspective(s, observe(s, l, actors)))
{
  if inv(s) && canObserve(s, l, actors) {
    var after := observe(s, l, actors);
    var es := book(l, s.project, s.period, actors);
    assert |es| == |actors|;
    forall e | e in es
      ensures e.actor > 0
    {
      var i :| 0 <= i < |es| && es[i] == e;
      assert es[i].actor == actors[i];
      assert actors[i] in actors;
    }
    LiveWeightsPositive(after);
  }
}
