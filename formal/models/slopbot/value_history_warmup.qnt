// @source scripts/value-ingestion.ts
// First value-history pages may be read ahead of the sequential history loop,
// a bounded number at once, beside the loop and at most Window outcomes in
// front of it. The hosted feed may change at any time. A read-ahead only
// supplies a page: it decides nothing and reports nothing. The loop uses only
// an empty page read ahead; a page with records it reads again in its turn. A read-ahead that
// fails is dropped and ends the read-ahead, and the loop then makes that read
// itself, so a failure is only ever reported by the loop, for its own outcome.
// One read at a time means no read-ahead at all.
module value_history_warmup {
  val Outcomes = Set(1,2,3,4)
  val Last = 4
  val Limit = 1
  val Window = 2 * Limit
  // at: the outcome the loop is working on, 0 before it starts.
  // version: the feed version; seenAt: the version when the loop reached a
  // position; readVersion: the version a page was read at.
  var s: { phase:str, at:int, reading:Set[int], warmed:Set[int], empty:Set[int], dropped:Set[int],
    taken:Set[int], live:Set[int], failed:int, aheadOff:bool, version:int,
    seenAt:int -> int, readVersion:int -> int }
  action init = s'={phase:"running",at:0,reading:Set(),warmed:Set(),empty:Set(),dropped:Set(),
    taken:Set(),live:Set(),failed:0,aheadOff:false,version:0,
    seenAt:Map(0 -> 0),readVersion:Map()}
  val started = s.reading.union(s.warmed).union(s.dropped)
  val decided = s.taken.union(s.live.exclude(Set(s.failed)))
  // The feed changes between any two steps.
  action change = all {s.phase=="running",s.version<2,s'=s.with("version",s.version+1)}
  // One read at a time: the read-ahead never starts.
  action sequentialOnly = all {s.phase=="running",s.at==0,started.size()==0,not(s.aheadOff),
    s'=s.with("aheadOff",true)}
  // Reads start only in front of the loop, within the window and the limit,
  // never after a drop.
  action startRead(o) = all {s.phase=="running",not(s.aheadOff),s.dropped.size()==0,
    not(started.contains(o)),o>s.at,o<=s.at+Window,s.reading.size()<Limit,
    s'=s.with("reading",s.reading.union(Set(o)))
      .with("readVersion",s.readVersion.put(o,s.version))}
  action finishRead(o,ok,e) = all {s.phase=="running",s.reading.contains(o),
    s'=s.with("reading",s.reading.exclude(Set(o)))
      .with("warmed",if(ok) s.warmed.union(Set(o)) else s.warmed)
      .with("empty",if(ok and e) s.empty.union(Set(o)) else s.empty)
      .with("dropped",if(ok) s.dropped else s.dropped.union(Set(o)))
      .with("aheadOff",if(ok) s.aheadOff else true)}
  // The loop moves to the next outcome once it decided the current one.
  action advance = all {s.phase=="running",s.at<Last,decided==Outcomes.filter(o=>o<=s.at),
    s'=s.with("at",s.at+1).with("seenAt",s.seenAt.put(s.at+1,s.version))}
  // The loop takes an empty warmed page once; any other page it reads itself,
  // after an in-flight read of it ends, under the same limit.
  action takeWarmed = all {s.phase=="running",s.at>0,not(decided.contains(s.at)),
    s.empty.contains(s.at),s'=s.with("taken",s.taken.union(Set(s.at)))}
  action readLive(ok) = all {s.phase=="running",s.at>0,not(decided.contains(s.at)),
    not(s.empty.contains(s.at)),not(s.reading.contains(s.at)),s.reading.size()<Limit,
    s'=s.with("live",s.live.union(Set(s.at)))
      .with("readVersion",s.readVersion.put(s.at,s.version))
      .with("failed",if(ok) 0 else s.at)
      .with("phase",if(ok) "running" else "failed")}
  action finish = all {s.phase=="running",s.at==Last,decided==Outcomes,s.reading.size()==0,
    s'=s.with("phase","done")}
  action step = {nondet o=Outcomes.oneOf() nondet ok=Set(false,true).oneOf()
    nondet e=Set(false,true).oneOf()
    any {change,sequentialOnly,startRead(o),finishRead(o,ok,e),advance,takeWarmed,
      readLive(ok),finish,s'=s}}
  val invariant = all {
    s.reading.size()<=Limit,
    s.phase=="done" implies s.reading.size()==0,
    // Outcomes are decided in order, each from exactly one successful read.
    decided.subseteq(Outcomes.filter(o=>o<=s.at)),
    Outcomes.filter(o=>o<s.at).subseteq(decided),
    s.taken.intersect(s.live).size()==0,
    s.taken.subseteq(s.empty),
    s.empty.subseteq(s.warmed),
    s.warmed.intersect(s.dropped).size()==0,
    // No page is read further ahead than the window.
    started.forall(o => o<=Window or s.seenAt.keys().contains(o-Window)),
    // A page the loop uses was read no earlier than the loop reached the
    // outcome Window places before it, so a change the loop saw by then is in it.
    s.taken.forall(o => o<=Window or s.readVersion.get(o)>=s.seenAt.get(o-Window)),
    s.live.forall(o => s.readVersion.get(o)>=s.seenAt.get(o)),
    // Only the loop reports a failure, for its own read of its outcome.
    (s.failed!=0) iff (s.phase=="failed"),
    s.failed!=0 implies (s.failed==s.at and s.live.contains(s.failed)),
    s.phase=="done" implies decided==Outcomes,
  }
  run sequentialOnlyTest = init.then(sequentialOnly).then(startRead(1).fail())
  run sequentialReadsEveryPageTest = init.then(sequentialOnly)
    .then(advance).then(readLive(true)).then(advance).then(readLive(true))
    .then(advance).then(readLive(true)).then(advance).then(readLive(true)).then(finish)
    .expect(s.phase=="done" and s.live==Outcomes and s.taken==Set() and invariant)
  run readAheadStaysWithinLimitTest = init.then(startRead(1)).then(startRead(2).fail())
  run readAheadStaysWithinWindowTest = init.then(startRead(1)).then(finishRead(1,true,true))
    .then(startRead(2)).then(finishRead(2,true,true)).then(startRead(3).fail())
  run readAheadMovesWithLoopTest = init.then(startRead(1)).then(finishRead(1,true,true))
    .then(startRead(2)).then(finishRead(2,true,true)).then(advance).then(takeWarmed)
    .then(startRead(3)).expect(invariant)
  run loopDoesNotReadAheadOfItselfTest = init.then(advance).then(startRead(1).fail())
  run loopWaitsForInFlightReadTest = init.then(startRead(1)).then(advance).then(readLive(true).fail())
  run warmedPagesAreTakenOnceTest = init.then(startRead(1)).then(finishRead(1,true,true))
    .then(startRead(2)).then(finishRead(2,true,true)).then(advance).then(takeWarmed)
    .then(startRead(3)).then(finishRead(3,true,true)).then(advance).then(takeWarmed)
    .then(startRead(4)).then(finishRead(4,true,true)).then(advance).then(takeWarmed)
    .then(advance).then(takeWarmed).then(finish)
    .expect(s.phase=="done" and s.taken==Outcomes and s.live==Set() and invariant)
  run droppedReadEndsReadAheadTest = init.then(startRead(1)).then(finishRead(1,false,true)).then(startRead(2).fail())
  run droppedReadIsRepeatedByLoopTest = init.then(startRead(1)).then(finishRead(1,true,true))
    .then(startRead(2)).then(finishRead(2,false,true)).then(advance).then(takeWarmed)
    .then(advance).then(readLive(true)).then(advance).then(readLive(true))
    .then(advance).then(readLive(true)).then(finish)
    .expect(s.phase=="done" and s.taken==Set(1) and s.live==Set(2,3,4) and invariant)
  run failureSurfacesFromLoopInOrderTest = init.then(startRead(1)).then(finishRead(1,true,true))
    .then(startRead(2)).then(finishRead(2,false,true)).expect(s.failed==0)
    .then(advance).then(takeWarmed).then(advance).then(readLive(false))
    .expect(s.phase=="failed" and s.failed==2 and s.taken==Set(1) and invariant)
  run warmedPageIsNotReadAgainTest = init.then(startRead(1)).then(finishRead(1,true,true))
    .then(advance).then(readLive(true).fail())
  // A page with records read ahead is read again by the loop, so a record
  // replaced since then is decided from the feed as the loop finds it.
  run recordPageIsReadAgainTest = init.then(startRead(1)).then(finishRead(1,true,false))
    .then(advance).expect(not(s.empty.contains(1))).then(change).then(readLive(true))
    .expect(s.live==Set(1) and s.readVersion.get(1)==1 and invariant)
  // A change made while the loop runs reaches every page read after it: the
  // last outcome is read only once the loop is within the window of it.
  run changeDuringLoopReachesLaterPagesTest = init.then(startRead(1)).then(finishRead(1,true,true))
    .then(startRead(2)).then(finishRead(2,true,true)).then(advance).then(takeWarmed)
    .then(change).then(advance).then(takeWarmed).then(startRead(3)).then(finishRead(3,true,true))
    .then(startRead(4)).then(finishRead(4,true,true)).then(advance).then(takeWarmed)
    .then(advance).then(takeWarmed).then(finish)
    .expect(s.phase=="done" and s.readVersion.get(4)==1 and invariant)
}
