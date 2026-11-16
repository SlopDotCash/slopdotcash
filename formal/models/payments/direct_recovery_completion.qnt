// @source backend/security/direct-payments.ts
// @source backend/security/handler.ts
// @source backend/payments/wallet-registration.ts
// @source migrations/0112_direct_payment_recovery.sql
// @source migrations/0113_direct_unpaid_leg_recovery.sql
// One recovery request, three reporter wallets, two payer wallets and generations.
// Chain retirement is a predicate supplied by direct_payment_recovery and
// direct_solana_retirement. This model covers the post-await commit fence.
// Case actions can reach revision 3 before another generation and this commit;
// the combined finite bound is 5. This is not a production revision limit.
module direct_recovery_completion {
  var s: {phase:str,target:int,consent:int,authorized:bool,generation:int,
    payer:int,seenPayer:int,payerAuthorized:bool,payerAtCommit:int,payerAuthorizedAtCommit:bool,
    revision:int,seenTarget:int,seenGeneration:int,seenRevision:int,actor:int,
    feeOnly:bool,retired:bool,committed:bool,targetAtCommit:int,consentAtCommit:int}
  action init = s'={phase:"idle",target:1,consent:1,authorized:true,generation:0,
    payer:1,seenPayer:0,payerAuthorized:true,payerAtCommit:0,payerAuthorizedAtCommit:false,
    revision:1,seenTarget:0,seenGeneration:0,seenRevision:0,actor:1,
    feeOnly:false,retired:false,committed:false,targetAtCommit:0,consentAtCommit:0}
  action feeRecovery = all {s.phase=="idle",s'=s.with("feeOnly",true)}
  action walletReplacement = all {s.target<3,not(s.committed),
    s'=s.with("target",s.target+1).with("consent",0).with("authorized",true)}
  action payerWalletReplacement = all {s.payer<2,not(s.committed),
    s'=s.with("payer",s.payer+1).with("payerAuthorized",true)}
  action revokePayerAuthorization = s'=s.with("payerAuthorized",false)
  action reporterConsent = s'=s.with("consent",s.target)
  action revokeWalletAuthorization = s'=s.with("authorized",false)
  action begin = all {s.phase=="idle",
    s'=s.with("phase","reading").with("seenTarget",s.target)
      .with("seenGeneration",s.generation).with("seenRevision",s.revision)
      .with("seenPayer",s.payer)}
  action reread = all {s.phase=="reading",
    s'=s.with("phase",if(s.feeOnly or (s.target==s.seenTarget and s.generation==s.seenGeneration))"proving" else "refused")}
  action retirementVerified = all {s.phase=="proving",
    s'=s.with("phase","ready").with("retired",true)}
  action otherGeneration = all {not(s.committed),s.generation<1,
    s'=s.with("generation",s.generation+1).with("revision",s.revision+1)}
  action otherCaseAction = all {not(s.committed),s.revision<3,
    s'=s.with("revision",s.revision+1)}
  def valid(witnessActor:int):bool = s.retired and s.generation==s.seenGeneration
    and s.revision==s.seenRevision and witnessActor==s.actor
    and s.payer==s.seenPayer and s.payerAuthorized
    and (s.feeOnly or (s.target==s.seenTarget and s.authorized
      and (s.seenTarget==1 or s.consent==s.seenTarget)))
  action commit(witnessActor:int):bool = all {s.phase=="ready",
    s'=if(valid(witnessActor))s.with("phase","done").with("committed",true)
      .with("generation",s.generation+1).with("revision",s.revision+1)
      .with("targetAtCommit",s.target).with("consentAtCommit",s.consent)
      .with("payerAtCommit",s.payer).with("payerAuthorizedAtCommit",s.payerAuthorized)
      else s.with("phase","refused")}
  action step = any {feeRecovery,walletReplacement,payerWalletReplacement,
    revokePayerAuthorization,reporterConsent,
    revokeWalletAuthorization,begin,reread,retirementVerified,otherGeneration,
    otherCaseAction,commit(1),commit(2),s'=s}
  val invariant = all {s.generation<=2,s.revision<=5,
    s.committed implies (s.phase=="done" and s.generation==s.seenGeneration+1
      and s.payerAtCommit==s.seenPayer and s.payerAuthorizedAtCommit),
    s.committed and not(s.feeOnly) implies (s.targetAtCommit==s.seenTarget
      and (s.seenTarget==1 or s.consentAtCommit==s.seenTarget))}
  run stableSuccessorTest = init.then(walletReplacement).then(reporterConsent)
    .then(begin).then(reread).then(retirementVerified).then(commit(1)).expect(s.committed)
  run walletChangedBeforeSecondReadTest = init.then(walletReplacement).then(reporterConsent)
    .then(begin).then(walletReplacement).then(reread).expect(s.phase=="refused" and not(s.committed))
  run walletChangedDuringProofTest = init.then(walletReplacement).then(reporterConsent)
    .then(begin).then(reread).then(walletReplacement).then(reporterConsent)
    .then(retirementVerified).then(commit(1)).expect(not(s.committed) and s.generation==0)
  run currentGenerationChangedTest = init.then(begin).then(reread).then(retirementVerified)
    .then(otherGeneration).then(commit(1)).expect(not(s.committed) and s.generation==1)
  run caseRevisionChangedTest = init.then(begin).then(reread).then(retirementVerified)
    .then(otherCaseAction).then(commit(1)).expect(not(s.committed) and s.generation==0)
  run currentAuthorizationRequiredTest = init.then(begin).then(reread).then(retirementVerified)
    .then(revokeWalletAuthorization).then(commit(1)).expect(not(s.committed))
  run eventMustBelongToRecoveringActorTest = init.then(begin).then(reread).then(retirementVerified)
    .then(commit(2)).expect(not(s.committed))
  run feeOnlyRecoveryPreservesPaidReporterTest = init.then(feeRecovery).then(begin)
    .then(reread).then(walletReplacement).then(retirementVerified).then(commit(1)).expect(s.committed)
  run payerChangedDuringProofTest = init.then(begin).then(reread)
    .then(payerWalletReplacement).then(retirementVerified).then(commit(1))
    .expect(not(s.committed) and s.generation==0)
  run payerAuthorizationRevokedDuringProofTest = init.then(begin).then(reread)
    .then(revokePayerAuthorization).then(retirementVerified).then(commit(1))
    .expect(not(s.committed))
  run feeOnlyRecoveryRequiresCurrentPayerTest = init.then(feeRecovery).then(begin)
    .then(reread).then(payerWalletReplacement).then(retirementVerified).then(commit(1))
    .expect(not(s.committed))
  run priorCaseActionsAndGenerationRetainSafetyTest = init.then(otherCaseAction)
    .then(otherCaseAction).then(otherGeneration).then(begin).then(reread)
    .then(retirementVerified).then(commit(1)).expect(s.revision==5 and invariant)
}
