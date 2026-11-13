// @source src/lib/verified-aggregation.ts
// @source src/lib/points.ts
// @source src/lib/score-penalties.ts
// Two signed entries and two ordered requests across two independent buckets.
// Entries are -1..1; initial balances and requests are 0..2. Runtime uses BigInt.
module bucket_aggregation {
  pure def minimum(a, b) = if(a < b) a else b
  var s: {phase:str,entryA:int,entryB:int,bucketA:int,bucketB:int,
    sum0:int,sum1:int,initial0:int,initial1:int,requestA:int,requestB:int,
    requestBucketA:int,requestBucketB:int,appliedA:int,appliedB:int,
    remaining0:int,remaining1:int}
  action init = s'={phase:"new",entryA:0,entryB:0,bucketA:0,bucketB:0,
    sum0:0,sum1:0,initial0:0,initial1:0,requestA:0,requestB:0,
    requestBucketA:0,requestBucketB:0,appliedA:0,appliedB:0,remaining0:0,remaining1:0}
  action aggregate(a,b,ba,bb,x,y,qa,qb,bqa,bqb) = {
    val aa=minimum(qa,if(bqa==0) x else y)
    val r0=x-(if(bqa==0) aa else 0)
    val r1=y-(if(bqa==1) aa else 0)
    val ab=minimum(qb,if(bqb==0) r0 else r1)
    all {s.phase=="new",s'={phase:"done",entryA:a,entryB:b,bucketA:ba,bucketB:bb,
      sum0:(if(ba==0) a else 0)+(if(bb==0) b else 0),
      sum1:(if(ba==1) a else 0)+(if(bb==1) b else 0),
      initial0:x,initial1:y,requestA:qa,requestB:qb,requestBucketA:bqa,requestBucketB:bqb,
      appliedA:aa,appliedB:ab,remaining0:r0-(if(bqb==0) ab else 0),remaining1:r1-(if(bqb==1) ab else 0)}}
  }
  action produce = {
    nondet a=Set(-1,0,1).oneOf() nondet b=Set(-1,0,1).oneOf()
    nondet ba=Set(0,1).oneOf() nondet bb=Set(0,1).oneOf()
    nondet x=Set(0,1,2).oneOf() nondet y=Set(0,1,2).oneOf()
    nondet qa=Set(0,1,2).oneOf() nondet qb=Set(0,1,2).oneOf()
    nondet bqa=Set(0,1).oneOf() nondet bqb=Set(0,1).oneOf()
    aggregate(a,b,ba,bb,x,y,qa,qb,bqa,bqb)
  }
  action step = if(s.phase=="new") produce else s'=s
  val invariant = s.phase=="done" implies all {
    s.sum0+s.sum1==s.entryA+s.entryB,
    s.remaining0>=0,s.remaining1>=0,s.appliedA>=0,s.appliedB>=0,
    s.appliedA<=s.requestA,s.appliedB<=s.requestB,
    s.remaining0+s.remaining1+s.appliedA+s.appliedB==s.initial0+s.initial1,
    s.appliedA==minimum(s.requestA,if(s.requestBucketA==0) s.initial0 else s.initial1),
    s.remaining0==s.initial0-(if(s.requestBucketA==0) s.appliedA else 0)-(if(s.requestBucketB==0) s.appliedB else 0),
    s.remaining1==s.initial1-(if(s.requestBucketA==1) s.appliedA else 0)-(if(s.requestBucketB==1) s.appliedB else 0)
  }
  run signedBucketsStaySeparateTest = init.then(aggregate(1,-1,0,1,0,0,0,0,0,1))
    .expect(s.sum0==1 and s.sum1 == -1 and invariant)
  run sameBucketPreservesNegativeSumTest = init.then(aggregate(-1,-1,1,1,0,0,0,0,0,1))
    .expect(s.sum1 == -2 and invariant)
  run earlierRequestConsumesFirstTest = init.then(aggregate(0,0,0,0,2,1,2,2,0,0))
    .expect(s.appliedA==2 and s.appliedB==0 and s.remaining1==1 and invariant)
  run independentRequestsTest = init.then(aggregate(0,0,0,0,2,1,1,2,0,1))
    .expect(s.appliedA==1 and s.appliedB==1 and s.remaining0==1 and invariant)
  run zeroBalancesCannotSpendTest = init.then(aggregate(0,0,0,0,0,0,2,2,0,1))
    .expect(s.appliedA==0 and s.appliedB==0 and invariant)
}
