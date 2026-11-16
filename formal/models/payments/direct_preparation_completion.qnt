// @source backend/security/direct-payments.ts
// @source backend/security/handler.ts
// @source backend/payments/wallet-registration.ts
// @source migrations/0100_effective_payment_wallets.sql
// @source migrations/0108_private_direct_payments.sql
// One initial payment preparation; two authorized payer and reporter claims.
// RPC proof/plan correctness and D1 atomicity remain external assumptions.
// Source-only revision; these scenarios have not been run.
module direct_preparation_completion {
  var s: {phase:str,reporter:int,payer:int,consents:Set[int],revision:int,
    seenReporter:int,seenPayer:int,seenRevision:int,storedReporter:int,
    storedPayer:int,reporterAtCommit:int,payerAtCommit:int,receipt:bool}
  action init = s'={phase:"idle",reporter:1,payer:1,consents:Set(1),revision:1,
    seenReporter:0,seenPayer:0,seenRevision:0,storedReporter:0,
    storedPayer:0,reporterAtCommit:0,payerAtCommit:0,receipt:false}
  action rotateReporter = all {s.reporter==1,s'=s.with("reporter",2)}
  action rotatePayer = all {s.payer==1,s'=s.with("payer",2)}
  action consent = s'=s.with("consents",s.consents.union(Set(s.reporter)))
  action begin = all {s.phase=="idle",s.consents.contains(s.reporter),
    s'=s.with("phase","planning").with("seenReporter",s.reporter)
      .with("seenPayer",s.payer).with("seenRevision",s.revision)}
  action planned = all {s.phase=="planning",s'=s.with("phase","ready")}
  action planningFailed = all {s.phase=="planning",s'=s.with("phase","refused")}
  action anotherCaseWrite = all {s.revision<3,s'=s.with("revision",s.revision+1)}
  val current = s.reporter==s.seenReporter and s.payer==s.seenPayer
    and s.consents.contains(s.seenReporter) and s.revision==s.seenRevision
  action publish = all {s.phase=="ready",
    s'=if(current) s.with("phase","published").with("revision",s.revision+1)
      .with("storedReporter",s.seenReporter).with("storedPayer",s.seenPayer)
      .with("reporterAtCommit",s.reporter).with("payerAtCommit",s.payer)
      else s.with("phase","refused")}
  action storageFailed = all {s.phase=="ready",s'=s.with("phase","refused")}
  // After valid publication, a later wallet change does not erase immutable
  // intent/receipt evidence. Matching finalized old transfers remain valid.
  action verifyPublishedTransfer = all {s.phase=="published",s'=s.with("receipt",true)}
  action step = any {rotateReporter,rotatePayer,consent,begin,planned,
    planningFailed,anotherCaseWrite,publish,storageFailed,verifyPublishedTransfer,s'=s}
  val invariant = all {s.revision<=4,
    s.storedReporter>0 implies (s.storedReporter==s.reporterAtCommit and s.storedPayer==s.payerAtCommit),
    s.phase=="refused" implies (s.storedReporter==0 and s.storedPayer==0),
    s.receipt implies (s.phase=="published" and s.storedReporter>0)}
  run currentPreparationPublishesTest = init.then(begin).then(planned).then(publish)
    .expect(s.phase=="published" and s.storedReporter==1 and s.storedPayer==1)
  run reporterChangesDuringRpcTest = init.then(begin).then(rotateReporter).then(consent).then(planned).then(publish)
    .expect(s.phase=="refused" and s.storedReporter==0)
  run payerChangesAfterRpcTest = init.then(begin).then(planned).then(rotatePayer).then(publish)
    .expect(s.phase=="refused" and s.storedPayer==0)
  run consentForOldClaimDoesNotAuthorizeNewClaimTest = init.then(rotateReporter).then(begin.fail())
  run newCurrentClaimCanBePreparedTest = init.then(rotateReporter).then(consent).then(begin).then(planned).then(publish)
    .expect(s.storedReporter==2)
  run concurrentCaseWriteRefusesPreparationTest = init.then(begin).then(planned).then(anotherCaseWrite).then(publish)
    .expect(s.phase=="refused" and s.storedReporter==0)
  run failedBatchDoesNotPublishTest = init.then(begin).then(planned).then(storageFailed)
    .expect(s.storedReporter==0 and s.revision==1)
  run walletChangeAfterPublicationKeepsFrozenEvidenceTest = init.then(begin).then(planned).then(publish)
    .then(rotateReporter).then(rotatePayer).then(verifyPublishedTransfer)
    .expect(s.receipt and s.storedReporter==1 and s.storedPayer==1 and s.reporter==2 and s.payer==2)
}
