// @source contracts/solana/scripts/test-e2e.sh
// @source contracts/solana/scripts/airdrop-local.mjs
// @source scripts/escrow-acceptance/local.ts
// @source scripts/local-solana-validator.mjs
// @conformance contracts/solana/airdrop-local.test.ts
// Caller composition for one acceptance validator or two shell stages.
// solana_container_lifecycle owns image, RPC, container ownership and stop
// details. Only the current unique receipt can admit tests or confirm stop.
// The shell also awaits its bounded local airdrop. formal_process models the
// command's interruption and process cleanup; a failed return cannot fund a stage.
module solana_validator_callers {
  var s: { phase:str, limit:int, stage:int, receiptStage:int, receipt:str,
    portOpen:bool, mounted:Set[int], funded:Set[int], tested:Set[int], ledger:bool,
    stopped:bool, closeReturned:bool, closeOk:bool, primary:int, cleanupError:bool, exitCode:int }
  action initial(limit:int):bool = s'={phase:"idle",limit:limit,stage:0,
    receiptStage:0,receipt:"none",portOpen:false,mounted:Set(),funded:Set(),tested:Set(),
    ledger:false,stopped:false,closeReturned:false,closeOk:false,
    primary:0,cleanupError:false,exitCode:-1}
  action init = {nondet limit=Set(1,2).oneOf(); initial(limit)}
  action begin = all {s.phase=="idle",s.stage<s.limit,
    s'=s.with("phase","starting").with("stage",s.stage+1)
      .with("receiptStage",0).with("receipt","none").with("stopped",false)
      .with("closeReturned",false).with("closeOk",false)
      .with("ledger",s.limit==1)
      .with("mounted",if(s.limit==1) Set(3) else if(s.stage==0) Set(1,2) else Set(1,2,3))}
  // Public program/account files only. 9 abstracts the host payer key, which
  // remains unmounted; every supplied file is an absolute read-only mount.
  action observe(stage:int,status:str):bool = all {
    Set("starting","stopping").contains(s.phase),
    s'=if(stage==s.stage) s.with("receiptStage",stage).with("receipt",status) else s}
  action foreignPort = s'=s.with("portOpen",true)
  action admitTests = all {s.phase=="starting",s.receiptStage==s.stage,s.receipt=="ready",
    s'=s.with("phase",if(s.limit==2) "funding" else "testing")}
  // Zero is a successful, cleaned-up command. One includes timeout or
  // unconfirmed command cleanup; 37 represents a preserved CLI failure.
  action fundingSettled(code:int):bool = all {s.phase=="funding",Set(0,1,37).contains(code),
    s'=s.with("phase",if(code==0) "testing" else "stopping")
      .with("funded",if(code==0) s.funded.union(Set(s.stage)) else s.funded)
      .with("primary",code)}
  action finishTests(success:bool):bool = all {s.phase=="testing",
    s'=s.with("phase","stopping").with("tested",s.tested.union(Set(s.stage)))
      .with("primary",if(success) 0 else 7)}
  action cancelStartup = all {Set("starting","funding").contains(s.phase),
    s'=s.with("phase","stopping").with("primary",7)}
  // The shell waits for its wrapper; the API caller awaits close(). A receipt
  // alone is insufficient, including when a failed wrapper wrote stopped.
  action closeReturns(ok:bool):bool = all {s.phase=="stopping",not(s.closeReturned),
    s'=s.with("closeReturned",true).with("closeOk",ok)}
  action confirmStop = all {s.phase=="stopping",s.closeReturned,s.closeOk,
    s.receiptStage==s.stage,s.receipt=="stopped",
    s'=s.with("phase","stopped").with("stopped",true)}
  action stopFails = all {s.phase=="stopping",s.closeReturned,
    not(s.closeOk) or s.receiptStage!=s.stage or s.receipt!="stopped",
    s'=s.with("phase","stopped").with("cleanupError",true)}
  action removeLedger = all {s.phase=="stopped",s.stopped,s.ledger,
    s'=s.with("ledger",false)}
  action completeStage = all {s.phase=="stopped",not(s.ledger) or s.cleanupError,
    s'=if(s.primary!=0 or s.cleanupError or s.stage==s.limit)
      s.with("phase","done").with("exitCode",if(s.primary!=0) s.primary else if(s.cleanupError) 1 else 0)
      else s.with("phase","idle")}
  action step = any {begin,foreignPort,
    observe(0,"ready"),observe(1,"ready"),observe(2,"ready"),
    observe(0,"stopped"),observe(1,"stopped"),observe(2,"stopped"),
    admitTests,fundingSettled(0),fundingSettled(1),fundingSettled(37),
    finishTests(true),finishTests(false),cancelStartup,
    closeReturns(true),closeReturns(false),confirmStop,
    stopFails,removeLedger,completeStage,s'=s}
  val invariant = all {
    s.limit==1 or s.limit==2, s.stage>=0 and s.stage<=s.limit,
    not(s.mounted.contains(9)),
    s.phase=="funding" implies (s.limit==2 and s.receiptStage==s.stage and s.receipt=="ready"),
    s.phase=="testing" implies (s.receiptStage==s.stage and s.receipt=="ready"),
    s.phase=="testing" and s.limit==2 implies s.funded.contains(s.stage),
    s.limit==2 implies s.tested.subseteq(s.funded),
    s.phase=="done" and s.primary!=0 implies s.exitCode==s.primary,
    s.phase=="done" and s.cleanupError implies s.exitCode!=0,
    s.exitCode==0 implies (s.phase=="done" and s.stopped and s.closeReturned and s.closeOk and not(s.ledger) and
      not(s.cleanupError) and s.tested.size()==s.limit and
      (s.limit==1 or s.funded.size()==s.limit))
  }
  action ready(stage:int):bool = observe(stage,"ready").then(admitTests)
  action successfulStop(stage:int):bool = finishTests(true).then(observe(stage,"stopped"))
    .then(closeReturns(true)).then(confirmStop)
  run foreignRpcCannotAdmitTestsTest = initial(2).then(begin).then(foreignPort)
    .expect(s.phase=="starting" and s.receipt=="none")
  run twoIndependentStagesRequireTwoCurrentReceiptsTest = initial(2).then(begin)
    .then(ready(1)).then(fundingSettled(0)).then(successfulStop(1)).then(completeStage).then(begin)
    .expect(s.receipt=="none" and s.stage==2)
    .then(observe(1,"ready")).expect(s.receipt=="none")
    .then(ready(2)).then(fundingSettled(0)).then(successfulStop(2)).then(completeStage).expect(s.exitCode==0)
  run oldStoppedReceiptCannotAdmitSecondStageTest = initial(2).then(begin)
    .then(ready(1)).then(fundingSettled(0)).then(successfulStop(1)).then(completeStage).then(begin)
    .then(observe(1,"stopped")).expect(s.phase=="starting" and s.receipt=="none")
  run acceptanceRemovesLedgerOnlyAfterConfirmedStopTest = initial(1).then(begin)
    .then(ready(1)).then(finishTests(true)).expect(s.ledger)
    .then(observe(1,"stopped")).then(closeReturns(true)).then(confirmStop).then(removeLedger)
    .then(completeStage).expect(s.exitCode==0 and not(s.ledger))
  run primaryFailureSurvivesCleanupFailureTest = initial(1).then(begin).then(ready(1))
    .then(finishTests(false)).then(closeReturns(false)).then(stopFails).then(completeStage)
    .expect(s.exitCode==7 and s.cleanupError and s.ledger)
  run cleanupFailureCannotPassTest = initial(1).then(begin).then(ready(1))
    .then(finishTests(true)).then(closeReturns(false)).then(stopFails).then(completeStage).expect(s.exitCode==1)
  run canceledStartupStillWaitsForOwnedStopTest = initial(1).then(begin).then(cancelStartup)
    .then(observe(1,"stopped")).then(closeReturns(true)).then(confirmStop).then(removeLedger)
    .then(completeStage).expect(s.exitCode==7 and s.tested==Set())
  run lateReadyIsNotAStopReceiptTest = initial(1).then(begin).then(ready(1))
    .then(finishTests(false)).then(observe(1,"ready"))
    .expect(not(s.stopped) and s.phase=="stopping" and s.ledger)
  run receiptDoesNotReplaceAwaitedStopTest = initial(1).then(begin).then(ready(1))
    .then(finishTests(true)).then(observe(1,"stopped"))
    .expect(not(s.stopped) and not(s.closeReturned) and s.ledger)
  run badExitCannotPassWithStoppedReceiptTest = initial(1).then(begin).then(ready(1))
    .then(finishTests(true)).then(observe(1,"stopped")).then(closeReturns(false))
    .then(stopFails).then(completeStage).expect(s.exitCode==1 and s.ledger)
  run readyReceiptStillRequiresLocalFundingTest = initial(2).then(begin).then(ready(1))
    .expect(s.phase=="funding" and s.funded==Set() and s.tested==Set())
    .then(finishTests(true).fail())
  run localAirdropTimeoutStillWaitsForValidatorStopTest = initial(2).then(begin).then(ready(1))
    .then(fundingSettled(1)).expect(s.phase=="stopping" and s.tested==Set() and not(s.stopped))
    .then(observe(1,"stopped")).then(closeReturns(true)).then(confirmStop).then(completeStage)
    .expect(s.exitCode==1 and s.tested==Set() and s.stopped)
  run localAirdropFailureSurvivesValidatorCleanupFailureTest = initial(2).then(begin).then(ready(1))
    .then(fundingSettled(37)).then(closeReturns(false)).then(stopFails).then(completeStage)
    .expect(s.exitCode==37 and s.cleanupError and s.tested==Set())
  run eachShellStageRequiresItsOwnFundingTest = initial(2).then(begin).then(ready(1))
    .then(fundingSettled(0)).then(successfulStop(1)).then(completeStage).then(begin).then(ready(2))
    .expect(s.phase=="funding" and s.funded==Set(1) and not(s.funded.contains(s.stage)))
    .then(finishTests(true).fail())
}
