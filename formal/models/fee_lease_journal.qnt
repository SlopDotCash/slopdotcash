// @source workers/fee-converter/core.ts
// @source workers/fee-converter/store.ts
// @source workers/fee-converter/native-gas.ts
// @source workers/fee-converter/evm.ts
// @source workers/fee-converter/solana.ts
// @source migrations/0092_fee_native_gas.sql
// @evidence workers/fee-converter/native-gas.test.ts
// Composition of lease, gas-revision CAS, signed journal, network send and
// finalized cost. Two runs, one nonce with original/replacement, ticks 0..3
// (midnight at 2), maxima 2/3 and actual cost 1 within daily budget 4.
// Cryptographic receipt/intent verification is an external predicate here.
module fee_lease_journal {
  var s: {tick:int,lease:int,until:int,revision:int,readA:int,readB:int,
    original:str,replacement:str,originalOwner:int,replacementOwner:int,
    signedRaw:Set[int],broadcast:Set[int],receipt:int,settled:bool,
    spent:int,settledDay:int,businessFailed:bool}
  action init = s'={tick:0,lease:0,until:0,revision:0,readA:-1,readB:-1,
    original:"none",replacement:"none",originalOwner:0,replacementOwner:0,
    signedRaw:Set(),broadcast:Set(),receipt:0,settled:false,
    spent:0,settledDay:-1,businessFailed:false}
  def owns(runId) = s.lease==runId and s.tick<=s.until
  val day = if(s.tick<2) 0 else 1
  val held = if(s.settled) 0 else
    if(Set("reserved","signed").contains(s.replacement)) 3 else
    if(Set("reserved","signed").contains(s.original)) 2 else 0
  action acquire(runId) = all {s.lease==0 or s.until<s.tick,
    s'=s.with("lease",runId).with("until",if(s.tick<2) 1 else 3)}
  action release(runId) = all {owns(runId),s'=s.with("lease",0)}
  action tick = all {s.tick<3,s'=s.with("tick",s.tick+1)}
  action readBudget(runId) = s'=if(runId==1) s.with("readA",s.revision) else s.with("readB",s.revision)
  def revisionMatches(runId) = (if(runId==1) s.readA else s.readB)==s.revision
  action reserveOriginal(runId) = all {owns(runId),revisionMatches(runId),s.original=="none",
    s'=s.with("original","reserved").with("originalOwner",runId).with("revision",s.revision+1)}
  action reserveReplacement(runId) = all {owns(runId),revisionMatches(runId),s.original=="signed",
    s.replacement=="none",not(s.settled),
    s'=s.with("replacement","reserved").with("replacementOwner",runId).with("revision",s.revision+1)}
  action signOriginal(runId) = all {owns(runId),s.original=="reserved",s.originalOwner==runId,
    s'=s.with("signedRaw",s.signedRaw.union(Set(1)))}
  action signReplacement(runId) = all {owns(runId),s.replacement=="reserved",s.replacementOwner==runId,
    s'=s.with("signedRaw",s.signedRaw.union(Set(2)))}
  action journalOriginal(runId) = all {owns(runId),s.original=="reserved",s.originalOwner==runId,
    s.signedRaw.contains(1),s'=s.with("original","signed").with("revision",s.revision+1)}
  action journalReplacement(runId) = all {owns(runId),s.replacement=="reserved",s.replacementOwner==runId,
    s.signedRaw.contains(2),s'=s.with("replacement","signed").with("revision",s.revision+1)}
  action recoverUnsigned(runId) = all {owns(runId),
    (s.original=="reserved" and s.originalOwner!=runId) or
    (s.replacement=="reserved" and s.replacementOwner!=runId),
    s'=s.with("original",if(s.original=="reserved" and s.originalOwner!=runId) "abandoned" else s.original)
      .with("replacement",if(s.replacement=="reserved" and s.replacementOwner!=runId) "abandoned" else s.replacement)
      .with("revision",s.revision+1)}
  action send(runId,attemptId) = all {owns(runId),not(s.settled),
    (attemptId==1 and s.original=="signed") or (attemptId==2 and s.replacement=="signed"),
    s'=s.with("broadcast",s.broadcast.union(Set(attemptId)))}
  action observeFinal(attemptId,canonical) = all {canonical,s.receipt==0,s.broadcast.contains(attemptId),
    s'=s.with("receipt",attemptId)}
  action settle(runId) = all {owns(runId),s.receipt>0,not(s.settled),
    s'=s.with("settled",true).with("spent",1).with("settledDay",day).with("revision",s.revision+1)}
  action businessFailure = all {s.original=="signed",s'=s.with("businessFailed",true)}
  action step = {nondet runId=Set(1,2).oneOf() nondet attemptId=Set(1,2).oneOf()
    nondet canonical=Set(false,true).oneOf()
    any {acquire(runId),release(runId),tick,readBudget(runId),reserveOriginal(runId),reserveReplacement(runId),
      signOriginal(runId),signReplacement(runId),journalOriginal(runId),journalReplacement(runId),
      recoverUnsigned(runId),send(runId,attemptId),observeFinal(attemptId,canonical),settle(runId),businessFailure,s'=s}}
  val invariant = all {held+s.spent<=4,s.revision<=5,
    s.broadcast.contains(1) implies s.original=="signed",
    s.broadcast.contains(2) implies s.replacement=="signed",
    s.settled implies (held==0 and s.receipt>0 and s.spent==1 and s.settledDay>=0)}
  run staleBudgetSnapshotRefusedTest = init.then(acquire(1)).then(readBudget(2)).then(readBudget(1))
    .then(reserveOriginal(1)).then(signOriginal(1)).then(journalOriginal(1))
    .then(tick).then(tick).then(acquire(2)).then(reserveReplacement(2).fail())
  run signedButUnjournaledCannotEscapeTakeoverTest = init.then(acquire(1)).then(readBudget(1))
    .then(reserveOriginal(1)).then(signOriginal(1)).then(tick).then(tick).then(acquire(2))
    .then(recoverUnsigned(2)).expect(s.original=="abandoned" and held==0).then(send(1,1).fail())
  run durableSendSurvivesLeaseAndMidnightTest = init.then(acquire(1)).then(readBudget(1))
    .then(reserveOriginal(1)).then(signOriginal(1)).then(journalOriginal(1)).then(tick).then(tick)
    .then(acquire(2)).then(send(2,1)).expect(held==2 and s.original=="signed" and invariant)
  run staleSettlementCannotOverwriteSuccessorTest = init.then(acquire(1)).then(readBudget(1))
    .then(reserveOriginal(1)).then(signOriginal(1)).then(journalOriginal(1)).then(send(1,1))
    .then(observeFinal(1,true)).then(tick).then(tick).then(acquire(2)).then(settle(2))
    .expect(s.settledDay==1 and invariant).then(settle(1).fail())
  run sameNonceReplacementUsesLargestLiabilityTest = init.then(acquire(1)).then(readBudget(1))
    .then(reserveOriginal(1)).then(signOriginal(1)).then(journalOriginal(1)).then(send(1,1))
    .then(readBudget(1)).then(reserveReplacement(1)).then(signReplacement(1)).then(journalReplacement(1))
    .then(send(1,2)).expect(held==3).then(observeFinal(1,true)).then(settle(1))
    .expect(held==0 and s.spent==1 and s.receipt==1 and invariant)
  run replacementWinnerAfterLeaseAndMidnightTest = init.then(acquire(1)).then(readBudget(1))
    .then(reserveOriginal(1)).then(signOriginal(1)).then(journalOriginal(1)).then(send(1,1))
    .then(readBudget(1)).then(reserveReplacement(1)).then(signReplacement(1)).then(journalReplacement(1))
    .then(send(1,2)).then(tick).then(tick).then(acquire(2)).then(observeFinal(1,true)).then(settle(2))
    .expect(s.settled and s.receipt==1 and s.settledDay==1 and held==0 and invariant)
  run businessTerminalDoesNotReleaseNativeLiabilityTest = init.then(acquire(1)).then(readBudget(1))
    .then(reserveOriginal(1)).then(signOriginal(1)).then(journalOriginal(1)).then(businessFailure)
    .expect(s.businessFailed and held==2 and invariant)
  run noncanonicalReceiptCannotReleaseTest = init.then(acquire(1)).then(readBudget(1))
    .then(reserveOriginal(1)).then(signOriginal(1)).then(journalOriginal(1)).then(send(1,1))
    .then(observeFinal(1,false).fail())
}
