// The failed-label fold preserves an empty accumulator when every row is healthy.
lemma NoFailedLabels(results: seq<DiagnosticResult>, prior: seq<DiagnosticKey>)
  requires forall row :: row in results ==> !resultFailed(row)
  ensures Std.Collections.Seq.FoldLeft((labels: seq<DiagnosticKey>, row: DiagnosticResult) => (if resultFailed(row) then (labels + [diagnosticKey(row)]) else labels), prior, results) == prior
  decreases |results|
{
  if |results| > 0 {
    NoFailedLabels(results[1..], prior);
  }
}

lemma lawHealthyWorkStaysSilent_ensures(results: seq<DiagnosticResult>)
  ensures (lawHealthyWorkStaysSilent(results) == true)
{
  if forall row :: row in results ==> !resultFailed(row) {
    NoFailedLabels(results, []);
    assert failedKeys(results) == [];
    assert positiveGroups([]) == [];
  }
}

// Mapping a single key increments exactly one count because keys are unique.
lemma CountOneGroup(groups: seq<Group>, mapped: seq<Group>, label_: DiagnosticKey, base: int, mappedBase: int)
  requires |groups| == |mapped|
  requires forall i :: 0 <= i < |groups| ==> (mapped[i] ==
    (if groups[i].key == label_ then groups[i].(count := groups[i].count + 1) else groups[i]))
  ensures Std.Collections.Seq.FoldLeft((total: int, group: Group) => (total + group.count), mappedBase, mapped) ==
    Std.Collections.Seq.FoldLeft((total: int, group: Group) => (total + group.count), base, groups) +
    mappedBase - base + |ProofLib.Filter((g: Group) => g.key == label_, groups)|
  decreases |groups|
{
  if |groups| > 0 {
    CountOneGroup(groups[1..], mapped[1..], label_, base + groups[0].count, mappedBase + mapped[0].count);
    ProofLib.FilterCons((g: Group) => g.key == label_, groups);
  }
}

lemma AddGroupPreservesCounts(groups: seq<Group>, label_: DiagnosticKey)
  requires ProofLib.DistinctBy(groups, (g: Group) => g.key)
  requires forall g :: g in groups ==> g.count > 0
  ensures ProofLib.DistinctBy(addGroup(groups, label_), (g: Group) => g.key)
  ensures forall g :: g in addGroup(groups, label_) ==> g.count > 0
  ensures totalCounts(addGroup(groups, label_)) == totalCounts(groups) + 1
{
  var next := addGroup(groups, label_);
  if exists group :: group in groups && group.key == label_ {
    var index :| 0 <= index < |groups| && groups[index].key == label_;
    assert |next| == |groups|;
    assert forall i :: 0 <= i < |groups| ==> (next[i] ==
      (if groups[i].key == label_ then groups[i].(count := groups[i].count + 1) else groups[i]));
    assert forall i :: 0 <= i < |groups| && i != index ==> groups[i].key != label_;
    ProofLib.FilterOne((g: Group) => g.key == label_, groups, index);
    CountOneGroup(groups, next, label_, 0, 0);
    forall i, j | 0 <= i < |next| && 0 <= j < |next| && i != j
      ensures next[i].key != next[j].key
    {
      assert next[i].key == groups[i].key;
      assert next[j].key == groups[j].key;
    }
    forall g | g in next
      ensures g.count > 0
    {
      var idx :| 0 <= idx < |next| && next[idx] == g;
      assert groups[idx] in groups;
    }
  } else {
    var added := Group(label_, 1);
    assert next == groups + [added];
    ProofLib.DistinctByConcat(groups, [added], (g: Group) => g.key);
    ProofLib.FoldLeftAppend((total: int, group: Group) => (total + group.count), 0, groups, added);
    assert forall g :: g in next ==> g.count > 0;
  }
}

lemma FoldGroupCounts(labels: seq<DiagnosticKey>, prior: seq<Group>)
  requires ProofLib.DistinctBy(prior, (g: Group) => g.key)
  requires forall g :: g in prior ==> g.count > 0
  ensures forall g :: g in Std.Collections.Seq.FoldLeft((groups: seq<Group>, label_: DiagnosticKey) => addGroup(groups, label_), prior, labels) ==> g.count > 0
  ensures totalCounts(Std.Collections.Seq.FoldLeft((groups: seq<Group>, label_: DiagnosticKey) => addGroup(groups, label_), prior, labels)) == totalCounts(prior) + |labels|
  decreases |labels|
{
  if |labels| > 0 {
    AddGroupPreservesCounts(prior, labels[0]);
    FoldGroupCounts(labels[1..], addGroup(prior, labels[0]));
  }
}

lemma lawPositiveCounts_ensures(results: seq<DiagnosticResult>)
  ensures (lawPositiveCounts(results) == true)
{
  FoldGroupCounts(failedKeys(results), []);
}

lemma lawSummaryCountsMatchFailures_ensures(results: seq<DiagnosticResult>)
  ensures (lawSummaryCountsMatchFailures(results) == true)
{
  FoldGroupCounts(failedKeys(results), []);
}
