lemma FirstBatchFold(acc: seq<int>, ids: seq<int>)
  requires |acc| <= maxBatch
  ensures |Std.Collections.Seq.FoldLeft((batch: seq<int>, id: int) => (if (|batch| < maxBatch) then (batch + [id]) else batch), acc, ids)| <= maxBatch
  ensures |acc| + |ids| <= maxBatch ==> Std.Collections.Seq.FoldLeft((batch: seq<int>, id: int) => (if (|batch| < maxBatch) then (batch + [id]) else batch), acc, ids) == acc + ids
  decreases |ids|
{
  if |ids| > 0 {
    FirstBatchFold((if |acc| < maxBatch then acc + [ids[0]] else acc), ids[1..]);
  }
}

lemma lawBatchAtMostTwenty_ensures(ids: seq<int>)
  ensures (lawBatchAtMostTwenty(ids) == true)
{
  FirstBatchFold([], ids);
}

lemma FilterNotInSingleton(xs: seq<int>, x: int)
  ensures ProofLib.Filter((set_x: int) => !((set_x in xs)), [x]) == (if x in xs then [] else [x])
{
  ProofLib.FilterCons((set_x: int) => !((set_x in xs)), [x]);
  ProofLib.FilterNil((set_x: int) => !((set_x in xs)), [x][1..]);
}

lemma JournalBridge(s: Sends, by_: Actor)
  ensures journal(s, by_).journaled == s.journaled + ProofLib.Filter((set_x: int) => !((set_x in s.journaled)), [s.signedBytes])
{
}

lemma BroadcastBridge(s: Sends, accepted: bool, by_: Actor)
  ensures broadcast(s, accepted, by_).broadcasts == (if accepted then s.broadcasts + ProofLib.Filter((set_x: int) => !((set_x in s.broadcasts)), [s.signedBytes]) else s.broadcasts)
{
}

lemma RebroadcastBridge(s: Sends, accepted: bool, by_: Actor)
  ensures rebroadcast(s, accepted, by_).broadcasts == (if accepted then s.broadcasts + ProofLib.Filter((set_x: int) => !((set_x in s.broadcasts)), [s.signedBytes]) else s.broadcasts)
{
}

lemma MineBridge(s: Sends, by_: Actor)
  ensures mine(s, by_).mined == s.mined + ProofLib.Filter((set_x: int) => !((set_x in s.mined)), [s.signedBytes])
{
}

lemma journal_ensures(s: Sends, by_: Actor)
  ensures (inv(s) ==> canJournal(s, by_) ==> alwaysOnlyRecordedBytesLeave(journal(s, by_)))
  ensures (inv(s) ==> canJournal(s, by_) ==> alwaysParksOnlyARefusedPayout(journal(s, by_)))
  ensures (inv(s) ==> canJournal(s, by_) ==> stepSignsOnlyLiveWithKeyInsideCeilings(s, journal(s, by_)))
  ensures (inv(s) ==> canJournal(s, by_) ==> stepRecordedWithinTheDay(s, journal(s, by_)))
  ensures (inv(s) ==> canJournal(s, by_) ==> stepSendRowsFinal(s, journal(s, by_)))
  ensures (inv(s) ==> canJournal(s, by_) ==> stepParksOnlyLive(s, journal(s, by_)))
{
  if inv(s) && canJournal(s, by_) {
    JournalBridge(s, by_);
    FilterNotInSingleton(s.journaled, s.signedBytes);
  }
}

lemma broadcast_ensures(s: Sends, accepted: bool, by_: Actor)
  ensures (inv(s) ==> canBroadcast(s, accepted, by_) ==> alwaysOnlyRecordedBytesLeave(broadcast(s, accepted, by_)))
  ensures (inv(s) ==> canBroadcast(s, accepted, by_) ==> alwaysParksOnlyARefusedPayout(broadcast(s, accepted, by_)))
  ensures (inv(s) ==> canBroadcast(s, accepted, by_) ==> stepSignsOnlyLiveWithKeyInsideCeilings(s, broadcast(s, accepted, by_)))
  ensures (inv(s) ==> canBroadcast(s, accepted, by_) ==> stepRecordedWithinTheDay(s, broadcast(s, accepted, by_)))
  ensures (inv(s) ==> canBroadcast(s, accepted, by_) ==> stepSendRowsFinal(s, broadcast(s, accepted, by_)))
  ensures (inv(s) ==> canBroadcast(s, accepted, by_) ==> stepParksOnlyLive(s, broadcast(s, accepted, by_)))
{
  if inv(s) && canBroadcast(s, accepted, by_) {
    BroadcastBridge(s, accepted, by_);
    FilterNotInSingleton(s.broadcasts, s.signedBytes);
  }
}

lemma rebroadcast_ensures(s: Sends, accepted: bool, by_: Actor)
  ensures (inv(s) ==> canRebroadcast(s, accepted, by_) ==> alwaysOnlyRecordedBytesLeave(rebroadcast(s, accepted, by_)))
  ensures (inv(s) ==> canRebroadcast(s, accepted, by_) ==> alwaysParksOnlyARefusedPayout(rebroadcast(s, accepted, by_)))
  ensures (inv(s) ==> canRebroadcast(s, accepted, by_) ==> stepSignsOnlyLiveWithKeyInsideCeilings(s, rebroadcast(s, accepted, by_)))
  ensures (inv(s) ==> canRebroadcast(s, accepted, by_) ==> stepRecordedWithinTheDay(s, rebroadcast(s, accepted, by_)))
  ensures (inv(s) ==> canRebroadcast(s, accepted, by_) ==> stepSendRowsFinal(s, rebroadcast(s, accepted, by_)))
  ensures (inv(s) ==> canRebroadcast(s, accepted, by_) ==> stepParksOnlyLive(s, rebroadcast(s, accepted, by_)))
{
  if inv(s) && canRebroadcast(s, accepted, by_) {
    RebroadcastBridge(s, accepted, by_);
    FilterNotInSingleton(s.broadcasts, s.signedBytes);
  }
}

lemma mine_ensures(s: Sends, by_: Actor)
  ensures (inv(s) ==> canMine(s, by_) ==> alwaysOnlyRecordedBytesLeave(mine(s, by_)))
  ensures (inv(s) ==> canMine(s, by_) ==> alwaysParksOnlyARefusedPayout(mine(s, by_)))
  ensures (inv(s) ==> canMine(s, by_) ==> stepSignsOnlyLiveWithKeyInsideCeilings(s, mine(s, by_)))
  ensures (inv(s) ==> canMine(s, by_) ==> stepRecordedWithinTheDay(s, mine(s, by_)))
  ensures (inv(s) ==> canMine(s, by_) ==> stepSendRowsFinal(s, mine(s, by_)))
  ensures (inv(s) ==> canMine(s, by_) ==> stepParksOnlyLive(s, mine(s, by_)))
{
  if inv(s) && canMine(s, by_) {
    MineBridge(s, by_);
    FilterNotInSingleton(s.mined, s.signedBytes);
  }
}
