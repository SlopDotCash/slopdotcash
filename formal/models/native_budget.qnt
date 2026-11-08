// @source contracts/evm/native-cost.ts
// @source migrations/0090_referral_post_gas.sql
// @source migrations/0092_fee_native_gas.sql
// @source migrations/0094_fee_solana_native_gas.sql
// @source migrations/0096_fee_solana_accounts.sql
// @source workers/fee-converter/native-gas.ts
// @source workers/fee-converter/store.ts
// @source workers/referral-accrual/gas.ts
// @source workers/operator-keeper/storage.ts
// fee-converter/native-gas.ts; referral-accrual/gas.ts; keeper storage.
// One send, native units bounded by transaction2/day4; unknown spans midnight.
module native_budget {
  type S = { day: int, reserved: int, spentToday: int, phase: str, settledDay: int }
  var s: S
  action init = s' = { day: 0, reserved: 0, spentToday: 0, phase: "none", settledDay: -1 }
  action reserve = all { s.phase == "none", s.spentToday + 2 <= 4,
    s' = s.with("reserved", 2).with("phase", "reserved") }
  action sign = all { s.phase == "reserved", s' = s.with("phase", "unknown") }
  action midnight = all { s.day == 0, s' = s.with("day", 1).with("spentToday", 0) }
  action abandonUnsigned = all { s.phase == "reserved", s' = s.with("reserved", 0).with("phase", "abandoned") }
  action finalize(actual: int): bool = all { s.phase == "unknown", actual >= 0, actual <= s.reserved,
    s' = s.with("reserved", 0).with("spentToday", s.spentToday + actual).with("settledDay", s.day).with("phase", "finalized") }
  action step = any { reserve, sign, midnight, abandonUnsigned, finalize(0), finalize(1), finalize(2), s' = s }
  val invariant = all { s.reserved >= 0, s.spentToday >= 0, s.reserved + s.spentToday <= 4,
    s.phase == "unknown" implies s.reserved == 2,
    s.phase == "finalized" implies (s.reserved == 0 and s.settledDay >= 0) }
  run midnightHoldTest = init.then(reserve).then(sign).then(midnight).expect(s.reserved == 2 and invariant)
  run finalizedDayTest = init.then(reserve).then(sign).then(midnight).then(finalize(1)).expect(s.settledDay == 1 and invariant)
  run unknownNotAbandonedTest = init.then(reserve).then(sign).then(abandonUnsigned.fail())
}
