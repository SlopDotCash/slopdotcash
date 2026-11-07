// @source src/lib/funding-address.mjs
// One network/asset route history; replacement preserves the prior disjoint interval.
module funding_routes {
  type S = { current: int, previous: int, from: int, oldTo: int, now: int }
  var s: S
  action init = s' = {current:0,previous:0,from:0,oldTo:0,now:0}
  action tick = all {s.now<3,s'=s.with("now",s.now+1)}
  action first = all {s.current==0,s'=s.with("current",1).with("from",s.now)}
  action replace = all {s.current==1,s.now>s.from,s'=s.with("previous",1).with("current",2).with("oldTo",s.now).with("from",s.now)}
  action step = any {tick,first,replace,s'=s}
  val invariant = all {s.previous>0 implies (s.oldTo<=s.from and s.current!=s.previous),s.from<=s.now}
  run preservedHistoryTest = init.then(first).then(tick).then(replace).expect(s.previous==1 and s.current==2 and invariant)
  run overlappingRefusedTest = init.then(first).then(replace.fail())
}
