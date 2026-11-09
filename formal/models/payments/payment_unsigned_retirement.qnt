// @source workers/payments/index.ts
// @source workers/payment-executor/core.ts
// @source backend/payments/dispatch.ts
// @evidence workers/payments/recovery.integration.ts
// One old unsigned attempt, two concurrent recovery reads and one successor.
// Successful cancellation means the executor journal atomically tombstones
// the old unsigned id; cryptography and signed-attempt rejection are outside
// this response-application model. Database batches are atomic.
module payment_unsigned_retirement {
  var s: {old: str, successor: str, outbox: str, liveLease: bool,
    readA: bool, readB: bool, responseA: bool, responseB: bool,
    appliedA: bool, appliedB: bool, paid: bool}
  action init = s' = {old:"prepared",successor:"none",outbox:"ready",liveLease:false,
    readA:false,readB:false,responseA:false,responseB:false,
    appliedA:false,appliedB:false,paid:false}
  action read(worker: int): bool = all {s.old=="prepared",
    s'=if(worker==1) s.with("readA",true) else s.with("readB",true)}
  action respond(worker: int): bool = all {
    if(worker==1) s.readA else s.readB,
    s'=if(worker==1) s.with("responseA",true) else s.with("responseB",true)}
  action applyRetirement(worker: int): bool = {
    val ready = if(worker==1) s.responseA and not(s.appliedA) else s.responseB and not(s.appliedB)
    // Mirrors SQLite changes() from the immediately preceding attempt update.
    val changed = s.old=="prepared"
    val result = s.with("old","failed")
      .with("outbox",if(changed and not(s.paid) and not(s.liveLease)) "ready" else s.outbox)
    all {ready,s'=if(worker==1) result.with("appliedA",true) else result.with("appliedB",true)}
  }
  action leaseOld = all {s.old=="prepared",s.outbox=="ready",
    s'=s.with("outbox","processing").with("liveLease",true)}
  action prepareSuccessor = all {s.old=="failed",s.successor=="none",s.outbox=="ready",
    s'=s.with("successor","prepared").with("outbox","processing").with("liveLease",true)}
  action submitSuccessor = all {s.successor=="prepared",
    s'=s.with("successor","submitted").with("outbox","submitted").with("liveLease",false)}
  action ambiguousSuccessor = all {s.successor=="prepared",
    s'=s.with("successor","unknown").with("outbox","ready").with("liveLease",false)}
  action holdSuccessor = all {s.successor=="unknown",not(s.paid),
    s'=s.with("outbox","held")}
  action settleSuccessor = all {s.successor=="submitted",
    s'=s.with("paid",true).with("outbox","paid")}
  action step = any {read(1),read(2),respond(1),respond(2),applyRetirement(1),applyRetirement(2),
    leaseOld,prepareSuccessor,submitSuccessor,ambiguousSuccessor,holdSuccessor,settleSuccessor,s'=s}
  val invariant = all {
    s.successor!="none" implies s.old=="failed",
    s.successor=="submitted" implies Set("submitted","held","paid").contains(s.outbox),
    s.successor=="unknown" implies Set("ready","held").contains(s.outbox),
    s.successor=="prepared" implies s.outbox=="processing" and s.liveLease,
    s.paid implies s.outbox=="paid"
  }
  action overlap = read(1).then(read(2)).then(respond(1)).then(respond(2)).then(applyRetirement(2))
  run staleRetirementKeepsSubmittedTest = init.then(overlap).then(prepareSuccessor)
    .then(submitSuccessor).then(applyRetirement(1))
    .expect(s.outbox=="submitted" and s.old=="failed" and s.successor=="submitted")
  run staleRetirementKeepsHeldTest = init.then(overlap).then(prepareSuccessor)
    .then(ambiguousSuccessor).then(holdSuccessor).then(applyRetirement(1))
    .expect(s.outbox=="held" and s.old=="failed" and s.successor=="unknown")
  run staleRetirementKeepsPreparedTest = init.then(overlap).then(prepareSuccessor)
    .then(applyRetirement(1)).expect(s.outbox=="processing" and s.liveLease)
  run retirementKeepsOldLeaseTest = init.then(read(1)).then(respond(1)).then(leaseOld)
    .then(applyRetirement(1)).expect(s.old=="failed" and s.outbox=="processing" and s.liveLease)
  run staleRetirementKeepsPaidTest = init.then(overlap).then(prepareSuccessor)
    .then(submitSuccessor).then(settleSuccessor).then(applyRetirement(1))
    .expect(s.outbox=="paid" and s.paid)
}
