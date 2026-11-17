// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"
lemma keptHunks_ensures(before: seq<string>, after: seq<string>, count: int)
  requires (0 <= count)
  requires (count <= |before|)
  ensures (|keptHunks(before, after, count)| <= count)
{
  if count > 0 {
    keptHunks_ensures(before, after, count - 1);
  }
}

lemma missingHunkIndices_ensures(before: seq<string>, after: seq<string>, count: int)
  requires (0 <= count)
  requires (count <= |before|)
  ensures forall i: int :: ((0 <= i) ==> (i < |missingHunkIndices(before, after, count)|) ==> ((0 <= missingHunkIndices(before, after, count)[i]) && (missingHunkIndices(before, after, count)[i] < count)))
{
  if count > 0 {
    missingHunkIndices_ensures(before, after, count - 1);
    var prior := missingHunkIndices(before, after, count - 1);
    if hunkIn(after, before[count - 1], |after|) {
      assert missingHunkIndices(before, after, count) == prior;
    } else {
      var extended := prior + [count - 1];
      assert missingHunkIndices(before, after, count) == extended;
      forall i: int | 0 <= i < |extended|
        ensures 0 <= extended[i] < count
      {
        if i < |prior| {
          assert extended[i] == prior[i];
        } else {
          assert extended[i] == count - 1;
        }
      }
    }
  }
}

lemma matchCount_ensures(ancestors: seq<bool>, acceptedSha: string, path: string, hunk: string, candidates: seq<HunkCandidate>, count: int)
  requires (0 <= count)
  requires (count <= |candidates|)
  ensures (0 <= matchCount(ancestors, acceptedSha, path, hunk, candidates, count))
  ensures (matchCount(ancestors, acceptedSha, path, hunk, candidates, count) <= count)
{
  if count > 0 {
    matchCount_ensures(ancestors, acceptedSha, path, hunk, candidates, count - 1);
  }
}

lemma lastMatch_ensures(ancestors: seq<bool>, acceptedSha: string, path: string, hunk: string, candidates: seq<HunkCandidate>, count: int)
  requires (0 <= count)
  requires (count <= |candidates|)
  ensures (-1 <= lastMatch(ancestors, acceptedSha, path, hunk, candidates, count))
  ensures (lastMatch(ancestors, acceptedSha, path, hunk, candidates, count) < count)
  ensures ((lastMatch(ancestors, acceptedSha, path, hunk, candidates, count) == -1) <==> (matchCount(ancestors, acceptedSha, path, hunk, candidates, count) == 0))
{
  if count > 0 {
    lastMatch_ensures(ancestors, acceptedSha, path, hunk, candidates, count - 1);
    matchCount_ensures(ancestors, acceptedSha, path, hunk, candidates, count - 1);
    if matchingCandidate(ancestors, acceptedSha, path, hunk, candidates[count - 1]) {
      assert lastMatch(ancestors, acceptedSha, path, hunk, candidates, count) == count - 1;
      assert matchCount(ancestors, acceptedSha, path, hunk, candidates, count) == matchCount(ancestors, acceptedSha, path, hunk, candidates, count - 1) + 1;
    } else {
      assert lastMatch(ancestors, acceptedSha, path, hunk, candidates, count) == lastMatch(ancestors, acceptedSha, path, hunk, candidates, count - 1);
      assert matchCount(ancestors, acceptedSha, path, hunk, candidates, count) == matchCount(ancestors, acceptedSha, path, hunk, candidates, count - 1);
    }
  }
}
