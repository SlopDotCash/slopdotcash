// @source workers/fee-converter/store.ts
// @source workers/fee-converter/direct-fees-fixture.ts
// Verified historical direct fees remain discoverable after offer replacement.
// Wallet topups add no earned credit. EVM replacement liabilities share a nonce;
// Solana transactions retain separate costs. Small integer amounts, two gas rows.
module earned_fee_history {
  type S = { solana: bool, configured: bool, received: bool, verified: bool,
    offer: int, discovered: Set[int], converted: int, gasA: int, gasB: int, topups: int }
  var s: S
  action init = s' = { solana: false, configured: false, received: false, verified: false,
    offer: 1, discovered: Set(1), converted: 0, gasA: 0, gasB: 0, topups: 0 }
  action configure(solana: bool): bool = all { not(s.configured), s' = s.with("solana", solana).with("configured", true) }
  action topup = s' = s.with("topups", 8)
  action receive = all { s.configured, s' = s.with("received", true) }
  action verify = all { s.received, s' = s.with("verified", true) }
  action replaceOffer = s' = s.with("offer", 2).with("discovered", Set(2))
  action discover = s' = s.with("discovered", if(s.verified) Set(1, s.offer) else Set(s.offer))
  action originalGas = all { s.configured, s' = s.with("gasA", 1) }
  action secondGas = all { s.configured, s' = s.with("gasB", 2) }
  val liabilities = if(s.solana) s.gasA + s.gasB else if(s.gasA > s.gasB) s.gasA else s.gasB
  val grossCredit = if(s.verified) 4 else 0
  val available = if(grossCredit > s.converted + liabilities) grossCredit - s.converted - liabilities else 0
  action reserveConversion = all { available >= 1, s.converted == 0, s' = s.with("converted", 1) }
  action step = any { configure(false), configure(true), topup, receive, verify, replaceOffer,
    discover, originalGas, secondGas, reserveConversion, s' = s }
  val invariant = all { available >= 0, available <= grossCredit,
    not(s.verified) implies available == 0,
    s.converted > 0 implies s.verified }
  run topupNotIncomeTest = init.then(configure(false)).then(topup).then(receive)
    .expect(available == 0).then(reserveConversion.fail())
  run paidHistoricalAssetTest = init.then(configure(false)).then(receive).then(verify)
    .then(replaceOffer).then(discover).expect(s.discovered == Set(1, 2) and invariant)
  run evmNonceLiabilityTest = init.then(configure(false)).then(receive).then(verify)
    .then(originalGas).then(secondGas).then(reserveConversion).expect(available == 1 and invariant)
  run solanaSeparateLiabilityTest = init.then(configure(true)).then(receive).then(verify)
    .then(originalGas).then(secondGas).then(reserveConversion).expect(available == 0 and invariant)
}
