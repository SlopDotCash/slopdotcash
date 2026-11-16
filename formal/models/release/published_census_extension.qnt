// @source scripts/extend-published-profiles.ts
// @source scripts/published-profiles.ts
// @source src/lib/profiles.ts
// @evidence scripts/published-profiles.test.ts
// PRD sections 4 and 7: retirement preserves history and source-count integrity.
// A manual release reuses the published census; it does not claim a new GitHub
// observation. Original PR rows/counts, people and observation dates stay exact.
// Only genuinely new PR coverage gets zero counts. Issues retain their exact
// payloads across the active/archive partition; missing issue coverage derives
// counts from retained available records, never from unavailable records.
// Bounds: three repositories, three issue records and at most two invocations.
// Payload/date/people integers are opaque identity tokens, not JSON validation or
// timestamp parsing. Other retained-input validation is assumed; duplicate IDs,
// corrupt issue counts and missing PR coverage are checked explicitly here.
// Array order, JavaScript object identity and disk-write atomicity are outside
// this model. Each retarget represents a separate call with a new active list.
module published_census_extension {
  val Repos = Set("a", "b", "c")
  type Issue = {id:int, repository:str, available:bool, payload:int}
  type PrRow = {count:int, excluded:int}
  val A: Issue = {id:1, repository:"a", available:true, payload:11}
  val U: Issue = {id:2, repository:"a", available:false, payload:22}
  val B: Issue = {id:3, repository:"b", available:true, payload:33}
  val RecordInputs = Set(List(), List(A), List(A,U), List(A,U,B), List(A,A))
  pure def originalRow(repo:str): PrRow =
    {count:if(repo=="a") 7 else 3, excluded:if(repo=="a") 2 else 1}
  pure def availableCount(records:List[Issue], repo:str): int =
    records.select(issue => issue.repository==repo and issue.available).length()
  pure def recordSet(records:List[Issue]): Set[Issue] =
    records.indices().map(i => records[i])
  pure def uniqueIds(records:List[Issue]): bool =
    records.indices().forall(i => records.indices().forall(j =>
      i==j or records[i].id!=records[j].id))
  type State = {phase:str, calls:int, active:Set[str], collected:Set[str], zero:Set[str],
    prRows:str->PrRow, people:int, startedAt:int, generatedAt:int, firstObservedAt:int,
    hasIssues:bool, inputValid:bool, originalRecords:List[Issue], items:List[Issue], archived:List[Issue],
    coverage:Set[str], counts:str->int}
  var s: State
  pure def initial(active:Set[str], collected:Set[str], hasIssues:bool,
    coverage:Set[str], records:List[Issue], corrupt:bool): State = {
    phase:"published", calls:0, active:active, collected:collected, zero:Set(),
    prRows:collected.mapBy(repo => originalRow(repo)), people:17,
    startedAt:1, generatedAt:2, firstObservedAt:0, hasIssues:hasIssues,
    inputValid:not(hasIssues) or (coverage.subseteq(collected) and uniqueIds(records)
      and (not(corrupt) or coverage==Set())),
    originalRecords:records, items:records.select(issue => coverage.contains(issue.repository)),
    archived:records.select(issue => not(coverage.contains(issue.repository))),
    coverage:coverage, counts:coverage.mapBy(repo =>
      availableCount(records,repo)+(if(corrupt) 1 else 0)) }
  action initialize(active,collected) =
    s'=initial(active,collected,false,Set(),List(),false)
  action initializeHistory(active,collected,coverage,records,corrupt) =
    s'=initial(active,collected,true,coverage,records,corrupt)
  action init = {
    nondet active=Repos.powerset().oneOf()
    nondet collected=Repos.powerset().oneOf()
    any {initialize(active,collected), {
      nondet coverage=Repos.powerset().oneOf()
      nondet records=RecordInputs.oneOf()
      nondet corrupt=Set(false,true).oneOf()
      initializeHistory(active,collected,coverage,records,corrupt)} }
  }
  val retained = s.items.concat(s.archived)
  val validRetained = not(s.hasIssues) or all {
    s.coverage.subseteq(s.prRows.keys()), uniqueIds(retained),
    s.coverage.forall(repo => s.counts.get(repo)==availableCount(s.items,repo)) }
  action extend = all {s.phase=="published",
    if(not(validRetained)) s'=s.with("phase","refused") else {
      val rows=s.prRows.keys().union(s.active)
      val base=s.with("phase","extended").with("calls",s.calls+1)
        .with("zero",s.zero.union(s.active.exclude(s.prRows.keys())))
        .with("prRows",rows.mapBy(repo => if(s.prRows.keys().contains(repo))
          s.prRows.get(repo) else {count:0,excluded:0}))
      s'=if(not(s.hasIssues)) base else base
        .with("items",retained.select(issue => s.active.contains(issue.repository)))
        .with("archived",retained.select(issue => not(s.active.contains(issue.repository))))
        .with("coverage",s.active)
        .with("counts",s.active.mapBy(repo => if(s.coverage.contains(repo))
          s.counts.get(repo) else availableCount(retained,repo)))
    }}
  action retarget(active:Set[str]): bool = all {s.phase=="extended",s.calls==1,
    s'=s.with("phase","published").with("active",active)}
  action step = any {extend, {
    nondet active=Repos.powerset().oneOf()
    retarget(active)}, s'=s}
  val invariant = all {
    s.calls>=0, s.calls<=2, s.calls>0 implies s.inputValid,
    s.zero.intersect(s.collected)==Set(),
    s.prRows.keys()==s.collected.union(s.zero),
    s.collected.forall(repo => s.prRows.get(repo)==originalRow(repo)),
    s.zero.forall(repo => s.prRows.get(repo)=={count:0,excluded:0}),
    s.people==17, s.startedAt==1, s.generatedAt==2, s.firstObservedAt==0,
    retained.length()==s.originalRecords.length(),
    recordSet(retained)==recordSet(s.originalRecords),
    s.items.indices().forall(i => s.coverage.contains(s.items[i].repository)),
    s.archived.indices().forall(i => not(s.coverage.contains(s.archived[i].repository))),
    s.phase=="extended" implies all {s.active.subseteq(s.prRows.keys()),
      not(s.hasIssues) or all {s.coverage==s.active, validRetained}},
    s.phase=="refused" implies all {not(s.inputValid), s.calls==0, s.zero==Set(),
      s.coverage.forall(repo => s.counts.get(repo)>=0),
      s.prRows==s.collected.mapBy(repo => originalRow(repo))} }

  // Original PR-census scenarios remain; collected and zero distinguish retained
  // rows from zero rows appended by this helper, including after later retirement.
  run newProjectAddedWithZeroTest = initialize(Set("a","b"),Set("a")).then(extend)
    .expect(s.zero==Set("b") and s.collected==Set("a") and invariant)
  run coveredCensusUnchangedTest = initialize(Set("a"),Set("a","c")).then(extend)
    .expect(s.zero==Set() and s.collected==Set("a","c") and invariant)
  run extendOnceTest = initialize(Set("a","b"),Set()).then(extend).then(extend.fail())
  run retirementArchivesExactHistoryTest =
    initializeHistory(Set("b"),Set("a","b"),Set("a","b"),List(A,U,B),false)
    .then(extend).expect(s.items==List(B) and s.archived==List(A,U)
      and s.coverage==Set("b") and s.counts.get("b")==1 and invariant)
  run reactivationRestoresAvailableCountTest =
    initializeHistory(Set("b"),Set("a","b"),Set("a","b"),List(A,U,B),false)
    .then(extend).then(retarget(Set("a","b","c"))).then(extend)
    .expect(s.archived==List() and recordSet(s.items)==Set(A,U,B)
      and s.counts.get("a")==1 and s.counts.get("b")==1 and s.counts.get("c")==0
      and s.zero==Set("c") and invariant)
  run archivedIssueCanPrecedePrCoverageTest =
    initializeHistory(Set("a","b","c"),Set("b"),Set("b"),List(A,U,B),false)
    .then(extend).expect(s.zero==Set("a","c") and s.prRows.get("a").count==0
      and s.counts.get("a")==1 and s.counts.get("c")==0 and invariant)
  run unavailableIssueDoesNotIncreaseCountTest =
    initializeHistory(Set("a"),Set("b"),Set(),List(U),false)
    .then(extend).expect(s.items==List(U) and s.counts.get("a")==0 and invariant)
  run existingIssueCoverageKeepsExactCountsTest =
    initializeHistory(Set("a"),Set("a"),Set("a"),List(A,U),false)
    .then(extend).expect(s.counts==Map("a"->1) and invariant)
  run emptyActiveInventoryArchivesAllTest =
    initializeHistory(Set(),Set("a","b"),Set("a","b"),List(A,U,B),false)
    .then(extend).expect(s.items==List() and s.archived==List(A,U,B)
      and s.coverage==Set() and s.counts==Map() and invariant)
  run simultaneousRetirementAndActivationTest =
    initializeHistory(Set("b","c"),Set("a","b"),Set("a"),List(A,U,B),false)
    .then(extend).expect(s.items==List(B) and s.archived==List(A,U)
      and s.prRows.get("a")==originalRow("a") and s.zero==Set("c")
      and s.counts.get("b")==1 and s.counts.get("c")==0 and invariant)
  run repeatProjectionIsIdempotentTest =
    initializeHistory(Set("b","c"),Set("a","b"),Set("a"),List(A,U,B),false)
    .then(extend).then(retarget(Set("b","c"))).then(extend)
    .expect(s.items==List(B) and s.archived==List(A,U) and s.zero==Set("c")
      and s.counts==Map("b"->1,"c"->0) and invariant)
  run zeroPrRowsSurviveLaterRetirementTest = initialize(Set("a","c"),Set("a"))
    .then(extend).then(retarget(Set("a"))).then(extend)
    .expect(s.zero==Set("c") and s.prRows.get("c")=={count:0,excluded:0} and invariant)
  run corruptRetiredCountRefusesBeforeProjectionTest =
    initializeHistory(Set("b"),Set("a","b"),Set("a"),List(A),true)
    .then(extend).expect(s.phase=="refused" and s.items==List(A)
      and s.archived==List() and s.counts.get("a")==2 and invariant)
  run duplicateArchivedIdsRefuseBeforeProjectionTest =
    initializeHistory(Set("b"),Set("a","b"),Set("b"),List(A,A),false)
    .then(extend).expect(s.phase=="refused" and s.items==List()
      and s.archived==List(A,A) and invariant)
}
