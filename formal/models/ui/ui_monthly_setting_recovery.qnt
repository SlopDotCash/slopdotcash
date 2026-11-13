// @source src/AutomaticMonthlyPayment.tsx
// @source src/lib/monthly-commitment-actions.ts
// @source src/lib/evm-vault-actions.ts
// @source src/OwnerPresentation.tsx
// @source src/lib/use-pending-wallet-attempt.ts
// @evidence tests/e2e/vault-actions.spec.ts
// @evidence tests/e2e/solana-vault-actions.spec.ts
// One recorded monthly-setting request, one wallet, and four evidence classes:
// empty, nonexistent, matching, finalized mismatch. Storage is synchronous.
// A returned wallet hash is fixed; user/legacy evidence stays editable.
// A missing arbitrary receipt represents EVM; Solana first checks the exact
// retained-message signature. These adapter predicates are not interchangeable.
// Chain identity, transaction bytes and finality are external predicates.
// Authored by source inspection only; no check was run for this revision.
module ui_monthly_setting_recovery {
  var s:{pending:bool,hash:int,origin:str,draft:int,wallet:bool,busy:bool,
    inflight:int,storedPending:bool,storedHash:int,storedOrigin:str,
    invalid:bool,error:bool,warning:bool,settled:bool,userCleared:bool,sends:int}
  action init=s'={pending:true,hash:0,origin:"none",draft:0,wallet:false,busy:false,
    inflight:0,storedPending:true,storedHash:0,storedOrigin:"none",
    invalid:false,error:false,warning:false,settled:false,userCleared:false,sends:1}
  val editable=s.pending and s.origin!="wallet" and not(s.busy)
  val canSend=not(s.pending) and not(s.invalid)
  // This caller retains its existing explicit user assertion when no hash
  // has been retained. The assertion is not chain proof, even with draft text.
  val canClear=s.pending and s.hash==0 and not(s.busy)
  action connect=all{s.pending,not(s.invalid),s'=s.with("wallet",true)}
  action edit(candidate:int):bool=all{editable,s'=s.with("draft",candidate)}
  action walletReturns(storageWrites:bool):bool=all{s.pending,s.hash==0,not(s.busy),
    s'=s.with("hash",2).with("origin","wallet")
      .with("storedHash",if(storageWrites)2 else s.storedHash)
      .with("storedOrigin",if(storageWrites)"wallet" else s.storedOrigin)
      .with("warning",not(storageWrites))}
  action legacyRecord=all{s.pending,s.hash==0,not(s.busy),
    s'=s.with("hash",1).with("origin","legacy").with("draft",1)
      .with("storedHash",1).with("storedOrigin","legacy")}
  action check=all{s.pending,s.wallet,not(s.busy),not(s.invalid),
    (s.origin=="wallet" and s.hash>0) or (s.origin!="wallet" and s.draft>0),
    s'=s.with("busy",true).with("error",false).with("warning",false)
      .with("inflight",if(s.origin=="wallet")s.hash else s.draft)}
  action pendingResult(storageWrites:bool):bool=all{s.busy,s.inflight!=3,
    s'=if(s.origin=="wallet")s.with("busy",false)
      else s.with("busy",false).with("hash",s.inflight).with("origin","recovery")
        .with("storedHash",if(storageWrites)s.inflight else s.storedHash)
        .with("storedOrigin",if(storageWrites)"recovery" else s.storedOrigin)
        .with("warning",not(storageWrites))}
  action mismatch=all{s.busy,s.inflight==3,s'=s.with("busy",false).with("error",true)}
  action unavailable=all{s.busy,s'=s.with("busy",false).with("error",true)}
  // A matching finalized success or finalized failure resolves this request.
  // Failure does not assert that the monthly setting changed.
  action resolved(storageClears:bool):bool=all{s.busy,s.inflight==2,
    s'=if(storageClears)s.with("busy",false).with("pending",false)
      .with("storedPending",false).with("hash",0).with("origin","none")
      .with("draft",0).with("settled",true)
      else s.with("busy",false).with("error",true)}
  action corruptMarker=all{s.storedPending,not(s.busy),s'=s.with("storedOrigin","invalid")}
  // Removed storage has no remaining record fields. In particular, an old
  // invalid marker cannot reappear after either successful clear path.
  val storedValid=s.storedPending and s.storedOrigin!="invalid"
  val storedInvalid=s.storedPending and s.storedOrigin=="invalid"
  action reload=all{not(s.busy),
    s'=s.with("pending",storedValid)
      .with("hash",if(storedValid)s.storedHash else 0)
      .with("origin",if(storedValid)s.storedOrigin else "none")
      .with("draft",if(storedValid)s.storedHash else 0)
      .with("wallet",false).with("invalid",storedInvalid)
      .with("error",storedInvalid).with("warning",false)}
  action userConfirmsUnsent(storageClears:bool):bool=all{canClear,
    s'=if(storageClears)s.with("pending",false).with("storedPending",false).with("userCleared",true)
      else s.with("error",true)}
  action userClearsUnreadable(storageClears:bool):bool=all{s.invalid,not(s.busy),
    s'=if(storageClears)s.with("invalid",false).with("storedPending",false)
      .with("userCleared",true).with("error",false)
      else s.with("error",true)}
  action nextWalletRequest=all{canSend,s.sends==1,
    s'=s.with("sends",2).with("pending",true).with("storedPending",true)
      .with("hash",0).with("origin","none").with("draft",0)
      .with("storedHash",0).with("storedOrigin","none")}
  action step={nondet candidate=0.to(3).oneOf()
    any{connect,edit(candidate),walletReturns(true),walletReturns(false),legacyRecord,
      check,pendingResult(true),pendingResult(false),mismatch,unavailable,resolved(true),resolved(false),
      corruptMarker,reload,userConfirmsUnsent(true),userConfirmsUnsent(false),
      userClearsUnreadable(true),userClearsUnreadable(false),nextWalletRequest,s'=s}}
  val invariant=all{s.sends<=2,s.sends==2 implies(s.settled or s.userCleared),
    (s.pending or s.invalid) implies not(canSend),
    s.pending and s.origin=="recovery" and not(s.busy) implies editable,
    s.pending and s.hash>0 implies not(canClear)}
  run candidateRemainsEditableAcrossReloadTest=init.then(connect).then(edit(1)).then(check)
    .then(pendingResult(true)).then(reload).then(connect)
    .expect(editable and s.draft==1 and not(canSend) and not(canClear))
  run correctCandidateAfterPendingTest=init.then(connect).then(edit(1)).then(check).then(pendingResult(true))
    .then(edit(2)).then(check).then(resolved(true)).expect(s.settled and canSend)
  run finalizedMismatchPreservesEditableCandidateTest=init.then(connect).then(edit(3)).then(check).then(mismatch)
    .expect(s.pending and editable and s.error).then(edit(2)).then(check).then(resolved(true))
  run returnedWalletHashStaysFixedTest=init.then(walletReturns(true)).then(connect).then(edit(1).fail())
  run unmarkedLegacyHashIsEditableTest=init.then(legacyRecord).then(reload).then(connect)
    .then(edit(2)).then(check).then(resolved(true)).expect(s.settled)
  run failedCandidateWriteKeepsMemoryFenceTest=init.then(connect).then(edit(1)).then(check).then(pendingResult(false))
    .expect(s.warning and editable and s.hash==1 and s.storedHash==0 and not(canSend) and not(canClear))
  run failedWriteReloadNeedsExplicitUserAssertionTest=init.then(connect).then(edit(1)).then(check).then(pendingResult(false))
    .then(reload).expect(canClear and not(canSend)).then(userConfirmsUnsent(true)).then(nextWalletRequest)
    .expect(s.sends==2 and s.userCleared and not(s.settled))
  run failedClearKeepsRequestTest=init.then(connect).then(edit(2)).then(check).then(resolved(false))
    .expect(s.error and s.pending and not(canSend))
  run invalidProvenanceRefusesNewSendTest=init.then(legacyRecord).then(corruptMarker).then(reload)
    .expect(s.invalid and not(canSend))
  run transientCheckErrorKeepsCandidateTest=init.then(legacyRecord).then(connect).then(edit(2)).then(check).then(unavailable)
    .expect(s.pending and editable and s.hash==1 and s.draft==2)
  run clearedUnreadableRecordStaysAbsentAfterReloadTest=init.then(legacyRecord).then(corruptMarker).then(reload)
    .then(userClearsUnreadable(true)).then(reload)
    .expect(not(s.pending) and not(s.invalid) and not(s.error) and s.hash==0 and s.origin=="none" and s.draft==0 and canSend)
  run resolvedRecordDoesNotResurrectAfterReloadTest=init.then(connect).then(edit(2)).then(check).then(resolved(true)).then(reload)
    .expect(not(s.pending) and not(s.invalid) and s.hash==0 and s.origin=="none" and s.draft==0 and s.settled)
  run confirmedUnsentRecordDoesNotResurrectAfterReloadTest=init.then(edit(1)).then(userConfirmsUnsent(true)).then(reload)
    .expect(not(s.pending) and not(s.invalid) and s.hash==0 and s.origin=="none" and s.draft==0 and s.userCleared)
  run failedUnreadableClearRemainsBlockedAfterReloadTest=init.then(legacyRecord).then(corruptMarker).then(reload)
    .then(userClearsUnreadable(false)).then(reload).expect(s.invalid and s.error and not(canSend))
}
