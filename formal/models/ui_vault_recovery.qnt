// @source src/VaultActions.tsx
// @source src/lib/solana-vault-actions.ts
// @source contracts/solana/wallet-transactions.ts
// @evidence tests/e2e/solana-vault-actions.spec.ts
// @evidence tests/e2e/vault-actions.spec.ts
// One uncertain sent action, four candidate classes (empty, nonexistent,
// matching, unrelated), one check at a time, synchronous local storage write.
// Wallet-returned IDs stay fixed; an unmarked legacy ID is not assumed to
// have come from the wallet. Signature/message/finality checks are predicates
// supplied by the real adapters, not inferred from a candidate's syntax.
module ui_vault_recovery {
  var s:{pending:bool,hash:int,origin:str,draft:int,busy:bool,inflight:int,
    storedHash:int,storedOrigin:str,storedPending:bool,invalid:bool,
    wallet:bool,error:bool,verified:bool,sends:int}
  action init=s'={pending:true,hash:0,origin:"none",draft:0,busy:false,inflight:0,
    storedHash:0,storedOrigin:"none",storedPending:true,invalid:false,
    wallet:false,error:false,verified:false,sends:1}
  val editable=s.pending and s.origin!="wallet" and not(s.busy)
  val canSend=not(s.pending) and not(s.invalid)
  val canClear=s.pending and s.hash==0 and s.draft==0 and not(s.busy)
  action connect=all{s.pending,not(s.invalid),s'=s.with("wallet",true)}
  action walletReturned=all{s.hash==0,not(s.busy),s.pending,
    s'=s.with("hash",2).with("origin","wallet").with("storedHash",2).with("storedOrigin","wallet")}
  action legacyRecord=all{s.hash==0,not(s.busy),s.pending,
    s'=s.with("hash",1).with("origin","legacy").with("draft",1)
      .with("storedHash",1).with("storedOrigin","legacy")}
  action edit(candidate:int):bool=all{editable,s'=s.with("draft",candidate)}
  action check=all{s.pending,s.wallet,not(s.busy),not(s.invalid),
    (s.origin=="wallet" and s.hash>0) or (s.origin!="wallet" and s.draft>0),
    s'=s.with("busy",true).with("inflight",if(s.origin=="wallet")s.hash else s.draft).with("error",false)}
  action pendingResult(storageWrites:bool):bool=all{s.busy,
    s'=if(s.origin=="wallet")s.with("busy",false)
      else s.with("busy",false).with("hash",s.inflight).with("origin","recovery")
        .with("storedHash",if(storageWrites)s.inflight else s.storedHash)
        .with("storedOrigin",if(storageWrites)"recovery" else s.storedOrigin)}
  action mismatch=all{s.busy,s.inflight==3,s'=s.with("busy",false).with("error",true)}
  action unavailable=all{s.busy,s'=s.with("busy",false).with("error",true)}
  action finalized(storageClears:bool):bool=all{s.busy,s.inflight==2,
    s'=if(storageClears)s.with("busy",false).with("pending",false).with("storedPending",false).with("verified",true)
      else s.with("busy",false).with("error",true)}
  action corruptMarker=all{not(s.busy),s'=s.with("storedOrigin","bad")}
  // A reload after the check has settled reads the acknowledged stored bytes.
  // Interrupted requests/navigation composition remains outside this module.
  action reload=all{not(s.busy),
    s'=s.with("pending",s.storedPending and s.storedOrigin!="bad")
      .with("hash",s.storedHash).with("origin",s.storedOrigin).with("draft",s.storedHash)
      .with("invalid",s.storedOrigin=="bad").with("wallet",false).with("error",s.storedOrigin=="bad")}
  action sendNextAction=all{canSend,s.verified,s.sends==1,s'=s.with("sends",2)}
  action step={nondet c=0.to(3).oneOf()
    any{connect,walletReturned,legacyRecord,edit(c),check,pendingResult(true),pendingResult(false),
      mismatch,unavailable,finalized(true),finalized(false),corruptMarker,reload,sendNextAction,s'=s}}
  val invariant=all{s.sends<=2,s.sends==2 implies s.verified,
    (s.pending or s.invalid) implies not(canSend),
    s.pending and s.hash>0 implies not(canClear),
    s.pending and s.origin=="recovery" and not(s.busy) implies editable}
  run unknownCandidateStaysEditableAfterReloadTest=init.then(connect).then(edit(1)).then(check)
    .then(pendingResult(true)).then(reload).then(connect)
    .expect(editable and s.draft==1 and not(canSend) and not(canClear) and s.sends==1)
  run unrelatedEvidenceRefusedBeforeMatchingFinalityTest=init.then(connect).then(edit(1)).then(check).then(pendingResult(true))
    .then(edit(3)).then(check).then(mismatch).expect(s.pending and s.hash==1 and s.error)
    .then(edit(2)).then(check).then(finalized(true)).expect(s.verified and canSend and s.sends==1)
  run walletReturnedEvidenceCannotBeEditedTest=init.then(walletReturned).then(connect).then(edit(1).fail())
  run legacyEvidenceCanBeCorrectedTest=init.then(legacyRecord).then(reload).then(connect).then(edit(2)).then(check)
    .then(finalized(true)).expect(s.verified and s.sends==1)
  run failedWriteRetainsMemoryFenceTest=init.then(connect).then(edit(1)).then(check).then(pendingResult(false))
    .expect(s.hash==1 and s.storedHash==0 and editable and not(canClear) and not(canSend))
    .then(check).then(pendingResult(true)).then(reload).expect(s.hash==1 and editable)
  run transientCheckFailureKeepsEvidenceTest=init.then(legacyRecord).then(connect).then(edit(2)).then(check).then(unavailable)
    .expect(s.pending and s.hash==1 and s.draft==2 and editable and not(canSend))
  run corruptMarkerFailsClosedTest=init.then(legacyRecord).then(corruptMarker).then(reload)
    .expect(s.invalid and not(canSend) and not(editable) and s.sends==1)
  run failedStorageClearCannotEnableAnotherSendTest=init.then(connect).then(edit(2)).then(check).then(finalized(false))
    .expect(s.pending and s.error and not(canSend) and s.sends==1)
}
