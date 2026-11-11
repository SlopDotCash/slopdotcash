// @source scripts/extend-published-profiles.ts
// A manual release on published data reuses the last collected census. A
// project activated after that collection is added with zero counts. A
// collected repository keeps its counts and nothing is removed, so the next
// full collection replaces the zeros with real counts.
module published_census_extension {
  val Repos = Set("a","b","c")
  var s: {phase:str,active:Set[str],collected:Set[str],zero:Set[str]}
  action initialize(active,collected) = s'={phase:"published",active:active,collected:collected,zero:Set()}
  action init = {nondet active=Repos.powerset().oneOf() nondet collected=Repos.powerset().oneOf()
    initialize(active,collected)}
  action extend = all {s.phase=="published",
    s'=s.with("phase","extended").with("zero",s.active.exclude(s.collected))}
  action step = any {extend,s'=s}
  val invariant = all {s.zero.intersect(s.collected)==Set(),s.zero.subseteq(s.active),
    s.phase=="extended" implies s.active.subseteq(s.collected.union(s.zero))}
  run newProjectAddedWithZeroTest = initialize(Set("a","b"),Set("a")).then(extend)
    .expect(s.zero==Set("b") and s.collected==Set("a") and invariant)
  run coveredCensusUnchangedTest = initialize(Set("a"),Set("a","c")).then(extend)
    .expect(s.zero==Set() and s.collected==Set("a","c") and invariant)
  run extendOnceTest = initialize(Set("a","b"),Set()).then(extend).then(extend.fail())
}
