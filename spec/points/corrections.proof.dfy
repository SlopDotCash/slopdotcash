// Concrete directed traces use a complete two-recipient allocation of 30 Points.
lemma lawProtectionRace_ensures(manifest: Manifest)
  ensures (lawProtectionRace(manifest) == true)
{
  if manifest == readyManifest {
    ReadyManifestAllocates();
    assert prepare(initial, manifest).phase.Prepared?;
    var protected := protect(prepare(initial, manifest), settledFreeze);
    assert protected.frozen && protected.history == initial.history;
    assert commit(protected, false, Actor.TrustedWorkflow).phase.Protected?;
    assert commit(protected, false, Actor.TrustedWorkflow).history == initial.history;
  }
}

lemma lawReallocationPreservesPool_ensures(manifest: Manifest)
  ensures (lawReallocationPreservesPool(manifest) == true)
{
  if manifest == readyManifest {
    ReadyManifestAllocates();
    var corrected := commit(prepare(initial, manifest), false, Actor.TrustedWorkflow);
    assert corrected.phase.Applied?;
    assert corrected.pool == initial.pool && corrected.occurredAt == initial.occurredAt;
    assert points__allocation_canWriteAllocation(30, manifest.recipients, true, false);
  }
}

lemma ReadyManifestAllocates()
  ensures completeCorrection(initial, readyManifest)
  ensures predecessorMatches(initial, readyManifest)
  ensures prepare(initial, readyManifest).phase.Prepared?
  ensures commit(prepare(initial, readyManifest), false, Actor.TrustedWorkflow).phase.Applied?
{
  var a := points__allocation_Recipient(1, 1);
  var b := points__allocation_Recipient(2, 2);
  var xs := [a, b];
  assert readyManifest.recipients == xs;
  InitialRecipientsValid(a, b);
  ThirtyPointSplit(a, b);
  assert points__allocation_canWriteAllocation(30, xs, true, false);
}

lemma InitialRecipientsValid(a: points__allocation_Recipient, b: points__allocation_Recipient)
  requires a == points__allocation_Recipient(1, 1) && b == points__allocation_Recipient(2, 2)
  ensures points__allocation_validRecipients([a, b])
{
  var xs := [a, b];
  RecipientFilterMeaning(xs);
  FilterTwoForCorrection((other: points__allocation_Recipient) => (other.actor == a.actor), a, b);
  FilterTwoForCorrection((other: points__allocation_Recipient) => (other.actor == b.actor), a, b);
  forall r | r in xs
    ensures r.actor > 0 && r.lines >= 0 && |ProofLib.Filter((other: points__allocation_Recipient) => (other.actor == r.actor), xs)| == 1
  {
    assert r == a || r == b;
    if r == a {
      FilterTwoForCorrection((other: points__allocation_Recipient) => (other.actor == r.actor), a, b);
    } else {
      FilterTwoForCorrection((other: points__allocation_Recipient) => (other.actor == r.actor), a, b);
    }
  }
}

lemma RecipientFilterMeaning(xs: seq<points__allocation_Recipient>)
  ensures points__allocation_validRecipients(xs) == (|xs| > 0 && !((exists r :: r in xs && !((((r.actor > 0) && (r.lines >= 0)) && (|ProofLib.Filter((other: points__allocation_Recipient) => (other.actor == r.actor), xs)| == 1))))))
{
}

lemma ThirtyPointSplit(a: points__allocation_Recipient, b: points__allocation_Recipient)
  requires a == points__allocation_Recipient(1, 1) && b == points__allocation_Recipient(2, 2)
  ensures points__allocation_pointTotal(points__allocation_allocatePoints(30, [a, b])) == 30
{
  var xs := [a, b];
  FoldTwoForCorrection((acc: int, r: points__allocation_Recipient) => (acc + r.lines), 0, a, b);
  assert points__allocation_lineTotal(xs) == 3;
  assert points__allocation_weightTotal(xs) == 3;
  assert points__allocation_floorShare(30, a, xs) == 10;
  assert points__allocation_floorShare(30, b, xs) == 20;
  FoldTwoForCorrection((acc: int, r: points__allocation_Recipient) => (acc + points__allocation_floorShare(30, r, xs)), 0, a, b);
  assert points__allocation_floorTotal(30, xs) == 30;
  var first := points__allocation_PointShare(1, 10);
  var second := points__allocation_PointShare(2, 20);
  var shares := points__allocation_allocatePoints(30, xs);
  assert |shares| == 2;
  assert shares[0] == first && shares[1] == second;
  assert shares == [first, second];
  FoldTwoForCorrection((acc: int, share: points__allocation_PointShare) => (acc + share.points), 0, first, second);
}

lemma FoldTwoForCorrection<T, A>(f: (A, T) -> A, z: A, a: T, b: T)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a, b]) == f(f(z, a), b)
{
  ProofLib.FoldLeftAppend(f, z, [], a);
  ProofLib.FoldLeftAppend(f, z, [a], b);
}

lemma FilterTwoForCorrection<T>(p: T -> bool, a: T, b: T)
  ensures |ProofLib.Filter(p, [a, b])| == (if p(a) then 1 else 0) + (if p(b) then 1 else 0)
{
  reveal ProofLib.Filter();
  reveal Std.Collections.Seq.Filter();
  ProofLib.FilterNil(p, []);
  ProofLib.FilterAppend(p, [], a);
  ProofLib.FilterAppend(p, [a], b);
}

lemma lawReplayAppendsNothing_ensures(manifest: Manifest)
  ensures (lawReplayAppendsNothing(manifest) == true)
{
  if manifest == readyManifest {
    ReadyManifestAllocates();
    var committed := commit(prepare(initial, manifest), false, Actor.TrustedWorkflow);
    assert committed.phase.Applied? && manifest.digest in committed.applied;
    assert prepare(committed, manifest).phase.Replayed?;
    assert prepare(committed, manifest).history == committed.history;
  }
}

lemma FoldThreeScan(f: (ZeroLineScan, CensusCommit) -> ZeroLineScan, z: ZeroLineScan, a: CensusCommit, b: CensusCommit, c: CensusCommit)
  ensures Std.Collections.Seq.FoldLeft(f, z, [a, b, c]) == f(f(f(z, a), b), c)
{
  ProofLib.FoldLeftAppend(f, z, [], a);
  ProofLib.FoldLeftAppend(f, z, [a], b);
  ProofLib.FoldLeftAppend(f, z, [a, b], c);
}

lemma lawMergeRowsLeaveTheMarkerUnproved_ensures(censusRow: CensusCommit)
  ensures (lawMergeRowsLeaveTheMarkerUnproved(censusRow) == true)
{
  if censusRow.parentsKnown && censusRow.parents > 1 {
    FoldThreeScan((acc: ZeroLineScan, row: CensusCommit) => scanCommit(acc, row), ZeroLineScan(false, false, false, false), emptyMarkerRow, carriedChangeRow, censusRow);
  }
}

lemma lawOwnedChangeProvesWork_ensures(censusRow: CensusCommit)
  ensures (lawOwnedChangeProvesWork(censusRow) == true)
{
  if censusRow.parentsKnown && censusRow.parents <= 1 && censusRow.owned && censusRow.linesKnown && censusRow.additions > 0 {
    FoldThreeScan((acc: ZeroLineScan, row: CensusCommit) => scanCommit(acc, row), ZeroLineScan(false, false, false, false), emptyMarkerRow, carriedChangeRow, censusRow);
  }
}

lemma lawUnknownParentsProveNothing_ensures(censusRow: CensusCommit)
  ensures (lawUnknownParentsProveNothing(censusRow) == true)
{
  if !censusRow.parentsKnown {
    FoldThreeScan((acc: ZeroLineScan, row: CensusCommit) => scanCommit(acc, row), ZeroLineScan(false, false, false, false), emptyMarkerRow, carriedChangeRow, censusRow);
  }
}

lemma stageChunk_ensures(c: Correction, index: int, digest: string, by_: Actor)
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> alwaysSourceHistory(stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> alwaysOctoberOnlyInScope(stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> alwaysConfirmationApplied(stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> alwaysChunksMatchManifest(stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> alwaysAppliedUnderReviewedPacket(stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> alwaysUnsettledSupplementUnprepared(stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> alwaysSupplementShape(stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> alwaysOpenUnapplied(stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> stepNoHistoryGrowthAfterProtection(c, stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> stepOnlyApplyAppends(c, "stageChunk", stageChunk(c, index, digest, by_)))
  ensures (inv(c) ==> canStageChunk(c, index, digest, by_) ==> stepConfirmationKept(c, stageChunk(c, index, digest, by_)))
{
  if inv(c) && canStageChunk(c, index, digest, by_) {
    var after := stageChunk(c, index, digest, by_);
    assert c.packet.expected[index] in c.packet.expected;
    assert digest != "";
    forall x | x in after.packet.staged
      ensures x.index >= 0 && x.index < |after.packet.staged| && after.packet.staged[x.index] == x && x.digest == (if ((0 <= x.index) && (x.index < |after.packet.expected|)) then after.packet.expected[x.index] else "") && x.digest != ""
    {
      if x in c.packet.staged {
        assert x.index < |c.packet.staged|;
        assert after.packet.staged[x.index] == c.packet.staged[x.index];
      } else {
        assert x == Chunk(index, digest);
        assert after.packet.staged[index] == x;
      }
    }
  }
}
