// @source src/SecurityBounty.tsx
// @source src/DirectBountyPayment.tsx
// @source src/SolanaBountyPayment.tsx
// @source src/lib/use-action.ts
// @evidence tests/e2e/bounty-full-flow.spec.ts
// @evidence tests/e2e/bounty-solana-flow.spec.ts
// One selected case, two actors, three case reads, two replacements, two payment generations,
// message IDs and plan byte classes. Mode 1=EVM, 2=Solana, 3=submitted recovery.
// Mode is the projection of a structurally valid backend case, not a parser
// proof. The backend supplies one chain family and role-filtered ownerRequest.
// This model covers parent/keyed-child lifetime, not wallet signing/finality.
// Durable storage slots are tracked for one nondeterministically chosen key.
// Every guard and invariant that reads savedKeys or hashKeys concerns only
// the current storage key or the open prompt key, and no transition moves
// contents between keys. An untracked slot is therefore over-approximated as
// empty, which only adds storage replies. Checking every tracked key covers
// the per-key invariants of the full product without its 3^12 slot subsets.
// Generation and message values 1 and 2 are interchangeable: the initial
// state uses 0, every choice ranges over both values, and keys are compared
// only for equality. Swapping either label is a model automorphism, so keys
// 111, 112, 213 and 214 represent the orbits of all twelve storage keys.
module ui_bounty_payment_parent {
  type State = {actor:int,phase:str,reads:int,replacements:int,active:int,pending:Set[int],warning:bool,
    generation:int,message:int,plan:int,mode:int,epoch:int,identityChecks:int,storageReady:bool,storagePending:bool,
    journal:bool,journalPlan:int,preflight:bool,walletOpen:bool,promptEpoch:int,promptKey:int,promptPlan:int,
    tracked:int,savedKeys:Set[int],hashKeys:Set[int]}
  var s: State
  pure val storageKeys=Set(111,112,121,122,213,214,215,216,223,224,225,226)
  def keep(slots:Set[int]):Set[int]=slots.intersect(Set(s.tracked))
  action initTracking(tracked:int):bool=s'={actor:1,phase:"loading",reads:0,replacements:0,active:0,pending:Set(),warning:false,
    generation:0,message:0,plan:0,mode:0,epoch:0,identityChecks:0,storageReady:false,storagePending:false,journal:false,journalPlan:0,preflight:false,walletOpen:false,promptEpoch:0,promptKey:0,promptPlan:0,tracked:tracked,savedKeys:Set(),hashKeys:Set()}
  pure val trackedRepresentatives=Set(111,112,213,214)
  action init={nondet tracked=trackedRepresentatives.oneOf() initTracking(tracked)}
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
  // A local action result supersedes every in-flight observation. The
  // implementation increments the read generation before replacing state.
  // This action is an accepted replacement projection. Numeric revision
  // refusal is modeled separately in ui_private_case_revisions.
  action replaceCase(mode:int,generation:int,message:int,plan:int):bool=all{s.actor>0,s.replacements<2,
    s'=received(mode,generation,message,plan).with("replacements",s.replacements+1)}
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
        .with("savedKeys",if(hasJournal)keep(s.savedKeys.union(Set(storageKey))) else s.savedKeys)
      else s}
  // Identity/plan preflight binds this invocation. Both send children check
  // their current mounted lifetime again immediately before recording/opening
  // a wallet request; only an already-open wallet tail survives departure.
  action reviewBeforePrompt=all{sendPresented,not(s.preflight),not(s.walletOpen),
    s'=s.with("preflight",true).with("promptEpoch",s.epoch)
      .with("promptKey",storageKey).with("promptPlan",s.plan)}
  action preflightRefused=all{s.preflight,s'=finishedPrompt(s)}
  action recordBeforePrompt=all{s.preflight,not(s.walletOpen),s.actor>0,
    s.promptEpoch==s.epoch,sendChild,
    s'=s.with("preflight",false).with("walletOpen",true)
      .with("journal",if(s.promptEpoch==s.epoch)true else s.journal)
      .with("journalPlan",if(s.promptEpoch==s.epoch)s.promptPlan else s.journalPlan)
      .with("savedKeys",keep(s.savedKeys.union(Set(s.promptKey))))}
  // The promise retains the old storage key after its component unmounts.
  // A returned hash is durable evidence to check, not proof of payment.
  action walletReturns(storageWrites:bool):bool=all{s.walletOpen,
    s'=finishedPrompt(s.with("hashKeys",if(storageWrites)keep(s.hashKeys.union(Set(s.promptKey))) else s.hashKeys))}
  action walletUnknown=all{s.walletOpen,s'=finishedPrompt(s)}
  action walletDeclined(storageClears:bool):bool=all{s.walletOpen,
    s'=if(storageClears)finishedPrompt(s.with("savedKeys",s.savedKeys.exclude(Set(s.promptKey)))
      .with("hashKeys",s.hashKeys.exclude(Set(s.promptKey)))
      .with("journal",if(s.promptEpoch==s.epoch)false else s.journal)
      .with("journalPlan",if(s.promptEpoch==s.epoch)0 else s.journalPlan))
      else finishedPrompt(s)}
  // Stale reply payloads do not reach State; retain one witness per ID.
  action chooseCaseReply={nondet id=1.to(3).oneOf()
    if(id==s.active and s.actor>0) {
      nondet mode=0.to(3).oneOf() nondet generation=1.to(2).oneOf()
      nondet message=1.to(2).oneOf() nondet plan=1.to(2).oneOf()
      caseReply(id,mode,generation,message,plan)
    } else caseReply(id,0,1,1,1)}
  action chooseCaseReplacement={nondet mode=0.to(3).oneOf()
    nondet generation=1.to(2).oneOf() nondet message=1.to(2).oneOf()
    nondet plan=1.to(2).oneOf()
    replaceCase(mode,generation,message,plan)}
  action chooseFailedRead={nondet id=1.to(3).oneOf() failedRead(id)}
  // A stale epoch already permits identity from every State; keep it once.
  action chooseStorageReply=any{
    {nondet plan=1.to(2).oneOf()
      all{0.to(7).contains(s.epoch),storageReply(s.epoch,true,plan)}},
    all{0.to(7).contains(s.epoch),storageReply(s.epoch,false,1)},
    s'=s}
  // Keep each finite choice with its own transition. Hoisting all choices
  // over this disjunction repeats unrelated successors without adding states.
  action step=any{readCase,chooseCaseReply,chooseCaseReplacement,chooseFailedRead,
    hidePrivateView,confirmActor(1),confirmActor(2),chooseStorageReply,
    reviewBeforePrompt,preflightRefused,recordBeforePrompt,walletReturns(true),walletReturns(false),walletUnknown,walletDeclined(true),walletDeclined(false),s'=s}
  val invariant=all{s.reads<=3,s.replacements<=2,s.identityChecks<=2,s.epoch<=7,s.actor>=0,s.actor<=2,
    s.mode>0 implies(s.phase=="ready" and s.actor>0),
    s.storageReady implies sendChild,
    mismatched implies not(sendPresented),
    s.journal implies not(sendPresented),
    s.hashKeys.subseteq(s.savedKeys),
    storageKeys.contains(s.tracked),s.savedKeys.subseteq(Set(s.tracked)),
    (s.walletOpen and s.promptKey==s.tracked) implies s.savedKeys.contains(s.promptKey),
    s.actor==0 implies(s.mode==0 and not(s.storageReady) and not(s.journal))}
  run sameGenerationEvmPlanKeepsAndChecksJournalTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(readCase).then(caseReply(2,1,1,1,2))
    .expect(s.epoch==1 and s.journal and mismatched and not(sendPresented))
  run evmGenerationChangeRemountsChildTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,true,1)).then(readCase).then(caseReply(2,1,2,1,2))
    .expect(s.epoch==2 and not(s.journal) and not(s.storageReady))
  run solanaMessageChangeRemountsChildTest=initTracking(111).then(readCase).then(caseReply(1,2,1,1,1))
    .then(storageReply(1,true,1)).then(readCase).then(caseReply(2,2,1,2,2))
    .expect(s.epoch==2 and not(s.journal) and not(s.storageReady))
  run staleStorageReplyCannotPopulateNewChildTest=initTracking(111).then(readCase).then(caseReply(1,2,1,1,1))
    .then(readCase).then(caseReply(2,2,1,2,2)).then(storageReply(1,true,1))
    .expect(not(s.journal) and not(s.storageReady))
  run transientRefreshRetainsPaymentChildTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,true,1)).then(readCase).then(failedRead(2))
    .expect(s.warning and s.mode==1 and s.journal and s.epoch==1)
  run actorCheckUnmountsOldPrivateChildTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,true,1)).then(hidePrivateView).then(confirmActor(2)).then(storageReply(1,true,1))
    .expect(s.actor==2 and s.mode==0 and not(s.journal))
  run supersededCaseReadCannotRestoreSendControlsTest=initTracking(111).then(readCase).then(readCase)
    .then(caseReply(2,3,2,1,2)).then(caseReply(1,1,1,1,1))
    .expect(s.mode==3 and s.generation==2 and not(sendPresented))
  run fallbackGenerationChangeRetainsComponentInstanceTest=initTracking(111).then(readCase).then(caseReply(1,3,1,1,1))
    .then(readCase).then(caseReply(2,3,2,1,2)).expect(s.mode==3 and s.epoch==1 and s.generation==2)
  run departedWalletResultStaysInOriginalStorageSlotTest=initTracking(213).then(readCase).then(caseReply(1,2,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(readCase).then(caseReply(2,2,1,2,2))
    .then(walletReturns(true)).expect(s.hashKeys.contains(213) and not(s.journal) and s.epoch==2)
  run uncertainWalletResultKeepsOriginalMarkerTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(walletUnknown)
    .expect(s.savedKeys.contains(111) and s.journal and s.hashKeys==Set() and not(sendPresented))
  run declinedWalletRequestClearsItsMarkerTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(walletDeclined(true))
    .expect(not(s.journal) and s.savedKeys==Set() and sendPresented)
  run departureAfterPromptDoesNotCancelWalletTailTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(hidePrivateView)
    .expect(s.walletOpen and s.savedKeys.contains(111) and s.mode==0 and not(s.journal))
  run departedEvmPreflightCannotRecordOrPromptTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(hidePrivateView)
    .then(recordBeforePrompt.fail())
  run departedSolanaPreflightCannotRecordOrPromptTest=initTracking(111).then(readCase).then(caseReply(1,2,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(hidePrivateView)
    .then(recordBeforePrompt.fail())
  run departedSolanaOpenPromptRetainsWalletEvidenceTest=initTracking(213).then(readCase).then(caseReply(1,2,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(hidePrivateView)
    .then(walletReturns(true)).expect(s.hashKeys.contains(213) and s.mode==0 and not(s.journal))
  run declinedRequestWithStorageFailureRetainsMarkerTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(storageReply(1,false,1)).then(reviewBeforePrompt).then(recordBeforePrompt).then(walletDeclined(false))
    .expect(s.journal and s.savedKeys.contains(111) and not(sendPresented))
  run actionReplacementRejectsEarlierReadSuccessTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(readCase).then(replaceCase(2,2,2,2)).then(caseReply(2,1,1,1,1))
    .expect(s.mode==2 and s.generation==2 and s.message==2)
  run actionReplacementRejectsEarlierReadErrorTest=initTracking(111).then(readCase).then(caseReply(1,1,1,1,1))
    .then(readCase).then(replaceCase(2,2,2,2)).then(failedRead(2))
    .expect(s.mode==2 and s.generation==2 and not(s.warning) and s.phase=="ready")
}
