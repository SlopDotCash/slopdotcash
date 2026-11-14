// Superseded and frozen live units are left in place by every transition.
lemma form_ensures(s: Units, g: GroupEvidence)
  ensures (inv(s) ==> canForm(s, g) ==> alwaysCurrentUnitsDisjoint(form(s, g)))
  ensures (inv(s) ==> canForm(s, g) ==> alwaysNextIdPositive(form(s, g)))
  ensures (inv(s) ==> canForm(s, g) ==> alwaysUnitsWellFormed(form(s, g)))
  ensures (inv(s) ==> canForm(s, g) ==> stepSupersessionFinal(s, form(s, g)))
  ensures (inv(s) ==> canForm(s, g) ==> stepFrozenUnitsKept(s, form(s, g)))
{
  if inv(s) && canForm(s, g) {
    var after := form(s, g);
    assert |after.units| == |s.units| + 1;
    forall u | u in s.units && (u.superseded || (u.frozen && live(u)))
      ensures exists v :: v in after.units && sameUnit(u, v)
    {
      var i :| 0 <= i < |s.units| && s.units[i] == u;
      assert !touches(u, g.sources, g.commits);
      assert after.units[i] == u;
      SameUnitRefl(u);
      assert after.units[i] in after.units;
    }
  }
}

lemma accept_ensures(s: Units, unit: int)
  ensures (inv(s) ==> canAccept(s, unit) ==> alwaysCurrentUnitsDisjoint(accept(s, unit)))
  ensures (inv(s) ==> canAccept(s, unit) ==> alwaysNextIdPositive(accept(s, unit)))
  ensures (inv(s) ==> canAccept(s, unit) ==> alwaysUnitsWellFormed(accept(s, unit)))
  ensures (inv(s) ==> canAccept(s, unit) ==> stepSupersessionFinal(s, accept(s, unit)))
  ensures (inv(s) ==> canAccept(s, unit) ==> stepFrozenUnitsKept(s, accept(s, unit)))
{
  if inv(s) && canAccept(s, unit) {
    var after := accept(s, unit);
    assert |after.units| == |s.units|;
    forall u | u in s.units && (u.superseded || (u.frozen && live(u)))
      ensures exists v :: v in after.units && sameUnit(u, v)
    {
      var i :| 0 <= i < |s.units| && s.units[i] == u;
      assert after.units[i] == u;
      SameUnitRefl(u);
      assert after.units[i] in after.units;
    }
  }
}

lemma freezeUnit_ensures(s: Units, unit: int)
  ensures (inv(s) ==> canFreezeUnit(s, unit) ==> alwaysCurrentUnitsDisjoint(freezeUnit(s, unit)))
  ensures (inv(s) ==> canFreezeUnit(s, unit) ==> alwaysNextIdPositive(freezeUnit(s, unit)))
  ensures (inv(s) ==> canFreezeUnit(s, unit) ==> alwaysUnitsWellFormed(freezeUnit(s, unit)))
  ensures (inv(s) ==> canFreezeUnit(s, unit) ==> stepSupersessionFinal(s, freezeUnit(s, unit)))
  ensures (inv(s) ==> canFreezeUnit(s, unit) ==> stepFrozenUnitsKept(s, freezeUnit(s, unit)))
{
  if inv(s) && canFreezeUnit(s, unit) {
    var after := freezeUnit(s, unit);
    assert |after.units| == |s.units|;
    forall u | u in s.units && (u.superseded || (u.frozen && live(u)))
      ensures exists v :: v in after.units && sameUnit(u, v)
    {
      var i :| 0 <= i < |s.units| && s.units[i] == u;
      assert after.units[i] == u;
      SameUnitRefl(u);
      assert after.units[i] in after.units;
    }
  }
}

lemma SameUnitRefl(u: Unit)
  ensures sameUnit(u, u)
{
}
