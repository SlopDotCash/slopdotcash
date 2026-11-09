// @source migrations/0112_direct_payment_recovery.sql
// @source migrations/0113_direct_unpaid_leg_recovery.sql
// @source backend/security/direct-payments.ts
// Direct award successor: no absence/advanced-nonce shortcut proves retirement.
module direct_payment_recovery {
  type S = { chain: str, payer: bool, consent: bool, changed: bool, retired: bool,
    lowerSettled: bool, generation: int, checked: int, researcherPaid: bool, complete: bool }
  var s: S
  action init = s' = { chain: "evm", payer: false, consent: false, changed: false, retired: false,
    lowerSettled: true, generation: 0, checked: 0, researcherPaid: false, complete: false }
  action solana = all { s.generation == 0, s' = s.with("chain", "solana") }
  action payer = s' = s.with("payer", true)
  action walletChanged = all { not(s.researcherPaid), s' = s.with("changed", true).with("consent", false) }
  action consent = s' = s.with("consent", true)
  action pendingLower = s' = s.with("lowerSettled", false)
  action settledLower = s' = s.with("lowerSettled", true)
  action verifyRetirement = s' = s.with("retired", true)
  action observe = s' = s.with("checked", s.generation)
  action successor = all { s.payer, s.consent, s.retired, s.lowerSettled,
    not(s.complete), s.generation < 2, s.checked == s.generation,
    s' = s.with("generation", s.generation+1).with("retired", false) }
  action recordResearcher = s' = s.with("researcherPaid", true)
  action complete = all { s.researcherPaid, s' = s.with("complete", true) }
  action step = any { solana, payer, walletChanged, consent, pendingLower, settledLower,
    verifyRetirement, observe, successor, recordResearcher, complete, s' = s }
  val invariant = all { s.generation <= 2, s.complete implies s.researcherPaid }
  run absentIsNotRetiredTest = init.then(payer).then(walletChanged).then(consent).then(successor.fail())
  run lowerNonceBlocksTest = init.then(payer).then(consent).then(verifyRetirement).then(pendingLower).then(successor.fail())
  run successorNeedsFreshGenerationTest = init.then(payer).then(consent).then(verifyRetirement).then(successor).then(verifyRetirement).then(successor.fail())
  run safeReplacementTest = init.then(payer).then(walletChanged).then(consent).then(verifyRetirement).then(successor).expect(s.generation == 1 and invariant)
}
