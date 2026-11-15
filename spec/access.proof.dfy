// Reserving appends an award with a fresh ID; paying changes only the paid flag.
lemma reserveAward_ensures(a: Access, by_: int, awardId: int, recipient: int)
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysProjectBansConfirmed(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysBansDecidedOnConfirmedMalice(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysReleasesIndependent(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysAppealsDecidedByModerators(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysAwardsIdentified(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepBanRecordsPermanent(a, reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepFundedAwardsPreserved(a, reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepNewAwardOnlyWhenAllowed(a, reserveAward(a, by_, awardId, recipient)))
{
  if inv(a) && canReserveAward(a, by_, awardId, recipient) {
    var added := Award(awardId, recipient, true, false);
    var xs := a.awards;
    forall w | w in xs + [added]
      ensures |ProofLib.Filter((x: Award) => (x.id == w.id), xs + [added])| == 1
    {
      ProofLib.FilterAppend((x: Award) => (x.id == w.id), xs, added);
      if w.id == awardId {
        ProofLib.FilterNone((x: Award) => (x.id == w.id), xs);
      }
    }
  }
}

lemma payAward_ensures(a: Access, by_: int, awardId: int)
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysProjectBansConfirmed(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysBansDecidedOnConfirmedMalice(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysReleasesIndependent(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysAppealsDecidedByModerators(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysAwardsIdentified(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepBanRecordsPermanent(a, payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepFundedAwardsPreserved(a, payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepNewAwardOnlyWhenAllowed(a, payAward(a, by_, awardId)))
{
  if inv(a) && canPayAward(a, by_, awardId) {
    var xs := a.awards;
    var ys := payAward(a, by_, awardId).awards;
    assert |ys| == |xs|;
    assert forall i :: 0 <= i < |xs| ==> ys[i].id == xs[i].id && ys[i].recipient == xs[i].recipient && ys[i].funded == xs[i].funded && (xs[i].paid ==> ys[i].paid);
    forall w | w in xs
      ensures exists x :: x in ys && x.id == w.id && x.recipient == w.recipient && x.funded && (!(w.paid) || x.paid)
    {
      var i :| 0 <= i < |xs| && xs[i] == w;
      assert ys[i] in ys;
    }
    forall w | w in ys
      ensures w.id > 0 && w.recipient > 0 && w.funded && |ProofLib.Filter((x: Award) => (x.id == w.id), ys)| == 1
    {
      var i :| 0 <= i < |ys| && ys[i] == w;
      assert xs[i] in xs;
      ProofLib.FilterLengthPointwise((x: Award) => (x.id == w.id), (x: Award) => (x.id == w.id), xs, ys);
    }
    forall w | w in ys
      ensures exists x :: x in xs && x.id == w.id
    {
      var i :| 0 <= i < |ys| && ys[i] == w;
      assert xs[i] in xs;
    }
  }
}

lemma decideProjectBan_ensures(a: Access, by_: int, project: int, decision: int)
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysProjectBansConfirmed(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysBansDecidedOnConfirmedMalice(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysReleasesIndependent(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysAppealsDecidedByModerators(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysAwardsIdentified(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> stepBanRecordsPermanent(a, decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> stepFundedAwardsPreserved(a, decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> stepNewAwardOnlyWhenAllowed(a, decideProjectBan(a, by_, project, decision)))
{
  if inv(a) && canDecideProjectBan(a, by_, project, decision) {
    var added := ProjectDecision(decision, project, by_);
    var after := decideProjectBan(a, by_, project, decision);
    forall b | b in a.bans
      ensures projectDecision(after, b.enforcement) == projectDecision(a, b.enforcement)
    {
      ProofLib.FilterAppend((p: ProjectDecision) => (p.enforcement == b.enforcement), a.projectBans, added);
    }
  }
}

lemma ban_ensures(a: Access, by_: int, enforcement: int, target: int)
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysProjectBansConfirmed(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysBansDecidedOnConfirmedMalice(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysReleasesIndependent(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysAppealsDecidedByModerators(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysAwardsIdentified(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> stepBanRecordsPermanent(a, ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> stepFundedAwardsPreserved(a, ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> stepNewAwardOnlyWhenAllowed(a, ban(a, by_, enforcement, target)))
{
  if inv(a) && canBan(a, by_, enforcement, target) {
    var added := Ban(enforcement, projectDecision(a, enforcement).project, target, by_);
    var after := ban(a, by_, enforcement, target);
    assert after.bans == a.bans + [added];
    forall b | b in a.bans + [added]
      ensures |ProofLib.Filter((o: Ban) => ((o.enforcement == b.enforcement) && (o.target == b.target)), a.bans + [added])| == 1
    {
      ProofLib.FilterAppend((o: Ban) => ((o.enforcement == b.enforcement) && (o.target == b.target)), a.bans, added);
      if added.enforcement == b.enforcement && added.target == b.target {
        ProofLib.FilterNone((o: Ban) => ((o.enforcement == b.enforcement) && (o.target == b.target)), a.bans);
      }
    }
    forall r | r in a.releases
      ensures banFor(after, r.enforcement, r.target) == banFor(a, r.enforcement, r.target)
    {
      ProofLib.FilterAppend((b: Ban) => ((b.enforcement == r.enforcement) && (b.target == r.target)), a.bans, added);
    }
    forall p | p in a.appeals
      ensures banFor(after, p.enforcement, p.target) == banFor(a, p.enforcement, p.target)
    {
      ProofLib.FilterAppend((b: Ban) => ((b.enforcement == p.enforcement) && (b.target == p.target)), a.bans, added);
    }
  }
}
