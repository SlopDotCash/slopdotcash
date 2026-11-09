// @source scripts/collect-quality-census.ts
// @source scripts/collect-quality-discussions.ts
// @source scripts/complete-quality-discussions.ts
// @source scripts/enrich-contribution-quality.ts
// @source scripts/enrich-quality-discussions.ts
// @source scripts/prepare-contribution-quality.ts
// @source scripts/sync-contribution-quality.ts
// Private capture -> source-bound safe metadata -> static publication. Signals
// are advisory and never modify a monetary award. Two sources/discussions.
module quality_capture {
  var s: {phase:str,expected:Set[int],census:Set[int],discussions:Set[int],sameHead:bool,
    sameSnapshot:bool,flags:int,weight:int,rawPublished:bool,published:bool}
  action initialize(empty) = s'={phase:"collect",expected:if(empty) Set() else Set(1,2),census:Set(),discussions:Set(),sameHead:false,
    sameSnapshot:false,flags:0,weight:if(empty) 0 else 3,rawPublished:false,published:false}
  action init = {nondet empty=Set(false,true).oneOf() initialize(empty)}
  action collect(id) = all {s.phase=="collect",s.expected.contains(id),
    s'=s.with("census",s.census.union(Set(id)))}
  action bind(snapshot) = all {s.phase=="collect",s.census==s.expected,snapshot,
    s'=s.with("phase","bound").with("sameSnapshot",true)}
  action discussion(id,matchingHead) = all {s.phase=="bound",s.census.contains(id),matchingHead,
    s'=s.with("discussions",s.discussions.union(Set(id))).with("sameHead",true)}
  action annotate = all {s.phase=="bound",s.flags<2,s'=s.with("flags",s.flags+1)}
  action validate = all {s.phase=="bound",s.sameSnapshot,s'=s.with("phase","validated")}
  action publish = all {s.phase=="validated",s'=s.with("phase","published").with("published",true)}
  action step = {nondet id=Set(1,2).oneOf() nondet a=Set(false,true).oneOf()
    any {collect(id),bind(a),discussion(id,a),annotate,validate,publish,s'=s}}
  val invariant = all {s.weight==(if(s.expected.size()==0) 0 else 3),not(s.rawPublished),s.discussions.subseteq(s.census),
    s.published implies (s.sameSnapshot and s.census==s.expected)}
  run emptyCompleteCensusTest = initialize(true).then(bind(true)).then(validate).then(publish).expect(s.published and s.census==Set())
  run wrongSnapshotRefusedTest = initialize(false).then(collect(1)).then(collect(2)).then(bind(false).fail())
  run changedDiscussionHeadRefusedTest = initialize(false).then(collect(1)).then(collect(2)).then(bind(true)).then(discussion(1,false).fail())
  run advisoryFlagsDoNotChangeAwardsTest = initialize(false).then(collect(1)).then(collect(2)).then(bind(true))
    .then(annotate).then(annotate).then(validate).then(publish).expect(s.weight==3 and not(s.rawPublished) and invariant)
}
