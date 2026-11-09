// @source src/lib/use-snapshot.ts
// @source src/lib/use-standings.ts
// Two consumers and two reads; a third acquire is represented by rejoining.
// Per-consumer bindings model effect active guards; cache identity is separate.
// Models cache ownership, not JSON/scoring validity (ui_snapshot_contract).
// E2E: tests/e2e/home-cache.spec.ts and project-standings-navigation.spec.ts.
module ui_snapshot_cache {
  var s:{latest:int,consumers:int->Set[int],aborted:Set[int],settled:Set[int],
    releaseQueued:Set[int],cache:int,visible:int->int,bound:int->int}
  action init = s'={latest:1,consumers:Map(1->Set(),2->Set()),aborted:Set(),settled:Set(),
    releaseQueued:Set(),cache:0,visible:Map(1->0,2->0),bound:Map(1->0,2->0)}
  action acquire(consumer:int):bool = all {s.latest>0,not(s.aborted.contains(s.latest)),not(s.settled.contains(s.latest)),
    s'=s.with("consumers",s.consumers.set(s.latest,s.consumers.get(s.latest).union(Set(consumer))))
      .with("bound",s.bound.set(consumer,s.latest))}
  action cacheHit(consumer:int):bool = all {s.cache>0,s'=s.with("visible",s.visible.set(consumer,s.cache)).with("bound",s.bound.set(consumer,0))}
  action force = all {s.latest==1,s'=s.with("latest",2).with("cache",0)}
  action release(read:int,consumer:int):bool = all {s.consumers.get(read).contains(consumer),
    s'=s.with("consumers",s.consumers.set(read,s.consumers.get(read).exclude(Set(consumer))))
      .with("releaseQueued",s.releaseQueued.union(Set(read)))
      .with("bound",if(s.bound.get(consumer)==read) s.bound.set(consumer,0) else s.bound)}
  action flushRelease(read:int):bool = all {s.releaseQueued.contains(read),
    s'=if(s.consumers.get(read)==Set() and not(s.settled.contains(read)))
      s.with("aborted",s.aborted.union(Set(read))).with("latest",if(s.latest==read) 0 else s.latest)
        .with("releaseQueued",s.releaseQueued.exclude(Set(read)))
      else s.with("releaseQueued",s.releaseQueued.exclude(Set(read)))}
  action failure(read:int):bool = all {not(s.settled.contains(read)),
    s'=s.with("settled",s.settled.union(Set(read)))}
  action complete(read:int):bool = all {not(s.settled.contains(read)),
    s'=s.with("settled",s.settled.union(Set(read)))
      .with("cache",if(s.latest==read and s.consumers.get(read)!=Set() and not(s.aborted.contains(read))) read else s.cache)
      .with("visible",Set(1,2).mapBy(consumer=>if(s.bound.get(consumer)==read and s.consumers.get(read).contains(consumer) and not(s.aborted.contains(read))) read else s.visible.get(consumer)))}
  action step = any {acquire(1),acquire(2),cacheHit(1),cacheHit(2),force,release(1,1),release(1,2),release(2,1),release(2,2),
    flushRelease(1),flushRelease(2),failure(1),failure(2),complete(1),complete(2),s'=s}
  val invariant = all {s.cache>0 implies s.settled.contains(s.cache) and not(s.aborted.contains(s.cache)),
    s.latest==2 implies s.cache!=1,
    s.aborted.forall(read=>s.consumers.get(read)==Set())}
  run failedForcedRefreshKeepsVisibleRecordTest = init.then(acquire(1)).then(complete(1))
    .then(force).then(acquire(1)).then(failure(2)).expect(s.cache==0 and s.visible.get(1)==1)
  run replacedEffectCannotAcceptOldReadTest = init.then(acquire(1)).then(force).then(acquire(1))
    .then(complete(2)).then(complete(1)).expect(s.visible.get(1)==2 and s.cache==2)
  run oldCleanupCannotUnbindNewReadTest = init.then(acquire(1)).then(force).then(acquire(1))
    .then(release(1,1)).then(complete(2)).expect(s.visible.get(1)==2)
  run cachedMountTest = init.then(acquire(1)).then(complete(1)).then(cacheHit(2)).expect(s.visible.get(2)==1)
  run oldReadCannotReplaceRefreshCacheTest = init.then(acquire(1)).then(force).then(acquire(2))
    .then(complete(2)).then(complete(1)).expect(s.cache==2 and s.visible.get(1)==1)
  run replacementEffectCanJoinBeforeAbortTest = init.then(acquire(1)).then(release(1,1)).then(acquire(2))
    .then(flushRelease(1)).then(complete(1)).expect(s.cache==1 and not(s.aborted.contains(1)))
  run lastConsumerAbortsTest = init.then(acquire(1)).then(release(1,1)).then(flushRelease(1))
    .then(complete(1)).expect(s.cache==0)
}
