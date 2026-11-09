// @source src/lib/scoring-policy.ts
// @source src/lib/verified-allocation.ts
// @source src/lib/verified-selection.ts
// @source src/lib/verified-reviewers.ts
// @source src/lib/leaderboard.ts
// @source src/lib/points.ts
// @source src/lib/verified-aggregation.ts
// Seven formal reviews, six actors, one optional repeated review. Two equal-time review
// IDs vary lexical order; A's later band is 1 or 3. Pool size 0,1,3,9. The first
// review may fall outside the acceptance-anchored allocation window. Current
// scoring window advances while the allocation window stays fixed.
// Finite reduction: `step` ingests the smallest unseen review ID. `seen` is
// read only through `eligible`, by `allocate` (guarded by `seen == 1..7`) and
// by `advanceWindow` (done phase, where `seen` is complete). The invariant
// constrains only the done phase. Every ingestion order ends at the same
// complete set with the same configuration, so the omitted non-prefix
// subsets reach no other allocation or invariant state. Direct
// `ingest(id)` still accepts any unseen ID; `produce` and the named
// scenarios keep arbitrary orders.
module ui_review_pool {
  var s:{phase:str,seen:Set[int],size:int,high:int,tie:bool,outside:bool,later:bool,currentFrom:int,
    credited:List[int],sources:List[int],shares:List[int],poolAmount:int,positive:Set[int],issued:Set[int],retained:Set[int]}
  action init = s'={phase:"choose",seen:Set(),size:0,high:1,tie:false,outside:false,later:true,currentFrom:2,
    credited:List(),sources:List(),shares:List(),poolAmount:0,positive:Set(),issued:Set(),retained:Set()}
  def actor(id:int):int = if(id==3) 1 else if(id>3) id-1 else id
  def at(id:int):int = if(id==1 and s.outside) 0 else if(id==2 and s.tie) 1 else id
  def lexical(id:int):int = if(id==2 and s.tie) 0 else id
  def weight(id:int):int = if(id==3) s.high else 1
  def earlier(a:int,b:int):bool = at(a)<at(b) or (at(a)==at(b) and lexical(a)<lexical(b))
  val eligible = s.seen.filter(id=>at(id)>=1 and (s.later or id!=3))
  val actors = eligible.map(id=>actor(id))
  def reviews(who:int):Set[int] = eligible.filter(id=>actor(id)==who)
  def first(who:int):int = reviews(who).fold(99,(best,id)=>if(best==99 or earlier(id,best)) id else best)
  def source(who:int):int = reviews(who).fold(99,(best,id)=>if(best==99 or weight(id)>weight(best) or (weight(id)==weight(best) and earlier(id,best))) id else best)
  def rank(who:int):int = actors.filter(other=>earlier(first(other),first(who))).size()
  val selected = actors.filter(who=>rank(who)<5)
  val ordered = List(0,1,2,3,4).select(i=>i<selected.size()).foldl(List(),(list,i)=>list.append(selected.filter(who=>rank(who)==i).fold(0,(unused,who)=>who)))
  val sources = ordered.foldl(List(),(list,who)=>list.append(source(who)))
  val sumWeights = selected.fold(0,(sum,who)=>sum+weight(source(who)))
  val pool = if(selected.size()==0) 0 else if(s.size<1) 1 else if(s.size<sumWeights) s.size else sumWeights
  def floorShare(who:int):int = pool*weight(source(who))/sumWeights
  def remainder(who:int):int = pool*weight(source(who))%sumWeights
  val left = pool-selected.fold(0,(sum,who)=>sum+floorShare(who))
  def remainderRank(who:int):int = selected.filter(other=>remainder(other)>remainder(who) or (remainder(other)==remainder(who) and rank(other)<rank(who))).size()
  def share(who:int):int = floorShare(who)+(if(remainderRank(who)<left) 1 else 0)
  action choose(assessed:int,high:int,tie:bool,outside:bool,currentFrom:int,later:bool):bool = all {s.phase=="choose",
    s'=s.with("size",assessed).with("high",high).with("tie",tie).with("outside",outside).with("currentFrom",currentFrom).with("later",later).with("phase","collect")}
  action ingest(id:int):bool = all {s.phase=="collect",not(s.seen.contains(id)),s'=s.with("seen",s.seen.union(Set(id)))}
  action allocate = all {s.phase=="collect",s.seen==1.to(7),
    s'=s.with("phase","done").with("credited",ordered).with("sources",sources)
      .with("shares",ordered.foldl(List(),(list,who)=>list.append(share(who))))
      .with("poolAmount",pool).with("positive",selected.filter(who=>share(who)>0))
      .with("issued",selected.filter(who=>share(who)>0 and at(source(who))>=s.currentFrom))
      .with("retained",selected.filter(who=>share(who)>0 and at(source(who))<s.currentFrom))}
  action advanceWindow = all {s.phase=="done",s.currentFrom==2,
    s'=s.with("currentFrom",4)
      .with("issued",selected.filter(who=>share(who)>0 and at(source(who))>=4))
      .with("retained",selected.filter(who=>share(who)>0 and at(source(who))<4))}
  action configure = {
    nondet assessed=Set(0,1,3,9).oneOf()
    nondet high=Set(1,3).oneOf()
    nondet tie=Set(false,true).oneOf()
    nondet outside=Set(false,true).oneOf()
    nondet currentFrom=Set(2,4).oneOf()
    nondet later=Set(false,true).oneOf()
    choose(assessed,high,tie,outside,currentFrom,later)
  }
  action ingestAny = {nondet id=1.to(7).exclude(s.seen).oneOf() ingest(id)}
  action ingestNext = all {s.seen.size()<7,ingest(s.seen.size()+1)}
  action produce = configure.then(ingestAny).then(ingestAny).then(ingestAny)
    .then(ingestAny).then(ingestAny).then(ingestAny).then(ingestAny).then(allocate)
  action step = any {configure,ingestNext,allocate,advanceWindow,s'=s}
  val invariant = s.phase=="done" implies all {s.credited.length()==5,
    s.shares.foldl(0,(sum,v)=>sum+v)==s.poolAmount,s.poolAmount>=1,s.poolAmount<=9,
    s.issued.intersect(s.retained)==Set(),s.issued.union(s.retained)==s.positive}
  run firstTimeIdAndRemainderTieTest = init.then(choose(1,1,true,false,2,true))
    .then(ingest(1)).then(ingest(2)).then(ingest(3)).then(ingest(4)).then(ingest(5)).then(ingest(6)).then(ingest(7)).then(allocate)
    .expect(s.credited==List(2,1,3,4,5) and s.shares==List(1,0,0,0,0) and s.retained==Set(2))
  run outsideAllocationTakesNoSlotTest = init.then(choose(9,3,false,true,2,true))
    .then(ingest(1)).then(ingest(2)).then(ingest(3)).then(ingest(4)).then(ingest(5)).then(ingest(6)).then(ingest(7)).then(allocate)
    .expect(s.credited==List(2,1,3,4,5) and s.sources==List(2,3,4,5,6))
  run currentWindowDoesNotRedistributeTest = init.then(choose(9,3,false,false,4,true))
    .then(ingest(1)).then(ingest(2)).then(ingest(3)).then(ingest(4)).then(ingest(5)).then(ingest(6)).then(ingest(7)).then(allocate)
    .expect(s.credited==List(1,2,3,4,5) and s.retained.contains(1) and s.retained.contains(2))
  run outsideOnlyTakesNoSlotTest = init.then(choose(9,3,false,true,2,false))
    .then(ingest(1)).then(ingest(2)).then(ingest(3)).then(ingest(4)).then(ingest(5)).then(ingest(6)).then(ingest(7)).then(allocate)
    .expect(s.credited==List(2,3,4,5,6) and s.sources==List(2,4,5,6,7))
  run advancingWindowKeepsSharesTest = init.then(choose(9,3,false,false,2,true))
    .then(ingest(1)).then(ingest(2)).then(ingest(3)).then(ingest(4)).then(ingest(5)).then(ingest(6)).then(ingest(7)).then(allocate).then(advanceWindow)
    .expect(s.credited==List(1,2,3,4,5) and s.shares==List(3,1,1,1,1) and s.retained==Set(1,2))
  run orderedIngestionReachesSameAllocationTest = init.then(choose(1,1,true,false,2,true))
    .then(ingestNext).then(ingestNext).then(ingestNext).then(ingestNext).then(ingestNext).then(ingestNext).then(ingestNext)
    .then(allocate).expect(s.credited==List(2,1,3,4,5) and s.shares==List(1,0,0,0,0) and s.retained==Set(2) and invariant)
  run sampledPoolTest = init.then(produce).expect(invariant)
}
