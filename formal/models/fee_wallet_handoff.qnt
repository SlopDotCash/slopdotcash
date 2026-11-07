// @source workers/fee-converter/index.ts
// @source workers/fee-converter/config.ts
// @source workers/fee-converter/core.ts
// @source workers/fee-converter/evm.ts
// @source workers/fee-converter/solana.ts
// @evidence workers/fee-converter/native-gas.test.ts
// Configuration changes do not mutate the recipient on a retained send.
// Two public wallet identities; keys are identity representatives only.
module fee_wallet_handoff {
  var s:{wallet:int,key:int,mode:str,loaded:bool,rowWallet:int,row:str,output:int,
    error:bool,nonceUsed:bool,receipt:bool}
  action init=s'={wallet:1,key:1,mode:"live",loaded:false,rowWallet:1,row:"submitted",output:0,
    error:false,nonceUsed:false,receipt:false}
  action configure(wallet,key,mode)=s'=s.with("wallet",wallet).with("key",key).with("mode",mode).with("loaded",false).with("error",false)
  action loadClient=all{s.mode=="dry_run" or s.wallet==s.key,s'=s.with("loaded",true)}
  action observe(nonceUsed,receipt)=s'=s.with("nonceUsed",nonceUsed).with("receipt",receipt)
  action holdMismatched=all{s.loaded,s.wallet!=s.rowWallet,s.row=="submitted",s'=s.with("error",true)}
  action reconcile=all{s.loaded,s.wallet==s.rowWallet,s.row=="submitted",s.receipt,
    s'=s.with("row","finalized").with("output",2)}
  action step={nondet wallet=Set(1,2).oneOf() nondet key=Set(1,2).oneOf() nondet flag=Set(false,true).oneOf()
    any{configure(wallet,key,"live"),configure(wallet,key,"dry_run"),loadClient,observe(flag,flag),
      observe(true,false),holdMismatched,reconcile,s'=s}}
  val invariant=all{s.rowWallet==1,s.row=="finalized" implies s.output==2,
    s.row=="submitted" implies s.output==0}
  run differentKeyCannotControlSameWalletTest=init.then(configure(1,2,"live")).then(loadClient.fail())
  run changedWalletCannotRewriteRetainedOutputTest=init.then(configure(2,2,"live")).then(loadClient)
    .then(observe(true,true)).then(holdMismatched).expect(s.row=="submitted" and s.output==0 and invariant)
  run originalConfigurationRecoversExactOutputTest=init.then(configure(2,2,"dry_run")).then(loadClient)
    .then(observe(true,true)).then(holdMismatched).then(configure(1,1,"dry_run")).then(loadClient)
    .then(reconcile).expect(s.output==2 and s.row=="finalized" and invariant)
  run missingReceiptCannotCloseConsumedNonceTest=init.then(loadClient).then(observe(true,false)).then(reconcile.fail())
}
