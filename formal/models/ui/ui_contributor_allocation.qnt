// @source src/ContributorAllocation.tsx
// @source src/lib/contributor-allocation.ts
// @source src/lib/use-time-boundary.ts
// Sender-recorded token distribution is distinct from chain-verified platform payouts.
module ui_contributor_allocation {
  var s: { member: bool, deadlinePassed: bool, registeredInTime: bool, wallet: bool, closed: bool, recordedTransfer: bool }
  action init = s' = { member: true, deadlinePassed: false, registeredInTime: false, wallet: false, closed: false, recordedTransfer: false }
  action register = s' = s.with("wallet", true).with("registeredInTime", s.registeredInTime or not(s.deadlinePassed))
  action deadline = s' = s.with("deadlinePassed", true)
  action close = s' = s.with("closed", true)
  action recordTransfer = s' = s.with("recordedTransfer", true)
  action changeWallet = all { s.wallet, s' = s }
  val state = if(not(s.member)) "hidden" else if(s.recordedTransfer) "sent"
    else if(s.closed) "unclaimed" else if(s.wallet and s.registeredInTime) "scheduled"
    else if(s.deadlinePassed) "unclaimed" else "awaiting-wallet"
  action noRecipient = s' = s.with("member", false)
  action step = any { register, deadline, close, recordTransfer, changeWallet, noRecipient, s' = s }
  val invariant = all { state == "sent" iff (s.member and s.recordedTransfer),
    state == "scheduled" implies s.registeredInTime and s.wallet and not(s.closed) }
  run deadlineTest = init.then(deadline).expect(state == "unclaimed")
  run lateWalletTest = init.then(deadline).then(register).expect(state == "unclaimed")
  run onTimeWalletTest = init.then(register).then(deadline).then(changeWallet).expect(state == "scheduled")
  run noRecipientTest = init.then(noRecipient).expect(state == "hidden")
  run sentTest = init.then(recordTransfer).then(close).expect(state == "sent")
}
