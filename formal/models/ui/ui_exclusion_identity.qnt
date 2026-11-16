// @source src/lib/payout-exclusions.mjs
// @source src/lib/github-actor.ts
// Formats 1/2 are two validated GitHub node encodings of one numeric actor.
// Months are [from,until), with 3 representing the open-ended tail in this bound.
module ui_exclusion_identity {
  type Entry = {actor: int, format: int, from: int, until: int}
  var entries: Set[Entry]
  pure def overlap(a: Entry, b: Entry): bool = a.from < b.until and b.from < a.until
  action init = entries' = Set()
  action addExclusion(actor: int, format: int, from: int, until: int): bool = {
    val row = {actor: actor, format: format, from: from, until: until}
    all { entries.size() < 2, from < until,
      entries.forall(prior => prior.actor != actor or not(overlap(prior, row))),
      entries' = entries.union(Set(row)) }
  }
  action step = {
    nondet actor = Set(1,2).oneOf()
    nondet format = Set(1,2).oneOf()
    nondet from = Set(0,1).oneOf()
    nondet until = Set(1,2,3).oneOf()
    any { addExclusion(actor,format,from,until), entries' = entries }
  }
  val invariant = entries.forall(a => entries.forall(b =>
    a == b or a.actor != b.actor or not(overlap(a,b))))
  run aliasOverlapRefusedTest = init.then(addExclusion(1,1,0,3)).then(addExclusion(1,2,1,3).fail())
  run adjacentAliasesTest = init.then(addExclusion(1,1,0,1)).then(addExclusion(1,2,1,3)).expect(entries.size() == 2)
  run differentActorsTest = init.then(addExclusion(1,1,0,3)).then(addExclusion(2,2,0,3)).expect(entries.size() == 2)
}
