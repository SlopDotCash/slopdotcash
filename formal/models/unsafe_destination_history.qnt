// @source scripts/unsafe-destination-hold.ts
// @source scripts/check-unsafe-destination-transitions.ts
// @source scripts/prior-cycle-accrual.ts
// Archived cycle protocol: signed source-bound report holds the original wallet
// and principal, clears approval, and survives every later cycle independently
// of unpaid carry. Trusted-base checking refuses deletion or modified history.
module unsafe_destination_history {
  type S = { reviewOpen: bool, signature: bool, reportBound: bool, reports: List[int],
    held: bool, approved: int, wallet: int, amount: int, materialRevision: int }
  var s: S
  action init = s' = { reviewOpen:true,signature:false,reportBound:false,reports:List(),held:false,approved:2,wallet:1,amount:2,materialRevision:0 }
  action verify(signature: bool, bound: bool): bool = s'=s.with("signature",signature).with("reportBound",bound)
  action hold = all { s.reviewOpen,s.signature,s.reportBound,not(s.held),
    s'=s.with("held",true).with("approved",0).with("reports",List(1)) }
  action closeReview = s'=s.with("reviewOpen",false)
  action carry(reports: List[int], wallet: int, amount: int): bool = all { s.held,reports==s.reports,wallet==s.wallet,amount==s.amount,s'=s }
  action step = any { verify(true,true),verify(false,true),verify(true,false),hold,closeReview,carry(List(1),1,2),s'=s }
  val invariant = s.held implies s.approved==0 and s.wallet==1 and s.amount==2 and s.reports==List(1)
  run signedHoldClearsApprovalTest = init.then(verify(true,true)).then(hold).expect(invariant)
  run reportAloneCannotHoldTest = init.then(verify(false,true)).then(hold.fail())
  run preservedAfterReviewTest = init.then(verify(true,true)).then(hold).then(closeReview).then(carry(List(1),1,2)).expect(invariant)
  run substitutedWalletRefusedTest = init.then(verify(true,true)).then(hold).then(carry(List(1),2,2).fail())
  run erasedHistoryRefusedTest = init.then(verify(true,true)).then(hold).then(carry(List(),1,2).fail())
}
