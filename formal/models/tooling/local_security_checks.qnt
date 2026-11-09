// @source scripts/run-security-payments.mjs
// Two-slot scheduler continues independent local checks after failure. Three
// representative tasks abstract the twelve command entries; exit waits for all.
module local_security_checks {
  type S = { nextTask: int, active: Set[int], completed: Set[int], failed: bool, reported: bool, exitCode: int }
  var s: S
  action init = s' = { nextTask: 1,active: Set(),completed: Set(),failed: false,reported: false,exitCode: 0 }
  action start = all { s.nextTask<=3,s.active.size()<2,
    s'=s.with("active",s.active.union(Set(s.nextTask))).with("nextTask",s.nextTask+1) }
  action finish(id: int, ok: bool): bool = all { s.active.contains(id),
    s'=s.with("active",s.active.exclude(Set(id))).with("completed",s.completed.union(Set(id))).with("failed",s.failed or not(ok)) }
  action report = all { s.completed==Set(1,2,3),s'=s.with("reported",true).with("exitCode",if(s.failed) 1 else 0) }
  action step = { nondet id=1.to(3).oneOf() nondet ok=Set(true,false).oneOf() any { start,finish(id,ok),report,s'=s } }
  val invariant = all { s.active.size()<=2,s.active.intersect(s.completed)==Set(),s.reported implies s.completed==Set(1,2,3) and s.exitCode==(if(s.failed) 1 else 0) }
  run failureDoesNotSkipRemainingTest = init.then(start).then(start).then(finish(1,false)).then(start).then(finish(2,true)).then(finish(3,true)).then(report).expect(s.exitCode==1 and invariant)
  run unfinishedCannotPassTest = init.then(start).then(finish(1,true)).then(report.fail())
}
