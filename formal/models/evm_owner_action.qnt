// @source src/lib/evm-vault-actions.ts
// Review and sending have separate account/network checks. ERC20 approval is
// not funding; its confirmation forces a fresh allowance read. Gross=2 and
// allowance/free values 0..2. Finality and exact calldata are independent facts.
module evm_owner_action {
  type S = { operation: str, native: bool, owner: bool, funds: int, allowance: int,
    account: bool, phase: str, kind: str, deposited: int, withdrawn: int }
  var s: S
  action init = s' = { operation: "deposit", native: false, owner: false, funds: 2,
    allowance: 0, account: true, phase: "input", kind: "none", deposited: 0, withdrawn: 0 }
  action choose(operation: str, native: bool, owner: bool, funds: int): bool = all { s.phase == "input",
    s' = s.with("operation", operation).with("native", native).with("owner", owner).with("funds", funds) }
  action review = all { s.phase == "input", s.account, s.funds >= 2,
    s.operation == "deposit" or s.owner, s' = s.with("phase", "reviewed") }
  action accountChanged = s' = s.with("account", false)
  action send(kind: str): bool = all { s.phase == "reviewed", s.account,
    (kind == "send" and (s.operation == "withdraw" or s.native or s.allowance >= 2)) or
    (Set("approve", "reset").contains(kind) and s.operation == "deposit" and not(s.native)),
    s' = s.with("kind", kind).with("phase", "pending") }
  action confirm(canonical: bool, exact: bool, success: bool): bool = all { s.phase == "pending", canonical, exact,
    s' = if(not(success)) s.with("phase", "failed")
      else if(s.kind != "send") s.with("phase", "approval-confirmed")
      else if(s.operation == "deposit") s.with("phase", "finalized").with("deposited", 2)
      else s.with("phase", "finalized").with("withdrawn", 2) }
  action recheckAllowance(amount: int): bool = all { s.phase == "approval-confirmed", s.account,
    s' = s.with("phase", "input").with("allowance", amount) }
  action step = any { choose("deposit", false, false, 2), choose("deposit", true, false, 2),
    choose("withdraw", false, false, 2), choose("withdraw", false, true, 0), choose("withdraw", false, true, 2),
    review, accountChanged, send("approve"), send("reset"), send("send"),
    confirm(true,true,true), confirm(true,true,false), recheckAllowance(0), recheckAllowance(2), s' = s }
  val invariant = all { s.deposited + s.withdrawn <= 2,
    s.phase == "approval-confirmed" implies s.deposited == 0 and s.withdrawn == 0,
    s.withdrawn > 0 implies s.owner }
  run approvalDoesNotFundTest = init.then(review).then(send("approve")).then(confirm(true,true,true)).expect(s.deposited == 0 and invariant)
  run allowanceRereadTest = init.then(review).then(send("approve")).then(confirm(true,true,true))
    .then(recheckAllowance(0)).then(review).then(send("send").fail())
  run fundedAfterFreshAllowanceTest = init.then(review).then(send("approve")).then(confirm(true,true,true))
    .then(recheckAllowance(2)).then(review).then(send("send")).then(confirm(true,true,true)).expect(s.deposited == 2 and invariant)
  run switchedAccountRefusedTest = init.then(choose("deposit",true,false,2)).then(review).then(accountChanged).then(send("send").fail())
  run reservedWithdrawalRefusedTest = init.then(choose("withdraw",false,true,0)).then(review.fail())
  run mismatchedReceiptRefusedTest = init.then(choose("deposit",true,false,2)).then(review).then(send("send")).then(confirm(true,false,true).fail())
}
