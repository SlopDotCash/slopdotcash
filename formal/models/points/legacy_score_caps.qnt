// @source src/lib/leaderboard.ts
// Historical pre-August scoring only. One current and one archived independent
// (actor, project, UTC month) bucket; at most twelve considered outcomes per
// bucket. Source uniqueness, qualification and newest-first ordering are
// established by the caller; this model tests cap/diminishing accumulation.
module legacy_score_caps {
  var s: {kind: str, count: int, points: int, attempts: int, excluded: int,
    epoch: int, retainedPoints: int, bucketAxis:str}
  // Twelve is the finite exploration bound for uncapped merges, not a cap.
  pure def cap(kind) = if(kind=="merge") 12 else if(kind=="issue" or kind=="test") 5
    else if(kind=="evidence") 5 else if(kind=="review") 10 else 3
  // The exact first twelve ceil(10/sqrt(ordinal)) values; no approximation to
  // unbounded floating-point arithmetic is claimed.
  pure def award(kind, count) = if (kind == "merge")
    List(10,8,6,5,5,5,4,4,4,4,4,3).nth(count)
    else if (kind == "evidence") 6 else if (kind == "review") 3
    else if (kind == "evaluation") 8 else 4
  action init = s' = {kind:"unset",count:0,points:0,attempts:0,excluded:0,epoch:0,retainedPoints:0,bucketAxis:"base"}
  action choose(kind) = all {s.kind=="unset",s'=s.with("kind",kind)}
  action consider = all {s.kind!="unset",s.attempts<12,
    s'=if(s.count<cap(s.kind)) s.with("attempts",s.attempts+1)
      .with("count",s.count+1).with("points",s.points+award(s.kind,s.count))
      else s.with("attempts",s.attempts+1).with("excluded",s.excluded+1)}
  action nextBucket(axis) = all {s.kind!="unset",s.epoch==0,s.attempts>0,
    Set("actor","project","month").contains(axis),
    s'=s.with("epoch",1).with("retainedPoints",s.points)
      .with("bucketAxis",axis)
      .with("count",0).with("points",0).with("attempts",0).with("excluded",0)}
  action seven = consider.then(consider).then(consider).then(consider)
    .then(consider).then(consider).then(consider)
  action produce = {
    nondet kind=Set("merge","test").oneOf()
    choose(kind).then(seven)
  }
  action step = {
    nondet kind=Set("merge","issue","test","evidence","review","evaluation").oneOf()
    nondet axis=Set("actor","project","month").oneOf()
    any {choose(kind),consider,nextBucket(axis),s'=s}
  }
  val invariant = all {
    s.count<=cap(s.kind),s.count+s.excluded==s.attempts,s.points>=0,
    s.kind=="evidence" implies s.points<=30,
    s.kind=="review" implies s.points<=30,
    s.kind=="evaluation" implies s.points<=24,
    Set("issue","test").contains(s.kind) implies s.points<=20,
    s.kind=="merge" implies s.excluded==0 and (s.count==0 or s.points>=s.count),
    s.retainedPoints>=0,s.epoch<=1
  }
  run uncappedPositiveMergesTest = init.then(choose("merge")).then(seven).expect(s.count==7 and s.points==43 and invariant)
  run newestFiveMaterialTestsTest = init.then(choose("test")).then(seven).expect(s.count==5 and s.points==20 and s.excluded==2 and invariant)
  run issueCapTest = init.then(choose("issue")).then(seven).expect(s.count==5 and s.excluded==2 and invariant)
  run evidencePointCapTest = init.then(choose("evidence")).then(seven).expect(s.points==30 and s.excluded==2 and invariant)
  run evaluationCapTest = init.then(choose("evaluation")).then(seven).expect(s.points==24 and s.excluded==4 and invariant)
  run reviewCapTest = init.then(choose("review")).then(seven).then(consider).then(consider).then(consider).then(consider).expect(s.count==10 and s.excluded==1 and invariant)
  run independentActorBucketTest = init.then(choose("test")).then(seven).then(nextBucket("actor")).then(consider).expect(s.count==1 and s.points==4 and s.retainedPoints==20 and invariant)
  run independentProjectBucketTest = init.then(choose("test")).then(seven).then(nextBucket("project")).then(consider).expect(s.count==1 and s.points==4 and s.retainedPoints==20 and invariant)
  run independentMonthBucketTest = init.then(choose("test")).then(seven).then(nextBucket("month")).then(consider).expect(s.count==1 and s.points==4 and s.retainedPoints==20 and invariant)
}
