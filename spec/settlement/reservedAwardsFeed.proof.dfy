lemma FeedRowsFilter(awards: seq<ReservedAward>, team: seq<int>, closed: seq<int>, staging: bool)
  ensures feedRows(awards, team, closed, staging) == Std.Collections.Seq.FoldLeft((rows: seq<FeedRow>, o: ReservedAward) => (if (exists r :: r in rows && sameRow(r, o)) then seq(|rows|, i_map requires 0 <= i_map < |rows| => var r := rows[i_map]; (if sameRow(r, o) then r.(needs := mergedNeed(r.needs, needOf(o.confirmed))) else r)) else (rows + [FeedRow(o.actor, o.project, o.network, needOf(o.confirmed))])), [], ProofLib.Filter((o: ReservedAward) => listedAward(o, team, closed, staging), awards))
{
}

lemma OneRowPerAccountFilter(awards: seq<ReservedAward>, team: seq<int>, closed: seq<int>, staging: bool)
  ensures lawOneRowPerAccountAndProject(awards, team, closed, staging) == (var local_0 := feedRows(awards, team, closed, staging); !((exists r :: r in local_0 && !((|ProofLib.Filter((x: FeedRow) => ((x.actor == r.actor) && (x.project == r.project)), local_0)| == 1)))))
{
}

lemma FoldFeedProperties(acc: seq<FeedRow>, xs: seq<ReservedAward>)
  requires forall i, j :: 0 <= i < |acc| && 0 <= j < |acc| && i != j ==> !(acc[i].actor == acc[j].actor && acc[i].project == acc[j].project)
  ensures var res := Std.Collections.Seq.FoldLeft((rows: seq<FeedRow>, o: ReservedAward) => (if (exists r :: r in rows && sameRow(r, o)) then seq(|rows|, i_map requires 0 <= i_map < |rows| => var r := rows[i_map]; (if sameRow(r, o) then r.(needs := mergedNeed(r.needs, needOf(o.confirmed))) else r)) else (rows + [FeedRow(o.actor, o.project, o.network, needOf(o.confirmed))])), acc, xs);
    (forall i, j :: 0 <= i < |res| && 0 <= j < |res| && i != j ==> !(res[i].actor == res[j].actor && res[i].project == res[j].project))
    && (forall r :: r in res && ((exists a :: a in acc && a.actor == r.actor && a.project == r.project && a.needs.NeedsWallet?) || (exists o :: o in xs && sameRow(r, o) && !o.confirmed)) ==> r.needs.NeedsWallet?)
  decreases |xs|
{
  if |xs| > 0 {
    var o := xs[0];
    var next := if (exists r :: r in acc && sameRow(r, o)) then seq(|acc|, i_map requires 0 <= i_map < |acc| => var r := acc[i_map]; (if sameRow(r, o) then r.(needs := mergedNeed(r.needs, needOf(o.confirmed))) else r)) else (acc + [FeedRow(o.actor, o.project, o.network, needOf(o.confirmed))]);
    forall i, j | 0 <= i < |next| && 0 <= j < |next| && i != j
      ensures !(next[i].actor == next[j].actor && next[i].project == next[j].project)
    {
      if exists r :: r in acc && sameRow(r, o) {
        assert next[i].actor == acc[i].actor && next[i].project == acc[i].project;
        assert next[j].actor == acc[j].actor && next[j].project == acc[j].project;
      } else {
        if i < |acc| && j == |acc| {
          assert acc[i] in acc;
          assert !sameRow(acc[i], o);
        } else if i == |acc| && j < |acc| {
          assert acc[j] in acc;
          assert !sameRow(acc[j], o);
        }
      }
    }
    FoldFeedProperties(next, xs[1..]);
    var res := Std.Collections.Seq.FoldLeft((rows: seq<FeedRow>, o: ReservedAward) => (if (exists r :: r in rows && sameRow(r, o)) then seq(|rows|, i_map requires 0 <= i_map < |rows| => var r := rows[i_map]; (if sameRow(r, o) then r.(needs := mergedNeed(r.needs, needOf(o.confirmed))) else r)) else (rows + [FeedRow(o.actor, o.project, o.network, needOf(o.confirmed))])), acc, xs);
    forall r | r in res && ((exists a :: a in acc && a.actor == r.actor && a.project == r.project && a.needs.NeedsWallet?) || (exists w :: w in xs && sameRow(r, w) && !w.confirmed))
      ensures r.needs.NeedsWallet?
    {
      if exists a :: a in acc && a.actor == r.actor && a.project == r.project && a.needs.NeedsWallet? {
        var i :| 0 <= i < |acc| && acc[i].actor == r.actor && acc[i].project == r.project && acc[i].needs.NeedsWallet?;
        assert next[i] in next;
        assert next[i].actor == r.actor && next[i].project == r.project && next[i].needs.NeedsWallet?;
      } else if sameRow(r, o) && !o.confirmed {
        if exists a :: a in acc && sameRow(a, o) {
          var i :| 0 <= i < |acc| && sameRow(acc[i], o);
          assert next[i] in next;
          assert next[i].actor == r.actor && next[i].project == r.project && next[i].needs.NeedsWallet?;
        } else {
          assert next[|acc|] in next;
          assert next[|acc|].actor == r.actor && next[|acc|].project == r.project && next[|acc|].needs.NeedsWallet?;
        }
      } else {
        var w :| w in xs && sameRow(r, w) && !w.confirmed;
        assert w in xs[1..];
      }
    }
  } else {
    forall r | r in acc && (exists a :: a in acc && a.actor == r.actor && a.project == r.project && a.needs.NeedsWallet?)
      ensures r.needs.NeedsWallet?
    {
      var i :| 0 <= i < |acc| && acc[i] == r;
      var j :| 0 <= j < |acc| && acc[j].actor == r.actor && acc[j].project == r.project && acc[j].needs.NeedsWallet?;
      assert i == j;
    }
  }
}

lemma lawTeamAndClosedNotListed_ensures(o: ReservedAward, team: seq<int>, closed: seq<int>, staging: bool)
  ensures (lawTeamAndClosedNotListed(o, team, closed, staging) == true)
{
  if (o.actor in team) || (o.actor in closed) {
    FeedRowsFilter([o], team, closed, staging);
    ProofLib.FilterNone((x: ReservedAward) => listedAward(x, team, closed, staging), [o]);
  }
}

lemma lawMissingWalletWins_ensures(awards: seq<ReservedAward>, team: seq<int>, closed: seq<int>, staging: bool)
  ensures (lawMissingWalletWins(awards, team, closed, staging) == true)
{
  FeedRowsFilter(awards, team, closed, staging);
  var filtered := ProofLib.Filter((o: ReservedAward) => listedAward(o, team, closed, staging), awards);
  FoldFeedProperties([], filtered);
  var rows := feedRows(awards, team, closed, staging);
  forall r | r in rows
    ensures (exists o :: o in awards && sameRow(r, o) && listedAward(o, team, closed, staging) && !o.confirmed) ==> r.needs.NeedsWallet?
  {
    if exists o :: o in awards && sameRow(r, o) && listedAward(o, team, closed, staging) && !o.confirmed {
      var o :| o in awards && sameRow(r, o) && listedAward(o, team, closed, staging) && !o.confirmed;
      ProofLib.FilterMember((x: ReservedAward) => listedAward(x, team, closed, staging), awards, o);
      assert o in filtered;
    }
  }
}

lemma lawOneRowPerAccountAndProject_ensures(awards: seq<ReservedAward>, team: seq<int>, closed: seq<int>, staging: bool)
  ensures (lawOneRowPerAccountAndProject(awards, team, closed, staging) == true)
{
  FeedRowsFilter(awards, team, closed, staging);
  OneRowPerAccountFilter(awards, team, closed, staging);
  var filtered := ProofLib.Filter((o: ReservedAward) => listedAward(o, team, closed, staging), awards);
  FoldFeedProperties([], filtered);
  var rows := feedRows(awards, team, closed, staging);
  forall r | r in rows
    ensures |ProofLib.Filter((x: FeedRow) => ((x.actor == r.actor) && (x.project == r.project)), rows)| == 1
  {
    var i :| 0 <= i < |rows| && rows[i] == r;
    ProofLib.FilterOne((x: FeedRow) => ((x.actor == r.actor) && (x.project == r.project)), rows, i);
  }
}
