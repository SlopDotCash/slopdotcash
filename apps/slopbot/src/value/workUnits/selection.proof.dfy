// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"
lemma stringsContain_ensures(values: seq<string>, target: string, count: int)
  requires (0 <= count)
  requires (count <= |values|)
  ensures (stringsContain(values, target, count) <==> exists k: int :: (((0 <= k) && (k < count)) && (values[k] == target)))
{
  if count > 0 {
    stringsContain_ensures(values, target, count - 1);
    if values[count - 1] == target {
      assert (0 <= count - 1) && (count - 1 < count) && (values[count - 1] == target);
    } else {
      forall k: int | 0 <= k < count && values[k] == target
        ensures k < count - 1
      {
      }
    }
  }
}

lemma acceptedIndices_ensures(commits: seq<AcceptedCommit>, resolutions: seq<string>, indirect: bool, acceptedShas: seq<string>, count: int)
  requires (0 <= count)
  requires (count <= |commits|)
  ensures forall i: int :: ((0 <= i) ==> (i < |acceptedIndices(commits, resolutions, indirect, acceptedShas, count)|) ==> ((0 <= acceptedIndices(commits, resolutions, indirect, acceptedShas, count)[i]) && (acceptedIndices(commits, resolutions, indirect, acceptedShas, count)[i] < count)))
  ensures forall i: int :: ((0 <= i) ==> (i < |acceptedIndices(commits, resolutions, indirect, acceptedShas, count)|) ==> forall j: int :: ((i < j) ==> (j < |acceptedIndices(commits, resolutions, indirect, acceptedShas, count)|) ==> (acceptedIndices(commits, resolutions, indirect, acceptedShas, count)[i] < acceptedIndices(commits, resolutions, indirect, acceptedShas, count)[j])))
  ensures forall c: int :: ((0 <= c) ==> (c < count) ==> (acceptedAt(commits, resolutions, indirect, acceptedShas, c) <==> exists k: int :: (((0 <= k) && (k < |acceptedIndices(commits, resolutions, indirect, acceptedShas, count)|)) && (acceptedIndices(commits, resolutions, indirect, acceptedShas, count)[k] == c))))
{
  if count > 0 {
    acceptedIndices_ensures(commits, resolutions, indirect, acceptedShas, count - 1);
    var prev := acceptedIndices(commits, resolutions, indirect, acceptedShas, count - 1);
    var cur := acceptedIndices(commits, resolutions, indirect, acceptedShas, count);
    if acceptedAt(commits, resolutions, indirect, acceptedShas, count - 1) {
      assert cur == prev + [count - 1];
      forall c: int | 0 <= c < count
        ensures acceptedAt(commits, resolutions, indirect, acceptedShas, c) <==> exists k: int :: 0 <= k < |cur| && cur[k] == c
      {
        if c == count - 1 {
          assert 0 <= |prev| < |cur| && cur[|prev|] == c;
        } else {
          if acceptedAt(commits, resolutions, indirect, acceptedShas, c) {
            var k :| 0 <= k < |prev| && prev[k] == c;
            assert 0 <= k < |cur| && cur[k] == c;
          }
          if exists k: int :: 0 <= k < |cur| && cur[k] == c {
            var k :| 0 <= k < |cur| && cur[k] == c;
            assert k < |prev| && prev[k] == c;
          }
        }
      }
    }
  }
}
