lemma RowsDistinctMeaning(p: Profiles)
  ensures alwaysRowsDistinct(p) == (!((exists r :: r in p.rows && !((|ProofLib.Filter((o: RepositoryRow) => (o.repository == r.repository), p.rows)| == 1)))) && !((exists r :: r in p.publishedRows && !((|ProofLib.Filter((o: RepositoryRow) => (o.repository == r.repository), p.publishedRows)| == 1)))))
{
}

lemma BeginRowsMeaning(p: Profiles, targets: seq<Target>)
  ensures begin(p, targets).rows == ProofLib.Filter((r: RepositoryRow) => carried(r, targets), p.publishedRows)
{
}

lemma CanBeginMeaning(p: Profiles, targets: seq<Target>)
  ensures canBegin(p, targets) == ((p.phase.Idle? && (|targets| > 0)) && !((exists t :: t in targets && !(((((t.repository > 0) && (t.canonical > 0)) && (|ProofLib.Filter((o: Target) => (o.repository == t.repository), targets)| == 1)) && (|ProofLib.Filter((o: Target) => (o.canonical == t.canonical), targets)| == 1))))))
{
}

lemma OneRowPerIdentityMeaning(p: Profiles)
  ensures alwaysOneRowPerCollectedIdentity(p) == (!(p.phase.Collecting?) || !((exists t :: t in p.targets && !(((((t.repository > 0) && (t.canonical > 0)) && (|ProofLib.Filter((o: Target) => (o.canonical == t.canonical), p.targets)| == 1)) && (|ProofLib.Filter((r: RepositoryRow) => (r.canonical == t.canonical), p.rows)| <= 1))))))
{
}

lemma ReconciledMeaning(p: Profiles)
  ensures alwaysReconciledRepositoriesCollected(p) == !((exists r :: r in p.issuesReconciled && !((collectedName(p.targets, r) && (|ProofLib.Filter((o: int) => (o == r), p.issuesReconciled)| == 1)))))
{
}

lemma IssuesDistinctMeaning(p: Profiles)
  ensures alwaysIssuesDistinct(p) == (!((exists i :: i in p.issues && !(((i.id > 0) && (|ProofLib.Filter((o: ProfileIssue) => (o.id == i.id), p.issues)| == 1))))) && !((exists i :: i in p.publishedIssues && !(((i.id > 0) && (|ProofLib.Filter((o: ProfileIssue) => (o.id == i.id), p.publishedIssues)| == 1))))))
{
}

lemma RetainedIssuesMeaning(p: Profiles)
  ensures retainedIssues(p) == (var s_map := ProofLib.Filter((old_: ProfileIssue) => !((exists i :: i in p.issues && (i.id == old_.id))), p.publishedIssues); seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var old_ := s_map[i_map]; (if collectedName(p.targets, old_.repository) then old_.(unavailable := true) else old_)))
{
}

lemma begin_ensures(p: Profiles, targets: seq<Target>)
  ensures (inv(p) ==> canBegin(p, targets) ==> alwaysRowsDistinct(begin(p, targets)))
  ensures (inv(p) ==> canBegin(p, targets) ==> alwaysCarriedRowsKept(begin(p, targets)))
  ensures (inv(p) ==> canBegin(p, targets) ==> alwaysOneRowPerCollectedIdentity(begin(p, targets)))
  ensures (inv(p) ==> canBegin(p, targets) ==> alwaysRowsCollectedOrCarried(begin(p, targets)))
  ensures (inv(p) ==> canBegin(p, targets) ==> alwaysReconciledRepositoriesCollected(begin(p, targets)))
  ensures (inv(p) ==> canBegin(p, targets) ==> alwaysIssuesDistinct(begin(p, targets)))
  ensures (inv(p) ==> canBegin(p, targets) ==> stepPublicationKeepsCarriedRows(p, begin(p, targets)))
  ensures (inv(p) ==> canBegin(p, targets) ==> stepPublicationReconcilesIssues(p, begin(p, targets)))
  ensures (inv(p) ==> canBegin(p, targets) ==> stepPublishedIssuesNeverDropped(p, begin(p, targets)))
  ensures (inv(p) ==> canBegin(p, targets) ==> stepFailureKeepsPublished(p, begin(p, targets)))
{
  if inv(p) && canBegin(p, targets) {
    RowsDistinctMeaning(p);
    CanBeginMeaning(p, targets);
    BeginRowsMeaning(p, targets);
    var after := begin(p, targets);
    forall r | r in after.rows
      ensures |ProofLib.Filter((o: RepositoryRow) => (o.repository == r.repository), after.rows)| == 1
    {
      ProofLib.FilterMember((r: RepositoryRow) => carried(r, targets), p.publishedRows, r);
      ProofLib.FilterOfFilterShorter((r: RepositoryRow) => carried(r, targets), (o: RepositoryRow) => (o.repository == r.repository), p.publishedRows);
      ProofLib.FilterMember((o: RepositoryRow) => (o.repository == r.repository), after.rows, r);
    }
    forall r | r in p.publishedRows
      ensures !carried(r, targets) || r in after.rows
    {
      ProofLib.FilterMember((r: RepositoryRow) => carried(r, targets), p.publishedRows, r);
    }
    forall t | t in targets
      ensures t.repository > 0 && t.canonical > 0 && |ProofLib.Filter((o: Target) => (o.canonical == t.canonical), targets)| == 1 && |ProofLib.Filter((r: RepositoryRow) => (r.canonical == t.canonical), after.rows)| <= 1
    {
      forall j | 0 <= j < |after.rows|
        ensures !(after.rows[j].canonical == t.canonical)
      {
        ProofLib.FilterMember((r: RepositoryRow) => carried(r, targets), p.publishedRows, after.rows[j]);
      }
      ProofLib.FilterNone((r: RepositoryRow) => (r.canonical == t.canonical), after.rows);
    }
    RowsDistinctMeaning(after);
    OneRowPerIdentityMeaning(after);
  }
}

lemma recordRepository_ensures(p: Profiles, tally: RepositoryTally)
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> alwaysRowsDistinct(recordRepository(p, tally)))
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> alwaysCarriedRowsKept(recordRepository(p, tally)))
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> alwaysOneRowPerCollectedIdentity(recordRepository(p, tally)))
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> alwaysRowsCollectedOrCarried(recordRepository(p, tally)))
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> alwaysReconciledRepositoriesCollected(recordRepository(p, tally)))
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> alwaysIssuesDistinct(recordRepository(p, tally)))
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> stepPublicationKeepsCarriedRows(p, recordRepository(p, tally)))
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> stepPublicationReconcilesIssues(p, recordRepository(p, tally)))
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> stepPublishedIssuesNeverDropped(p, recordRepository(p, tally)))
  ensures (inv(p) ==> canRecordRepository(p, tally) ==> stepFailureKeepsPublished(p, recordRepository(p, tally)))
{
  if inv(p) && canRecordRepository(p, tally) {
    RowsDistinctMeaning(p);
    OneRowPerIdentityMeaning(p);
    var n := RepositoryRow(tally.repository, tally.canonical, tally.crawled, tally.excluded);
    var after := recordRepository(p, tally);
    forall r | r in after.rows
      ensures |ProofLib.Filter((o: RepositoryRow) => (o.repository == r.repository), after.rows)| == 1
    {
      ProofLib.FilterAppend((o: RepositoryRow) => (o.repository == r.repository), p.rows, n);
      if r.repository == n.repository {
        ProofLib.FilterNone((o: RepositoryRow) => (o.repository == r.repository), p.rows);
      }
    }
    var i0 :| 0 <= i0 < |p.targets| && p.targets[i0].repository == tally.repository && p.targets[i0].canonical == tally.canonical;
    forall t | t in p.targets
      ensures |ProofLib.Filter((r: RepositoryRow) => (r.canonical == t.canonical), after.rows)| <= 1
    {
      ProofLib.FilterAppend((r: RepositoryRow) => (r.canonical == t.canonical), p.rows, n);
      if n.canonical == t.canonical {
        forall j | 0 <= j < |p.rows|
          ensures !(p.rows[j].canonical == t.canonical)
        {
          if p.rows[j].canonical == t.canonical {
            var r := p.rows[j];
            assert !carried(r, p.targets);
            var i1 :| 0 <= i1 < |p.targets| && p.targets[i1].repository == r.repository && p.targets[i1].canonical == r.canonical;
            if i1 != i0 {
              ProofLib.FilterTwo((o: Target) => (o.canonical == t.canonical), p.targets, i0, i1);
            }
            assert i1 == i0;
            assert r.repository == tally.repository;
          }
        }
        ProofLib.FilterNone((r: RepositoryRow) => (r.canonical == t.canonical), p.rows);
      }
    }
    RowsDistinctMeaning(after);
    OneRowPerIdentityMeaning(after);
  }
}

lemma recordIssue_ensures(p: Profiles, issue: ObservedIssue)
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> alwaysRowsDistinct(recordIssue(p, issue)))
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> alwaysCarriedRowsKept(recordIssue(p, issue)))
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> alwaysOneRowPerCollectedIdentity(recordIssue(p, issue)))
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> alwaysRowsCollectedOrCarried(recordIssue(p, issue)))
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> alwaysReconciledRepositoriesCollected(recordIssue(p, issue)))
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> alwaysIssuesDistinct(recordIssue(p, issue)))
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> stepPublicationKeepsCarriedRows(p, recordIssue(p, issue)))
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> stepPublicationReconcilesIssues(p, recordIssue(p, issue)))
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> stepPublishedIssuesNeverDropped(p, recordIssue(p, issue)))
  ensures (inv(p) ==> canRecordIssue(p, issue) ==> stepFailureKeepsPublished(p, recordIssue(p, issue)))
{
  if inv(p) && canRecordIssue(p, issue) {
    IssuesDistinctMeaning(p);
    var n := ProfileIssue(issue.id, issue.repository, false, !issue.eventsReproduceState);
    var after := recordIssue(p, issue);
    forall x | x in after.issues
      ensures x.id > 0 && |ProofLib.Filter((o: ProfileIssue) => (o.id == x.id), after.issues)| == 1
    {
      ProofLib.FilterAppend((o: ProfileIssue) => (o.id == x.id), p.issues, n);
      if x.id == n.id {
        ProofLib.FilterNone((o: ProfileIssue) => (o.id == x.id), p.issues);
      }
    }
    IssuesDistinctMeaning(after);
  }
}

lemma reconcileIssues_ensures(p: Profiles, issueTally: IssueTally)
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> alwaysRowsDistinct(reconcileIssues(p, issueTally)))
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> alwaysCarriedRowsKept(reconcileIssues(p, issueTally)))
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> alwaysOneRowPerCollectedIdentity(reconcileIssues(p, issueTally)))
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> alwaysRowsCollectedOrCarried(reconcileIssues(p, issueTally)))
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> alwaysReconciledRepositoriesCollected(reconcileIssues(p, issueTally)))
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> alwaysIssuesDistinct(reconcileIssues(p, issueTally)))
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> stepPublicationKeepsCarriedRows(p, reconcileIssues(p, issueTally)))
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> stepPublicationReconcilesIssues(p, reconcileIssues(p, issueTally)))
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> stepPublishedIssuesNeverDropped(p, reconcileIssues(p, issueTally)))
  ensures (inv(p) ==> canReconcileIssues(p, issueTally) ==> stepFailureKeepsPublished(p, reconcileIssues(p, issueTally)))
{
  if inv(p) && canReconcileIssues(p, issueTally) {
    ReconciledMeaning(p);
    var after := reconcileIssues(p, issueTally);
    forall r | r in after.issuesReconciled
      ensures collectedName(after.targets, r) && |ProofLib.Filter((o: int) => (o == r), after.issuesReconciled)| == 1
    {
      ProofLib.FilterAppend((o: int) => (o == r), p.issuesReconciled, issueTally.repository);
      if r == issueTally.repository {
        ProofLib.FilterNone((o: int) => (o == r), p.issuesReconciled);
      }
    }
    ReconciledMeaning(after);
  }
}

lemma publish_ensures(p: Profiles)
  ensures (inv(p) ==> canPublish(p) ==> alwaysRowsDistinct(publish(p)))
  ensures (inv(p) ==> canPublish(p) ==> alwaysCarriedRowsKept(publish(p)))
  ensures (inv(p) ==> canPublish(p) ==> alwaysOneRowPerCollectedIdentity(publish(p)))
  ensures (inv(p) ==> canPublish(p) ==> alwaysRowsCollectedOrCarried(publish(p)))
  ensures (inv(p) ==> canPublish(p) ==> alwaysReconciledRepositoriesCollected(publish(p)))
  ensures (inv(p) ==> canPublish(p) ==> alwaysIssuesDistinct(publish(p)))
  ensures (inv(p) ==> canPublish(p) ==> stepPublicationKeepsCarriedRows(p, publish(p)))
  ensures (inv(p) ==> canPublish(p) ==> stepPublicationReconcilesIssues(p, publish(p)))
  ensures (inv(p) ==> canPublish(p) ==> stepPublishedIssuesNeverDropped(p, publish(p)))
  ensures (inv(p) ==> canPublish(p) ==> stepFailureKeepsPublished(p, publish(p)))
{
  if inv(p) && canPublish(p) {
    IssuesDistinctMeaning(p);
    RetainedIssuesMeaning(p);
    var after := publish(p);
    var s_map := ProofLib.Filter((old_: ProfileIssue) => !((exists i :: i in p.issues && (i.id == old_.id))), p.publishedIssues);
    var ret := retainedIssues(p);
    assert |ret| == |s_map|;
    assert forall k :: 0 <= k < |ret| ==> ret[k].id == s_map[k].id;
    assert ProofLib.DistinctBy(p.issues, (x: ProfileIssue) => x.id) by {
      forall i, j | 0 <= i < |p.issues| && 0 <= j < |p.issues| && i != j
        ensures p.issues[i].id != p.issues[j].id
      {
        if p.issues[i].id == p.issues[j].id {
          ProofLib.FilterTwo((o: ProfileIssue) => (o.id == p.issues[i].id), p.issues, i, j);
        }
      }
    }
    assert ProofLib.DistinctBy(p.publishedIssues, (x: ProfileIssue) => x.id) by {
      forall i, j | 0 <= i < |p.publishedIssues| && 0 <= j < |p.publishedIssues| && i != j
        ensures p.publishedIssues[i].id != p.publishedIssues[j].id
      {
        if p.publishedIssues[i].id == p.publishedIssues[j].id {
          ProofLib.FilterTwo((o: ProfileIssue) => (o.id == p.publishedIssues[i].id), p.publishedIssues, i, j);
        }
      }
    }
    ProofLib.FilterKeepsDistinctBy((old_: ProfileIssue) => !((exists i :: i in p.issues && (i.id == old_.id))), p.publishedIssues, (x: ProfileIssue) => x.id);
    assert ProofLib.DistinctBy(ret, (x: ProfileIssue) => x.id);
    forall x, y | x in p.issues && y in ret
      ensures x.id != y.id
    {
      var k :| 0 <= k < |ret| && ret[k] == y;
      ProofLib.FilterMember((old_: ProfileIssue) => !((exists i :: i in p.issues && (i.id == old_.id))), p.publishedIssues, s_map[k]);
    }
    ProofLib.DistinctByConcat(p.issues, ret, (x: ProfileIssue) => x.id);
    forall x | x in after.publishedIssues
      ensures x.id > 0 && |ProofLib.Filter((o: ProfileIssue) => (o.id == x.id), after.publishedIssues)| == 1
    {
      var idx :| 0 <= idx < |after.publishedIssues| && after.publishedIssues[idx] == x;
      if idx >= |p.issues| {
        var k := idx - |p.issues|;
        ProofLib.FilterMember((old_: ProfileIssue) => !((exists i :: i in p.issues && (i.id == old_.id))), p.publishedIssues, s_map[k]);
        assert s_map[k] in p.publishedIssues;
      }
      ProofLib.FilterOne((o: ProfileIssue) => (o.id == x.id), after.publishedIssues, idx);
    }
    forall old_ | old_ in p.publishedIssues
      ensures exists i :: i in after.publishedIssues && i.id == old_.id
    {
      if exists i :: i in p.issues && i.id == old_.id {
        var i :| i in p.issues && i.id == old_.id;
        assert i in after.publishedIssues;
      } else {
        ProofLib.FilterMember((old_: ProfileIssue) => !((exists i :: i in p.issues && (i.id == old_.id))), p.publishedIssues, old_);
        var k :| 0 <= k < |s_map| && s_map[k] == old_;
        assert ret[k] in after.publishedIssues && ret[k].id == old_.id;
      }
    }
    IssuesDistinctMeaning(after);
  }
}
