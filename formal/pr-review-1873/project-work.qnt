// Read-only work discovery. Parent useSnapshot owns fetch/identity concurrency.
module project_work {
  var phase: str
  var active: bool
  var issueCount: int
  var reviewCount: int
  var old: bool
  var refreshFailed: bool
  var pending: bool
  action init = all {phase'="loading",active'=true,issueCount'=0,reviewCount'=0,
    old'=false,refreshFailed'=false,pending'=true}
  action keep = all {phase'=phase,active'=active,issueCount'=issueCount,
    reviewCount'=reviewCount,old'=old,refreshFailed'=refreshFailed,pending'=pending}
  action loaded(issues: int, reviews: int): bool = all {pending,
    issues.in(0.to(4)),reviews.in(0.to(4)),phase'="ready",active'=active,
    issueCount'=issues,reviewCount'=reviews,old'=false,refreshFailed'=false,pending'=false}
  action failed = all {pending,phase'=if(phase=="ready") "ready" else "error",
    active'=active,issueCount'=issueCount,reviewCount'=reviewCount,old'=old,
    refreshFailed'=phase=="ready",pending'=false}
  action retry = all {not(pending),phase'=if(phase=="ready") "ready" else "loading",
    active'=active,issueCount'=issueCount,reviewCount'=reviewCount,old'=old,
    refreshFailed'=refreshFailed,pending'=true}
  action pause = all {phase'=phase,active'=false,issueCount'=issueCount,
    reviewCount'=reviewCount,old'=old,refreshFailed'=refreshFailed,pending'=pending}
  action resume = all {phase'=phase,active'=true,issueCount'=issueCount,
    reviewCount'=reviewCount,old'=old,refreshFailed'=refreshFailed,pending'=pending}
  action age = all {phase'=phase,active'=active,issueCount'=issueCount,
    reviewCount'=reviewCount,old'=true,refreshFailed'=refreshFailed,pending'=pending}
  val issuesShown = if(active and phase=="ready") (if(issueCount<3) issueCount else 3) else 0
  val reviewsShown = if(active and phase=="ready") (if(reviewCount<3) reviewCount else 3) else 0
  val emptyShown = active and phase=="ready" and issueCount==0 and reviewCount==0
  val loadingShown = active and phase=="loading"
  val errorShown = active and phase=="error"
  val dated = active and phase=="ready"
  val staleShown = dated and (old or refreshFailed)
  val invariant = all {
    issuesShown<=3,reviewsShown<=3,
    not(active) implies issuesShown+reviewsShown==0,
    emptyShown implies not(loadingShown or errorShown),
    errorShown implies not(emptyShown),
    refreshFailed implies phase=="ready",
    issuesShown+reviewsShown>0 implies dated,
    refreshFailed and active implies staleShown}
  action step = {
    nondet issues = 0.to(4).oneOf()
    nondet reviews = 0.to(4).oneOf()
    any {loaded(issues,reviews),failed,retry,pause,resume,age,keep}
  }
  run loadTest = init.then(loaded(4,4)).expect(issuesShown==3 and reviewsShown==3 and dated)
  run emptyTest = init.then(loaded(0,0)).expect(emptyShown and not(errorShown))
  run failureTest = init.then(failed).expect(errorShown and not(emptyShown))
  run retryTest = init.then(failed).then(retry).then(loaded(1,1)).expect(issuesShown==1 and reviewsShown==1)
  run retainedTest = init.then(loaded(1,1)).then(retry).then(failed)
    .expect(issuesShown==1 and reviewsShown==1 and staleShown)
  run pausedTest = init.then(loaded(2,2)).then(pause).expect(issuesShown+reviewsShown==0)
}
