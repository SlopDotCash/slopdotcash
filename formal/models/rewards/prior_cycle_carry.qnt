// @source scripts/prior-cycle-accrual.ts
// Historical monthly proposals only. Approved payouts stay with their original
// cycle. Shared-pool unpaid/lapsed/unsafe amounts carry; review budget does not.
module prior_cycle_carry {
  type S = { monetary: bool, approvedAsOf: bool, reviewEnded: bool, unresolved: bool,
    row: str, classified: bool, blocked: bool, carry: int, safetyHistory: bool }
  var s: S
  action init = s'={monetary:false,approvedAsOf:false,reviewEnded:false,unresolved:false,row:"proposed",classified:false,blocked:false,carry:0,safetyHistory:true}
  action inspect(monetary: bool, approved: bool, ended: bool, unresolved: bool, row: str): bool = all { not(s.classified),
    s'=s.with("monetary",monetary).with("approvedAsOf",approved).with("reviewEnded",ended).with("unresolved",unresolved).with("row",row) }
  action classify = all { not(s.classified),
    val blocked=s.monetary and not(s.approvedAsOf) and(not(s.reviewEnded) or s.unresolved)
    val eligible=Set("unclaimed","below-minimum","review-lapsed","unsafe").contains(s.row)
    s'=s.with("classified",true).with("blocked",blocked).with("carry",if(s.monetary and not(blocked) and eligible) 2 else 0) }
  action step = { nondet monetary=Set(true,false).oneOf() nondet approved=Set(true,false).oneOf()
    nondet ended=Set(true,false).oneOf() nondet unresolved=Set(true,false).oneOf()
    nondet row=Set("proposed","approved","unclaimed","below-minimum","review-lapsed","unsafe","excluded","manual-hold").oneOf()
    any { inspect(monetary,approved,ended,unresolved,row),classify,s'=s } }
  val invariant = all { s.safetyHistory,not(s.monetary) implies s.carry==0,s.blocked implies s.carry==0,
    s.row=="approved" implies s.carry==0 }
  run lateApprovalNotAsOfTest = init.then(inspect(true,false,false,false,"unclaimed")).then(classify).expect(s.blocked)
  run lapsePreservesSharedPoolTest = init.then(inspect(true,false,true,false,"review-lapsed")).then(classify).expect(s.carry==2 and invariant)
  run noSyntheticTrialMoneyTest = init.then(inspect(false,true,true,false,"unclaimed")).then(classify).expect(s.carry==0 and invariant)
  run approvedStaysOriginalCycleTest = init.then(inspect(true,true,true,false,"approved")).then(classify).expect(s.carry==0 and invariant)
}
