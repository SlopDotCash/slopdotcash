// @source workers/referral-accrual/chain-logs.ts
// @source workers/payments/scanner.ts
// @source scripts/check-referral-roots.ts
// Inclusive pages advance only after successful reads; failure cannot publish a complete range.
module chain_range_scan {
  type S={next:int,seen:Set[int],failed:bool,published:bool}
  var s:S
  action init=s'={next:0,seen:Set(),failed:false,published:false}
  action page=all{s.next<=5,not(s.failed),
    val end=if(s.next+1<5) s.next+1 else 5
    s'=s.with("seen",s.seen.union(s.next.to(end))).with("next",end+1)}
  action failRead=all{s.next<=5,s'=s.with("failed",true)}
  action retry=s'=s.with("failed",false)
  action publish=all{s.next==6,not(s.failed),s'=s.with("published",true)}
  action step=any{page,failRead,retry,publish,s'=s}
  val invariant=all{s.seen.size()==s.next,s.published implies s.seen==0.to(5)}
  run completePagesTest=init.then(page).then(page).then(page).then(publish).expect(invariant)
  run retryDoesNotSkipTest=init.then(page).then(failRead).then(retry).then(page).then(page).then(publish).expect(invariant)
  run incompleteRefusedTest=init.then(page).then(failRead).then(publish.fail())
}
