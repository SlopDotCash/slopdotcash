// @source scripts/value-ingestion.ts
// First value-history pages may be read ahead of the sequential history loop,
// a bounded number at once. A read-ahead only supplies a page: it decides
// nothing and reports nothing. A read-ahead that fails is dropped and ends the
// read-ahead, and the loop then makes that read itself, so a failure is only
// ever reported by the loop, for the next outcome in order. One read at a time
// means no read-ahead at all.
module value_history_warmup {
  val Outcomes = Set(1,2,3)
  val Limit = 2
  var s: { phase:str, reading:Set[int], warmed:Set[int], dropped:Set[int],
    taken:Set[int], live:Set[int], next:int, failed:int }
  action init = s'={phase:"warming",reading:Set(),warmed:Set(),dropped:Set(),
    taken:Set(),live:Set(),next:1,failed:0}
  val started = s.reading.union(s.warmed).union(s.dropped)
  val decided = s.taken.union(s.live.exclude(Set(s.failed)))
  action sequentialOnly = all {s.phase=="warming",started.size()==0,s'=s.with("phase","loop")}
  // Reads start in outcome order, never above the limit, never after a drop.
  action startRead(o) = all {s.phase=="warming",s.dropped.size()==0,not(started.contains(o)),
    s.reading.size()<Limit,Outcomes.forall(p=>p<o implies started.contains(p)),
    s'=s.with("reading",s.reading.union(Set(o)))}
  action finishRead(o,ok) = all {s.phase=="warming",s.reading.contains(o),
    s'=s.with("reading",s.reading.exclude(Set(o)))
      .with("warmed",if(ok) s.warmed.union(Set(o)) else s.warmed)
      .with("dropped",if(ok) s.dropped else s.dropped.union(Set(o)))}
  action endWarmup = all {s.phase=="warming",started.size()>0,s.reading.size()==0,
    s.dropped.size()>0 or started==Outcomes,s'=s.with("phase","loop")}
  // The loop takes a warmed page once; any other page it reads itself.
  action takeWarmed = all {s.phase=="loop",Outcomes.contains(s.next),s.warmed.contains(s.next),
    s'=s.with("taken",s.taken.union(Set(s.next))).with("next",s.next+1)}
  action readLive(ok) = all {s.phase=="loop",Outcomes.contains(s.next),not(s.warmed.contains(s.next)),
    s'=s.with("live",s.live.union(Set(s.next)))
      .with("next",if(ok) s.next+1 else s.next)
      .with("failed",if(ok) 0 else s.next)
      .with("phase",if(ok) "loop" else "failed")}
  action finish = all {s.phase=="loop",not(Outcomes.contains(s.next)),s'=s.with("phase","done")}
  action step = {nondet o=Outcomes.oneOf() nondet ok=Set(false,true).oneOf()
    any {sequentialOnly,startRead(o),finishRead(o,ok),endWarmup,takeWarmed,readLive(ok),finish,s'=s}}
  val invariant = all {
    s.reading.size()<=Limit,
    s.phase!="warming" implies s.reading.size()==0,
    s.phase=="warming" implies (decided.size()==0 and s.live.size()==0 and s.failed==0),
    // Outcomes are decided in order, each from exactly one successful read.
    decided==Outcomes.filter(o=>o<s.next),
    s.taken.intersect(s.live).size()==0,
    s.taken.subseteq(s.warmed),
    s.warmed.intersect(s.dropped).size()==0,
    // Only the loop reports a failure, for its own read of the next outcome.
    (s.failed!=0) iff (s.phase=="failed"),
    s.failed!=0 implies (s.failed==s.next and s.live.contains(s.failed)),
    s.phase=="done" implies decided==Outcomes,
  }
  run sequentialOnlyTest = init.then(sequentialOnly).then(startRead(1).fail())
  run sequentialReadsEveryPageTest = init.then(sequentialOnly).then(readLive(true)).then(readLive(true))
    .then(readLive(true)).then(finish).expect(s.phase=="done" and s.live==Outcomes and s.taken==Set() and invariant)
  run readAheadStaysWithinLimitTest = init.then(startRead(1)).then(startRead(2)).then(startRead(3).fail())
  run loopWaitsForReadAheadTest = init.then(startRead(1)).then(endWarmup.fail())
  run warmedPagesAreTakenOnceTest = init.then(startRead(1)).then(startRead(2)).then(finishRead(1,true))
    .then(startRead(3)).then(finishRead(3,true)).then(finishRead(2,true)).then(endWarmup)
    .then(takeWarmed).then(takeWarmed).then(takeWarmed).then(finish)
    .expect(s.phase=="done" and s.taken==Outcomes and s.live==Set() and invariant)
  run droppedReadEndsReadAheadTest = init.then(startRead(1)).then(finishRead(1,false)).then(startRead(2).fail())
  run droppedReadIsRepeatedByLoopTest = init.then(startRead(1)).then(startRead(2)).then(finishRead(2,false))
    .then(finishRead(1,true)).then(endWarmup).then(takeWarmed).then(readLive(true)).then(readLive(true))
    .then(finish).expect(s.phase=="done" and s.taken==Set(1) and s.live==Set(2,3) and invariant)
  run failureSurfacesFromLoopInOrderTest = init.then(startRead(1)).then(startRead(2)).then(finishRead(2,false))
    .then(finishRead(1,true)).then(endWarmup).expect(s.failed==0).then(takeWarmed).then(readLive(false))
    .expect(s.phase=="failed" and s.failed==2 and s.taken==Set(1) and invariant)
  run warmedPageIsNotReadAgainTest = init.then(startRead(1)).then(finishRead(1,true)).then(startRead(2))
    .then(finishRead(2,false)).then(endWarmup).then(readLive(true).fail())
}
