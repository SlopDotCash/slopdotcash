// @source src/lib/project-proposal.ts
// @source src/ProjectProposalPage.tsx
// @evidence scripts/project-lookup-client.test.ts
// @evidence tests/e2e/project-proposal.spec.ts
// Browser decoder, separate from repository request ownership/provider lookup.
// Two branches (ordinary and a prototype-name branch), two commit identities.
// HTTP/deadline/bounded-body operations are supplied outcomes. The source checks
// branch/default inclusion and optional commit entries; other RepositoryLookup
// fields remain a trusted server contract, not newly proved schema validation.
// A missing optional map or missing entry gives no commit. Normalized provided
// maps and the caller's absent-map fallback have no inherited object entries.
// There is no provider identity/finality or project authority claim here.
// Named scenarios and regression definitions are unexecuted.
module ui_project_lookup_response {
  val branches = Set(1, 2)
  val faults = Set("none", "path", "fetch", "body", "http401", "http-message", "http-other",
    "repository", "branches", "default", "map-null", "map-array", "map-scalar", "entry-name", "entry-value")
  type State = { phase: str, fault: str, provided: bool, entries: Set[int],
    normalized: bool, returned: bool, selected: int, sourceCommit: int,
    prototypeLeaked: bool, error: str }
  var s: State
  action init = s' = { phase: "input", fault: "none", provided: false,
    entries: Set(), normalized: false, returned: false, selected: 1,
    sourceCommit: 0, prototypeLeaked: false, error: "none" }
  action configure(fault: str, provided: bool, entries: Set[int], selected: int): bool = all {
    s.phase == "input", faults.contains(fault), entries.subseteq(branches), branches.contains(selected),
    provided or entries == Set(), s' = s.with("fault", fault).with("provided", provided)
      .with("entries", entries).with("selected", selected) }
  def refused(reason: str): State = s.with("phase", "done").with("error", reason)
  action path = all { s.phase == "input", s' = if (s.fault == "path") refused("path") else s.with("phase", "fetch") }
  action fetched = all { s.phase == "fetch", s' = if (s.fault == "fetch") refused("fetch") else s.with("phase", "body") }
  action body = all { s.phase == "body", s' = if (s.fault == "body") refused("generic-lookup") else s.with("phase", "http") }
  action http = all { s.phase == "http", s' =
    if (s.fault == "http401") refused("sign-in")
    else if (s.fault == "http-message") refused("server-message")
    else if (s.fault == "http-other") refused("generic-lookup")
    else s.with("phase", "repository") }
  action repository = all { s.phase == "repository", s' =
    if (s.fault == "repository") refused("generic-lookup") else s.with("phase", "branches") }
  action branchList = all { s.phase == "branches", s' =
    if (Set("branches", "default").contains(s.fault)) refused("branch-list") else s.with("phase", "commits") }
  action commits = all { s.phase == "commits", s' =
    if (s.provided and Set("map-null", "map-array", "map-scalar", "entry-name", "entry-value").contains(s.fault)) refused("branch-commits")
    else s.with("phase", "returned").with("returned", true).with("normalized", s.provided) }
  action consume = all { s.phase == "returned", s' = s.with("phase", "done")
    .with("sourceCommit", if (s.entries.contains(s.selected)) s.selected else 0) }
  // Counterexample to the old ordinary-object fallback. Kept outside step.
  action oldFallback = all { s.phase == "returned", s.selected == 2, not(s.entries.contains(2)),
    s' = s.with("prototypeLeaked", true).with("phase", "done") }
  action step = {
    nondet fault = faults.oneOf() nondet provided = Set(false, true).oneOf()
    nondet entries = branches.powerset().oneOf() nondet selected = branches.oneOf()
    any { configure(fault, provided, entries, selected), path, fetched, body, http,
      repository, branchList, commits, consume, s' = s }
  }
  val invariant = all { not(s.prototypeLeaked),
    s.returned implies s.error == "none" and (not(s.provided) or s.normalized),
    s.sourceCommit != 0 implies s.entries.contains(s.selected) and s.sourceCommit == s.selected,
    s.error != "none" implies not(s.returned) }
  action toHttp = path.then(fetched).then(body).then(http)
  action decode = toHttp.then(repository).then(branchList).then(commits)
  action complete = decode.then(consume)
  run absentOptionalMapRemainsMissingTest = init.then(configure("none", false, Set(), 2)).then(complete).expect(s.sourceCommit == 0 and invariant)
  run partialMapDoesNotInheritMissingBranchTest = init.then(configure("none", true, Set(1), 2)).then(complete).expect(s.normalized and s.sourceCommit == 0 and invariant)
  run ownPrototypeNameCommitSurvivesTest = init.then(configure("none", true, Set(2), 2)).then(complete).expect(s.sourceCommit == 2 and invariant)
  run allReturnedCommitEntriesCanBeSelectedTest = init.then(configure("none", true, Set(1, 2), 1)).then(complete).expect(s.sourceCommit == 1 and invariant)
  run oldFallbackCounterexampleTest = init.then(configure("none", false, Set(), 2)).then(decode).then(oldFallback).expect(s.prototypeLeaked and not(invariant))
  run invalidPathDoesNotFetchTest = init.then(configure("path", false, Set(), 1)).then(path).expect(s.error == "path" and invariant)
  run fetchFailurePreventsBodyTest = init.then(configure("fetch", false, Set(), 1)).then(path).then(fetched).expect(s.error == "fetch" and invariant)
  run bodyFailureOverridesHttpStatusTest = init.then(configure("body", false, Set(), 1)).then(path).then(fetched).then(body).expect(s.error == "generic-lookup" and invariant)
  run unauthorizedUsesSignInMessageTest = init.then(configure("http401", false, Set(), 1)).then(toHttp).expect(s.error == "sign-in" and invariant)
  run suppliedErrorMessageSurvivesTest = init.then(configure("http-message", false, Set(), 1)).then(toHttp).expect(s.error == "server-message" and invariant)
  run nonspecificHttpFailureUsesGenericMessageTest = init.then(configure("http-other", false, Set(), 1)).then(toHttp).expect(s.error == "generic-lookup" and invariant)
  run missingRepositoryRefusedTest = init.then(configure("repository", false, Set(), 1)).then(toHttp).then(repository).expect(s.error == "generic-lookup" and invariant)
  run malformedBranchListRefusedTest = init.then(configure("branches", false, Set(), 1)).then(toHttp).then(repository).then(branchList).expect(s.error == "branch-list" and invariant)
  run absentDefaultBranchRefusedTest = init.then(configure("default", false, Set(), 1)).then(toHttp).then(repository).then(branchList).expect(s.error == "branch-list" and invariant)
  run nullCommitMapRefusedTest = init.then(configure("map-null", true, Set(), 1)).then(decode).expect(s.error == "branch-commits" and invariant)
  run arrayCommitMapRefusedTest = init.then(configure("map-array", true, Set(), 1)).then(decode).expect(s.error == "branch-commits" and invariant)
  run entryForUnlistedBranchRefusedTest = init.then(configure("entry-name", true, Set(1), 1)).then(decode).expect(s.error == "branch-commits" and invariant)
  run malformedCommitValueRefusedTest = init.then(configure("entry-value", true, Set(1), 1)).then(decode).expect(s.error == "branch-commits" and invariant)
}
