// @source src/CyclePages.tsx
// @source src/Presentation.tsx
// @source src/PrivateReportSummary.tsx
// @source src/SecurityBounty.tsx
// @source src/lib/use-time-boundary.ts
// The local clock changes advice, never the persisted review or remote-send state.
module ui_record_deadlines {
  var s: {expired:bool,reviewRendered:bool,retryRendered:bool,cycle:str,submission:str}
  action init = s'={expired:false,reviewRendered:false,retryRendered:false,cycle:"review",submission:"uncertain"}
  action passDeadlines = s'=s.with("expired",true)
  action renderReview = all {s.expired,s'=s.with("reviewRendered",true)}
  action renderRetry = all {s.expired,s'=s.with("retryRendered",true)}
  action step = any {passDeadlines,renderReview,renderRetry,s'=s}
  val cycleLabel = if(s.reviewRendered) "awaiting-approval" else "under-review"
  val retryLabel = if(s.retryRendered) "check-again" else "check-after-deadline"
  val invariant = all {s.cycle=="review",s.submission=="uncertain",
    s.reviewRendered implies s.expired,s.retryRendered implies s.expired}
  temporal deadlineAdviceEventuallyCurrentProperty = all {
    renderReview.weakFair(s), renderRetry.weakFair(s)
  }.implies(always(s.expired implies eventually(s.reviewRendered and s.retryRendered)))
  run reviewDoesNotApproveTest = init.then(passDeadlines).then(renderReview).expect(cycleLabel=="awaiting-approval" and s.cycle=="review")
  run retryDoesNotConfirmTest = init.then(passDeadlines).then(renderRetry).expect(retryLabel=="check-again" and s.submission=="uncertain")
}
