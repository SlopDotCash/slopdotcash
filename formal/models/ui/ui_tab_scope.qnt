// @source src/DirectBountyPayment.tsx
// @source src/OwnerCommitment.tsx
// Two independent tabs. sessionStorage writes and in-memory busy refs are
// tab-local; the application has no cross-tab mutex. The same fixed intent
// may open two wallet prompts. Nonce/award acceptance is an external predicate,
// refined by the payment/contract models; this model does NOT prove it on chain.
module ui_tab_scope {
  var s:{pending:Set[int],prompted:Set[int],uncertain:Set[int],verified:Set[int],
    storageFailed:Set[int],accepted:bool,receipt:bool}
  action init = s'={pending:Set(),prompted:Set(),uncertain:Set(),verified:Set(),
    storageFailed:Set(),accepted:false,receipt:false}
  action storageFailure(tab:int):bool = all {not(s.pending.contains(tab)),
    s'=s.with("storageFailed",s.storageFailed.union(Set(tab)))}
  action persist(tab:int):bool = all {not(s.storageFailed.contains(tab)),
    not(s.pending.contains(tab)),not(s.accepted),s'=s.with("pending",s.pending.union(Set(tab)))}
  action prompt(tab:int):bool = all {s.pending.contains(tab),not(s.prompted.contains(tab)),
    s'=s.with("prompted",s.prompted.union(Set(tab)))}
  action walletUnknown(tab:int):bool = all {s.prompted.contains(tab),
    s'=s.with("uncertain",s.uncertain.union(Set(tab)))}
  action externalAccept = all {s.prompted.size()>0,not(s.accepted),s'=s.with("accepted",true)}
  action finalizedEvidence = all {s.accepted,s'=s.with("receipt",true)}
  action reconcile(tab:int):bool = all {s.pending.contains(tab),s.receipt,
    s'=s.with("verified",s.verified.union(Set(tab))).with("uncertain",s.uncertain.exclude(Set(tab)))}
  action step = any {storageFailure(1),storageFailure(2),persist(1),persist(2),
    prompt(1),prompt(2),walletUnknown(1),walletUnknown(2),externalAccept,
    finalizedEvidence,reconcile(1),reconcile(2),s'=s}
  val invariant = all {s.prompted.subseteq(s.pending),
    s.prompted.intersect(s.storageFailed)==Set(),s.verified.size()>0 implies s.receipt,
    s.receipt implies s.accepted}
  run bothTabsCanPromptTest = init.then(persist(1)).then(persist(2)).then(prompt(1)).then(prompt(2))
    .expect(s.prompted==Set(1,2))
  run storageFailureBlocksPromptTest = init.then(storageFailure(1)).expect(not(s.pending.contains(1)))
  run uncertainUntilEvidenceTest = init.then(persist(1)).then(prompt(1)).then(walletUnknown(1))
    .expect(s.uncertain.contains(1) and s.verified==Set())
  run bothTabsReconcileOneIntentTest = init.then(persist(1)).then(persist(2)).then(prompt(1)).then(prompt(2))
    .then(externalAccept).then(finalizedEvidence).then(reconcile(1)).then(reconcile(2))
    .expect(s.verified==Set(1,2))
}
