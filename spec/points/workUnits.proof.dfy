// Superseded and frozen live units are left in place by every transition.
lemma form_ensures(s: Units, g: GroupEvidence)
  ensures (inv(s) ==> canForm(s, g) ==> alwaysCurrentUnitsDisjoint(form(s, g)))
  ensures (inv(s) ==> canForm(s, g) ==> alwaysNextIdPositive(form(s, g)))
  ensures (inv(s) ==> canForm(s, g) ==> alwaysUnitsWellFormed(form(s, g)))
  ensures (inv(s) ==> canForm(s, g) ==> alwaysPromotionDigestsPresent(form(s, g)))
  ensures (inv(s) ==> canForm(s, g) ==> stepPromotionAddsNoUnit(s, "form", form(s, g)))
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

lemma accept_ensures(s: Units, unit: int, at: int)
  ensures (inv(s) ==> canAccept(s, unit, at) ==> alwaysCurrentUnitsDisjoint(accept(s, unit, at)))
  ensures (inv(s) ==> canAccept(s, unit, at) ==> alwaysNextIdPositive(accept(s, unit, at)))
  ensures (inv(s) ==> canAccept(s, unit, at) ==> alwaysUnitsWellFormed(accept(s, unit, at)))
  ensures (inv(s) ==> canAccept(s, unit, at) ==> alwaysPromotionDigestsPresent(accept(s, unit, at)))
  ensures (inv(s) ==> canAccept(s, unit, at) ==> stepPromotionAddsNoUnit(s, "accept", accept(s, unit, at)))
  ensures (inv(s) ==> canAccept(s, unit, at) ==> stepSupersessionFinal(s, accept(s, unit, at)))
  ensures (inv(s) ==> canAccept(s, unit, at) ==> stepFrozenUnitsKept(s, accept(s, unit, at)))
{
  if inv(s) && canAccept(s, unit, at) {
    var after := accept(s, unit, at);
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

lemma freezeUnit_ensures(s: Units, unit: int, f: points__periods_FreezeEvidence)
  ensures (inv(s) ==> canFreezeUnit(s, unit, f) ==> alwaysCurrentUnitsDisjoint(freezeUnit(s, unit, f)))
  ensures (inv(s) ==> canFreezeUnit(s, unit, f) ==> alwaysNextIdPositive(freezeUnit(s, unit, f)))
  ensures (inv(s) ==> canFreezeUnit(s, unit, f) ==> alwaysUnitsWellFormed(freezeUnit(s, unit, f)))
  ensures (inv(s) ==> canFreezeUnit(s, unit, f) ==> alwaysPromotionDigestsPresent(freezeUnit(s, unit, f)))
  ensures (inv(s) ==> canFreezeUnit(s, unit, f) ==> stepPromotionAddsNoUnit(s, "freezeUnit", freezeUnit(s, unit, f)))
  ensures (inv(s) ==> canFreezeUnit(s, unit, f) ==> stepSupersessionFinal(s, freezeUnit(s, unit, f)))
  ensures (inv(s) ==> canFreezeUnit(s, unit, f) ==> stepFrozenUnitsKept(s, freezeUnit(s, unit, f)))
{
  if inv(s) && canFreezeUnit(s, unit, f) {
    var after := freezeUnit(s, unit, f);
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

lemma recordPromotion_ensures(s: Units, g: GroupEvidence)
  ensures (inv(s) ==> canRecordPromotion(s, g) ==> alwaysCurrentUnitsDisjoint(recordPromotion(s, g)))
  ensures (inv(s) ==> canRecordPromotion(s, g) ==> alwaysNextIdPositive(recordPromotion(s, g)))
  ensures (inv(s) ==> canRecordPromotion(s, g) ==> alwaysUnitsWellFormed(recordPromotion(s, g)))
  ensures (inv(s) ==> canRecordPromotion(s, g) ==> alwaysPromotionDigestsPresent(recordPromotion(s, g)))
  ensures (inv(s) ==> canRecordPromotion(s, g) ==> stepPromotionAddsNoUnit(s, "recordPromotion", recordPromotion(s, g)))
  ensures (inv(s) ==> canRecordPromotion(s, g) ==> stepSupersessionFinal(s, recordPromotion(s, g)))
  ensures (inv(s) ==> canRecordPromotion(s, g) ==> stepFrozenUnitsKept(s, recordPromotion(s, g)))
{
  if inv(s) && canRecordPromotion(s, g) {
    var after := recordPromotion(s, g);
    assert after.units == s.units;
    forall u | u in s.units
      ensures exists v :: v in after.units && sameUnit(u, v)
    {
      SameUnitRefl(u);
    }
  }
}

lemma holdPromotion_ensures(s: Units, g: GroupEvidence)
  ensures (inv(s) ==> canHoldPromotion(s, g) ==> alwaysCurrentUnitsDisjoint(holdPromotion(s, g)))
  ensures (inv(s) ==> canHoldPromotion(s, g) ==> alwaysNextIdPositive(holdPromotion(s, g)))
  ensures (inv(s) ==> canHoldPromotion(s, g) ==> alwaysUnitsWellFormed(holdPromotion(s, g)))
  ensures (inv(s) ==> canHoldPromotion(s, g) ==> alwaysPromotionDigestsPresent(holdPromotion(s, g)))
  ensures (inv(s) ==> canHoldPromotion(s, g) ==> stepPromotionAddsNoUnit(s, "holdPromotion", holdPromotion(s, g)))
  ensures (inv(s) ==> canHoldPromotion(s, g) ==> stepSupersessionFinal(s, holdPromotion(s, g)))
  ensures (inv(s) ==> canHoldPromotion(s, g) ==> stepFrozenUnitsKept(s, holdPromotion(s, g)))
{
  if inv(s) && canHoldPromotion(s, g) {
    var after := holdPromotion(s, g);
    assert after.units == s.units;
    forall u | u in s.units
      ensures exists v :: v in after.units && sameUnit(u, v)
    {
      SameUnitRefl(u);
    }
  }
}
