lemma lawReopenBeforeCloseNotCounted_ensures(sampleItem: ItemActivity)
  ensures (lawReopenBeforeCloseNotCounted(sampleItem) == true)
{
  if sampleItem.latestReopenAt < sampleItem.firstCloseAt {
    ProofLib.FilterNone((i: ItemActivity) => ((i.firstCloseAt > 0) && (i.latestReopenAt >= i.firstCloseAt)), [sampleItem]);
  }
}
