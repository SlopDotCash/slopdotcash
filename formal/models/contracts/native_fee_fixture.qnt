// @source contracts/solana/integration/fee-converter-native-fixture.mjs
// Real local-validator setup manufactures a withdrawal fee, then the converter
// claims it. No live funds or mainnet genesis are asserted by the fixture label.
module native_fee_fixture {
  type S={phase:int,deposited:int,withdrawnGross:int,fees:int,vault:int,converted:int,local:bool}
  var s:S
  action init=s'={phase:0,deposited:0,withdrawnGross:0,fees:0,vault:0,converted:0,local:true}
  action initializeConfig=all{s.phase==0,s'=s.with("phase",1)}
  action initializeProject=all{s.phase==1,s'=s.with("phase",2)}
  action deposit=all{s.phase==2,s'=s.with("phase",3).with("deposited",200).with("vault",200)}
  action withdraw=all{s.phase==3,s'=s.with("phase",4).with("withdrawnGross",100).with("fees",2).with("vault",102)}
  action claimFees=all{s.phase==4,s'=s.with("phase",5).with("converted",2).with("fees",0).with("vault",100)}
  val principal=s.deposited-s.withdrawnGross
  action step=any{initializeConfig,initializeProject,deposit,withdraw,claimFees,s'=s}
  val invariant=all{s.local,s.vault==principal+s.fees,s.phase>=4 implies principal==100,s.converted+s.fees==(if(s.phase>=4) 2 else 0)}
  run claimsFeesNotPrincipalTest=init.then(initializeConfig).then(initializeProject).then(deposit).then(withdraw).then(claimFees).expect(s.vault==100 and invariant)
  run claimRequiresAccrualTest=init.then(initializeConfig).then(initializeProject).then(deposit).then(claimFees.fail())
}
