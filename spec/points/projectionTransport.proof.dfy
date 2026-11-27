lemma ResetsBoundedMeaning(r: ProjectionRead)
  ensures alwaysResetsBounded(r) == (((r.indexResets >= 0) && (r.indexResets < resetAttempts)) && !((exists k :: k in r.shardResets && !((((k >= 0) && (k < publishedShards)) && (|ProofLib.Filter((o: int) => (o == k), r.shardResets)| < resetAttempts))))))
{
}

lemma ResetsOfMeaning(r: ProjectionRead, shard: int)
  ensures resetsOf(r, shard) == |ProofLib.Filter((k: int) => (k == shard), r.shardResets)|
{
}

lemma resetShard_ensures(r: ProjectionRead, shard: int)
  ensures (inv(r) ==> canResetShard(r, shard) ==> alwaysResetsBounded(resetShard(r, shard)))
  ensures (inv(r) ==> canResetShard(r, shard) ==> alwaysVerifiedNamesItsIndex(resetShard(r, shard)))
  ensures (inv(r) ==> canResetShard(r, shard) ==> alwaysShardsAfterIndex(resetShard(r, shard)))
  ensures (inv(r) ==> canResetShard(r, shard) ==> alwaysPendingOnlyWhileShardsRead(resetShard(r, shard)))
  ensures (inv(r) ==> canResetShard(r, shard) ==> stepDrainingEndsRefused(r, resetShard(r, shard)))
  ensures (inv(r) ==> canResetShard(r, shard) ==> stepFinalStays(r, resetShard(r, shard)))
  ensures (inv(r) ==> canResetShard(r, shard) ==> stepOneRollover(r, resetShard(r, shard)))
  ensures (inv(r) ==> canResetShard(r, shard) ==> stepVerifiedOnlyFromMatchingShards(r, "resetShard", resetShard(r, shard)))
{
  if inv(r) && canResetShard(r, shard) {
    ResetsBoundedMeaning(r);
    ResetsOfMeaning(r, shard);
    var after := resetShard(r, shard);
    if (resetsOf(r, shard) + 1) < resetAttempts {
      forall m | m in after.shardResets
        ensures m >= 0 && m < publishedShards && |ProofLib.Filter((o: int) => (o == m), after.shardResets)| < resetAttempts
      {
        ProofLib.FilterAppend((o: int) => (o == m), r.shardResets, shard);
        if m == shard {
          ProofLib.FilterSamePredicate((o: int) => (o == m), (k: int) => (k == shard), r.shardResets);
        }
      }
    }
    ResetsBoundedMeaning(after);
  }
}
