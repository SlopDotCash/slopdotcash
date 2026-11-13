// @source contracts/evm/src/ProjectEscrow.sol
// @source contracts/solana/programs/slop-escrow/src/lib.rs
// @source src/lib/payments/contracts.ts
// ProjectEscrow.deposit/commit/pay/withdrawUnused/claimFees; Solana equivalents.
// One award; gross 1..4, fee ceil(gross/50)=1; six base units total.
module escrow_balances {
  type S = { free: int, reserved: int, fees: int, paid: int, withdrawn: int,
    claimed: int, deposited: int, award: str, gross: int, rent: int }
  var s: S
  action init = s' = { free: 0, reserved: 0, fees: 0, paid: 0, withdrawn: 0,
    claimed: 0, deposited: 0, award: "none", gross: 0, rent: 1 }
  action deposit(n: int): bool = all { n > 0, s.deposited + n <= 6,
    s' = s.with("free", s.free + n).with("deposited", s.deposited + n) }
  action commit(n: int): bool = all { s.award == "none", n > 0, n <= s.free,
    s' = s.with("free", s.free - n).with("reserved", n).with("gross", n).with("award", "reserved") }
  action pay = all { s.award == "reserved",
    s' = s.with("reserved", 0).with("fees", s.fees + 1).with("paid", s.paid + s.gross - 1).with("award", "paid") }
  action withdraw(n: int): bool = all { n > 0, n <= s.free,
    s' = s.with("free", s.free - n).with("withdrawn", s.withdrawn + n - 1).with("fees", s.fees + 1) }
  action claimFees = all { s.fees > 0, s' = s.with("claimed", s.claimed + s.fees).with("fees", 0) }
  action choose = { nondet n = 1.to(4).oneOf() any { deposit(n), commit(n), withdraw(n) } }
  action step = any { choose, pay, claimFees, s' = s }
  val invariant = all { s.free >= 0, s.reserved >= 0, s.fees >= 0, s.rent == 1,
    s.deposited == s.free + s.reserved + s.fees + s.paid + s.withdrawn + s.claimed,
    s.award == "paid" implies s.reserved == 0 }
  run lifecycleTest = init.then(deposit(4)).then(commit(3)).then(pay).then(withdraw(1)).then(claimFees).expect(invariant and s.claimed == 2)
  run oneUnitFeeTest = init.then(deposit(1)).then(commit(1)).then(pay).expect(s.paid == 0 and s.fees == 1 and invariant)
  run protectedReserveTest = init.then(deposit(3)).then(commit(3)).then(withdraw(1).fail())
  run duplicatePayTest = init.then(deposit(3)).then(commit(3)).then(pay).then(pay.fail())
}
