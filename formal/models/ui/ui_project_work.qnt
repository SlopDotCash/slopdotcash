// @source src/ProjectWork.tsx
// @source src/App.tsx
// @evidence tests/e2e/project-work.spec.ts
// Read-only work discovery with ten initial suggestions and explicit expansion.
// Parent useSnapshot owns fetch/identity concurrency. Counts are finite 0..12
// per kind (0..24 total); items retain their canonical snapshot order.
module project_work {
  var phase: str
  var active: bool
  var issueCount: int
  var reviewCount: int
  var old: bool
  var refreshFailed: bool
  var pending: bool
  var expanded: bool
  action init = all {phase'="loading",active'=true,issueCount'=0,reviewCount'=0,
    old'=false,refreshFailed'=false,pending'=true,expanded'=false}
  action keep = all {phase'=phase,active'=active,issueCount'=issueCount,
    reviewCount'=reviewCount,old'=old,refreshFailed'=refreshFailed,pending'=pending,expanded'=expanded}
  action loaded(issues: int, reviews: int): bool = all {pending,
    issues.in(0.to(12)),reviews.in(0.to(12)),phase'="ready",active'=active,
    issueCount'=issues,reviewCount'=reviews,old'=false,refreshFailed'=false,pending'=false,expanded'=expanded}
  action failed = all {pending,phase'=if(phase=="ready") "ready" else "error",
    active'=active,issueCount'=issueCount,reviewCount'=reviewCount,old'=old,
    refreshFailed'=phase=="ready",pending'=false,expanded'=expanded}
  action retry = all {not(pending),phase'=if(phase=="ready") "ready" else "loading",
    active'=active,issueCount'=issueCount,reviewCount'=reviewCount,old'=old,
    refreshFailed'=refreshFailed,pending'=true,expanded'=expanded}
  action pause = all {phase'=phase,active'=false,issueCount'=issueCount,
    reviewCount'=reviewCount,old'=old,refreshFailed'=refreshFailed,pending'=pending,expanded'=expanded}
  action resume = all {phase'=phase,active'=true,issueCount'=issueCount,
    reviewCount'=reviewCount,old'=old,refreshFailed'=refreshFailed,pending'=pending,expanded'=expanded}
  action age = all {phase'=phase,active'=active,issueCount'=issueCount,
    reviewCount'=reviewCount,old'=true,refreshFailed'=refreshFailed,pending'=pending,expanded'=expanded}
  val total = issueCount + reviewCount
  val eligible = active and phase=="ready"
  val shown = if (eligible) (if (expanded or total <= 10) total else 10) else 0
  val expandShown = eligible and not(expanded) and total > 10
  action expand = all {expandShown,phase'=phase,active'=active,
    issueCount'=issueCount,reviewCount'=reviewCount,old'=old,
    refreshFailed'=refreshFailed,pending'=pending,expanded'=true}
  // Expansion changes visibility only. Every eligible item remains reachable.
  val reachable = if (eligible) total else 0
  val emptyShown = active and phase=="ready" and issueCount==0 and reviewCount==0
  val loadingShown = active and phase=="loading"
  val errorShown = active and phase=="error"
  val dated = active and phase=="ready"
  val staleShown = dated and (old or refreshFailed)
  val invariant = all {
    eligible implies reachable == total,
    eligible and not(expanded) implies shown <= 10,
    eligible and expanded implies shown == total,
    expandShown implies shown == 10 and reachable > shown,
    not(active) implies shown==0,
    emptyShown implies not(loadingShown or errorShown),
    errorShown implies not(emptyShown),
    refreshFailed implies phase=="ready",
    shown>0 implies dated,
    refreshFailed and active implies staleShown}
  action step = {
    nondet issues = 0.to(12).oneOf()
    nondet reviews = 0.to(12).oneOf()
    any {loaded(issues,reviews),failed,retry,pause,resume,age,expand,keep}
  }
  run loadTest = init.then(loaded(4,4)).expect(shown==8 and dated)
  run emptyTest = init.then(loaded(0,0)).expect(emptyShown and not(errorShown))
  run failureTest = init.then(failed).expect(errorShown and not(emptyShown))
  run retryTest = init.then(failed).then(retry).then(loaded(1,1)).expect(shown==2)
  run retainedTest = init.then(loaded(1,1)).then(retry).then(failed)
    .expect(shown==2 and staleShown)
  run pausedTest = init.then(loaded(2,2)).then(pause).expect(shown==0)
  run collapsedTest = init.then(loaded(12,1)).expect(shown==10 and expandShown and reachable==13)
  run expansionTest = init.then(loaded(12,1)).then(expand).expect(shown==13 and not(expandShown))
  run expandedRefreshTest = init.then(loaded(12,1)).then(expand).then(retry).then(failed)
    .expect(shown==13 and staleShown and not(expandShown))
}
