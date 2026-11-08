// @source src/SecurityBounty.tsx
// @source src/DirectBountyPayment.tsx
// @source src/SolanaBountyPayment.tsx
// @source src/lib/use-action.ts
// @evidence tests/e2e/bounty-full-flow.spec.ts
// @evidence tests/e2e/bounty-solana-flow.spec.ts
// One selected case, two actors, three case reads, two payment generations,
// message IDs and plan byte classes. Mode 1=EVM, 2=Solana, 3=submitted recovery.
// Mode is the projection of a structurally valid backend case, not a parser
// proof. The backend supplies one chain family and role-filtered ownerRequest.
// This model covers parent/keyed-child lifetime, not wallet signing/finality.
// Authored by source inspection only; no check was run for this revision.
module ui_bounty_payment_parent {
  type State = {actor:int,phase:str,reads:int,active:int,pending:Set[int],warning:bool,
    generation:int,message:int,plan:int,mode:int,epoch:int,identityChecks:int,storageReady:bool,storagePending:bool,
    journal:bool,journalPlan:int,preflight:bool,walletOpen:bool,promptEpoch:int,promptKey:int,promptPlan:int,
    savedKeys:Set[int],hashKeys:Set[int]}
  var s: State
  action init=s'={actor:1,phase:"loading",reads:0,active:0,pending:Set(),warning:false,
    generation:0,message:0,plan:0,mode:0,epoch:0,identityChecks:0,storageReady:false,storagePending:false,journal:false,journalPlan:0,preflight:false,walletOpen:false,promptEpoch:0,promptKey:0,promptPlan:0,savedKeys:Set(),hashKeys:Set()}
  val storageKey=if(s.mode==2)200+s.generation*10+s.message*2+s.actor else 100+s.generation*10+s.actor
  val sendChild=s.mode==1 or s.mode==2
  val mismatched=s.mode==1 and s.journal and s.journalPlan!=s.plan
  // One representative transfer. Partial multi-transfer journals and nonce
  // ordering remain in DirectBountyPayment and the financial models.
  val sendPresented=sendChild and s.storageReady and not(s.journal) and not(mismatched)
  // These fields represent one live async invocation, not durable component
  // state. Its closure is gone after refusal, decline, or a wallet result.
  def finishedPrompt(state:State):State=state.with("preflight",false).with("walletOpen",false)
    .with("promptEpoch",0).with("promptKey",0).with("promptPlan",0)
  def changedKey(mode:int,generation:int,message:int):bool=
    mode!=s.mode or ((mode==1 or mode==2) and generation!=s.generation) or
      (mode==2 and message!=s.message)
  def received(mode:int,generation:int,message:int,plan:int): State =
    s.with("phase","ready").with("warning",false).with("active",0)
      .with("mode",mode).with("generation",generation).with("message",message).with("plan",plan)
      .with("epoch",if(changedKey(mode,generation,message))s.epoch+1 else s.epoch)
      .with("storageReady",if(changedKey(mode,generation,message))false else s.storageReady)
      .with("storagePending",if(changedKey(mode,generation,message))(mode==1 or mode==2) else s.storagePending)
      .with("journal",if(changedKey(mode,generation,message))false else s.journal)
      .with("journalPlan",if(changedKey(mode,generation,message))0 else s.journalPlan)
  action readCase=all{s.actor>0,s.reads<3,
    s'=s.with("reads",s.reads+1).with("active",s.reads+1)
      .with("pending",s.pending.union(Set(s.reads+1)))
      .with("phase",if(s.phase=="ready")"ready" else "loading")}
  action caseReply(id:int,mode:int,generation:int,message:int,plan:int):bool=all{s.pending.contains(id),
    s'=if(id==s.active and s.actor>0)
      received(mode,generation,message,plan).with("pending",s.pending.exclude(Set(id)))
      else s.with("pending",s.pending.exclude(Set(id)))}
  action failedRead(id:int):bool=all{s.pending.contains(id),
    s'=if(id==s.active and s.actor>0)
      s.with("active",0).with("pending",s.pending.exclude(Set(id)))
        .with("phase",if(s.phase=="ready")"ready" else "error")
        .with("warning",s.phase=="ready")
      else s.with("pending",s.pending.exclude(Set(id)))}
  // The enclosing private-session provider removes the complete subtree on
  // checking, known sign-out, actor change or authoritative access refusal.
  action hidePrivateView=all{s.actor>0,s.identityChecks<2,
    s'=s.with("actor",0).with("phase","checking").with("active",0)
      .with("mode",0).with("epoch",s.epoch+1).with("identityChecks",s.identityChecks+1)
      .with("storageReady",false).with("storagePending",false)
      .with("journal",false).with("journalPlan",0).with("warning",false)}
  action confirmActor(actor:int):bool=all{s.actor==0,actor>0,actor<=2,
    s'=s.with("actor",actor).with("phase","loading")}
  action storageReply(epoch:int,hasJournal:bool,plan:int):bool=all{
    epoch!=s.epoch or not(s.storagePending) or not(s.savedKeys.contains(storageKey)) or hasJournal,
    s'=if(epoch==s.epoch and s.storagePending and sendChild and s.actor>0)
      s.with("storageReady",true).with("storagePending",false).with("journal",hasJournal).with("journalPlan",if(hasJournal)plan else 0)
        .with("savedKeys",if(hasJournal)s.savedKeys.union(Set(storageKey)) else s.savedKeys)
      else s}
  // The last successful identity/plan preflight binds this invocation. EVM
  // wallet/network/nonce awaits still follow it; navigation is not cancellation.
  action reviewBeforePrompt=all{sendPresented,not(s.preflight),not(s.walletOpen),
    s'=s.with("preflight",true).with("promptEpoch",s.epoch)
      .with("promptKey",storageKey).with("promptPlan",s.plan)}
  action preflightRefused=all{s.preflight,s'=finishedPrompt(s)}
  action recordBeforePrompt=all{s.preflight,not(s.walletOpen),
    s'=s.with("preflight",false).with("walletOpen",true)
      .with("journal",if(s.promptEpoch==s.epoch)true else s.journal)
      .with("journalPlan",if(s.promptEpoch==s.epoch)s.promptPlan else s.journalPlan)
      .with("savedKeys",s.savedKeys.union(Set(s.promptKey)))}
  // The promise retains the old storage key after its component unmounts.
  // A returned hash is durable evidence to check, not proof of payment.
  action walletReturns(storageWrites:bool):bool=all{s.walletOpen,
    s'=finishedPrompt(s.with("hashKeys",if(storageWrites)s.hashKeys.union(Set(s.promptKey)) else s.hashKeys))}
  action walletUnknown=all{s.walletOpen,s'=finishedPrompt(s)}
  action walletDeclined(storageClears:bool):bool=all{s.walletOpen,
    s'=if(storageClears)finishedPrompt(s.with("savedKeys",s.savedKeys.exclude(Set(s.promptKey)))
      .with("hashKeys",s.hashKeys.exclude(Set(s.promptKey)))
      .with("journal",if(s.promptEpoch==s.epoch)false else s.journal)
      .with("journalPlan",if(s.promptEpoch==s.epoch)0 else s.journalPlan))
      else finishedPrompt(s)}
  action chooseCaseReply={nondet id=1.to(3).oneOf() nondet mode=0.to(3).oneOf()
    nondet generation=1.to(2).oneOf() nondet message=1.to(2).oneOf()
    nondet plan=1.to(2).oneOf()
    caseReply(id,mode,generation,message,plan)}
  action chooseFailedRead={nondet id=1.to(3).oneOf() failedRead(id)}
  action chooseStorageReply={nondet epoch=0.to(5).oneOf() nondet plan=1.to(2).oneOf()
    any{storageReply(epoch,true,plan),storageReply(epoch,false,plan)}}
  // Keep each finite choice with its own transition. Hoisting all choices
  // over this disjunction repeats unrelated successors without adding states.
  action step=any{readCase,chooseCaseReply,chooseFailedRead,
    hidePrivateView,confirmActor(1),confirmActor(2),chooseStorageReply,
    reviewBeforePrompt,preflightRefused,recordBeforePrompt,walletReturns(true),walletReturns(false),walletUnknown,walletDeclined(true),walletDeclined(false),s'=s}
  val invariant=all{s.reads<=3,s.identityChecks<=2,s.epoch<=5,s.actor>=0,s.actor<=2,
    s.mode>0 implies(s.phase=="ready" and s.actor>0),
    s.storageReady implies sendChild,
    mismatched implies not(sendPresented),
    s.journal implies not(sendPresented),
    s.hashKeys.subseteq(s.savedKeys),
    s.walletOpen implies s.savedKeys.contains(s.promptKey),
    s.actor==0 implies(s.mode==0 and not(s.storageReady) and not(s.journal))}
  run sameGenerationEvmPlanKeepsAndChecksJournalTest=init.then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(readCase).then(caseReply(2,1,1,1,2))
    .expect(s.epoch==1 and s.journal and mismatched and not(sendPresented))
  run evmGenerationChangeRemountsChildTest=init.then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,true,1)).then(readCase).then(caseReply(2,1,2,1,2))
    .expect(s.epoch==2 and not(s.journal) and not(s.storageReady))
  run solanaMessageChangeRemountsChildTest=init.then(readCase).then(caseReply(1,2,1,1,1))
    .then(storageReply(1,true,1)).then(readCase).then(caseReply(2,2,1,2,2))
    .expect(s.epoch==2 and not(s.journal) and not(s.storageReady))
  run staleStorageReplyCannotPopulateNewChildTest=init.then(readCase).then(caseReply(1,2,1,1,1))
    .then(readCase).then(caseReply(2,2,1,2,2)).then(storageReply(1,true,1))
    .expect(not(s.journal) and not(s.storageReady))
  run transientRefreshRetainsPaymentChildTest=init.then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,true,1)).then(readCase).then(failedRead(2))
    .expect(s.warning and s.mode==1 and s.journal and s.epoch==1)
  run actorCheckUnmountsOldPrivateChildTest=init.then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,true,1)).then(hidePrivateView).then(confirmActor(2)).then(storageReply(1,true,1))
    .expect(s.actor==2 and s.mode==0 and not(s.journal))
  run supersededCaseReadCannotRestoreSendControlsTest=init.then(readCase).then(readCase)
    .then(caseReply(2,3,2,1,2)).then(caseReply(1,1,1,1,1))
    .expect(s.mode==3 and s.generation==2 and not(sendPresented))
  run fallbackGenerationChangeRetainsComponentInstanceTest=init.then(readCase).then(caseReply(1,3,1,1,1))
    .then(readCase).then(caseReply(2,3,2,1,2)).expect(s.mode==3 and s.epoch==1 and s.generation==2)
  run departedWalletResultStaysInOriginalStorageSlotTest=init.then(readCase).then(caseReply(1,2,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(readCase).then(caseReply(2,2,1,2,2))
    .then(walletReturns(true)).expect(s.hashKeys.contains(213) and not(s.journal) and s.epoch==2)
  run uncertainWalletResultKeepsOriginalMarkerTest=init.then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(walletUnknown)
    .expect(s.savedKeys.contains(111) and s.journal and s.hashKeys==Set() and not(sendPresented))
  run declinedWalletRequestClearsItsMarkerTest=init.then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(walletDeclined(true))
    .expect(not(s.journal) and s.savedKeys==Set() and sendPresented)
  run departureAfterLastGuardDoesNotCancelWalletTailTest=init.then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(hidePrivateView).then(recordBeforePrompt)
    .expect(s.walletOpen and s.savedKeys.contains(111) and s.mode==0 and not(s.journal))
  run declinedRequestWithStorageFailureRetainsMarkerTest=init.then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(walletDeclined(false))
    .expect(s.journal and s.savedKeys.contains(111) and not(sendPresented))
}
