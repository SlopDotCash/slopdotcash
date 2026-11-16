// @source scripts/escrow-acceptance.ts
// @source scripts/escrow-acceptance/shared.ts
// @source scripts/escrow-acceptance/evm.ts
// @source scripts/escrow-acceptance/evm-extended.ts
// @source scripts/escrow-acceptance/local.ts
// @source contracts/solana/scripts/acceptance.ts
// @source contracts/solana/scripts/acceptance-extended.ts
// @source scripts/payment-keeper/store.ts
// Run/journal control only. Specific escrow scenarios refine the money models.
// One keyed send; two retries; one mined transaction. Waiting is resumable and
// cannot produce a pass without canonical finalized evidence.
module acceptance_run {
  var s: { phase: str, testNetwork: bool, sameSource: bool, sameRoles: bool,
    journaled: bool, sent: bool, mined: bool, final: bool, canonical: bool,
    assertions: bool, executionComplete: bool, signCount: int, retries: int, local: bool }
  action init = s'={ phase:"new", testNetwork:false, sameSource:false,
    sameRoles:false, journaled:false, sent:false, mined:false, final:false,
    canonical:false, assertions:false, executionComplete:false, signCount:0, retries:0, local:false }
  action inspect(network, source, roles, local) = all { s.phase=="new",
    s'=s.with("phase","inspected").with("testNetwork",network)
      .with("sameSource",source).with("sameRoles",roles).with("local",local) }
  action start = all { s.phase=="inspected", s.testNetwork, s.sameSource, s.sameRoles,
    s'=s.with("phase","running") }
  action signAndJournal = all { s.phase=="running", not(s.journaled),
    s'=s.with("journaled",true).with("signCount",s.signCount+1) }
  action broadcast = all { s.phase=="running", s.journaled,not(s.executionComplete),
    s'=s.with("sent",true) }
  action executionDone = all { s.phase=="running",s.sent,s'=s.with("executionComplete",true) }
  action wait = all { s.phase=="running", s'=s.with("phase","waiting")
    .with("assertions",false).with("final",false).with("canonical",false) }
  action resume = all { Set("waiting","failed").contains(s.phase), s.retries<2,
    s'=s.with("phase","running").with("retries",s.retries+1) }
  action recheckPassed = all { s.phase=="passed",s.retries<2,
    s'=s.with("phase","running").with("retries",s.retries+1)
      .with("assertions",false).with("mined",false).with("canonical",false).with("final",false) }
  action receipt(canonical, final) = all { s.phase=="running", s.sent,
    s'=s.with("mined",true).with("canonical",canonical).with("final",final) }
  action check = all { s.phase=="running", s.mined, s.canonical, s.final,
    s'=s.with("assertions",true).with("executionComplete",true) }
  action pass = all { s.phase=="running", s.assertions, s.canonical, s.final,
    s'=s.with("phase","passed") }
  action markFailed = all { s.phase=="running", s'=s.with("phase","failed")
    .with("assertions",false).with("final",false).with("canonical",false) }
  action step = { nondet a=Set(false,true).oneOf() nondet b=Set(false,true).oneOf()
    nondet c=Set(false,true).oneOf() nondet d=Set(false,true).oneOf()
    any { inspect(a,b,c,d),start,signAndJournal,broadcast,executionDone,wait,resume,recheckPassed,receipt(a,b),check,pass,markFailed,s'=s } }
  val invariant = all {
    s.signCount<=1, s.sent implies s.journaled,
    s.journaled implies (s.testNetwork and s.sameSource and s.sameRoles),
    s.phase=="passed" implies (s.assertions and s.mined and s.final and s.canonical),
  }
  run mainnetRefusedTest = init.then(inspect(false,true,true,false)).then(start.fail())
  run interruptedSendReusesJournalTest = init.then(inspect(true,true,true,true)).then(start)
    .then(signAndJournal).then(broadcast).then(wait).then(resume).then(broadcast)
    .then(receipt(true,true)).then(check).then(pass).expect(s.signCount==1 and s.local and invariant)
  run unfinalizedCannotPassTest = init.then(inspect(true,true,true,false)).then(start)
    .then(signAndJournal).then(broadcast).then(receipt(true,false)).then(check.fail())
  run changedSourceCannotResumeTest = init.then(inspect(true,false,true,false)).then(start.fail())
  run completedExecutionWaitsWithoutResendTest = init.then(inspect(true,true,true,true)).then(start)
    .then(signAndJournal).then(broadcast).then(executionDone).then(wait).then(resume).then(broadcast.fail())
  run passedReceiptRecheckedTest = init.then(inspect(true,true,true,true)).then(start)
    .then(signAndJournal).then(broadcast).then(executionDone).then(receipt(true,true)).then(check).then(pass)
    .then(recheckPassed).then(wait).expect(s.executionComplete and s.phase=="waiting" and s.signCount==1)
}
