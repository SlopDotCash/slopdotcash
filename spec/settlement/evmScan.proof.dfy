lemma PagesInsideHeadFilter(s: EvmScan)
  ensures alwaysPagesInsideHead(s) == !((exists p :: p in s.pages && !((((((p.start >= s.origin) && (p.start <= p.end)) && (p.end <= s.head)) && (p.start <= (s.cursor + 1))) && (|ProofLib.Filter((o: Page) => (o.id == p.id), s.pages)| == 1)))))
{
}

lemma PagesDistinctBy(s: EvmScan)
  requires alwaysPagesInsideHead(s)
  ensures ProofLib.DistinctBy(s.pages, (p: Page) => p.id)
{
  PagesInsideHeadFilter(s);
  forall i, j | 0 <= i < |s.pages| && 0 <= j < |s.pages| && i != j
    ensures s.pages[i].id != s.pages[j].id
  {
    var p := s.pages[i];
    assert p in s.pages;
    ProofLib.FilterCountOneIffUnique((o: Page) => (o.id == p.id), s.pages, (q: Page) => q.id, i);
  }
}

lemma DistinctPagesHaveCountOne(pages: seq<Page>)
  requires ProofLib.DistinctBy(pages, (p: Page) => p.id)
  ensures forall p :: p in pages ==> |ProofLib.Filter((o: Page) => (o.id == p.id), pages)| == 1
{
  forall p | p in pages
    ensures |ProofLib.Filter((o: Page) => (o.id == p.id), pages)| == 1
  {
    var i :| 0 <= i < |pages| && pages[i] == p;
    ProofLib.FilterOne((o: Page) => (o.id == p.id), pages, i);
  }
}

lemma PageForBridge(s: EvmScan, pageId: int)
  ensures pageFor(s, pageId) == (if ((0 <= 0) && (0 < |ProofLib.Filter((p: Page) => (p.id == pageId), s.pages)|)) then ProofLib.Filter((p: Page) => (p.id == pageId), s.pages)[0] else Page(0, 0, -1, false))
{
}

lemma PageForFound(s: EvmScan, pageId: int, target: Page)
  requires alwaysPagesInsideHead(s)
  requires target in s.pages && target.id == pageId
  ensures pageFor(s, pageId) == target
{
  PagesDistinctBy(s);
  PageForBridge(s, pageId);
  var i :| 0 <= i < |s.pages| && s.pages[i] == target;
  ProofLib.FilterOne((p: Page) => (p.id == pageId), s.pages, i);
  ProofLib.FilterMember((p: Page) => (p.id == pageId), s.pages, target);
  var filtered := ProofLib.Filter((p: Page) => (p.id == pageId), s.pages);
  assert |filtered| == 1 && target in filtered;
  assert filtered[0] == target;
}

lemma PageForPositiveInPages(s: EvmScan, pageId: int)
  requires pageFor(s, pageId).id > 0
  ensures pageFor(s, pageId) in s.pages && pageFor(s, pageId).id == pageId
{
  PageForBridge(s, pageId);
  var filtered := ProofLib.Filter((p: Page) => (p.id == pageId), s.pages);
  assert |filtered| > 0;
  ProofLib.FilterMember((p: Page) => (p.id == pageId), s.pages, filtered[0]);
}

lemma FailPageFilter(s: EvmScan, pageId: int)
  ensures failPage(s, pageId).pages == ProofLib.Filter((p: Page) => (p.id != pageId), s.pages)
{
}

lemma HoldBlockFilter(s: EvmScan, block: int)
  ensures holdBlock(s, block).pages == ProofLib.Filter((p: Page) => !(((block >= p.start) && (block <= p.end))), s.pages)
{
}

lemma ReleaseHoldFilter(s: EvmScan, block: int)
  ensures releaseHold(s, block).holds == ProofLib.Filter((b: int) => (b != block), s.holds)
{
}

lemma CompletePageFilter(s: EvmScan, pageId: int)
  ensures completePage(s, pageId).pages == ProofLib.Filter((p: Page) => (p.id != pageId), s.pages)
{
}

lemma startPage_ensures(s: EvmScan, pageId: int, rpcChain: int)
  ensures (inv(s) ==> canStartPage(s, pageId, rpcChain) ==> alwaysPagesInsideHead(startPage(s, pageId, rpcChain)))
  ensures (inv(s) ==> canStartPage(s, pageId, rpcChain) ==> alwaysUnconfiguredIdle(startPage(s, pageId, rpcChain)))
  ensures (inv(s) ==> canStartPage(s, pageId, rpcChain) ==> alwaysHeldBlocksUncovered(startPage(s, pageId, rpcChain)))
  ensures (inv(s) ==> canStartPage(s, pageId, rpcChain) ==> alwaysCursorBounded(startPage(s, pageId, rpcChain)))
  ensures (inv(s) ==> canStartPage(s, pageId, rpcChain) ==> alwaysAuditFlagShape(startPage(s, pageId, rpcChain)))
  ensures (inv(s) ==> canStartPage(s, pageId, rpcChain) ==> alwaysNoVerifiedPageOverHold(startPage(s, pageId, rpcChain)))
  ensures (inv(s) ==> canStartPage(s, pageId, rpcChain) ==> stepCursorMonotone(s, startPage(s, pageId, rpcChain)))
  ensures (inv(s) ==> canStartPage(s, pageId, rpcChain) ==> stepCursorOnlyByVerifiedPage(s, "startPage", startPage(s, pageId, rpcChain)))
  ensures (inv(s) ==> canStartPage(s, pageId, rpcChain) ==> stepConfigurationFixed(s, startPage(s, pageId, rpcChain)))
{
  if inv(s) && canStartPage(s, pageId, rpcChain) {
    var after := startPage(s, pageId, rpcChain);
    var added := Page(pageId, nextStart(s), pageEnd(s), false);
    PagesDistinctBy(s);
    ProofLib.DistinctByConcat(s.pages, [added], (p: Page) => p.id);
    DistinctPagesHaveCountOne(after.pages);
    PagesInsideHeadFilter(after);
  }
}

lemma failPage_ensures(s: EvmScan, pageId: int)
  ensures (inv(s) ==> canFailPage(s, pageId) ==> alwaysPagesInsideHead(failPage(s, pageId)))
  ensures (inv(s) ==> canFailPage(s, pageId) ==> alwaysUnconfiguredIdle(failPage(s, pageId)))
  ensures (inv(s) ==> canFailPage(s, pageId) ==> alwaysHeldBlocksUncovered(failPage(s, pageId)))
  ensures (inv(s) ==> canFailPage(s, pageId) ==> alwaysCursorBounded(failPage(s, pageId)))
  ensures (inv(s) ==> canFailPage(s, pageId) ==> alwaysAuditFlagShape(failPage(s, pageId)))
  ensures (inv(s) ==> canFailPage(s, pageId) ==> alwaysNoVerifiedPageOverHold(failPage(s, pageId)))
  ensures (inv(s) ==> canFailPage(s, pageId) ==> stepCursorMonotone(s, failPage(s, pageId)))
  ensures (inv(s) ==> canFailPage(s, pageId) ==> stepCursorOnlyByVerifiedPage(s, "failPage", failPage(s, pageId)))
  ensures (inv(s) ==> canFailPage(s, pageId) ==> stepConfigurationFixed(s, failPage(s, pageId)))
{
  if inv(s) && canFailPage(s, pageId) {
    var after := failPage(s, pageId);
    FailPageFilter(s, pageId);
    PagesDistinctBy(s);
    ProofLib.FilterKeepsDistinctBy((p: Page) => (p.id != pageId), s.pages, (p: Page) => p.id);
    DistinctPagesHaveCountOne(after.pages);
    forall p | p in after.pages
      ensures p in s.pages
    {
      ProofLib.FilterMember((p: Page) => (p.id != pageId), s.pages, p);
    }
    PagesInsideHeadFilter(after);
  }
}

lemma holdBlock_ensures(s: EvmScan, block: int)
  ensures (inv(s) ==> canHoldBlock(s, block) ==> alwaysPagesInsideHead(holdBlock(s, block)))
  ensures (inv(s) ==> canHoldBlock(s, block) ==> alwaysUnconfiguredIdle(holdBlock(s, block)))
  ensures (inv(s) ==> canHoldBlock(s, block) ==> alwaysHeldBlocksUncovered(holdBlock(s, block)))
  ensures (inv(s) ==> canHoldBlock(s, block) ==> alwaysCursorBounded(holdBlock(s, block)))
  ensures (inv(s) ==> canHoldBlock(s, block) ==> alwaysAuditFlagShape(holdBlock(s, block)))
  ensures (inv(s) ==> canHoldBlock(s, block) ==> alwaysNoVerifiedPageOverHold(holdBlock(s, block)))
  ensures (inv(s) ==> canHoldBlock(s, block) ==> stepCursorMonotone(s, holdBlock(s, block)))
  ensures (inv(s) ==> canHoldBlock(s, block) ==> stepCursorOnlyByVerifiedPage(s, "holdBlock", holdBlock(s, block)))
  ensures (inv(s) ==> canHoldBlock(s, block) ==> stepConfigurationFixed(s, holdBlock(s, block)))
{
  if inv(s) && canHoldBlock(s, block) {
    var after := holdBlock(s, block);
    HoldBlockFilter(s, block);
    PagesDistinctBy(s);
    ProofLib.FilterKeepsDistinctBy((p: Page) => !(((block >= p.start) && (block <= p.end))), s.pages, (p: Page) => p.id);
    DistinctPagesHaveCountOne(after.pages);
    forall p | p in after.pages
      ensures p in s.pages && !((block >= p.start) && (block <= p.end))
    {
      ProofLib.FilterMember((p: Page) => !(((block >= p.start) && (block <= p.end))), s.pages, p);
    }
    PagesInsideHeadFilter(after);
  }
}

lemma releaseHold_ensures(s: EvmScan, block: int)
  ensures (inv(s) ==> canReleaseHold(s, block) ==> alwaysPagesInsideHead(releaseHold(s, block)))
  ensures (inv(s) ==> canReleaseHold(s, block) ==> alwaysUnconfiguredIdle(releaseHold(s, block)))
  ensures (inv(s) ==> canReleaseHold(s, block) ==> alwaysHeldBlocksUncovered(releaseHold(s, block)))
  ensures (inv(s) ==> canReleaseHold(s, block) ==> alwaysCursorBounded(releaseHold(s, block)))
  ensures (inv(s) ==> canReleaseHold(s, block) ==> alwaysAuditFlagShape(releaseHold(s, block)))
  ensures (inv(s) ==> canReleaseHold(s, block) ==> alwaysNoVerifiedPageOverHold(releaseHold(s, block)))
  ensures (inv(s) ==> canReleaseHold(s, block) ==> stepCursorMonotone(s, releaseHold(s, block)))
  ensures (inv(s) ==> canReleaseHold(s, block) ==> stepCursorOnlyByVerifiedPage(s, "releaseHold", releaseHold(s, block)))
  ensures (inv(s) ==> canReleaseHold(s, block) ==> stepConfigurationFixed(s, releaseHold(s, block)))
{
  if inv(s) && canReleaseHold(s, block) {
    var after := releaseHold(s, block);
    ReleaseHoldFilter(s, block);
    forall b | b in after.holds
      ensures b in s.holds
    {
      ProofLib.FilterMember((b: int) => (b != block), s.holds, b);
    }
  }
}

lemma verifyPage_ensures(s: EvmScan, index: PageIndex)
  ensures (inv(s) ==> canVerifyPage(s, index) ==> alwaysPagesInsideHead(verifyPage(s, index)))
  ensures (inv(s) ==> canVerifyPage(s, index) ==> alwaysUnconfiguredIdle(verifyPage(s, index)))
  ensures (inv(s) ==> canVerifyPage(s, index) ==> alwaysHeldBlocksUncovered(verifyPage(s, index)))
  ensures (inv(s) ==> canVerifyPage(s, index) ==> alwaysCursorBounded(verifyPage(s, index)))
  ensures (inv(s) ==> canVerifyPage(s, index) ==> alwaysAuditFlagShape(verifyPage(s, index)))
  ensures (inv(s) ==> canVerifyPage(s, index) ==> alwaysNoVerifiedPageOverHold(verifyPage(s, index)))
  ensures (inv(s) ==> canVerifyPage(s, index) ==> stepCursorMonotone(s, verifyPage(s, index)))
  ensures (inv(s) ==> canVerifyPage(s, index) ==> stepCursorOnlyByVerifiedPage(s, "verifyPage", verifyPage(s, index)))
  ensures (inv(s) ==> canVerifyPage(s, index) ==> stepConfigurationFixed(s, verifyPage(s, index)))
{
  if inv(s) && canVerifyPage(s, index) {
    var after := verifyPage(s, index);
    var target := pageFor(s, index.pageId);
    PagesDistinctBy(s);
    PageForPositiveInPages(s, index.pageId);
    assert |after.pages| == |s.pages|;
    assert forall i :: 0 <= i < |s.pages| ==> after.pages[i].id == s.pages[i].id;
    assert ProofLib.DistinctBy(after.pages, (p: Page) => p.id);
    DistinctPagesHaveCountOne(after.pages);
    forall i | 0 <= i < |after.pages|
      ensures after.pages[i].start == s.pages[i].start && after.pages[i].end == s.pages[i].end
      ensures !(after.pages[i].verified && heldIn(after, after.pages[i]))
    {
      if s.pages[i].id == index.pageId {
        var j :| 0 <= j < |s.pages| && s.pages[j] == target;
        assert i == j;
        assert s.pages[i] == target;
      }
    }
    PagesInsideHeadFilter(after);
  }
}

lemma completePage_ensures(s: EvmScan, pageId: int)
  ensures (inv(s) ==> canCompletePage(s, pageId) ==> alwaysPagesInsideHead(completePage(s, pageId)))
  ensures (inv(s) ==> canCompletePage(s, pageId) ==> alwaysUnconfiguredIdle(completePage(s, pageId)))
  ensures (inv(s) ==> canCompletePage(s, pageId) ==> alwaysHeldBlocksUncovered(completePage(s, pageId)))
  ensures (inv(s) ==> canCompletePage(s, pageId) ==> alwaysCursorBounded(completePage(s, pageId)))
  ensures (inv(s) ==> canCompletePage(s, pageId) ==> alwaysAuditFlagShape(completePage(s, pageId)))
  ensures (inv(s) ==> canCompletePage(s, pageId) ==> alwaysNoVerifiedPageOverHold(completePage(s, pageId)))
  ensures (inv(s) ==> canCompletePage(s, pageId) ==> stepCursorMonotone(s, completePage(s, pageId)))
  ensures (inv(s) ==> canCompletePage(s, pageId) ==> stepCursorOnlyByVerifiedPage(s, "completePage", completePage(s, pageId)))
  ensures (inv(s) ==> canCompletePage(s, pageId) ==> stepConfigurationFixed(s, completePage(s, pageId)))
{
  if inv(s) && canCompletePage(s, pageId) {
    var after := completePage(s, pageId);
    var p :| p in s.pages && p.id == pageId && p.verified;
    PageForFound(s, pageId, p);
    CompletePageFilter(s, pageId);
    PagesDistinctBy(s);
    ProofLib.FilterKeepsDistinctBy((q: Page) => (q.id != pageId), s.pages, (q: Page) => q.id);
    DistinctPagesHaveCountOne(after.pages);
    forall q | q in after.pages
      ensures q in s.pages
    {
      ProofLib.FilterMember((q: Page) => (q.id != pageId), s.pages, q);
    }
    forall b | b in after.holds
      ensures b > after.cursor
    {
      assert b in s.holds;
      assert b > s.cursor;
      assert p.start <= s.cursor + 1;
      assert !heldIn(s, p);
      assert !((b >= p.start) && (b <= p.end));
      assert b > p.end;
    }
    PagesInsideHeadFilter(after);
  }
}
