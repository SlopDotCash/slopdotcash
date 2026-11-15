lemma WeightMember(s: WorkSnapshot, exclusions: seq<Exclusion>, w: settlement__allocation_Weight)
  ensures w in rewardWeights(s, exclusions) <==> exists r :: r in s.rows && settlement__money_validAmount(r.acceptedWork)
    && settlement__money_positiveAmount(r.acceptedWork) && !excludedIn(exclusions, r.actor, s.period)
    && w == settlement__allocation_Weight(r.actor, r.acceptedWork)
{
  var p := (r: WorkRow) => ((settlement__money_validAmount(r.acceptedWork) && settlement__money_positiveAmount(r.acceptedWork)) && !(excludedIn(exclusions, r.actor, s.period)));
  var f := ProofLib.Filter(p, s.rows);
  assert rewardWeights(s, exclusions) == seq(|f|, i requires 0 <= i < |f| => settlement__allocation_Weight(f[i].actor, f[i].acceptedWork));
  if w in rewardWeights(s, exclusions) {
    var i :| 0 <= i < |f| && rewardWeights(s, exclusions)[i] == w;
    ProofLib.FilterMember(p, s.rows, f[i]);
  }
  forall r | r in s.rows && p(r) ensures settlement__allocation_Weight(r.actor, r.acceptedWork) in rewardWeights(s, exclusions) {
    ProofLib.FilterMember(p, s.rows, r);
    var j :| 0 <= j < |f| && f[j] == r;
    assert rewardWeights(s, exclusions)[j] == settlement__allocation_Weight(r.actor, r.acceptedWork);
  }
}

lemma lawWeightsPositive_ensures(s: WorkSnapshot, exclusions: seq<Exclusion>)
  ensures (lawWeightsPositive(s, exclusions) == true)
{
  forall w | w in rewardWeights(s, exclusions) ensures settlement__money_validAmount(w.weight) && settlement__money_positiveAmount(w.weight) {
    WeightMember(s, exclusions, w);
  }
}

lemma ExcludedAppend(exclusions: seq<Exclusion>, e: Exclusion, actor: int, period: int)
  ensures excludedIn(exclusions + [e], actor, period) == (excludedIn(exclusions, actor, period) || (e.actor == actor && covers(e, period)))
{
  if excludedIn(exclusions + [e], actor, period) {
    var x :| x in exclusions + [e] && x.actor == actor && covers(x, period);
    if x != e { assert x in exclusions; }
  }
  if excludedIn(exclusions, actor, period) {
    var x :| x in exclusions && x.actor == actor && covers(x, period);
    assert x in exclusions + [e];
  }
  if e.actor == actor && covers(e, period) {
    assert e in exclusions + [e];
  }
}

lemma lawExclusionKeepsOthers_ensures(s: WorkSnapshot, exclusions: seq<Exclusion>, e: Exclusion)
  ensures (lawExclusionKeepsOthers(s, exclusions, e) == true)
{
  forall w | w in rewardWeights(s, exclusions) && !(covers(e, s.period) && w.actor == e.actor)
    ensures w in rewardWeights(s, exclusions + [e])
  {
    WeightMember(s, exclusions, w);
    var r :| r in s.rows && settlement__money_validAmount(r.acceptedWork) && settlement__money_positiveAmount(r.acceptedWork)
      && !excludedIn(exclusions, r.actor, s.period) && w == settlement__allocation_Weight(r.actor, r.acceptedWork);
    ExcludedAppend(exclusions, e, r.actor, s.period);
    WeightMember(s, exclusions + [e], w);
  }
}

lemma lawExclusionOnlyRemoves_ensures(s: WorkSnapshot, exclusions: seq<Exclusion>, e: Exclusion)
  ensures (lawExclusionOnlyRemoves(s, exclusions, e) == true)
{
  forall w | w in rewardWeights(s, exclusions + [e])
    ensures w in rewardWeights(s, exclusions) && !(covers(e, s.period) && w.actor == e.actor)
  {
    WeightMember(s, exclusions + [e], w);
    var r :| r in s.rows && settlement__money_validAmount(r.acceptedWork) && settlement__money_positiveAmount(r.acceptedWork)
      && !excludedIn(exclusions + [e], r.actor, s.period) && w == settlement__allocation_Weight(r.actor, r.acceptedWork);
    ExcludedAppend(exclusions, e, r.actor, s.period);
    WeightMember(s, exclusions, w);
  }
}

lemma lawParticipationNeverWeights_ensures(s: WorkSnapshot, exclusions: seq<Exclusion>, participation: int, recognition: int)
  ensures (lawParticipationNeverWeights(s, exclusions, participation, recognition) == true)
{
  var mapped := seq(|s.rows|, i requires 0 <= i < |s.rows| => withSideCategories(s.rows[i], participation, recognition));
  var t := s.(rows := mapped);
  var p := (r: WorkRow) => ((settlement__money_validAmount(r.acceptedWork) && settlement__money_positiveAmount(r.acceptedWork)) && !(excludedIn(exclusions, r.actor, s.period)));
  var q := (r: WorkRow) => ((settlement__money_validAmount(r.acceptedWork) && settlement__money_positiveAmount(r.acceptedWork)) && !(excludedIn(exclusions, r.actor, t.period)));
  var same := (x: WorkRow, y: WorkRow) => x.actor == y.actor && x.acceptedWork == y.acceptedWork;
  ProofLib.FilterPointwise(q, p, same, mapped, s.rows);
  var f1 := ProofLib.Filter(q, mapped);
  var f2 := ProofLib.Filter(p, s.rows);
  assert rewardWeights(t, exclusions) == seq(|f1|, i requires 0 <= i < |f1| => settlement__allocation_Weight(f1[i].actor, f1[i].acceptedWork));
  assert rewardWeights(s, exclusions) == seq(|f2|, i requires 0 <= i < |f2| => settlement__allocation_Weight(f2[i].actor, f2[i].acceptedWork));
  assert rewardWeights(t, exclusions) == rewardWeights(s, exclusions);
}
