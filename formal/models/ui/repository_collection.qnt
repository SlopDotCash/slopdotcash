// @source src/lib/repositories.mjs
// @source src/lib/projects.mjs
// @evidence scripts/project-policy-state.test.ts
// Two prevalidated projects with two/one repositories. The caller supplies
// order; collection does not sort by cap or re-check authority. Retired inputs
// are paused under the schema. URL parsing can abort the whole flatMap return.
// Canonical current path comparison is case-insensitive. Returned row objects
// are shallow-frozen; alias arrays are borrowed, with production source trees
// already deep-frozen by buildRegistry. This is not fresh GitHub authority.
// Historical lookup does not authorize collection. New scenarios unexecuted.
module repository_collection {
  type State = { phase: str, firstActive: bool, secondActive: bool,
    firstVerified: bool, reverseOrder: bool, invalidUrl: int, renamed: Set[int],
    selected: List[int], cursor: int, working: List[int], expectedNode: Set[int],
    primary: int, returned: bool, shallowFrozen: bool, lookupResult: int }
  var s: State
  val firstRows = List(1, 2)
  val secondRows = List(3)
  action init = s' = { phase: "input", firstActive: true, secondActive: true,
    firstVerified: true, reverseOrder: false, invalidUrl: 0, renamed: Set(),
    selected: List(), cursor: 0, working: List(), expectedNode: Set(), primary: 0,
    returned: false, shallowFrozen: false, lookupResult: 0 }
  action configure(firstActive: bool, secondActive: bool, verified: bool, reverseOrder: bool, badUrl: int): bool = all {
    s.phase == "input", 0.to(3).contains(badUrl), s' = s.with("firstActive", firstActive)
      .with("secondActive", secondActive).with("firstVerified", verified)
      .with("reverseOrder", reverseOrder).with("invalidUrl", badUrl) }
  action rename(id: int): bool = all { s.phase == "input", Set(1, 2, 3).contains(id),
    s' = s.with("renamed", s.renamed.union(Set(id))) }
  action begin = {
    val a = if (s.firstActive) firstRows else List()
    val b = if (s.secondActive) secondRows else List()
    all { s.phase == "input", s' = s.with("phase", "flatten")
      .with("selected", if (s.reverseOrder) b.concat(a) else a.concat(b)) }
  }
  action inspect = {
    val id = if (s.cursor < s.selected.length()) s.selected.nth(s.cursor) else 0
    all { s.phase == "flatten", s' =
      if (s.cursor == s.selected.length()) s.with("phase", "done").with("returned", true).with("shallowFrozen", true)
      else if (s.invalidUrl == id) s.with("phase", "error")
      else s.with("cursor", s.cursor + 1).with("working", s.working.append(id))
        .with("primary", if (s.cursor == 0) id else s.primary)
        .with("expectedNode", if (s.renamed.contains(id)) s.expectedNode.union(Set(id)) else s.expectedNode) }
  }
  action lookup(id: int, stringInput: bool): bool = all { Set("done", "error").contains(s.phase), 0.to(3).contains(id),
    s' = s.with("lookupResult", if (stringInput) id else 0) }
  action step = {
    nondet a = Set(false, true).oneOf() nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf() nondet d = Set(false, true).oneOf()
    nondet id = 0.to(3).oneOf()
    any { configure(a, b, c, d, id), rename(id), begin, inspect, lookup(id, a), s' = s }
  }
  val invariant = all { s.cursor <= s.selected.length(),
    s.working == s.selected.slice(0, s.cursor),
    s.returned implies s.working == s.selected and s.shallowFrozen,
    s.phase == "error" implies not(s.returned),
    s.primary == (if (s.working.length() > 0) s.working.nth(0) else 0),
    not(s.firstActive) implies not(s.working.contains(1)) and not(s.working.contains(2)),
    not(s.secondActive) implies not(s.working.contains(3)),
    s.expectedNode.subseteq(s.renamed) }
  action finishThree = begin.then(inspect).then(inspect).then(inspect).then(inspect)
  run inputOrderAndRepositoryOrderPreservedTest = init.then(finishThree).expect(s.working == List(1, 2, 3) and s.primary == 1 and invariant)
  run callerOrderDeterminesPrimaryTest = init.then(configure(true, true, true, true, 0)).then(finishThree).expect(s.working == List(3, 1, 2) and s.primary == 3 and invariant)
  run pausedFirstPromotesNextProjectTest = init.then(configure(false, true, true, false, 0)).then(begin).then(inspect).then(inspect).expect(s.working == List(3) and s.primary == 3 and invariant)
  run pausedSecondDoesNotCollectTest = init.then(configure(true, false, true, false, 0)).then(begin).then(inspect).then(inspect).then(inspect).expect(s.working == List(1, 2) and invariant)
  run noActiveProjectsHasNoPrimaryTest = init.then(configure(false, false, false, false, 0)).then(begin).then(inspect).expect(s.returned and s.primary == 0 and s.working == List() and invariant)
  run unverifiedActiveStillCollectsTest = init.then(configure(true, true, false, false, 0)).then(finishThree).expect(s.working == List(1, 2, 3) and invariant)
  run canonicalPathNeedsNoNodePinTest = init.then(finishThree).expect(s.expectedNode == Set() and invariant)
  run transferredPathUsesPermanentNodeIdTest = init.then(rename(1)).then(finishThree).expect(s.expectedNode == Set(1) and invariant)
  run everyRenamedRowCarriesPinTest = init.then(rename(1)).then(rename(2)).then(rename(3)).then(finishThree).expect(s.expectedNode == Set(1, 2, 3) and invariant)
  run invalidLaterUrlReturnsNoPartialArrayTest = init.then(configure(true, true, true, false, 3)).then(begin).then(inspect).then(inspect).then(inspect).expect(s.working == List(1, 2) and not(s.returned) and invariant)
  run pausedBadUrlIsNotParsedTest = init.then(configure(false, true, true, false, 1)).then(begin).then(inspect).then(inspect).expect(s.returned and invariant)
  run historicalLookupMayFindPausedRepositoryTest = init.then(configure(false, false, false, false, 0)).then(begin).then(inspect).then(lookup(1, true)).expect(s.lookupResult == 1 and s.primary == 0 and invariant)
  run invalidLookupInputReturnsNullTest = init.then(finishThree).then(lookup(1, false)).expect(s.lookupResult == 0 and invariant)
}
