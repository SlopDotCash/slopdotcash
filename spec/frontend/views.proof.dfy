lemma MonthShareUsesFilter(history: seq<backend__projects_ShareEntry>, setting: int, period: int)
  ensures backend__projects_monthShareOf(history, setting, period) == (var kept := ProofLib.Filter((e: backend__projects_ShareEntry) => (period <= e.throughMonth), history); (if 0 < |kept| then kept[0] else backend__projects_ShareEntry(0, setting)).basisPoints)
{
}

lemma WantedOrderUsesFilter(issues: seq<WantedIssue>)
  ensures wantedOrder(issues) == Std.Collections.Seq.FoldLeft((kept: seq<WantedIssue>, i: WantedIssue) => (if (|kept| < wantedShown) then (kept + [i]) else kept), [], (ProofLib.Filter((i: WantedIssue) => (i.openPulls == 0), issues) + ProofLib.Filter((i: WantedIssue) => (i.openPulls > 0), issues)))
{
}

lemma ShownCyclesUsesFilter(cycles: seq<CycleRecord>, archiveFilter: ArchiveFilter)
  ensures shownCycles(cycles, archiveFilter) == ProofLib.Filter((c: CycleRecord) => cycleMatches(c, archiveFilter), cycles)
{
}

lemma TakeFoldBound(acc: seq<WantedIssue>, xs: seq<WantedIssue>)
  requires |acc| <= wantedShown
  ensures |Std.Collections.Seq.FoldLeft((kept: seq<WantedIssue>, i: WantedIssue) => (if (|kept| < wantedShown) then (kept + [i]) else kept), acc, xs)| <= wantedShown
  decreases |xs|
{
  if |xs| > 0 {
    var next := if |acc| < wantedShown then acc + [xs[0]] else acc;
    TakeFoldBound(next, xs[1..]);
  }
}

lemma TakeFoldKeepsHead(acc: seq<WantedIssue>, xs: seq<WantedIssue>)
  requires |acc| > 0
  ensures var res := Std.Collections.Seq.FoldLeft((kept: seq<WantedIssue>, i: WantedIssue) => (if (|kept| < wantedShown) then (kept + [i]) else kept), acc, xs); |res| >= |acc| && res[0] == acc[0]
  decreases |xs|
{
  if |xs| > 0 {
    var next := if |acc| < wantedShown then acc + [xs[0]] else acc;
    assert |next| >= |acc| && next[0] == acc[0];
    TakeFoldKeepsHead(next, xs[1..]);
  }
}

lemma FilterKeepsAll<T>(p: T -> bool, xs: seq<T>)
  requires forall x :: x in xs ==> p(x)
  ensures ProofLib.Filter(p, xs) == xs
  decreases |xs|
{
  if |xs| == 0 {
    ProofLib.FilterNil(p, xs);
  } else {
    ProofLib.FilterCons(p, xs);
    FilterKeepsAll(p, xs[1..]);
  }
}

lemma lawHistoryKeepsTheOpenMonth_ensures(setting: int, period: int, basisPoints: int)
  ensures (lawHistoryKeepsTheOpenMonth(setting, period, basisPoints) == true)
{
  var entry := backend__projects_ShareEntry(period, basisPoints);
  var p := (e: backend__projects_ShareEntry) => (period <= e.throughMonth);
  MonthShareUsesFilter([entry], setting, period);
  ProofLib.FilterCons(p, [entry]);
  ProofLib.FilterNil(p, [entry][1..]);
}

lemma lawMonthShareIsAnEntryOrTheSetting_ensures(history: seq<backend__projects_ShareEntry>, setting: int, period: int)
  ensures (lawMonthShareIsAnEntryOrTheSetting(history, setting, period) == true)
{
  var p := (e: backend__projects_ShareEntry) => (period <= e.throughMonth);
  MonthShareUsesFilter(history, setting, period);
  var kept := ProofLib.Filter(p, history);
  if 0 < |kept| {
    ProofLib.FilterMember(p, history, kept[0]);
  }
}

lemma lawUnclaimedFirst_ensures(issues: seq<WantedIssue>)
  ensures (lawUnclaimedFirst(issues) == true)
{
  if exists i :: i in issues && (i.openPulls == 0) {
    var u :| u in issues && u.openPulls == 0;
    var p0 := (i: WantedIssue) => (i.openPulls == 0);
    var p1 := (i: WantedIssue) => (i.openPulls > 0);
    WantedOrderUsesFilter(issues);
    var unclaimed := ProofLib.Filter(p0, issues);
    var combined := unclaimed + ProofLib.Filter(p1, issues);
    ProofLib.FilterMember(p0, issues, u);
    assert |unclaimed| > 0;
    ProofLib.FilterMember(p0, issues, unclaimed[0]);
    assert combined[0] == unclaimed[0];
    var f := (kept: seq<WantedIssue>, i: WantedIssue) => (if (|kept| < wantedShown) then (kept + [i]) else kept);
    var empty: seq<WantedIssue> := [];
    assert f(empty, combined[0]) == [combined[0]];
    assert Std.Collections.Seq.FoldLeft(f, empty, combined) == Std.Collections.Seq.FoldLeft(f, [combined[0]], combined[1..]);
    TakeFoldKeepsHead([combined[0]], combined[1..]);
  }
}

lemma lawAtMostTen_ensures(issues: seq<WantedIssue>)
  ensures (lawAtMostTen(issues) == true)
{
  WantedOrderUsesFilter(issues);
  var combined := ProofLib.Filter((i: WantedIssue) => (i.openPulls == 0), issues) + ProofLib.Filter((i: WantedIssue) => (i.openPulls > 0), issues);
  TakeFoldBound([], combined);
}

lemma lawNoSelectionShowsEveryCycle_ensures(cycles: seq<CycleRecord>)
  ensures (lawNoSelectionShowsEveryCycle(cycles) == true)
{
  var empty := ArchiveFilter("", "", "");
  ShownCyclesUsesFilter(cycles, empty);
  FilterKeepsAll((c: CycleRecord) => cycleMatches(c, empty), cycles);
}
