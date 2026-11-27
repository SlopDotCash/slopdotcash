lemma LatestRecordMeaning(a: Access, project: int)
  ensures latestRecord(a, project) ==
    (if 0 < |ProofLib.Filter((e: Enforcement) => ((e.project == project) && (e.sequence == |projectRecords(a, project)|)), a.enforcements)|
     then ProofLib.Filter((e: Enforcement) => ((e.project == project) && (e.sequence == |projectRecords(a, project)|)), a.enforcements)[0]
     else absentEnforcement)
{
}

lemma ProjectDecisionMeaning(a: Access, enforcement: int)
  ensures projectDecision(a, enforcement) ==
    (if 0 < |ProofLib.Filter((e: Enforcement) => (((e.id == enforcement) && e.role.ModeratorRole?) && e.kind.BanAction?), a.enforcements)|
     then ProofLib.Filter((e: Enforcement) => (((e.id == enforcement) && e.role.ModeratorRole?) && e.kind.BanAction?), a.enforcements)[0]
     else absentEnforcement)
{
}

lemma BanForMeaning(a: Access, enforcement: int, target: int)
  ensures banFor(a, enforcement, target) ==
    (if 0 < |ProofLib.Filter((b: Ban) => ((b.enforcement == enforcement) && (b.target == target)), a.bans)|
     then ProofLib.Filter((b: Ban) => ((b.enforcement == enforcement) && (b.target == target)), a.bans)[0]
     else Ban(0, 0, 0, 0))
{
}

lemma SelectedBansMeaning(a: Access, project: int, targets: seq<int>)
  ensures selectedBans(a, project, targets) ==
    ProofLib.Filter((b: Ban) => (((b.project == project) && (b.target in targets)) && !(released(a, b))), a.bans)
{
}

lemma OpenAppealsMeaning(a: Access, project: int)
  ensures openAppealsOf(a, project) ==
    ProofLib.Filter((p: BanAppeal) => ((p.project == project) && p.status.AppealOpen?), a.appeals)
{
}

lemma BansUniqueMeaning(a: Access)
  ensures alwaysBansDecidedOnConfirmedMalice(a) ==
    !(exists b :: b in a.bans && !(((((((b.enforcement > 0) && (projectDecision(a, b.enforcement).id == b.enforcement)) && (projectDecision(a, b.enforcement).project == b.project)) && (projectDecision(a, b.enforcement).decidedBy == b.decidedBy)) && isModerator(a, b.decidedBy)) && (b.target != b.decidedBy)) && (b.target > 0) && (|ProofLib.Filter((o: Ban) => ((o.enforcement == b.enforcement) && (o.target == b.target)), a.bans)| == 1)))
{
}

lemma ReleasesUniqueMeaning(a: Access)
  ensures alwaysReleasesIndependent(a) ==
    !(exists r :: r in a.releases && !(((((((isModerator(a, r.decidedBy) && (banFor(a, r.enforcement, r.target).enforcement > 0)) && (r.decidedBy != banFor(a, r.enforcement, r.target).decidedBy)) && (r.decidedBy != r.target)) && (r.decision in a.decisions)) && !((exists o :: o in a.releases && !((!((o.decision == r.decision)) || (o.decidedBy == r.decidedBy)))))) && (|ProofLib.Filter((o: Release) => ((o.enforcement == r.enforcement) && (o.target == r.target)), a.releases)| == 1))))
{
}

lemma AppealsUniqueMeaning(a: Access)
  ensures alwaysAppealsDecidedByModerators(a) ==
    (((a.lastAppeal >= 0) && !(0 in a.moderators)) && !(exists p :: p in a.appeals && !((((((((p.id > 0) && (p.id <= a.lastAppeal)) && (p.project > 0)) && (exists b :: b in a.bans && ((b.project == p.project) && (b.target == p.target)))) && (p.status.AppealOpen? == (p.decidedBy == 0))) && (!(p.status.AppealGranted?) || (exists r :: r in a.releases && (((r.target == p.target) && (r.decidedBy == p.decidedBy)) && (banFor(a, r.enforcement, r.target).project == p.project))))) && (!(p.status.AppealOpen?) || ((exists b :: b in a.bans && (((b.project == p.project) && (b.target == p.target)) && !(released(a, b)))) && (|ProofLib.Filter((o: BanAppeal) => (((o.project == p.project) && (o.target == p.target)) && o.status.AppealOpen?), a.appeals)| == 1)))))))
{
}

lemma AccountUniqueFilter(a: Access, by_: int, project: int, decision: int, accounts: seq<int>, t: int)
  requires canDecideProjectBan(a, by_, project, decision, accounts) && t in accounts
  ensures |ProofLib.Filter((u: int) => (u == t), accounts)| == 1
{
}

lemma AwardsUniqueMeaning(a: Access)
  ensures alwaysAwardsIdentified(a) ==
    !(exists w :: w in a.awards && !((((w.id > 0) && (w.recipient > 0)) && w.funded) && (|ProofLib.Filter((x: Award) => (x.id == w.id), a.awards)| == 1)))
{
}

lemma FilterConcat<T>(f: T -> bool, xs: seq<T>, ys: seq<T>)
  ensures ProofLib.Filter(f, xs + ys) == ProofLib.Filter(f, xs) + ProofLib.Filter(f, ys)
  decreases |ys|
{
  if |ys| == 0 {
    assert xs + ys == xs;
    ProofLib.FilterNil(f, ys);
  } else {
    var init := ys[..|ys| - 1];
    var last := ys[|ys| - 1];
    assert ys == init + [last];
    assert xs + ys == (xs + init) + [last];
    FilterConcat(f, xs, init);
    ProofLib.FilterAppend(f, xs + init, last);
    ProofLib.FilterAppend(f, init, last);
  }
}

lemma recordVettingBan_ensures(a: Access, by_: int, project: int, decision: int)
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysProjectBansConfirmed(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysEnforcementSequenced(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysBansDecidedOnConfirmedMalice(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysReleasesIndependent(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysAppealsDecidedByModerators(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysBanAppealsDecidedIndependently(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> alwaysAwardsIdentified(recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> stepBanRecordsPermanent(a, recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> stepProjectReinstatementKeepsAccountBans(a, "recordVettingBan", recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> stepBansOnlyByDecision(a, "recordVettingBan", recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> stepFundedAwardsPreserved(a, recordVettingBan(a, by_, project, decision)))
  ensures (inv(a) ==> canRecordVettingBan(a, by_, project, decision) ==> stepNewAwardOnlyWhenAllowed(a, recordVettingBan(a, by_, project, decision)))
{
  if inv(a) && canRecordVettingBan(a, by_, project, decision) {
    var r := recordFor(a, by_, project, decision, EnforcementAction.BanAction, EnforcementRole.VettingRole, ProjectState.ProjectBanned);
    assert recordVettingBan(a, by_, project, decision) == a.(enforcements := a.enforcements + [r], decisions := a.decisions + [decision]);
    AppendRecord(a, r);
  }
}

lemma DecideBanBansUnique(bans: seq<Ban>, added: seq<Ban>, decision: int, project: int, by_: int, accounts: seq<int>)
  requires forall x :: x in bans ==> x.enforcement != decision && |ProofLib.Filter((o: Ban) => ((o.enforcement == x.enforcement) && (o.target == x.target)), bans)| == 1
  requires |added| == |accounts|
  requires forall i :: 0 <= i < |accounts| ==> added[i] == Ban(decision, project, accounts[i], by_)
  requires forall t :: t in accounts ==> |ProofLib.Filter((u: int) => (u == t), accounts)| == 1
  ensures forall x :: x in bans + added ==> |ProofLib.Filter((o: Ban) => ((o.enforcement == x.enforcement) && (o.target == x.target)), bans + added)| == 1
{
  forall x | x in bans + added
    ensures |ProofLib.Filter((o: Ban) => ((o.enforcement == x.enforcement) && (o.target == x.target)), bans + added)| == 1
  {
    var p := (o: Ban) => ((o.enforcement == x.enforcement) && (o.target == x.target));
    FilterConcat(p, bans, added);
    if x in bans {
      assert forall k :: 0 <= k < |added| ==> !p(added[k]);
      ProofLib.FilterNone(p, added);
    } else {
      var i :| 0 <= i < |added| && added[i] == x;
      assert forall b :: b in bans ==> !p(b);
      ProofLib.FilterNone(p, bans);
      forall j | 0 <= j < |added| && j != i
        ensures !p(added[j])
      {
        if accounts[j] == accounts[i] {
          assert accounts[i] in accounts;
          ProofLib.FilterTwo((u: int) => (u == accounts[i]), accounts, i, j);
        }
      }
      ProofLib.FilterOne(p, added, i);
    }
  }
}

lemma ReinstateReleasesUnique(releases: seq<Release>, added: seq<Release>)
  requires forall r :: r in releases ==> |ProofLib.Filter((o: Release) => ((o.enforcement == r.enforcement) && (o.target == r.target)), releases)| == 1
  requires forall r, a :: r in releases && a in added ==> !(r.enforcement == a.enforcement && r.target == a.target)
  requires forall i, j :: 0 <= i < |added| && 0 <= j < |added| && i != j ==> !(added[i].enforcement == added[j].enforcement && added[i].target == added[j].target)
  ensures forall r :: r in releases + added ==> |ProofLib.Filter((o: Release) => ((o.enforcement == r.enforcement) && (o.target == r.target)), releases + added)| == 1
{
  forall r | r in releases + added
    ensures |ProofLib.Filter((o: Release) => ((o.enforcement == r.enforcement) && (o.target == r.target)), releases + added)| == 1
  {
    var pr := (o: Release) => ((o.enforcement == r.enforcement) && (o.target == r.target));
    FilterConcat(pr, releases, added);
    if r in releases {
      assert forall k :: 0 <= k < |added| ==> !pr(added[k]);
      ProofLib.FilterNone(pr, added);
    } else {
      var i :| 0 <= i < |added| && added[i] == r;
      assert forall r0 :: r0 in releases ==> !pr(r0);
      ProofLib.FilterNone(pr, releases);
      ProofLib.FilterOne(pr, added, i);
    }
  }
}

lemma decideProjectBan_ensures(a: Access, by_: int, project: int, decision: int, accounts: seq<int>)
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> alwaysProjectBansConfirmed(decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> alwaysEnforcementSequenced(decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> alwaysBansDecidedOnConfirmedMalice(decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> alwaysReleasesIndependent(decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> alwaysAppealsDecidedByModerators(decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> alwaysBanAppealsDecidedIndependently(decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> alwaysAwardsIdentified(decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> stepBanRecordsPermanent(a, decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> stepProjectReinstatementKeepsAccountBans(a, "decideProjectBan", decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> stepBansOnlyByDecision(a, "decideProjectBan", decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> stepFundedAwardsPreserved(a, decideProjectBan(a, by_, project, decision, accounts)))
  ensures (inv(a) ==> canDecideProjectBan(a, by_, project, decision, accounts) ==> stepNewAwardOnlyWhenAllowed(a, decideProjectBan(a, by_, project, decision, accounts)))
{
  hide *;
  reveal inv, canDecideProjectBan, decideProjectBan, recordFor, projectRecords, latestRecord,
    alwaysProjectBansConfirmed, alwaysEnforcementSequenced, alwaysBansDecidedOnConfirmedMalice,
    alwaysReleasesIndependent, alwaysAppealsDecidedByModerators, alwaysBanAppealsDecidedIndependently,
    alwaysAwardsIdentified, stepBanRecordsPermanent, stepProjectReinstatementKeepsAccountBans,
    stepBansOnlyByDecision, stepFundedAwardsPreserved, stepNewAwardOnlyWhenAllowed,
    isModerator, released, independentOf, absentEnforcement, freshDecision, openAppeal,
    projectDecision, banFor;
  if inv(a) && canDecideProjectBan(a, by_, project, decision, accounts) {
    var r := recordFor(a, by_, project, decision, EnforcementAction.BanAction, EnforcementRole.ModeratorRole, ProjectState.ProjectBanned);
    var sel := (e: Enforcement) => ((e.project == project) && (e.sequence == |projectRecords(a, project)|));
    LatestRecordMeaning(a, project);
    var prior := latestRecord(a, project);
    assert |ProofLib.Filter(sel, a.enforcements)| > 0;
    assert prior == ProofLib.Filter(sel, a.enforcements)[0];
    ProofLib.FilterMember(sel, a.enforcements, prior);
    assert prior in a.enforcements && prior.project == r.project && prior.sequence == r.sequence - 1;
    AppendRecord(a, r);
    var mid := a.(enforcements := a.enforcements + [r], decisions := a.decisions + [decision]);
    var after := decideProjectBan(a, by_, project, decision, accounts);
    assert after.enforcements == mid.enforcements && after.decisions == mid.decisions;
    var pDec := (e: Enforcement) => (((e.id == decision) && e.role.ModeratorRole?) && e.kind.BanAction?);
    ProjectDecisionMeaning(after, decision);
    ProofLib.FilterAppend(pDec, a.enforcements, r);
    ProofLib.FilterNone(pDec, a.enforcements);
    assert projectDecision(after, decision) == r;
    forall x | x in a.bans
      ensures projectDecision(after, x.enforcement) == projectDecision(a, x.enforcement)
      ensures x.enforcement != decision
    {
      ProjectDecisionMeaning(a, x.enforcement);
      ProjectDecisionMeaning(after, x.enforcement);
      var px := (e: Enforcement) => (((e.id == x.enforcement) && e.role.ModeratorRole?) && e.kind.BanAction?);
      assert |ProofLib.Filter(px, a.enforcements)| > 0;
      ProofLib.FilterMember(px, a.enforcements, ProofLib.Filter(px, a.enforcements)[0]);
      ProofLib.FilterAppend(px, a.enforcements, r);
    }
    var added := after.bans[|a.bans|..];
    assert after.bans == a.bans + added;
    assert |added| == |accounts|;
    assert forall i :: 0 <= i < |accounts| ==> added[i] == Ban(decision, project, accounts[i], by_);
    forall t | t in accounts
      ensures |ProofLib.Filter((u: int) => (u == t), accounts)| == 1
    {
      AccountUniqueFilter(a, by_, project, decision, accounts, t);
    }
    BansUniqueMeaning(a);
    DecideBanBansUnique(a.bans, added, decision, project, by_, accounts);
    forall b | b in after.bans
      ensures b.enforcement > 0 && projectDecision(after, b.enforcement).id == b.enforcement && projectDecision(after, b.enforcement).project == b.project && projectDecision(after, b.enforcement).decidedBy == b.decidedBy && isModerator(after, b.decidedBy) && b.target != b.decidedBy && b.target > 0
    {
      if !(b in a.bans) {
        var i :| 0 <= i < |added| && added[i] == b;
        assert accounts[i] in accounts;
      }
    }
    BansUniqueMeaning(after);
    forall r0 | r0 in a.releases
      ensures banFor(after, r0.enforcement, r0.target) == banFor(a, r0.enforcement, r0.target)
    {
      BanForMeaning(a, r0.enforcement, r0.target);
      BanForMeaning(after, r0.enforcement, r0.target);
      var p := (b: Ban) => ((b.enforcement == r0.enforcement) && (b.target == r0.target));
      FilterConcat(p, a.bans, added);
      assert |ProofLib.Filter(p, a.bans)| > 0;
    }
    AppealsUniqueMeaning(a);
    forall p0 | p0 in after.appeals
      ensures p0.status.AppealOpen? ==> |ProofLib.Filter((o: BanAppeal) => (((o.project == p0.project) && (o.target == p0.target)) && o.status.AppealOpen?), after.appeals)| == 1
    {
      if p0.status.AppealOpen? {
        var idx :| 0 <= idx < |after.appeals| && after.appeals[idx] == p0;
        assert a.appeals[idx] == p0;
        assert !(p0.project == project && p0.target in accounts);
        var q := (o: BanAppeal) => (((o.project == p0.project) && (o.target == p0.target)) && o.status.AppealOpen?);
        ProofLib.FilterLengthPointwise(q, q, a.appeals, after.appeals);
      }
    }
    AppealsUniqueMeaning(after);
  }
}

lemma reinstateProject_ensures(a: Access, by_: int, project: int, decision: int)
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysProjectBansConfirmed(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysEnforcementSequenced(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysBansDecidedOnConfirmedMalice(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysReleasesIndependent(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysAppealsDecidedByModerators(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysBanAppealsDecidedIndependently(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> alwaysAwardsIdentified(reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> stepBanRecordsPermanent(a, reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> stepProjectReinstatementKeepsAccountBans(a, "reinstateProject", reinstateProject(a, by_, project, decision)))
  ensures (inv(a) ==> canReinstateProject(a, by_, project, decision) ==> stepBansOnlyByDecision(a, "reinstateProject", reinstateProject(a, by_, project, decision)))
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
  requires r.role.ModeratorRole? ==> isModerator(a, r.decidedBy)
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
  forall x | x in a.bans
    ensures projectDecision(b, x.enforcement) == projectDecision(a, x.enforcement)
  {
    ProjectDecisionMeaning(a, x.enforcement);
    ProjectDecisionMeaning(b, x.enforcement);
    var p := (e: Enforcement) => (((e.id == x.enforcement) && e.role.ModeratorRole?) && e.kind.BanAction?);
    assert |ProofLib.Filter(p, xs)| > 0;
    ProofLib.FilterAppend(p, xs, r);
  }
}

lemma ReinstateAccountsAppeals(a: Access, after: Access, by_: int, decision: int, project: int, targets: seq<int>, projectRequest: ProjectRequestRead, sel: seq<Ban>, added: seq<Release>)
  requires inv(a) && canReinstateAccounts(a, by_, decision, project, targets, projectRequest)
  requires after == reinstateAccounts(a, by_, decision, project, targets, projectRequest)
  requires sel == ProofLib.Filter((b: Ban) => (((b.project == project) && (b.target in targets)) && !(released(a, b))), a.bans)
  requires after.releases == a.releases + added && |added| == |sel|
  requires forall i :: 0 <= i < |sel| ==> added[i] == Release(decision, sel[i].enforcement, sel[i].target, by_) && sel[i] in a.bans && banFor(after, sel[i].enforcement, sel[i].target) == sel[i]
  ensures alwaysAppealsDecidedByModerators(after)
  ensures alwaysBanAppealsDecidedIndependently(after)
{
  hide *;
  reveal inv, canReinstateAccounts, reinstateAccounts, alwaysBanAppealsDecidedIndependently,
    isModerator, released, independentOf, selectedBans, banFor, freshDecision, openAppeal;
  var selPred := (b: Ban) => (((b.project == project) && (b.target in targets)) && !(released(a, b)));
  BansUniqueMeaning(a);
  AppealsUniqueMeaning(a);
  forall p0 | p0 in after.appeals
    ensures p0.status.AppealGranted? ==> exists r :: r in after.releases && r.target == p0.target && r.decidedBy == p0.decidedBy && banFor(after, r.enforcement, r.target).project == p0.project
    ensures p0.status.AppealOpen? ==> (exists b :: b in after.bans && b.project == p0.project && b.target == p0.target && !released(after, b))
    ensures p0.status.AppealOpen? ==> |ProofLib.Filter((o: BanAppeal) => (((o.project == p0.project) && (o.target == p0.target)) && o.status.AppealOpen?), after.appeals)| == 1
    ensures !p0.status.AppealOpen? ==> isModerator(after, p0.decidedBy) && p0.decidedBy != p0.target
  {
    var idx :| 0 <= idx < |after.appeals| && after.appeals[idx] == p0;
    var orig := a.appeals[idx];
    if orig.status.AppealOpen? && orig.project == project && orig.target in targets {
      SelectedBansMeaning(a, project, [orig.target]);
      var one := ProofLib.Filter((b: Ban) => (((b.project == project) && (b.target in [orig.target])) && !(released(a, b))), a.bans);
      assert |one| > 0;
      ProofLib.FilterMember((b: Ban) => (((b.project == project) && (b.target in [orig.target])) && !(released(a, b))), a.bans, one[0]);
      ProofLib.FilterMember(selPred, a.bans, one[0]);
      var k :| 0 <= k < |sel| && sel[k] == one[0];
      assert added[k] in after.releases;
    } else if p0.status.AppealOpen? {
      assert orig == p0 && !(p0.project == project && p0.target in targets);
      var b :| b in a.bans && b.project == p0.project && b.target == p0.target && !released(a, b);
      forall r0 | r0 in added
        ensures !(r0.enforcement == b.enforcement && r0.target == b.target)
      {
        var k :| 0 <= k < |sel| && added[k] == r0;
        ProofLib.FilterMember(selPred, a.bans, sel[k]);
        if sel[k].enforcement == b.enforcement && sel[k].target == b.target {
          var pb := (x: Ban) => ((x.enforcement == b.enforcement) && (x.target == b.target));
          ProofLib.FilterMember(pb, a.bans, b);
          ProofLib.FilterMember(pb, a.bans, sel[k]);
          assert |ProofLib.Filter(pb, a.bans)| == 1;
          assert b == ProofLib.Filter(pb, a.bans)[0] && sel[k] == ProofLib.Filter(pb, a.bans)[0];
        }
      }
      assert !released(after, b);
      var q := (o: BanAppeal) => (((o.project == p0.project) && (o.target == p0.target)) && o.status.AppealOpen?);
      ProofLib.FilterLengthPointwise(q, q, a.appeals, after.appeals);
    }
  }
  AppealsUniqueMeaning(after);
}

lemma SameCoreKeepsInv(a: Access, b: Access)
  requires inv(a)
  requires b.enforcements == a.enforcements && b.bans == a.bans && b.awards == a.awards && b.moderators == a.moderators && b.lastAppeal == a.lastAppeal
  requires forall d :: d in a.decisions ==> d in b.decisions
  ensures alwaysProjectBansConfirmed(b) && alwaysEnforcementSequenced(b) && alwaysBansDecidedOnConfirmedMalice(b) && alwaysAwardsIdentified(b)
{
}

lemma reinstateAccounts_ensures(a: Access, by_: int, decision: int, project: int, targets: seq<int>, projectRequest: ProjectRequestRead)
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> alwaysProjectBansConfirmed(reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> alwaysEnforcementSequenced(reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> alwaysBansDecidedOnConfirmedMalice(reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> alwaysReleasesIndependent(reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> alwaysAppealsDecidedByModerators(reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> alwaysBanAppealsDecidedIndependently(reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> alwaysAwardsIdentified(reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> stepBanRecordsPermanent(a, reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> stepProjectReinstatementKeepsAccountBans(a, "reinstateAccounts", reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> stepBansOnlyByDecision(a, "reinstateAccounts", reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> stepFundedAwardsPreserved(a, reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
  ensures (inv(a) ==> canReinstateAccounts(a, by_, decision, project, targets, projectRequest) ==> stepNewAwardOnlyWhenAllowed(a, reinstateAccounts(a, by_, decision, project, targets, projectRequest)))
{
  hide *;
  reveal inv, canReinstateAccounts, reinstateAccounts,
    stepBanRecordsPermanent, stepProjectReinstatementKeepsAccountBans,
    stepBansOnlyByDecision, stepFundedAwardsPreserved, stepNewAwardOnlyWhenAllowed,
    isModerator, released, independentOf, selectedBans, banFor, freshDecision, openAppeal;
  if inv(a) && canReinstateAccounts(a, by_, decision, project, targets, projectRequest) {
    var after := reinstateAccounts(a, by_, decision, project, targets, projectRequest);
    SameCoreKeepsInv(a, after);
    var selPred := (b: Ban) => (((b.project == project) && (b.target in targets)) && !(released(a, b)));
    SelectedBansMeaning(a, project, targets);
    var sel := ProofLib.Filter(selPred, a.bans);
    var added := after.releases[|a.releases|..];
    assert after.releases == a.releases + added;
    assert |added| == |sel|;
    assert forall i :: 0 <= i < |sel| ==> added[i] == Release(decision, sel[i].enforcement, sel[i].target, by_);
    BansUniqueMeaning(a);
    forall i | 0 <= i < |sel|
      ensures sel[i] in a.bans && selPred(sel[i])
      ensures banFor(after, sel[i].enforcement, sel[i].target) == sel[i]
      ensures by_ != sel[i].decidedBy && by_ != sel[i].target
    {
      ProofLib.FilterMember(selPred, a.bans, sel[i]);
      BanForMeaning(after, sel[i].enforcement, sel[i].target);
      var pb := (b: Ban) => ((b.enforcement == sel[i].enforcement) && (b.target == sel[i].target));
      ProofLib.FilterMember(pb, a.bans, sel[i]);
      assert |ProofLib.Filter(pb, a.bans)| == 1;
      assert ProofLib.Filter(pb, a.bans)[0] == sel[i];
    }
    forall i, j | 0 <= i < |sel| && 0 <= j < |sel| && i != j
      ensures !(sel[i].enforcement == sel[j].enforcement && sel[i].target == sel[j].target)
    {
      if sel[i].enforcement == sel[j].enforcement && sel[i].target == sel[j].target {
        var pb := (b: Ban) => ((b.enforcement == sel[i].enforcement) && (b.target == sel[i].target));
        ProofLib.FilterTwo(pb, sel, i, j);
        ProofLib.FilterOfFilterShorter(selPred, pb, a.bans);
      }
    }
    ReleasesUniqueMeaning(a);
    ReinstateReleasesUnique(a.releases, added);
    ReleasesUniqueMeaning(after);
    ReinstateAccountsAppeals(a, after, by_, decision, project, targets, projectRequest, sel, added);
  }
}

lemma lawReinstatementKeepsOtherProjectBans_ensures(a: Access, by_: int, decision: int, project: int, targets: seq<int>, projectRequest: ProjectRequestRead, actor: int)
  ensures (lawReinstatementKeepsOtherProjectBans(a, by_, decision, project, targets, projectRequest, actor) == true)
{
  if alwaysBansDecidedOnConfirmedMalice(a) && canReinstateAccounts(a, by_, decision, project, targets, projectRequest)
    && exists b :: b in a.bans && b.target == actor && b.project != project && !released(a, b) {
    var b :| b in a.bans && b.target == actor && b.project != project && !released(a, b);
    var after := reinstateAccounts(a, by_, decision, project, targets, projectRequest);
    var selPred := (x: Ban) => (((x.project == project) && (x.target in targets)) && !(released(a, x)));
    SelectedBansMeaning(a, project, targets);
    var sel := ProofLib.Filter(selPred, a.bans);
    var added := after.releases[|a.releases|..];
    forall r0 | r0 in added
      ensures !(r0.enforcement == b.enforcement && r0.target == b.target)
    {
      var k :| 0 <= k < |sel| && added[k] == r0;
      ProofLib.FilterMember(selPred, a.bans, sel[k]);
      assert projectDecision(a, sel[k].enforcement).project == project;
      assert projectDecision(a, b.enforcement).project == b.project;
      assert sel[k].enforcement != b.enforcement;
    }
    assert b in after.bans && !released(after, b);
  }
}

lemma denyAppeal_ensures(a: Access, by_: int, project: int, decision: int, projectRequest: ProjectRequestRead)
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> alwaysProjectBansConfirmed(denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> alwaysEnforcementSequenced(denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> alwaysBansDecidedOnConfirmedMalice(denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> alwaysReleasesIndependent(denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> alwaysAppealsDecidedByModerators(denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> alwaysBanAppealsDecidedIndependently(denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> alwaysAwardsIdentified(denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> stepBanRecordsPermanent(a, denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> stepProjectReinstatementKeepsAccountBans(a, "denyAppeal", denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> stepBansOnlyByDecision(a, "denyAppeal", denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> stepFundedAwardsPreserved(a, denyAppeal(a, by_, project, decision, projectRequest)))
  ensures (inv(a) ==> canDenyAppeal(a, by_, project, decision, projectRequest) ==> stepNewAwardOnlyWhenAllowed(a, denyAppeal(a, by_, project, decision, projectRequest)))
{
  if inv(a) && canDenyAppeal(a, by_, project, decision, projectRequest) {
    var after := denyAppeal(a, by_, project, decision, projectRequest);
    OpenAppealsMeaning(a, project);
    AppealsUniqueMeaning(a);
    forall p0 | p0 in after.appeals
      ensures !p0.status.AppealOpen? ==> isModerator(after, p0.decidedBy) && p0.decidedBy != p0.target
      ensures p0.status.AppealOpen? ==> |ProofLib.Filter((o: BanAppeal) => (((o.project == p0.project) && (o.target == p0.target)) && o.status.AppealOpen?), after.appeals)| == 1
    {
      var idx :| 0 <= idx < |after.appeals| && after.appeals[idx] == p0;
      var orig := a.appeals[idx];
      if orig.status.AppealOpen? && orig.project == project {
        ProofLib.FilterMember((p: BanAppeal) => ((p.project == project) && p.status.AppealOpen?), a.appeals, orig);
        assert independentOf(a, by_, project, orig.target);
      } else if p0.status.AppealOpen? {
        assert orig == p0 && p0.project != project;
        var q := (o: BanAppeal) => (((o.project == p0.project) && (o.target == p0.target)) && o.status.AppealOpen?);
        ProofLib.FilterLengthPointwise(q, q, a.appeals, after.appeals);
      }
    }
    AppealsUniqueMeaning(after);
  }
}

lemma reserveAward_ensures(a: Access, by_: int, awardId: int, recipient: int)
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysProjectBansConfirmed(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysEnforcementSequenced(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysBansDecidedOnConfirmedMalice(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysReleasesIndependent(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysAppealsDecidedByModerators(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysBanAppealsDecidedIndependently(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> alwaysAwardsIdentified(reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepBanRecordsPermanent(a, reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepProjectReinstatementKeepsAccountBans(a, "reserveAward", reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepBansOnlyByDecision(a, "reserveAward", reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepFundedAwardsPreserved(a, reserveAward(a, by_, awardId, recipient)))
  ensures (inv(a) ==> canReserveAward(a, by_, awardId, recipient) ==> stepNewAwardOnlyWhenAllowed(a, reserveAward(a, by_, awardId, recipient)))
{
  if inv(a) && canReserveAward(a, by_, awardId, recipient) {
    var added := Award(awardId, recipient, true, false);
    var xs := a.awards;
    AwardsUniqueMeaning(a);
    forall w | w in xs + [added]
      ensures |ProofLib.Filter((x: Award) => (x.id == w.id), xs + [added])| == 1
    {
      ProofLib.FilterAppend((x: Award) => (x.id == w.id), xs, added);
      if w.id == awardId {
        ProofLib.FilterNone((x: Award) => (x.id == w.id), xs);
      }
    }
    AwardsUniqueMeaning(reserveAward(a, by_, awardId, recipient));
  }
}

lemma PayAwardUpdatesAwards(xs: seq<Award>, ys: seq<Award>)
  requires |ys| == |xs|
  requires forall i :: 0 <= i < |xs| ==> ys[i].id == xs[i].id && ys[i].recipient == xs[i].recipient && ys[i].funded == xs[i].funded && (xs[i].paid ==> ys[i].paid)
  requires forall w :: w in xs ==> w.id > 0 && w.recipient > 0 && w.funded && |ProofLib.Filter((x: Award) => (x.id == w.id), xs)| == 1
  ensures forall w :: w in xs ==> exists x :: x in ys && x.id == w.id && x.recipient == w.recipient && x.funded && (!(w.paid) || x.paid)
  ensures forall w :: w in ys ==> w.id > 0 && w.recipient > 0 && w.funded && |ProofLib.Filter((x: Award) => (x.id == w.id), ys)| == 1
  ensures forall w :: w in ys ==> exists x :: x in xs && x.id == w.id
{
  forall w | w in xs
    ensures exists x :: x in ys && x.id == w.id && x.recipient == w.recipient && x.funded && (!(w.paid) || x.paid)
  {
    var i :| 0 <= i < |xs| && xs[i] == w;
    assert ys[i] in ys;
  }
  forall w | w in ys
    ensures w.id > 0 && w.recipient > 0 && w.funded && |ProofLib.Filter((x: Award) => (x.id == w.id), ys)| == 1
    ensures exists x :: x in xs && x.id == w.id
  {
    var i :| 0 <= i < |ys| && ys[i] == w;
    assert xs[i] in xs;
    ProofLib.FilterLengthPointwise((x: Award) => (x.id == w.id), (x: Award) => (x.id == w.id), xs, ys);
  }
}

lemma SameNonAwardsKeepsInv(a: Access, b: Access)
  requires inv(a)
  requires b.enforcements == a.enforcements && b.bans == a.bans && b.releases == a.releases && b.appeals == a.appeals && b.decisions == a.decisions && b.moderators == a.moderators && b.lastAppeal == a.lastAppeal
  ensures alwaysProjectBansConfirmed(b) && alwaysEnforcementSequenced(b) && alwaysBansDecidedOnConfirmedMalice(b) && alwaysReleasesIndependent(b) && alwaysAppealsDecidedByModerators(b) && alwaysBanAppealsDecidedIndependently(b)
  ensures stepBanRecordsPermanent(a, b) && stepProjectReinstatementKeepsAccountBans(a, "payAward", b) && stepBansOnlyByDecision(a, "payAward", b)
{
}

lemma payAward_ensures(a: Access, by_: int, awardId: int)
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysProjectBansConfirmed(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysEnforcementSequenced(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysBansDecidedOnConfirmedMalice(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysReleasesIndependent(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysAppealsDecidedByModerators(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysBanAppealsDecidedIndependently(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> alwaysAwardsIdentified(payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepBanRecordsPermanent(a, payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepProjectReinstatementKeepsAccountBans(a, "payAward", payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepBansOnlyByDecision(a, "payAward", payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepFundedAwardsPreserved(a, payAward(a, by_, awardId)))
  ensures (inv(a) ==> canPayAward(a, by_, awardId) ==> stepNewAwardOnlyWhenAllowed(a, payAward(a, by_, awardId)))
{
  hide *;
  reveal inv, canPayAward, payAward, stepFundedAwardsPreserved, stepNewAwardOnlyWhenAllowed;
  if inv(a) && canPayAward(a, by_, awardId) {
    var after := payAward(a, by_, awardId);
    SameNonAwardsKeepsInv(a, after);
    AwardsUniqueMeaning(a);
    PayAwardUpdatesAwards(a.awards, after.awards);
    AwardsUniqueMeaning(after);
  }
}

lemma appeal_ensures(a: Access, by_: int, project: int)
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> alwaysProjectBansConfirmed(appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> alwaysEnforcementSequenced(appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> alwaysBansDecidedOnConfirmedMalice(appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> alwaysReleasesIndependent(appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> alwaysAppealsDecidedByModerators(appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> alwaysBanAppealsDecidedIndependently(appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> alwaysAwardsIdentified(appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> stepBanRecordsPermanent(a, appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> stepProjectReinstatementKeepsAccountBans(a, "appeal", appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> stepBansOnlyByDecision(a, "appeal", appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> stepFundedAwardsPreserved(a, appeal(a, by_, project)))
  ensures (inv(a) ==> canAppeal(a, by_, project) ==> stepNewAwardOnlyWhenAllowed(a, appeal(a, by_, project)))
{
  if inv(a) && canAppeal(a, by_, project) {
    var added := BanAppeal((a.lastAppeal + 1), project, by_, AppealStatus.AppealOpen, 0);
    var after := appeal(a, by_, project);
    assert after.appeals == a.appeals + [added];
    assert after.bans == a.bans && after.releases == a.releases;
    AppealsUniqueMeaning(a);
    forall p | p in after.appeals && p.status.AppealOpen?
      ensures |ProofLib.Filter((o: BanAppeal) => (((o.project == p.project) && (o.target == p.target)) && o.status.AppealOpen?), after.appeals)| == 1
    {
      var q := (o: BanAppeal) => (((o.project == p.project) && (o.target == p.target)) && o.status.AppealOpen?);
      ProofLib.FilterAppend(q, a.appeals, added);
      if p == added {
        ProofLib.FilterNone(q, a.appeals);
      }
    }
    AppealsUniqueMeaning(after);
  }
}
