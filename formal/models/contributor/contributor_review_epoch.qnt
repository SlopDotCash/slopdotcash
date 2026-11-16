// @source skills/project-contributor-template/scripts/live-report.mjs
// Fixed cutoff/frontier; each exact head needs one terminal disposition before
// a single lower-tier outcome is permitted. Later arrivals stay deferred.
module contributor_review_epoch {
  type S = { frozen: bool, frontier: Set[int], deferred: Set[int], done: Set[int], stale: Set[int], permit: bool }
  var s: S
  action init = s' = { frozen:false,frontier:Set(),deferred:Set(),done:Set(),stale:Set(),permit:false }
  action freeze = all { not(s.frozen),s'=s.with("frozen",true).with("frontier",Set(1,2)).with("deferred",Set(3)) }
  action disposition(id: int, sameHead: bool, staleHead: bool): bool = all { s.frozen,s.frontier.contains(id),not(s.done.contains(id)),sameHead,
    s'=s.with("done",s.done.union(Set(id))).with("stale",if(staleHead) s.stale.union(Set(id)) else s.stale) }
  action complete = all { s.frozen,s.done==s.frontier,s'=s.with("permit",true) }
  action step = { nondet id=1.to(3).oneOf() any { freeze,disposition(id,true,false),disposition(id,true,true),complete,s'=s } }
  val invariant = all { s.done.subseteq(s.frontier),s.stale.subseteq(s.done),s.permit implies s.done==s.frontier and s.frozen }
  run incompleteFrontierNoPermitTest = init.then(freeze).then(disposition(1,true,false)).then(complete.fail())
  run staleHeadIsExplicitDispositionTest = init.then(freeze).then(disposition(1,true,true)).then(disposition(2,true,false)).then(complete).expect(s.permit and s.stale==Set(1) and invariant)
  run wrongFrozenHeadRefusedTest = init.then(freeze).then(disposition(1,false,true).fail())
  run deferredNotInCurrentEpochTest = init.then(freeze).then(disposition(3,true,false).fail())
}
