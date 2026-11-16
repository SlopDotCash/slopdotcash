// @source src/Link.tsx
// @source src/Points.tsx
// @evidence tests/e2e/navigation.spec.ts
// @evidence tests/e2e/hash-history.spec.ts
// Link's event/timer path, separate from the hash observer. Two plain clicks,
// three same-origin destinations and one native/modified click. Unexecuted.
module ui_link_dispatch {
  pure val ids=Set(1,2)
  pure val destinations=Set(1,2,3)
  var s:{current:int,next:int,queued:Set[int],history:List[int],targets:Set[int],
    scroll:int,readerInput:bool,notified:int,nativeClicks:int}
  action init=s'={current:1,next:1,queued:Set(),history:List(1),targets:Set(),
    scroll:2,readerInput:false,notified:0,nativeClicks:0}
  // Pointer-primary and keyboard activation both reach this same handler.
  action click(destination:int,callback:bool):bool=all{s.next<=2,destinations.contains(destination),
    s'=s.with("current",destination).with("history",s.history.append(destination))
      .with("queued",s.queued.union(Set(s.next))).with("next",s.next+1)
      .with("readerInput",false).with("notified",s.notified+(if(callback)1 else 0))}
  // The browser owns modifier/non-primary navigation. It does not execute
  // this component's preventDefault, history push, callback or scroll timer.
  action nativeClick=all{s.nativeClicks==0,s'=s.with("nativeClicks",1)}
  action targetArrives(destination:int):bool=all{destinations.contains(destination),
    s'=s.with("targets",s.targets.union(Set(destination)))}
  action readerScroll=s'=s.with("scroll",3).with("readerInput",true)
  // Source reads window.location when this callback runs, not the href of
  // the earlier link. It is independent of useHashScroll's takeover flag.
  action scrollTimer(id:int):bool=all{s.queued.contains(id),
    s'=s.with("queued",s.queued.exclude(Set(id)))
      .with("scroll",if(s.targets.contains(s.current))s.current else 0)}
  action step={nondet destination=destinations.oneOf() nondet id=ids.oneOf()
    nondet callback=Set(false,true).oneOf()
    any{click(destination,callback),nativeClick,targetArrives(destination),readerScroll,scrollTimer(id),s'=s}}
  val invariant=all{destinations.contains(s.current),s.queued.subseteq(ids),s.history.length()<=3,
    s.next>=1,s.next<=3,s.notified>=0,s.notified<=2,s.scroll>=0,s.scroll<=3}
  run primaryClickPushesBeforeScrollTest=init.then(click(2,true))
    .expect(s.current==2 and s.history==List(1,2) and s.notified==1 and s.queued==Set(1) and s.scroll==2)
  run modifiedClickKeepsCurrentDocumentTest=init.then(nativeClick)
    .expect(s.current==1 and s.history==List(1) and s.notified==0 and s.queued==Set())
  run arrivingTargetIsUsedByTimerTest=init.then(click(2,false)).then(targetArrives(2)).then(scrollTimer(1))
    .expect(s.scroll==2 and s.queued==Set())
  run missingTargetScrollsTopTest=init.then(click(2,false)).then(scrollTimer(1)).expect(s.scroll==0)
  run oldTimerUsesCurrentDestinationTest=init.then(click(2,false)).then(targetArrives(2))
    .then(click(3,false)).then(scrollTimer(1)).expect(s.current==3 and s.scroll==0 and s.queued==Set(2))
  run bothTimersMayAlignCurrentTargetTest=init.then(click(2,true)).then(click(3,true)).then(targetArrives(3))
    .then(scrollTimer(1)).then(scrollTimer(2)).expect(s.scroll==3 and s.notified==2 and s.queued==Set())
  run queuedClickScrollIsNotObserverTakeoverTest=init.then(click(2,false)).then(readerScroll).then(scrollTimer(1))
    .expect(s.readerInput and s.scroll==0)
}
