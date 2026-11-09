// @source contracts/solana/integration/legacy-project.mjs
// @source contracts/solana/integration/monthly-preload.mjs
// @source contracts/solana/integration/token-2022-preload.mjs
// Test-only byte generation, not proof these states arise in production. The
// deliberately short vault and expired reserved month must remain distinct.
module solana_preload_cases {
  type S={kind:str,bytes:int,obligation:int,balance:int,expired:bool,written:bool,local:bool}
  var s:S
  action init=s'={kind:"none",bytes:0,obligation:0,balance:0,expired:false,written:false,local:true}
  action legacy=all{not(s.written),s'=s.with("kind","legacy").with("bytes",316)}
  action shortVault=all{not(s.written),s'=s.with("kind","short").with("bytes",332).with("obligation",5).with("balance",4)}
  action expiredMonth=all{not(s.written),s'=s.with("kind","expired").with("bytes",109).with("obligation",1).with("balance",10).with("expired",true)}
  action token2022=all{not(s.written),s'=s.with("kind","token2022").with("bytes",170)}
  action write=all{s.kind!="none",s'=s.with("written",true)}
  action step=any{legacy,shortVault,expiredMonth,token2022,write,s'=s}
  val invariant=all{s.local,s.kind=="legacy" implies s.bytes==316,s.kind=="short" implies s.obligation>s.balance,s.kind=="expired" implies s.expired and s.obligation>0,s.kind=="token2022" implies s.bytes==170}
  run legacyLayoutFixtureTest=init.then(legacy).then(write).expect(s.bytes==316 and invariant)
  run impossibleBalanceFixtureExplicitTest=init.then(shortVault).then(write).expect(s.obligation>s.balance and invariant)
  run expiredFundedMonthFixtureTest=init.then(expiredMonth).then(write).expect(s.expired and s.obligation>0 and invariant)
}
