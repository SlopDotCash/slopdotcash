// Appending an enforcement record keeps ids and per-project sequences unique and every ban's decision stable.
lemma recordVettingBan_ensures(a: Access, by_: int, project: int, decision: int)
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysProjectBansConfirmed(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysEnforcementSequenced(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysBansDecidedOnConfirmedMalice(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysReleasesIndependent(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysAppealsDecidedByModerators(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysAwardsIdentified(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> stepBanRecordsPermanent(a, recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> stepProjectReinstatementKeepsAccountBans(a, "recordVettingBan", recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> stepFundedAwardsPreserved(a, recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> stepNewAwardOnlyWhenAllowed(a, recordVettingBan(a, by_, project, decision)))
{
  if inv(a) && canRecordVettingBan(a, by_, project, decision) {
    var r := recordFor(a, by_, project, decision, EnforcementAction.BanAction, EnforcementRole.VettingRole, ProjectState.ProjectBanned);
    assert recordVettingBan(a, by_, project, decision) == a.(enforcements := a.enforcements + [r], decisions := a.decisions + [decision]);
    AppendRecord(a, r);
  }
}

lemma decideProjectBan_ensures(a: Access, by_: int, project: int, decision: int)
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysProjectBansConfirmed(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysEnforcementSequenced(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysBansDecidedOnConfirmedMalice(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysReleasesIndependent(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysAppealsDecidedByModerators(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> alwaysAwardsIdentified(decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> stepBanRecordsPermanent(a, decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> stepProjectReinstatementKeepsAccountBans(a, "decideProjectBan", decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> stepFundedAwardsPreserved(a, decideProjectBan(a, by_, project, decision)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision) ==> stepNewAwardOnlyWhenAllowed(a, decideProjectBan(a, by_, project, decision)))
{
  if inv(a) && canDecideProjectBan(a, by_, project, decision) {
    var r := recordFor(a, by_, project, decision, EnforcementAction.BanAction, EnforcementRole.ModeratorRole, ProjectState.ProjectBanned);
    var sel := (e: Enforcement) => ((e.project == project) && (e.sequence == |projectRecords(a, project)|));
    var prior := latestRecord(a, project);
    assert |ProofLib.Filter(sel, a.enforcements)| > 0;
    assert prior == ProofLib.Filter(sel, a.enforcements)[0];
    ProofLib.FilterMember(sel, a.enforcements, prior);
    assert prior in a.enforcements && prior.project == r.project && prior.sequence == r.sequence - 1;
    AppendRecord(a, r);
  }
}

lemma reinstateProject_ensures(a: Access, by_: int, project: int, decision: int)
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysProjectBansConfirmed(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysEnforcementSequenced(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysBansDecidedOnConfirmedMalice(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysReleasesIndependent(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysAppealsDecidedByModerators(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysAwardsIdentified(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> stepBanRecordsPermanent(a, reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> stepProjectReinstatementKeepsAccountBans(a, "reinstateProject", reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> stepFundedAwardsPreserved(a, reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> stepNewAwardOnlyWhenAllowed(a, reinstateProject(a, by_, project, decision)))
{
  if inv(a) && canReinstateProject(a, by_, project, decision) {
    var r := recordFor(a, by_, project, decision, EnforcementAction.ReinstateAction, EnforcementRole.ModeratorRole, ProjectState.ProjectClear);
    assert reinstateProject(a, by_, project, decision) == a.(enforcements := a.enforcements + [r], decisions := a.decisions + [decision]);
    AppendRecord(a, r);
  }
}

lemma AppendRecord(a: Access, r: Enforcement)
  requires inv(a)
  requires r.id > 0 && r.project > 0 && !(r.id in a.decisions)
  requires r.sequence == |projectRecords(a, r.project)| + 1
  requires r.role.VettingRole? ==> (r.decidedBy == vettingService && r.kind.BanAction?)
  requires r.role.ModeratorRole? ==> isModerator(r.decidedBy)
  requires r.stateAfter.ProjectBanned? <==> r.kind.BanAction?
  requires (r.role.ModeratorRole? && r.kind.BanAction?) ==> (exists v :: v in a.enforcements && v.project == r.project && v.sequence == r.sequence - 1 && v.role.VettingRole? && v.kind.BanAction?)
  ensures inv(a.(enforcements := a.enforcements + [r], decisions := a.decisions + [r.id]))
{
  var xs := a.enforcements;
  var b := a.(enforcements := xs + [r], decisions := a.decisions + [r.id]);
  forall e | e in xs
    ensures e.id != r.id
    ensures e.project == r.project ==> e.sequence < r.sequence
  {
  }
  forall e | e in xs + [r]
    ensures |ProofLib.Filter((o: Enforcement) => (o.id == e.id), xs + [r])| == 1
    ensures e.sequence <= |projectRecords(b, e.project)|
    ensures |ProofLib.Filter((o: Enforcement) => ((o.project == e.project) && (o.sequence == e.sequence)), xs + [r])| == 1
  {
    ProofLib.FilterAppend((o: Enforcement) => (o.id == e.id), xs, r);
    ProofLib.FilterAppend((o: Enforcement) => ((o.project == e.project) && (o.sequence == e.sequence)), xs, r);
    ProofLib.FilterAppend((o: Enforcement) => (o.project == e.project), xs, r);
    if e == r {
      ProofLib.FilterNone((o: Enforcement) => (o.id == e.id), xs);
      ProofLib.FilterNone((o: Enforcement) => ((o.project == e.project) && (o.sequence == e.sequence)), xs);
    }
  }
  forall e | e in xs + [r]
    ensures (e.role.ModeratorRole? && e.kind.BanAction?) ==> (exists v :: v in xs + [r] && v.project == e.project && v.sequence == e.sequence - 1 && v.role.VettingRole? && v.kind.BanAction?)
  {
  }
  forall enforcement | true
    ensures |ProofLib.Filter((e: Enforcement) => (((e.id == enforcement) && e.role.ModeratorRole?) && e.kind.BanAction?), xs)| > 0 ==>
      projectDecision(b, enforcement) == projectDecision(a, enforcement)
  {
    ProofLib.FilterAppend((e: Enforcement) => (((e.id == enforcement) && e.role.ModeratorRole?) && e.kind.BanAction?), xs, r);
  }
  forall x | x in a.bans
    ensures projectDecision(b, x.enforcement) == projectDecision(a, x.enforcement)
  {
    if |ProofLib.Filter((e: Enforcement) => (((e.id == x.enforcement) && e.role.ModeratorRole?) && e.kind.BanAction?), xs)| == 0 {
      assert projectDecision(a, x.enforcement) == absentEnforcement;
      assert false;
    }
  }
}

lemma ban_ensures(a: Access, by_: int, enforcement: int, target: int)
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysProjectBansConfirmed(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysEnforcementSequenced(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysBansDecidedOnConfirmedMalice(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysReleasesIndependent(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysAppealsDecidedByModerators(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> alwaysAwardsIdentified(ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> stepBanRecordsPermanent(a, ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> stepProjectReinstatementKeepsAccountBans(a, "ban", ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> stepFundedAwardsPreserved(a, ban(a, by_, enforcement, target)))
  ensures (inv(a) ==> canBan(a, by_, enforcement, target) ==> stepNewAwardOnlyWhenAllowed(a, ban(a, by_, enforcement, target)))
{
  if inv(a) && canBan(a, by_, enforcement, target) {
    var added := Ban(enforcement, projectDecision(a, enforcement).project, target, by_);
    var xs := a.bans;
    forall x | x in xs + [added]
      ensures |ProofLib.Filter((o: Ban) => ((o.enforcement == x.enforcement) && (o.target == x.target)), xs + [added])| == 1
    {
      ProofLib.FilterAppend((o: Ban) => ((o.enforcement == x.enforcement) && (o.target == x.target)), xs, added);
      if x.enforcement == enforcement && x.target == target {
        ProofLib.FilterNone((o: Ban) => ((o.enforcement == x.enforcement) && (o.target == x.target)), xs);
      }
    }
    forall x | x in xs
      ensures banFor(ban(a, by_, enforcement, target), x.enforcement, x.target) == banFor(a, x.enforcement, x.target)
    {
      ProofLib.FilterAppend((o: Ban) => ((o.enforcement == x.enforcement) && (o.target == x.target)), xs, added);
      ProofLib.FilterMember((o: Ban) => ((o.enforcement == x.enforcement) && (o.target == x.target)), xs, x);
    }
    forall r | r in a.releases
      ensures banFor(ban(a, by_, enforcement, target), r.enforcement, r.target) == banFor(a, r.enforcement, r.target)
    {
      ProofLib.FilterAppend((o: Ban) => ((o.enforcement == r.enforcement) && (o.target == r.target)), xs, added);
      assert banFor(a, r.enforcement, r.target).enforcement > 0;
    }
    forall p | p in a.appeals
      ensures banFor(ban(a, by_, enforcement, target), p.enforcement, p.target) == banFor(a, p.enforcement, p.target)
    {
      ProofLib.FilterAppend((o: Ban) => ((o.enforcement == p.enforcement) && (o.target == p.target)), xs, added);
      assert banFor(a, p.enforcement, p.target).enforcement > 0;
    }
  }
}

// Reserving appends an award with a fresh ID; paying changes only the paid flag.
lemma reserveAward_ensures(a: Access, by_: int, awardId: int, recipient: int)
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysProjectBansConfirmed(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysEnforcementSequenced(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysBansDecidedOnConfirmedMalice(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysReleasesIndependent(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysAppealsDecidedByModerators(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysAwardsIdentified(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepBanRecordsPermanent(a, reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepProjectReinstatementKeepsAccountBans(a, "reserveAward", reserveAward(a, by_, awardId, recipient)))
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
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysEnforcementSequenced(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysBansDecidedOnConfirmedMalice(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysReleasesIndependent(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysAppealsDecidedByModerators(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysAwardsIdentified(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepBanRecordsPermanent(a, payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepProjectReinstatementKeepsAccountBans(a, "payAward", payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepFundedAwardsPreserved(a, payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepNewAwardOnlyWhenAllowed(a, payAward(a, by_, awardId)))
{
  if inv(a) && canPayAward(a, by_, awardId) {
    assert payAward(a, by_, awardId).bans == a.bans && payAward(a, by_, awardId).enforcements == a.enforcements;
    forall e | true ensures projectDecision(payAward(a, by_, awardId), e) == projectDecision(a, e) { }
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

// An appeal appends one open appeal on an unreleased ban; bans are unchanged.
lemma appeal_ensures(a: Access, by_: int, enforcement: int)
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> alwaysProjectBansConfirmed(appeal(a, by_, enforcement)))
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> alwaysEnforcementSequenced(appeal(a, by_, enforcement)))
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> alwaysBansDecidedOnConfirmedMalice(appeal(a, by_, enforcement)))
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> alwaysReleasesIndependent(appeal(a, by_, enforcement)))
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> alwaysAppealsDecidedByModerators(appeal(a, by_, enforcement)))
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> alwaysAwardsIdentified(appeal(a, by_, enforcement)))
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> stepBanRecordsPermanent(a, appeal(a, by_, enforcement)))
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> stepProjectReinstatementKeepsAccountBans(a, "appeal", appeal(a, by_, enforcement)))
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> stepFundedAwardsPreserved(a, appeal(a, by_, enforcement)))
  ensures (inv(a) ==> canAppeal(a, by_, enforcement) ==> stepNewAwardOnlyWhenAllowed(a, appeal(a, by_, enforcement)))
{
  if inv(a) && canAppeal(a, by_, enforcement) {
    var added := Appeal((a.lastAppeal + 1), enforcement, by_, AppealStatus.AppealOpen, 0);
    assert appeal(a, by_, enforcement).appeals == a.appeals + [added];
    assert appeal(a, by_, enforcement).bans == a.bans && appeal(a, by_, enforcement).releases == a.releases;
    assert banFor(appeal(a, by_, enforcement), enforcement, by_) == banFor(a, enforcement, by_);
  }
}
