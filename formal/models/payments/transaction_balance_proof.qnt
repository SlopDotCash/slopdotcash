// @source backend/security/direct-evm-balances.ts
// A single transaction's witnessed state is authoritative. Whole-block deltas
// cannot substitute. Native payer debit includes gas; token debit does not.
module transaction_balance_proof {
  type S = { native: bool, witness: bool, readsCovered: bool, payerDebit: int,
    recipientCredit: int, wholeBlockMatches: bool, verified: bool }
  var s: S
  action init = s' = { native: false, witness: false, readsCovered: false, payerDebit: 0,
    recipientCredit: 0, wholeBlockMatches: false, verified: false }
  action trace(native: bool, witness: bool, covered: bool, debit: int, credit: int, blockMatches: bool): bool = all {
    not(s.verified), s' = { native: native, witness: witness, readsCovered: covered,
      payerDebit: debit, recipientCredit: credit, wholeBlockMatches: blockMatches, verified: false } }
  action verify = all { s.witness, s.readsCovered, s.recipientCredit == 2,
    s.payerDebit == (if(s.native) 3 else 2), s' = s.with("verified", true) }
  action choices = { nondet native = Set(true,false).oneOf() nondet witness = Set(true,false).oneOf()
    nondet covered = Set(true,false).oneOf() nondet debit = 0.to(3).oneOf()
    nondet credit = 0.to(3).oneOf() nondet blockMatches = Set(true,false).oneOf()
    trace(native,witness,covered,debit,credit,blockMatches) }
  action step = any { choices, verify, s' = s }
  val invariant = s.verified implies s.witness and s.readsCovered and s.recipientCredit == 2 and s.payerDebit == (if(s.native) 3 else 2)
  run blockDeltaCannotSubstituteTest = init.then(trace(false,false,true,2,2,true)).then(verify.fail())
  run uncoveredStorageRefusedTest = init.then(trace(false,true,false,2,2,true)).then(verify.fail())
  run nativeGasSeparateTest = init.then(trace(true,true,true,3,2,false)).then(verify).expect(invariant)
  run tokenExactDeltaTest = init.then(trace(false,true,true,2,2,false)).then(verify).expect(invariant)
}
