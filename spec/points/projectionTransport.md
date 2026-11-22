# Reading the published Points projection

PRD sections 2 and 7: the generator recovers published Points history before
it prepares another projection, and a failed read never becomes an empty or
older journal. This machine is one read of the published Pages projection in
`scripts/generate-points.ts` (`retryPointsTransport`,
`loadPublishedProjection`) and the legacy `points_projection_transport`
model. Its result is the Pages copy that [recovery](./recovery.md) weighs: a
verified projection is `CopyPresent`, and a refused read is
`CopyUnavailable`, which refuses recovery without discarding history.

The index is `/data/points.json` (at most 1 MiB); it must name exactly 16
shards, the shard of position `i` at `/data/points/<i in hex>.json` (each at
most 8 MiB). Every request has a 30-second timeout and bypasses caches.

## Story: Read the published projection without mistaking a reset for a refusal

### A reset read of the published index or a shard is repeated at most three times

A read of the index, and a read of each shard, is attempted at most three
times: when the connection resets (`ECONNRESET`, before the headers or while
the bounded body is read), the same request is sent again after one second
(`resetWaitMs`), and the third reset refuses the read. The shards are read
side by side, and each keeps its own count. Any other failure, a status
other than success, an oversized body or an invalid index or shard is
refused at once and never repeated.

When the shards do not all match the index (the shard checksum mismatch of
the assembly), one fresh index is read, past the cache. Only when its
generation differs from the first, because a deployment replaced the shards
after the first index read, are the shards read and assembled once more,
each read again with a count of its own. An unchanged index, a second
mismatch and any other assembly failure refuse the read. A verified
projection is exactly the generation its index names.

```quint
pure val resetAttempts = 3
pure val resetWaitMs = 1000
pure val publishedShards = 16
type TransportPhase = ReadingIndex | ReadingShards | Verified | Refused
type ProjectionRead = { phase: TransportPhase, index: int, indexResets: int, shardResets: List[int], rollover: bool }
pure val initial: ProjectionRead = { phase: ReadingIndex, index: 0, indexResets: 0, shardResets: List(), rollover: false }
pure def resetsOf(r: ProjectionRead, shard: int): int = r.shardResets.select(k => k == shard).length()
pure def reading(r: ProjectionRead): bool = r.phase == ReadingIndex or r.phase == ReadingShards
pure def canResetIndex(r: ProjectionRead): bool = r.phase == ReadingIndex
pure def resetIndex(r: ProjectionRead): ProjectionRead =
  if (r.indexResets + 1 < resetAttempts) { ...r, indexResets: r.indexResets + 1 } else { ...r, phase: Refused }
pure def canResetShard(r: ProjectionRead, shard: int): bool = r.phase == ReadingShards and shard >= 0 and shard < publishedShards
pure def resetShard(r: ProjectionRead, shard: int): ProjectionRead =
  if (resetsOf(r, shard) + 1 < resetAttempts) { ...r, shardResets: r.shardResets.append(shard) } else { ...r, phase: Refused }
pure def canRefuseRead(r: ProjectionRead): bool = reading(r)
pure def refuseRead(r: ProjectionRead): ProjectionRead = { ...r, phase: Refused }
pure def canReadIndex(r: ProjectionRead, generation: int): bool = r.phase == ReadingIndex and generation > 0
pure def readIndex(r: ProjectionRead, generation: int): ProjectionRead =
  if (r.rollover and generation == r.index) { ...r, phase: Refused }
  else { ...r, phase: ReadingShards, index: generation, indexResets: 0, shardResets: List() }
pure def shardsMatch(r: ProjectionRead, generations: Set[int]): bool =
  generations.subseteq(Set(r.index)) and Set(r.index).subseteq(generations)
pure def canReadShards(r: ProjectionRead, generations: Set[int]): bool =
  r.phase == ReadingShards and generations.forall(g => g > 0) and generations.size() > 0
pure def readShards(r: ProjectionRead, generations: Set[int]): ProjectionRead =
  if (shardsMatch(r, generations)) { ...r, phase: Verified }
  else if (r.rollover) { ...r, phase: Refused }
  else { ...r, phase: ReadingIndex, rollover: true, indexResets: 0, shardResets: List() }
pure def alwaysResetsBounded(r: ProjectionRead): bool =
  r.indexResets >= 0 and r.indexResets < resetAttempts and
  r.shardResets.every(k => k >= 0 and k < publishedShards and r.shardResets.select(o => o == k).length() < resetAttempts)
pure def alwaysVerifiedNamesItsIndex(r: ProjectionRead): bool = r.phase == Verified implies r.index > 0
pure def alwaysShardsAfterIndex(r: ProjectionRead): bool = r.phase == ReadingShards implies r.index > 0
pure def stepFinalStays(before: ProjectionRead, after: ProjectionRead): bool =
  (before.phase == Verified or before.phase == Refused) implies after == before
pure def stepOneRollover(before: ProjectionRead, after: ProjectionRead): bool =
  before.rollover implies after.rollover
pure def stepVerifiedOnlyFromMatchingShards(before: ProjectionRead, via: str, after: ProjectionRead): bool =
  (before.phase != Verified and after.phase == Verified) implies (via == "readShards" and after.index == before.index)
pure def sometimesVerifiedAfterResets(r: ProjectionRead): bool = r.phase == Verified and r.shardResets.length() > 0
pure def sometimesVerifiedAfterRollover(r: ProjectionRead): bool = r.phase == Verified and r.rollover
pure def sometimesRefusedOnThirdReset(r: ProjectionRead): bool = r.phase == Refused and r.indexResets == resetAttempts - 1
pure def sometimesUnchangedIndexRefused(r: ProjectionRead): bool = r.phase == Refused and r.rollover and r.shardResets == List()
pure val generationValues = Set(1, 2)
pure val generationsValues = Set(Set(1), Set(2), Set(1, 2))
pure val shardValues = Set(0, 1, 15, 16)
```
