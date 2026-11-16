// @source contracts/evm/integration/MockReferralToken.sol
// @source contracts/evm/integration/TestDollar.sol
// @source contracts/evm/integration/NativeFeeReceiver.sol
// Local/testnet fixture semantics, never real funds: false-return transfer,
// reverting recipient, allowance rollback and a refused reentrant fee call.
module fixture_asset_failure {
  var s: {balance:int,recipient:int,allowance:int,supply:int,failNext:bool,
    blocked:bool,receiverRejects:bool,reentryRefused:bool}
  action init = s'={balance:2,recipient:0,allowance:0,supply:2,failNext:false,
    blocked:false,receiverRejects:true,reentryRefused:false}
  action mint = all {s.supply<4,s'=s.with("balance",s.balance+1).with("supply",s.supply+1)}
  action approve = s'=s.with("allowance",2)
  action block = s'=s.with("blocked",true)
  action failNext = s'=s.with("failNext",true)
  action transfer = all {not(s.blocked),not(s.failNext),s.balance>=1,
    s'=s.with("balance",s.balance-1).with("recipient",s.recipient+1)}
  action transferFrom = all {not(s.blocked),s.balance>=1,s.allowance>=1,
    s'=s.with("balance",s.balance-1).with("recipient",s.recipient+1).with("allowance",s.allowance-1)}
  action falseTransfer = all {s.failNext,s'=s.with("failNext",false)}
  action acceptReceiver = s'=s.with("receiverRejects",false)
  action receiveWithReentry = all {not(s.receiverRejects),s'=s.with("reentryRefused",true)}
  action step = any {mint,approve,block,failNext,transfer,transferFrom,falseTransfer,acceptReceiver,receiveWithReentry,s'=s}
  val invariant = all {s.balance>=0,s.recipient>=0,s.allowance>=0,
    s.balance+s.recipient==s.supply,s.reentryRefused implies not(s.receiverRejects)}
  run falseTransferLeavesFundsTest = init.then(failNext).then(falseTransfer).expect(s.balance==2 and s.recipient==0)
  run blockedTransferFromRefusedTest = init.then(approve).then(block).then(transferFrom.fail())
  run reentryRejectedTest = init.then(acceptReceiver).then(receiveWithReentry).expect(s.reentryRefused and invariant)
}
