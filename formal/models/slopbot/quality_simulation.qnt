// @source scripts/simulate-contribution-quality.ts
// Recompute from the exact source, not imported proposed amounts. This artifact
// never authorizes payment even when every reviewed input is valid.
// Partial orchestration model: quality decision arithmetic and burdens are
// validated/recomputed input predicates, not encoded algorithms here.
module quality_simulation {
  var s: {phase:str,source:bool,cap:bool,events:bool,decisions:bool,
    recomputed:bool,exported:bool,paymentAuthorized:bool}
  action init = s'={phase:"new",source:false,cap:false,events:false,decisions:false,
    recomputed:false,exported:false,paymentAuthorized:false}
  action validate(source,cap,events,decisions) = all {s.phase=="new",source,cap,events,decisions,
    s'=s.with("phase","valid").with("source",source).with("cap",cap)
      .with("events",events).with("decisions",decisions)}
  action recompute = all {s.phase=="valid",s'=s.with("phase","computed").with("recomputed",true)}
  action writeProposal = all {s.phase=="computed",s'=s.with("phase","exported").with("exported",true)}
  action computationFails = all {s.phase=="valid",s'=s.with("phase","failed")}
  action writeFails = all {s.phase=="computed",s'=s.with("phase","failed")}
  action step = {nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet c=Set(false,true).oneOf() nondet d=Set(false,true).oneOf()
    any {validate(a,b,c,d),recompute,writeProposal,computationFails,writeFails,s'=s}}
  val invariant = all {not(s.paymentAuthorized),s.exported implies(s.recomputed and s.source and s.cap and s.events and s.decisions)}
  run failedComputationHasNoExportTest = init.then(validate(true,true,true,true)).then(computationFails).expect(not(s.exported) and not(s.paymentAuthorized))
  run failedWriteIsNotPublishedTest = init.then(validate(true,true,true,true)).then(recompute).then(writeFails).expect(not(s.exported))
  run wrongSourceRejectedTest = init.then(validate(false,true,true,true).fail())
  run incompleteEvidenceRejectedTest = init.then(validate(true,true,false,true).fail())
  run proposalIsNotPaymentAuthorityTest = init.then(validate(true,true,true,true)).then(recompute).then(writeProposal)
    .expect(s.exported and not(s.paymentAuthorized) and invariant)
}
