// @source src/lib/security-bounty.mjs
// Public term revisions never remove a program or rewrite frozen private awards.
module bounty_terms {
  type S={exists:bool,status:str,afterApproval:bool,funded:bool,frozenAward:int}
  var s:S
  action init=s'={exists:true,status:"draft",afterApproval:true,funded:false,frozenAward:3}
  action change(status:str,afterApproval:bool,funded:bool):bool=all{
    Set("draft","pending-approval","open","paused","closed").contains(status),
    status!="open" or afterApproval or funded,
    s'=s.with("status",status).with("afterApproval",afterApproval).with("funded",funded)}
  action remove=all{not(s.exists),s'=s}
  action choices={nondet status=Set("draft","pending-approval","open","paused","closed").oneOf()
    nondet after=Set(true,false).oneOf() nondet funded=Set(true,false).oneOf() change(status,after,funded)}
  action step=any{choices,s'=s}
  val invariant=all{s.exists,s.frozenAward==3,s.status=="open" implies(s.afterApproval or s.funded)}
  run afterApprovalPledgeOpenTest=init.then(change("open",true,false)).expect(invariant)
  run prefundedNeedsFundsTest=init.then(change("open",false,false).fail())
  run closureKeepsAwardTest=init.then(change("closed",true,false)).expect(s.frozenAward==3 and invariant)
  run removalRefusedTest=init.then(remove.fail())
}
