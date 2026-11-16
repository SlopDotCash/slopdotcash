// @source scripts/generate-leaderboard.ts
// Four immutable source IDs and up to three whole-batch limit failures. Splitting
// is sequential and lossless. A non-limit error never means source unavailable.
module recovery {
  var s: {queued: List[Set[int]], completed: Set[int], unavailable: Set[int],
    failures: int, stopped: bool}
  action init = s' = {queued:List(Set(0,1), Set(2,3)), completed:Set(),
    unavailable:Set(), failures:0, stopped:false}
  action succeed = all {not(s.stopped), s.queued.length() > 0,
    s' = s.with("completed",s.completed.union(s.queued.head()))
      .with("queued",s.queued.tail())}
  action limit = all {not(s.stopped), s.failures < 3, s.queued.length() > 0,
    s.queued.head().size() == 2,
    val first = if(s.queued.head().contains(0)) 0 else 2
    s' = s.with("queued",List(Set(first),Set(first + 1)).concat(s.queued.tail()))
      .with("failures",s.failures + 1)}
  action missing = all {not(s.stopped), s.queued.length() > 0, s.queued.head().size() == 1,
    s' = s.with("unavailable",s.unavailable.union(s.queued.head()))
      .with("queued",s.queued.tail())}
  action providerError = all {not(s.stopped),s.queued.length() > 0,
    s' = s.with("stopped",true)}
  action step = any {succeed,limit,missing,providerError,s' = s}
  val remaining = s.queued.foldl(Set(), (acc,group) => acc.union(group))
  val invariant = all {
    s.completed.intersect(s.unavailable) == Set(),
    remaining.intersect(s.completed.union(s.unavailable)) == Set(),
    remaining.union(s.completed).union(s.unavailable) == Set(0,1,2,3)}
  run recoverLimitTest = init.then(limit).then(succeed).then(succeed)
    .then(succeed).expect(s.completed == Set(0,1,2,3) and s.unavailable == Set())
  run permanentFailureTest = init.then(providerError)
    .expect(s.stopped and s.unavailable == Set() and s.completed == Set())
}
