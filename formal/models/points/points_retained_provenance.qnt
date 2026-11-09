// @source scripts/generate-points.ts
// @source src/lib/points.ts
// One retained evaluator award: original amount 2, explicit partial amount 1.
// Historical retirement eligibility is fixed by validated timestamp/digest/rule
// facts; incident represents their exact conjunction, otherZero a mismatch.
// Project remains registered; removal/re-addition is outside this model.
// At most six immutable revisions. Database prefix enforcement is tested by
// points-import.test.ts and modeled separately; this models batch provenance.
module points_retained_provenance {
  type Revision = {amount: int, origin: str}
  type State = {amount: int, origin: str, eligible: bool, adopted: bool,
    history: List[Revision]}
  var s: State
  pure def recordRevision(state: State, amount: int, origin: str, eligible: bool): State =
    state.with("amount",amount).with("origin",origin).with("eligible",eligible)
      .with("adopted",state.adopted or origin=="batch")
      .with("history",state.history.append({amount:amount,origin:origin}))
  action init = s' = {amount:0,origin:"none",eligible:false,adopted:false,
    history:List()}
  action seedHistoric = all {s.history.length()==0,
    s'=recordRevision(s,2,"historic",true)}
  action seedSnapshot = all {s.history.length()==0,
    s'=recordRevision(s,2,"snapshot",false)}
  action incident = all {s.origin=="historic",s.history.length()<6,
    s'=recordRevision(s,0,"incident",true)}
  action otherZero = all {s.origin=="historic",s.history.length()<6,
    s'=recordRevision(s,0,"batch",false)}
  pure def batch(state: State, supplied: bool, amount: int): State =
    if(supplied and (state.amount!=amount or state.eligible or
      (state.origin=="snapshot" and amount>0)))
      recordRevision(state,amount,"batch",false)
    else if(not(supplied) and state.eligible and state.amount!=2)
      recordRevision(state,2,"recovery",true)
    else if(not(supplied) and not(state.eligible) and
      state.origin=="batch" and state.amount>0)
      recordRevision(state,0,"batch",false)
    else state
  action applyBatch(supplied: bool, amount: int): bool = all {
    s.history.length()>0,s.history.length()<6,Set(0,1,2).contains(amount),
    s'=batch(s,supplied,amount)}
  action step = {
    nondet supplied=Set(false,true).oneOf()
    nondet amount=Set(0,1,2).oneOf()
    any {seedHistoric,seedSnapshot,incident,otherZero,
      applyBatch(supplied,amount),s'=s}
  }
  val invariant = all {
    s.history.length()<=6,Set(0,1,2).contains(s.amount),
    s.eligible implies not(s.adopted) and Set("historic","incident","recovery").contains(s.origin),
    s.origin=="incident" implies s.amount==0,
    s.origin=="recovery" implies s.amount==2,
    if(s.history.length()==0) s.origin=="none" else
      s.history.head().amount==2 and s.history.nth(s.history.length()-1)=={amount:s.amount,origin:s.origin}
  }
  run historicalOmittedTest = init.then(seedHistoric).then(applyBatch(false,0))
    .expect(s.amount==2 and s.eligible and s.history.length()==1)
  run recoverIncidentTest = init.then(seedHistoric).then(incident).then(applyBatch(false,0))
    .expect(s.amount==2 and s.eligible and s.history.length()==3)
  run recoveryReplayTest = init.then(seedHistoric).then(incident).then(applyBatch(false,0))
    .then(applyBatch(false,0)).expect(s.amount==2 and s.history.length()==3)
  run sameAmountAdoptionThenRevocationTest = init.then(seedHistoric).then(incident)
    .then(applyBatch(false,0)).then(applyBatch(true,2)).then(applyBatch(false,0))
    .expect(s.amount==0 and not(s.eligible) and s.history.length()==5)
  run explicitZeroEndsRecoveryTest = init.then(seedHistoric).then(incident)
    .then(applyBatch(true,0)).then(applyBatch(false,0))
    .expect(s.amount==0 and not(s.eligible) and s.history.length()==3)
  run unrelatedZeroNeverRecoveredTest = init.then(seedHistoric).then(otherZero)
    .then(applyBatch(false,0)).expect(s.amount==0 and not(s.eligible) and s.history.length()==2)
  run snapshotAdoptionThenRevocationTest = init.then(seedSnapshot)
    .then(applyBatch(true,2)).then(applyBatch(false,0))
    .expect(s.amount==0 and not(s.eligible) and s.history.length()==3)
  run adoptedReplayTest = init.then(seedHistoric).then(applyBatch(true,2))
    .then(applyBatch(true,2)).expect(s.amount==2 and not(s.eligible) and s.history.length()==2)
}
