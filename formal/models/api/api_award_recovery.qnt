// @source backend/security/direct-payments.ts
// @source backend/security/direct-solana-recovery.ts
// @source backend/security/direct-evm.ts
// @source backend/security/direct-solana.ts
// @source backend/security/payments.ts
// @source backend/security/payment-database.ts
module api_award_recovery {
  var s: {destination: int, consent: int, request: str, paid: Set[int], previousPaid: Set[int], retired: bool, plans: int}
  action init = s' = {destination: 1, consent: 0, request: "absent", paid: Set(), previousPaid: Set(), retired: false, plans: 0}
  action consent = s' = s.with("consent", s.destination)
  action prepare = all { s.consent == s.destination, s.request == "absent", s.plans < 2,
    s' = s.with("request", "signable").with("plans", s.plans + 1).with("retired", false) }
  action settle(leg: int): bool = all { s.request == "signable", Set(1,2).contains(leg), not(s.paid.contains(leg)),
    s' = s.with("paid", s.paid.union(Set(leg))) }
  action walletChange = all { s.destination == 1,
    s' = s.with("destination", 2).with("consent", 0).with("previousPaid", s.paid) }
  action retire(proved: bool): bool = all { proved, s.request == "signable", s.paid != Set(1,2), s' = s.with("retired", true).with("request", "retired") }
  action successor = all { s.retired, s.consent == s.destination, s.request == "retired", s.plans < 2,
    s' = s.with("request", "signable").with("plans", s.plans + 1).with("retired", false) }
  action step = any { consent, prepare, settle(1), settle(2), walletChange, retire(true), retire(false), successor, s' = s }
  val invariant = all { s.previousPaid.subseteq(s.paid), s.paid.subseteq(Set(1,2)), s.plans <= 2 }
  run recoveryTest = init.then(consent).then(prepare).then(settle(1)).then(walletChange).then(retire(true)).then(consent).then(successor)
    .then(settle(2)).expect(s.paid == Set(1,2) and s.plans == 2)
  run unresolvedPlanTest = init.then(consent).then(prepare).then(walletChange).expect(s.request == "signable" and not(s.retired) and s.consent == 0)
}
